# -*- coding: utf-8 -*-
"""매물대 분석(2026-10-19) 계약: js/volume-profile-analysis.js + foreign-flow/stock-search 연결.

실제 함수를 node로 실행해 확인한다(가짜 값 하드코딩 없이 합성 일봉으로 성질을 검증).
- 구간 거래량 합 = 원본 봉 거래량 합(보존), 비중 합 = 100%
- 최대 매물대·가까운 저항/지지·현재가까지 거리
- 구간 수(12/24/48)·기간(20/60/120)이 바뀌어도 합계 일관, 자료 부족·결측 처리
- 구간 폭이 다른 입력은 밀도로 비교
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
    return re.search(r'  var %s = [^;]+;' % re.escape(name), source).group(0) + '\n'


def _daily(count, base=100000, seed=7, volume=1000):
    """결정적인 합성 일봉: 가격이 완만히 흔들리고 한 구간에서 거래가 몰린다."""
    rows = []
    x = seed
    price = base
    for i in range(count):
        x = (x * 1103515245 + 12345) % 2147483648
        step = ((x % 2001) - 1000) / 1000.0
        price = max(1000, price + step * base * 0.01)
        low = int(price * 0.985 / 100) * 100
        high = int(price * 1.015 / 100) * 100
        close = int(price / 100) * 100
        rows.append({'date': '2026-%02d-%02d' % (1 + i // 28, 1 + i % 28), 'open': close, 'high': high,
                     'low': low, 'close': close, 'volume': volume + (x % 500)})
    return rows


@unittest.skipUnless(shutil.which('node'), 'node 필요')
class VolumeProfileAnalysisTests(unittest.TestCase):
    def run_node(self, body, payload=None):
        flow = _read('js/foreign-flow.js')
        parts = ["const VP = require(%s);" % json.dumps(os.path.join(ROOT, 'js', 'volume-profile-analysis.js'))]
        parts += [_var(flow, name) for name in ('APT_LOOKBACK_DAYS', 'APT_BIN_STEPS', 'APT_BIN_DEFAULT_INDEX',
                                                 'VP_LOOKBACK_DAYS', 'VP_BIN_COUNT')]
        parts += [_function(flow, name) for name in (
            'krxTickSize', 'roundPriceUnit', 'volumeProfileGrid', 'computeVolumeProfile',
            'volumeProfileNumber', 'normalizeDailyForVolumeProfile', 'buildApproxVolumeProfile')]
        parts.append('const payload = JSON.parse(process.env.PAYLOAD || "null");')
        parts.append(body)
        env = dict(os.environ, PAYLOAD=json.dumps(payload))
        out = subprocess.run(['node', '-e', '\n'.join(parts)], capture_output=True, text=True,
                             encoding='utf-8', env=env, timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        return json.loads(out.stdout)

    # ---- 보존·비중 ----
    def test_volume_is_conserved_and_shares_sum_to_100(self):
        daily = _daily(200)
        res = self.run_node('''
const out = {};
[12, 24, 48].forEach(function (bins) {
  [20, 60, 120].forEach(function (days) {
    const est = buildApproxVolumeProfile(payload, bins, days);
    const win = normalizeDailyForVolumeProfile(payload).slice(-days);
    const source = win.reduce((s, r) => s + r.volume, 0);
    const binned = est.profile.bins.reduce((s, b) => s + b.volume, 0);
    const a = VP.analyze(est.profile.bins, win[win.length - 1].close, win.map(r => r.close));
    const share = a.bins.reduce((s, b) => s + b.share, 0);
    out[bins + ':' + days] = { source, binned, share, side: a.aboveShare + a.belowShare, days: est.daysIncluded };
  });
});
console.log(JSON.stringify(out));''', daily)
        for key, row in res.items():
            self.assertAlmostEqual(row['binned'], row['source'], delta=row['source'] * 1e-9, msg=key)
            self.assertAlmostEqual(row['share'], 100, places=6, msg=key)
            self.assertAlmostEqual(row['side'], 100, places=6, msg=key)
            self.assertEqual(row['days'], int(key.split(':')[1]), key)

    def test_poc_is_densest_bin_and_strength_is_relative(self):
        res = self.run_node('''
const bins = [];
for (let i = 0; i < 10; i++) bins.push({ low: 100 + i * 10, high: 110 + i * 10, volume: i === 4 ? 500 : 50 });
const a = VP.analyze(bins, 125, [120, 122, 125]);
console.log(JSON.stringify({ poc: [a.poc.low, a.poc.high], pocShare: a.poc.share, strength: a.bins.map(b => b.strength) }));''')
        self.assertEqual(res['poc'], [140, 150])
        self.assertAlmostEqual(res['pocShare'], 500 / 950 * 100, places=6)
        self.assertEqual(max(res['strength']), 100)
        self.assertAlmostEqual(res['strength'][0], 10, places=6)

    # ---- 가까운 저항·지지·거리 ----
    def test_nearest_resistance_support_and_distances(self):
        res = self.run_node('''
const bins = [];
for (let i = 0; i < 30; i++) {
  const heavy = (i >= 3 && i <= 4) || (i >= 12 && i <= 13) || i === 25;
  bins.push({ low: 1000 + i * 100, high: 1100 + i * 100, volume: heavy ? 1000 : 50 });
}
const a = VP.analyze(bins, 2000, [1900, 1950, 2000]);   // 현재가 2,000: 아래 1300~1500, 위 2200~2300(index 12-13), 최대는 동률
console.log(JSON.stringify({
  zones: a.zones.map(z => [z.low, z.high]),
  res: [a.resistance.low, a.resistance.high], resGap: a.resistanceGap,
  sup: [a.support.low, a.support.high], supGap: a.supportGap,
  inZone: a.inZone, above: a.aboveShare, below: a.belowShare, total: a.total
}));''')
        self.assertEqual(res['zones'], [[1300, 1500], [2200, 2400], [3500, 3600]])
        self.assertEqual(res['res'], [2200, 2400])
        self.assertEqual(res['resGap']['diff'], 200)
        self.assertAlmostEqual(res['resGap']['pct'], 10.0, places=6)
        self.assertEqual(res['sup'], [1300, 1500])
        self.assertEqual(res['supGap']['diff'], 500)
        self.assertAlmostEqual(res['supGap']['pct'], 25.0, places=6)
        self.assertIsNone(res['inZone'])
        self.assertAlmostEqual(res['above'] + res['below'], 100, places=6)

    def test_flat_profile_makes_no_zones_and_says_so(self):
        res = self.run_node('''
const bins = [];
for (let i = 0; i < 20; i++) bins.push({ low: 100 + i * 5, high: 105 + i * 5, volume: 100 + (i % 3) });
const a = VP.analyze(bins, 150, [148, 150]);
console.log(JSON.stringify({ zones: a.zones.length, key: a.state.key, res: a.resistance, sup: a.support }));''')
        self.assertEqual(res['zones'], 0)
        self.assertEqual(res['key'], 'none')
        self.assertIsNone(res['res'])
        self.assertIsNone(res['sup'])

    def test_thin_zone_is_found_next_to_a_heavy_zone_and_compared_with_it(self):
        res = self.run_node('''
const bins = [];
for (let i = 0; i < 20; i++) {
  const vol = i >= 4 && i <= 6 ? 1000 : (i >= 7 && i <= 8 ? 20 : 300);
  bins.push({ low: 200 + i * 10, high: 210 + i * 10, volume: vol });
}
const a = VP.analyze(bins, 300, [290, 300]);
console.log(JSON.stringify({ thin: a.thin.map(t => ({ low: t.low, high: t.high, share: t.share, ratio: t.ratioToNeighbor, nb: t.neighborBins, where: t.where })),
  text: VP.thinText(a.thin[0]) }));''')
        self.assertTrue(res['thin'])
        first = res['thin'][0]
        self.assertEqual((first['low'], first['high']), (270, 290))
        self.assertLess(first['ratio'], 10)
        self.assertIn('인접 가격대보다 추정 거래량이 적은 구간', res['text'])
        self.assertNotIn('상승', res['text'])

    # ---- 구간 폭 ----
    def test_unequal_bin_widths_are_compared_by_density(self):
        res = self.run_node('''
const bins = [
  { low: 100, high: 110, volume: 100 },   // 밀도 10
  { low: 110, high: 130, volume: 150 },   // 폭 2배, 밀도 7.5 -> 거래량은 커도 밀도는 낮다
  { low: 130, high: 140, volume: 100 }
];
const a = VP.analyze(bins, 105, [105]);
console.log(JSON.stringify({ uniform: a.uniformWidth, strength: a.bins.map(b => Math.round(b.strength * 10) / 10), poc: a.pocIndex }));''')
        self.assertFalse(res['uniform'])
        self.assertEqual(res['strength'], [100, 75, 100])
        self.assertEqual(res['poc'], 0)

    def test_bin_count_change_keeps_poc_region_and_totals(self):
        daily = _daily(130)
        res = self.run_node('''
const out = [];
[12, 24, 48].forEach(function (n) {
  const est = buildApproxVolumeProfile(payload, n, 120);
  const a = VP.analyze(est.profile.bins, 100000, []);
  out.push({ n, bins: a.binCount, poc: [a.poc.low, a.poc.high], total: a.total });
});
console.log(JSON.stringify(out));''', daily)
        totals = {round(r['total'], 3) for r in res}
        self.assertEqual(len(totals), 1)                      # 구간 수가 달라도 전체 거래량은 같다
        centers = [(r['poc'][0] + r['poc'][1]) / 2 for r in res]
        self.assertLess(max(centers) - min(centers), 0.2 * max(centers))   # 최대 매물대는 같은 가격 부근에 남는다

    # ---- 기간·결측 ----
    def test_short_history_reports_actual_days_and_missing_rows_are_skipped(self):
        daily = _daily(30)
        daily[3]['volume'] = None
        daily[4]['high'] = None
        daily[5]['low'], daily[5]['high'] = 200, 100         # 고가<저가
        daily[6]['close'] = 0
        res = self.run_node('''
const est = buildApproxVolumeProfile(payload, 24, 120);
const clean = normalizeDailyForVolumeProfile(payload);
console.log(JSON.stringify({ days: est.daysIncluded, clean: clean.length, binned: est.profile.bins.reduce((s, b) => s + b.volume, 0),
  source: clean.reduce((s, r) => s + r.volume, 0) }));''', daily)
        self.assertEqual(res['clean'], 30 - 3)                # 고가 없음·고가<저가·종가 0만 제외, 거래량 없음은 0으로 유지
        self.assertEqual(res['days'], res['clean'])           # 요청 120이어도 실제 포함 일수만
        self.assertAlmostEqual(res['binned'], res['source'], delta=res['source'] * 1e-9)

    def test_all_zero_volume_returns_nothing_instead_of_fake_profile(self):
        daily = _daily(40)
        for row in daily:
            row['volume'] = 0
        res = self.run_node('console.log(JSON.stringify({ est: buildApproxVolumeProfile(payload, 24, 60) }));', daily)
        self.assertIsNone(res['est'])

    def test_periods_20_60_120_differ_and_window_is_the_latest_days(self):
        daily = _daily(150)
        res = self.run_node('''
const out = {};
[20, 60, 120].forEach(function (days) {
  const est = buildApproxVolumeProfile(payload, 24, days);
  const win = normalizeDailyForVolumeProfile(payload).slice(-days);
  out[days] = { days: est.daysIncluded, min: est.profile.minLow, max: est.profile.maxHigh,
    lo: Math.min.apply(null, win.map(r => r.low)), hi: Math.max.apply(null, win.map(r => r.high)) };
});
console.log(JSON.stringify(out));''', daily)
        for days in ('20', '60', '120'):
            row = res[days]
            self.assertEqual(row['days'], int(days))
            self.assertLessEqual(row['min'], row['lo'])       # 격자는 구간 최저/최고를 감싼다
            self.assertGreaterEqual(row['max'], row['hi'])
        self.assertLessEqual(res['20']['hi'] - res['20']['lo'], res['120']['hi'] - res['120']['lo'])

    # ---- 상태 판정 ----
    def test_state_transitions_use_numbers_and_avoid_certain_language(self):
        res = self.run_node('''
function profile(heavyFrom, heavyTo) {
  const bins = [];
  for (let i = 0; i < 20; i++) bins.push({ low: 1000 + i * 100, high: 1100 + i * 100, volume: i >= heavyFrom && i <= heavyTo ? 1000 : 40 });
  return bins;
}
const bins = profile(8, 9);                        // 1800~2000이 집중 구간
const out = {};
out.below = VP.analyze(bins, 1700, [1650, 1680, 1700]).state;                         // 저항 후보 아래
out.inside = VP.analyze(bins, 1850, [1700, 1750, 1850]).state;                        // 구간 진입
out.tryup = VP.analyze(bins, 1980, [1700, 1900, 1980]).state;                         // 상단 근처
out.held = VP.analyze(bins, 2100, [1850, 1900, 2050, 2080, 2100]).state;              // 돌파 후 유지
out.reenter = VP.analyze(bins, 1900, [1850, 2050, 2080, 1950, 1900]).state;           // 위에서 마감한 뒤 구간 안으로
out.lost = VP.analyze(bins, 1750, [1900, 2050, 2020, 1900, 1750]).state;              // 위에서 마감한 뒤 구간 아래
out.support = VP.analyze(bins, 2030, [2200, 2150, 2100, 2050, 2030]).state;           // 위에서 내려와 지지 후보에 접근
console.log(JSON.stringify(out));''')
        self.assertEqual(res['below']['key'], 'below-resistance')
        self.assertEqual(res['inside']['key'], 'inside')
        self.assertEqual(res['tryup']['key'], 'breakout-try')
        self.assertEqual(res['held']['key'], 'breakout-held')
        self.assertEqual(res['reenter']['key'], 'reenter')
        self.assertEqual(res['lost']['key'], 'support-lost')
        self.assertEqual(res['support']['key'], 'support-near')
        self.assertRegex(res['below']['text'], r'\d+\.\d%')          # 근거 수치
        for state in res.values():
            for banned in ('상승 확정', '성공 보장', '매집 완료', '매도 대기 물량이다'):
                self.assertNotIn(banned, state['text'] + state['label'])

    # ---- 연결 계약 ----
    def test_wiring_contracts(self):
        flow = _read('js/foreign-flow.js')
        search = _read('js/stock-search.js')
        core = _read('js/chart-core.js')
        my = _read('js/my-dashboard.js')
        self.assertIn("vp: { file: 'js/volume-profile-analysis.js', global: 'NineVolumeProfile'", core)
        self.assertIn("var CHART_OPTIONAL = ['drawing', 'memo', 'vp'];", search)
        self.assertIn('VP.analyze(profile.bins', search)
        self.assertIn("data-vp-period", flow)
        self.assertIn('var VP_PERIODS = [20, 60, 120];', flow)
        self.assertIn('ensureVolumeProfileAnalysis: ensureVpAnalysis,', flow)
        # MY는 계산·그래프를 종목분석 것을 그대로 쓴다(분석 패널 포함)
        self.assertIn('api.renderVolumeProfileHtml(daily, number(livePrice, lastClose), holdingAveragePrice, code)', my)
        # 기존 호가창 연동 계약은 그대로
        self.assertIn("global.__ssVolumeProfile = profile ? { code: code, bins: profile.bins, maxVolume: profile.maxVolume } : null;", search)


if __name__ == '__main__':
    unittest.main()
