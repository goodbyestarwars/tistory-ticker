import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import public_data


class PublicDataParserTests(unittest.TestCase):
    def test_normalize_ohlc_maps_krx_fields(self):
        row = {
            'basDt': '20260807', 'srtnCd': '005930', 'itmsNm': '삼성전자',
            'clpr': '150000', 'vs': '2500', 'fltRt': '1.69',
            'mkp': '148000', 'hipr': '151000', 'lopr': '147000',
            'trqu': '1234567',
        }
        parsed = public_data._normalize_ohlc(row)
        self.assertEqual(parsed['date'], '2026-08-07')
        self.assertEqual(parsed['close'], 150000)
        self.assertEqual(parsed['volume'], 1234567)

    def test_quote_from_row_is_compatible_with_kiwoom_shape(self):
        row = {
            'basDt': '20260807', 'srtnCd': '005930', 'itmsNm': '삼성전자',
            'clpr': '150000', 'vs': '-1000', 'fltRt': '-0.66',
            'mkp': '151000', 'hipr': '152000', 'lopr': '149000',
            'trqu': '100', 'trPrc': '150000000',
        }
        quote = public_data._quote_from_row(row, 'test')
        self.assertEqual(quote['stk_cd'], '005930')
        self.assertEqual(quote['cur_prc'], 150000)
        self.assertEqual(quote['pred_pre'], -1000)
        self.assertEqual(quote['source'], 'test')

    def test_nps_name_normalization(self):
        self.assertEqual(public_data._nps_name('삼성전자(주)'), '삼성전자')
        self.assertEqual(public_data._nps_name('SK 하이닉스'), 'sk하이닉스')

    def test_fetch_nps_rows_reads_static_2025_snapshot_when_present(self):
        """2026-08-20: data.go.kr(namespace 3070507)이 아직 2024-12-31 스냅샷까지만 있어서
        (20차), 사용자가 fund.nps.or.kr에서 직접 받은 2025년 말 실데이터를
        nps_holdings_2025.json으로 커밋해 API 호출보다 우선하도록 반영했다. 이 테스트는
        모킹 없이 실제 커밋된 파일을 읽어 형태를 확인한다 - API 서비스키 없이도 항상
        동작해야 하는 정적 데이터라서 실제 파일로 검증하는 게 맞다."""
        public_data._CACHE.pop('nps-holdings', None)
        try:
            rows = public_data._fetch_nps_rows()
        finally:
            public_data._CACHE.pop('nps-holdings', None)
        self.assertGreater(len(rows), 1000)
        samsung = next(r for r in rows if r['종목명'] == '삼성전자')
        self.assertGreater(samsung['지분율(퍼센트)'], 0)
        self.assertGreater(samsung['평가액(억 원)'], 0)

    def test_fetch_nps_holding_uses_2025_as_of_from_static_snapshot(self):
        public_data._CACHE.pop('nps-holdings', None)
        try:
            info = public_data.fetch_nps_holding('삼성전자')
        finally:
            public_data._CACHE.pop('nps-holdings', None)
        self.assertEqual(info['as_of'], '2025-12-31')
        self.assertIn('fund.nps.or.kr', info['source'])

    def test_fetch_nps_holdings_by_code_matches_universe_by_normalized_name(self):
        rows = [
            {'Company': '삼성전자(주)', 'Amount': '1000', 'Weight': '5.0', 'Holding': '8.5'},
            {'Company': 'SK 하이닉스', 'Amount': '500', 'Weight': '2.0', 'Holding': '7.1'},
        ]
        universe = [
            {'code': '005930', 'name': '삼성전자'},
            {'code': '000660', 'name': 'SK하이닉스'},
            {'code': '999999', 'name': '국민연금이 안 가진 종목'},
        ]
        with mock.patch.object(public_data, '_fetch_nps_rows', return_value=rows):
            result = public_data.fetch_nps_holdings_by_code(universe)

        self.assertEqual(set(result.keys()), {'005930', '000660'})
        self.assertEqual(result['005930']['holding_pct'], 8.5)
        self.assertEqual(result['005930']['evaluation_amount_eok'], 1000.0)
        self.assertEqual(result['000660']['weight_pct'], 2.0)
        self.assertEqual(result['005930']['source'], '국민연금기금운용본부(fund.nps.or.kr) 국내주식 투자종목')

    def test_fetch_nps_holdings_by_code_returns_empty_when_unavailable(self):
        """서비스키 미설정 등으로 조회 자체가 안 되면 빈 dict - 값을 임의로 채우지 않는다."""
        with mock.patch.object(public_data, '_fetch_nps_rows',
                                side_effect=public_data.PublicDataUnavailable('키 없음')):
            result = public_data.fetch_nps_holdings_by_code([{'code': '005930', 'name': '삼성전자'}])
        self.assertEqual(result, {})

    def test_fetch_nps_holdings_by_code_keeps_first_row_on_duplicate_name(self):
        rows = [
            {'Company': '삼성전자', 'Amount': '1000', 'Weight': '5.0', 'Holding': '8.5'},
            {'Company': '삼성전자', 'Amount': '9999', 'Weight': '9.9', 'Holding': '9.9'},
        ]
        with mock.patch.object(public_data, '_fetch_nps_rows', return_value=rows):
            result = public_data.fetch_nps_holdings_by_code([{'code': '005930', 'name': '삼성전자'}])
        self.assertEqual(result['005930']['holding_pct'], 8.5)

    def test_missing_service_key_is_explicit(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(public_data.PublicDataUnavailable):
                public_data._service_key('stock')

    def test_fetch_nps_large_holding_matches_by_normalized_name(self):
        """대량보유상황보고(namespace=15106890, 분기 단위) - 실제 응답 필드명(발행기관명/
        보고서 작성기준일/지분율(퍼센트))은 VM에서 직접 curl로 확인한 값 그대로다."""
        rows = [
            {'번호': 1, '발행기관명': '(주)KB금융지주', '보고서 작성기준일': '2026-01-29',
             '지분율(퍼센트)': '8.94'},
            {'번호': 2, '발행기관명': '효성티앤씨', '보고서 작성기준일': '2026-01-22',
             '지분율(퍼센트)': '7.86'},
        ]
        with mock.patch.object(public_data, '_fetch_nps_large_holding_rows', return_value=rows):
            result = public_data.fetch_nps_large_holding('효성티앤씨')
        self.assertEqual(result['as_of'], '2026-01-22')
        self.assertEqual(result['holding_pct'], 7.86)
        self.assertIn('대량보유', result['source'])

    def test_fetch_nps_large_holding_returns_none_when_not_a_5pct_filer(self):
        """전체 포트폴리오가 아니라 5%룰 신고 종목만 있는 데이터셋 - 목록에 없으면
        None이 정상이고 임의로 채우지 않는다."""
        rows = [{'번호': 1, '발행기관명': '(주)KB금융지주', '보고서 작성기준일': '2026-01-29',
                 '지분율(퍼센트)': '8.94'}]
        with mock.patch.object(public_data, '_fetch_nps_large_holding_rows', return_value=rows):
            result = public_data.fetch_nps_large_holding('5%룰 신고 없는 종목')
        self.assertIsNone(result)

    def test_fetch_nps_large_holding_returns_none_when_unavailable(self):
        with mock.patch.object(public_data, '_fetch_nps_large_holding_rows',
                                side_effect=public_data.PublicDataUnavailable('키 없음')):
            with self.assertRaises(public_data.PublicDataUnavailable):
                public_data.fetch_nps_large_holding('KB금융')

    def test_kofia_market_normalizes_credit_and_funds_series(self):
        credit_payload = {
            'response': {'header': {'resultCode': '00'}, 'body': {'items': {'item': [
                {'basDt': '20260806', 'crdTrFingWhl': '17400000', 'crdTrFingScrs': '9000000',
                 'crdTrFingKosdaq': '8400000', 'crdTrLndrWhl': '50000', 'dpsgScrtMogFing': '19000000'},
                {'basDt': '20260807', 'crdTrFingWhl': '17500000', 'crdTrFingScrs': '9100000',
                 'crdTrFingKosdaq': '8400000', 'crdTrLndrWhl': '51000', 'dpsgScrtMogFing': '19100000'},
            ]}}}
        }
        funds_payload = {
            'response': {'header': {'resultCode': '00'}, 'body': {'items': {'item': [
                {'basDt': '20260806', 'invrDpsgAmt': '52000000000000', 'brkTrdUcolMny': '280000000000',
                 'brkTrdUcolMnyVsOppsTrdAmt': '29000000000', 'ucolMnyVsOppsTrdRlImpt': '10'},
                {'basDt': '20260807', 'invrDpsgAmt': '53000000000000', 'brkTrdUcolMny': '281000000000',
                 'brkTrdUcolMnyVsOppsTrdAmt': '30000000000', 'ucolMnyVsOppsTrdRlImpt': '11'},
            ]}}}
        }
        public_data._CACHE.pop('kofia-market:7', None)
        with mock.patch.dict(os.environ, {'DATA_GO_KR_KOFIA_SERVICE_KEY': 'test-key'}, clear=True):
            with mock.patch.object(public_data, '_request_json', side_effect=[credit_payload, funds_payload]):
                result = public_data.fetch_kofia_market(days=7)
        self.assertTrue(result['available'])
        self.assertEqual(result['latest_date'], '2026-08-07')
        self.assertEqual(result['credit_unit'], 'krw')
        self.assertEqual(result['market_funds_unit'], 'krw')
        self.assertEqual(result['credit']['loan_total'], 17500000)
        self.assertEqual(result['market_funds']['investor_deposits'], 53000000000000)
        self.assertEqual(len(result['series']), 2)

    def test_kofia_market_picks_a_same_day_pair_when_feeds_publish_on_different_lags(self):
        # 신용융자(credit) 피드가 증시자금(funds) 피드보다 하루 늦게 갱신되는 경우 -
        # 각자 독립적으로 "가장 최근 값"을 고르면 기준일이 영원히 어긋나 GAS 검증이
        # 항상 'pending'으로 막힌다(2026-08-23 실측 버그). 08-06에는 둘 다 있으므로
        # 그 날짜 쌍을 latest로 골라야 한다(08-07 funds 단독 최신값을 쓰면 안 됨).
        credit_payload = {
            'response': {'header': {'resultCode': '00'}, 'body': {'items': {'item': [
                {'basDt': '20260805', 'crdTrFingWhl': '17300000', 'crdTrFingScrs': '8900000',
                 'crdTrFingKosdaq': '8300000', 'crdTrLndrWhl': '49000', 'dpsgScrtMogFing': '18900000'},
                {'basDt': '20260806', 'crdTrFingWhl': '17400000', 'crdTrFingScrs': '9000000',
                 'crdTrFingKosdaq': '8400000', 'crdTrLndrWhl': '50000', 'dpsgScrtMogFing': '19000000'},
            ]}}}
        }
        funds_payload = {
            'response': {'header': {'resultCode': '00'}, 'body': {'items': {'item': [
                {'basDt': '20260806', 'invrDpsgAmt': '52000000000000', 'brkTrdUcolMny': '280000000000',
                 'brkTrdUcolMnyVsOppsTrdAmt': '29000000000', 'ucolMnyVsOppsTrdRlImpt': '10'},
                {'basDt': '20260807', 'invrDpsgAmt': '53000000000000', 'brkTrdUcolMny': '281000000000',
                 'brkTrdUcolMnyVsOppsTrdAmt': '30000000000', 'ucolMnyVsOppsTrdRlImpt': '11'},
            ]}}}
        }
        public_data._CACHE.pop('kofia-market:7', None)
        with mock.patch.dict(os.environ, {'DATA_GO_KR_KOFIA_SERVICE_KEY': 'test-key'}, clear=True):
            with mock.patch.object(public_data, '_request_json', side_effect=[credit_payload, funds_payload]):
                result = public_data.fetch_kofia_market(days=7)
        self.assertEqual(result['credit']['date'], result['market_funds']['date'])
        self.assertEqual(result['credit']['date'], '2026-08-06')
        self.assertEqual(result['credit']['loan_total'], 17400000)
        self.assertEqual(result['market_funds']['investor_deposits'], 52000000000000)


if __name__ == '__main__':
    unittest.main()
