# -*- coding: utf-8 -*-
import hashlib
import json
import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts', 'research'))
import exit_ledger_adapter as la  # noqa: E402
import exit_sr_local as loc  # noqa: E402
import exit_sr_study as sr  # noqa: E402
import exit_strategy_study as xs  # noqa: E402

SCHEMA = '''CREATE TABLE intents(id INTEGER PRIMARY KEY, ts TEXT NOT NULL, code TEXT NOT NULL, side TEXT NOT NULL, qty INTEGER NOT NULL,
  price INTEGER, state TEXT NOT NULL, order_no TEXT, detail TEXT, reason TEXT, note TEXT);'''
DAYS = ['2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']


def md5(path):
    return hashlib.md5(open(path, 'rb').read()).hexdigest()


def make_ledger(path):
    db = sqlite3.connect(path)
    db.executescript(SCHEMA)
    rows = [
        (1, '2026-10-19T09:05:00+09:00', '111111', 'BUY', 3, 10000, 'ACK', 'SECRET1', '0', 'ENTRY', json.dumps({'scanner': 'pattern:pullback', 'rank': 3, 'base': 9900})),
        (2, '2026-10-19T10:10:00+09:00', '111111', 'SELL', 3, 10100, 'ACK', 'SECRET2', '0', 'TRAIL_2_5', json.dumps({'gain_pct': 1.0, 'peak': 10400, 'hits': 2})),
        (3, '2026-10-19T09:06:00+09:00', '222222', 'BUY', 2, 20000, 'UNKNOWN', None, '', 'ENTRY', None),
        (4, '2026-10-20T09:03:00+09:00', '333333', 'BUY', 1, 5000, 'ACK', 'SECRET3', '0', 'ENTRY', None),
    ]
    db.executemany('INSERT INTO intents VALUES(?,?,?,?,?,?,?,?,?,?,?)', [(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10]) for r in rows])
    db.commit()
    db.close()


def bars_for(close_fn, n=390):
    out, prev = [], None
    for i in range(n):
        m = 9 * 60 + i
        c = close_fn(i)
        o = prev if prev is not None else c
        out.append(['%02d%02d' % (m // 60, m % 60), o, max(o, c) * 1.0005, min(o, c) * 0.9995, c, 1000])
        prev = c
    return out


class AdapterTest(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.db = os.path.join(self.d, 'live_orders.db')
        make_ledger(self.db)

    def test_readonly_snapshot_leaves_original_untouched(self):
        before = md5(self.db)
        snap = la.snapshot(self.db, os.path.join(self.d, 'work', 'snap.db'))
        self.assertEqual(md5(self.db), before)
        self.assertTrue(os.path.exists(snap))
        with self.assertRaises(sqlite3.OperationalError):
            la.open_ro(self.db).execute('DELETE FROM intents')
        self.assertEqual(md5(self.db), before)

    def test_trades_pair_ack_vs_unknown_and_unknown_source(self):
        t = la.read_trades(self.db, {('2026-10-19', '111111', 'BUY'): 10020})
        by = {x['code']: x for x in t}
        self.assertEqual(by['111111']['scanner'], 'pullback')
        self.assertEqual(by['111111']['scanner_origin'], 'ledger_note')
        self.assertTrue(by['111111']['buy_fill_confirmed'])
        self.assertEqual(by['111111']['buy_price'], 10020)
        self.assertEqual(by['111111']['sell_reason'], 'TRAIL_2_5')
        self.assertEqual(by['111111']['sell_hits'], 2)
        self.assertEqual(by['333333']['scanner'], la.UNKNOWN)           # 추정하지 않는다
        self.assertFalse(by['333333']['buy_fill_confirmed'])             # 의도가격임을 표시
        self.assertNotIn('SECRET', json.dumps(t))                        # 주문번호는 내보내지 않는다

    def test_entries_exclude_unacked_and_keep_reason(self):
        t = la.read_trades(self.db)
        entries, skipped = la.to_entries(t, DAYS, 2)
        self.assertEqual({e['code'] for e in entries}, {'111111', '333333'})
        self.assertTrue(any(s['reason'].startswith('BUY_NOT_ACK') for s in skipped))
        e = next(x for x in entries if x['code'] == '111111')
        self.assertEqual(e['entry_hhmm'], '0905')
        self.assertEqual(e['days'][0], '2026-10-19')
        self.assertEqual(len(e['days']), 1 + 2)                          # 매도일 + 추가 2거래일


class EngineCheckTest(unittest.TestCase):
    def test_hash_and_constants(self):
        d = tempfile.mkdtemp()
        open(os.path.join(d, 'live_engine.py'), 'w').write('STOP_PCT = 3.0\nEMERGENCY_STOP_PCT = 5.0\nTRAIL_ARM_PCT = 3.0\nTRAIL_PCT = 2.5\nCONFIRM_CHECKS = 2\n')
        r = loc.engine_check(d)
        self.assertTrue(r['constants_match_study'])
        self.assertFalse(r['live_engine.py']['matches_expected'])        # 다른 파일이므로 불일치를 그대로 보고한다
        self.assertIsNone(r['live_runner.py']['sha256'])


class PipelineTest(unittest.TestCase):
    def test_end_to_end_with_missing_bars_and_no_secrets(self):
        work = tempfile.mkdtemp()
        cache = os.path.join(work, 'naver')
        os.makedirs(cache)
        cal = [[d, 100, 101, 99, 100, 1000] for d in DAYS]
        json.dump(cal, open(os.path.join(cache, '005930.json'), 'w'))
        daily = []
        for i, d in enumerate(['2026-09-%02d' % x for x in range(1, 30)] + DAYS[:2]):
            daily.append([d, 100, 100 + 2 + (i % 3), 98 - (i % 4), 100, 1000])
        json.dump(daily, open(os.path.join(cache, '111111.json'), 'w'))
        make_ledger(os.path.join(work, 'src.db'))
        trades = la.read_trades(os.path.join(work, 'src.db'))
        json.dump(trades, open(os.path.join(work, 'trades.json'), 'w'))
        mb = os.path.join(work, 'minbars')
        os.makedirs(mb)
        fall = lambda i: 10000 - max(0, i - 40) * 3          # 점진적 하락
        for d in ['2026-10-19', '2026-10-20', '2026-10-21']:
            json.dump({'code': '111111', 'day': d, 'bars': bars_for(fall)}, open(os.path.join(mb, '111111_%s.json' % d), 'w'))
        # 333333 은 분봉이 없다 -> 제외 사유가 남아야 한다
        loc.cmd_analyze(work, cache, ['111111'])
        out = os.path.join(work, 'out')
        cov = json.load(open(os.path.join(out, 'coverage.json')))
        self.assertEqual(cov['usable'], 1)
        self.assertTrue(any(x['reason'] == 'MINUTE_BARS_MISSING' for x in cov['excluded']))
        summ = json.load(open(os.path.join(out, 'summary.json')))
        self.assertIn('A_cycle', summ['rules'])
        self.assertIn('실제 체결 결과 아님', summ['basis'])
        self.assertFalse(summ['adoption_check']['sufficient'])           # 표본 1건: 채택 불가
        cases = json.load(open(os.path.join(out, 'cases.json')))
        self.assertEqual(cases[0]['scanner'], 'pullback')
        blob = ''.join(open(os.path.join(out, f), encoding='utf-8-sig').read() for f in os.listdir(out))
        self.assertNotIn('SECRET', blob)

    def test_cycle_confirm_never_later_than_distinct_bars(self):
        closes = [10000] * 10 + [9650] * 30                     # -3.5% 갭 하락
        path = [('2026-10-19',) + tuple(b) for b in bars_for(lambda i: closes[min(i, 39)], 40)]
        e = {'code': 'x', 'entry_day': '2026-10-19', 'days': ['2026-10-19'], 'path': path, 'prev_lows': {}, 'entry_hhmm': '0901'}
        a = xs.simulate(e, lambda p, c: xs.RuleA(p, c), {})
        ac = xs.simulate(e, lambda p, c: sr.RuleACycle(p, c), {})
        self.assertLessEqual((ac['exit_day'], ac['exit_hhmm']), (a['exit_day'], a['exit_hhmm']))
        self.assertLess(ac['exit_hhmm'], a['exit_hhmm'])        # 같은 봉에서 2회 확인되어 한 봉 빨리 나간다


if __name__ == '__main__':
    unittest.main()
