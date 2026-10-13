import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
import kis_client


class InvestorStockRankTest(unittest.TestCase):
    def test_official_fields_only(self):
        response = {'output': [
            {'mksc_shrn_iscd': '005930', 'hts_kor_isnm': '삼성전자',
             'frgn_ntby_qty': '1,234', 'orgn_ntby_qty': '-90'},
            {'mksc_shrn_iscd': '123', 'hts_kor_isnm': '미확인', 'frgn_ntby_qty': '900'},
            {'mksc_shrn_iscd': '000660', 'hts_kor_isnm': 'SK하이닉스', 'frgn_ntby_qty': '임의'},
        ]}
        with patch.object(kis_client, '_get_domestic_quote', return_value=response) as get:
            result = kis_client.fetch_investor_stock_rank('token', 'key', 'secret', 'foreign', 'buy')
        self.assertEqual(result, [{'code': '005930', 'name': '삼성전자', 'quantity': 1234}])
        self.assertEqual(get.call_args.args[4], 'FHPTJ04400000')
        self.assertEqual(get.call_args.args[5]['FID_ETC_CLS_CODE'], '1')

    def test_sell_and_invalid_payload(self):
        response = {'output': [{'mksc_shrn_iscd': '005930', 'hts_kor_isnm': '삼성전자',
                                'orgn_ntby_qty': '-90'}]}
        with patch.object(kis_client, '_get_domestic_quote', return_value=response) as get:
            result = kis_client.fetch_investor_stock_rank('token', 'key', 'secret', 'institution', 'sell')
        self.assertEqual(result[0]['quantity'], -90)
        self.assertEqual(get.call_args.args[5]['FID_RANK_SORT_CLS_CODE'], '1')
        self.assertEqual(get.call_args.args[5]['FID_ETC_CLS_CODE'], '2')
        with patch.object(kis_client, '_get_domestic_quote', return_value={'output': {}}):
            self.assertEqual(kis_client.fetch_investor_stock_rank('token', 'key', 'secret', 'foreign', 'buy'), [])
        with self.assertRaises(ValueError):
            kis_client.fetch_investor_stock_rank('token', 'key', 'secret', 'individual', 'buy')


if __name__ == '__main__':
    unittest.main()
