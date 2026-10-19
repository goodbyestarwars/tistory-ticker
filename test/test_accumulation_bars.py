# -*- coding: utf-8 -*-
"""차트 '대량 거래'(js/chart-core.js accumulationBars, 2026-10-19 사용자 정의)의 계약:
거래량 직전 20일 평균 2배 이상 + 거래대금 30억 이상 + 바닥권(250봉 범위 하위 30%) 또는 횡보(60봉 고저 폭 25% 이하·하위 60%), 250봉 고가 90% 이상 구간 제외."""

import json
import os
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run_node(script, bars, *extra):
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as f:
        json.dump(bars, f)
        path = f.name
    try:
        out = subprocess.run(['node', os.path.join(ROOT, 'test', script), path] + list(extra), capture_output=True, text=True, check=True, encoding='utf-8')
    finally:
        os.unlink(path)
    return json.loads(out.stdout)


def bars_for(close_fn, n=300, vol=1000000, spread=0.005):
    out = []
    for i in range(n):
        c = close_fn(i)
        out.append({'date': 'd%03d' % i, 'open': c, 'high': c * (1 + spread), 'low': c * (1 - spread), 'close': c, 'volume': vol})
    return out


def bottom_series():
    """앞 250봉은 큰 범위(고점 20000 -> 저점 10000 근처로 하락), 마지막 구간은 저점권."""
    return bars_for(lambda i: 20000 - (10000 * i / 280.0) if i < 280 else 10000)


def box_close(i):
    if i < 150:
        return 20000 - 10000 * i / 150.0
    if i < 190:
        return 10000 + 4000 * (i - 150) / 40.0
    return 14000 + (i % 3) * 20


def put(bars, i, o, h, l, c, v):
    bars[i].update({'open': o, 'high': h, 'low': l, 'close': c, 'volume': v})


class ZoneDefinitionTest(unittest.TestCase):
    def test_volume_burst_in_bottom_zone_is_marked(self):
        bars = bottom_series()
        put(bars, 290, 10000, 10400, 9900, 10300, 2500000)        # 거래량 2.5배, 하위 30% 안
        res = run_node('acc_bars_cli.js', bars)
        self.assertEqual(res['zones'], [[290, 'bottom']])
        self.assertEqual([tuple(m) for m in res['markers']], [(bars[290]['date'], '대량 바닥권', '#e8590c')])
        self.assertEqual(res['summary'], {'accumulation': 1, 'bottom': 1, 'box': 0})

    def test_below_2x_or_low_amount_is_not_marked(self):
        bars = bottom_series()
        put(bars, 290, 10000, 10400, 9900, 10300, 1900000)        # 1.9배
        self.assertEqual(run_node('acc_bars_cli.js', bars)['indices'], [])
        small = bars_for(lambda i: 20000 - (10000 * i / 280.0) if i < 280 else 10000, vol=10000)
        put(small, 290, 10000, 10400, 9900, 10300, 25000)         # 2.5배지만 거래대금 2.6억 < 30억
        self.assertEqual(run_node('acc_bars_cli.js', small)['indices'], [])

    def test_box_zone_needs_narrow_60_bar_range_and_lower_60_percent(self):
        bars = bars_for(lambda i: box_close(i))      # 큰 하락(20000->10000) 뒤 14000까지 반등하고 횡보(고저 폭 ~1%), 250봉 위치 약 40%
        put(bars, 290, 14000, 14100, 13950, 14080, 2500000)
        res = run_node('acc_bars_cli.js', bars)
        self.assertEqual(res['zones'], [[290, 'box']])
        wide = bars_for(lambda i: box_close(i) if i < 231 else 14000 + (i % 40) * 100)     # 최근 60봉 고저 폭 28% -> 박스 아님
        put(wide, 290, 14000, 14100, 13950, 14080, 2500000)
        self.assertNotIn([290, 'box'], run_node('acc_bars_cli.js', wide)['zones'])

    def test_new_high_zone_is_excluded(self):
        bars = bars_for(lambda i: 10000 + i * 20)                  # 계속 상승: 종가가 250봉 고가에 붙어 있다
        put(bars, 290, 15800, 15900, 15750, 15880, 3000000)
        self.assertEqual(run_node('acc_bars_cli.js', bars)['indices'], [])

    def test_fewer_than_250_bars_gives_no_marker(self):
        bars = bars_for(lambda i: 10000, n=200)
        put(bars, 190, 10000, 10400, 9900, 10300, 5000000)
        self.assertEqual(run_node('acc_bars_cli.js', bars)['indices'], [])

    def test_old_marker_types_are_gone(self):
        src = open(os.path.join(ROOT, 'js', 'chart-core.js'), encoding='utf-8').read()
        block = src[src.index('var ACC_MARKER = {'):src.index('function accumulationMarkers')]
        for gone in ('대량 양봉', '대량 윗꼬리', '고점권 대량', '털기', 'distribution', 'wick'):
            self.assertNotIn(gone, block)


class HighChangeTooltipLegendTest(unittest.TestCase):
    """고가 = (당일 고가 / 당일 시가 - 1) x 100, 종가 변화율과 이름으로 구분. 두 화면 공통 툴팁·범례."""

    def setUp(self):
        self.bars = bottom_series()
        put(self.bars, 290, 10000, 10900, 9900, 10100, 2500000)    # 고가 +9%, 종가 +1%

    def test_high_change_is_high_over_open(self):
        hit = run_node('acc_bars_cli.js', self.bars)['hits'][0]
        self.assertAlmostEqual(hit['highChange'], 9.0, places=6)
        self.assertAlmostEqual(hit['openChange'], 1.0, places=6)
        self.assertAlmostEqual(hit['fromHigh'], (10100 / 10900 - 1) * 100, places=6)

    def test_tooltip_and_legend_text(self):
        res = run_node('acc_tip_cli.js', self.bars, self.bars[290]['date'])
        self.assertFalse(res['tipHidden'])
        for needle in ('대량 거래 · 바닥권', '고가 <b>+9.0%</b>', '시가→당일 고가', '종가 <b>+1.0%</b>', '시가→종가', '60봉 고저 폭', '매집 확정 아님', '직전 20일 평균 대비'):
            self.assertIn(needle, res['tip'])
        for needle in ('#e8590c', '대량 바닥권', '대량 횡보'):
            self.assertIn(needle, res['legend'])
        self.assertNotIn('관찰용', res['legend'])                    # 범례의 '(관찰용 ~' 문구는 삭제

    def test_tooltip_numbers_ignore_later_bars(self):
        before = run_node('acc_bars_cli.js', self.bars)['hits'][0]
        for k in range(291, 300):
            put(self.bars, k, 5000, 5100, 4000, 4100, 9000000)
        self.assertEqual(before, run_node('acc_bars_cli.js', self.bars)['hits'][0])

    def test_both_screens_share_core_tooltip_legend_and_title(self):
        stock = open(os.path.join(ROOT, 'js', 'stock-search.js'), encoding='utf-8').read()
        flow = open(os.path.join(ROOT, 'js', 'foreign-flow.js'), encoding='utf-8').read()
        self.assertIn('core.supplyTraceLegendHtml(accCounts)', stock)
        self.assertIn('setSupplyTraceMarkers(', flow)
        for source in (stock, flow):
            self.assertIn('수급 흔적</label>', source)
            self.assertIn('직전 20일 평균 3배 이상', source)
            self.assertIn('종가×거래량 대용값', source)
            self.assertNotIn('setAccumulationMarkers(', source)



if __name__ == '__main__':
    unittest.main()
