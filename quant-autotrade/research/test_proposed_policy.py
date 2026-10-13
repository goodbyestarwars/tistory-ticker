import unittest

import proposed_policy as p


class ProposedPolicyTests(unittest.TestCase):
    def test_budget_reserve_and_duplicate(self):
        self.assertEqual(p.entry_won(1_000_000, 0, set(), 'A'), (300_000, None))
        self.assertEqual(p.entry_won(400_000, 600_000, {'A', 'B'}, 'C'), (300_000, None))
        self.assertEqual(p.entry_won(100_000, 900_000, {'A', 'B', 'C'}, 'D'), (0, 'MAX_POS'))
        self.assertEqual(p.entry_won(1_000_000, 300_000, {'A'}, 'A'), (0, 'DUP'))
        self.assertEqual(p.entry_won(1_000_000, 0, set(), 'A', {'A'}), (0, 'DUP'))

    def test_net_exit_and_indefinite_hold(self):
        self.assertEqual(p.simulated_exit(100, 95.0, None), 'NET_STOP')
        self.assertIsNone(p.simulated_exit(100, 105, None))
        self.assertEqual(p.simulated_exit(100, 110, None), 'SIM_TP_CAP')
        self.assertEqual(p.simulated_exit(100, 103, 0.04), 'SIM_TP_TRAIL')

    def test_selection_requires_all_data(self):
        a = dict(code='A', trading_value=10, liquidity=2, volatility_fit=3, trend=4)
        b = dict(code='B', trading_value=20, liquidity=1, volatility_fit=2, trend=3)
        self.assertEqual([x['code'] for x in p.rank_candidates([a, b, {'code': 'C'}])], ['B', 'A'])


if __name__ == '__main__':
    unittest.main()
