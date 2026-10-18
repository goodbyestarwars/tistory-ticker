# -*- coding: utf-8 -*-
"""마우스 오버 툴팁의 '거래량 (직전 20일 평균 대비 N배)' 계산(js/chart-core.js volumeMultiples)의 계약. 전일 하루 대비가 아니라 직전 20봉 평균(그 봉 제외)이다."""
import json
import os
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(vols):
    bars = [{'date': 'd%03d' % i, 'open': 100, 'high': 101, 'low': 99, 'close': 100, 'volume': v} for i, v in enumerate(vols)]
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as f:
        json.dump(bars, f)
        path = f.name
    try:
        out = subprocess.run(['node', os.path.join(ROOT, 'test', 'vol_mult_cli.js'), path], capture_output=True, text=True, check=True, encoding='utf-8')
    finally:
        os.unlink(path)
    return json.loads(out.stdout)


class VolumeMultipleTest(unittest.TestCase):
    def test_multiple_is_against_previous_20_bar_average_excluding_the_bar(self):
        res = run([100] * 20 + [250])
        self.assertAlmostEqual(res['d020']['multiple'], 2.5)           # 직전 20개 평균 100 대비
        self.assertEqual(res['d020']['volume'], 250)

    def test_not_the_previous_single_day(self):
        vols = [100] * 19 + [1000, 300]                                  # 전일(1000)이 아니라 직전 20봉 평균((19*100+1000)/20=145)
        res = run(vols)
        self.assertAlmostEqual(res['d020']['multiple'], 300 / 145.0)

    def test_first_20_bars_have_no_multiple(self):
        res = run([100] * 25)
        self.assertIsNone(res['d000']['multiple'])
        self.assertIsNone(res['d019']['multiple'])
        self.assertAlmostEqual(res['d020']['multiple'], 1.0)

    def test_zero_average_or_missing_volume_is_null_not_error(self):
        res = run([0] * 20 + [500])
        self.assertIsNone(res['d020']['multiple'])
        res2 = run([100] * 20 + [None, 200])
        self.assertIsNone(res2['d020']['volume'])
        self.assertAlmostEqual(res2['d021']['multiple'], 2.0)           # 빈 값은 평균에서 빼고 직전 20봉으로 계산

    def test_stock_search_tooltip_wiring_and_label(self):
        ss = open(os.path.join(ROOT, 'js', 'stock-search.js'), encoding='utf-8').read()
        self.assertIn('core.volumeMultiples(bars, 20)', ss)
        self.assertIn('stockVolumeTooltipHtml(volInfo, param.time)', ss)
        self.assertIn("timeframe === 'day' ? '20일' : '직전 20봉'", ss)
        self.assertIn('평균 대비', ss)


if __name__ == '__main__':
    unittest.main()
