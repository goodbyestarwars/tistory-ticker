# -*- coding: utf-8 -*-
"""ETF 전략 스캔이 전종목 목록을 한 번만 받는지(2026-09-21 검토에서 발견).

들어올 때 코드:

    existing.setdefault('universe', len(strategy_scan.load_full_universe()))

`setdefault`는 기본값을 **먼저 계산한다.** 그래서 `universe` 키가 이미 있어도
`load_full_universe()`가 매 실행 한 번 더 돌았다 - 이건 GitHub Pages에서 전종목 맵을
받아오는 네트워크 호출이다(strategy_scan.load_full_universe 참고).
"""

import io
import json
import os
import sys
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))

import etf_strategy_scan  # noqa: E402

UNIVERSE = [
    {'name': 'KODEX 200', 'code': '069500', 'is_etf': True},
    {'name': 'TIGER 미국S&P500', 'code': '360750', 'is_etf': True},
    {'name': '삼성전자', 'code': '005930', 'is_etf': False},
]


class LoadsTheUniverseOnceTest(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.written = {}

        def fake_load():
            self.calls.append(1)
            return list(UNIVERSE)

        def fake_open(path, mode='r', **kwargs):
            if 'w' in mode:
                handle = io.StringIO()
                handle.close = lambda: self.written.update(json.loads(handle.getvalue()))
                return handle
            raise FileNotFoundError(path)

        self.patches = [
            mock.patch.object(etf_strategy_scan.market_clock, 'skip_scan_today',
                              return_value=(False, '2026-09-21')),
            mock.patch.object(etf_strategy_scan.strategy_scan, 'load_dotenv'),
            mock.patch.object(etf_strategy_scan.strategy_scan, 'load_full_universe',
                              side_effect=fake_load),
            mock.patch.object(etf_strategy_scan.strategy_scan, 'preload_daily_prices',
                              return_value={}),
            mock.patch.object(etf_strategy_scan.strategy_scan, 'scan_etf_returns',
                              return_value=({'전체': [{'code': '069500'}]}, 2)),
            mock.patch.object(etf_strategy_scan.db_schema, 'get_conn', return_value=mock.MagicMock()),
            mock.patch.object(etf_strategy_scan.db_schema, 'create_schema'),
            mock.patch.object(etf_strategy_scan.scan_forward, 'record_grouped_hits', return_value={}),
            mock.patch.object(etf_strategy_scan.scan_forward, 'today_kst', return_value='2026-09-21'),
            mock.patch.object(etf_strategy_scan.os.path, 'exists', return_value=False),
            mock.patch.object(etf_strategy_scan.os, 'replace'),
            mock.patch('builtins.open', side_effect=fake_open),
            mock.patch.object(etf_strategy_scan.strategy_scan, 'log'),
        ]
        for patch in self.patches:
            patch.start()
            self.addCleanup(patch.stop)

    def test_the_universe_is_fetched_exactly_once(self):
        etf_strategy_scan.main()
        self.assertEqual(len(self.calls), 1,
                         '전종목 목록은 네트워크 호출이다 - 한 번만 받아 재사용해야 한다')

    def test_only_etfs_are_scanned(self):
        etf_strategy_scan.main()
        scanned = etf_strategy_scan.strategy_scan.scan_etf_returns.call_args[0][0]
        self.assertEqual([stock['code'] for stock in scanned], ['069500', '360750'])

    def test_universe_count_uses_the_full_list_not_just_etfs(self):
        etf_strategy_scan.main()
        self.assertEqual(self.written.get('universe'), len(UNIVERSE))


class HolidayTest(unittest.TestCase):
    def test_a_closed_day_scans_nothing(self):
        with mock.patch.object(etf_strategy_scan.market_clock, 'skip_scan_today',
                               return_value=(True, '2026-10-03')), \
                mock.patch.object(etf_strategy_scan.strategy_scan, 'load_full_universe') as load, \
                mock.patch.object(etf_strategy_scan.strategy_scan, 'log'):
            etf_strategy_scan.main()
        load.assert_not_called()


if __name__ == '__main__':
    unittest.main()
