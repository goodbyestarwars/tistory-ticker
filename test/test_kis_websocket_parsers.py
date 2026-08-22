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

    def test_strike_rows_reads_the_official_acpr_field(self):
        # 2026-08-23 회귀 테스트: 행사가별 프로파일이 항상 빈 상태였던 버그 - _strike_rows가
        # 시도하던 키 목록에 실제 필드명(acpr, KIS 공식 예제 chk_display_board_callput.py
        # COLUMN_MAPPING 확인)이 없어 전체 행이 걸러졌었다.
        row = {'acpr': '500.0', 'acml_vol': '1200', 'hts_otst_stpl_qty': '3400',
               'otst_stpl_qty_icdc': '-50'}
        result = option_flow._strike_rows('CALL', [row], '2026-08-23T00:00:00+00:00')
        self.assertEqual(len(result), 1)
        side, strike, volume, oi, oi_change, updated_at = result[0]
        self.assertEqual(side, 'CALL')
        self.assertEqual(strike, 500.0)
        self.assertEqual(volume, 1200)
        self.assertEqual(oi, 3400)
        self.assertEqual(oi_change, -50)

    def test_strike_rows_skips_rows_without_any_known_strike_field(self):
        row = {'acml_vol': '1200'}
        self.assertEqual(option_flow._strike_rows('CALL', [row], '2026-08-23T00:00:00+00:00'), [])


if __name__ == '__main__':
    unittest.main()
