# -*- coding: utf-8 -*-
"""차트검색 지수(코스피 등) 실시간(js/stock-search.js): 서버 /ws/market-indicators 스냅샷으로 시세 숫자와 오늘 일봉을 갱신한다."""
import json
import os
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(cases):
    out = subprocess.run(['node', os.path.join(ROOT, 'test', 'index_ws_cli.js'), json.dumps(cases)], capture_output=True, text=True, check=True, encoding='utf-8')
    return json.loads(out.stdout)


BAR = {'date': '2026-10-19', 'open': 100.0, 'high': 105.0, 'low': 98.0, 'close': 102.0}


class IndexLiveBarTest(unittest.TestCase):
    def test_today_kst_date(self):
        ms = 1792378800000                                  # 2026-10-19T03:00:00Z = 12:00 KST
        late = 1792411199000                         # 2026-10-19T11:59:59Z = 20:59:59 KST
        utc_late = 1792448400000                            # 2026-10-19T22:20:00Z = 10-20 07:20 KST
        res = run([{'fn': 'kstToday', 'now': ms}, {'fn': 'kstToday', 'now': late}, {'fn': 'kstToday', 'now': utc_late}])
        self.assertEqual(res, ['2026-10-19', '2026-10-19', '2026-10-20'])

    def test_updates_close_high_low_but_not_open_for_todays_korean_bar(self):
        up, down = run([
            {'fn': 'bar', 'code': 'KOSPI', 'last': BAR, 'price': 108.0, 'today': '2026-10-19'},
            {'fn': 'bar', 'code': 'KOSDAQ', 'last': BAR, 'price': 95.0, 'today': '2026-10-19'}])
        self.assertEqual(up, {'date': '2026-10-19', 'open': 100.0, 'high': 108.0, 'low': 98.0, 'close': 108.0})
        self.assertEqual(down, {'date': '2026-10-19', 'open': 100.0, 'high': 105.0, 'low': 95.0, 'close': 95.0})

    def test_does_not_overwrite_yesterdays_bar_or_us_indexes_or_bad_price(self):
        res = run([
            {'fn': 'bar', 'code': 'KOSPI', 'last': dict(BAR, date='2026-10-16'), 'price': 108.0, 'today': '2026-10-19'},   # 어제 봉
            {'fn': 'bar', 'code': 'NASDAQ_INDEX', 'last': BAR, 'price': 108.0, 'today': '2026-10-19'},                      # 미국 지수는 봉만 30초 조회
            {'fn': 'bar', 'code': 'KOSPI', 'last': BAR, 'price': 0, 'today': '2026-10-19'},
            {'fn': 'bar', 'code': 'KOSPI', 'last': None, 'price': 108.0, 'today': '2026-10-19'}])
        self.assertEqual(res, [None, None, None, None])

    def test_wiring(self):
        ss = open(os.path.join(ROOT, 'js', 'stock-search.js'), encoding='utf-8').read()
        self.assertIn("wss://goodbyestar.cloud/ws/market-indicators", ss)
        self.assertIn("'?symbols=' + encodeURIComponent(row.code)", ss)
        self.assertIn('connectIndexSocket(panel, row);', ss)
        self.assertIn('closeIndexSocket();', ss)                                  # 지수를 닫거나 바꿀 때 소켓을 닫는다
        self.assertIn("packet.type !== 'market-indicators'", ss)
        for sym in ('KOSPI', 'KOSDAQ', 'NASDAQ_INDEX', 'SP500_INDEX', 'DOW_INDEX'):
            self.assertIn(sym + ': 1', ss)
        self.assertNotIn('SOX: 1', ss)                                            # 서버 지원 목록에 없다
        self.assertIn('indexTimer = setInterval(refresh, 30000)', ss)             # 30초 조회는 히스토리·폴백으로 유지
        self.assertIn('indexRefreshNow = refresh;', ss)                           # 숨겨진 탭에서 열어도 보이는 순간 바로 조회한다
        self.assertIn('if (indexRefreshNow) indexRefreshNow();', ss)


class IndexSocketSimulationTest(unittest.TestCase):
    """가짜 WebSocket·가짜 패널로 connectIndexSocket/closeIndexSocket 동작을 실행한다(운영 서버는 Origin 검사가 있어 로컬에서 직접 연결 불가)."""

    def test_message_reconnect_switch_and_close(self):
        out = subprocess.run(['node', os.path.join(ROOT, 'test', 'index_ws_sim.js')], capture_output=True, text=True, check=True, encoding='utf-8')
        r = json.loads(out.stdout)
        self.assertEqual(r['url'], 'wss://goodbyestar.cloud/ws/market-indicators?symbols=KOSPI')
        self.assertIn('108.5', r['quote'])
        self.assertIn('+2.05%', r['quote'])
        self.assertEqual(r['cls'], 'ss-index-quote up')
        self.assertIn('실시간 연결(5초)', r['note'])
        self.assertEqual((r['bar']['high'], r['bar']['close'], r['bar']['open'], r['bar']['low']), (108.5, 108.5, 100, 98))
        self.assertEqual(r['updates'], 1)
        for key in ('unchangedAfterIgnored', 'reconnectScheduled', 'reconnected', 'ignoredAfterSwitch', 'closed', 'noReconnectAfterClose', 'soxSkipped', 'hiddenNoSocket', 'hiddenRemembersTarget', 'visibleConnects'):
            self.assertTrue(r[key], key)


if __name__ == '__main__':
    unittest.main()
