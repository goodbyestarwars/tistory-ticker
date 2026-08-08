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


if __name__ == '__main__':
    unittest.main()
