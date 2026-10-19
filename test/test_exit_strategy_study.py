# -*- coding: utf-8 -*-
"""매도 전략 A/B/C 연구 도구(scripts/research/exit_strategy_study.py)의 계약: 엔진 규칙 재현, 다음 분봉 시가 체결, 갭 하락, 미래 비참조."""

import importlib.util
import json
import os
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('xs', os.path.join(ROOT, 'scripts', 'research', 'exit_strategy_study.py'))
xs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(xs)

MINUTES = ['%02d%02d' % (h, m) for h in range(9, 16) for m in range(60) if '0900' <= '%02d%02d' % (h, m) <= '1530']


def make_path(days, base=100.0, overrides=None):
    """날짜별 09:00~15:30 평평한 1분봉. overrides = {(day, hhmm): close 또는 (o,h,l,c)}; 시가는 직전 종가."""
    overrides = overrides or {}
    path, last = [], base
    for day in days:
        for hhmm in MINUTES:
            v = overrides.get((day, hhmm))
            if v is None:
                o = h = l = c = last
            elif isinstance(v, tuple):
                o, h, l, c = v
            else:
                o, c = last, v
                h, l = max(o, c), min(o, c)
            path.append((day, hhmm, o, h, l, c, 1000.0))
            last = c
    return path


def entry_for(days, **kw):
    path = make_path(days, **kw)
    return {'code': '000001', 'entry_day': days[0], 'days': list(days), 'path': path, 'scan_date': '2026-10-01', 'prev_lows': {}}


def run(entry, name='A', ctx=None):
    factory = xs.make_rules()[name]
    return xs.simulate(entry, factory, ctx or {'atr_pct': 3.0})


D1, D2, D3 = '2026-10-13', '2026-10-14', '2026-10-15'


class RuleATests(unittest.TestCase):
    def test_emergency_exit_is_immediate_and_fills_at_next_open_with_slippage(self):
        e = entry_for([D1], overrides={(D1, '0910'): 94.0})
        t = run(e)
        self.assertEqual(t['reason'], 'STOP_EMERGENCY')
        self.assertEqual(t['exit_hhmm'], '0911')                       # 판정(09:10 종가) 다음 분봉에서 체결
        self.assertAlmostEqual(t['exit'], 94.0 * (1 - xs.SLIP_SELL_PCT / 100), places=6)
        self.assertAlmostEqual(t['net_pct'], t['gross_pct'] - xs.COST_PCT, places=9)

    def test_general_stop_needs_two_consecutive_checks(self):
        one = entry_for([D1], overrides={(D1, '0910'): 96.5, (D1, '0911'): 98.0})
        self.assertEqual(run(one)['reason'], 'HORIZON')                # 한 번 -3% 였다가 회복: 청산 없음
        two = entry_for([D1], overrides={(D1, '0910'): 96.5, (D1, '0911'): 96.5})
        t = run(two)
        self.assertEqual((t['reason'], t['exit_hhmm']), ('STOP_3', '0912'))

    def test_trailing_exit_after_arm_and_two_confirmations(self):
        e = entry_for([D1], overrides={(D1, '0920'): 104.0, (D1, '0921'): 101.0, (D1, '0922'): 101.0})
        t = run(e)
        self.assertEqual(t['reason'], 'TRAIL_2_5')
        self.assertEqual(t['exit_hhmm'], '0923')
        self.assertGreater(t['mfe_pct'], 3.8)

    def test_overnight_gap_down_exits_at_the_gap_open_not_at_the_stop_price(self):
        e = entry_for([D1, D2], overrides={(D2, '0900'): 90.0})
        t = run(e)
        self.assertEqual((t['reason'], t['exit_day']), ('STOP_EMERGENCY', D2))
        self.assertLess(t['exit'], 91.0)                                # -5% 선(95)에 체결되지 않는다
        self.assertLess(t['gross_pct'], -9.0)
        self.assertGreater(t['gap_shortfall'] if 'gap_shortfall' in t else 1, 0)

    def test_peak_and_hits_persist_across_days(self):
        e = entry_for([D1, D2], overrides={(D1, '1000'): 104.0, (D1, '1001'): 104.0, (D2, '0901'): 101.0, (D2, '0902'): 101.0})
        t = run(e)
        self.assertEqual((t['reason'], t['exit_day']), ('TRAIL_2_5', D2))

    def test_decisions_do_not_use_future_bars(self):
        e = entry_for([D1], overrides={(D1, '0910'): 96.5, (D1, '0911'): 96.5})
        full = run(e)
        cut = dict(e)
        cut['path'] = e['path'][:next(i for i, p in enumerate(e['path']) if p[1] == '0912') + 1]
        short = run(cut)
        self.assertEqual((full['reason'], full['exit_hhmm'], full['exit']), (short['reason'], short['exit_hhmm'], short['exit']))

    def test_no_decision_before_0901_or_after_1520(self):
        e = entry_for([D1], overrides={(D1, '1525'): 90.0})
        t = run(e)
        self.assertEqual(t['reason'], 'HORIZON')                        # 15:20 이후 분봉에서는 판정하지 않는다(엔진 거래 구간)


class RuleOldTests(unittest.TestCase):
    def test_old_rules_floor_and_cap(self):
        e = entry_for([D1], overrides={(D1, '0910'): 104.5, (D1, '0911'): 103.0})   # 순손익 +3.8% 도달 뒤 +2.3%로 -> 바닥 이탈
        t = xs.simulate(e, lambda p, c: xs.RuleAOld(p, c), {})
        self.assertEqual(t['reason'], 'TP_FLOOR')
        cap = entry_for([D1], overrides={(D1, '0910'): 107.5})
        self.assertEqual(xs.simulate(cap, lambda p, c: xs.RuleAOld(p, c), {})['reason'], 'TP_CAP')


class RuleBTests(unittest.TestCase):
    def test_vwap_break_exits_only_after_0915_and_after_k_closes(self):
        ov = {(D1, '0905'): 101.0}
        for hhmm in ('0910', '0911', '0912'):
            ov[(D1, hhmm)] = 99.0
        for hhmm in ('0930', '0931'):
            ov[(D1, hhmm)] = 99.0
        e = entry_for([D1], overrides=ov)
        t = run(e, 'B_vwap_b0.3_k2')
        self.assertEqual(t['reason'], 'STRUCT_BREAK')
        self.assertGreaterEqual(t['exit_hhmm'], '0916')                 # 09:15 이전 VWAP 이탈은 판정하지 않는다

    def test_low15_level_ratchets_with_previous_day_low(self):
        e = entry_for([D1, D2], overrides={(D1, '0905'): (100, 100, 98.0, 100)})
        e['prev_lows'] = {D2: 99.5}
        # 둘째 날 전일 저점(99.5) 아래로 두 번 연속 마감하면 구조 이탈
        ov = {(D1, '0905'): (100, 100, 98.0, 100), (D2, '0910'): 99.0, (D2, '0911'): 99.0}
        e2 = entry_for([D1, D2], overrides=ov)
        e2['prev_lows'] = {D2: 99.5}
        t = run(e2, 'B_low15_b0.3_k2')
        self.assertEqual((t['reason'], t['exit_day']), ('STRUCT_BREAK', D2))


class RuleCTests(unittest.TestCase):
    def test_atr_stop_width_scales_with_volatility_and_is_capped_below_emergency(self):
        low = xs.RuleC(100.0, {'atr_pct': 1.0}, 1.5, 2.5)
        high = xs.RuleC(100.0, {'atr_pct': 9.0}, 2.0, 2.5)
        self.assertAlmostEqual(low.stop, 1.5)
        self.assertLess(high.stop, xs.EMERGENCY_PCT)                    # 비상 손절 -5%가 항상 먼저다
        e = entry_for([D1], overrides={(D1, '0910'): 98.0, (D1, '0911'): 98.0})
        self.assertEqual(run(e, 'C_m1.5_k2.5', {'atr_pct': 1.0})['reason'], 'STOP_ATR')   # 좁은 ATR 은 -2% 에서 이미 청산
        self.assertEqual(run(e, 'A')['reason'], 'HORIZON')                                  # A 의 -3% 에는 닿지 않는다

    def test_atr_pct_uses_only_bars_up_to_scan_date(self):
        daily = [{'date': '2026-09-%02d' % (i + 1), 'open': 100, 'high': 102, 'low': 98, 'close': 100, 'volume': 1} for i in range(20)]
        daily.append({'date': '2026-10-01', 'open': 100, 'high': 150, 'low': 50, 'close': 100, 'volume': 1})
        self.assertAlmostEqual(xs.atr_pct(daily, '2026-09-20'), 4.0)    # 이후의 큰 진폭(10월)은 쓰지 않는다


class MetricTests(unittest.TestCase):
    def test_drawdown_and_streak(self):
        mdd, streak = xs.max_drawdown([2.0, -1.0, -3.0, 1.0, -0.5])
        self.assertAlmostEqual(mdd, 4.0)
        self.assertEqual(streak, 2)

    def test_summary_payoff_and_hold_counts(self):
        trades = [{'net_pct': 4.0, 'mfe_pct': 5.0, 'mae_pct': -1.0, 'gross_pct': 4.7, 'reason': 'TRAIL_2_5', 'after_high_pct': 4.0, 'recovered': False,
                   'hold_days': 0, 'exit_day': D1, 'exit_hhmm': '1000', 'trigger_price': 100, 'exit_raw': 100},
                  {'net_pct': -2.0, 'mfe_pct': 0.5, 'mae_pct': -3.0, 'gross_pct': -1.3, 'reason': 'STOP_3', 'after_high_pct': 0.0, 'recovered': True,
                   'hold_days': 1, 'exit_day': D2, 'exit_hhmm': '0930', 'trigger_price': 100, 'exit_raw': 99}]
        s = xs.summarize(trades)
        self.assertEqual(s['n'], 2)
        self.assertAlmostEqual(s['payoff'], 2.0)
        self.assertEqual(s['early_exit_missed'], 100.0)
        self.assertEqual(s['stop_recovered'], 100.0)
        self.assertEqual(s['hold'], {'same_day': 1, 'next_day': 1, 'later': 0, 'horizon': 0})


class EntryTests(unittest.TestCase):
    def test_gap_up_rule_per_day_limit_and_bars_requirement(self):
        with tempfile.TemporaryDirectory() as folder:
            entries = []
            for i in range(5):
                code = '00000%d' % i
                day = D1
                path = make_path([day], base=100.0 if i != 1 else 103.0)
                json.dump({'code': code, 'day': day, 'bars': [list(p[1:]) for p in path]}, open(os.path.join(folder, '%s_%s.json' % (code, day)), 'w'))
                entries.append({'code': code, 'entry_day': day, 'days': [day], 'rank': i + 1, 'base': 100.0, 'scan_date': '2026-10-12'})
            chosen = xs.select_entries(entries, folder)
            codes = [c['code'] for c in chosen]
            self.assertNotIn('000001', codes)                           # 기준가 +3%(≥+2%)는 건너뛴다(GAP_UP_OVER_2PCT)
            self.assertEqual(len(codes), 3)                             # 하루 최대 3종목
            self.assertEqual(codes, ['000000', '000002', '000003'])    # 순위 순


class StatsTests(unittest.TestCase):
    def test_paired_bootstrap_of_identical_trades_is_zero(self):
        trades = [{'entry_day': D1 if i % 2 else D2, 'net_pct': float(i)} for i in range(10)]
        r = xs.paired_bootstrap(trades, trades, rounds=200)
        self.assertEqual((r['mean_diff'], r['lo'], r['hi']), (0.0, 0.0, 0.0))

    def test_prior_return_uses_only_earlier_dates(self):
        mkt = {'2026-10-12': 0.01, '2026-10-13': 0.02, '2026-10-14': -0.5}
        self.assertAlmostEqual(xs.prior_return(mkt, '2026-10-14'), (1.01 * 1.02 - 1) * 100, places=6)   # 진입 당일(-50%)은 제외


class CalibrationTests(unittest.TestCase):
    def test_real_trades_pairs_each_buy_with_its_next_sell_and_prefers_actual_fill_price(self):
        import sqlite3
        spec2 = importlib.util.spec_from_file_location('xc2', os.path.join(ROOT, 'scripts', 'research', 'exit_strategy_calibrate.py'))
        cal = importlib.util.module_from_spec(spec2)
        spec2.loader.exec_module(cal)
        with tempfile.TemporaryDirectory() as folder:
            db = sqlite3.connect(os.path.join(folder, 'live_orders.db'))
            db.execute('CREATE TABLE intents(id INTEGER PRIMARY KEY,ts TEXT,code TEXT,side TEXT,qty INTEGER,price INTEGER)')
            db.executemany('INSERT INTO intents VALUES(?,?,?,?,?,?)', [
                (1, '2026-10-14T09:00:27+09:00', '086520', 'BUY', 3, 85300), (2, '2026-10-14T09:15:51+09:00', '086520', 'SELL', 3, None),
                (3, '2026-10-15T09:00:00+09:00', '086520', 'BUY', 3, 80000)])
            db.commit()
            db.close()
            json.dump({'fills': [{'date': '2026-10-14', 'code': '086520', 'side': 'BUY', 'qty': 3, 'price': 85000},
                                 {'date': '2026-10-14', 'code': '086520', 'side': 'SELL', 'qty': 3, 'price': 88500}]},
                      open(os.path.join(folder, 'order_fills.json'), 'w'))
            trades = cal.real_trades(folder)
        self.assertEqual([t['buy_price'] for t in trades], [85000, 80000])        # 체결 기록이 있으면 체결가, 없으면 주문가
        self.assertEqual(trades[0]['sell_fill'], 88500)
        self.assertIsNone(trades[1]['sell_ts'])
        self.assertNotIn('account', json.dumps(trades).lower())                    # 계좌 정보는 읽지 않는다


if __name__ == '__main__':
    unittest.main()
