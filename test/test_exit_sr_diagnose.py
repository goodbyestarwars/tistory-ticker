# -*- coding: utf-8 -*-
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts', 'research'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import exit_sr_diagnose as dg  # noqa: E402
import exit_sr_run_all as runall  # noqa: E402
import test_exit_sr_universe as tu  # noqa: E402


class DiagnoseTest(unittest.TestCase):
    def setUp(self):
        self.w = tempfile.mkdtemp()
        cache, hits = tu.setup(self.w)
        hf = os.path.join(self.w, 'hits.json')
        json.dump({'hits': hits}, open(hf, 'w'))
        status, _ = runall.run_universe(self.w, self.w, cache, None, hf, 4)
        self.assertEqual(status, 'OK')

    def test_diagnose_reuses_outputs_and_writes_new_files_only(self):
        before = {f: os.path.getmtime(os.path.join(self.w, 'out_universe', f)) for f in os.listdir(os.path.join(self.w, 'out_universe'))}
        self.assertEqual(dg.main([self.w]), 0)
        out = os.path.join(self.w, 'out_diagnose')
        D = json.load(open(os.path.join(out, 'diagnose.json')))
        text = open(os.path.join(out, 'DIAGNOSIS.md'), encoding='utf-8').read()
        after = {f: os.path.getmtime(os.path.join(self.w, 'out_universe', f)) for f in os.listdir(os.path.join(self.w, 'out_universe'))}
        self.assertEqual(before, after)                                    # 기존 산출물은 수정하지 않는다
        cc = D['cost']['code_check']
        self.assertTrue(cc['net_equals_gross_minus_cost'] and cc['entry_fill_is_open_times_1_plus_buy_slip'] and cc['exit_fill_is_raw_times_1_minus_sell_slip'])
        self.assertAlmostEqual(cc['total_modeled_drag_pct_points'], 0.95)
        s = D['cost']['scenarios']['A_cycle']
        self.assertAlmostEqual(s['기존 가정(0.1/0.15/0.7)'], s['모델 net 평균(시뮬레이터 값)'], places=2)   # 시나리오 재계산이 시뮬레이터와 일치
        self.assertAlmostEqual(s['슬리피지만(0.1/0.15)'] - s['기존 가정(0.1/0.15/0.7)'], 0.7, places=2)
        self.assertIn('HOLD', D['distribution'])
        self.assertIn('MDD 주의', text)
        self.assertIn('질문별 답', text)
        self.assertEqual(D['subsets']['전체 포착 진입']['n'], D['entries'])
        self.assertLessEqual(D['subsets']['엔진 필터 통과']['n'], D['entries'])

    def test_helpers(self):
        self.assertAlmostEqual(dg.pct_pts([1, 2, 3, 4, 5])['p50'], 3)
        self.assertAlmostEqual(dg.scenario_net(0.0, 0.1, 0.15, 0.7), ((1 - 0.0015) / 1.001 - 1) * 100 - 0.7)
        d = dg.distribution([{'net_pct': x, 'reason': 'r'} for x in [-5, -1, 0.5, 1, 30, -2, 2, 3, 1, 0]])
        self.assertGreater(d['mean'], d['trimmed_mean_5pct'] - 100)
        self.assertEqual(d['wins'] + d['losses'], 10)


if __name__ == '__main__':
    unittest.main()
