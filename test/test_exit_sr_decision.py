# -*- coding: utf-8 -*-
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts', 'research'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import exit_sr_decision as dc  # noqa: E402
import exit_sr_run_all as runall  # noqa: E402
import test_exit_sr_universe as tu  # noqa: E402


def extend_daily(work):
    """진입 전 20거래일 이상의 이력이 있어야 변수가 계산된다 - 합성 일봉 앞쪽에 과거 행을 붙인다."""
    cache = os.path.join(work, 'naver')
    pre = ['2026-07-%02d' % d for d in range(1, 29)]
    for f in os.listdir(cache):
        p = os.path.join(cache, f)
        rows = json.load(open(p))
        k = 0 if f.startswith('005930') or f.startswith('069500') else 1
        old = [[d, 100, 104 + (i % 3) * k, 96, 100 + (i % 5) - 2, 100000 + 1000 * i * (1 + k)] for i, d in enumerate(pre)]
        json.dump(old + rows, open(p, 'w'))


class DecisionTest(unittest.TestCase):
    def setUp(self):
        self.w = tempfile.mkdtemp()
        cache, hits = tu.setup(self.w)
        extend_daily(self.w)
        hf = os.path.join(self.w, 'hits.json')
        json.dump({'hits': hits}, open(hf, 'w'))
        status, _ = runall.run_universe(self.w, self.w, cache, None, hf, 4)
        self.assertEqual(status, 'OK')

    def test_features_use_only_data_through_scan_date(self):
        entry = {'scan_date': '2026-09-04', 'entry_day': '2026-09-07', 'path': [('2026-09-07', '0901', 100.0, 101, 99, 100, 10)]}
        base = [{'date': '2026-07-%02d' % d, 'open': 100, 'high': 104, 'low': 96, 'close': 100 + d % 3, 'volume': 1000 + d} for d in range(1, 29)]
        base += [{'date': '2026-09-04', 'open': 100, 'high': 103, 'low': 98, 'close': 101, 'volume': 5000}]
        f1 = dc.features(entry, base)
        future = base + [{'date': '2026-09-07', 'open': 1, 'high': 9999, 'low': 1, 'close': 9999, 'volume': 9 ** 9}]
        self.assertEqual(f1, dc.features(entry, future))              # scan_date 이후 행은 결과에 영향이 없다
        self.assertIsNone(dc.features(entry, base[-5:]))               # 이력이 부족하면 점수를 만들지 않는다

    def test_top_n_per_day_excludes_missing_and_breaks_ties_by_code(self):
        entries = [{'entry_day': 'd1', 'code': c} for c in 'cabd'] + [{'entry_day': 'd2', 'code': 'z'}]
        score = {0: 1.0, 1: 1.0, 2: 1.0, 3: None, 4: 5.0}
        picked = dc.top_n(entries, range(5), score, 2)
        self.assertEqual([entries[i]['code'] for i in picked], ['a', 'b', 'z'])

    def test_end_to_end_report_defers_and_fixes_choice_on_train_only(self):
        self.assertEqual(dc.main([self.w]), 0)
        out = os.path.join(self.w, 'out_decision')
        self.assertEqual(sorted(os.listdir(out)), ['SCANNER_EXIT_DECISION.md', 'decision.json'])   # 보고서 하나 + 수치 원본
        D = json.load(open(os.path.join(out, 'decision.json')))
        text = open(os.path.join(out, 'SCANNER_EXIT_DECISION.md'), encoding='utf-8').read()
        self.assertTrue(text.split('\\n', 1)[0].startswith('# 검색기 고수익'))
        self.assertIn('| 검색기 | 검증 진입 | 기존 상위3 +5% 적중률 | 개선 상위3 +5% 적중률', text)
        self.assertIn('판정 보류', text)
        self.assertIn('거래일 이상', text)
        if D['chosen']:
            self.assertIn(D['chosen'], dc.CAND)
            mfe = {k: v['mean_mfe'] for k, v in D['train_candidate_stats'].items() if k != 'E_engine_rank' and v.get('n')}
            self.assertEqual(D['chosen'], max(mfe, key=mfe.get))      # 선택은 학습 구간 통계로만 결정
        for st in D['train_candidate_stats'].values():
            self.assertLessEqual(st.get('n', 0), 5 * D['train_days'])
        self.assertFalse(os.path.exists(os.path.join(self.w, 'out_diagnose')))   # 다른 보고서를 만들지 않는다

    def test_render_blocks_exit_verdict_when_simulator_not_reproducing(self):
        self.assertEqual(dc.main([self.w]), 0)
        D = json.load(open(os.path.join(self.w, 'out_decision', 'decision.json')))
        D['realism'] = {'compared': 12, 'variants': {}, 'rows': [], 'best_agreement': {'reason_match_rate': 0.25, 'within_3min_rate': 0.17}, 'reproduces_engine': False}
        text = dc.render(D)
        self.assertIn('우열 판정 보류', text)
        self.assertIn('재현하지 못함', text)

    def test_gain_ci_needs_days(self):
        entries = [{'entry_day': 'd1'}, {'entry_day': 'd1'}]
        self.assertIsNone(dc.hit_gain_ci(entries, [0], [1], [(6, 0), (1, 0)]))


if __name__ == '__main__':
    unittest.main()
