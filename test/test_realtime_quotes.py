import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import realtime_quotes
import us_stocks


class RealtimeQuotesTests(unittest.TestCase):
    def test_kis_us_keys_use_one_registration_for_known_exchange(self):
        previous = dict(us_stocks._symbol_exchange)
        try:
            us_stocks._symbol_exchange.clear()
            us_stocks._symbol_exchange.update({'AAPL': 'NAS', 'LLY': 'NYS'})
            self.assertEqual(realtime_quotes._kis_us_keys(['AAPL', 'LLY']), [
                ('DNASAAPL', 'HDFSCNT0'),
                ('DNYSLLY', 'HDFSCNT0'),
            ])
        finally:
            us_stocks._symbol_exchange.clear()
            us_stocks._symbol_exchange.update(previous)

    def test_parses_nxt_quote_with_exchange_and_session_fields(self):
        events = realtime_quotes._quote_events({
            'trnm': 'REAL',
            'data': [{
                'item': 'A005930',
                'type': ['0B'],
                'values': {'10': '+226500', '11': '-3500', '12': '-1.52', '13': '1234567', '16': '225000', '9081': '2', '290': '1'},
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
            'source': 'Kiwoom WebSocket',
        }])

    def test_kiwoom_signed_trade_direction(self):
        def frame(qty):
            return {'trnm': 'REAL', 'data': [{'item': '035420_AL', 'type': '0B',
                'values': {'10': '-176100', '11': '-900', '12': '-0.51',
                           '20': '093456', '15': qty, '9081': '1'}}]}
        buy = realtime_quotes._quote_events(frame('+136'))[0]
        sell = realtime_quotes._quote_events(frame('-3'))[0]
        unsigned = realtime_quotes._quote_events(frame('7'))[0]
        self.assertEqual((buy['trade']['direction'], buy['trade']['qty']), ('buy', 136.0))
        self.assertEqual((sell['trade']['direction'], sell['trade']['qty']), ('sell', 3.0))
        self.assertEqual(unsigned['trade']['direction'], 'unknown')
        self.assertEqual(buy['source'], 'Kiwoom WebSocket')
        self.assertNotIn('trade', realtime_quotes._quote_events(frame('0'))[0])

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

    def test_kis_trade_keeps_individual_quantity_and_provider_direction(self):
        def frame(division, change_rate='-1.0', tr_id='H0STCNT0', price='70000', ask='70100', bid='69900'):
            row = [''] * 46
            row[0], row[1], row[2] = '005930', '093112', price
            row[4], row[5] = '700', change_rate
            row[10], row[11] = ask, bid
            row[12], row[13], row[21] = '1250', '2000', division
            row[33] = '20261012'
            return '0|' + tr_id + '|1|' + '^'.join(row)

        buy = realtime_quotes._kis_quote_events(frame('1'))[0]
        sell = realtime_quotes._kis_quote_events(frame('5', '+1.0'))[0]
        unknown = realtime_quotes._kis_quote_events(frame('3'))[0]
        self.assertEqual(buy['trade']['qty'], 1250)
        self.assertEqual(buy['trade']['date'], '20261012')
        self.assertEqual(buy['volume'], 2000)
        self.assertEqual(buy['trade']['direction'], 'buy')
        self.assertEqual(buy['changeRate'], -1.0)
        self.assertEqual(sell['trade']['direction'], 'sell')
        self.assertEqual(sell['changeRate'], 1.0)
        self.assertEqual(unknown['trade']['direction'], 'unknown')
        self.assertEqual(unknown['trade']['directionSource'], 'unknown')
        estimated_buy = realtime_quotes._kis_quote_events(frame('1', tr_id='H0UNCNT0', price='70100'))[0]
        estimated_sell = realtime_quotes._kis_quote_events(frame('5', tr_id='H0UNCNT0', price='69900'))[0]
        midpoint = realtime_quotes._kis_quote_events(frame('1', tr_id='H0UNCNT0'))[0]
        bad_spread = realtime_quotes._kis_quote_events(frame('1', tr_id='H0UNCNT0', ask='73000'))[0]
        self.assertEqual((estimated_buy['trade']['direction'], estimated_buy['trade']['directionSource']), ('buy', 'estimate'))
        self.assertEqual((estimated_sell['trade']['direction'], estimated_sell['trade']['directionSource']), ('sell', 'estimate'))
        self.assertEqual(midpoint['trade']['direction'], 'unknown')
        self.assertEqual(bad_spread['trade']['direction'], 'unknown')

    def test_parses_kis_us_trade_message(self):
        row = ['DNASAAPL', 'AAPL'] + [''] * 9 + ['200', '', '2', '1.0'] + [''] * 5 + ['1000']
        events = realtime_quotes._kis_quote_events('0|HDFSCNT0|1|' + '^'.join(row))

        self.assertEqual(events[0]['code'], 'US:AAPL')
        self.assertEqual(events[0]['price'], 200.0)
        self.assertEqual(events[0]['changeRate'], 1.0)
        self.assertEqual(events[0]['volume'], 1000.0)

    def test_parses_kis_us_trade_with_signed_change(self):
        row = ['DNASSPCX', 'SPCX'] + [''] * 9 + ['142.22', '', '4.01', '-2.74'] + [''] * 5 + ['1000']
        events = realtime_quotes._kis_quote_events('0|HDFSCNT0|1|' + '^'.join(row))

        self.assertEqual(events[0]['change'], -4.01)
        self.assertEqual(events[0]['changeRate'], -2.74)

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
