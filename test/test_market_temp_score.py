# -*- coding: utf-8 -*-
"""증시온도 배점 이식 검증 - GAS 실제 응답을 고정해 두고 같은 입력에 같은 점수가
나오는지 확인한다(docs/BACKEND_CONSOLIDATION.md 1단계).

화면에 뜨는 숫자가 이식 때문에 달라지면 안 되므로, 컴포넌트별 점수와 최종 온도까지
전부 GAS 응답과 대조한다. fixture는 2026-08-31 장중 GAS `?marketTemp=1` 원본이다.
"""
import io
import json
import os
import sys
import unittest

CLOUD_VM_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
if CLOUD_VM_DIR not in sys.path:
    sys.path.insert(0, CLOUD_VM_DIR)

import market_temp_score as mts  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(__file__), 'fixtures', 'gas_market_temp_20260831.json')


def load_golden():
    with io.open(FIXTURE, encoding='utf-8') as fh:
        return json.load(fh)


class MarketTempScorePortTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gold = load_golden()
        cls.c = cls.gold['components']

    def test_component_budget_matches_gas(self):
        self.assertEqual(mts.COMPONENT_MAX, {
            'vix': 20, 'flow': 20, 'tradingValue': 15, 'avgChange': 15,
            'riseRatio': 10, 'sectorStrength': 10, 'week52': 10,
            'exchange': 5, 'usFutures': 5, 'creditRisk': 10,
        })

    def test_vix(self):
        g = self.c['vix']
        got = mts.score_vix(g['value'])
        self.assertEqual(got['score'], g['score'])
        self.assertEqual(got['band'], g['band'])

    def test_trading_value(self):
        g = self.c['tradingValue']
        # GAS는 avg5(직전 5일 평균)만 노출하므로 같은 평균이 나오는 이력으로 재구성한다.
        prior = [g['avg5']] * 5
        got = mts.score_trading_value(g['today'], prior)
        self.assertEqual(got['score'], g['score'])
        self.assertEqual(got['band'], g['band'])
        self.assertAlmostEqual(got['relative'], g['relative'], places=9)

    def test_avg_change(self):
        g = self.c['avgChange']
        got = mts.score_avg_change(g['avgChangeRate'], quote_count=233)
        self.assertEqual(got['score'], g['score'])
        self.assertEqual(got['band'], g['band'])

    def test_rise_ratio(self):
        g = self.c['riseRatio']
        got = mts.score_rise_ratio(g['up'], g['down'])
        self.assertEqual(got['score'], g['score'])
        self.assertEqual(got['band'], g['band'])
        self.assertAlmostEqual(got['ratio'], g['ratio'], places=9)

    def test_sector_strength(self):
        g = self.c['sectorStrength']
        got = mts.score_sector_strength(g['sectorCount'], g['strongCount'])
        self.assertEqual(got['score'], g['score'])
        self.assertEqual(got['band'], g['band'])

    def test_week52(self):
        g = self.c['week52']
        got = mts.score_week52(g.get('newHigh'), g.get('newLow'), g.get('scanned'))
        self.assertEqual(got['score'], g['score'])
        if 'band' in g:
            self.assertEqual(got['band'], g['band'])

    def test_exchange(self):
        g = self.c['exchange']
        if 'changeRate' not in g:
            self.skipTest('fixture에 환율 조회 실패가 담겨 있음')
        got = mts.score_exchange(g['changeRate'], g.get('price'))
        self.assertEqual(got['score'], g['score'])
        self.assertEqual(got['band'], g['band'])

    def test_us_futures(self):
        g = self.c['usFutures']
        if 'changePct' not in g:
            self.skipTest('fixture에 미국 선물 조회 실패가 담겨 있음')
        got = mts.score_us_futures(g['changePct'], g.get('price'), g.get('timeWeight'))
        self.assertEqual(got['score'], g['score'])
        self.assertEqual(got['band'], g['band'])

    def test_flow(self):
        g = self.c['flow']
        got = mts.score_flow(g['foreign']['score100'], g['inst']['score100'])
        self.assertEqual(got['score'], g['score'])
        self.assertEqual(got['band'], g['band'])

    def test_total_and_temperature_match_gas(self):
        """가장 중요한 검증 - 화면에 뜨는 점수와 온도가 그대로여야 한다."""
        credit = self.c['creditRisk']
        credit_available = bool(credit.get('available'))
        scores = [
            self.c['vix']['score'], self.c['flow']['score'], self.c['tradingValue']['score'],
            self.c['avgChange']['score'], self.c['riseRatio']['score'],
            self.c['sectorStrength']['score'], self.c['week52']['score'],
            self.c['exchange']['score'], self.c['usFutures']['score'],
        ]
        if credit_available:
            scores.append(credit['score'])
        got = mts.total_and_temperature(scores, credit_available)
        self.assertEqual(got['score'], self.gold['score'])
        self.assertEqual(got['maxScore'], self.gold['maxScore'])
        self.assertEqual(got['temp'], self.gold['temp'])

    def test_round_half_up_matches_js(self):
        """JS Math.round는 0.5를 항상 올린다. 파이썬 기본 round는 짝수로 붙어서 다르다."""
        self.assertEqual(mts._round_half_up(0.5), 1)
        self.assertEqual(mts._round_half_up(1.5), 2)
        self.assertEqual(mts._round_half_up(2.5), 3)   # 파이썬 기본 round면 2
        self.assertEqual(mts._round_half_up(2.45, 1), 2.5)


if __name__ == '__main__':
    unittest.main()
