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

    def test_missing_service_key_is_explicit(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(public_data.PublicDataUnavailable):
                public_data._service_key('stock')

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
        with mock.patch.dict(os.environ, {'DATA_GO_KR_KOFIA_SERVICE_KEY': 'test-key'}, clear=True):
            with mock.patch.object(public_data, '_request_json', side_effect=[credit_payload, funds_payload]):
                result = public_data.fetch_kofia_market(days=7)
        self.assertTrue(result['available'])
        self.assertEqual(result['latest_date'], '2026-08-07')
        self.assertEqual(result['credit']['loan_total'], 17500000)
        self.assertEqual(result['market_funds']['investor_deposits'], 53000000000000)
        self.assertEqual(len(result['series']), 2)


if __name__ == '__main__':
    unittest.main()
