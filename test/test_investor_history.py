"""투자자별 일별 이력(/investor-trend/history): KIS 행 변환·단위, 저장(지수 종가 COALESCE), 조회(정렬·중복·0행 제외·잠정치·총매수 미지원)."""
import os
import sys
import tempfile
import unittest
from datetime import datetime
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))
import db_schema  # noqa: E402
import investor_trend  # noqa: E402

REAL_GET_CONN = db_schema.get_conn  # investor_trend.db_schema 는 같은 모듈 객체라, 패치 전에 원본을 잡아 둔다


def kis_row(date, ind, frgn, orgn, idx):
    # FHPTJ04040000 응답 행: 금액은 백만원, 지수는 bstp_nmix_prpr
    return {'stck_bsop_date': date, 'prsn_ntby_tr_pbmn': str(ind), 'frgn_reg_ntby_pbmn': str(frgn),
            'frgn_ntby_tr_pbmn': '999999', 'orgn_ntby_tr_pbmn': str(orgn), 'bstp_nmix_prpr': idx}


class RowMappingTests(unittest.TestCase):
    def test_million_won_becomes_eok_and_registered_foreign_is_used(self):
        row = investor_trend._kis_row_to_common('20261009', kis_row('20261009', -123456, 2997220, 50000, '2845.31'))
        self.assertEqual(row['date'], '20261009')
        self.assertAlmostEqual(row['ind'], -1234.56)
        self.assertAlmostEqual(row['frgn'], 29972.2, msg='등록 외국인(frgn_reg_ntby_pbmn)을 쓰고 frgn_ntby_tr_pbmn 은 쓰지 않는다')
        self.assertAlmostEqual(row['orgn'], 500.0)
        self.assertEqual(row['index'], 2845.31)

    def test_missing_or_nonpositive_index_is_none_not_zero(self):
        self.assertIsNone(investor_trend._kis_row_to_common('20261009', kis_row('20261009', 1, 1, 1, ''))['index'])
        self.assertIsNone(investor_trend._kis_row_to_common('20261009', kis_row('20261009', 1, 1, 1, '0'))['index'])
        row = dict(kis_row('20261009', 1, 1, 1, '1'))
        row.pop('bstp_nmix_prpr')
        self.assertIsNone(investor_trend._kis_row_to_common('20261009', row)['index'])

    def test_history_fetch_keeps_only_real_trading_rows(self):
        output = [kis_row('20261008', 100, 200, 300, '2800'), kis_row('20261009', 0, 0, 0, '0'), {'prsn_ntby_tr_pbmn': '5'}]
        with mock.patch.object(investor_trend.kis_client, 'fetch_market_investor_daily', return_value=output) as fetch:
            rows = investor_trend.fetch_kis_history('t', 'k', 's', 'KSP', '0001', anchor=datetime(2026, 10, 9, tzinfo=investor_trend.KST))
        self.assertEqual([r['date'] for r in rows], ['20261008'], '세 값이 모두 0인 행과 날짜 없는 행은 거래일 자료가 아니다')
        self.assertEqual(fetch.call_count, 1, '한 번 호출로 이력 전체를 받는다')
        args = fetch.call_args.args
        self.assertEqual(args[3], args[4], 'DATE_1 = DATE_2 (그 날짜까지의 최근 300영업일)')


class StorageAndHistoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = os.path.join(self.tmp.name, 'test.db')
        conn = REAL_GET_CONN(self.db)
        db_schema.create_schema(conn)
        conn.close()
        patcher = mock.patch.object(investor_trend.db_schema, 'get_conn', lambda db_file=None: REAL_GET_CONN(self.db))
        patcher.start()
        self.addCleanup(patcher.stop)

    def put(self, market, rows):
        conn = REAL_GET_CONN(self.db)
        db_schema.upsert_investor_trend_rows(conn, market, rows)
        conn.close()

    def test_index_close_column_exists_and_coalesce_keeps_previous_value(self):
        self.put('KOSPI', [{'date': '20261008', 'ind': 1, 'frgn': 2, 'orgn': 3, 'index': 2800.5}])
        # 지수가 없는 폴백 경로가 같은 날짜를 다시 쓰어도 이미 저장된 지수 종가는 지워지지 않는다
        self.put('KOSPI', [{'date': '20261008', 'ind': 10, 'frgn': 20, 'orgn': 30}])
        conn = REAL_GET_CONN(self.db)
        rows = db_schema.load_investor_trend_daily(conn, 'KOSPI')
        conn.close()
        self.assertEqual(len(rows), 1, '같은 날짜는 한 행(중복 없음)')
        self.assertEqual(rows[0]['ind'], 10)
        self.assertEqual(rows[0]['index'], 2800.5)
        # 새 지수가 오면 덮어쓴다
        self.put('KOSPI', [{'date': '20261008', 'ind': 10, 'frgn': 20, 'orgn': 30, 'index': 2811.0}])
        conn = REAL_GET_CONN(self.db)
        self.assertEqual(db_schema.load_investor_trend_daily(conn, 'KOSPI')[0]['index'], 2811.0)
        conn.close()

    def test_existing_table_without_index_column_is_migrated(self):
        legacy = os.path.join(self.tmp.name, 'legacy.db')
        conn = REAL_GET_CONN(legacy)
        conn.execute('CREATE TABLE investor_trend_daily (market TEXT NOT NULL, date TEXT NOT NULL, ind_amt REAL, frgn_amt REAL, orgn_amt REAL, updated_at TEXT, PRIMARY KEY (market, date))')
        conn.execute("INSERT INTO investor_trend_daily VALUES ('KOSPI','20260101',1,2,3,'x')")
        conn.commit()
        # 마이그레이션 전 DB 도 읽을 수 있고(지수 None), 쓰면 컬럼이 생긴다
        self.assertIsNone(db_schema.load_investor_trend_daily(conn, 'KOSPI')[0]['index'])
        db_schema.upsert_investor_trend_rows(conn, 'KOSPI', [{'date': '20260102', 'ind': 4, 'frgn': 5, 'orgn': 6, 'index': 2500.0}])
        db_schema.create_schema(conn)
        cols = [r[1] for r in conn.execute('PRAGMA table_info(investor_trend_daily)')]
        rows = db_schema.load_investor_trend_daily(conn, 'KOSPI')
        conn.close()
        self.assertIn('index_close', cols)
        self.assertEqual(rows[0]['frgn'], 2)
        self.assertIsNone(rows[0]['index'])
        self.assertEqual(rows[1]['index'], 2500.0)

    def test_history_payload_is_ascending_deduped_and_marks_gross_unsupported(self):
        self.put('KOSPI', [
            {'date': '20261008', 'ind': -50.0, 'frgn': 30.0, 'orgn': 20.0, 'index': 2800.0},
            {'date': '20261006', 'ind': 10.0, 'frgn': -5.0, 'orgn': -5.0, 'index': 2790.0},
            {'date': '20261007', 'ind': 0.0, 'frgn': 0.0, 'orgn': 0.0, 'index': 2795.0},   # 세 값이 모두 0 → 거래일 자료 아님
            {'date': '20261008', 'ind': -60.0, 'frgn': 35.0, 'orgn': 25.0, 'index': 2801.0},  # 같은 날짜 재기록
        ])
        self.put('KOSDAQ', [{'date': '20261008', 'ind': 1.0, 'frgn': 1.0, 'orgn': 1.0, 'index': 800.0}])
        data = investor_trend.get_history('kospi', 260, now=datetime(2026, 10, 11, 12, 0, tzinfo=investor_trend.KST))
        self.assertEqual([r['date'] for r in data['rows']], ['2026-10-06', '2026-10-08'], '오름차순, 0행 제외, 날짜 중복 없음')
        last = data['rows'][-1]
        self.assertEqual((last['individual'], last['foreign'], last['institution'], last['indexClose']), (-60.0, 35.0, 25.0, 2801.0))
        self.assertEqual(data['unit'], '억원')
        self.assertEqual(data['market'], 'KOSPI')
        self.assertEqual(data['count'], 2)
        self.assertEqual((data['from'], data['to'], data['latestDate']), ('2026-10-06', '2026-10-08', '2026-10-08'))
        self.assertFalse(data['provisional'], '주말에 본 마지막 거래일은 잠정치가 아니다')
        self.assertFalse(data['gross']['supported'])
        self.assertIn('거꾸로 계산하지 않습니다', data['gross']['reason'])
        for row in data['rows']:
            self.assertNotIn('grossBuy', row)
            self.assertNotIn('grossSell', row)
        self.assertEqual(investor_trend.get_history('kosdaq', 260)['count'], 1, '시장이 섞이지 않는다')

    def test_weekend_rows_are_never_returned_or_treated_as_zero(self):
        self.put('KOSDAQ', [
            {'date': '20260724', 'ind': 10.0, 'frgn': 1.0, 'orgn': 1.0, 'index': 800.0},   # 금
            {'date': '20260725', 'ind': 26987.0, 'frgn': -23812.0, 'orgn': -7309.0},         # 토(예전 백필의 잘못된 합계 행)
            {'date': '20260726', 'ind': 26987.0, 'frgn': -23812.0, 'orgn': -7309.0},         # 일
            {'date': '20260727', 'ind': 5.0, 'frgn': 2.0, 'orgn': 3.0, 'index': 801.0},      # 월
        ])
        data = investor_trend.get_history('kosdaq', 30)
        self.assertEqual([r['date'] for r in data['rows']], ['2026-07-24', '2026-07-27'])

    def test_backfill_removes_non_trading_rows_inside_the_returned_span_only(self):
        self.put('KOSDAQ', [
            {'date': '20260101', 'ind': 9.0, 'frgn': 9.0, 'orgn': 9.0},                      # 구간 밖(더 오래됨) - 그대로
            {'date': '20260725', 'ind': 26987.0, 'frgn': -23812.0, 'orgn': -7309.0},         # 구간 안 비거래일 - 삭제
            {'date': '20260727', 'ind': 1.0, 'frgn': 1.0, 'orgn': 1.0},                      # 거래일 - 덮어씀
        ])
        output = [kis_row('20260724', 1000, 2000, 3000, '800'), kis_row('20260727', 4000, 5000, 6000, '801')]
        with mock.patch.object(investor_trend.kis_client, 'get_token', return_value='t'),                 mock.patch.object(investor_trend.kis_client, 'fetch_market_investor_daily', return_value=output):
            n = investor_trend.backfill_history_kis('k', 's', 'KOSDAQ', 'KSQ', '1001')
        self.assertEqual(n, 2)
        conn = REAL_GET_CONN(self.db)
        dates = [r['date'] for r in db_schema.load_investor_trend_daily(conn, 'KOSDAQ')]
        monday = [r for r in db_schema.load_investor_trend_daily(conn, 'KOSDAQ') if r['date'] == '20260727'][0]
        conn.close()
        self.assertEqual(dates, ['20260101', '20260724', '20260727'])
        self.assertAlmostEqual(monday['ind'], 40.0)
        self.assertEqual(monday['index'], 801.0)

    def test_provisional_only_for_today_before_settlement(self):
        self.put('KOSPI', [{'date': '20261009', 'ind': 1.0, 'frgn': 2.0, 'orgn': 3.0}])
        during = investor_trend.get_history('kospi', 30, now=datetime(2026, 10, 9, 14, 0, tzinfo=investor_trend.KST))
        after = investor_trend.get_history('kospi', 30, now=datetime(2026, 10, 9, 19, 0, tzinfo=investor_trend.KST))
        self.assertTrue(during['provisional'])
        self.assertFalse(after['provisional'])
        self.assertIsNone(during['rows'][0]['indexClose'], '지수 종가가 없으면 0 이 아니라 None')

    def test_days_window_and_empty_history(self):
        rows = []
        for day in range(1, 29):
            if datetime(2026, 9, day).weekday() < 5:  # 거래일(평일)만 저장
                rows.append({'date': '202609%02d' % day, 'ind': float(day), 'frgn': 1.0, 'orgn': 1.0, 'index': 3000.0 + day})
        self.put('KOSPI', rows)
        data = investor_trend.get_history('kospi', 10)
        self.assertEqual(data['count'], 10)
        self.assertEqual(data['rows'][0]['date'], '2026-09-15')
        self.assertEqual(data['rows'][-1]['date'], '2026-09-28')
        self.assertEqual(data['requestedDays'], 10)
        empty = investor_trend.get_history('kosdaq', 20)
        self.assertEqual(empty['rows'], [])
        self.assertEqual(empty['count'], 0)
        self.assertIsNone(empty['latestDate'])
        self.assertIsNone(empty['asOf'])


class EndpointTests(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        import main
        self.main = main
        self.client = TestClient(main.app)
        self.main._investor_history_cache.clear()
        patcher = mock.patch.object(main, '_check_rate_limit')
        self.rate = patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.client.close)

    def test_returns_envelope_and_caches_briefly(self):
        payload = {'market': 'KOSPI', 'rows': [], 'count': 0}
        with mock.patch.object(self.main.investor_trend, 'get_history', return_value=payload) as get:
            first = self.client.get('/investor-trend/history?market=kospi&days=120')
            second = self.client.get('/investor-trend/history?market=kospi&days=120')
        self.assertEqual(first.status_code, 200)
        body = first.json()
        self.assertTrue(body['success'])
        self.assertEqual(body['data'], payload)
        self.assertEqual(second.json()['data'], payload)
        self.assertEqual(get.call_count, 1, '30초 메모리 캐시: 같은 요청마다 DB 를 읽지 않는다')
        get.assert_called_with('kospi', 120)
        self.assertEqual(self.rate.call_count, 2)

    def test_rejects_bad_parameters_without_touching_db(self):
        with mock.patch.object(self.main.investor_trend, 'get_history') as get:
            for query in ['market=nasdaq', 'market=kospi&days=4', 'market=kospi&days=301', 'market=kospi&days=abc']:
                self.assertEqual(self.client.get('/investor-trend/history?' + query).status_code, 422, query)
            get.assert_not_called()

    def test_failure_is_a_safe_error(self):
        with mock.patch.object(self.main.investor_trend, 'get_history', side_effect=RuntimeError('db locked: secret path')):
            response = self.client.get('/investor-trend/history?market=kosdaq')
        self.assertGreaterEqual(response.status_code, 500)
        self.assertNotIn('secret path', response.text)


if __name__ == '__main__':
    unittest.main()
