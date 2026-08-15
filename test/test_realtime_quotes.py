import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import realtime_quotes


class RealtimeQuotesTests(unittest.TestCase):
    def test_parses_nxt_quote_with_exchange_and_session_fields(self):
        events = realtime_quotes._quote_events({
            'trnm': 'REAL',
            'data': [{
                'item': 'A005930',
                'type': ['0B'],
                'values': {'10': '+226500', '11': '-3500', '12': '-1.52', '16': '1234567', '9081': '2', '290': '1'},
            }],
        })

        self.assertEqual(events, [{
            'type': 'quote',
            'code': '005930',
            'price': 226500.0,
            'change': -3500.0,
            'changeRate': -1.52,
            'volume': 1234567.0,
            'exchange': '2',
            'marketSession': '1',
        }])

    def test_accepts_single_data_row_and_named_values(self):
        events = realtime_quotes._quote_events({
            'trnm': 'REAL',
            'data': {
                'item': '005930',
                'type': '0B',
                'value': {'price': '226500', 'change': '-3500', 'change_rate': '-1.52'},
            },
        })

        self.assertEqual(events[0]['code'], '005930')
        self.assertEqual(events[0]['price'], 226500.0)
        self.assertEqual(events[0]['changeRate'], -1.52)

    def test_parses_kis_domestic_trade_message(self):
        row = ['005930', '123000', '70000', '2', '700', '1.00'] + [''] * 6 + ['100', '2000', '3000000']
        events = realtime_quotes._kis_quote_events('0|H0STCNT0|1|' + '^'.join(row))

        self.assertEqual(events[0]['code'], '005930')
        self.assertEqual(events[0]['price'], 70000.0)
        self.assertEqual(events[0]['changeRate'], 1.0)
        self.assertEqual(events[0]['volume'], 2000.0)
        self.assertEqual(events[0]['source'], 'KIS WebSocket')

    def test_parses_kis_us_trade_message(self):
        row = ['DNASAAPL', 'AAPL'] + [''] * 9 + ['200', '', '2', '1.0'] + [''] * 5 + ['1000']
        events = realtime_quotes._kis_quote_events('0|HDFSCNT0|1|' + '^'.join(row))

        self.assertEqual(events[0]['code'], 'US:AAPL')
        self.assertEqual(events[0]['price'], 200.0)
        self.assertEqual(events[0]['changeRate'], 1.0)
        self.assertEqual(events[0]['volume'], 1000.0)

    def test_parses_kis_unified_stock_orderbook_message(self):
        row = ['005930', '123000', '1']
        row += ['70000'] + ['70100'] * 9
        row += ['69900'] + ['69800'] * 9
        row += ['10'] + ['11'] * 9
        row += ['20'] + ['21'] * 9
        row += ['100', '200', '0', '0', '0', '0', '0', '0', '0']
        events = realtime_quotes._kis_quote_events('0|H0UNASP0|1|' + '^'.join(row))

        self.assertEqual(events[0]['type'], 'orderbook')
        self.assertEqual(events[0]['code'], '005930')
        self.assertEqual(events[0]['asks'][0], {'price': 70000.0, 'qty': 10.0})
        self.assertEqual(events[0]['bids'][0], {'price': 69900.0, 'qty': 20.0})


if __name__ == '__main__':
    unittest.main()
