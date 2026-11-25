# -*- coding: utf-8 -*-
import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm')))
import kiwoom_market as m


class ChartMarketScopeTests(unittest.TestCase):
    def test_explicit_scopes(self):
        self.assertEqual(m.chart_market_code('376900'), '376900')
        self.assertEqual(m.chart_market_code('376900', 'KRX'), '376900')
        self.assertEqual(m.chart_market_code('376900', 'NXT'), '376900_NX')
        self.assertEqual(m.chart_market_code('376900', 'UN'), '376900_AL')
        with self.assertRaises(ValueError):
            m.chart_market_code('376900_AL', 'UN')
        with self.assertRaises(ValueError):
            m.chart_market_code('376900', 'unknown')

    def test_daily_single_and_paged_requests(self):
        raw = {'stk_dt_pole_chart_qry': [{'dt':'20261125', 'open_pric':'18300',
                 'high_pric':'18890', 'low_pric':'17750', 'cur_prc':'18070', 'trde_qty':'417576'}]}
        with patch.object(m.kiwoom_client, 'call_tr', return_value=raw) as call:
            rows = m.fetch_daily_ohlc('test', '376900', market='UN')
            self.assertEqual(call.call_args.args[3]['stk_cd'], '376900_AL')
            self.assertEqual(rows[0]['volume'], 417576)
            m.fetch_daily_ohlc('test', '376900')
            self.assertEqual(call.call_args.args[3]['stk_cd'], '376900')
        with patch.object(m.kiwoom_client, 'call_tr_pages', return_value=[raw]) as call:
            m.fetch_daily_ohlc('test', '376900', max_pages=3, market='UN')
            self.assertEqual(call.call_args.args[3]['stk_cd'], '376900_AL')

    def test_minute_scope_and_no_implicit_fallback(self):
        with patch.object(m.kiwoom_client, 'call_tr', return_value={'stk_min_pole_chart_qry': []}) as call:
            m.fetch_minute_ohlc('test', '376900', market='UN')
            self.assertEqual(call.call_args.args[3]['stk_cd'], '376900_AL')
        with patch.object(m.kiwoom_client, 'call_tr', side_effect=RuntimeError('upstream')) as call:
            with self.assertRaises(RuntimeError):
                m.fetch_daily_ohlc('test', '376900', market='UN')
            self.assertEqual(call.call_count, 1)


if __name__ == '__main__':
    unittest.main()
