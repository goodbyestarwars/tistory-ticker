import os
import sys
import unittest
from unittest.mock import patch


ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))

import domestic_market_indicators as dmi
import kis_client


class DomesticMarketIndicatorsTest(unittest.TestCase):
    def test_normalises_minute_and_daily_candles(self):
        minute = dmi._sort_rows([
            {'ts': 100, 'openPrice': '-10', 'highPrice': '-12', 'lowPrice': '-9', 'currentPrice': '-11'},
            {'ts': 200, 'openPrice': '11', 'highPrice': '13', 'lowPrice': '10', 'currentPrice': '12'},
        ], minute=True)
        daily = dmi._sort_rows([
            {'dt': '20260812', 'open_pric': '+10', 'high_pric': '+12', 'low_pric': '+9', 'cur_prc': '+11'},
        ])
        self.assertEqual(minute[-1]['ts'], 200)
        self.assertEqual(minute[0]['open'], 10.0)
        self.assertEqual(minute[0]['low'], 9.0)
        self.assertEqual(daily[0]['date'], '2026-08-12')

    def test_chart_rows_can_be_limited_to_futures_lookback(self):
        rows = dmi._sort_rows([
            {'dt': '20250101', 'open_pric': '10', 'high_pric': '12', 'low_pric': '9', 'cur_prc': '11'},
            {'dt': '20260801', 'open_pric': '10', 'high_pric': '12', 'low_pric': '9', 'cur_prc': '11'},
        ], since_date='2026-01-01')
        self.assertEqual([row['date'] for row in rows], ['2026-08-01'])

    def test_kiwoom_provider_uses_cash_index_chart_ids(self):
        responses = {
            'ka20005': {'inds_min_pole_qry': [
                {'cntr_tm': '20260812090000', 'open_pric': '10', 'high_pric': '11', 'low_pric': '9', 'cur_prc': '10'},
                {'cntr_tm': '20260812090100', 'open_pric': '10', 'high_pric': '12', 'low_pric': '9', 'cur_prc': '11'},
            ]},
            'ka20006': {'inds_dt_pole_qry': [
                {'dt': '20260811', 'open_pric': '10', 'high_pric': '11', 'low_pric': '9', 'cur_prc': '10'},
                {'dt': '20260812', 'open_pric': '10', 'high_pric': '12', 'low_pric': '9', 'cur_prc': '11'},
            ]},
            'ka20007': {'inds_stk_pole_qry': [
                {'dt': '20260804', 'open_pric': '10', 'high_pric': '11', 'low_pric': '9', 'cur_prc': '10'},
                {'dt': '20260811', 'open_pric': '10', 'high_pric': '12', 'low_pric': '9', 'cur_prc': '11'},
            ]},
        }
        calls = []

        def call(_token, api_id, _path, body):
            calls.append((api_id, body))
            return responses[api_id]

        with patch.object(dmi.kiwoom_client, 'call_tr', side_effect=call):
            for interval in ('minute', 'day', 'week'):
                result = dmi._fetch_kiwoom('token', 'KOSPI', interval)
                self.assertEqual(len(result), 2)
        self.assertEqual([item[0] for item in calls], ['ka20005', 'ka20006', 'ka20007'])
        self.assertEqual(calls[0][1]['inds_cd'], '001')

    def test_investor_rows_are_named_for_ui(self):
        rows = dmi._normalise_investor({'rows': [
            {'label': '08.12', 'ind': 1, 'frgn': -2, 'orgn': 3},
        ]})
        self.assertEqual(rows[0], {'label': '08.12', 'individual': 1.0, 'foreign': -2.0, 'institution': 3.0})

    def test_kis_funds_uses_documented_query_key(self):
        with patch.object(kis_client, '_get_domestic_quote', return_value={'output': [{'bsop_date': '20260812'}]}) as request:
            rows = kis_client.fetch_market_funds('token', 'appkey', 'secret')
        self.assertEqual(rows, [{'bsop_date': '20260812'}])
        self.assertEqual(request.call_args.args[5], {'FID_INPUT_DATE_1': ''})

    def test_normalises_documented_kis_market_funds_fields(self):
        rows = dmi._normalise_kis_funds([{
            'bsop_date': '20260812',
            'crdt_loan_rmnd': '12345',
            'cust_dpmn_amt': '67890',
        }])
        self.assertEqual(rows, [{
            'date': '2026-08-12',
            'credit': 12345.0,
            'market_funds': {'date': '2026-08-12', 'investor_deposits': 67890.0},
        }])


if __name__ == '__main__':
    unittest.main()
