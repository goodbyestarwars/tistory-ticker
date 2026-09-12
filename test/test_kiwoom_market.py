# -*- coding: utf-8 -*-
import os
import sys
import time
import unittest
from unittest import mock

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


class ForeignFlowConcurrencyTests(unittest.TestCase):
    """2026-09-12: /foreign-flow/{code}가 종목분석에서 가장 오래 걸리는 호출이었다
    (실측 3.2~10.5초). ka10008이 KIS 일별 페이징 앞에 직렬로 놓여 있었는데,
    frgn_by_date는 페이징이 끝난 뒤 출력 루프에서만 읽히므로 겹칠 수 있다.

    소스 문자열이 아니라 실제 호출 타이밍으로 검증한다 - 겹치는지 여부는 구현의
    본질이고, 문자열 검사는 나중에 구조가 바뀌면 조용히 무의미해진다."""

    def setUp(self):
        self.events = []          # (이름, 'start'|'end', 시각)
        self.page_calls = 0

    def _record(self, name, phase):
        self.events.append((name, phase, time.time()))

    def _fake_call_tr(self, token, tr, path, payload, *a, **kw):
        if tr == 'ka10008':
            self._record('ka10008', 'start')
            time.sleep(0.05)
            self._record('ka10008', 'end')
            return {'stk_frgnr': [{'dt': '20260911', 'poss_stkcnt': '100', 'wght': '50.0'}]}
        if tr == 'ka10059':
            time.sleep(0.01)
            return {'stk_invsr_orgn': []}
        raise AssertionError('예상치 못한 TR: %s' % tr)

    def _fake_fetch_investor_trade_daily(self, token, appkey, secret, code, cursor_dt, div):
        self.page_calls += 1
        self._record('kis_page', 'start')
        time.sleep(0.05)
        self._record('kis_page', 'end')
        # 페이지마다 새 날짜를 주되, target_days를 채우기 전에 두 번은 돌게 한다.
        base = 20260911 - (self.page_calls - 1) * 2
        rows = [{'stck_bsop_date': str(base - i), 'stck_clpr': '100', 'prdy_ctrt': '1.0',
                 'acml_vol': '10', 'orgn_ntby_qty': '1', 'frgn_reg_ntby_qty': '2',
                 'prsn_ntby_qty': '3'} for i in range(2)]
        return None, rows

    def _run(self):
        import concurrent.futures
        with mock.patch.object(kiwoom_market.kiwoom_client, 'call_tr', side_effect=self._fake_call_tr), \
             mock.patch.object(kiwoom_market.kis_client, 'get_token', return_value='tok'), \
             mock.patch.object(kiwoom_market.kis_client, 'fetch_investor_trade_daily',
                               side_effect=self._fake_fetch_investor_trade_daily), \
             mock.patch.object(kiwoom_market.db_schema, 'get_conn'), \
             mock.patch.object(kiwoom_market.db_schema, 'upsert_kis_flow_cache'):
            return kiwoom_market.fetch_foreign_inst_daily(
                'kiwoom-token', '005930', kis_appkey='k', kis_appsecret='s', target_days=4,
            )

    def test_ka10008_overlaps_the_kis_paging(self):
        self._run()
        starts = {name: t for name, phase, t in self.events if phase == 'start' and name == 'ka10008'}
        ka_start = starts['ka10008']
        ka_end = [t for name, phase, t in self.events if name == 'ka10008' and phase == 'end'][0]
        page_starts = [t for name, phase, t in self.events if name == 'kis_page' and phase == 'start']
        self.assertTrue(page_starts, 'KIS 페이징이 한 번도 안 돌았다')
        # 첫 KIS 페이지가 ka10008이 끝나기를 기다리지 않고 시작해야 한다.
        self.assertLess(page_starts[0], ka_end,
                        'ka10008이 끝난 뒤에야 KIS 페이징이 시작됐다 - 직렬로 되돌아갔다')
        self.assertGreaterEqual(page_starts[0], ka_start)

    def test_result_still_carries_foreign_holdings_from_ka10008(self):
        """병렬로 바꾸면서 ka10008 결과가 행에 안 실리면 보유주수/비중이 통째로 빈다."""
        out = self._run()
        self.assertTrue(out)
        row = [r for r in out if r['date'] == '2026-09-11']
        self.assertTrue(row, '20260911 행이 없다')
        self.assertEqual(100, row[0]['foreign_shares'])
        self.assertEqual(50.0, row[0]['foreign_ratio'])

    def test_ka10008_is_fetched_exactly_once(self):
        """provider를 여러 번 불러도 ka10008은 한 번만 나가야 한다(메모이즈)."""
        self._run()
        ka_starts = [t for name, phase, t in self.events if name == 'ka10008' and phase == 'start']
        self.assertEqual(1, len(ka_starts))
