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
        self.assertEqual(out['markers'], [[bars[30]['date'], '대량 양봉']])
        self.assertEqual(out['summary'], {'accumulation': 1, 'wick': 0, 'distribution': 0})

    def test_marks_do_not_depend_on_later_bars(self):
        bars = self.base()
        self.acc_bar(bars, 30)
        for k in range(31, 40):                                   # 이후 봉을 어떻게 바꿔도(급락·거래량 폭증) 그날의 표시는 그대로 - 미래 정보 없음
            put(bars, k, 9000, 9100, 8000, 8100, 900000)
        self.assertEqual(js_hits(bars)['markers'], [[bars[30]['date'], '대량 양봉']])
        self.assertEqual(js_hits(bars[:31])['markers'], [[bars[30]['date'], '대량 양봉']])

    def test_runup_before_the_bar_is_marked_as_possible_distribution(self):
        bars = self.base()
        for k in range(9, 30):                                    # 직전 20봉이 약 +27% 오른 구간
            bars[k].update({'open': 7900 + (k - 9) * 105, 'high': 8100 + (k - 9) * 105, 'low': 7850 + (k - 9) * 105, 'close': 7900 + (k - 9) * 105})
        bars[29]['close'] = 10000
        self.acc_bar(bars, 30)
        out = js_hits(bars)
        self.assertEqual(out['statuses'], [[30, 'distribution']])
        self.assertEqual(out['markers'], [[bars[30]['date'], '고점권 대량']])
        self.assertEqual(out['summary'], {'accumulation': 0, 'wick': 0, 'distribution': 1})

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
        self.assertIn('/> 대량거래 흔적 표시</label>', ss)
        self.assertIn('/> 대량거래 흔적 표시</label>', ff)
        self.assertIn('chart: chart, container: container', ss)   # 십자선 툴팁에 필요한 연결
        self.assertIn('chart: chart, container: container', ff)
        label = ss[ss.index('<label title="일봉에서만 표시합니다.'):ss.index('대량거래 흔적 표시</label>')]
        for text in ('후보', '4봉', '지지', '실패'):                 # 알아보기 어렵다는 지적을 받은 용어는 화면 문구에 없다
            self.assertNotIn(text, label)
        self.assertIn('id="ffAccumulationToggle"', ff)
        self.assertIn("timeframe === 'day' && !isUsChart", ss)      # 국내 일봉에서만
        self.assertIn('setAccumulationMarkers', ss)
        self.assertIn('setAccumulationMarkers', ff)
        self.assertIn('base: buildChartMarkers(daily, chartData)', ff)   # 기존 이벤트 마커와 합쳐서 건다


class WickBarAndPriorityTest(unittest.TestCase):
    """2026-10-18: 윗꼬리형(연구용 가설)을 보라색으로 추가. 한 봉은 하나의 표시만, 사후 정보로 색이 바뀌지 않는다."""

    def test_wick_bar_is_marked_purple_kind(self):
        bars = series()
        for r in bars:
            r['open'], r['high'], r['low'], r['close'], r['volume'] = 100000, 100500, 99500, 100200, 40000   # 거래대금 40억
        put(bars, 30, 100000, 109000, 99500, 101000, 90000)       # 평소의 2.25배, 윗꼬리 79%, 몸통 1%, 거래대금 90억
        out = js_hits(bars)
        self.assertEqual(out['statuses'], [[30, 'wick']])
        self.assertEqual(out['markers'], [[bars[30]['date'], '대량 윗꼬리']])
        self.assertEqual(out['summary'], {'accumulation': 0, 'wick': 1, 'distribution': 0})
        hit = out['hits'][0]
        self.assertEqual(hit['kind'], 'wick')
        self.assertAlmostEqual(hit['multiple'], 2.25, places=2)
        self.assertGreater(hit['wickPct'], 70)
        self.assertIsNone(hit['ma224Dist'])                        # 224봉이 안 되면 없는 값(0으로 속이지 않음)

    def test_wick_thresholds(self):
        bars = series()
        for r in bars:
            r['open'], r['high'], r['low'], r['close'], r['volume'] = 100000, 100500, 99500, 100200, 40000
        put(bars, 30, 100000, 109000, 99500, 101000, 70000)       # 1.75배 < 2배
        put(bars, 33, 100000, 109000, 99500, 104000, 90000)       # 몸통 4% > 3%
        put(bars, 36, 100000, 101800, 99500, 101000, 90000)       # 윗꼬리 35% < 40%
        self.assertEqual(js_indices(bars), [])

    def test_one_bar_gets_one_marker_volume_type_first(self):
        bars = series()
        for r in bars:
            r['open'], r['high'], r['low'], r['close'], r['volume'] = 100000, 100500, 99500, 100200, 40000
        put(bars, 30, 100000, 106000, 99900, 105000, 120000)      # 대량 양봉 조건(3배·몸통 5%·종가 위치 0.83)
        out = js_hits(bars)
        self.assertEqual(out['statuses'], [[30, 'accumulation']])
        self.assertEqual(len(out['markers']), 1)

    def test_overheated_wick_bar_becomes_distribution(self):
        bars = series()
        for k in range(9, 30):
            bars[k].update({'open': 79000 + (k - 9) * 1050, 'high': 81000 + (k - 9) * 1050, 'low': 78500 + (k - 9) * 1050, 'close': 79000 + (k - 9) * 1050, 'volume': 40000})
        for k in list(range(0, 9)) + list(range(30, 40)):
            bars[k].update({'open': 79000, 'high': 79500, 'low': 78500, 'close': 79000, 'volume': 40000})
        bars[29]['close'] = 100000
        put(bars, 30, 100000, 109000, 99500, 101000, 90000)
        self.assertEqual(js_hits(bars)['statuses'], [[30, 'distribution']])

    def test_tooltip_numbers_use_only_known_bars(self):
        bars = series(260)
        for r in bars:
            r['open'], r['high'], r['low'], r['close'], r['volume'] = 100000, 100500, 99500, 100200, 40000
        put(bars, 250, 100000, 109000, 99500, 101000, 90000)
        before = js_hits(bars)['hits'][0]
        for k in range(251, 260):
            put(bars, k, 50000, 51000, 40000, 41000, 900000)      # 이후 봉을 바꿔도 수치는 그대로
        after = js_hits(bars)['hits'][0]
        self.assertEqual(before, after)
        self.assertAlmostEqual(before['highDist'], (101000 / 100500 - 1) * 100, places=4)   # 직전 60봉 고점 100500 대비
        self.assertIsNotNone(before['ma112Dist'])
        self.assertIsNotNone(before['ma224Dist'])
        self.assertAlmostEqual(before['runup'], 0.0, places=6)

    def test_checkbox_text_says_observation_only(self):
        ss = open(os.path.join(ROOT, 'js', 'stock-search.js'), encoding='utf-8').read()
        self.assertIn('관찰용', ss)
        self.assertIn('대량 윗꼬리', ss)
        self.assertNotIn('매집 확정', ss[ss.index('ssAccumulationToggle'):ss.index('ssAccumulationToggle') + 900])


class MarkerConsistencyAndRsiMidlineTest(unittest.TestCase):
    """2026-10-18: 세 표시의 점 크기를 같게(크기는 키우지 않고 색을 진하게), RSI 차트에 50 가로선."""

    def test_all_three_markers_share_one_small_size(self):
        src = open(os.path.join(ROOT, 'js', 'chart-core.js'), encoding='utf-8').read()
        block = src[src.index('var ACC_MARKER = {'):src.index('function accumulationMarkers')]
        import re
        self.assertEqual(re.findall(r'size: (\d)', block), ['1', '1', '1'])

    def test_rsi_charts_draw_the_50_line(self):
        ss = open(os.path.join(ROOT, 'js', 'stock-search.js'), encoding='utf-8').read()
        ff = open(os.path.join(ROOT, 'js', 'foreign-flow.js'), encoding='utf-8').read()
        self.assertIn("rsiSeries.createPriceLine({ price: 50,", ss)
        self.assertIn('y(50).toFixed(1)', ff)


class MarkerWordingAndTooltipFieldsTest(unittest.TestCase):
    """2026-10-18 문구 정리: 모양(대량 양봉/대량 윗꼬리)과 가격 위치(고점권)를 한 이름에 섞지 않고, 툴팁 수치를 늘렸다. 판정 조건은 그대로다."""

    def test_full_labels_are_the_requested_wording(self):
        src = open(os.path.join(ROOT, 'js', 'chart-core.js'), encoding='utf-8').read()
        for text in ("label: '대량 양봉 · 매수 우위 관찰'", "label: '대량 윗꼬리 · 매도압력 의심'", "label: '고점권 대량거래 · 분배 위험'"):
            self.assertIn(text, src)
        block = src[src.index('var ACC_MARKER = {'):src.index('function accumulationMarkers')]
        self.assertNotIn('매집 확정', block)             # 표시 이름에 확정 표현을 쓰지 않는다

    def test_tooltip_numbers_open_change_drop_from_high_and_position(self):
        bars = series(260)
        for r in bars:
            r['open'], r['high'], r['low'], r['close'], r['volume'] = 100000, 100500, 99500, 100200, 40000
        put(bars, 250, 100000, 109000, 99500, 101000, 90000)      # 시가 대비 +1%, 고가 대비 -7.34%, 윗꼬리 79%
        hit = js_hits(bars)['hits'][0]
        self.assertAlmostEqual(hit['openChange'], 1.0, places=6)
        self.assertAlmostEqual(hit['fromHigh'], (101000 / 109000 - 1) * 100, places=6)
        self.assertIsNotNone(hit['position'])
        self.assertTrue(0 <= hit['position'] <= 100)
        short = series(60)
        for r in short:
            r['open'], r['high'], r['low'], r['close'], r['volume'] = 100000, 100500, 99500, 100200, 40000
        put(short, 40, 100000, 109000, 99500, 101000, 90000)
        self.assertIsNone(js_hits(short)['hits'][0]['position'])   # 봉이 120개도 안 되면 위치를 만들지 않는다


def js_tip(bars, date):
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as f:
        json.dump(bars, f)
        path = f.name
    try:
        out = subprocess.run(['node', os.path.join(ROOT, 'test', 'acc_tip_cli.js'), path, date], capture_output=True, text=True, check=True, encoding='utf-8')
    finally:
        os.unlink(path)
    return json.loads(out.stdout)


class HighChangeDisplayTest(unittest.TestCase):
    """2026-10-19 지시: 대량거래 표시의 '고가' = (당일 고가 / 당일 시가 - 1) x 100, 종가 기준 변화율과 이름으로 구분한다."""

    def setUp(self):
        self.bars = series(260)
        for r in self.bars:
            r['open'], r['high'], r['low'], r['close'], r['volume'] = 100000, 100500, 99500, 100200, 40000
        put(self.bars, 250, 100000, 109000, 99500, 101000, 90000)     # 고가 +9%, 종가 +1%, 고점 대비 종가 -7.34%

    def test_high_change_is_high_over_open_not_close(self):
        hit = js_hits(self.bars)['hits'][0]
        self.assertAlmostEqual(hit['highChange'], 9.0, places=6)
        self.assertAlmostEqual(hit['openChange'], 1.0, places=6)         # 기존 종가 기준 값은 그대로
        self.assertAlmostEqual(hit['fromHigh'], (101000 / 109000 - 1) * 100, places=6)

    def test_tooltip_labels_high_and_close_separately(self):
        res = js_tip(self.bars, self.bars[250]['date'])
        self.assertFalse(res['tipHidden'])
        self.assertIn('고가 <b>+9.0%</b>', res['tip'])
        self.assertIn('시가→당일 고가', res['tip'])
        self.assertIn('종가 <b>+1.0%</b>', res['tip'])
        self.assertIn('시가→종가', res['tip'])
        self.assertIn('고점 대비 종가 <b>-7.3%</b>', res['tip'])
        self.assertNotIn('시가 대비 <b>', res['tip'])                      # 모호한 옛 표기('시가 대비')가 남지 않는다

    def _flat(self):
        bars = series(260)
        for r in bars:
            r['open'], r['high'], r['low'], r['close'], r['volume'] = 100000, 100500, 99500, 100200, 40000
        return bars

    def test_legend_and_marker_colors_keep_orange_purple_gray(self):
        orange = self._flat()
        put(orange, 250, 100000, 106000, 99500, 105500, 120000)           # 대량 양봉
        res = js_tip(orange, orange[250]['date'])
        self.assertEqual([tuple(m) for m in res['markers']], [(orange[250]['date'], '대량 양봉', '#e8590c')])
        self.assertAlmostEqual(js_hits(orange)['hits'][0]['highChange'], 6.0, places=6)
        purple = self._flat()
        put(purple, 250, 100000, 109000, 99500, 101000, 90000)            # 대량 윗꼬리
        res_p = js_tip(purple, purple[250]['date'])
        self.assertEqual([tuple(m) for m in res_p['markers']], [(purple[250]['date'], '대량 윗꼬리', '#7c3aed')])
        gray = self._flat()
        for k in range(229, 250):                                          # 직전 20봉 +25% 이상 상승 뒤
            gray[k]['close'] = 100000 + (k - 229) * 1600
            gray[k]['high'] = gray[k]['close'] + 300
            gray[k]['open'] = gray[k]['close'] - 100
        put(gray, 250, 132000, 142000, 131500, 141500, 120000)
        res_g = js_tip(gray, gray[250]['date'])
        self.assertEqual([tuple(m) for m in res_g['markers']], [(gray[250]['date'], '고점권 대량', '#4b5563')])
        for needle in ('#e8590c', '#7c3aed', '#4b5563', '대량 양봉', '대량 윗꼬리', '고점권 대량', '고가 = 시가 대비 당일 고가'):
            self.assertIn(needle, res['legend'])
        self.assertEqual(res['counts'], {'accumulation': 1, 'wick': 0, 'distribution': 0})

    def test_both_screens_share_core_tooltip_and_legend_and_title(self):
        stock = open(os.path.join(ROOT, 'js', 'stock-search.js'), encoding='utf-8').read()
        flow = open(os.path.join(ROOT, 'js', 'foreign-flow.js'), encoding='utf-8').read()
        self.assertIn('core.accumulationLegendHtml(accCounts)', stock)           # 차트검색 범례는 공통 함수
        self.assertIn('setAccumulationMarkers(', flow)                            # 종목분석도 같은 공통 함수로 마커·툴팁
        sentence = '툴팁의 &quot;고가&quot;는 (당일 고가 ÷ 당일 시가 − 1)×100이고'
        self.assertIn(sentence, stock)
        self.assertIn(sentence, flow)


if __name__ == '__main__':
    unittest.main()
