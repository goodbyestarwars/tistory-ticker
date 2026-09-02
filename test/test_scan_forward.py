# -*- coding: utf-8 -*-
"""scan_forward: 스캔 히트 기록 + 포워드 수익률 계산."""

import os
import sqlite3
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts', 'cloud-vm'))

import db_schema  # noqa: E402
import scan_forward  # noqa: E402


class ScanForwardTest(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        db_schema.create_schema(self.conn)

    def tearDown(self):
        self.conn.close()

    def _daily(self, code, rows):
        self.conn.executemany(
            'INSERT INTO daily_prices (code, date, close) VALUES (?, ?, ?)',
            [(code, d, c) for d, c in rows])
        self.conn.commit()

    def test_record_hits_skips_items_without_price(self):
        n = scan_forward.record_hits(self.conn, '2026-09-02', 'strategy:undervalued', [
            {'code': '005930', 'name': '삼성전자', 'price': 70000},
            {'code': '000660', 'name': 'SK하이닉스'},          # 기준가 없음 -> 제외
            {'code': '035420', 'name': 'NAVER', 'price': 0},   # 0원 -> 제외
            {'name': '코드없음', 'price': 100},                 # 코드 없음 -> 제외
        ])
        self.assertEqual(n, 1)
        codes = [r[0] for r in self.conn.execute('SELECT code FROM scan_hits').fetchall()]
        self.assertEqual(codes, ['005930'])

    def test_rescan_keeps_first_base_price(self):
        scan_forward.record_hits(self.conn, '2026-09-02', 'pattern:doubleBottom',
                                 [{'code': '005930', 'price': 70000}])
        scan_forward.record_hits(self.conn, '2026-09-02', 'pattern:doubleBottom',
                                 [{'code': '005930', 'price': 77000}])
        base = self.conn.execute('SELECT base_price FROM scan_hits').fetchone()[0]
        self.assertEqual(base, 70000)

    def test_forward_returns_uses_trading_days_after_scan(self):
        scan_forward.record_hits(self.conn, '2026-09-02', 'strategy:undervalued',
                                 [{'code': '005930', 'name': '삼성전자', 'price': 100.0}])
        self._daily('005930', [
            ('2026-09-01', 90.0),   # 스캔 이전 - 무시돼야 한다
            ('2026-09-02', 100.0),  # 스캔 당일 - 무시돼야 한다
            ('2026-09-03', 110.0),  # D+1
            ('2026-09-04', 105.0),  # D+2
            ('2026-09-07', 90.0),   # D+3 (주말 건너뜀)
        ])
        result = scan_forward.forward_returns(self.conn, horizons=(1, 3, 5))
        hit = result['hits'][0]
        self.assertEqual(hit['returns']['d1'], 10.0)
        self.assertEqual(hit['returns']['d3'], -10.0)
        self.assertIsNone(hit['returns']['d5'])  # 아직 5거래일이 안 지남

    def test_summary_excludes_immature_samples(self):
        scan_forward.record_hits(self.conn, '2026-09-02', 'strategy:undervalued', [
            {'code': 'A', 'price': 100.0},
            {'code': 'B', 'price': 100.0},
        ])
        self._daily('A', [('2026-09-03', 120.0)])
        # B는 다음날 일봉이 아직 없다 -> D+1 표본에서 빠져야 한다(0%로 세면 평균이 왜곡).
        summary = scan_forward.forward_returns(self.conn, horizons=(1,))['summary']
        entry = summary['strategy:undervalued']
        self.assertEqual(entry['hits'], 2)
        self.assertEqual(entry['d1']['samples'], 1)
        self.assertEqual(entry['d1']['avgPct'], 20.0)
        self.assertEqual(entry['d1']['winRatePct'], 100.0)

    def test_scanner_filter(self):
        scan_forward.record_hits(self.conn, '2026-09-02', 'strategy:dividend', [{'code': 'A', 'price': 100.0}])
        scan_forward.record_hits(self.conn, '2026-09-02', 'pattern:boxRange', [{'code': 'B', 'price': 100.0}])
        result = scan_forward.forward_returns(self.conn, scanner='pattern:boxRange', horizons=(1,))
        self.assertEqual([h['code'] for h in result['hits']], ['B'])

    def test_flatten_category_matches_merges_sectors(self):
        flat = scan_forward.flatten_category_matches({
            'undervalued': {'sectors': {
                'IT': {'matches': [{'code': '005930'}]},
                '금융': {'matches': [{'code': '105560'}]},
                '산업재': {'matches': []},
            }},
            'empty': {'sectors': {}},
        })
        self.assertEqual(sorted(c['code'] for c in flat['undervalued']), ['005930', '105560'])
        self.assertNotIn('empty', flat)

    def test_record_grouped_hits_namespaces_scanner(self):
        recorded = scan_forward.record_grouped_hits(self.conn, '2026-09-02', 'pattern', {
            'doubleBottom': [{'code': 'A', 'price': 100.0}],
            'boxRange': [],
        })
        self.assertEqual(recorded, {'pattern:doubleBottom': 1})


if __name__ == '__main__':
    unittest.main()
