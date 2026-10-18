# -*- coding: utf-8 -*-
"""차트 지지·저항 계산 계약(2026-10-03). node가 없으면 건너뛴다."""
import json
import pathlib
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]

HARNESS = r"""
const fs = require('fs'), vm = require('vm');
const window = {};
vm.runInNewContext(fs.readFileSync('js/chart-sr.js', 'utf8'), { window, document: {} });
const bars = JSON.parse(process.argv[1]);
console.log(JSON.stringify(window.NineChartSR.levels(bars)));
"""


def bar(i, close, spread=1.0, volume=1000):
    return {'date': '2026-01-%02d' % (i % 28 + 1), 'open': close, 'high': close + spread,
            'low': close - spread, 'close': close, 'volume': volume}


@unittest.skipUnless(shutil.which('node'), 'node가 없으면 건너뛴다')
class SupportResistanceTest(unittest.TestCase):
    def run_levels(self, bars):
        out = subprocess.run(['node', '-e', HARNESS, json.dumps(bars)], cwd=ROOT, check=True,
                             capture_output=True, text=True, encoding='utf-8')
        return json.loads(out.stdout)

    def test_range_bound_prices_give_support_below_and_resistance_above(self):
        # 100~120을 세 번 오가는 박스권, 마지막 종가는 110
        wave = [100, 104, 108, 112, 116, 120, 116, 112, 108, 104]
        closes = (wave * 6)[:60] + [110]
        bars = [bar(i, c) for i, c in enumerate(closes)]
        result = self.run_levels(bars)
        self.assertEqual(result['price'], 110)
        self.assertTrue(result['support'], '지지가 있어야 한다')
        self.assertTrue(result['resistance'], '저항이 있어야 한다')
        for level in result['support']:
            self.assertLess(level['price'], 110)
            self.assertGreaterEqual(level['touches'], 2)
        for level in result['resistance']:
            self.assertGreater(level['price'], 110)
        self.assertAlmostEqual(result['support'][0]['price'], 100, delta=3)
        self.assertAlmostEqual(result['resistance'][0]['price'], 120, delta=3)

    def test_too_few_bars_returns_no_levels(self):
        result = self.run_levels([bar(i, 100 + i) for i in range(8)])
        self.assertEqual(result['support'], [])
        self.assertEqual(result['resistance'], [])

    def test_colors_and_ui_contract(self):
        sr = (ROOT / 'js' / 'chart-sr.js').read_text(encoding='utf-8')
        self.assertIn("var SR_SUPPORT_COLOR = '210,79,69';", sr)      # 지지 = 붉은색
        self.assertIn("var SR_RESISTANCE_COLOR = '18,97,196';", sr)   # 저항 = 파란색
        self.assertIn('ctx.setLineDash([2, 2]);', sr)
        self.assertIn('var SR_BAND_ALPHA = [0.14, 0.085, 0.045];', sr)
        src = (ROOT / 'js' / 'stock-search.js').read_text(encoding='utf-8')
        self.assertIn('지지·저항 표시', src)
        self.assertIn('supportResistanceEnabled', src)
        # 차트검색은 SR 계산을 따로 갖지 않고 공용 모듈을 쓴다(종목분석·차트검색 결과가 같다)
        self.assertNotIn('function supportResistanceLevels', src)
        self.assertIn('NineChartSR.levels(bars, srReferencePrice, { timeframe: timeframe })', src)
        self.assertIn('NineChartSR.levels(lwcLiveBars, referencePrice, { timeframe: lwcLiveTimeframe })', src)
        flow = (ROOT / 'js' / 'foreign-flow.js').read_text(encoding='utf-8')
        self.assertIn("api.levels(daily, flowSrReferencePrice, { timeframe: 'day' })", flow)
        self.assertIn("global.NineChartSR.levels(flowSrCtx.daily, price, { timeframe: 'day' })", flow)


TREND_HARNESS = r"""
const fs = require('fs'), vm = require('vm');
const window = {};
vm.runInNewContext(fs.readFileSync('js/chart-sr.js', 'utf8'), { window, document: {} });
const input = JSON.parse(fs.readFileSync(0, 'utf8'));   // 봉이 많아 명령줄 길이 제한(Windows)을 피하려고 표준입력으로 받는다
console.log(JSON.stringify(window.NineChartSR.levels(input.bars, null, input.options)));
"""


def wavy_bars(n=320):
    import math
    bars = []
    for i in range(n):
        close = 100 + 22 * math.sin(i / 9.0) + 6 * math.sin(i / 2.3) + i * 0.04
        bars.append({'date': '2026-%02d-%02d' % (i // 28 % 12 + 1, i % 28 + 1), 'open': close, 'high': close + 1.2, 'low': close - 1.2,
                     'close': close, 'volume': 1000 + (i % 7) * 100})
    return bars


@unittest.skipUnless(shutil.which('node'), 'node가 없으면 건너뛴다')
class TrendProfileTest(unittest.TestCase):
    """2026-10-18: 추세용 지지·저항은 단타 설정보다 선이 적고 서로 멀리 떨어진다."""

    def levels(self, options):
        out = subprocess.run(['node', '-e', TREND_HARNESS], cwd=ROOT, check=True, input=json.dumps({'bars': wavy_bars(), 'options': options}),
                             capture_output=True, text=True, encoding='utf-8')
        return json.loads(out.stdout)

    @staticmethod
    def min_gap(levels, price):
        prices = sorted(l['price'] for l in levels)
        return min((b - a) / price for a, b in zip(prices, prices[1:])) if len(prices) > 1 else 1.0

    def test_daily_trend_levels_are_spread_out(self):
        legacy, trend = self.levels({}), self.levels({'timeframe': 'day'})
        price = trend['price']
        for side in ('support', 'resistance'):
            self.assertLessEqual(len(trend[side]), 3)
            self.assertGreaterEqual(self.min_gap(trend[side], price), 0.06 - 1e-9)       # 같은 쪽 선끼리 6% 이상
        self.assertGreaterEqual(self.min_gap(trend['support'] + trend['resistance'], price), 0.02)

    def test_without_timeframe_the_short_term_profile_is_unchanged(self):
        legacy = self.levels({})
        self.assertGreaterEqual(self.min_gap(legacy['support'], legacy['price']), 0.02 - 1e-9)   # 예전 최소 간격 2%
        self.assertEqual(self.levels({'timeframe': 'minute'}), legacy)                          # 분봉은 예전 설정 그대로

    def test_week_and_month_use_the_wider_but_shorter_profile(self):
        week = self.levels({'timeframe': 'week'})
        self.assertGreaterEqual(self.min_gap(week['resistance'], week['price']), 0.08 - 1e-9)

    def test_rsi_50_line_is_darker_than_70_and_30(self):
        ss = (ROOT / 'js' / 'stock-search.js').read_text(encoding='utf-8')
        self.assertIn("price: 50, color: '#6b7280'", ss)
        self.assertIn("price: 70, color: '#d9d9d9'", ss)
        css = (ROOT / 'css' / 'foreign-flow.css').read_text(encoding='utf-8')
        self.assertIn('#foreign-flow .ff-rsi-mid { stroke: #6b7280;', css)


if __name__ == '__main__':
    unittest.main()
