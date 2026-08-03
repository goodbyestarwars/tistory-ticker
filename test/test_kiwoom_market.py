# -*- coding: utf-8 -*-
import os
import sys
import unittest

CLOUD_VM_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
if CLOUD_VM_DIR not in sys.path:
    sys.path.insert(0, CLOUD_VM_DIR)

import kiwoom_market  # noqa: E402


class LiveInvestorRowFromTests(unittest.TestCase):
    """2026-08-03 실측 리포트: 종목분석 수급 표의 '당일' 행이 개인·외국인·기관 전부 0으로
    뜨는 문제 - 개장 직후처럼 누적거래량이 아직 0일 때 ka10059의 투자자별 순매매 필드가
    집계 전이라 비어 있는데, to_num()이 이를 실제 0으로 오인해 표시하던 것이 원인."""

    def test_returns_none_when_no_rows(self):
        self.assertIsNone(kiwoom_market._live_investor_row_from([], '20260803'))

    def test_returns_none_when_latest_row_is_not_today(self):
        rows = [{'dt': '20260731', 'acc_trde_qty': '1000', 'orgn': '10', 'frgnr_invsr': '10', 'ind_invsr': '-20'}]
        self.assertIsNone(kiwoom_market._live_investor_row_from(rows, '20260803'))

    def test_returns_none_when_today_has_no_trades_yet(self):
        # 개장 직후 - 오늘 행은 존재하지만 누적거래량 0, 투자자 필드도 비어 있음
        rows = [{'dt': '20260803', 'acc_trde_qty': '0', 'cur_prc': '12345', 'flu_rt': '0',
                 'orgn': '', 'frgnr_invsr': '', 'ind_invsr': ''}]
        self.assertIsNone(kiwoom_market._live_investor_row_from(rows, '20260803'))

    def test_returns_live_row_once_trading_has_started(self):
        rows = [{'dt': '20260803', 'acc_trde_qty': '15000', 'cur_prc': '12345', 'flu_rt': '150',
                 'orgn': '100', 'frgnr_invsr': '-50', 'ind_invsr': '-50'}]
        row = kiwoom_market._live_investor_row_from(rows, '20260803')
        self.assertEqual(row, {
            'close': 12345.0, 'change_pct': 1.5, 'volume': 15000.0,
            'inst_net': 100.0, 'foreign_net': -50.0, 'ind_net': -50.0,
        })


if __name__ == '__main__':
    unittest.main()
