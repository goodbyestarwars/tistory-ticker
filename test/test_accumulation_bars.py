# -*- coding: utf-8 -*-
"""차트 '매집봉 표시'(js/chart-core.js accumulationBars)가 검색기 정의(scripts/cloud-vm/volume_accumulation.py)와 같은 봉을 고르는지 확인한다."""

import json
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))

import volume_accumulation as va  # noqa: E402


def quiet_bar(i):
    return {'date': '2026-09-%02d' % (i % 28 + 1) if i < 28 else '2026-10-%02d' % (i - 27), 'open': 10000, 'high': 10050, 'low': 9950, 'close': 10020, 'volume': 100000}


def series(n=40):
    return [dict(quiet_bar(i), date='d%03d' % i) for i in range(n)]


def put(bars, i, o, h, l, c, v):
    bars[i].update({'open': o, 'high': h, 'low': l, 'close': c, 'volume': v})


def js_indices(bars):
    return js_indices_full(bars)['indices']


def js_hits(bars):
    return js_indices_full(bars)


def js_indices_full(bars):
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as f:
        json.dump(bars, f)
        path = f.name
    try:
        out = subprocess.run(['node', os.path.join(ROOT, 'test', 'acc_bars_cli.js'), path], capture_output=True, text=True, check=True)
    finally:
        os.unlink(path)
    return json.loads(out.stdout)


class AccumulationBarParityTest(unittest.TestCase):
    def test_single_bar_matches_python_and_rejects_near_misses(self):
        bars = series()
        put(bars, 25, 10000, 10150, 9990, 10100, 300000)   # 몸통 1% < 2%
        put(bars, 30, 10000, 10600, 9990, 10500, 400000)   # 매집봉
        put(bars, 33, 10000, 10600, 10000, 10300, 300000)  # 종가 위치 0.5 < 0.6
        put(bars, 35, 10000, 10600, 9990, 10500, 200000)   # 거래량 2배 < 2.5배
        self.assertEqual(js_indices(bars), [30])
        self.assertEqual(va.find_accumulation_bar(bars), 30)

    def test_latest_of_several_matches_python_pick(self):
        bars = series()
        put(bars, 30, 10000, 10600, 9990, 10500, 400000)
        put(bars, 36, 10000, 10600, 9990, 10500, 450000)
        found = js_indices(bars)
        self.assertEqual(found, [30, 36])
        self.assertEqual(va.find_accumulation_bar(bars), found[-1])   # 검색기는 가장 최근 것 하나만 쓴다

    def test_amount_floor_and_short_history(self):
        bars = series()
        put(bars, 30, 1000, 1060, 999, 1050, 400000)               # 거래대금 4.2억 < 30억
        self.assertEqual(js_indices(bars), [])
        self.assertIsNone(va.find_accumulation_bar(bars))
        self.assertEqual(js_indices(series(20)), [])               # 20봉 이하는 판정 불가

    def test_constants_match_the_screener(self):
        src = open(os.path.join(ROOT, 'js', 'chart-core.js'), encoding='utf-8').read()
        self.assertIn('volMult: %s' % va.ACC_VOL_MULT, src)
        self.assertIn('minBodyPct: %s' % va.ACC_MIN_BODY_PCT, src)
        self.assertIn('closePosMin: %s' % va.ACC_CLOSE_POS_MIN, src)
        self.assertIn('amountMin: %d' % va.ACC_AMOUNT_MIN, src)


class AccumulationContextTest(unittest.TestCase):
    """2026-10-17: 매집 확인·후보·털기?(분배 가능성) 구분과 빈 거래량 처리."""

    def base(self):
        return series()

    def acc_bar(self, bars, i, volume=400000):
        put(bars, i, 10000, 10600, 9990, 10500, volume)

    def hold_after(self, bars, i, count=4, volume=100000):
        for k in range(i + 1, i + 1 + count):
            put(bars, k, 10450, 10500, 10300, 10400, volume)       # 거래량 25%, 저가·종가가 매집봉 지지 위

    def test_confirmed_after_four_dry_supported_bars(self):
        bars = self.base()
        self.acc_bar(bars, 30)
        self.hold_after(bars, 30)
        out = js_hits(bars)
        self.assertEqual(out['statuses'], [[30, 'confirmed']])
        # 후보는 그날(30)에, 4봉 지지는 판정이 가능해진 4번째 봉(34)에 찍는다 - 과거 차트가 미리 알았던 것처럼 보이지 않게
        self.assertEqual(out['markers'], [[bars[30]['date'], '후보'], [bars[34]['date'], '4봉 지지']])

    def test_fourth_bar_volume_is_excluded_like_the_screener(self):
        bars = self.base()
        self.acc_bar(bars, 30)
        self.hold_after(bars, 30)
        bars[34]['volume'] = 900000                                # 4번째 봉은 거래량 평균에 넣지 않는다(검색기가 최신 봉을 빼는 방식)
        self.assertEqual(js_hits(bars)['statuses'], [[30, 'confirmed']])
        bars[33]['volume'] = 900000                                # 앞 3봉에 들어가면 실패
        self.assertEqual(js_hits(bars)['statuses'], [[30, 'failed']])

    def test_pending_when_fewer_than_four_bars_follow(self):
        bars = self.base()[:38]
        self.acc_bar(bars, 35)
        self.hold_after(bars, 35, count=2)
        out = js_hits(bars)
        self.assertEqual(out['statuses'], [[35, 'pending']])
        self.assertEqual(out['markers'], [[bars[35]['date'], '후보']])     # 4봉이 안 지났으니 후보만

    def test_failed_followup_is_not_marked(self):
        bars = self.base()
        self.acc_bar(bars, 30)
        self.hold_after(bars, 30, volume=300000)                  # 이후 거래량이 줄지 않음(분배일 수 있음)
        out = js_hits(bars)
        self.assertEqual(out['statuses'], [[30, 'failed']])
        # 실패도 지우지 않고 흐린 회색으로 남긴다(좋은 것만 남아 결과가 좋아 보이는 착시 방지)
        self.assertEqual(out['markers'], [[bars[30]['date'], '후보'], [bars[34]['date'], '4봉 실패']])
        self.assertEqual(out['summary']['failed'], 1)
        bars2 = self.base()
        self.acc_bar(bars2, 30)
        self.hold_after(bars2, 30)
        put(bars2, 33, 10450, 10450, 9500, 10300, 100000)         # 저가가 매집봉 저가의 98% 아래로 이탈
        self.assertEqual(js_hits(bars2)['statuses'], [[30, 'failed']])

    def test_runup_before_the_bar_is_marked_as_possible_distribution(self):
        bars = self.base()
        for k in range(9, 30):                                    # 직전 20봉이 약 +27% 오른 구간
            bars[k].update({'open': 7900 + (k - 9) * 105, 'high': 8100 + (k - 9) * 105, 'low': 7850 + (k - 9) * 105, 'close': 7900 + (k - 9) * 105})
        bars[29]['close'] = 10000
        self.acc_bar(bars, 30)
        self.hold_after(bars, 30)
        out = js_hits(bars)
        self.assertEqual(out['statuses'], [[30, 'distribution']])
        self.assertEqual(out['markers'], [[bars[30]['date'], '털기?']])       # 그날 맥락으로 판정, 4봉 뒤 표시 없음
        self.assertEqual(js_hits(self._with_failed_followup(bars))['markers'], [[bars[30]['date'], '털기?']])
        self.assertEqual(out['summary']['distribution'], 1)

    def _with_failed_followup(self, bars):
        put(bars, 33, 10450, 10450, 9000, 9500, 900000)            # 후속 지지 실패여도 털기?는 그대로
        return bars

    def test_missing_volume_is_skipped_not_counted_as_zero(self):
        bars = self.base()
        for r in bars:
            r['volume'] = 200000                                  # 평소 거래량 20만
        for k in range(10, 30):
            if k % 2:
                bars[k]['volume'] = None                          # 서버는 이 값을 평균에서 뺀다(평균 20만 유지)
        self.acc_bar(bars, 30, volume=400000)                     # 2배: 서버는 후보 아님. 빈 값을 0으로 세면 평균이 10만이 돼 4배로 잘못 찍힌다
        self.assertIsNone(va.find_accumulation_bar(bars))
        self.assertEqual(js_indices(bars), [])
        self.acc_bar(bars, 30, volume=520000)                     # 2.6배면 둘 다 후보
        self.assertEqual(va.find_accumulation_bar(bars), 30)
        self.assertEqual(js_indices(bars), [30])


class AccumulationToggleWiringTest(unittest.TestCase):
    def read(self, p):
        return open(os.path.join(ROOT, p), encoding='utf-8').read()

    def test_checkbox_in_both_chart_screens(self):
        ss = self.read('js/stock-search.js')
        ff = self.read('js/foreign-flow.js')
        self.assertIn('id="ssAccumulationToggle"', ss)
        self.assertIn('매집봉 후보 표시', ss)
        self.assertIn('매집봉 후보 표시', ff)
        self.assertIn('id="ffAccumulationToggle"', ff)
        self.assertIn("timeframe === 'day' && !isUsChart", ss)      # 국내 일봉에서만
        self.assertIn('setAccumulationMarkers', ss)
        self.assertIn('setAccumulationMarkers', ff)
        self.assertIn('base: buildChartMarkers(daily, chartData)', ff)   # 기존 이벤트 마커와 합쳐서 건다


if __name__ == '__main__':
    unittest.main()
