import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import domestic_futures_ws
import option_flow


class KisWebSocketParserTests(unittest.TestCase):
    def test_parses_index_future_trade(self):
        values = ['101W09', '123000', '1', '1.25', '0', '350.50'] + [''] * (len(domestic_futures_ws.TRADE_FIELDS) - 6)
        rows = domestic_futures_ws._parse_rows('0|H0IFCNT0|1|' + '^'.join(values), domestic_futures_ws.TRADE_FIELDS)
        self.assertEqual(rows[0]['futs_shrn_iscd'], '101W09')
        self.assertEqual(rows[0]['futs_prpr'], '350.50')

    def test_parses_index_future_orderbook(self):
        values = ['101W09', '123000', '350.5', '350.6', '350.7', '350.8', '350.9']
        values += ['350.4', '350.3', '350.2', '350.1', '350.0']
        values += ['1'] * (len(domestic_futures_ws.QUOTE_FIELDS) - len(values))
        rows = domestic_futures_ws._parse_rows('0|H0IFASP0|1|' + '^'.join(values), domestic_futures_ws.QUOTE_FIELDS)
        self.assertEqual(rows[0]['futs_askp1'], '350.5')
        self.assertEqual(rows[0]['futs_bidp1'], '350.4')

    def test_parses_option_trade_prefix(self):
        values = ['201W08427', '123000', '1.20', '2', '-0.10', '-7.69'] + [''] * (len(option_flow.OPTION_TRADE_FIELDS) - 6)
        rows = option_flow._parse_ws_rows('0|H0IOCNT0|1|' + '^'.join(values), option_flow.OPTION_TRADE_FIELDS)
        self.assertEqual(rows[0]['optn_shrn_iscd'], '201W08427')
        self.assertEqual(rows[0]['acml_vol'], '')


if __name__ == '__main__':
    unittest.main()
