# -*- coding: utf-8 -*-
"""장중 실시간 페이퍼 트레이딩 엔진 테스트. 모든 시세는 **합성 데이터**이며 실제 관측값이 아니다."""
import os
import re
import sys
import unittest
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import candidate_gen as cg  # noqa: E402
import krx_calendar as kc  # noqa: E402
import live_paper as lp  # noqa: E402

KST = timezone(timedelta(hours=9))
SCAN = '2026-10-08'          # 목요일 마감 스캔 → 10/9 한글날 휴장 → 10/12(월) 첫 거래일
D0 = datetime(2026, 10, 12, 9, 0, 20, tzinfo=KST)


def t(h, m, s=0, day=12):
    return datetime(2026, 10, day, h, m, s, tzinfo=KST)


def make_daily(end=SCAN, n=30, base=10000.0, extra=()):
    """end 날짜까지 거래일 n개(완만히 상승, ATR 약 1.5%) + extra [(date, o, h, l, c)]."""
    days, d = [], datetime.strptime(end, '%Y-%m-%d')
    while len(days) < n:
        if kc.is_trading_day(d):
            days.append(d.strftime('%Y-%m-%d'))
        d -= timedelta(days=1)
    days.reverse()
    out = []
    for k, ds in enumerate(days):
        c = base * (1 + 0.001 * k)
        out.append({'date': ds, 'open': c * 0.999, 'high': c * 1.008, 'low': c * 0.992, 'close': c})
    for ds, o, h, l, c in extra:
        out.append({'date': ds, 'open': o, 'high': h, 'low': l, 'close': c})
    return out


class FakeQuotes:
    def __init__(self):
        self.px, self.ts, self.fail, self.calls = {}, {}, False, []

    def set(self, code, px, ts):
        self.px[code], self.ts[code] = px, ts

    def quote(self, code):
        self.calls.append(code)
        if self.fail or code not in self.px:
            raise RuntimeError('no quote')
        return {'price': self.px[code], 'ts': self.ts[code], 'source': 'fake'}


class Base(unittest.TestCase):
    def setUp(self):
        self.conn = cg.connect(':memory:')
        self.q = FakeQuotes()
        self.daily = {}
        self.cfg = lp.Config()
        self.eng = lp.Engine(self.conn, self.q, lambda c: self.daily.get(c, []), self.cfg, environ={})

    def cand(self, code, scanner='pullback', score=90.0, base=10000.0, scan=SCAN):
        self.conn.execute('INSERT OR IGNORE INTO candidates(scan_date, scanner, code, name, score, base_price, scanned_at, created_at) VALUES (?,?,?,?,?,?,?,?)',
                          (scan, scanner, code, 'N' + code, score, base, 'x', 'x'))
        self.conn.commit()
        self.daily.setdefault(code, make_daily())

    def start(self, now=D0):
        self.assertIsNone(self.eng.start(now))
        return self.eng.load_candidates(now)

    def count(self, sql, *a):
        return self.conn.execute(sql, a).fetchone()[0]

    def buy_all(self, codes=('000100',), px=10000.0):
        for c in codes:
            self.cand(c)
            self.q.set(c, px, D0)
        cands = self.start()
        self.eng.tick(D0, cands)
        return cands


class CalendarTests(Base):
    def test_holiday_chain(self):
        self.assertFalse(kc.is_trading_day('2026-10-09'))
        self.assertEqual(kc.next_trading_day('2026-10-08').strftime('%Y-%m-%d'), '2026-10-12')
        self.assertEqual(kc.prev_trading_day('2026-10-12').strftime('%Y-%m-%d'), SCAN)
        self.assertEqual(kc.trading_days_between('2026-10-08', '2026-10-12'), 1)

    def test_oct8_scan_valid_until_oct12_open(self):
        scan_at = datetime(2026, 10, 8, 23, 58, tzinfo=KST)
        items = [{'code': '00%04d' % i, 'name': 'N', 'price': 10000, 'score': 90, 'date': SCAN} for i in range(2)]
        p = {'scannedAt': scan_at.astimezone(timezone.utc).isoformat(), 'universe': 2700, 'scanned': 2650, 'patterns': {'pullback': items}}
        ok, why, _ = cg.check_scan(self.conn, p, t(8, 30), now_epoch=1.0)
        self.assertTrue(why.startswith('WAIT_STABLE'), why)
        ok, why, _ = cg.check_scan(self.conn, p, t(8, 40), now_epoch=1.0 + cg.STABLE_SEC + 1)
        self.assertTrue(ok, why)
        ok, why, _ = cg.check_scan(self.conn, p, t(9, 5), now_epoch=9e3)
        self.assertTrue(why.startswith('STALE_SCAN') or why == 'ALREADY_DONE')

    def test_unknown_year_blocks(self):
        with self.assertRaises(kc.CalendarUnknown):
            kc.is_trading_day('2031-03-04')
        scan_at = datetime(2031, 3, 3, 23, 58, tzinfo=KST)
        p = {'scannedAt': scan_at.astimezone(timezone.utc).isoformat(), 'universe': 2700, 'scanned': 2650,
             'patterns': {'pullback': [{'code': '000100', 'name': 'N', 'price': 1, 'score': 1, 'date': '2031-03-03'}]}}
        ok, why, _ = cg.check_scan(self.conn, p, datetime(2031, 3, 4, 8, 30, tzinfo=KST), now_epoch=9e3)
        self.assertFalse(ok)
        self.assertTrue(why.startswith('CALENDAR_UNKNOWN'))

    def test_candidates_expire_by_trading_days_not_calendar(self):
        self.cand('000100')
        self.assertEqual(cg.expire_old(self.conn, '2026-10-12'), 0)     # 달력일로는 4일이지만 거래일로는 1일
        self.assertEqual(cg.expire_old(self.conn, '2026-10-16'), 1)     # 거래일 4일 경과


class EntryTests(Base):
    def test_buy_at_first_observed_quote_and_no_duplicate(self):
        self.buy_all()
        rows = self.conn.execute('SELECT strategy_id, qty, entry_price, quote_ts, quality, simulation_type FROM lp_positions ORDER BY strategy_id').fetchall()
        self.assertEqual([r[0] for r in rows], ['atr_close', 'dead35', 'trail_atr'])
        self.assertTrue(all(r[5] == 'LIVE_PAPER' and r[4] == 'LAST_ONLY' for r in rows))
        self.assertAlmostEqual(rows[0][2], 10000 * 1.002)
        self.assertEqual(rows[0][1], int(1_000_000 / (10000 * 1.002)))                   # 총자산의 10%
        cash = self.eng.account('trail_atr')['cash']
        self.assertAlmostEqual(cash, 10_000_000 - rows[0][1] * rows[0][2])
        cands = self.eng.load_candidates(D0)
        self.eng.tick(D0 + timedelta(seconds=30), cands)                                   # 같은 주기 반복
        self.assertEqual(self.count('SELECT COUNT(*) FROM lp_positions'), 3)
        # 재시작: 새 엔진이 같은 DB 를 이어받아도 중복 매수·계좌 변경 없음
        eng2 = lp.Engine(self.conn, self.q, lambda c: self.daily.get(c, []), self.cfg, environ={})
        eng2.start(D0 + timedelta(minutes=5))
        eng2.tick(D0 + timedelta(minutes=5), eng2.load_candidates(D0 + timedelta(minutes=5)))
        self.assertEqual(self.count('SELECT COUNT(*) FROM lp_positions'), 3)
        self.assertAlmostEqual(eng2.account('trail_atr')['cash'], cash)
        self.assertEqual(self.count("SELECT COUNT(*) FROM lp_events WHERE kind='BUY'"), 3)

    def test_no_quote_is_unfilled_not_fabricated(self):
        self.cand('000100')
        cands = self.start()
        self.eng.tick(D0, cands)                                                          # 시세 없음
        self.assertEqual(self.count('SELECT COUNT(*) FROM lp_positions'), 0)
        self.eng.tick(t(9, 31), cands)
        self.assertEqual(self.count('SELECT COUNT(*) FROM lp_positions'), 0)
        self.assertEqual(self.count("SELECT COUNT(*) FROM lp_decisions WHERE decision='UNFILLED'"), 3)
        self.assertAlmostEqual(self.eng.account('dead35')['cash'], 10_000_000)

    def test_stale_or_premarket_quote_rejected(self):
        self.cand('000100')
        cands = self.start()
        self.q.set('000100', 10000, t(8, 59))                                              # 장 시작 전 시각
        self.eng.tick(D0, cands)
        self.assertEqual(self.count('SELECT COUNT(*) FROM lp_positions'), 0)
        self.q.set('000100', 10000, t(9, 0, 1))
        self.eng.tick(t(9, 10), cands)                                                      # 관측한 지 9분 지남 -> 신선하지 않음
        self.assertEqual(self.count('SELECT COUNT(*) FROM lp_positions'), 0)

    def test_gap_up_skipped(self):
        self.cand('000100')
        self.q.set('000100', 10300, D0)
        self.eng.tick(D0, self.start())
        self.assertEqual(self.count("SELECT COUNT(*) FROM lp_decisions WHERE decision='SKIPPED'"), 3)
        self.assertEqual(self.count('SELECT COUNT(*) FROM lp_positions'), 0)

    def test_limits_three_positions_total_30pct(self):
        codes = ['00010%d' % i for i in range(6)]
        self.buy_all(codes)
        for sid in lp.STRATEGIES:
            self.assertEqual(self.count("SELECT COUNT(*) FROM lp_positions WHERE strategy_id=?", sid), 3)
            eq, inv, n = self.eng.equity(sid)
            self.assertLessEqual(inv / eq, 0.30 + 1e-9)
        self.assertGreaterEqual(self.count("SELECT COUNT(*) FROM lp_decisions WHERE decision='REJECTED'"), 9)

    def test_same_code_two_scanners_single_position(self):
        self.cand('000100', 'pullback')
        self.cand('000100', 'doubleBottom', score=75)
        self.q.set('000100', 10000, D0)
        self.eng.tick(D0, self.start())
        self.assertEqual(self.count('SELECT COUNT(*) FROM lp_positions WHERE strategy_id=?', 'trail_atr'), 1)
        self.assertEqual(self.count("SELECT COUNT(*) FROM lp_selection WHERE reason LIKE 'DUPLICATE%'"), 1)

    def test_ranking_never_sorts_raw_scores_across_scanners(self):
        rows = [{'scanner': 'pullback', 'code': 'A', 'score': 99.0}, {'scanner': 'pullback', 'code': 'B', 'score': 98.0},
                {'scanner': 'doubleBottom', 'code': 'C', 'score': 71.0}, {'scanner': 'doubleBottom', 'code': 'D', 'score': 70.0}]
        out = lp.order_candidates(rows)
        self.assertEqual([r['code'] for r in out], ['A', 'C', 'B', 'D'])                   # 점수 99>98>71>70 이어도 검색기 순위로 번갈아
        self.assertEqual(out[1]['rank_norm'], 1.0)

    def test_watch_cap_logged(self):
        eng_cfg = lp.Config(max_watch=2)
        eng = lp.Engine(self.conn, self.q, lambda c: self.daily.get(c, []), eng_cfg, environ={})
        for i in range(4):
            self.cand('00020%d' % i, score=90 - i)
        eng.start(D0)
        self.assertEqual(len(eng.load_candidates(D0)), 2)
        self.assertEqual(self.count("SELECT COUNT(*) FROM lp_selection WHERE reason LIKE 'WATCH_CAP%'"), 2)

    def test_atomic_rollback_on_unique_conflict(self):
        self.cand('000100')
        cands = self.start()
        self.conn.execute("INSERT INTO lp_positions(strategy_id, scan_date, scanner, code, qty, entry_ts, entry_date, entry_price, status) VALUES ('trail_atr',?,?,?,1,'x','x',1,'CLOSED')",
                          (SCAN, 'pullback', '000100'))
        self.conn.commit()
        self.q.set('000100', 10000, D0)
        self.eng.tick(D0, cands)
        self.assertAlmostEqual(self.eng.account('trail_atr')['cash'], 10_000_000)          # 충돌한 전략의 계좌는 그대로
        self.assertEqual(self.count("SELECT COUNT(*) FROM lp_events WHERE kind='BUY' AND strategy_id='trail_atr'"), 0)


class SafetyTests(Base):
    def test_live_sell_halts_engine(self):
        eng = lp.Engine(self.conn, self.q, lambda c: [], self.cfg, environ={'LIVE_SELL': 'true'})
        self.assertEqual(eng.start(D0), 'LIVE_SELL_ACTIVE')
        self.cand('000100')
        self.q.set('000100', 10000, D0)
        eng.tick(D0, [{'scan_date': SCAN, 'scanner': 'pullback', 'code': '000100', 'base_price': 10000}])
        self.assertEqual(self.count('SELECT COUNT(*) FROM lp_positions'), 0)
        self.assertEqual(self.count("SELECT COUNT(*) FROM lp_events WHERE kind='LIVE_SELL_ACTIVE'"), 1)

    def test_holiday_halts(self):
        self.assertEqual(self.eng.start(datetime(2026, 10, 9, 9, 5, tzinfo=KST)), 'NOT_TRADING_DAY')

    def test_unknown_calendar_halts_with_event(self):
        self.assertEqual(self.eng.start(datetime(2031, 3, 4, 9, 5, tzinfo=KST)), 'CALENDAR_UNKNOWN')
        self.assertEqual(self.count("SELECT COUNT(*) FROM lp_events WHERE kind='CALENDAR_ERROR'"), 1)

    def test_no_order_api_in_engine_sources(self):
        for name in ('live_paper.py', 'live_paper_job.py'):
            path = os.path.join(HERE, name)
            if not os.path.exists(path):
                continue
            src = open(path, encoding='utf-8').read()
            code = re.sub(r'""".*?"""', '', src, flags=re.S)
            for bad in ('sell_market', 'dostk/ordr', 'kt10001', 'kt10000', 'buy_stock', 'sell_stock', 'urlopen'):
                self.assertNotIn(bad, code, '%s 에 %s 가 있으면 안 된다' % (name, bad))

    def test_feed_outage_blocks_entries_and_does_not_backfill(self):
        self.cand('000100')
        self.cand('000200')
        cands = self.start()
        self.q.fail = True
        self.eng.tick(t(9, 0, 30), cands)
        self.eng.tick(t(9, 4), cands)                                                       # 3분 이상 수신 없음 -> 단절
        self.assertEqual(self.count("SELECT COUNT(*) FROM lp_events WHERE kind='FEED_DOWN'"), 1)
        self.q.fail = False
        self.q.set('000100', 10000, t(9, 6))
        self.eng.tick(t(9, 6, 10), cands)                                                   # 복구
        self.assertEqual(self.count("SELECT COUNT(*) FROM lp_events WHERE kind='FEED_RECOVERED'"), 1)
        self.assertEqual(self.count('SELECT COUNT(*) FROM lp_positions'), 3)                 # 000100 만(관측한 종목). 000200 은 시세가 없어 미체결
        self.assertEqual(self.count("SELECT COUNT(*) FROM lp_positions WHERE code='000200'"), 0)
        self.assertEqual(self.count("SELECT COUNT(*) FROM lp_positions WHERE entry_ts < ?", '2026-10-12T09:06:00+09:00'), 0)   # 단절 구간에 소급 체결 없음


class ExitTests(Base):
    def entered(self, sid_px=10000.0):
        self.buy_all(('000100',), sid_px)
        return {r[0]: r for r in self.conn.execute('SELECT strategy_id, id, trail_price, entry_price, qty FROM lp_positions')}

    def test_trail_atr_intraday_stop_and_cash_reuse(self):
        pos = self.entered()
        trail = pos['trail_atr'][2]
        self.q.set('000100', trail + 1, t(10, 0))
        self.eng.tick(t(10, 0, 10), [])
        self.assertEqual(self.count("SELECT COUNT(*) FROM lp_positions WHERE strategy_id='trail_atr' AND status='OPEN'"), 1)   # 추적선 위에서는 유지
        self.q.set('000100', trail - 1, t(10, 30))
        self.eng.tick(t(10, 30, 5), [])
        r = self.conn.execute("SELECT status, exit_reason, exit_price, net_ret, pnl_krw, qty, entry_price FROM lp_positions WHERE strategy_id='trail_atr'").fetchone()
        self.assertEqual(r[:2], ('CLOSED', 'STOP_INTRADAY'))
        self.assertAlmostEqual(r[2], (trail - 1) * (1 - self.cfg.exit_slip))
        self.assertAlmostEqual(r[3], r[2] / r[6] - 1 - self.cfg.cost)
        acct = self.eng.account('trail_atr')
        self.assertAlmostEqual(acct['cash'], 10_000_000 + r[4])                              # 매도 대금이 현금으로 돌아옴(비용 반영)
        self.assertAlmostEqual(acct['realized'], r[4])
        self.assertEqual(self.count("SELECT COUNT(*) FROM lp_positions WHERE strategy_id='atr_close' AND status='OPEN'"), 1)    # 다른 전략 계좌는 영향 없음
        self.assertEqual(self.count("SELECT COUNT(*) FROM lp_events WHERE kind='SELL_STOP'"), 1)
        self.eng.tick(t(10, 31), [])
        self.assertEqual(self.count("SELECT COUNT(*) FROM lp_events WHERE kind='SELL_STOP'"), 1)  # 반복해도 중복 매도 없음
        self.assertGreater(self.eng.account('trail_atr')['cash'], 0)
        # 매도 대금 재사용: 같은 종목이 아닌 새 종목은 늘어난 현금으로 살 수 있다(자금 규칙은 다음 날 후보에서 확인)

    def test_gap_down_fills_at_observed_price_not_trail(self):
        pos = self.entered()
        self.q.set('000100', pos['trail_atr'][2] * 0.90, t(9, 40))
        self.eng.tick(t(9, 40, 5), [])
        price = self.conn.execute("SELECT exit_price FROM lp_positions WHERE strategy_id='trail_atr'").fetchone()[0]
        self.assertLess(price, pos['trail_atr'][2])                                           # 갭 하락은 추적선이 아니라 관측가(더 나쁜 가격)에 체결

    def test_atr_close_ignores_unconfirmed_intraday_price(self):
        pos = self.entered()
        self.q.set('000100', pos['atr_close'][2] - 100, t(11, 0))
        self.eng.tick(t(11, 0, 5), [])
        self.assertEqual(self.conn.execute("SELECT status FROM lp_positions WHERE strategy_id='atr_close'").fetchone()[0], 'OPEN')

    def test_atr_close_signal_then_next_day_open_fill(self):
        pos = self.entered()
        trail = pos['atr_close'][2]
        bar = ('2026-10-12', 10000, 10010, trail * 0.9, trail * 0.95)                          # 종가가 추적선 아래
        self.daily['000100'] = make_daily(extra=[bar])
        self.eng.end_of_day(t(15, 50))
        r = self.conn.execute("SELECT status, signal_date, exit_price FROM lp_positions WHERE strategy_id='atr_close'").fetchone()
        self.assertEqual((r[0], r[1], r[2]), ('PENDING_EXIT', '2026-10-12', None))             # 체결가·수익률 없이 대기
        self.assertAlmostEqual(self.eng.account('atr_close')['cash'], 10_000_000 - pos['atr_close'][4] * pos['atr_close'][3])    # 미체결 대금은 현금이 아님
        self.q.set('000100', 9400, t(15, 55))
        self.eng.monitor(t(15, 55), {})                                                       # 신호 당일에는 체결하지 않는다
        self.assertEqual(self.conn.execute("SELECT status FROM lp_positions WHERE strategy_id='atr_close'").fetchone()[0], 'PENDING_EXIT')
        n13 = datetime(2026, 10, 13, 9, 0, 40, tzinfo=KST)
        self.q.set('000100', 9500, n13)
        self.eng.start(n13)
        self.eng.tick(n13, [])
        r = self.conn.execute("SELECT status, exit_reason, exit_price, exit_ts FROM lp_positions WHERE strategy_id='atr_close'").fetchone()
        self.assertEqual((r[0], r[1]), ('CLOSED', 'SIGNAL_EXIT'))
        self.assertAlmostEqual(r[2], 9500 * (1 - self.cfg.exit_slip))
        self.assertTrue(r[3].startswith('2026-10-13'))

    def test_dead35_cross_signal(self):
        self.entered()
        extra = [('2026-10-12', 10030, 10040, 9990, 10020)]
        d = make_daily(extra=extra)
        d[-2]['close'] = 10800     # 어제 MA3 >= MA5 가 되도록 최근 종가를 높였다가
        d[-1]['close'] = 9700      # 오늘 급락해 MA3 < MA5
        self.daily['000100'] = d
        self.eng.end_of_day(t(15, 50))
        self.assertEqual(self.conn.execute("SELECT status, signal_reason FROM lp_positions WHERE strategy_id='dead35'").fetchone(), ('PENDING_EXIT', 'SIGNAL_DEAD35'))

    def test_missed_stop_during_outage_is_not_filled_at_observed_price(self):
        pos = self.entered()
        trail = pos['trail_atr'][2]
        self.daily['000100'] = make_daily(extra=[('2026-10-12', 10000, 10010, 9000, 9900)])      # 장중에 선을 깼지만 감시는 못 봤다
        self.eng.end_of_day(t(15, 50))
        r = self.conn.execute("SELECT status, signal_reason, exit_price FROM lp_positions WHERE strategy_id='trail_atr'").fetchone()
        self.assertEqual(r[0], 'OPEN')   # 진입 당일 봉은 진입 전 저가가 섞여 판정하지 않는다
        # 다음 날 봉에서 이탈 -> 사후 발견은 PENDING_EXIT(관측 체결 아님)
        self.daily['000100'] = make_daily(extra=[('2026-10-12', 10000, 10100, 9950, 10050), ('2026-10-13', 10000, 10010, 9000, 9900)])
        self.eng.end_of_day(t(15, 50, day=13))
        r = self.conn.execute("SELECT status, signal_reason, exit_price, net_ret FROM lp_positions WHERE strategy_id='trail_atr'").fetchone()
        self.assertEqual(r[:2], ('PENDING_EXIT', 'STOP_BREACH_UNOBSERVED'))
        self.assertIsNone(r[2])
        self.assertIsNone(r[3])

    def test_max_hold_closes_at_confirmed_close(self):
        self.entered()
        self.conn.execute("UPDATE lp_positions SET hold_days=29, last_bar_date='2026-10-08' WHERE strategy_id='trail_atr'")
        self.conn.commit()
        self.daily['000100'] = make_daily(extra=[('2026-10-12', 10000, 10100, 9950, 10050)])
        self.eng.end_of_day(t(15, 50))
        r = self.conn.execute("SELECT status, exit_reason, quality, exit_price FROM lp_positions WHERE strategy_id='trail_atr'").fetchone()
        self.assertEqual(r[:3], ('CLOSED', 'MAX_HOLD_30', 'CONFIRMED_CLOSE'))
        self.assertAlmostEqual(r[3], 10050 * (1 - self.cfg.exit_slip / 3))

    def test_control_strategy_same_bar_both_assumes_stop_first(self):
        eng = lp.Engine(self.conn, self.q, lambda c: self.daily.get(c, []), lp.Config(control_strategies=('fix3_5',)), environ={})
        self.cand('000100')
        self.q.set('000100', 10000, D0)
        eng.start(D0)
        eng.tick(D0, eng.load_candidates(D0))
        entry = self.conn.execute("SELECT entry_price FROM lp_positions WHERE strategy_id='fix3_5'").fetchone()[0]
        self.daily['000100'] = make_daily(extra=[('2026-10-12', entry, entry * 1.06, entry * 0.96, entry)])
        eng.end_of_day(t(15, 50))
        self.assertEqual(self.conn.execute("SELECT status, signal_reason FROM lp_positions WHERE strategy_id='fix3_5'").fetchone(),
                         ('PENDING_EXIT', 'FIX_STOP_BAR_BOTH_ASSUMED_STOP_FIRST'))


class AccountTests(Base):
    def test_equity_curve_summary_and_separation(self):
        self.buy_all(('000100',))
        self.q.set('000100', 10500, t(10, 0))
        self.eng.monitor(t(10, 0, 5), {})
        eq, inv, n = self.eng.equity('dead35')
        self.assertEqual(n, 1)
        self.assertGreater(eq, 10_000_000)
        self.daily['000100'] = make_daily(extra=[('2026-10-12', 10000, 10600, 9990, 10500)])
        self.eng.end_of_day(t(15, 50))
        s = self.eng.summary()
        self.assertEqual(set(s), set(lp.STRATEGIES))
        self.assertTrue(all(v['simulationType'] == 'LIVE_PAPER' for v in s.values()))
        self.assertGreater(s['dead35']['cumRet'], 0)
        self.assertEqual(self.count('SELECT COUNT(*) FROM lp_equity'), 3)
        # 기존 일봉 사후 모의매매 테이블과 섞이지 않는다
        self.assertEqual(self.count('SELECT COUNT(*) FROM paper_trades'), 0)

    def test_two_days_restart_preserves_everything(self):
        self.buy_all(('000100',))
        before = self.conn.execute('SELECT * FROM lp_positions ORDER BY id').fetchall(), self.conn.execute('SELECT * FROM lp_accounts ORDER BY strategy_id').fetchall()
        eng2 = lp.Engine(self.conn, self.q, lambda c: self.daily.get(c, []), self.cfg, environ={})
        n13 = datetime(2026, 10, 13, 8, 50, tzinfo=KST)
        eng2.start(n13)
        after = self.conn.execute('SELECT * FROM lp_positions ORDER BY id').fetchall(), self.conn.execute('SELECT strategy_id, initial_cash, cash, realized_pnl FROM lp_accounts ORDER BY strategy_id').fetchall()
        self.assertEqual(before[0], after[0])
        self.assertEqual([r[:4] for r in before[1]], [r[:4] for r in after[1]])


if __name__ == '__main__':
    unittest.main()
