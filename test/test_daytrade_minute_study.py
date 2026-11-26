# -*- coding: utf-8 -*-
"""지지 돌파 단타 분봉 백테스트 스크립트의 판정 규칙 검증 (합성 분봉, 외부 호출 없음)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts', 'research'))
import daytrade_support_breakout_minute_study as S  # noqa: E402


def hhmm(i):
    """i번째 정규장 1분봉 라벨(09:00 시작)."""
    m = 9 * 60 + i
    return '%02d%02d00' % (m // 60, m % 60)


def day(prices, vol=100.0):
    """prices: 분봉 번호 -> (o,h,l,c). 나머지 분봉은 직전 종가에 머무른다. 390봉."""
    bars, last = [], 98.0
    for i in range(390):
        if i in prices:
            o, h, l, c = prices[i]
        else:
            o = h = l = c = last
        bars.append((hhmm(i), float(o), float(h), float(l), float(c), vol))
        last = c
    return bars


CTX = {'prev_high': 100.0, 'prev_close': 98.0, 'day_high': 0.0, 'next_date': '20260102'}


class RowsTest(unittest.TestCase):
    def test_parse_filters_other_day_and_off_hours(self):
        rows = [
            {'stck_bsop_date': '20251201', 'stck_cntg_hour': '090000', 'stck_oprc': '10', 'stck_hgpr': '11',
             'stck_lwpr': '9', 'stck_prpr': '10', 'cntg_vol': '5'},
            {'stck_bsop_date': '20251130', 'stck_cntg_hour': '090100', 'stck_oprc': '1', 'stck_hgpr': '1',
             'stck_lwpr': '1', 'stck_prpr': '1', 'cntg_vol': '1'},
            {'stck_bsop_date': '20251201', 'stck_cntg_hour': '160000', 'stck_oprc': '1', 'stck_hgpr': '1',
             'stck_lwpr': '1', 'stck_prpr': '1', 'cntg_vol': '1'},
            {'stck_bsop_date': '20251201', 'stck_cntg_hour': '090100', 'stck_oprc': 'x'},
        ]
        out = S.parse_rows(rows, '20251201')
        self.assertEqual([b[0] for b in out], ['090000'])

    def test_fetch_day_pages_backwards_until_open(self):
        full = day({}, vol=1)
        for i, b in enumerate(full):
            full[i] = (b[0], 50.0, 50.0, 50.0, 50.0, 1.0)
        calls = []

        def call(code, date, hour):
            calls.append(hour)
            upto = [b for b in full if b[0] <= hour]
            rows = []
            for b in reversed(upto[-120:]):
                rows.append({'stck_bsop_date': date, 'stck_cntg_hour': b[0], 'stck_oprc': b[1], 'stck_hgpr': b[2],
                             'stck_lwpr': b[3], 'stck_prpr': b[4], 'cntg_vol': b[5]})
            return rows
        bars = S.fetch_day(call, '000001', '20251201')
        self.assertEqual(len(bars), 390)
        self.assertEqual(bars[0][0], '090000')
        self.assertEqual(len(calls), 4)

    def test_fetch_day_stops_without_progress(self):
        calls = []

        def call(code, date, hour):
            calls.append(hour)
            return []
        self.assertEqual(S.fetch_day(call, '000001', '20251201'), [])
        self.assertEqual(len(calls), 1)


class SimulateTest(unittest.TestCase):
    def ctx(self, bars):
        c = dict(CTX)
        c['day_high'] = max(b[2] for b in bars)
        return c

    def test_no_break_is_skipped(self):
        bars = day({0: (98, 99, 97, 98)})
        c = dict(CTX, day_high=max(b[2] for b in bars))
        self.assertEqual(S.simulate(bars, [], c)['skip'], 'no_break')

    def test_gap_and_short_day_and_mismatch(self):
        bars = day({0: (120, 121, 119, 120)})
        self.assertEqual(S.simulate(bars, [], self.ctx(bars))['skip'], 'gap')
        self.assertEqual(S.simulate(bars[:100], [], self.ctx(bars[:100]))['skip'], 'short_day')
        bars = day({0: (98, 99, 97, 98), 60: (99, 102, 99, 101)})
        c = dict(CTX, day_high=200.0)
        self.assertEqual(S.simulate(bars, [], c)['skip'], 'mismatch')

    def test_entry_a_limit_fill_and_tp(self):
        # 분 60 에서 전일 고가(100)를 처음 넘는다. 다음 봉(61)에서 +3% 닿음 → 익절.
        bars = day({0: (98, 99, 97, 98), 60: (99, 101, 99, 101), 61: (101, 104, 101, 103)})
        r = S.simulate(bars, [], self.ctx(bars))['A']
        self.assertAlmostEqual(r['entry'], 100.0)
        self.assertAlmostEqual(r['X2_TP3_SL3'], 0.03 - S.COST)
        self.assertEqual(r['entry_t'], hhmm(60))

    def test_entry_a_gap_above_uses_open(self):
        bars = day({0: (105, 106, 104, 105)})
        r = S.simulate(bars, [], self.ctx(bars))['A']
        self.assertAlmostEqual(r['entry'], 105.0)

    def test_stop_before_target_in_same_bar(self):
        bars = day({60: (99, 101, 99, 101), 61: (101, 104, 96, 100)})
        r = S.simulate(bars, [], self.ctx(bars))['A']
        self.assertAlmostEqual(r['X2_TP3_SL3'], -0.03 - S.COST)

    def test_entry_b_waits_for_5min_close_above_and_enters_next_open(self):
        # 분 60(09:00+60=10:00)에 고가만 닿고 5분봉(10:00~10:04) 종가는 99 → 미확정.
        # 다음 5분봉(10:05~10:09)에서 종가 102 → 그 5분봉 마지막 분봉(69) 다음 분봉(70)의 시가에 진입.
        prices = {60: (99, 101, 98, 99), 61: (99, 99, 98, 99), 62: (99, 99, 98, 99), 63: (99, 99, 98, 99),
                  64: (99, 99, 98, 99), 65: (99, 101, 99, 101), 69: (101, 102, 101, 102), 70: (102, 103, 102, 103)}
        bars = day(prices)
        r = S.simulate(bars, [], self.ctx(bars))['B']
        self.assertAlmostEqual(r['entry'], 102.0)
        self.assertEqual(r['entry_t'], hhmm(70))
        self.assertTrue(r['early'])

    def test_burst_flag_uses_prior_five_minute_bars(self):
        bars = day({0: (98, 99, 97, 98), 60: (99, 101, 99, 101)}, vol=100.0)
        # 돌파 5분봉(10:00~10:04) 거래량을 크게
        bars = [(b[0], b[1], b[2], b[3], b[4], 5000.0 if hhmm(60) <= b[0] <= hhmm(64) else b[5]) for b in bars]
        r = S.simulate(bars, [], self.ctx(bars))['B']
        self.assertTrue(r['burst_defined'])
        self.assertTrue(r['burst'])

    def test_close_and_next_day_exits(self):
        bars = day({60: (99, 101, 99, 101), 389: (101, 101, 101, 101)})
        d1 = day({0: (103, 104, 103, 103), 389: (106, 106, 106, 106)})
        r = S.simulate(bars, d1, self.ctx(bars))['A']
        self.assertAlmostEqual(r['X1_close'], 101 / 100 - 1 - S.COST)
        self.assertAlmostEqual(r['X5_d1open'], 103 / 100 - 1 - S.COST)
        self.assertAlmostEqual(r['X6_d1close'], 106 / 100 - 1 - S.COST)

    def test_late_breakout_excluded(self):
        bars = day({380: (99, 101, 99, 101)})
        self.assertEqual(S.simulate(bars, [], self.ctx(bars))['skip'], 'late_or_unconfirmed')


class StatsTest(unittest.TestCase):
    def test_stat_and_top5(self):
        x = [0.1] * 5 + [-0.01] * 10
        s = S.stat(x)
        self.assertEqual(s['n'], 15)
        self.assertAlmostEqual(s['meanNoTop5'], -1.0)
        self.assertEqual(S.stat([])['n'], 0)

    def test_summarize_counts_entries_and_splits(self):
        ev = [{'A': {'X1_close': 0.01, 'X2_TP3_SL3': 0.0, 'X3_TP5_SL3': 0.0, 'X4_TP5_SL5': 0.0, 'MFE': 0.02,
                     'MAE': -0.01},
               'B': {'X1_close': -0.02, 'X2_TP3_SL3': -0.03, 'X3_TP5_SL3': 0.0, 'X4_TP5_SL5': 0.0, 'MFE': 0.01,
                     'MAE': -0.03, 'burst': True, 'burst_defined': True, 'early': True}}]
        out = S.summarize(ev)
        self.assertEqual(out['A']['events'], 1)
        self.assertEqual(out['B_splits']['burst']['events'], 1)
        self.assertEqual(out['B_splits']['late']['events'], 0)


if __name__ == '__main__':
    unittest.main()
