# -*- coding: utf-8 -*-
"""종목분석·MY 매물대 통일 + 호가단위 경계 계약(2026-09-15).

사용자 지적:
- "종목분석 > 매물대랑 MY에서 보여주는 매물대랑 달라" → 사용자 선택 "120거래일 일봉".
- "그래프 모양 등 다 통일해 종목분석 쪽으로 맞춰" → MY는 종목분석(js/foreign-flow.js)의 계산·그래프를 그대로 쓴다.
- "뒷자리가 원단위로 끝나서 신뢰가 좀 이상해" → 구간 경계를 KRX 호가단위의 배수로 맞춘다.

두 파일의 실제 함수를 node로 실행해 경계가 실제 호가인지, 그래프 행이 고르게 묶이는지 고정한다.
"""

import json
import os
import re
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as handle:
        return handle.read()


def _function(source, name):
    start = source.index('  function %s(' % name)
    end = source.index('\n  }\n', start) + len('\n  }\n')
    return source[start:end]


def _var(source, name):
    # 세미콜론 뒤에 줄 끝 주석이 붙은 선언도 있다(var APT_BIN_DEFAULT_INDEX = 2; // 24층 기본).
    return re.search(r'  var %s = [^;]+;' % re.escape(name), source).group(0) + '\n'


def _daily(base, step, count=130, decimals=False):
    rows = []
    for i in range(count):
        mid = base + ((i % 17) - 8) * step
        low, high = mid - step * 3, mid + step * 4
        if decimals:
            low, high, mid = round(low + 0.37, 2), round(high + 0.81, 2), round(mid + 0.5, 2)
        else:
            low, high, mid = int(low), int(high), int(mid)
        rows.append({'date': '2026-%02d-%02d' % (3 + i // 28, 1 + i % 28), 'open': mid,
                     'high': high, 'low': low, 'close': mid, 'volume': 100000 + (i * 7919) % 50000})
    return rows


@unittest.skipUnless(shutil.which('node'), 'node 필요')
class TickAlignedVolumeProfileTests(unittest.TestCase):
    def run_node(self, cases):
        flow = _read('js/foreign-flow.js')
        parts = [_var(flow, name) for name in ('APT_LOOKBACK_DAYS', 'APT_BIN_STEPS', 'APT_BIN_DEFAULT_INDEX',
                                                 'VP_LOOKBACK_DAYS', 'VP_BIN_COUNT')]
        parts += [_function(flow, name) for name in (
            'krxTickSize', 'roundPriceUnit', 'volumeProfileGrid', 'computeVolumeProfile',
            'volumeProfileNumber', 'normalizeDailyForVolumeProfile', 'buildApproxVolumeProfile',
            'floorToKrxTick', 'ceilToKrxTick', 'buildVolumeProfileSummary', 'compactAptProfileBins',
            'attachAptPriceLimits')]
        parts.append('''
const cases = JSON.parse(process.env.CASES);
console.log(JSON.stringify(cases.map(function (daily) {
  const estimate = buildApproxVolumeProfile(daily, 24);
  const summary = buildVolumeProfileSummary(daily);
  return {
    bins: estimate.profile.bins.map(b => [b.low, b.high]),
    rows: compactAptProfileBins(estimate.profile, 12).map(r => [r.low, r.high, r.end - r.start + 1]),
    integerPrices: estimate.profile.integerPrices,
    pocLow: summary.pocLow, pocHigh: summary.pocHigh, days: summary.daysIncluded,
    limits: attachAptPriceLimits(estimate.profile, 249500)
  };
})));''')
        env = dict(os.environ, CASES=json.dumps(cases))
        out = subprocess.run(['node', '-e', '\n'.join(parts)], capture_output=True, text=True,
                             encoding='utf-8', env=env, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        return json.loads(out.stdout)

    def assert_grid(self, result, unit, decimals=False):
        bins = result['bins']
        # 요청 24구간: 폭을 호가단위 정수배로 올리므로 요청값보다 약간 많아질 수는 있어도 크게 줄지 않는다.
        self.assertGreaterEqual(len(bins), 22)
        self.assertLessEqual(len(bins), 27)
        for low, high in bins:
            for value in (low, high):
                if decimals:
                    self.assertAlmostEqual(value * 100, round(value * 100), places=6)
                else:
                    self.assertEqual(value % unit, 0, value)
        for (_, high), (low, _) in zip(bins, bins[1:]):
            self.assertEqual(high, low)        # 구간이 빈틈 없이 이어진다
        widths = {round(high - low, 6) for low, high in bins}
        self.assertEqual(len(widths), 1)       # 모든 구간 폭이 같다

    def test_krw_boundaries_are_real_krx_ticks_and_rows_are_even(self):
        big, small = self.run_node([_daily(250000, 3000), _daily(1500, 20)])
        self.assert_grid(big, 500)            # 20만~50만원 호가단위 500원
        self.assertTrue(big['integerPrices'])
        self.assertEqual(big['days'], 120)
        self.assertEqual(big['pocLow'] % 500, 0)
        rows = big['rows']
        self.assertLessEqual(len(rows), 13)
        self.assertEqual(len({size for _, _, size in rows[:-1]}), 1)   # 마지막 행만 짧을 수 있다
        self.assert_grid(small, 5)            # 2천원 미만도 ETF 5원 단위에 맞게 최소 5원
        # 시가 249,500원 기준 ±30%: 상한가 324,350 → 500원 절사 324,000 / 하한가 174,650 → 100원 올림 174,700
        self.assertEqual(big['limits']['upperLimit'], 324000)
        self.assertEqual(big['limits']['lowerLimit'], 174700)

    def test_decimal_prices_use_cent_grid(self):
        (us,) = self.run_node([_daily(182.0, 1.5, decimals=True)])
        self.assertFalse(us['integerPrices'])
        self.assert_grid(us, None, decimals=True)


class MyUsesStockAnalysisVolumeProfileTests(unittest.TestCase):
    def test_my_delegates_calculation_and_chart_to_foreign_flow(self):
        my = _read('js/my-dashboard.js')
        flow = _read('js/foreign-flow.js')
        self.assertIn('api.buildVolumeProfileSummary(chart.daily)', my)
        self.assertIn('api.renderVolumeProfileHtml(daily, number(livePrice, lastClose))', my)
        self.assertIn('<div class="ff-vp-host">', my)
        self.assertNotIn('MY_VOLUME_BIN_COUNT', my)
        self.assertNotIn('my-volume-row', my)
        self.assertIn('buildVolumeProfileSummary: buildVolumeProfileSummary,', flow)
        self.assertIn('renderVolumeProfileHtml: renderVolumeProfileHtml,', flow)
        self.assertIn('flowApi.fetchFlowChart(item.code)', my)

    def test_my_page_loads_the_same_chart_styles(self):
        main = _read('js/skin-main.js')
        style = _read('css/foreign-flow.css')
        self.assertIn("css/foreign-flow.css?v=20260915-vp-host-v1", main)
        self.assertIn("link[data-foreign-flow-css]", main)
        for selector in (':is(#foreign-flow, .ff-vp-host) .ff-apt-simple-row {',
                         ':is(#foreign-flow, .ff-vp-host) .ff-apt-chart-wrap.ff-apt-simple {',
                         'html.dark :is(#foreign-flow, .ff-vp-host) .ff-apt-simple-track {'):
            self.assertIn(selector, style)
        # 종목분석 전체 화면 규칙(검색창 등)은 넓히지 않는다.
        self.assertIn('#foreign-flow .ff-search {', style)

    def test_stock_analysis_summary_shows_tick_values(self):
        flow = _read('js/foreign-flow.js')
        self.assertIn("(pocBin ? rangeText(pocBin) + '원' : '-')", flow)
        self.assertIn('won(displayAvg)', flow)
        self.assertNotIn("'/pbar-tratio/'", flow)


if __name__ == '__main__':
    unittest.main()
