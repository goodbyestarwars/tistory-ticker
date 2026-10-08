import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import kis_client
import market_board


class VolumeRankEtfExclusionTests(unittest.TestCase):
    def test_exclusion_mask_sets_etf_and_etn_positions(self):
        # 공식 예제 순서: 투자위험·경고·주의/관리/정리매매/불성실공시/우선주/거래정지/ETF/ETN/신용주문불가/SPAC
        seen = []
        with mock.patch.object(kis_client, '_get_domestic_quote', side_effect=lambda *a, **k: seen.append(a[5]) or {'output': []}):
            kis_client.fetch_domestic_volume_rank('t', 'k', 's', sort_code='3')
            kis_client.fetch_domestic_volume_rank('t', 'k', 's', sort_code='3', exclude_etf=True)
        self.assertEqual(seen[0]['FID_TRGT_EXLS_CLS_CODE'], '0000000000')
        self.assertEqual(seen[1]['FID_TRGT_EXLS_CLS_CODE'], '0000001100')

    def test_fluctuation_rank_supports_sort_and_exclusion(self):
        seen = []
        with mock.patch.object(kis_client, '_get_domestic_quote', side_effect=lambda *a, **k: seen.append(a[5]) or {'output': []}):
            kis_client.fetch_domestic_fluctuation_rank('t', 'k', 's')
            kis_client.fetch_domestic_fluctuation_rank('t', 'k', 's', sort_code='1', exclude_etf=True)
        self.assertEqual((seen[0]['FID_RANK_SORT_CLS_CODE'], seen[0]['FID_TRGT_EXLS_CLS_CODE']), ('0', '0'))
        self.assertEqual((seen[1]['FID_RANK_SORT_CLS_CODE'], seen[1]['FID_TRGT_EXLS_CLS_CODE']), ('1', '0000001100'))
        for params in seen:
            self.assertEqual(params['FID_INPUT_CNT_1'], '0')  # 당일, 반환 건수/40일이 아님
            self.assertEqual(params['FID_PRC_CLS_CODE'], '1')  # 전일 종가 대비, 고저가 대비가 아님

    def test_board_returns_stock_only_sections(self):
        def rank(token, appkey, appsecret, sort_code='3', limit=20, exclude_etf=False):
            if exclude_etf:
                return [{'mksc_shrn_iscd': '005930', 'hts_kor_isnm': '삼성전자', 'stck_prpr': '1000', 'acml_tr_pbmn': '9', 'acml_vol': '9', 'vol_inrt': '10'}]
            return [{'mksc_shrn_iscd': '069500', 'hts_kor_isnm': 'KODEX 200', 'stck_prpr': '1000', 'acml_tr_pbmn': '9', 'acml_vol': '9', 'vol_inrt': '10'}]
        def fluct(token, appkey, appsecret, limit=20, sort_code='0', exclude_etf=False):
            if not exclude_etf:
                return []
            if sort_code == '0':
                return [{'stck_shrn_iscd': '000660', 'hts_kor_isnm': 'SK하이닉스', 'stck_prpr': '1000', 'prdy_ctrt': '3.5'}]
            return [
                {'stck_shrn_iscd': '035420', 'hts_kor_isnm': 'NAVER', 'stck_prpr': '1000', 'prdy_ctrt': '-2.1'},
                {'stck_shrn_iscd': '087010', 'hts_kor_isnm': '펩트론', 'stck_prpr': '91500', 'prdy_ctrt': '-29.94'},
            ]
        with mock.patch.object(kis_client, 'get_token', return_value='t'), \
                mock.patch.object(kis_client, 'fetch_domestic_volume_rank', side_effect=rank), \
                mock.patch.object(kis_client, 'fetch_domestic_fluctuation_rank', side_effect=fluct), \
                mock.patch.object(kis_client, 'fetch_domestic_market_cap_rank', return_value=[]), \
                mock.patch.object(market_board, '_enrich_domestic_kis_week52', side_effect=lambda t, a, s, rows, codes: rows):
            board = market_board.fetch_domestic_kis('k', 's', limit=40)
        sections = board['sections']
        self.assertEqual([r['code'] for r in sections['tradeAmountStocks']], ['005930'])
        self.assertEqual([r['code'] for r in sections['tradeVolumeStocks']], ['005930'])
        self.assertEqual([r['code'] for r in sections['tradeAmount']], ['069500'])
        self.assertEqual([r['code'] for r in sections['risingStocks']], ['000660'])
        self.assertEqual([r['code'] for r in sections['fallingStocks']], ['087010', '035420'])
        self.assertEqual(sections['fallingStocks'][0]['change_rate'], -29.94)


if __name__ == '__main__':
    unittest.main()
