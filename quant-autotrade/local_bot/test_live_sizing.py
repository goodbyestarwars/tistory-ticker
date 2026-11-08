# -*- coding: utf-8 -*-
"""슬롯형+위험한도 배분(live_sizing.py) 회귀 테스트. 기본값은 2026-10-22 규칙과 같은 수량이어야 한다."""
import os
import random
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import live_sizing as al  # noqa: E402
import live_engine as le  # noqa: E402


def old_qty(budget, reserve, price, cash, committed):
    slots = -(-budget // 1_000_000)
    per = (budget - reserve) // slots
    qty = min(per, cash - reserve, budget - reserve - committed) // price
    return 0 if qty < 1 or qty * price > per else qty


class PlanTests(unittest.TestCase):
    def test_auto_slots(self):
        self.assertEqual((al.plan(1_000_000, 100_000)['slots'], al.plan(1_000_000, 100_000)['per_stock']), (1, 900_000))
        self.assertEqual((al.plan(2_000_000, 100_000)['slots'], al.plan(2_000_000, 100_000)['per_stock']), (2, 950_000))
        self.assertEqual(al.plan(2_500_000, 100_000)['slots'], 3)

    def test_engine_constants_unchanged(self):
        self.assertEqual((le.MAX_STOCKS, le.PER_STOCK, le.SLOTS, le.RISK_PCT, le.CARRY), (1, 900_000, None, None, False))

    def test_bad_values_rejected(self):
        for args in [(0, 0), (100, 100), (1_000_000, 100_000, 0), (1_000_000, 100_000, 11),
                     (1_000_000, 100_000, None, 0), (1_000_000, 100_000, None, 10.5)]:
            with self.assertRaises(ValueError):
                al.plan(*args)


class SizeTests(unittest.TestCase):
    def test_default_matches_old_rule(self):
        rnd = random.Random(7)
        for _ in range(3000):
            budget = rnd.choice([1_000_000, 2_000_000, 3_000_000, 1_500_000])
            reserve = rnd.choice([0, 100_000])
            price = rnd.choice([1, 950, 12_340, 87_000, 450_000, 960_000, 1_200_000])
            cash = rnd.randint(0, budget * 2)
            committed = rnd.randint(0, budget)
            p = al.plan(budget, reserve)
            got = al.size_entry(p, price, cash, committed, 0)['qty']
            self.assertEqual(got, old_qty(budget, reserve, price, cash, committed), (budget, reserve, price, cash, committed))

    def test_one_share_over_slot_is_skipped(self):
        r = al.size_entry(al.plan(1_000_000, 100_000), 960_000, 1_000_000, 0, 0)
        self.assertEqual((r['qty'], r['reason'], r['limit']), (0, 'ONE_SHARE_OVER_LIMIT', 'slot'))

    def test_slots_full_and_unlimited(self):
        p = al.plan(2_000_000, 100_000)
        self.assertEqual(al.size_entry(p, 10_000, 2_000_000, 0, 2)['reason'], 'SLOTS_FULL')
        p['slots'] = None
        self.assertEqual(al.size_entry(p, 10_000, 2_000_000, 0, 5)['qty'], 95)

    def test_risk_limit_scales_with_range(self):
        p = al.plan(2_000_000, 100_000, risk_pct=2)          # 1회 최대 예상 손실 40,000원
        calm = al.size_entry(p, 10_000, 2_000_000, 0, 0, range_pct=3)   # 바닥 5% 적용 -> 80만 원
        wild = al.size_entry(p, 10_000, 2_000_000, 0, 0, range_pct=8)   # 8% -> 50만 원
        self.assertEqual((calm['qty'], calm['limit'], calm['move_pct']), (80, 'risk', 5.0))
        self.assertEqual((wild['qty'], wild['limit']), (50, 'risk'))
        self.assertLessEqual(wild['worst_loss'], p['risk_won'])

    def test_unknown_range_is_conservative(self):
        p = al.plan(2_000_000, 100_000, risk_pct=2)
        self.assertEqual(al.size_entry(p, 10_000, 2_000_000, 0, 0)['move_pct'], 8.0)
        self.assertIsNone(al.avg_range_pct([{'high': 1, 'low': 1, 'close': 1}] * 19))

    def test_carry_moves_unused_money_to_next_slot(self):
        p = al.plan(2_000_000, 100_000, carry=True)
        self.assertEqual(al.size_entry(p, 10_000, 1_500_000, 500_000, 1)['slot_cap'], 1_400_000)
        p['carry'] = False
        self.assertEqual(al.size_entry(p, 10_000, 1_500_000, 500_000, 1)['slot_cap'], 950_000)


if __name__ == '__main__':
    unittest.main()
