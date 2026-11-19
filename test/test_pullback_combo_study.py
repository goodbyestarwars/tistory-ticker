# -*- coding: utf-8 -*-
"""pullback_combo_study 미래 비참조 검사(2026-11-19 v1 버그 재발 방지: 과거 수익률을 미래 수익률이 덮어씀)."""
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts', 'research'))
import pullback_combo_study as P  # noqa: E402

COLS = ['ma60_slope', 'mom60', 'dip_atr', 'dry10', 'amt20', 'ivol60', 'upvol20', 'upday']


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
