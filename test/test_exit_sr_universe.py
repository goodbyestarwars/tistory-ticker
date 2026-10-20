# -*- coding: utf-8 -*-
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts', 'research'))
import exit_sr_run_all as runall  # noqa: E402
import exit_sr_universe as uni  # noqa: E402
import exit_strategy_study as xs  # noqa: E402

CAL = ['2026-09-%02d' % d for d in (1, 2, 3, 4, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 28)]


def bars(fn, n=390):
    out, prev = [], None
    for i in range(n):
        m = 9 * 60 + i
        c = fn(i)
        o = prev if prev is not None else c
        out.append(['%02d%02d' % (m // 60, m % 60), o, max(o, c) * 1.0005, min(o, c) * 0.9995, c, 1000])
        prev = c
    return out


def write_daily(cache, code):
    rows = [[d, 100, 103 + (i % 3), 97 - (i % 4), 100 + (i % 5) - 2, 100000 + 1000 * i] for i, d in enumerate(CAL)]
    json.dump(rows, open(os.path.join(cache, code + '.json'), 'w'))


def setup(work, n_codes=8):
    cache = os.path.join(work, 'naver')
    mb = os.path.join(work, 'minbars')
    os.makedirs(cache)
    os.makedirs(mb)
    write_daily(cache, '005930')
    write_daily(cache, '069500')
    hits = []
    for k in range(n_codes):
        code = '%06d' % (100000 + k)
        write_daily(cache, code)
        scan = CAL[4 + k]
        nxt = CAL[CAL.index(scan) + 1]
        hits.append({'scanDate': scan, 'scanner': 'pattern:pullback', 'code': code, 'basePrice': 9000 if k == 4 else 10000, 'score': 80})   # k=4 는 시가가 기준가 +2% 이상
        if k == 0:
            hits.append({'scanDate': scan, 'scanner': 'pattern:doubleBottom', 'code': code, 'basePrice': 10000})   # 중복 포착
        fall = (lambda i: 10000 - max(0, i - 30) * 4) if k % 2 else (lambda i: 10000 + min(i, 60) * 3)
        days = CAL[CAL.index(nxt):CAL.index(nxt) + 4]
        for d in days:
            if k == 3 and d == days[1]:
                continue                                               # 분봉 누락
            json.dump({'code': code, 'day': d, 'bars': bars(fall)}, open(os.path.join(mb, '%s_%s.json' % (code, d)), 'w'))
    hits.append({'scanDate': CAL[5], 'scanner': 'pattern:lowRising', 'code': '100000', 'basePrice': 10000})      # 비핵심 검색기
    return cache, hits


class CollectTest(unittest.TestCase):
    def test_merge_sources_truncation_warning_and_failure_cause(self):
        calls = []

        def fake(api, scanner, **kw):
            calls.append(scanner)
            if scanner.endswith('doubleBottom'):
                raise TimeoutError('x')
            n = uni.PUBLIC_LIMIT if scanner.endswith('pullback') else 1
            return [{'scanDate': '2026-09-%02d' % (1 + i % 28), 'scanner': scanner, 'code': '%06d' % (i % 999 + 1), 'basePrice': 1} for i in range(n)]
        hits, rep = uni.collect_hits(api='http://x', fetcher=fake)
        self.assertEqual(len(calls), 4)
        self.assertTrue(rep['sources']['api:doubleBottom'].startswith('FAIL:TimeoutError'))
        self.assertTrue(any('상한' in w for w in rep['warnings']))
        self.assertTrue(all(h['scanner'] in uni.CORE for h in hits))


class PlanTest(unittest.TestCase):
    def test_duplicates_merged_non_core_excluded_with_counts(self):
        w = tempfile.mkdtemp()
        cache, hits = setup(w)
        norm = [dict(h, scanner=uni.norm_scanner(h['scanner'])) for h in hits]
        plans, ex = uni.plan_entries(norm, CAL, 4)
        self.assertEqual(ex['ENTRY_TIMING_UNVERIFIED(lowRising)'], 1)
        self.assertEqual(ex['DUPLICATE_MERGED'], 1)
        multi = [p for p in plans if len(p['scanners']) > 1]
        self.assertEqual(sorted(multi[0]['scanners']), ['doubleBottom', 'pullback'])


class UniverseRunTest(unittest.TestCase):
    def test_end_to_end_defers_when_sample_small_and_records_exclusions(self):
        w = tempfile.mkdtemp()
        cache, hits = setup(w)
        hf = os.path.join(w, 'hits.json')
        json.dump({'hits': hits}, open(hf, 'w'))
        status, text = runall.run_universe(w, w, cache, None, hf, 4)
        self.assertEqual(status, 'OK')
        out = os.path.join(w, 'out_universe')
        S = json.load(open(os.path.join(out, 'summary.json')))
        self.assertEqual(S['verdict']['conclusion'], '판정 보류')            # 표본 < 100건
        self.assertIn('MINUTE_BARS_MISSING_OR_HALTED_HOLD_DAY', S['exclusions']['path'])
        self.assertIn('GAP_UP_OVER_2PCT', S['exclusions']['path'])
        self.assertIn('A_cycle', S['rules'])
        self.assertTrue(all('status' in v for v in S['by_scanner'].values()))   # 검색기별 30건 미만
        self.assertIn('최종 판정: **판정 보류**', text)
        for need in ('RESULT_UNIVERSE.md', 'trades_abc.csv', 'hits_report.json'):
            self.assertTrue(os.path.exists(os.path.join(out, need)))

    def test_probe_minute_window_and_beyond_window_exclusion(self):
        w = tempfile.mkdtemp()
        have = set(CAL[-6:])

        def ensure(client, out, code, day):
            json.dump({'bars': [[1]] if day in have else []}, open(os.path.join(out, '%s_%s.json' % (code, day)), 'w'))
        os.makedirs(os.path.join(w, 'mb'))
        self.assertEqual(runall.probe_minute_window(None, os.path.join(w, 'mb'), CAL, ensure), CAL[-6])

    def test_slot_sim_limits_concurrency(self):
        entries = [{'entry_day': '2026-09-01', 'code': 'c%d' % i, 'rank_score': (10 - i, 0, 0, 0)} for i in range(5)]
        trades = [{'exit_day': '2026-09-02', 'exit_hhmm': '1000', 'net_pct': float(i), 'gross_pct': float(i), 'mfe_pct': 1.0, 'mae_pct': -1.0, 'reason': 'x',
                   'after_high_pct': 0.0, 'recovered': False, 'hold_days': 0, 'trigger_price': 1, 'exit_raw': 1} for i in range(5)]
        r = uni.slot_sim(entries, trades, 3)
        self.assertEqual((r['taken'], r['skipped_no_slot']), (3, 2))
        self.assertEqual(r['sum_net_pct'], 0.0 + 1.0 + 2.0)                # 순위 높은 앞 3개


class VerdictTest(unittest.TestCase):
    def mk(self, n, months, lo, mdd_b=10, worst_b=-5):
        mean = lambda m, d, w: {'n': n, 'mean': m, 'mdd': d, 'worst': w}
        return {'validation': {'n': n, 'months': months}, 'coverage': {'usable_pct': 90},
                'rules': {'A_cycle': {'valid': mean(0, 10, -5)}, 'B_SR_x': {'valid': mean(1, mdd_b, worst_b)}},
                'representatives': {'B_SR': 'B_SR_x', 'C_SR': None},
                'paired_valid_vs_A_cycle': {'B_SR_x': {'mean_diff': 1.0, 'lo': lo, 'hi': 2.0}}}

    def test_requires_samples_period_ci_and_no_risk_worsening(self):
        self.assertEqual(uni.verdict(self.mk(50, 4, 0.5))['conclusion'], '판정 보류')
        self.assertEqual(uni.verdict(self.mk(150, 2, 0.5))['conclusion'], '판정 보류')
        self.assertEqual(uni.verdict(self.mk(150, 4, -0.1))['conclusion'], 'A 유지')
        self.assertEqual(uni.verdict(self.mk(150, 4, 0.5, mdd_b=15))['conclusion'], 'A 유지')       # 평균은 좋아도 MDD 악화
        self.assertEqual(uni.verdict(self.mk(150, 4, 0.5, worst_b=-9))['conclusion'], 'A 유지')     # 최악 손실 악화
        self.assertEqual(uni.verdict(self.mk(150, 4, 0.5))['conclusion'], 'B_SR 연구상 우세')


if __name__ == '__main__':
    unittest.main()
