import sys
from pathlib import Path
from unittest import TestCase, mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'cloud-vm'))
import kis_client
import market_board


class VolumePowerTests(TestCase):
    def test_official_endpoint_and_single_page(self):
        with mock.patch.object(kis_client, '_get_domestic_quote', return_value={'output': [{'tday_rltv':'123.45'}]}) as call:
            rows = kis_client.fetch_domestic_volume_power_rank('t','k','s')
        args = call.call_args.args
        self.assertEqual(args[3:5], ('/uapi/domestic-stock/v1/ranking/volume-power','FHPST01680000'))
        self.assertEqual(args[5]['FID_TRGT_EXLS_CLS_CODE'], '0000000001')
        self.assertEqual(args[5]['FID_COND_MRKT_DIV_CODE'], 'J')
        self.assertEqual(rows[0]['tday_rltv'], '123.45')
        self.assertEqual(call.call_count, 1)

    def test_strength_not_substituted_from_turnover_or_volume(self):
        for value in (None, '', 'NaN', 'Infinity', '-1'):
            raw={'stck_shrn_iscd':'005930','vol_tnrt':'80','acml_vol':'999','tday_rltv':value}
            self.assertIsNone(market_board._kis_domestic_row(raw)['execution_strength'])
        raw={'stck_shrn_iscd':'005930','tday_rltv':'0'}
        self.assertEqual(market_board._kis_domestic_row(raw)['execution_strength'],0)

    def board(self, ranks=None, error=None):
        seed={'stck_shrn_iscd':'005930','hts_kor_isnm':'삼성전자', 'stck_prpr':'1000',
              'acml_vol':'10000','acml_tr_pbmn':'10000000'}
        with mock.patch.object(kis_client,'get_token',return_value='t'), \
             mock.patch.object(kis_client,'fetch_domestic_volume_rank',return_value=[seed]), \
             mock.patch.object(kis_client,'fetch_domestic_fluctuation_rank',return_value=[]), \
             mock.patch.object(kis_client,'fetch_domestic_market_cap_rank',return_value=[]), \
             mock.patch.object(kis_client,'fetch_domestic_volume_power_rank',return_value=ranks or [],side_effect=error), \
             mock.patch.object(market_board,'_enrich_domestic_kis_week52',side_effect=lambda t,k,s,rows,codes: rows):
            return market_board.fetch_domestic_kis('k','s',limit=30)

    def test_rank_descending_and_merge_preserves_actual_strength(self):
        result=self.board([
            {'stck_shrn_iscd':'005930','hts_kor_isnm':'삼성전자','tday_rltv':'150.25','stck_prpr':'1000'},
            {'stck_shrn_iscd':'000660','hts_kor_isnm':'SK하이닉스','tday_rltv':'300.50','stck_prpr':'2000'},
            {'stck_shrn_iscd':'035420','hts_kor_isnm':'NAVER','tday_rltv':'','stck_prpr':'3000'}])
        rows=result['sections']['volumePower']
        self.assertEqual([r['code'] for r in rows],['000660','005930'])
        self.assertEqual(rows[1]['execution_strength'],150.25)
        self.assertEqual(rows[1]['trade_volume'],10000)

    def test_strength_error_does_not_replace_with_another_ranking(self):
        result=self.board(error=RuntimeError('test unavailable'))
        self.assertEqual(result['sections']['volumePower'],[])
        self.assertTrue(result['sections']['tradeAmount'])

    def test_empty_strength_rank_is_empty(self):
        self.assertEqual(self.board()['sections']['volumePower'],[])

    def test_etf_exclusion_mask(self):
        with mock.patch.object(kis_client, '_get_domestic_quote', return_value={'output': []}) as call:
            kis_client.fetch_domestic_volume_power_rank('t','k','s',exclude_etf=True)
        self.assertEqual(call.call_args.args[5]['FID_TRGT_EXLS_CLS_CODE'], '0000001101')

    def test_spac_defense_filter(self):
        rows = self.board([
            {'stck_shrn_iscd':'123456','hts_kor_isnm':'테스트스팩12호','tday_rltv':'999'},
            {'stck_shrn_iscd':'000660','hts_kor_isnm':'SK하이닉스','tday_rltv':'300'}])['sections']
        for key in ('volumePower', 'volumePowerStocks'):
            self.assertEqual([r['code'] for r in rows[key]], ['000660'])
