# -*- coding: utf-8 -*-
"""청산 규칙(손절 짧게·익절 길게)과 진입 기록 회귀 테스트 - 가짜 증권사 응답만 쓰며 실제 주문·네트워크 호출이 없다. (2026-10-16)

실행: python -m unittest -v test_live_exit_rules   (이 폴더에서)
"""
import json
import os
import sqlite3
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import live_engine as le
from test_live_exclusion import Base, FakeBroker, holding, NOW  # noqa: E402


class ExitDecisionTests(unittest.TestCase):
    def test_constants(self):
        self.assertEqual((le.STOP_PCT, le.EMERGENCY_STOP_PCT, le.TRAIL_ARM_PCT, le.TRAIL_PCT, le.CONFIRM_CHECKS), (3.0, 5.0, 3.0, 2.5, 2))

    def test_normal_stop_needs_two_consecutive_checks(self):
        r, peak, hits = le.exit_decision(97.1, 100, None, 0)          # -2.9%: 아직 아님
        self.assertEqual((r, hits), (None, 0))
        r, peak, hits = le.exit_decision(97.0, 100, peak, hits)       # -3.0% 첫 확인
        self.assertEqual((r, hits), (None, 1))
        r, peak, hits = le.exit_decision(96.8, 100, peak, hits)       # 둘째 확인 -> 손절
        self.assertEqual((r, hits), ('STOP_3', 2))

    def test_single_second_dip_is_ignored(self):
        r, peak, hits = le.exit_decision(96.5, 100, None, 0)          # 순간 -3.5%
        self.assertEqual((r, hits), (None, 1))
        r, peak, hits = le.exit_decision(99.0, 100, peak, hits)       # 바로 회복 -> 확인 횟수 초기화
        self.assertEqual((r, hits), (None, 0))

    def test_emergency_stop_is_immediate(self):
        r, _, _ = le.exit_decision(95.0, 100, None, 0)
        self.assertEqual(r, 'STOP_EMERGENCY')
        r, _, _ = le.exit_decision(80.0, 100, None, 0)
        self.assertEqual(r, 'STOP_EMERGENCY')
        r, _, _ = le.exit_decision(95.1, 100, None, 0)                # -4.9%는 일반 손절 확인 대상
        self.assertIsNone(r)

    def test_trail_arms_only_after_plus_three_percent(self):
        r, peak, hits = le.exit_decision(102.9, 100, None, 0)         # 고점 +2.9%: 추적 시작 전
        self.assertIsNone(r)
        for _ in range(3):
            r, peak, hits = le.exit_decision(100.3, 100, peak, hits)  # 고점 대비 -2.5%여도 추적 아님, 손절선(-3%)도 아님
            self.assertIsNone(r)
        self.assertEqual(hits, 0)

    def test_trail_follows_new_highs_and_exits_after_two_checks(self):
        peak, hits = None, 0
        for price in (103, 106, 104):                                 # 고점이 106까지 올라가고 되돌림 -1.9%
            r, peak, hits = le.exit_decision(price, 100, peak, hits)
            self.assertIsNone(r)
        self.assertEqual(peak, 106)
        r, peak, hits = le.exit_decision(103.3, 100, peak, hits)      # 106*0.975=103.35 이하 첫 확인
        self.assertEqual((r, hits), (None, 1))
        r, peak, hits = le.exit_decision(103.2, 100, peak, hits)
        self.assertEqual((r, hits), ('TRAIL_2_5', 2))

    def test_no_fixed_take_profit_and_no_old_floor_exit(self):
        r, peak, hits = le.exit_decision(115, 100, None, 0)           # +15%에서도 고정 익절 없음
        self.assertIsNone(r)
        r, peak, hits = le.exit_decision(104, 100, None, 0)           # 고점 +4%
        r, peak, hits = le.exit_decision(102.9, 100, peak, hits)      # 예전 수익보호 바닥(+3% 미만)이면 팔렸을 자리: 고점 대비 -1.06%라 보유
        self.assertIsNone(r)
        self.assertFalse(hasattr(le, 'exit_reason'))

    def test_bad_input_changes_nothing(self):
        self.assertEqual(le.exit_decision(None, 100, 105, 1), (None, 105, 1))
        self.assertEqual(le.exit_decision(100, 0, 105, 1), (None, 105, 1))


class Cycle(Base):
    def add_position(self, code='000660', qty=5):
        with self.ledger.connect() as db:
            db.execute("INSERT OR IGNORE INTO positions(code,qty,state,buy_day,floor_reached) VALUES(?,?,'OPEN','2026-10-14',0)", (code, qty))

    def broker(self, price, code='000660', avg=100000, qty=5):
        return FakeBroker([holding('032640', 13, 14750, 14750), holding(code, qty, avg, price)], {'032640': 14750, code: price})

    def intents(self):
        with self.ledger.connect() as db:
            return [dict(r) for r in db.execute('SELECT * FROM intents ORDER BY id')]

    def test_normal_stop_places_one_sell_after_second_cycle_with_record(self):
        self.add_position()
        b = self.broker(96500)                                         # -3.5%
        self.assertNotEqual(self.cycle(b), 'STOP_3')
        self.assertEqual(b.sells, [])
        self.assertEqual(self.cycle(b), 'STOP_3')
        self.assertEqual(b.sells, [('000660', 5)])
        sell = self.intents()[-1]
        self.assertEqual((sell['side'], sell['reason'], sell['price'], sell['state']), ('SELL', 'STOP_3', 96500, 'ACK'))
        note = json.loads(sell['note'])
        self.assertEqual((note['gain_pct'], note['avg'], note['confirm_hits']), (-3.5, 100000.0, 2))

    def test_emergency_stop_sells_in_first_cycle(self):
        self.add_position()
        b = self.broker(94000)
        self.assertEqual(self.cycle(b), 'STOP_EMERGENCY')
        self.assertEqual(b.sells, [('000660', 5)])

    def test_dip_then_recovery_never_sells(self):
        self.add_position()
        b = self.broker(96500)
        self.cycle(b)
        b.prices['000660'] = 99000
        b.holdings = [holding('032640', 13, 14750, 14750), holding('000660', 5, 100000, 99000)]
        for _ in range(3):
            self.cycle(b)
        self.assertEqual(b.sells, [])

    def test_peak_and_confirm_count_survive_engine_restart(self):
        self.add_position()
        b = self.broker(106000)
        self.cycle(b)                                                  # 고점 +6% 기록
        self.ledger = le.Ledger(os.path.join(self.dir, 'live_orders.db'))   # 재시작
        b.prices['000660'] = 103000
        b.holdings = [holding('032640', 13, 14750, 14750), holding('000660', 5, 100000, 103000)]
        self.cycle(b)                                                  # 106000*0.975=103350 이하 첫 확인
        self.ledger = le.Ledger(os.path.join(self.dir, 'live_orders.db'))   # 또 재시작
        self.assertEqual(self.cycle(b), 'TRAIL_2_5')
        self.assertEqual(b.sells, [('000660', 5)])
        with self.ledger.connect() as db:
            row = db.execute("SELECT peak_price FROM positions WHERE code='000660'").fetchone()
        self.assertEqual(row[0], 106000)

    def test_excluded_code_is_still_never_sold(self):
        b = FakeBroker([holding('032640', 13, 14750, 11000)], {'032640': 11000})
        for _ in range(3):
            self.cycle(b)
        self.assertEqual(b.sells, [])


class SchemaTests(unittest.TestCase):
    def test_old_ledger_gets_new_columns_without_losing_rows(self):
        import tempfile
        d = tempfile.mkdtemp()
        path = os.path.join(d, 'live_orders.db')
        db = sqlite3.connect(path)
        db.executescript('''CREATE TABLE positions(code TEXT PRIMARY KEY, qty INTEGER NOT NULL, state TEXT NOT NULL,
                              floor_reached INTEGER NOT NULL DEFAULT 0, buy_day TEXT NOT NULL);
                            CREATE TABLE intents(id INTEGER PRIMARY KEY, ts TEXT NOT NULL, code TEXT NOT NULL, side TEXT NOT NULL,
                              qty INTEGER NOT NULL, price INTEGER, state TEXT NOT NULL, order_no TEXT, detail TEXT);
                            INSERT INTO positions VALUES('010950',1,'OPEN',0,'2026-10-15');
                            INSERT INTO intents(ts,code,side,qty,price,state) VALUES('2026-10-15T09:43:22+09:00','010950','BUY',1,160800,'ACK');''')
        db.commit(); db.close()
        ledger = le.Ledger(path)
        ledger = le.Ledger(path)                                       # 두 번 열어도 안전
        with ledger.connect() as c:
            pos = dict(c.execute("SELECT * FROM positions").fetchone())
            self.assertEqual((pos['code'], pos['qty'], pos['peak_price'], pos['exit_hits']), ('010950', 1, None, 0))
            intent = dict(c.execute("SELECT * FROM intents").fetchone())
            self.assertEqual((intent['price'], intent['reason'], intent['note']), (160800, None, None))
            self.assertIn('skips', {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")})


class EntryRecordTests(Base):
    def bars(self, volume=300000, step=30, wide=0.015):
        from datetime import datetime, timedelta
        out, close = [], 14000.0
        for i in range(25):
            d = (datetime(2026, 10, 14) - timedelta(days=24 - i)).strftime('%Y-%m-%d')
            close += step
            out.append({'date': d, 'open': close, 'high': close * (1 + wide), 'low': close * (1 - wide), 'close': close, 'volume': volume})
        return out

    def cand(self, code, scanner='doubleBottom', base=14750):
        return {'scan_date': '2026-10-14', 'scanner': scanner, 'code': code, 'base_price': base, 'status': 'NEW'}

    def clear(self):
        with self.ledger.connect() as db:
            db.execute('DELETE FROM positions')

    def skips(self):
        with self.ledger.connect() as db:
            return {(r['code'], r['reason']): dict(r) for r in db.execute('SELECT * FROM skips')}

    def test_buy_records_score_rank_scanner_and_reason(self):
        self.clear()
        bars = self.bars()
        b = FakeBroker([], {'000660': 14750})
        self.assertEqual(self.cycle(b, [self.cand('000660', 'maCloudBreakout')], lambda c: bars), 'BUY_SENT')
        buy = [r for r in self.ledger_rows() if r['side'] == 'BUY'][-1]
        self.assertEqual(buy['reason'], 'ENTRY')
        note = json.loads(buy['note'])
        self.assertEqual((note['rank'], note['scanner'], note['scan_date'], note['base']), (1, 'maCloudBreakout', '2026-10-14', 14750))
        for key in ('traded_value_eok', 'avg_value_eok', 'volatility_penalty', 'trend_vs_20d'):
            self.assertIn(key, note['score'])

    def ledger_rows(self):
        with self.ledger.connect() as db:
            return [dict(r) for r in db.execute('SELECT * FROM intents ORDER BY id')]

    def test_rejection_reasons_are_recorded_and_counted(self):
        self.clear()
        good, thin, flat = self.bars(), self.bars(volume=10), self.bars(step=-30)
        daily = {'111111': good, '222222': thin, '333333': flat}
        b = FakeBroker([], {'111111': 16000})                          # 기준가(14750) +8.5% 갭 -> 진입 안 함
        rows = [self.cand('111111'), self.cand('222222'), self.cand('333333')]
        self.assertEqual(self.cycle(b, rows, lambda c: daily[c]), 'NO_CANDIDATE')
        self.cycle(b, rows, lambda c: daily[c])
        s = self.skips()
        self.assertIn(('222222', 'LOW_TRADED_VALUE'), s)
        self.assertIn(('333333', 'BELOW_20D_MEAN'), s)
        self.assertEqual(s[('111111', 'GAP_UP_OVER_2PCT')]['count'], 2)   # 같은 사유는 한 줄에 횟수만 올라간다
        self.assertEqual(b.buys, [])

    def test_rank_candidates_result_is_unchanged_by_rejection_logging(self):
        bars = self.bars()
        rows = [self.cand('000660'), self.cand('222222')]
        daily = lambda c: bars if c == '000660' else self.bars(volume=10)
        plain = le.rank_candidates(rows, daily, '2026-10-15')
        rejected = []
        logged = le.rank_candidates(rows, daily, '2026-10-15', rejected)
        self.assertEqual(plain, logged)
        self.assertEqual([r[:2] for r in rejected], [('222222', 'LOW_TRADED_VALUE')])

    def test_window_closed_is_recorded_once(self):
        from datetime import timedelta
        late = NOW.replace(hour=11, minute=0)
        b = FakeBroker([], {})
        for _ in range(3):
            le.trade_once(b, self.ledger, [], lambda c: [], self.dir, late)
        s = self.skips()
        self.assertEqual(s[('*', 'WINDOW_CLOSED')]['count'], 1)

    def test_slots_full_reason_is_recorded(self):
        with self.ledger.connect() as db:
            for code in ('000001', '000002', '000003'):
                db.execute("INSERT INTO positions(code,qty,state,buy_day,floor_reached) VALUES(?,1,'OPEN','2026-10-14',0)", (code,))
        held = [holding(c, 1, 1000, 1000) for c in ('000001', '000002', '000003')]
        b = FakeBroker(held, {c: 1000 for c in ('000001', '000002', '000003')})
        self.cycle(b)
        self.assertIn(('*', 'SLOTS_FULL'), self.skips())

    def test_excluded_candidate_is_recorded_as_excluded(self):
        self.clear()
        bars = self.bars()
        b = FakeBroker([], {'032640': 14750, '000660': 14750})
        self.cycle(b, [self.cand('032640'), self.cand('000660')], lambda c: bars)
        self.assertIn(('032640', 'EXCLUDED'), self.skips())


if __name__ == '__main__':
    unittest.main()
