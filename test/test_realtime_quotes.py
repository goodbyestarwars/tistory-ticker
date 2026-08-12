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


if __name__ == '__main__':
    unittest.main()
