# -*- coding: utf-8 -*-
"""종목분석 매물대와 MY 매물대가 같은 값을 내는지(2026-09-15).

사용자 지적: "종목분석 > 매물대랑 MY에서 보여주는 매물대랑 달라". 종목분석은 조회된 날만 누적되는
실제 체결가(/pbar-tratio), MY는 최근 120거래일 일봉 추정치라 달랐다. 사용자 선택("120거래일 일봉")에
따라 종목분석도 MY와 같은 계산을 쓴다. 두 파일의 실제 함수를 node로 실행해 같은 일봉에서 구간 경계·
거래량·최대 매물대가 똑같이 나오는지 고정한다.
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
    match = re.search(r'  var %s = [^;]+;\n' % re.escape(name), source)
    return match.group(0)


def _sample_daily():
    rows = []
    for i in range(130):
        base = 50000 + (i % 17) * 400 - (i % 5) * 250
        rows.append({
            'date': '2026-%02d-%02d' % (3 + i // 28, 1 + i % 28),
            'open': base, 'high': base + 900 + (i % 7) * 100, 'low': base - 700,
            'close': base + 200, 'volume': 100000 + (i * 7919) % 50000,
        })
    rows[10]['low'] = None                       # 값이 빈 날은 뺀다
    rows[20]['volume'] = 0                       # 거래량 0인 날은 범위에만 들어간다
    rows[30]['high'] = rows[30]['low'] = rows[30]['close'] = 51000   # 고가=저가(상하한가 등)
    rows[40]['volume'] = '123,456'               # 쉼표 문자열도 같은 규칙으로 읽는다
    rows.reverse()                               # 역순으로 와도 날짜순으로 정리한다
    return rows


@unittest.skipUnless(shutil.which('node'), 'node 필요')
class VolumeProfileParityTests(unittest.TestCase):
    def run_node(self):
        flow = _read('js/foreign-flow.js')
        my = _read('js/my-dashboard.js')
        script = '\n'.join([
            _var(flow, 'APT_LOOKBACK_DAYS'),
            _var(flow, 'VP_LOOKBACK_DAYS'),
            _var(flow, 'VP_BIN_COUNT'),
            _function(flow, 'volumeProfileNumber'),
            _function(flow, 'normalizeDailyForVolumeProfile'),
            _function(flow, 'computeVolumeProfile'),
            _function(flow, 'buildApproxVolumeProfile'),
            'const flowApi = { build: buildApproxVolumeProfile };',
            '(function () {',
            _var(my, 'MY_VOLUME_LOOKBACK_DAYS'),
            _var(my, 'MY_VOLUME_BIN_COUNT'),
            _function(my, 'number'),
            _function(my, 'buildDailyVolumeProfile'),
            '  global.myBuild = buildDailyVolumeProfile;',
            '})();',
            'const daily = JSON.parse(process.env.DAILY);',
            'const flow = flowApi.build(daily, 24);',
            'const mine = myBuild({ daily: daily }, "000000");',
            'console.log(JSON.stringify({',
            '  flow: { days: flow.daysIncluded, poc: flow.profile.pocIndex,',
            '          bins: flow.profile.bins.map(b => [b.low, b.high, b.volume]) },',
            '  my: { days: mine.daysIncluded, pocLow: mine.pocLow, pocHigh: mine.pocHigh,',
            '        bins: mine.bins.map(b => [b.low, b.high, b.volume]) }',
            '}));',
        ])
        env = dict(os.environ, DAILY=json.dumps(_sample_daily()))
        out = subprocess.run(['node', '-e', script], capture_output=True, text=True, encoding='utf-8',
                             env=env, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        return json.loads(out.stdout)

    def test_stock_analysis_and_my_produce_identical_bins(self):
        result = self.run_node()
        flow, mine = result['flow'], result['my']
        self.assertEqual(flow['days'], 120)
        self.assertEqual(flow['days'], mine['days'])
        self.assertEqual(len(flow['bins']), 24)
        self.assertEqual(flow['bins'], mine['bins'])
        poc = flow['bins'][flow['poc']]
        self.assertEqual([poc[0], poc[1]], [mine['pocLow'], mine['pocHigh']])

    def test_stock_analysis_card_no_longer_reads_pbar_tratio(self):
        flow = _read('js/foreign-flow.js')
        self.assertNotIn("'/pbar-tratio/'", flow)
        self.assertNotIn('computeRealVolumeProfile', flow)
        self.assertIn('var APT_LOOKBACK_DAYS = 120;', flow)
        self.assertIn('var APT_BIN_DEFAULT_INDEX = 2; // 24층 기본', flow)
        self.assertIn('var APT_BIN_STEPS = [12, 18, 24, 36, 48];', flow)
        self.assertIn("buildSimpleVolumeProfileHtml(profile, currentPrice, avgPrice, '최근 ' + days + '거래일 일봉')", flow)


if __name__ == '__main__':
    unittest.main()
