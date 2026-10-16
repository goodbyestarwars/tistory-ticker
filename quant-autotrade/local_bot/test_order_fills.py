# -*- coding: utf-8 -*-
"""실제 체결 평균가(키움 당일매매일지) 덮어쓰기 - 합성 데이터만 쓰며 계좌·네트워크 호출이 없다. (2026-10-16)"""
import json
import os
import tempfile
import unittest

from server import apply_fills, load_fills, live_snapshot
import server
from test_live_snapshot import make_ledger


def fill(date, code, side, qty, price, name='', source='키움 당일매매일지'):
    return {'date': date, 'code': code, 'side': side, 'qty': qty, 'price': price, 'name': name, 'source': source}


class ApplyFillsTests(unittest.TestCase):
    def orders(self):
        with tempfile.TemporaryDirectory() as folder:
            _, orders = live_snapshot(make_ledger(folder))
        return orders

    def test_actual_fill_overrides_price_status_and_matching_buy_price(self):
        orders = apply_fills(self.orders(), [
            fill('2026-10-14', '086520', 'BUY', 3, 85000), fill('2026-10-14', '086520', 'SELL', 3, 88500)])
        by = {(o['code'], o['reason']): o for o in orders if o['ts'].startswith('2026-10-14')}
        buy, sell = by[('086520', 'BUY')], by[('086520', 'SELL')]
        self.assertEqual((buy['price'], buy['price_kind'], buy['status']), (85000, 'actual', 'FILLED'))   # 장부 주문가 85,300 -> 체결 85,000
        self.assertEqual((sell['price'], sell['price_kind'], sell['status']), (88500, 'actual', 'FILLED'))
        self.assertEqual(sell['buy_price'], 85000)                                                         # 매도 행의 매수 가격도 체결가 기준

    def test_fills_not_in_ledger_become_manual_rows_with_buy_price(self):
        orders = apply_fills(self.orders(), [
            fill('2026-10-14', '251970', 'BUY', 2, 65500, '펌텍코리아'),
            fill('2026-10-15', '251970', 'SELL', 2, 68200, '펌텍코리아')])
        manual = [o for o in orders if o.get('manual')]
        self.assertEqual(len(manual), 2)
        sell = [o for o in manual if o['reason'] == 'SELL'][0]
        self.assertEqual((sell['price'], sell['price_kind'], sell['name'], sell['buy_price']), (68200, 'actual', '펌텍코리아', 65500))
        self.assertTrue(sell['ts'].startswith('2026-10-15') and '시각 미상' in sell['ts'])
        self.assertTrue(sell['detail'].startswith('수동 거래'))

    def test_untouched_orders_and_no_fills(self):
        orders = self.orders()
        before = json.dumps(orders, sort_keys=True, default=str)
        self.assertEqual(json.dumps(apply_fills(orders, []), sort_keys=True, default=str), before)
        out = apply_fills(self.orders(), [fill('2026-10-14', '086520', 'SELL', 3, 88500)])
        other = [o for o in out if o['code'] == '352820' and o['reason'] == 'BUY'][0]
        self.assertEqual(other['price_kind'], 'order')                                # 다른 종목·날짜는 그대로

    def test_same_day_multiple_orders_get_the_same_average(self):
        orders = self.orders()
        first = [o for o in orders if o['code'] == '352820' and o['reason'] == 'BUY'][0]
        twin = dict(first)
        twin['ts'] = '2026-10-16 09:30:00'
        out = apply_fills(orders + [twin], [fill('2026-10-16', '352820', 'BUY', 2, 166000)])
        prices = [o['price'] for o in out if o['code'] == '352820' and o['reason'] == 'BUY']
        self.assertEqual(prices, [166000, 166000])


class LoadFillsTests(unittest.TestCase):
    def test_missing_corrupt_and_invalid_rows_are_ignored(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, 'order_fills.json')
            self.assertEqual(load_fills(path), [])                       # 파일 없음
            with open(path, 'w', encoding='utf-8') as f:
                f.write('{broken')
            server._FILLS_CACHE.clear()
            self.assertEqual(load_fills(path), [])                       # 깨진 파일
            with open(path, 'w', encoding='utf-8') as f:
                json.dump({'fills': [
                    fill('2026-10-14', '086520', 'SELL', 3, 88500, '에코프로'),
                    fill('2026-10-14', '32640', 'SELL', 3, 100),         # 코드 형식 오류
                    fill('2026-10-14', '086520', 'HOLD', 3, 100),        # 방향 오류
                    fill('2026-10-14', '086520', 'SELL', 3, 0)]}, f)     # 가격 0
            os.utime(path, (1, 2))
            server._FILLS_CACHE.clear()
            rows = load_fills(path)
            self.assertEqual([(r['code'], r['side'], r['price']) for r in rows], [('086520', 'SELL', 88500.0)])


if __name__ == '__main__':
    unittest.main()
