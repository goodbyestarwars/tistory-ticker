# -*- coding: utf-8 -*-
import os
import sys
import unittest

CLOUD_VM_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
if CLOUD_VM_DIR not in sys.path:
    sys.path.insert(0, CLOUD_VM_DIR)

import kiwoom_market  # noqa: E402


class LiveInvestorRowFromTests(unittest.TestCase):
    """2026-08-03 실측 리포트(1~3차): 종목분석 수급 표의 '당일' 행 문제.
    1차: 개장 직후(누적거래량 0)엔 ka10059 투자자별 필드가 비어 있는데 to_num()이 이를
    실제 0으로 오인.
    2차: 거래 시작 후에도 외국인·기관·개인이 동시에 채워지지 않아 일부만 실제값, 나머지는
    0으로 뒤섞여 보임 - 빈 문자열 가드 추가.
    3차: 그런데도 재현됨 - 외국인·기관은 실제 순매매가 찍히는데 개인만 정확히 "0" 문자열로
    내려와(빈 문자열이 아님) 2차 가드로 못 잡았다. 값만으로는 "진짜 0"과 "집계 전"을 구분할
    수 없어, 이 실시간 패치에서는 개인 순매매(ind_net)를 아예 신뢰하지 않고 항상 None으로
    돌려 프론트가 기존 규칙대로 "-"로 표시하게 한다. 외국인·기관은 계속 신뢰한다."""

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

    def test_returns_live_row_with_ind_net_always_none(self):
        rows = [{'dt': '20260803', 'acc_trde_qty': '15000', 'cur_prc': '12345', 'flu_rt': '150',
                 'orgn': '100', 'frgnr_invsr': '-50', 'ind_invsr': '-50'}]
        row = kiwoom_market._live_investor_row_from(rows, '20260803')
        self.assertEqual(row, {
            'close': 12345.0, 'change_pct': 1.5, 'volume': 15000.0,
            'inst_net': 100.0, 'foreign_net': -50.0, 'ind_net': None,
        })

    def test_returns_none_when_only_foreign_net_is_populated(self):
        # 2026-08-03(2차) 실측 리포트: 거래는 시작됐지만 기관 필드는 아직 빈 문자열
        rows = [{'dt': '20260803', 'acc_trde_qty': '15000', 'cur_prc': '12345', 'flu_rt': '150',
                 'orgn': '', 'frgnr_invsr': '-50', 'ind_invsr': ''}]
        self.assertIsNone(kiwoom_market._live_investor_row_from(rows, '20260803'))

    def test_returns_none_when_investor_field_key_missing_entirely(self):
        rows = [{'dt': '20260803', 'acc_trde_qty': '15000', 'cur_prc': '12345', 'flu_rt': '150',
                 'frgnr_invsr': '-50'}]  # orgn 키 자체가 없음
        self.assertIsNone(kiwoom_market._live_investor_row_from(rows, '20260803'))

    def test_ind_net_is_none_even_when_ind_invsr_looks_like_a_real_zero(self):
        # 2026-08-03(3차) 실측 리포트: 외국인·기관은 실제 순매매, 개인만 "0" 문자열
        rows = [{'dt': '20260803', 'acc_trde_qty': '15000', 'cur_prc': '12345', 'flu_rt': '150',
                 'orgn': '10000', 'frgnr_invsr': '-1000', 'ind_invsr': '0'}]
        row = kiwoom_market._live_investor_row_from(rows, '20260803')
        self.assertEqual(row['inst_net'], 10000.0)
        self.assertEqual(row['foreign_net'], -1000.0)
        self.assertIsNone(row['ind_net'])


class IndividualFallbackTests(unittest.TestCase):
    def test_keeps_real_zero_but_skips_blank_values(self):
        rows = [
            {'dt': '20260807', 'ind_invsr': '-1250'},
            {'dt': '20260806', 'ind_invsr': '0'},
            {'dt': '20260805', 'ind_invsr': ''},
            {'dt': '20260804'},
        ]
        self.assertEqual(kiwoom_market._individual_by_date_from(rows), {
            '20260807': -1250.0,
            '20260806': 0.0,
        })


class MergeLiveRowTests(unittest.TestCase):
    """2026-08-03(4차) 실측 리포트(비에이치아이): 15:40(KST) 이후 KIS 확정 TR이 열려
    out[0]에 이미 오늘의 확정 개인 순매매가 들어와 있는데도, live_row(ind_net=None
    고정)로 무조건 덮어써서 확정치가 있는데도 "-"로 보이는 문제 - _merge_live_row가
    확정 개인 순매매를 None으로 지우지 않는지 검증한다."""

    def test_confirmed_ind_net_is_not_clobbered_by_live_none(self):
        out = [{'date': '2026-08-03', 'close': 10000, 'ind_net': -300.0, 'foreign_net': 100.0, 'inst_net': 50.0}]
        live_row = {'close': 10100.0, 'change_pct': 1.0, 'volume': 5000.0,
                    'inst_net': 60.0, 'foreign_net': 120.0, 'ind_net': None}
        kiwoom_market._merge_live_row(out, live_row, '2026-08-03')
        self.assertEqual(out[0]['ind_net'], -300.0)
        self.assertEqual(out[0]['foreign_net'], 120.0)
        self.assertEqual(out[0]['inst_net'], 60.0)
        self.assertEqual(out[0]['close'], 10100.0)

    def test_inserts_new_row_when_no_confirmed_row_for_today(self):
        out = [{'date': '2026-07-31', 'close': 9000, 'ind_net': -100.0, 'foreign_net': 10.0, 'inst_net': 5.0}]
        live_row = {'close': 10100.0, 'change_pct': 1.0, 'volume': 5000.0,
                    'inst_net': 60.0, 'foreign_net': 120.0, 'ind_net': None}
        kiwoom_market._merge_live_row(out, live_row, '2026-08-03')
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0]['date'], '2026-08-03')
        self.assertIsNone(out[0]['ind_net'])

    def test_noop_when_live_row_is_none(self):
        out = [{'date': '2026-08-03', 'close': 10000, 'ind_net': -300.0, 'foreign_net': 100.0, 'inst_net': 50.0}]
        kiwoom_market._merge_live_row(out, None, '2026-08-03')
        self.assertEqual(out, [{'date': '2026-08-03', 'close': 10000, 'ind_net': -300.0, 'foreign_net': 100.0, 'inst_net': 50.0}])


if __name__ == '__main__':
    unittest.main()
