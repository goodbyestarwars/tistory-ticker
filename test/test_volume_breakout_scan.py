# -*- coding: utf-8 -*-
"""전일 거래량을 개장 10분 만에 넘어선 종목 스캔.

2026-09-04 요청: "차트검색에 전일 거래량이 오늘 10분 만에 돌파한거 추가".

이 스캔은 차트검색의 다른 탭과 성격이 다르다 - 나머지는 장 마감 뒤 일봉 배치인데
이건 09:10 KST 한 번 찍는 장중 스냅샷이다. 판정 자체는 순수 함수라 여기서 고정한다.
"""
import os
import sys
import unittest

CLOUD_VM_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
if CLOUD_VM_DIR not in sys.path:
    sys.path.insert(0, CLOUD_VM_DIR)

import volume_breakout_scan as vbs


class FakeConn(object):
    pass


def board_with(rows, section='tradeVolume'):
    return {'sections': {section: rows}}


class VolumeBreakoutScanTests(unittest.TestCase):

    def setUp(self):
        self._orig_loader = vbs.db_schema.load_daily_prices
        self._orig_today = vbs.today_kst
        vbs.today_kst = lambda: '2026-09-04'
        self.daily = {}
        vbs.db_schema.load_daily_prices = lambda conn, code: self.daily.get(code, [])

    def tearDown(self):
        vbs.db_schema.load_daily_prices = self._orig_loader
        vbs.today_kst = self._orig_today

    def test_includes_when_today_volume_reaches_yesterday(self):
        self.daily['000001'] = [{'date': '2026-09-03', 'volume': 100000}]
        board = board_with([{'code': '000001', 'name': '테스트', 'trade_volume': 120000,
                             'price': 5000, 'change_rate': 7.5}])
        matches, candidates = vbs.scan(board, FakeConn(), 'now')
        self.assertEqual(candidates, 1)
        self.assertEqual([m['code'] for m in matches], ['000001'])
        self.assertAlmostEqual(matches[0]['patternDetail']['volumeRatio'], 1.2, places=4)
        self.assertEqual(matches[0]['patternDetail']['prevDate'], '2026-09-03')

    def test_equal_volume_counts_as_a_breakout(self):
        # "돌파"는 전일 하루치에 도달한 시점으로 본다. 같은 값을 빼면 딱 맞은 종목이 사라진다.
        self.daily['000001'] = [{'date': '2026-09-03', 'volume': 100000}]
        matches, _ = vbs.scan(board_with([{'code': '000001', 'trade_volume': 100000}]), FakeConn(), 'now')
        self.assertEqual(len(matches), 1)

    def test_excludes_when_today_volume_is_short(self):
        self.daily['000001'] = [{'date': '2026-09-03', 'volume': 100000}]
        matches, _ = vbs.scan(board_with([{'code': '000001', 'trade_volume': 99999}]), FakeConn(), 'now')
        self.assertEqual(matches, [])

    def test_today_row_in_daily_prices_is_not_used_as_the_previous_day(self):
        """가장 위험한 함정: daily_prices에 오늘 행이 이미 있으면 오늘을 오늘과 비교하게 된다.

        그러면 배수가 항상 1.0 근처가 되어 조건이 무의미해진다.
        """
        self.daily['000001'] = [
            {'date': '2026-09-03', 'volume': 100000},
            {'date': '2026-09-04', 'volume': 500000},
        ]
        matches, _ = vbs.scan(board_with([{'code': '000001', 'trade_volume': 500000}]), FakeConn(), 'now')
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]['patternDetail']['prevDate'], '2026-09-03')
        self.assertAlmostEqual(matches[0]['patternDetail']['volumeRatio'], 5.0, places=4)

    def test_skips_codes_without_previous_volume(self):
        # 신규 상장 등 일봉이 없는 종목. 배수를 계산할 수 없으므로 넣지 않는다.
        matches, _ = vbs.scan(board_with([{'code': '000002', 'trade_volume': 999999}]), FakeConn(), 'now')
        self.assertEqual(matches, [])

    def test_sections_are_merged_without_duplicates(self):
        self.daily['000001'] = [{'date': '2026-09-03', 'volume': 100000}]
        board = {'sections': {
            'tradeVolume': [{'code': '000001', 'trade_volume': 500000}],
            'tradeAmount': [{'code': '000001', 'trade_volume': 500000}],
            'volumeGrowth': [{'code': '000001', 'trade_volume': 500000}],
        }}
        matches, candidates = vbs.scan(board, FakeConn(), 'now')
        self.assertEqual(candidates, 1)
        self.assertEqual(len(matches), 1)

    def test_sorted_by_ratio_and_capped(self):
        for i in range(vbs.MAX_MATCHES + 5):
            code = '%06d' % i
            self.daily[code] = [{'date': '2026-09-03', 'volume': 100000}]
        rows = [{'code': '%06d' % i, 'trade_volume': 100000 + i * 1000} for i in range(vbs.MAX_MATCHES + 5)]
        matches, _ = vbs.scan(board_with(rows), FakeConn(), 'now')
        self.assertEqual(len(matches), vbs.MAX_MATCHES)
        ratios = [m['patternDetail']['volumeRatio'] for m in matches]
        self.assertEqual(ratios, sorted(ratios, reverse=True))

    def test_illiquid_shells_are_filtered_out(self):
        """2026-09-04 운영 실측에서 드러난 문제.

        거래증가율 순위 상위가 전부 껍데기였다 - 티와이홀딩스우 4,755주,
        "하나 인버스 2X 콩 선물 ETN(H)" 402주처럼 전일 거래량이 거의 0이라 증가율이
        상한값(9999.99)에 박힌 종목들이다. 이런 건 "전일 거래량 돌파"를 항상 통과해
        목록을 덮어버린다.
        """
        # 전일 거래량이 하한 미만이면 배수가 아무리 커도 제외한다.
        self.daily['000001'] = [{'date': '2026-09-03', 'volume': 400}]
        matches, _ = vbs.scan(board_with([{'code': '000001', 'trade_volume': 4755}]), FakeConn(), 'now')
        self.assertEqual(matches, [])

        # 오늘 거래량이 하한 미만이어도 제외한다(전일이 더 적었더라도).
        self.daily['000002'] = [{'date': '2026-09-03', 'volume': vbs.MIN_PREV_VOLUME}]
        matches, _ = vbs.scan(board_with([{'code': '000002', 'trade_volume': 402}]), FakeConn(), 'now')
        self.assertEqual(matches, [])

    def test_etfs_are_excluded(self):
        # 거래량 상위는 KODEX 인버스 같은 지수 ETF가 상시 차지한다. 차트검색은 종목을
        # 찾는 화면이라 이들이 들어가면 목록이 쓸모없어진다.
        self.daily['069500'] = [{'date': '2026-09-03', 'volume': 1000000}]
        rows = [{'code': '069500', 'name': 'KODEX 인버스', 'trade_volume': 5000000}]
        matches, _ = vbs.scan(board_with(rows), FakeConn(), 'now', etf_codes={'069500'})
        self.assertEqual(matches, [])
        # ETF 목록을 못 받아왔을 때(빈 집합)는 제외하지 않고 그대로 진행한다.
        matches, _ = vbs.scan(board_with(rows), FakeConn(), 'now', etf_codes=set())
        self.assertEqual(len(matches), 1)

    def test_match_shape_matches_the_other_pattern_tabs(self):
        # js/pattern-scan.js가 모든 탭에 같은 렌더를 쓴다 - 키가 빠지면 그 탭만 깨진다.
        self.daily['000001'] = [{'date': '2026-09-03', 'volume': 100000}]
        matches, _ = vbs.scan(board_with([{'code': '000001', 'name': '테스트',
                                           'trade_volume': 200000, 'price': 100}]), FakeConn(), 'now')
        item = matches[0]
        for key in ('code', 'name', 'price', 'changeRate', 'date', 'miniChart',
                    'score', 'reasons', 'interpretation', 'patternDetail'):
            self.assertIn(key, item)


if __name__ == '__main__':
    unittest.main()


class VolumeBreakoutWiringTests(unittest.TestCase):
    """VM 라우트·GAS·프론트가 같은 필드 이름으로 이어져 있는지.

    셋 중 하나만 빠지면 탭은 보이는데 항상 비어 있는(원인을 찾기 어려운) 상태가 된다.
    프론트는 VM을 먼저 보고 실패하면 GAS로 폴백하므로 두 응답 모양이 같아야 한다.
    """

    ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    def read(self, rel):
        with open(os.path.join(self.ROOT, rel), encoding='utf-8') as f:
            return f.read()

    def test_vm_route_serves_the_section(self):
        source = self.read('scripts/cloud-vm/main.py')
        self.assertIn("'volumeBreakout': patterns.get('volumeBreakout') or [],", source)
        self.assertIn("'volumeBreakoutScannedAt': data.get('volumeBreakoutScannedAt'),", source)

    def test_gas_fallback_has_the_same_shape(self):
        source = self.read('gas/ticker-proxy.gs')
        self.assertIn('volumeBreakout: (patternScan.patterns && patternScan.patterns.volumeBreakout) || []', source)
        self.assertIn('volumeBreakoutScannedAt: data.volumeBreakoutScannedAt || null,', source)

    def test_scan_writes_the_same_key(self):
        source = self.read('scripts/cloud-vm/volume_breakout_scan.py')
        self.assertIn("existing['patternScan']['patterns']['volumeBreakout'] = matches", source)
        self.assertIn("existing['volumeBreakoutScannedAt'] = scanned_at", source)
        # 다른 스캐너 결과를 덮어쓰지 않으려면 잠금이 걸린 update()를 써야 한다.
        self.assertIn('daily_scan_cache.update(_apply)', source)

    def test_frontend_tab_exists(self):
        source = self.read('js/pattern-scan.js')
        self.assertIn("{ key: 'volumeBreakout', label: '거래량 돌파(10분)'", source)
        self.assertIn("if (patternKey === 'volumeBreakout') {", source)
        # 이 탭은 일봉 재판정 대상이 아니다 - 상세는 스냅샷을 그대로 쓴다.
        self.assertNotIn('volumeBreakout: true', source)

    def test_timer_registers_itself_without_a_manual_step(self):
        """수동 등록을 전제로 두면 안 된다.

        처음에는 VM에서 setup 스크립트를 한 번 직접 돌리게 했는데, Cloud Shell과 VM을
        구분하지 못해 반복 실패했고 등록 전까지 탭이 계속 비어 있었다. deploy_check.sh가
        이미 5분마다 sudo 권한으로 도므로 거기서 유닛이 없을 때만 등록한다.
        """
        deploy = self.read('scripts/cloud-vm/deploy_check.sh')
        self.assertIn('ensure_volume_breakout_timer() {', deploy)
        # 유닛 파일 존재만 보고 지나가야 매 회차 재등록을 하지 않는다.
        self.assertIn('if [ -f /etc/systemd/system/kiwoom-volumebreakout.timer ]; then', deploy)
        # 실패해도 배포를 되돌리면 안 된다.
        self.assertIn('ensure_volume_breakout_timer || true', deploy)

    def test_timer_runs_on_weekday_mornings_only(self):
        setup = self.read('scripts/cloud-vm/setup_volumebreakout_timer.sh')
        # 09:10 KST = 00:10 UTC, 평일만.
        self.assertIn('OnCalendar=Mon..Fri *-*-* 00:10:00', setup)
        # Persistent=true면 VM이 꺼져 있다 켜질 때 지난 회차를 몰아서 실행한다 -
        # 장중 스냅샷은 그 시각에 찍어야 의미가 있으므로 뒤늦게 돌면 안 된다.
        self.assertIn('Persistent=false', setup)
