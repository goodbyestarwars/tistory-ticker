# -*- coding: utf-8 -*-
"""'박스권 하단 반등' 개선 테스트 (2026-10-15): 박스폭 5~10%, 흘러내리는 박스·반복 이탈 제외, 지지 신뢰도, 손익비. 합성 데이터만 사용."""
import os
import sys
import unittest
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'scripts', 'cloud-vm'))
import pattern_detect as pd  # noqa: E402

FRACTIONS = [0.33, 1.0, 0.0, 0.67, 0.17]


def box(width_pct, last='rebound', touch_every=True, drift=0.0, dip_bars=(), last_dip=False, base=10000.0):
    """40봉(이평선 계산용 앞부분 포함, 마지막 20봉이 박스). 종가가 5봉 주기로 박스 하단(0)~상단(1) 사이를 오가며 박스폭이 width_pct(%)가 되게 만든다.
    last='rebound': 하단 테스트 뒤 양봉 회복(거래량 1.3배) / 'approach': 하단에서 음봉으로 끝남."""
    h = base * width_pct / 100.0
    out, start = [], date(2026, 1, 1)
    for i in range(40):
        seg = max(0, (i - 20) // 5)
        shift = -base * drift * seg
        close = base + FRACTIONS[i % 5] * h + shift
        wick = 0.01 * base if touch_every else 0.0
        row = {'date': (start + timedelta(days=i)).isoformat(), 'open': close - 0.001 * base, 'high': close + wick, 'low': close - wick, 'close': close, 'volume': 100}
        out.append(row)
    for idx in dip_bars:
        out[idx]['low'] = base * 0.97 + (out[idx]['close'] - base)
    b = min(r['close'] for r in out[-20:-1])
    if last == 'rebound':
        out[-1].update(open=b * 0.998, low=b * 0.995, close=b + 0.05 * h, high=b + 0.07 * h, volume=130)
    else:
        out[-1].update(open=b + 0.02 * h, high=b + 0.03 * h, low=b * 0.995, close=b, volume=100)
    if last_dip:
        out[-1]['low'] = base * 0.97
    return out


def detect(daily):
    return pd.detect_box_range_low(daily, market_cap_eok=3000, require_market_cap=True)


class WidthTests(unittest.TestCase):
    def test_width_4_9_is_excluded_5_0_passes(self):
        self.assertIsNone(detect(box(4.9)))
        self.assertIsNotNone(detect(box(5.0)))                       # 경계값 포함

    def test_width_8_and_10_pass_and_10_1_is_excluded(self):
        self.assertIsNotNone(detect(box(8.0)))
        self.assertIsNotNone(detect(box(10.0)))                      # 경계값 포함(부동소수 오차 허용)
        self.assertIsNone(detect(box(10.1)))

    def test_width_formula_is_top_minus_bottom_over_bottom(self):
        r = detect(box(7.0))
        self.assertAlmostEqual(r['criteria']['boxWidthPct'], 7.0, places=6)
        self.assertEqual((r['criteria']['boxTop'], r['criteria']['boxBottom']), (r['resistance'], r['support']))


class TrendTests(unittest.TestCase):
    def test_stair_step_falling_box_is_excluded_but_flat_control_passes(self):
        self.assertIsNotNone(detect(box(6.0)))
        falling = box(6.0, drift=0.008)                              # 5봉 구간마다 저점·고점이 0.8%씩 낮아짐(20일선 기울기는 -1% 이내)
        lows = [r['low'] for r in falling[-20:]]
        highs = [r['high'] for r in falling[-20:]]
        self.assertTrue(pd._box_staircase_down(lows, highs))
        self.assertIsNone(detect(falling))

    def test_ma20_decline_limit_is_one_percent(self):
        self.assertEqual(pd.BOX_MAX_MA20_DECLINE_10D, 0.01)

    def test_repeated_breach_below_box_bottom_is_excluded(self):
        self.assertIsNone(detect(box(6.0, dip_bars=(22, 27, 32))))      # 저가가 하단보다 1.5% 넘게 3번 이탈

    def test_breach_in_last_five_bars_without_recovery_is_excluded(self):
        self.assertIsNone(detect(box(6.0, last_dip=True)))            # 마지막 봉 저가가 하단 이탈, 종가는 하단 +1%를 못 되찾음


class ReboundTests(unittest.TestCase):
    def test_support_then_rebound_is_found_and_rebound_outscores_plain_approach(self):
        rebound, approach = detect(box(6.0)), detect(box(6.0, last='approach'))
        self.assertEqual(rebound['status'], 'REBOUND')
        self.assertEqual(approach['status'], 'APPROACH')
        self.assertGreaterEqual(rebound['score'] - approach['score'], 8)    # 단순 접근과 실제 반등 확인을 구분
        self.assertTrue(rebound['criteria']['volumeRecovery'])
        self.assertGreaterEqual(rebound['criteria']['supportTouches'], 2)

    def test_narrow_width_gets_no_bonus(self):
        scores = {w: detect(box(w))['score'] for w in (5.0, 6.0, 8.0, 10.0)}
        self.assertLessEqual(max(scores.values()) - min(scores.values()), 3, scores)
        self.assertLessEqual(scores[5.0], scores[10.0] + 2)           # 좁다고 더 높은 점수가 아님

    def test_width_8_to_10_candidates_keep_a_passing_score(self):
        for w in (8.0, 9.0, 10.0):
            self.assertGreaterEqual(detect(box(w))['score'], 80, w)

    def test_text_has_no_guarantee_wording(self):
        r = detect(box(6.0))
        text = r['interpretation'] + ' '.join(r['reasons'])
        for bad in ('보장', '확실', '반드시 오른'):
            self.assertNotIn(bad, text)


class RiskRewardTests(unittest.TestCase):
    def test_target_is_box_top_and_stop_is_below_real_support_low(self):
        r = detect(box(6.0))['criteria']
        self.assertEqual(r['targetPrice'], r['boxTop'])
        self.assertLess(r['stopPrice'], r['boxBottom'])
        self.assertGreaterEqual(r['riskReward'], 2.0)
        self.assertEqual(r['riskRewardStatus'], 'OK')

    def test_no_reliable_stop_means_pending_not_a_made_up_ratio(self):
        r = detect(box(6.0, touch_every=False))['criteria']          # 지지 확인이 마지막 봉 1번뿐
        self.assertLess(r['supportTouches'], 2)
        self.assertIsNone(r['stopPrice'])
        self.assertIsNone(r['riskReward'])
        self.assertEqual(r['riskRewardStatus'], 'PENDING')

    def test_ranking_puts_two_to_one_candidates_first(self):
        def item(code, score, status):
            return {'code': code, 'score': score, 'date': '2026-01-21', 'patternDetail': {'criteria': {'riskRewardStatus': status, 'lowerPositionPct': 5, 'supportTouches': 3}}}
        results = {'boxRangeLow': [item('A', 95, 'PENDING'), item('B', 85, 'OK'), item('C', 90, 'LOW')]}
        pd.finalize_pattern_results(results)
        self.assertEqual([i['code'] for i in results['boxRangeLow']], ['B', 'A', 'C'])


class QualityGateTests(unittest.TestCase):
    def test_gate_no_longer_drops_width_8_to_10_percent_candidates(self):
        def item(code, score, width):
            return {'code': code, 'score': score, 'patternDetail': {'criteria': {'lowerPositionPct': 10, 'closeRangePct': width, 'supportTouches': 3, 'riskRewardStatus': 'OK'}}}
        matches = [item('F%02d' % i, 50, 6.0) for i in range(20)] + [item('W9', 82, 9.0)]
        kept = pd._quality_gate_matches(matches, 'boxRangeLow')
        self.assertEqual([i['code'] for i in kept], ['W9'])
        stage2 = pd._quality_gate_matches([item('W9', 85, 9.5), item('X', 85, 7.0)] + [item('Y%02d' % i, 85, 6.0) for i in range(20)], 'boxRangeLow')
        self.assertIn('W9', [i['code'] for i in stage2])


class FrontendTextTests(unittest.TestCase):
    def test_frontend_shows_width_top_bottom_and_risk_reward(self):
        js = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'js', 'pattern-scan.js'), encoding='utf-8').read()
        for token in ('criteria.boxWidthPct', 'criteria.boxTop', 'criteria.boxBottom', 'criteria.riskRewardStatus', '손익비 판정 보류'):
            self.assertIn(token, js)
        self.assertIn('5%', js[js.index("key: 'boxRangeLow'"):js.index("key: 'boxRangeLow'") + 400])


if __name__ == '__main__':
    unittest.main()
