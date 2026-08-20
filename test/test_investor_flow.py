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


if __name__ == '__main__':
    unittest.main()
