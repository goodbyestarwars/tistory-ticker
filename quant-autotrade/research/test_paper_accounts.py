# -*- coding: utf-8 -*-
"""모의 계좌(자산곡선·당일 재투입) 테스트: 한도 점유, 오전 손절 후 같은 날 재투입, 미체결 대금·소급 사용 금지, 미실현 손실 MDD, 재실행 멱등."""
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import account_sim as sim  # noqa: E402
import allocation as al  # noqa: E402
import candidate_gen as cg  # noqa: E402
import paper_exits as pe  # noqa: E402
from test_paper_exits import walk  # noqa: E402
from test_paper_settle import seed_candidate  # noqa: E402

DAYS = ['2026-10-%02d' % d for d in range(12, 24)]


def cand(code, entry='2026-10-13', px=100.0, exit_date=None, net=None, klass=None, status='OPEN', score=90.0):
    return {'key': code, 'code': code, 'score': score, 'entry_date': entry, 'entry_price': px, 'exit_date': exit_date, 'net': net,
            'exit_class': klass, 'status': status}


def flat_prices(overrides=None, level=100.0):
    over = overrides or {}
    return lambda code, d: over.get((code, d), level)


class AllocationTests(unittest.TestCase):
    def test_limits_and_occupancy(self):
        held = {'A', 'B', 'C'}
        # 미청산 3종목이 투자 한도 30%를 모두 사용 -> 현금이 70% 있어도 신규 매수 불가
        self.assertEqual(al.entry_size(1.0, 0.70, 0.30, 3, held, 'D'), (0.0, 'CASH_OR_CAP'))
        self.assertEqual(al.entry_size(1.0, 0.95, 0.10, 5, {'A', 'B', 'C', 'D', 'E'}, 'F'), (0.0, 'MAX_POS'))
        self.assertEqual(al.entry_size(1.0, 0.95, 0.10, 1, {'A'}, 'A'), (0.0, 'DUP'))
        size, reason = al.entry_size(1.0, 0.95, 0.10, 1, {'A'}, 'B')
        self.assertEqual((round(size, 6), reason), (0.10, None))

    def test_broker_available_cash_is_never_exceeded(self):
        size, reason = al.entry_size(1.0, 0.95, 0.0, 0, set(), 'A', broker_cash=0.04)
        self.assertEqual((size, reason), (0.04, None))                     # 주문가능금액 4%까지만
        self.assertEqual(al.entry_size(1.0, 0.95, 0.0, 0, set(), 'A', broker_cash=0.005), (0.0, 'BROKER_CASH'))


class SameDayReuseTests(unittest.TestCase):
    def three_open_then_new(self, stop_class, stop_net=-0.03):
        # A·B·C 는 10-13 시가에 진입해 투자 한도 30%를 모두 쓴다. A 는 10-14 에 청산. 새 후보 D 의 시가 진입일도 10-14(한도 때문에 못 산다).
        a = cand('A', exit_date='2026-10-14', net=stop_net, klass=stop_class, status='CLOSED')
        b, c = cand('B'), cand('C')
        d = cand('D', entry='2026-10-14', score=80.0)

        def alt(x):
            if x['code'] != 'D':
                return None
            return cand('D', entry='2026-10-14', px=100.0 * 1.002, exit_date=None, status='OPEN', score=80.0)
        return [a, b, c, d], alt

    def test_morning_stop_then_buy_new_stock_same_day(self):
        cands, alt = self.three_open_then_new('intraday')
        r = sim.simulate_account(cands, DAYS, flat_prices(), alt, 'sameDay')
        self.assertEqual(r['reuseBuys'], 1)                                # 같은 날(장 마감) 재투입
        self.assertEqual(r['taken'], 4)                                    # A·B·C + D
        cons = sim.simulate_account(cands, DAYS, flat_prices(), alt, 'conservative')
        self.assertEqual(cons['reuseBuys'], 0)
        self.assertEqual(cons['taken'], 3)                                 # 보수적 가정: D 는 한도에 막혀 매수되지 않음
        self.assertGreaterEqual(cons['rejected']['CASH_OR_CAP'], 1)

    def test_signal_exit_at_open_funds_a_same_day_close_buy(self):
        cands, alt = self.three_open_then_new('open', stop_net=0.04)
        self.assertEqual(sim.simulate_account(cands, DAYS, flat_prices(), alt, 'sameDay')['reuseBuys'], 1)

    def test_close_exit_proceeds_are_not_reused_same_day(self):
        # 최대 보유일 종가 청산은 종가 매수와 동시 -> 선후 불명이므로 같은 날 재투입 불가
        cands, alt = self.three_open_then_new('close')
        r = sim.simulate_account(cands, DAYS, flat_prices(), alt, 'sameDay')
        self.assertEqual(r['reuseBuys'], 0)
        self.assertEqual(r['taken'], 3)

    def test_proceeds_are_not_used_before_the_sale_fills(self):
        # A 는 청산 신호만 났고 체결 전(PENDING_EXIT): 한도·자리를 점유하고 예상 대금은 현금이 아니다
        a = cand('A', status='PENDING_EXIT')
        b, c = cand('B'), cand('C')
        d = cand('D', entry='2026-10-14', score=80.0)
        for scenario in ('conservative', 'sameDay'):
            r = sim.simulate_account([a, b, c, d], DAYS, flat_prices(), lambda x: cand('D', entry='2026-10-14', px=100.2) if x['code'] == 'D' else None, scenario)
            self.assertEqual(r['taken'], 3, scenario)                      # D 는 사지 못한다
            self.assertEqual(r['pendingExit'], 1, scenario)
            self.assertGreaterEqual(r['rejected']['CASH_OR_CAP'], 1, scenario)

    def test_same_day_exit_never_funds_an_open_entry(self):
        # 같은 날 시가 매수에 같은 날 매도 대금(오후 매도 포함)을 쓰면 안 된다 - 어느 시나리오에서도
        a = cand('A', exit_date='2026-10-14', net=0.05, klass='intraday', status='CLOSED')
        others = [cand(x) for x in 'BC']
        d = cand('D', entry='2026-10-14', score=80.0)
        for scenario in ('conservative', 'sameDay'):
            r = sim.simulate_account([a] + others + [d], DAYS, flat_prices(), None, scenario)
            self.assertEqual(r['taken'], 3, scenario)

    def test_sale_after_the_buy_time_cannot_be_used_retroactively(self):
        # E 의 신호 청산은 10-15 시가이지만, 10-14 에 못 산 D 는 10-14 종가에만 재투입 대상이다. 10-15 청산 대금으로 10-14 에 살 수는 없다.
        e = cand('E', exit_date='2026-10-15', net=0.02, klass='open', status='CLOSED')
        b, c = cand('B'), cand('C')
        d = cand('D', entry='2026-10-14', score=80.0)
        r = sim.simulate_account([e, b, c, d], DAYS, flat_prices(), lambda x: cand('D', entry='2026-10-14', px=100.2) if x['code'] == 'D' else None, 'sameDay')
        self.assertEqual(r['reuseBuys'], 0)
        self.assertEqual(r['taken'], 3)


class EquityCurveTests(unittest.TestCase):
    def test_unrealized_loss_creates_mdd_before_the_exit(self):
        # 10-13 진입(100) → 종가 95, 90 으로 하락(미실현) → 10-17 에 92 에서 청산(순 -8%). 종목당 10% 투입.
        prices = {('A', '2026-10-13'): 95.0, ('A', '2026-10-14'): 90.0, ('A', '2026-10-15'): 91.0, ('A', '2026-10-16'): 92.0, ('A', '2026-10-17'): 92.0}
        a = cand('A', exit_date='2026-10-17', net=-0.08, klass='open', status='CLOSED')
        r = sim.simulate_account([a], DAYS, flat_prices(prices), None, 'conservative', keep_curve=True)
        self.assertTrue(r['mddExact'])
        self.assertAlmostEqual(r['mdd'], -0.10 * 0.10, places=6)           # 10% 비중 × -10% = -1.0% (실현 기준이면 -0.8%로 보였을 것)
        self.assertAlmostEqual(r['cumRet'], -0.10 * 0.08, places=6)
        curve = dict(r['curve'])
        self.assertAlmostEqual(curve['2026-10-14'], 1 - 0.10 * 0.10, places=6)   # 청산 전에도 평가손실이 곡선에 반영됨

    def test_missing_prices_mean_mdd_is_not_presented_as_exact(self):
        a = cand('A', exit_date='2026-10-17', net=0.01, klass='open', status='CLOSED')
        r = sim.simulate_account([a], DAYS, lambda code, d: None if d == '2026-10-15' else 100.0, None, 'conservative')
        self.assertFalse(r['mddExact'])
        self.assertIsNone(r['mdd'])
        self.assertIsNotNone(r['mddApprox'])
        self.assertGreater(r['missingMarks'], 0)

    def test_cumulative_return_follows_the_dated_equity_curve_including_open_positions(self):
        prices = {('A', d): 110.0 for d in DAYS if d >= '2026-10-14'}
        a = cand('A')                                                       # 청산 전 → 미실현 +10% × 10% 비중
        r = sim.simulate_account([a], DAYS, flat_prices(prices), None, 'conservative')
        self.assertAlmostEqual(r['cumRet'], 0.10 * 0.10, places=6)
        self.assertEqual(r['openPositions'], 1)
        self.assertEqual(r['closed'], 0)


class IdempotencyTests(unittest.TestCase):
    def test_repeated_runs_do_not_duplicate_records_or_returns(self):
        tmp = tempfile.mkdtemp()
        conn = cg.connect(os.path.join(tmp, 'r.db'))
        daily = walk(21, n=300, vol=0.03)
        scan_idx = 60
        daily[scan_idx + 1]['open'] = daily[scan_idx]['close']
        seed_candidate(conn, daily[scan_idx]['date'], base=daily[scan_idx]['close'])
        snaps = []
        for k in range(4):
            cg.paper_enter(conn, lambda c: daily, '2027-01-0%d' % (k + 1))
            cg.paper_settle(conn, lambda c: daily, '2027-01-0%d' % (k + 1))
            snaps.append((conn.execute('SELECT * FROM paper_trades ORDER BY variant').fetchall(), conn.execute('SELECT COUNT(*) FROM paper_bars').fetchone()[0],
                          repr(cg.paper_portfolios(conn))))
        self.assertTrue(all(s[0][0][:8] == snaps[0][0][0][:8] for s in snaps))
        self.assertEqual(snaps[1:], [snaps[1]] * 3)                          # 두 번째 실행부터 기록·봉 수·계좌 결과가 완전히 같다
        self.assertEqual(len(snaps[0][0]), 3)
        conn.close()

    def test_sameday_scenario_uses_real_close_entry_engine(self):
        daily = walk(33, n=200, vol=0.02)
        r_open = pe.evaluate(daily, 60, 'atr_close', 'open')
        r_close = pe.evaluate(daily, 60, 'atr_close', 'close')
        self.assertEqual(r_close['entry_date'], r_open['entry_date'])
        self.assertAlmostEqual(r_close['entry_price'], daily[61]['close'] * (1 + pe.ENTRY_SLIP))
        if r_close['status'] == 'CLOSED':
            self.assertGreater(r_close['exit_date'], r_close['entry_date'])      # 종가 매수는 다음 봉부터 청산 가능


if __name__ == '__main__':
    unittest.main()
