import unittest
from unittest.mock import Mock

from kiwoom import KiwoomClient


class BuyingCapacityTests(unittest.TestCase):
    def client(self, response):
        client = KiwoomClient('fake', 'fake')
        client.call = Mock(return_value=response)
        return client

    def test_sale_proceeds_are_available_without_margin_leverage(self):
        client = self.client({'return_code': 0, 'entr': '1000000',
                              'ord_alow_amt': '295800', '100stk_ord_alow_amt': '000000828015',
                              '20stk_ord_alow_amt': '4140075'})
        self.assertEqual(client.cash_available(), 828015)
        client.call.assert_called_once_with('kt00001', '/api/dostk/acnt', {'qry_tp': '2'})

    def test_zero_is_not_replaced_with_deposit_or_other_buying_power(self):
        client = self.client({'return_code': 0, 'entr': '1000000',
                              'ord_alow_amt': '295800', '100stk_ord_alow_amt': '000000000000000'})
        self.assertEqual(client.cash_available(), 0)

    def test_missing_invalid_or_rejected_response_stops_calculation(self):
        for value in (None, '', '-100', '1.5', 'unknown'):
            with self.subTest(value=value):
                with self.assertRaises(RuntimeError):
                    self.client({'return_code': 0, '100stk_ord_alow_amt': value}).cash_available()
        with self.assertRaises(RuntimeError):
            self.client({'return_code': 1, '100stk_ord_alow_amt': '828015'}).cash_available()


if __name__ == '__main__':
    unittest.main()
