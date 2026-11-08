import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import investor_flow
import public_data


class OfficialHoldingTests(unittest.TestCase):
    """연기금 매매 동향 카드의 'official_holding' 보조 정보 - 2026-08-20 추가.
    js/foreign-flow.js의 buildPensionCard는 p.official_holding이 있으면 국민연금
    연말 보유(평가액/지분율)를 같이 보여주도록 이미 짜여 있었지만, 채워주는 곳이
    없어 항상 빈 채로 숨어 있었다. 여기서는 그 값을 채우는 investor_flow.official_holding()이
    성공/미설정/예외 세 경로 모두에서 나머지 수급 데이터를 절대 깨지 않는지만 확인한다."""

    def test_returns_nps_holding_info_on_success(self):
        info = {'evaluation_amount_eok': 1000.0, 'holding_pct': 8.5, 'weight_pct': 5.0,
                'as_of': '2024-12-31', 'source': '국민연금공단 국내주식 투자정보'}
        with mock.patch.object(public_data, 'fetch_nps_holding', return_value=info) as m:
            result = investor_flow.official_holding('삼성전자')
        m.assert_called_once_with('삼성전자')
        self.assertEqual(result, info)

    def test_returns_none_when_service_key_missing(self):
        with mock.patch.object(public_data, 'fetch_nps_holding',
                                side_effect=public_data.PublicDataUnavailable('키 없음')):
            result = investor_flow.official_holding('삼성전자')
        self.assertIsNone(result)

    def test_returns_none_and_swallows_unexpected_error(self):
        with mock.patch.object(public_data, 'fetch_nps_holding', side_effect=RuntimeError('boom')):
            result = investor_flow.official_holding('삼성전자')
        self.assertIsNone(result)

    def test_returns_none_when_not_held(self):
        with mock.patch.object(public_data, 'fetch_nps_holding', return_value=None):
            result = investor_flow.official_holding('국민연금이 안 가진 종목')
        self.assertIsNone(result)


class LargeHoldingReportTests(unittest.TestCase):
    """연기금 매매 동향 카드의 'large_holding_report' 보조 정보 - 2026-08-20 추가.
    official_holding(연 1회 전체 랭킹)과는 별개인 대량보유상황보고(5% 이상 보유·1%p
    이상 변동, 분기 단위 재배포) 데이터셋 - 사용자가 "연 1회는 오래됐다"고 리포트한
    데 대해, 기존 카테고리는 그대로 두고 이걸 보조 정보로 추가하기로 함. 전체
    포트폴리오가 아니라 5%룰 신고 종목만 있는 데이터셋이라 None이 정상인 경우가
    대부분이라는 점도 함께 확인한다."""

    def test_returns_report_info_on_success(self):
        info = {'as_of': '2026-01-29', 'holding_pct': 8.94,
                'source': '국민연금공단 대량보유주식 보고내역(5% 이상 보유·1%p 이상 변동 신고)'}
        with mock.patch.object(public_data, 'fetch_nps_large_holding', return_value=info) as m:
            result = investor_flow.large_holding_report('KB금융')
        m.assert_called_once_with('KB금융')
        self.assertEqual(result, info)

    def test_returns_none_when_service_key_missing(self):
        with mock.patch.object(public_data, 'fetch_nps_large_holding',
                                side_effect=public_data.PublicDataUnavailable('키 없음')):
            result = investor_flow.large_holding_report('KB금융')
        self.assertIsNone(result)

    def test_returns_none_and_swallows_unexpected_error(self):
        with mock.patch.object(public_data, 'fetch_nps_large_holding', side_effect=RuntimeError('boom')):
            result = investor_flow.large_holding_report('KB금융')
        self.assertIsNone(result)

    def test_returns_none_when_no_recent_5pct_report(self):
        # 5%룰 신고 대상이 아닌(=대부분의) 종목은 None이 정상 - 전체 포트폴리오가 아니다.
        with mock.patch.object(public_data, 'fetch_nps_large_holding', return_value=None):
            result = investor_flow.large_holding_report('5%룰 신고 없는 종목')
        self.assertIsNone(result)


class DownsideSeriesTests(unittest.TestCase):
    """종목분석 카드형 '하방 압력 점검' 시계열 - 받은 TR 응답만 잘라 붙이고 결측은 None."""

    def test_maps_fields_and_keeps_missing_as_none(self):
        series = investor_flow.downside_series(
            [{'dt': '20261106', 'remn': '2872755', 'remn_rt': '2.11', 'new': '268236', 'rpya': '316574', 'amt': '273542'},
             {'dt': '20261105', 'remn': '', 'remn_rt': '-'}],
            [{'dt': '20261106', 'rmnd': '22194946', 'dbrt_trde_irds': '89553'}],
            [{'dt': '20261106', 'shrts_qty': '390146', 'trde_wght': '+32.71', 'ovr_shrts_qty': '4656707'}],
            [{'dt': '20261106', 'ind_invsr': '6773', 'frgnr_invsr': '-24941', 'orgn': '+18196'}, {'dt': 'bad'}],
        )
        self.assertEqual(series['credit'][0], {'date': '2026-11-06', 'balance': 2872755.0, 'ratio_pct': 2.11,
                                               'new': 268236.0, 'repay': 316574.0, 'amount_mil': 273542.0})
        self.assertEqual(len(series['credit']), 1, '값이 하나도 없는 행은 0이 아니라 생략')
        self.assertEqual(series['loan'][0]['balance'], 22194946.0)
        self.assertEqual(series['short'][0]['ratio_pct'], 32.71)
        self.assertEqual(series['investor'], [{'date': '2026-11-06', 'ind_mil': 6773.0, 'foreign_mil': -24941.0, 'inst_mil': 18196.0}])

    def test_skips_all_zero_premarket_row(self):
        series = investor_flow.downside_series(
            [{'dt': '20261109', 'remn': '0', 'remn_rt': '0.00', 'new': '0', 'rpya': '0', 'amt': '0'},
             {'dt': '20261106', 'remn': '2872755', 'remn_rt': '2.11', 'new': '0', 'rpya': '0', 'amt': '0'}],
            [], [],
            [{'dt': '20261109', 'ind_invsr': '0', 'frgnr_invsr': '0', 'orgn': '0'},
             {'dt': '20261106', 'ind_invsr': '6773', 'frgnr_invsr': '0', 'orgn': '-6773'}],
        )
        self.assertEqual([r['date'] for r in series['credit']], ['2026-11-06'])
        self.assertEqual([r['date'] for r in series['investor']], ['2026-11-06'])

    def test_limits_days(self):
        rows = [{'dt': '202610%02d' % (i + 1), 'rmnd': str(i)} for i in range(30)]
        self.assertEqual(len(investor_flow.downside_series([], rows, [], [], days=10)['loan']), 10)


if __name__ == '__main__':
    unittest.main()
