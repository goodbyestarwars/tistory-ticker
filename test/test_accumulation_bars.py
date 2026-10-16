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


class AccumulationToggleWiringTest(unittest.TestCase):
    def read(self, p):
        return open(os.path.join(ROOT, p), encoding='utf-8').read()

    def test_checkbox_in_both_chart_screens(self):
        ss = self.read('js/stock-search.js')
        ff = self.read('js/foreign-flow.js')
        self.assertIn('id="ssAccumulationToggle"', ss)
        self.assertIn('id="ffAccumulationToggle"', ff)
        self.assertIn("timeframe === 'day' && !isUsChart", ss)      # 국내 일봉에서만
        self.assertIn('setAccumulationMarkers', ss)
        self.assertIn('setAccumulationMarkers', ff)
        self.assertIn('base: buildChartMarkers(daily, chartData)', ff)   # 기존 이벤트 마커와 합쳐서 건다


if __name__ == '__main__':
    unittest.main()
