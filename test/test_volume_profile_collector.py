# -*- coding: utf-8 -*-
"""매물대 실제 체결가 일별 수집기 계약(2026-09-15).

사용자 결정("응 그렇게 진행해"): 조회된 날만 쌓이던 volume_profile_daily를 KRX 거래일 장 마감 뒤
하루 한 번 대상 종목만 채운다. 시간 창·대상 선정·저장·연속 실패 중단을 고정한다.
"""

import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLOUD_VM = os.path.join(ROOT, 'scripts', 'cloud-vm')
sys.path.insert(0, CLOUD_VM)

import db_schema  # noqa: E402
import volume_profile_collector as vpc  # noqa: E402

KST = timezone(timedelta(hours=9))


def kst(y, mo, d, h, mi):
    return datetime(y, mo, d, h, mi, tzinfo=KST)


class PureFunctionTests(unittest.TestCase):
    def test_aggregate_rows_uses_pbar_fields(self):
        rows = [
            {'stck_prpr': '250,000', 'cntg_vol': '1,200'},
            {'stck_prpr': '250000', 'cntg_vol': '300'},
            {'stck_prpr': '249500', 'cntg_vol': '50'},
            {'stck_prpr': '0', 'cntg_vol': '999'},
            'bad',
        ]
        self.assertEqual(vpc.aggregate_rows(rows), [
            {'price': 249500.0, 'volume': 50.0},
            {'price': 250000.0, 'volume': 1500.0},
        ])

    def test_select_codes_prefers_board_and_dedupes(self):
        codes = vpc.select_codes(['005930', '000660', 'US:NVDA', '005930', '0197X0'],
                                 ['035420', '000660', 'abc'], limit=4)
        self.assertEqual(codes, ['005930', '000660', '0197X0', '035420'])

    def test_run_window_is_after_close_on_trading_days_once(self):
        self.assertFalse(vpc.should_run(kst(2026, 9, 15, 18, 9), None))
        self.assertTrue(vpc.should_run(kst(2026, 9, 15, 18, 10), None))
        self.assertTrue(vpc.should_run(kst(2026, 9, 15, 19, 59), '2026-09-14'))
        self.assertFalse(vpc.should_run(kst(2026, 9, 15, 20, 0), None))    # 저녁 스캔(20:10) 전에만
        self.assertFalse(vpc.should_run(kst(2026, 9, 15, 18, 30), '2026-09-15'))
        self.assertFalse(vpc.should_run(kst(2026, 9, 19, 18, 30), None))   # 토요일
        self.assertFalse(vpc.should_run(kst(2026, 9, 24, 18, 30), None))   # 추석 연휴


class RunOnceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.db_file = os.path.join(self.tmp, 'test.db')
        conn = db_schema.get_conn(self.db_file)
        db_schema.create_schema(conn)
        conn.close()

    def get_conn(self):
        return db_schema.get_conn(self.db_file)

    def test_stores_each_code_and_skips_failures(self):
        def fetch(code):
            if code == '000660':
                raise RuntimeError('KIS 500')
            if code == '035420':
                return []
            return [{'stck_prpr': '250000', 'cntg_vol': '100'}, {'stck_prpr': '250500', 'cntg_vol': '40'}]

        result = vpc.run_once('k', 's', ['005930', '000660', '035420'], now_kst=kst(2026, 9, 15, 18, 20),
                              fetch=fetch, get_conn=self.get_conn, sleep=lambda s: None)
        self.assertEqual(result['stored'], 1)
        self.assertEqual(result['failed'], 1)
        self.assertEqual(result['rows'], 2)
        self.assertFalse(result['stoppedEarly'])
        conn = self.get_conn()
        try:
            bins, days = db_schema.load_volume_profile_days(conn, '005930', 120)
            self.assertEqual(days, 1)
            self.assertEqual(sorted((b['price'], b['volume']) for b in bins), [(250000.0, 100.0), (250500.0, 40.0)])
            self.assertEqual(db_schema.list_volume_profile_codes(conn, '2026-09-01'), ['005930'])
        finally:
            conn.close()

    def test_stops_after_consecutive_failures(self):
        calls = []

        def fetch(code):
            calls.append(code)
            raise RuntimeError('KIS down')
        codes = ['%06d' % i for i in range(1, 20)]
        result = vpc.run_once('k', 's', codes, now_kst=kst(2026, 9, 15, 18, 20), fetch=fetch,
                              get_conn=self.get_conn, sleep=lambda s: None)
        self.assertTrue(result['stoppedEarly'])
        self.assertEqual(len(calls), vpc.MAX_CONSECUTIVE_FAILURES)
        self.assertIn('KIS down', result['lastError'])


class WiringTests(unittest.TestCase):
    def test_main_starts_collector_and_exposes_status(self):
        with open(os.path.join(CLOUD_VM, 'main.py'), encoding='utf-8') as handle:
            source = handle.read()
        self.assertIn('import volume_profile_collector', source)
        self.assertIn('volume_profile_collector.start_background(kis_appkey, kis_appsecret, _volume_profile_board_codes)', source)
        self.assertIn("@app.get('/health/volume-profile')", source)
        self.assertIn('volume_profile_collector.get_status()', source)
        # 별도 프로세스·타이머를 두지 않는다.
        with open(os.path.join(CLOUD_VM, 'deploy_check.sh'), encoding='utf-8') as handle:
            self.assertNotIn('volume_profile_collector', handle.read())


if __name__ == '__main__':
    unittest.main()
