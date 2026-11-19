# -*- coding: utf-8 -*-
"""pullback_combo_study 미래 비참조 검사(2026-11-19 v1 버그 재발 방지: 과거 수익률을 미래 수익률이 덮어씀)."""
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts', 'research'))
import pullback_combo_study as P  # noqa: E402

COLS = ['ma60_slope', 'mom60', 'dip_atr', 'dry10', 'amt20', 'ivol60', 'upvol20', 'upday', 'rs120', 'up_low120', 'nh250']


def bars(n=400, seed=3):
    rng = np.random.default_rng(seed)
    c, out = 10000.0, []
    for i in range(n):
        o = c
        c = max(1000.0, c * (1 + rng.normal(0, .02)))
        h, l = max(o, c) * 1.01, min(o, c) * .99
        out.append(['2025%04d' % i, o, h, l, c, float(rng.integers(1e5, 1e6))])
    return out


class LookAhead(unittest.TestCase):
    def test_signal_columns_ignore_future_bars(self):
        px = bars()
        full, cut = P.frame('x', px, {}), P.frame('x', px[:300], {})
        a, b = full.loc[:299, COLS], cut.loc[:299, COLS]
        self.assertTrue(((a == b) | (a.isna() & b.isna())).all().all())

    def test_past_momentum_not_overwritten_by_forward_return(self):
        f = P.frame('x', bars(), {})
        c = np.array([r[4] for r in bars()])
        self.assertAlmostEqual(f.mom60.iat[200], c[200] / c[140] - 1, places=9)
        self.assertNotAlmostEqual(f.mom60.iat[200], f.ret60.iat[200], places=6)


class MomentumColumns(unittest.TestCase):
    """5단계(2026-11-19): 신고가는 직전 250봉 고가만 비교(당일 고가·미래 제외)."""

    def test_new_high_uses_prior_bars_only(self):
        px = bars()
        f = P.frame('x', px, {})
        h = np.array([r[2] for r in px])
        c = np.array([r[4] for r in px])
        for i in (260, 320, 399):
            self.assertEqual(bool(f.nh250.iat[i]), bool(c[i] > h[i - 250:i].max()))
        self.assertFalse(f.nh250.iloc[:250].any())


class EarningsPointInTime(unittest.TestCase):
    """3단계 실적(2026-11-19): 접수일 당일까지는 그 보고서를 쓰지 않고, 미래 보고서가 과거 값을 바꾸지 않는다."""

    ROWS = [['20250010', 2024, '11014', 'CFS', 100.0, 80.0, 10.0, -5.0, 8.0, -6.0],
            ['20250100', 2024, '11011', 'CFS', 120.0, 100.0, 20.0, 10.0, 15.0, 7.0]]

    def test_report_used_only_after_filing_day(self):
        dates = ['2025%04d' % i for i in range(150)]
        e = P.earn_cols(dates, self.ROWS)
        self.assertTrue(e.e_op_sym.iloc[:11].isna().all())  # 20250010 당일까지 결측
        self.assertAlmostEqual(e.e_op_sym.iat[11], (10 - -5) / 7.5)
        self.assertEqual(e.e_turn.iat[11], 1.0)
        self.assertEqual(e.e_age.iat[11], 0)
        self.assertAlmostEqual(e.e_rev_yoy.iat[100], 0.25)  # 100일째도 아직 3분기 보고서
        self.assertAlmostEqual(e.e_rev_yoy.iat[101], 0.2)

    def test_future_report_does_not_change_past(self):
        dates = ['2025%04d' % i for i in range(150)]
        a = P.earn_cols(dates, self.ROWS)
        b = P.earn_cols(dates, self.ROWS[:1])
        self.assertTrue(((a.iloc[:101] == b.iloc[:101]) | (a.iloc[:101].isna() & b.iloc[:101].isna())).all().all())

    def test_frame_earn_columns_ignore_future_bars(self):
        px = bars()
        rows = [['2025%04d' % 50, 2024, '11014', 'CFS', 100.0, 80.0, 10.0, 5.0, 1.0, 1.0]]
        full, cut = P.frame('x', px, {}, None, rows), P.frame('x', px[:300], {}, None, rows)
        cols = list(P.EARN_KEYS)
        a, b = full.loc[:299, cols], cut.loc[:299, cols]
        self.assertTrue(((a == b) | (a.isna() & b.isna())).all().all())


class EventsPointInTime(unittest.TestCase):
    """4단계 공시 사건(2026-11-19): 신호는 접수 거래일 다음 날에만, 그날 종가까지로 계산하고 미래 봉을 쓰지 않는다."""

    def test_signal_day_and_reaction(self):
        dates = ['2025%04d' % i for i in range(60)]
        c = np.full(60, 100.0)
        c[31] = 110.0
        atr = np.full(60, 5.0)
        e = P.event_cols(dates, c, atr, [['2025%04d' % 30, 'earn'], ['20250045', 'rights']])
        self.assertTrue(np.isnan(e.ev_earn.iat[30]))  # 접수일 당일은 신호 아님
        self.assertAlmostEqual(e.ev_earn.iat[31], (110 / 100 - 1) / 0.05)  # 2 ATR
        self.assertEqual(e.ev_up20.iat[30], 0)
        self.assertEqual(e.ev_up20.iat[31], 1)
        self.assertEqual(e.ev_up20.iat[50], 1)
        self.assertEqual(e.ev_up20.iat[51], 0)
        self.assertFalse(np.isnan(e.ev_rights.iat[46]))
        self.assertEqual(e.evw_earn.iat[20], 1)  # j=30 in [i-5, i+10] for i=20
        self.assertEqual(e.evw_earn.iat[19], 0)

    def test_weekend_filing_maps_to_next_trading_day(self):
        dates = ['20250103', '20250106', '20250107', '20250108']  # 금, 월, 화, 수
        c, atr = np.array([100., 100., 105., 106.]), np.full(4, 2.0)
        e = P.event_cols(dates, c, atr, [['20250104', 'contract']])  # 토요일 접수 -> j=월, s=화
        self.assertAlmostEqual(e.ev_contract.iat[2], (105 / 100 - 1) / 0.02)
        self.assertTrue(e.ev_contract.drop(index=2).isna().all())

    def test_frame_event_columns_ignore_future_bars(self):
        px = bars()
        evs = [['2025%04d' % 100, 'earn'], ['2025%04d' % 250, 'contract'], ['2025%04d' % 299, 'buyback'], ['2025%04d' % 350, 'bonus']]
        full, cut = P.frame('x', px, {}, None, None, evs), P.frame('x', px[:300], {}, None, None, evs)
        cols = ['ev_' + k for k in P.EV_KINDS] + ['ev_up20']
        a, b = full.loc[:299, cols], cut.loc[:299, cols]
        self.assertTrue(((a == b) | (a.isna() & b.isna())).all().all())
        self.assertFalse(any(k.startswith(('evw_', 'evp_')) for k in full.columns))  # 미래 포함 서술용 열은 매매 표에 없음


class DartQ4(unittest.TestCase):
    def test_q4_is_annual_minus_q3_cumulative(self):
        import fetch_dart_quarterly_cache as F

        def r(rc, no, cur, prev, add=None, padd=None, fs='CFS'):
            return {'stock_code': '000001', 'bsns_year': '2024', 'reprt_code': rc, 'fs_div': fs, 'sj_div': 'IS',
                    'account_nm': '영업이익', 'rcept_no': no, 'thstrm_amount': cur, 'frmtrm_amount': prev,
                    'thstrm_add_amount': add, 'frmtrm_add_amount': padd}
        rows = F.build_rows([[r('11014', '20241114000001', '30', '20', '90', '70'),
                              r('11011', '20250310000001', '1,200', '100'),
                              r('11011', '20250310000002', '999', '999', fs='OFS')]])['000001']
        q4 = [x for x in rows if x[2] == '11011'][0]
        self.assertEqual(q4[0], '20250310')
        self.assertEqual(q4[3], 'CFS')  # 연결 우선
        self.assertEqual((q4[6], q4[7]), (1110.0, 30.0))
        self.assertIsNone(q4[4])  # 매출 없음은 결측(0 아님)


if __name__ == '__main__':
    unittest.main()
