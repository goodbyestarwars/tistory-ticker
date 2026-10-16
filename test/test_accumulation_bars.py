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
    """2026-10-17: 매집봉과 털기?(상승 뒤 대량 양봉) 두 가지만 그날 정보로 표시하고, 빈 거래량은 서버처럼 처리한다."""

    def base(self):
        return series()

    def acc_bar(self, bars, i, volume=400000):
        put(bars, i, 10000, 10600, 9990, 10500, volume)

    def test_accumulation_bar_is_marked_on_its_own_day_only(self):
        bars = self.base()
        self.acc_bar(bars, 30)
        out = js_hits(bars)
        self.assertEqual(out['statuses'], [[30, 'accumulation']])
        self.assertEqual(out['markers'], [[bars[30]['date'], '매집봉']])
        self.assertEqual(out['summary'], {'accumulation': 1, 'distribution': 0})

    def test_marks_do_not_depend_on_later_bars(self):
        bars = self.base()
        self.acc_bar(bars, 30)
        for k in range(31, 40):                                   # 이후 봉을 어떻게 바꿔도(급락·거래량 폭증) 그날의 표시는 그대로 - 미래 정보 없음
            put(bars, k, 9000, 9100, 8000, 8100, 900000)
        self.assertEqual(js_hits(bars)['markers'], [[bars[30]['date'], '매집봉']])
        self.assertEqual(js_hits(bars[:31])['markers'], [[bars[30]['date'], '매집봉']])

    def test_runup_before_the_bar_is_marked_as_possible_distribution(self):
        bars = self.base()
        for k in range(9, 30):                                    # 직전 20봉이 약 +27% 오른 구간
            bars[k].update({'open': 7900 + (k - 9) * 105, 'high': 8100 + (k - 9) * 105, 'low': 7850 + (k - 9) * 105, 'close': 7900 + (k - 9) * 105})
        bars[29]['close'] = 10000
        self.acc_bar(bars, 30)
        out = js_hits(bars)
        self.assertEqual(out['statuses'], [[30, 'distribution']])
        self.assertEqual(out['markers'], [[bars[30]['date'], '털기?']])
        self.assertEqual(out['summary'], {'accumulation': 0, 'distribution': 1})

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
        self.acc_bar(bars, 30, volume=520000)                     # 2.6배면 둘 다 매집봉
        self.assertEqual(va.find_accumulation_bar(bars), 30)
        self.assertEqual(js_indices(bars), [30])


class AccumulationToggleWiringTest(unittest.TestCase):
    def read(self, p):
        return open(os.path.join(ROOT, p), encoding='utf-8').read()

    def test_checkbox_in_both_chart_screens(self):
        ss = self.read('js/stock-search.js')
        ff = self.read('js/foreign-flow.js')
        self.assertIn('id="ssAccumulationToggle"', ss)
        self.assertIn('/> 매집봉 표시</label>', ss)
        self.assertIn('/> 매집봉 표시</label>', ff)
        label = ss[ss.index('<label title="일봉에서만 표시합니다.'):ss.index('매집봉 표시</label>')]
        for text in ('후보', '4봉', '지지', '실패'):                 # 알아보기 어렵다는 지적을 받은 용어는 화면 문구에 없다
            self.assertNotIn(text, label)
        self.assertIn('id="ffAccumulationToggle"', ff)
        self.assertIn("timeframe === 'day' && !isUsChart", ss)      # 국내 일봉에서만
        self.assertIn('setAccumulationMarkers', ss)
        self.assertIn('setAccumulationMarkers', ff)
        self.assertIn('base: buildChartMarkers(daily, chartData)', ff)   # 기존 이벤트 마커와 합쳐서 건다


if __name__ == '__main__':
    unittest.main()
