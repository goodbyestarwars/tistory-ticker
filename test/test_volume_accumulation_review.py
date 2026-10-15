# -*- coding: utf-8 -*-
"""PR #651 리뷰 보완 4건 재현 테스트 (2026-10-15): 장중 지지 이탈 / 순위권 밖 시세 보강 / 표본 부족 분배 위험 보류 / 감지가·스캔가 구분."""
import os
import re
import sys
import unittest
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_volume_accumulation as base  # noqa: E402

va, vs = base.va, base.vs


def tearDownModule():
    # 모듈 전역 상태(표본·감지·매집 기록)를 비워 다른 테스트 파일에 새지 않게 한다.
    vs._samples.clear()
    vs._prev_cache.clear()
    vs._accum.clear()
    vs._stats_cache.clear()
    vs._bars_cache.clear()
    vs._state.update({'date': None, 'detections': {}, 'updatedAt': None, 'error': None, 'polls': 0})
    vs.set_daily_loader(None)
ROOT = base.ROOT


class SupportBreakTests(unittest.TestCase):
    def test_live_price_below_accumulation_low_or_close_support_is_not_listed(self):
        d = base.daily_bars()
        self.assertIsNotNone(va.old_bar_signal(d, 10_400, None))                  # 지지 안쪽: 유지
        self.assertIsNone(va.old_bar_signal(d, 9_700, None))                      # 매집봉 저가 9,980의 2% 아래 이탈
        self.assertIsNone(va.old_bar_signal(d, 10_050, None))                     # 저가는 지켰지만 종가 10,500의 4% 아래
        self.assertEqual(va.old_bar_signal(d, 10_150, None)['stage'], 'SUPPORTED')


class OutOfRankQuoteTests(unittest.TestCase):
    def setUp(self):
        vs._samples.clear()
        vs._accum.clear()
        vs._state.update({'date': '2026-10-15', 'detections': {}, 'updatedAt': None, 'error': None, 'polls': 0})
        self.daily = base.daily_bars(last_close=10_300, last_vol=100_000)
        import pattern_detect
        match = pattern_detect.build_pattern_match({'code': '111111', 'name': '테스트'}, self.daily, va.daily_detail(va.old_bar_signal(self.daily)))
        vs.set_daily_loader(lambda: [match])
        self.calls = []

    def tearDown(self):
        vs.set_daily_loader(None)

    def run_poll(self, fetcher):
        t = base.NOW_T
        vs.process_rows([base.row('222222', 300_000, 5_000, 1.0)], t, '2026-10-15', lambda c: (1_000_000.0, '2026-10-14'),
                        stats_lookup=lambda c: None, bars_lookup=lambda c: self.daily, now_kst=base.NOW, quote_fetcher=fetcher)
        return [i for i in vs.get_payload(t + 1)['items'] if i['code'] == '111111']

    def test_candidate_outside_rank_is_refreshed_in_one_batch_from_existing_quote_source(self):
        def fetcher(codes):
            self.calls.append(list(codes))
            return [{'code': '111111', 'price': 10_600, 'changeRate': 3.0, 'volume': 300_000.0}]
        rows = self.run_poll(fetcher)
        self.assertEqual(self.calls, [['111111']])                                 # 후보를 한 번의 배치로(종목별 호출 없음)
        self.assertEqual(rows[0]['patternDetail']['signals'][0]['stage'], 'REBREAK')    # 장중 현재가·거래량으로 재돌파 판정

    def test_quote_below_support_removes_candidate_and_failure_falls_back_to_daily(self):
        rows = self.run_poll(lambda codes: [{'code': '111111', 'price': 9_500, 'changeRate': -5.0, 'volume': 300_000.0}])
        self.assertEqual(rows, [])
        vs._accum.clear()

        def broken(codes):
            raise RuntimeError('provider down')
        rows = self.run_poll(broken)
        self.assertEqual(len(rows), 1)                                              # 일봉 기준 유지, 오류로 죽지 않음


class PendingDistributionTests(unittest.TestCase):
    def test_too_few_bars_gives_pending_risk_not_low(self):
        s = [x for x in base.samples(base.ACC) if x[0] >= base.NOW_T - 9 * 60]
        sig = base.signal(s)
        self.assertIsNotNone(sig)
        if sig is not None:
            self.assertEqual(sig['distribution']['risk'], 'PENDING')
            self.assertEqual(sig['status'], 'pending')
        self.assertEqual(base.signal(base.samples(base.ACC))['distribution']['risk'], 'LOW')   # 표본이 충분하면 기존대로

    def test_pending_risk_ranks_between_low_and_mid_and_has_label(self):
        mk = lambda r: {'distribution': {'risk': r}}
        self.assertEqual(va.worst_risk([mk('LOW'), mk('PENDING')]), 'PENDING')
        self.assertEqual(va.worst_risk([mk('PENDING'), mk('MID')]), 'MID')
        self.assertEqual(va.RISK_TEXT['PENDING'], '판정 보류')
        self.assertIn('보류', va.interpretation_for([{'label': 'x'}], 'PENDING'))


class PriceBasisTests(unittest.TestCase):
    def setUp(self):
        TestCls = base.LiveIntegrationTests
        self.inner = TestCls('test_one_stock_meeting_both_conditions_is_one_row_with_both_signals')
        self.inner.setUp()

    def tearDown(self):
        self.inner.tearDown()

    def test_realtime_row_uses_detect_price_and_old_bar_only_row_uses_scan_price(self):
        last_t = self.inner.feed()
        vs._state['detections'].clear()                                            # 초기 급증 감지 없이 매집 신호만
        row = [i for i in vs.get_payload(last_t + 1)['items'] if i['code'] == '111111'][0]
        d = row['patternDetail']
        self.assertEqual(d['priceBasis'], 'DETECT')
        first = vs._accum['111111']['firstPrice']
        self.assertEqual(row['price'], first)                                       # 최초 감지 시점 가격, 지금 가격이 아님
        vs._accum['111111'].pop('realtime')
        row2 = [i for i in vs.get_payload(last_t + 1)['items'] if i['code'] == '111111'][0]
        self.assertEqual(row2['patternDetail']['priceBasis'], 'SCAN')
        self.assertEqual(row2['price'], vs._accum['111111']['meta']['price'])      # 일봉 스캔가
        self.assertEqual(va.daily_detail(va.old_bar_signal(base.daily_bars()))['priceBasis'], 'SCAN')

    def test_frontend_labels_follow_price_basis(self):
        js = open(os.path.join(ROOT, 'js', 'pattern-scan.js'), encoding='utf-8').read()
        self.assertIn("basis === 'DETECT'", js)
        self.assertIn('data-price-word', js)
        self.assertRegex(js, r"scanGapHtml\(Number\(live\.price\), scanPrice, quote\.getAttribute\('data-scan-date'\), quote\.getAttribute\('data-price-word'\)\)")


if __name__ == '__main__':
    unittest.main()
