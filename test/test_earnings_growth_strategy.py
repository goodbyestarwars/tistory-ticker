# -*- coding: utf-8 -*-
"""Regression tests for the earnings-growth/low-debt strategy (DART cache only)."""
import copy
import sys
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/cloud-vm'))
import strategy_scan  # noqa: E402

TODAY = date(2026, 10, 26)


def financial_entry():
    return {
        'annual': {'years': [
            {'year': 2023, 'revenue': 100, 'operating_income': 10, 'debt_ratio_pct': 70},
            {'year': 2024, 'revenue': 120, 'operating_income': 14, 'debt_ratio_pct': 75},
            {'year': 2025, 'revenue': 140, 'operating_income': 20,
             'debt_ratio_pct': 80, 'roe_pct': 12},
        ]},
        'latest_quarter': {
            'year': 2026, 'reprt_code': '11012', 'amount_basis': 'standalone_3m',
            'revenue': 60, 'operating_income': 8,
            'revenue_yoy_pct': 15, 'operating_income_yoy_pct': 25,
        },
        'disclosure': {'status': 'ok'},
    }


class EarningsGrowthSignalTests(unittest.TestCase):
    def assert_rejected(self, transform):
        entry = financial_entry()
        transform(entry)
        self.assertIsNone(strategy_scan.earnings_growth_signal(entry, as_of=TODAY))

    def test_growth_with_low_debt_and_recent_quarter_passes(self):
        entry = financial_entry()
        original = copy.deepcopy(entry)
        s = strategy_scan.earnings_growth_signal(entry, as_of=TODAY)
        self.assertEqual(s['debtRatio'], 80)
        self.assertEqual(s['annualYears'], [2023, 2024, 2025])
        self.assertEqual(s['latestQuarter'], '2026년 2분기')
        self.assertEqual(s['latestQuarterOperatingIncomeYoYPct'], 25)
        self.assertGreater(s['annualRevenueYoYPct'], 0)
        self.assertEqual(entry, original)

    def test_allow_debt_at_boundary(self):
        entry = financial_entry()
        entry['annual']['years'][-1]['debt_ratio_pct'] = 100
        self.assertIsNotNone(strategy_scan.earnings_growth_signal(entry, as_of=TODAY))

    def test_annual_growth_must_be_strict_and_consecutive(self):
        self.assert_rejected(lambda e: e['annual']['years'][1].update(revenue=100))
        self.assert_rejected(lambda e: e['annual']['years'][1].update(operating_income=9))
        self.assert_rejected(lambda e: e['annual']['years'][2].update(operating_income=0))
        self.assert_rejected(lambda e: e['annual']['years'][1].update(year=2022))
        self.assert_rejected(lambda e: e['annual']['years'][2].update(year=2024))
        self.assert_rejected(lambda e: e['annual']['years'][2].update(revenue=None))
        self.assert_rejected(lambda e: e['annual']['years'][2].update(operating_income=float('nan')))

    def test_debt_must_be_finite_known_and_below_limit(self):
        for debt in (100.01, 201, -1, None, float('inf'), float('nan'), 'unknown'):
            with self.subTest(debt=debt):
                self.assert_rejected(lambda e: e['annual']['years'][-1].update(debt_ratio_pct=debt))

    def test_latest_quarter_must_have_growth_and_positive_operating_profit(self):
        self.assert_rejected(lambda e: e['latest_quarter'].update(revenue_yoy_pct=0))
        self.assert_rejected(lambda e: e['latest_quarter'].update(operating_income_yoy_pct=-1))
        self.assert_rejected(lambda e: e['latest_quarter'].update(operating_income=0))
        self.assert_rejected(lambda e: e['latest_quarter'].update(revenue=None))
        self.assert_rejected(lambda e: e['latest_quarter'].update(operating_income_yoy_pct=float('nan')))
        self.assert_rejected(lambda e: e['latest_quarter'].update(amount_basis='ytd'))
        self.assert_rejected(lambda e: e['latest_quarter'].update(reprt_code='11013'))
        self.assert_rejected(lambda e: e['latest_quarter'].update(year=2025))
        self.assert_rejected(lambda e: e['latest_quarter'].update(year=2027))
        self.assert_rejected(lambda e: e['disclosure'].update(status='pending'))

    def test_fiscal_year_stale_after_reporting_deadline(self):
        self.assert_rejected(lambda e: e['annual']['years'][-1].update(year=2024))


class EarningsGrowthScanTests(unittest.TestCase):
    @staticmethod
    def daily():
        return [{'date': '2026-10-23', 'close': 10000} for _ in range(125)]

    def test_scan_reuses_cache_excludes_financial_etf_and_orders_by_op_growth(self):
        universe = [
            {'code': '000001', 'name': '산업A'},
            {'code': '000002', 'name': '산업B'},
            {'code': '000003', 'name': '은행C'},
            {'code': '000004', 'name': 'ETF D', 'is_etf': True},
        ]
        wics = {
            '000001': {'sector': 'IT', 'industry': 'IT'},
            '000002': {'sector': 'IT', 'industry': 'IT'},
            '000003': {'sector': '금융', 'industry': '은행'},
            '000004': {'sector': 'IT', 'industry': 'IT'},
        }
        cache = {s['code']: financial_entry() for s in universe}
        cache['000001']['latest_quarter']['operating_income_yoy_pct'] = 5
        cache['000002']['latest_quarter']['operating_income_yoy_pct'] = 25
        daily_cache = {s['code']: self.daily() for s in universe}
        with patch.object(strategy_scan.pattern_detect, 'is_excluded_stock', return_value=False), \
             patch.object(strategy_scan.pattern_detect, 'is_etf_name', return_value=False), \
             patch.object(strategy_scan.pattern_detect, 'compute_volume_multiple',
                          return_value={'avg20': 2_000_000_000}), \
             patch.object(strategy_scan.db_schema, 'load_daily_prices',
                          side_effect=AssertionError('must reuse supplied cache')):
            groups, scanned = strategy_scan.scan_earnings_growth(
                universe, wics, cache, None, daily_cache=daily_cache, as_of=TODAY)
        self.assertEqual(scanned, 2)
        self.assertEqual([m['code'] for m in groups['IT']], ['000002', '000001'])
        self.assertEqual(groups['IT'][0]['latestQuarterRevenueYoYPct'], 15)
        self.assertEqual(list(groups), ['IT'])

    def test_missing_liquidity_does_not_get_promoted(self):
        universe = [{'code': '000001', 'name': '산업A'}]
        with patch.object(strategy_scan.pattern_detect, 'is_excluded_stock', return_value=False), \
             patch.object(strategy_scan.pattern_detect, 'is_etf_name', return_value=False), \
             patch.object(strategy_scan.pattern_detect, 'compute_volume_multiple',
                          return_value={'avg20': 200_000_000}):
            groups, scanned = strategy_scan.scan_earnings_growth(
                universe, {'000001': {'sector': 'IT'}}, {'000001': financial_entry()}, None,
                daily_cache={'000001': self.daily()}, as_of=TODAY)
        self.assertEqual((groups, scanned), ({}, 0))


if __name__ == '__main__':
    unittest.main()
