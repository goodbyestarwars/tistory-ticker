"""Read-only regressions: day trade > swing > long-term candidate priority.

Only pure ranking functions are called; no credentials, broker, or order APIs.
"""
import unittest

from live_engine import BUDGET, MAX_STOCKS, PER_STOCK, RESERVE, candidate_priority, rank_candidates


SCAN_DAY = '2026-10-23'
TODAY = '2026-10-26'


def row(code, scanner):
    return {'code': code, 'scanner': scanner, 'scan_date': SCAN_DAY, 'status': 'NEW'}


def daily(volume=200_000, spread=0.04):
    """21 finished bars, >10e8 KRW daily traded value, positive 20-day trend."""
    dates = ['2026-09-%02d' % n for n in range(1, 21)] + [SCAN_DAY]
    bars = []
    for index, date in enumerate(dates):
        close = 10_300 if index == 20 else 10_000
        bars.append({'date': date, 'close': close,
                     'high': close * (1 + spread / 2),
                     'low': close * (1 - spread / 2),
                     'volume': volume})
    return bars


class GroupPriorityTest(unittest.TestCase):
    def test_group_contract_and_budget_unchanged(self):
        self.assertEqual(candidate_priority('pullback'), (2, 'SWING'))
        self.assertEqual(candidate_priority('doubleBottom'), (2, 'SWING'))
        self.assertEqual(candidate_priority('invHeadShoulders'), (2, 'SWING'))
        self.assertEqual(candidate_priority('maCloudBreakout'), (1, 'LONG_TECHNICAL'))
        self.assertEqual(candidate_priority('unapprovedScanner'), (0, 'UNCLASSIFIED'))
        self.assertEqual((BUDGET, RESERVE, MAX_STOCKS, PER_STOCK),
                         (1_000_000, 100_000, 1, 900_000))

    def test_swing_precedes_high_liquidity_long_candidate(self):
        rows = [row('000001', 'maCloudBreakout'), row('000002', 'pullback')]
        bars = {'000001': daily(800_000), '000002': daily(200_000)}
        result = rank_candidates(rows, lambda code: bars[code], TODAY, with_origin=True)
        self.assertEqual([r[1] for r in result], ['000002', '000001'])
        self.assertEqual([r[5] for r in result], ['SWING', 'LONG_TECHNICAL'])

    def test_same_tier_preserves_previous_liquidity_score_order(self):
        rows = [row('000001', 'doubleBottom'), row('000002', 'pullback')]
        bars = {'000001': daily(200_000), '000002': daily(500_000)}
        result = rank_candidates(rows, lambda code: bars[code], TODAY)
        self.assertEqual([r[1] for r in result], ['000002', '000001'])
        self.assertEqual(len(result[0]), 4, 'existing result tuple contract')

    def test_cross_group_duplicate_has_one_swing_entry_with_correct_origin(self):
        rows = [row('000001', 'maCloudBreakout'), row('000001', 'doubleBottom')]
        result = rank_candidates(rows, lambda code: daily(), TODAY, with_origin=True)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0][4:], ('doubleBottom', 'SWING'))

    def test_unknown_scanner_fails_closed_before_daily_request(self):
        rejected = []
        def fail_daily(code):
            raise AssertionError('unclassified scanner must not trigger quote fetch')
        result = rank_candidates([row('000001', 'unknown')], fail_daily, TODAY, rejected)
        self.assertEqual(result, [])
        self.assertEqual(rejected[0][1], 'UNCLASSIFIED_SCANNER')

    def test_existing_liquidity_gate_is_not_weakened_for_swing(self):
        rows = [row('000001', 'pullback'), row('000002', 'maCloudBreakout')]
        rejected = []
        bars = {'000001': daily(10_000), '000002': daily(200_000)}
        result = rank_candidates(rows, lambda code: bars[code], TODAY, rejected, with_origin=True)
        self.assertEqual([r[1] for r in result], ['000002'])
        self.assertEqual(rejected[0][1], 'LOW_TRADED_VALUE')

    def test_no_candidate_when_only_incomplete_bars(self):
        rejected = []
        result = rank_candidates([row('000001', 'pullback')], lambda code: daily()[:20], TODAY, rejected)
        self.assertEqual(result, [])
        self.assertEqual(rejected[0][1], 'BARS_UNAVAILABLE')


if __name__ == '__main__':
    unittest.main()
