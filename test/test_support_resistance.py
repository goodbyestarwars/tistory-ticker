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
        src = (ROOT / 'js' / 'stock-search.js').read_text(encoding='utf-8')
        self.assertIn('지지·저항 표시', src)
        self.assertIn('supportResistanceEnabled', src)
        # 차트검색은 SR 계산을 따로 갖지 않고 공용 모듈을 쓴다(종목분석·차트검색 결과가 같다)
        self.assertNotIn('function supportResistanceLevels', src)
        self.assertIn('NineChartSR.levels(bars)', src)


if __name__ == '__main__':
    unittest.main()
