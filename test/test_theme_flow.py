# -*- coding: utf-8 -*-
"""증권사(키움) 테마 기준 '오늘 돈이 몰린 섹터' 계약(2026-09-14).

사용자 지적: 광통신이 상한가를 갔는데 카드에 없었다 - 카드가 손으로 만든 섹터(data/sectors-v3.js)
만 묶었기 때문이다. 증권사 테마(ka90001/ka90002)를 쓰는지, 화면이 더 이상 손 섹터를 읽지
않는지 확인한다.
"""

import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))

import theme_flow  # noqa: E402


LISTING = {'thema_grp': [
    {'thema_grp_cd': '101', 'thema_nm': '광통신', 'stk_num': '3', 'flu_sig': '2', 'flu_rt': '+12.40',
     'rising_stk_num': '3', 'fall_stk_num': '0'},
    {'thema_grp_cd': '202', 'thema_nm': '2차전지', 'stk_num': '2', 'flu_sig': '2', 'flu_rt': '+3.10',
     'rising_stk_num': '2', 'fall_stk_num': '0'},
    {'thema_grp_cd': '303', 'thema_nm': '1종목테마', 'stk_num': '1', 'flu_sig': '2', 'flu_rt': '+2.00',
     'rising_stk_num': '1', 'fall_stk_num': '0'},
]}

STOCKS = {
    '101': [
        {'stk_cd': '000001', 'stk_nm': '광A', 'cur_prc': '+13000', 'flu_sig': '1', 'flu_rt': '+29.99', 'acc_trde_qty': '1000000'},
        {'stk_cd': '000002', 'stk_nm': '광B', 'cur_prc': '+5,000', 'flu_sig': '2', 'flu_rt': '+8.00', 'acc_trde_qty': '200000'},
        {'stk_cd': '000003', 'stk_nm': '광C', 'cur_prc': '2000', 'flu_sig': '2', 'flu_rt': '+1.00', 'acc_trde_qty': '10'},
    ],
    '202': [
        {'stk_cd': '000010', 'stk_nm': '전지A', 'cur_prc': '100000', 'flu_sig': '2', 'flu_rt': '+3.00', 'acc_trde_qty': '500000'},
        {'stk_cd': '000002', 'stk_nm': '광B', 'cur_prc': '+5000', 'flu_sig': '2', 'flu_rt': '+8.00', 'acc_trde_qty': '200000'},
    ],
    '303': [
        {'stk_cd': '000020', 'stk_nm': '단독', 'cur_prc': '1000', 'flu_sig': '2', 'flu_rt': '+2.00', 'acc_trde_qty': '5'},
    ],
}


class FakeKiwoom:
    def __init__(self):
        self.calls = []

    def __call__(self, token, api_id, path, body):
        self.calls.append((api_id, path, dict(body)))
        if api_id == 'ka90001':
            return LISTING
        return {'thema_comp_stk': STOCKS.get(body['thema_grp_cd'], [])}


class ThemeFlowTests(unittest.TestCase):
    def test_uses_broker_theme_trs_with_integrated_market(self):
        fake = FakeKiwoom()
        result = theme_flow.fetch_theme_flow('tok', call_tr=fake, sleep=lambda s: None)
        listing = fake.calls[0]
        self.assertEqual(listing[0], 'ka90001')
        self.assertEqual(listing[1], '/api/dostk/thme')
        self.assertEqual(listing[2]['flu_pl_amt_tp'], '3')   # 상위등락률
        self.assertEqual(listing[2]['stex_tp'], '3')         # KRX+NXT 통합
        self.assertEqual([c[0] for c in fake.calls[1:]], ['ka90002'] * 3)
        self.assertEqual(result['source'], 'kiwoom-theme')

        names = [r['industry'] for r in result['rows']]
        # 1종목 테마는 섹터로 보기 어려워 뺀다. 나머지는 거래대금(현재가×누적거래량) 큰 순.
        self.assertEqual(names, ['2차전지', '광통신'])
        light = result['rows'][1]
        self.assertEqual(light['avg_change_rate'], 12.4)
        self.assertEqual(light['upper_limit_count'], 1)
        self.assertEqual(light['stocks'][0]['name'], '광A')
        self.assertEqual(light['stocks'][0]['price'], 13000)
        self.assertEqual(light['trade_amount'], 13000 * 1000000 + 5000 * 200000 + 2000 * 10)
        self.assertEqual(light['codes'], ['000001', '000002', '000003'])

    def test_failed_constituent_call_skips_only_that_theme(self):
        fake = FakeKiwoom()

        def flaky(token, api_id, path, body):
            if body.get('thema_grp_cd') == '202':
                raise RuntimeError('boom')
            return fake(token, api_id, path, body)
        result = theme_flow.fetch_theme_flow('tok', call_tr=flaky, sleep=lambda s: None)
        self.assertEqual([r['industry'] for r in result['rows']], ['광통신'])

    def test_empty_listing_gives_no_rows(self):
        result = theme_flow.fetch_theme_flow(
            'tok', call_tr=lambda *a: {'thema_grp': []}, sleep=lambda s: None)
        self.assertEqual(result['rows'], [])


class ThemeFlowWiringContractTests(unittest.TestCase):
    def read(self, *parts):
        with open(os.path.join(ROOT, *parts), encoding='utf-8') as handle:
            return handle.read()

    def test_endpoint_and_background_are_wired(self):
        main = self.read('scripts', 'cloud-vm', 'main.py')
        self.assertIn("@app.get('/theme-flow')", main)
        self.assertIn('theme_flow.start_background(kiwoom_appkey, kiwoom_secretkey)', main)
        self.assertIn('theme_flow.get_cached()', main)

    def test_sector_flow_card_reads_broker_themes_not_hand_made_sectors(self):
        js = self.read('js', 'market-temp.js')
        start = js.index('// ---- 오늘 돈이 몰린 섹터')
        end = js.index('function buildStocksOnlyPage()')
        block = js[start:end]
        self.assertIn("var SECTOR_FLOW_URL = 'https://goodbyestar.cloud/theme-flow';", block)
        self.assertNotIn('SECTOR_MAP', block)
        self.assertIsNone(re.search(r'industry-flow', block))


if __name__ == '__main__':
    unittest.main()
