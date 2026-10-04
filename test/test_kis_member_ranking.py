import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import kis_client


class MemberRankingTests(unittest.TestCase):
    def test_parses_buy_sell_top5_with_official_field_names(self):
        output = {
            'shnu_mbcr_name1': '키움증권', 'shnu_mbcr_no1': '050', 'total_shnu_qty1': '47469',
            'shnu_mbcr_rlim1': '18.50', 'shnu_qty_icdc1': '120', 'shnu_mbcr_glob_yn_1': 'N',
            'shnu_mbcr_name2': 'JP모간', 'total_shnu_qty2': '33,982', 'shnu_mbcr_glob_yn_2': 'Y',
            'shnu_mbcr_name3': '', 'total_shnu_qty3': '0',
            'seln_mbcr_name1': 'UBS', 'total_seln_qty1': '83250', 'seln_mbcr_glob_yn_1': 'Y',
            'glob_total_shnu_qty': '33982', 'glob_total_seln_qty': '106425', 'glob_ntby_qty': '-72443',
        }
        result = kis_client.member_ranking(output)
        self.assertEqual([row['name'] for row in result['buy']], ['키움증권', 'JP모간'])
        self.assertEqual(result['buy'][0]['qty'], 47469)
        self.assertEqual(result['buy'][0]['share'], 18.5)
        self.assertFalse(result['buy'][0]['foreign'])
        self.assertEqual(result['buy'][1]['qty'], 33982)
        self.assertTrue(result['buy'][1]['foreign'])
        self.assertEqual(result['sell'][0], {'rank': 1, 'name': 'UBS', 'code': '', 'qty': 83250,
                                             'share': None, 'change': None, 'foreign': True})
        self.assertEqual(result['foreign']['netQty'], -72443)

    def test_empty_output_is_safe(self):
        result = kis_client.member_ranking(None)
        self.assertEqual(result['buy'], [])
        self.assertEqual(result['sell'], [])

    def test_kiwoom_fallback_uses_absolute_quantities(self):
        res = {'buy_trde_ori_nm_1': '키움증권', 'buy_trde_ori_1': '050', 'buy_trde_qty_1': '+47469',
               'sel_trde_ori_nm_1': 'UBS', 'sel_trde_qty_1': '-83250', 'sel_trde_ori_nm_2': ''}
        result = kis_client.member_ranking_kiwoom(res)
        self.assertEqual(result['buy'][0]['qty'], 47469)
        self.assertEqual(result['sell'][0]['qty'], 83250)
        self.assertEqual(len(result['sell']), 1)


if __name__ == '__main__':
    unittest.main()
