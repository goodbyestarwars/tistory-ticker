# -*- coding: utf-8 -*-
"""지지 돌파 그림자 기록(2026-11-26): 사전 후보 판정·연구 스크립트와의 일치·슬롯 기록·호출 제어·사후 성과."""

import importlib.util
import os
import random
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from datetime import datetime, timedelta, timezone
from functools import partial

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))

import support_breakout_shadow as sbs  # noqa: E402

KST = timezone(timedelta(hours=9))


def at(h, m, s=0, day=26):
    return datetime(2026, 11, day, h, m, s, tzinfo=KST)


def flat_rows(n=260, close=1000.0, volume=3_000_000):
    start = datetime(2025, 11, 1)
    return [{'date': (start + timedelta(days=i)).strftime('%Y-%m-%d'), 'open': close, 'high': close * 1.005,
             'low': close * 0.995, 'close': close, 'volume': volume} for i in range(n)]


def passing_rows():
    """4개 조건을 모두 통과하도록 만든 260봉: 급등 이력, 112일선 부근 저점, 저점 유지, 어제 거래량 3배."""
    rows = flat_rows(260, 1000.0)
    # t-1 = rows[-1]. 급등: 40봉 전 +20%
    for i in range(len(rows) - 40, len(rows)):
        rows[i].update(close=1200.0, open=1200.0, high=1206.0, low=1194.0)
    # 112일선(약 1000~1200 혼합 평균 ≈ 1071)에 걸리도록 최근 10봉 저점을 조정
    ma112 = sum(r['close'] for r in rows[-112:]) / 112
    for r in rows[-10:]:
        r['low'] = ma112 * 1.01
        r['close'] = max(r['close'], r['low'] * 1.02)
        r['open'] = r['close']
        r['high'] = r['close'] * 1.005
    # 앞 20봉 저점보다 최근 5봉 저점이 낮지 않게(앞 구간은 1194)
    for r in rows[-25:-5]:
        r['low'] = min(r['low'], ma112 * 0.99)
    rows[-1]['volume'] = 9_000_000
    return rows


class EvaluateTest(unittest.TestCase):
    def test_too_short_or_invalid_rows_return_none(self):
        self.assertIsNone(sbs.evaluate_candidate(flat_rows(200)))
        rows = flat_rows(260)
        rows[-3]['close'] = float('nan')
        self.assertIsNone(sbs.evaluate_candidate(rows))
        rows = flat_rows(260)
        rows[-1]['low'] = 0
        self.assertIsNone(sbs.evaluate_candidate(rows))

    def test_flat_series_has_no_surge_or_volume_expansion(self):
        e = sbs.evaluate_candidate(flat_rows(260))
        self.assertFalse(e['surge'])
        self.assertFalse(e['volx'])
        self.assertTrue(e['liq'])
        self.assertEqual(e['prev_date'], flat_rows(260)[-1]['date'])

    def test_all_four_conditions_pass_on_constructed_series(self):
        e = sbs.evaluate_candidate(passing_rows())
        self.assertEqual((e['sup'], e['hold'], e['surge'], e['volx'], e['n_pass']), (True, True, True, True, 4))
        self.assertIn(e['support_ref'], ('ma112', 'ma224'))
        self.assertAlmostEqual(e['surge_max'], 0.2, places=6)

    def test_support_window_boundaries(self):
        rows = passing_rows()
        ma112 = sum(r['close'] for r in rows[-112:]) / 112
        ma224 = sum(r['close'] for r in rows[-224:]) / 224
        for r in rows[-10:]:
            r['low'] = max(r['close'] * 0.5, 1.0)
        rows[-1]['low'] = ma112 * 0.93           # 112일선 -7% : 범위 밖, 224일선도 아님
        rows[-1]['low'] = min(rows[-1]['low'], ma224 * 0.5)
        self.assertFalse(sbs.evaluate_candidate(rows)['sup'])

    def test_volume_expansion_needs_double_of_previous_five_day_mean(self):
        rows = passing_rows()
        rows[-1]['volume'] = 5_999_999
        self.assertFalse(sbs.evaluate_candidate(rows)['volx'])
        rows[-1]['volume'] = 6_000_000
        self.assertTrue(sbs.evaluate_candidate(rows)['volx'])

    def test_liquidity_floor(self):
        rows = flat_rows(260, 1000.0, 1000)       # 거래대금 10억 미만
        self.assertFalse(sbs.evaluate_candidate(rows)['liq'])


class ResearchParityTest(unittest.TestCase):
    """운영 판정과 연구 스크립트(백테스트)의 SUP/HOLD/SURGE/VOLX가 같은 입력에서 같다."""

    @classmethod
    def setUpClass(cls):
        try:
            import numpy  # noqa: F401
            import pandas  # noqa: F401
        except ImportError:
            raise unittest.SkipTest('numpy/pandas 없음')
        path = os.path.join(ROOT, 'scripts', 'research', 'daytrade_support_breakout_study.py')
        spec = importlib.util.spec_from_file_location('daytrade_study', path)
        cls.study = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.study)

    def series(self, seed, n=330):
        rnd = random.Random(seed)
        px, close = [], 5000.0
        start = datetime(2024, 1, 1)
        for i in range(n):
            shock = rnd.gauss(0, 0.02) * (6 if rnd.random() < 0.04 else 1)
            nxt = max(100.0, close * (1 + shock))
            o = close * (1 + rnd.gauss(0, 0.004))
            hi = max(o, nxt) * (1 + abs(rnd.gauss(0, 0.01)))
            lo = min(o, nxt) * (1 - abs(rnd.gauss(0, 0.01)))
            vol = 1_000_000 * (1 + abs(rnd.gauss(0, 0.5))) * (4 if rnd.random() < 0.08 else 1)
            px.append([(start + timedelta(days=i)).strftime('%Y-%m-%d'), o, hi, lo, nxt, vol, 0])
            close = nxt
        return px

    def test_flags_match_study_for_every_emitted_signal_day(self):
        compared, four = 0, 0
        for seed in range(120):
            px = self.series(seed)
            result = self.study.per_code('X%d' % seed, px)
            if not result:
                continue
            rows = [{'date': r[0], 'open': r[1], 'high': r[2], 'low': r[3], 'close': r[4], 'volume': r[5]} for r in px]
            index = {r['date']: i for i, r in enumerate(rows)}
            for item in result[0]:
                t = index[item[1]]
                e = sbs.evaluate_candidate(rows[:t])
                self.assertIsNotNone(e)
                self.assertEqual((e['sup'], e['hold'], e['surge'], e['volx']),
                                 (bool(item[2]), bool(item[3]), bool(item[4]), bool(item[5])),
                                 'seed %d day %s' % (seed, item[1]))
                compared += 1
                four += e['n_pass'] == 4 and e['liq']
        self.assertGreater(compared, 5000)
        self.assertGreater(four, 0)        # 일치 검증이 전부 False끼리의 비교가 아니도록


class SelectionTest(unittest.TestCase):
    def e(self, n_pass, amt, liq=True):
        return {'n_pass': n_pass, 'amt20': amt, 'liq': liq}

    def test_orders_four_of_four_first_then_amount_and_caps(self):
        evals = {'000010': self.e(3, 9e9), '000020': self.e(4, 3e9), '000030': self.e(4, 8e9),
                 '000040': self.e(2, 99e9), '000050': self.e(4, 99e9, liq=False), '000060': None}
        picked = sbs.select_candidates(evals)
        self.assertEqual(list(picked), ['000030', '000020', '000010'])
        self.assertEqual(list(sbs.select_candidates(evals, limit=2)), ['000030', '000020'])


class PrepareDayTest(unittest.TestCase):
    def make_db(self, rows_by_code):
        conn = sqlite3.connect(':memory:')
        conn.execute('CREATE TABLE daily_prices (code TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL, '
                     'volume REAL, PRIMARY KEY(code, date))')
        for code, rows in rows_by_code.items():
            conn.executemany('INSERT INTO daily_prices VALUES (?,?,?,?,?,?,?)',
                             [(code, r['date'], r['open'], r['high'], r['low'], r['close'], r['volume']) for r in rows])
        return conn

    def test_ready_day_selects_common_stocks_and_excludes_etf_and_preferred(self):
        rows = passing_rows()
        prev, today = rows[-1]['date'], (datetime.strptime(rows[-1]['date'], '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')
        conn = self.make_db({'000010': rows, '000015': rows, '069500': rows, '000020': flat_rows(260)})
        etfs = {'E%05d' % i for i in range(60)} | {'069500'}
        state, cands, examined, fresh, note = sbs.prepare_day(conn, today, etfs, previous_day=prev)
        self.assertEqual(state, 'ready')
        self.assertEqual(sorted(cands), ['000010'])       # 000015 우선주 끝자리, 069500 ETF, 000020 조건 미달
        self.assertEqual(cands['000010']['n_pass'], 4)
        self.assertEqual((examined, fresh), (2, 2))

    def test_stale_daily_blocks_the_day(self):
        rows = passing_rows()
        today = (datetime.strptime(rows[-1]['date'], '%Y-%m-%d') + timedelta(days=3)).strftime('%Y-%m-%d')
        conn = self.make_db({'000010': rows})
        state, cands, *_ = sbs.prepare_day(conn, today, {'E%05d' % i for i in range(60)}, previous_day='2099-01-01')
        self.assertEqual((state, cands), ('stale_daily', {}))

    def test_missing_etf_list_is_not_treated_as_empty_universe(self):
        conn = self.make_db({'000010': passing_rows()})
        state, cands, *_ = sbs.prepare_day(conn, '2026-11-26', set(), previous_day='2026-11-25')
        self.assertEqual((state, cands), ('no_universe', {}))


NAVER_BODY = {'result': {'areas': [{'name': 'SERVICE_ITEM', 'datas': [
    {'cd': '003350', 'nm': '한국화장품제조', 'sv': 13530, 'nv': 14590, 'ov': 13600, 'hv': 14870, 'lv': 13350,
     'aq': 1158235, 'aa': 16567185660.0, 'ms': 'OPEN'},
    {'cd': '000020', 'nm': '무거래', 'sv': 5000, 'nv': 0, 'ov': 0, 'hv': 0, 'lv': 0, 'aq': 0, 'aa': 0, 'ms': 'OPEN'},
]}]}}


class RecordTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = os.path.join(self.tmp.name, 'sbs.db')

    def tearDown(self):
        self.tmp.cleanup()

    def cands(self):
        base = {'prev_date': '2026-11-25', 'prev_open': 100, 'prev_low': 95, 'prev_volume': 1}
        return {
            'A00000': dict(base, prev_high=100.0, prev_close=98.0, n_pass=4),
            'B00000': dict(base, prev_high=100.0, prev_close=98.0, n_pass=4),
            'C00000': dict(base, prev_high=100.0, prev_close=98.0, n_pass=3),
            'D00000': dict(base, prev_high=100.0, prev_close=98.0, n_pass=4),
            'S00000': dict(base, prev_high=100.0, prev_close=98.0, n_pass=4),
        }

    def quotes(self):
        def q(price, high, base=98.0, name='종목'):
            return {'name': name, 'price': price, 'open': 99.0, 'high': high, 'low': 97.0, 'base': base,
                    'volume': 1000.0, 'amount': 99000.0, 'state': 'OPEN'}
        return {'A00000': q(100.5, 100.6), 'B00000': q(97.0, 97.5), 'C00000': q(101.0, 101.0),
                'D00000': q(99.0, 99.5, base=90.0), 'S00000': q(101.0, 101.0, name='ABC스팩')}

    def test_armed_gets_kis_values_others_stay_null_and_spac_is_skipped(self):
        calls = []

        def kis(code):
            calls.append(code)
            return {'strength': 143.2, 'strength_time': '090512', 'ask_qty10': 1200.0, 'bid_qty10': 8800.0,
                    'ask1_price': 100.5, 'ask10_price': 102.0}

        with closing(sbs.connect(self.db)) as conn:
            stored, armed, kis_calls = sbs.record_slot(conn, '2026-11-26', 545, self.cands(), self.quotes(), kis, 123.0)
            self.assertEqual((stored, armed, kis_calls), (4, 2, 2))        # S 제외, A·D armed
            self.assertEqual(sorted(calls), ['A00000', 'D00000'])
            rows = {r[0]: r for r in conn.execute('SELECT code, armed, strength, ask_qty10, base_ok, price FROM sbs_obs')}
        self.assertEqual(rows['A00000'][1:4], (1, 143.2, 1200.0))
        self.assertEqual(rows['B00000'][1:4], (0, None, None))            # armed 아님: 0이 아니라 NULL
        self.assertEqual(rows['C00000'][1], 0)                            # 3/4 비교군은 KIS 추가 조회 없음
        self.assertEqual(rows['D00000'][4], 0)                            # 기준가 불일치(권리락 의심) 표시
        self.assertNotIn('S00000', rows)

    def test_same_slot_is_idempotent_and_kis_failure_keeps_price_row(self):
        def boom(code):
            raise RuntimeError('kis down')

        with closing(sbs.connect(self.db)) as conn:
            sbs.record_slot(conn, '2026-11-26', 545, self.cands(), self.quotes(), boom, 1.0)
            sbs.record_slot(conn, '2026-11-26', 545, self.cands(), self.quotes(), boom, 2.0)
            n, strength = conn.execute('SELECT COUNT(*), MAX(strength) FROM sbs_obs').fetchone()
        self.assertEqual((n, strength), (4, None))

    def test_armed_cap_limits_kis_calls(self):
        cands, quotes = {}, {}
        for i in range(30):
            code = '%05d0' % i
            cands[code] = {'prev_date': 'x', 'prev_open': 1, 'prev_high': 100.0, 'prev_low': 1, 'prev_close': 98.0,
                           'prev_volume': 1, 'n_pass': 4}
            quotes[code] = {'name': 'n', 'price': 101.0 + i * 0.01, 'open': 1, 'high': 102.0, 'low': 1, 'base': 98.0,
                            'volume': 1.0, 'amount': 1.0, 'state': 'OPEN'}
        with closing(sbs.connect(self.db)) as conn:
            _, armed, kis_calls = sbs.record_slot(conn, '2026-11-26', 545, cands, quotes, lambda c: {}, 1.0)
        self.assertEqual((armed, kis_calls), (30, sbs.MAX_ARMED))

    def test_parse_naver_uses_confirmed_fields_and_record_ignores_zero_price(self):
        parsed = sbs.parse_naver(NAVER_BODY)
        self.assertEqual(parsed['003350']['open'], 13600)
        self.assertEqual(parsed['003350']['high'], 14870)
        self.assertEqual(parsed['003350']['base'], 13530)
        self.assertEqual(parsed['003350']['volume'], 1158235)
        cands = {'003350': {'prev_high': 14000.0, 'prev_close': 13530.0, 'n_pass': 4},
                 '000020': {'prev_high': 5000.0, 'prev_close': 5000.0, 'n_pass': 4}}
        with closing(sbs.connect(self.db)) as conn:
            conn.execute("INSERT INTO sbs_candidate (trading_date, code) VALUES ('2026-11-26', '003350')")
            stored, armed, _ = sbs.record_slot(conn, '2026-11-26', 540, cands, parsed, None, 5.0)
            name = conn.execute("SELECT name FROM sbs_candidate WHERE code='003350'").fetchone()[0]
        self.assertEqual((stored, armed), (1, 1))            # 거래 전(0원) 종목은 저장하지 않는다
        self.assertEqual(name, '한국화장품제조')


class ObserveTest(unittest.TestCase):
    def setUp(self):
        sbs._state.update(date=None, status='pending', cands={}, slots=set(), running=False, retry_at=0.0,
                          last=None, note=None)
        self.calls = []

    def runner(self, *args):
        self.calls.append(args)
        with sbs._lock:
            sbs._state['running'] = False     # 테스트에서는 작업을 실행하지 않고 즉시 끝난 것으로 본다

    def test_one_start_per_five_minute_slot_and_none_outside_session(self):
        self.assertEqual(sbs.observe(at(9, 0, 5), 'k', 's', runner=self.runner), 'started')
        self.assertEqual(sbs.observe(at(9, 0, 35), 'k', 's', runner=self.runner), 'skip')    # 같은 슬롯
        self.assertEqual(sbs.observe(at(9, 4, 59), 'k', 's', runner=self.runner), 'skip')
        self.assertEqual(sbs.observe(at(9, 5, 3), 'k', 's', runner=self.runner), 'started')  # 다음 슬롯
        self.assertIsNone(sbs.observe(at(8, 59, 30), 'k', 's', runner=self.runner))
        self.assertIsNone(sbs.observe(at(15, 31, 0), 'k', 's', runner=self.runner))
        self.assertEqual([c[1] for c in self.calls], [540, 545])
        self.assertEqual(sbs.slot_of(at(15, 30)), 930)

    def test_running_worker_blocks_overlap_and_new_day_resets(self):
        self.assertEqual(sbs.observe(at(9, 5, 0), 'k', 's', runner=self.runner), 'started')   # 날짜 상태를 먼저 만든다
        sbs._state['running'] = True
        self.assertEqual(sbs.observe(at(9, 10, 0), 'k', 's', runner=self.runner), 'skip')
        sbs._state['running'] = False
        self.assertEqual(sbs.observe(at(9, 10, 0), 'k', 's', runner=self.runner), 'started')
        self.assertEqual(sbs.observe(at(9, 10, 0, day=27), 'k', 's', runner=self.runner), 'started')  # 다음 날
        self.assertEqual(sbs._state['date'], '2026-11-27')

    def test_weekend_is_skipped(self):
        self.assertIsNone(sbs.observe(at(9, 30, 0, day=28), 'k', 's', runner=self.runner))    # 토요일


class WorkTest(unittest.TestCase):
    def setUp(self):
        sbs._state.update(date='2026-11-26', status='pending', cands={}, slots={540}, running=True, retry_at=0.0,
                          last=None, note=None)
        self.tmp = tempfile.TemporaryDirectory()
        self.db = os.path.join(self.tmp.name, 'sbs.db')

    def tearDown(self):
        self.tmp.cleanup()

    def prices_conn(self):
        rows = passing_rows()
        conn = sqlite3.connect(':memory:')
        conn.execute('CREATE TABLE daily_prices (code TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL, '
                     'volume REAL, PRIMARY KEY(code, date))')
        conn.executemany('INSERT INTO daily_prices VALUES (?,?,?,?,?,?,?)',
                         [('000010', r['date'], r['open'], r['high'], r['low'], r['close'], r['volume']) for r in rows])
        self.prev = rows[-1]['date']
        return conn

    def test_builds_candidates_then_records_slot_and_survives_restart(self):
        conn = self.prices_conn()
        etfs = {'E%05d' % i for i in range(60)}
        quotes = {'000010': {'name': 'T', 'price': 1500.0, 'open': 1400.0, 'high': 1500.0, 'low': 1390.0,
                             'base': passing_rows()[-1]['close'], 'volume': 5.0, 'amount': 5.0, 'state': 'OPEN'}}
        patched = sbs.prepare_day
        sbs.prepare_day = lambda c, d, e=None, previous_day=None: patched(c, d, e, previous_day=self.prev)
        try:
            sbs._work('2026-11-26', 540, 1000.0, '', '', self.db, quote_fetcher=lambda codes: quotes,
                      prices_conn_factory=lambda: conn, etf_codes=etfs)
        finally:
            sbs.prepare_day = patched
        self.assertEqual(sbs._state['status'], 'ready')
        self.assertFalse(sbs._state['running'])
        with closing(sbs.connect(self.db)) as db:
            self.assertEqual(db.execute('SELECT state, candidates FROM sbs_day').fetchone(), ('ready', 1))
            self.assertEqual(db.execute('SELECT COUNT(*) FROM sbs_obs').fetchone()[0], 1)
        # 같은 날 재시작: 후보를 다시 만들지 않고 DB에서 복원
        sbs._state.update(status='pending', cands={}, running=True)
        sbs._work('2026-11-26', 545, 1300.0, '', '', self.db, quote_fetcher=lambda codes: quotes,
                  prices_conn_factory=lambda: (_ for _ in ()).throw(AssertionError('후보를 다시 만들면 안 된다')))
        self.assertEqual(sbs._state['status'], 'ready')
        with closing(sbs.connect(self.db)) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM sbs_obs').fetchone()[0], 2)

    def test_stale_daily_defers_and_allows_retry(self):
        conn = self.prices_conn()
        sbs._work('2026-11-26', 540, 1000.0, '', '', self.db, quote_fetcher=lambda codes: {},
                  prices_conn_factory=lambda: conn, etf_codes={'E%05d' % i for i in range(60)})
        # 실제 직전 거래일(2026-11-25)의 일봉이 없으므로 보류
        self.assertEqual(sbs._state['status'], 'stale_daily')
        self.assertNotIn(540, sbs._state['slots'])
        self.assertGreater(sbs._state['retry_at'], 0)
        self.assertFalse(sbs._state['running'])


class OutcomeTest(unittest.TestCase):
    def test_fills_d0_to_d3_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = os.path.join(tmp, 'sbs.db')
            prices = sqlite3.connect(':memory:')
            prices.execute('CREATE TABLE daily_prices (code TEXT, date TEXT, open REAL, high REAL, low REAL, '
                           'close REAL, volume REAL)')
            for i, day in enumerate(['2026-11-26', '2026-11-27', '2026-11-30', '2026-12-01', '2026-12-02']):
                prices.execute('INSERT INTO daily_prices VALUES (?,?,?,?,?,?,?)',
                               ('000010', day, 100 + i, 110 + i, 90 + i, 105 + i, 1000))
            with closing(sbs.connect(db)) as conn:
                conn.execute("INSERT INTO sbs_candidate (trading_date, code, n_pass) VALUES ('2026-11-26','000010',4)")
                conn.execute("INSERT INTO sbs_candidate (trading_date, code, n_pass) VALUES ('2026-11-26','999990',4)")
                conn.commit()
            self.assertEqual(sbs.update_outcomes(prices, db, today='2026-12-05'), 1)   # 일봉 없는 종목은 건너뜀
            self.assertEqual(sbs.update_outcomes(prices, db, today='2026-12-05'), 0)   # 이미 채운 행은 다시 쓰지 않는다(멱등)
            with closing(sbs.connect(db)) as conn:
                days, n = conn.execute("SELECT daily_json, outcome_days FROM sbs_candidate WHERE code='000010'").fetchone()
            self.assertEqual(n, 4)
            self.assertIn('2026-11-26', days)


if __name__ == '__main__':
    unittest.main()
