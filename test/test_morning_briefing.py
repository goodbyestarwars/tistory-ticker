# -*- coding: utf-8 -*-
"""시장 브리핑(국내 거래일 07:00 확정 스냅샷) 계약 - 2026-10-23.

검증하는 것: 계산식 일치(옛 JS tomorrowSignal_ 에서 뽑은 기준 벡터), 한국/미국 거래일 매핑, 07:00 스케줄 실행,
미확정 재시도·복구(프로세스 재시작 포함), 확정본 불변, 정정 기록, 장 마감 후 중단, 조회 규칙(API).
"""
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone

CLOUD_VM_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
if CLOUD_VM_DIR not in sys.path:
    sys.path.insert(0, CLOUD_VM_DIR)

import db_schema  # noqa: E402
import market_clock  # noqa: E402
import morning_briefing as mb  # noqa: E402

KST = timezone(timedelta(hours=9))


def kst(y, m, d, hh=0, mm=0, ss=0):
    return datetime(y, m, d, hh, mm, ss, tzinfo=KST)


def bars(pairs):
    return [{'date': d, 'open': c, 'high': c, 'low': c, 'close': c} for d, c in pairs]


def make_conn(path=':memory:'):
    conn = sqlite3.connect(path)
    db_schema.create_schema(conn)
    return conn


def put(conn, symbol, pairs):
    db_schema.upsert_future_chart_rows(conn, symbol, bars(pairs))


def seed(conn, us_date='20261022', prev='20261021', moves=None, night=True, day_date='20261022', fx_date='20261022',
         fx_prev='20261021'):
    """미국 5지표 + 원/달러 + 코스피200 주간·야간 일봉. moves = {키: 등락률%}."""
    moves = moves or {'spx': -1.0, 'nas': -2.0, 'dji': 0.0, 'sox': -3.0, 'vix': 10.0, 'fx': 0.5}
    syms = {'spx': 'SP500_INDEX', 'nas': 'NASDAQ_INDEX', 'dji': 'DOW_INDEX', 'sox': 'SOX', 'vix': 'VIX'}
    for key, sym in syms.items():
        put(conn, sym, [(prev, 100.0), (us_date, 100.0 * (1 + moves[key] / 100))])
    put(conn, 'USDKRW', [(fx_prev, 100.0), (fx_date, 100.0 * (1 + moves['fx'] / 100))])
    put(conn, 'KOSPI200_DAY', [(day_date, 100.0)])
    if night:
        put(conn, 'KOSPI200_NIGHT', [(day_date, 100.0 * (1 + night / 100) if night is not True else 98.0)])


class SignalTests(unittest.TestCase):
    def test_score_matches_legacy_js_vectors(self):
        # 기준값은 옛 js/market-temp.js tomorrowSignal_ 로 만든 것(300개 무작위 입력으로 대조해 오차 1e-9 이내였다).
        z, b = mb.score_signal({'spx': -1.0, 'nas': -2.0, 'dji': 0.0, 'sox': -3.0, 'vix': 10.0, 'fx': 0.5, 'night': -2.0})
        self.assertAlmostEqual(z, -6.002693095, places=6)
        self.assertEqual(b['key'], 'strongDown')
        z, b = mb.score_signal({'spx': 0.3, 'nas': 0.4, 'dji': 0.2, 'sox': 0.5, 'vix': -2.0, 'fx': -0.1})
        self.assertEqual(b['key'], 'flat')
        self.assertEqual(len(mb.BUCKETS6), 5)
        self.assertEqual(mb.BUCKETS7[0]['n'], 34)

    def test_bucket_edges_use_model_specific_thresholds(self):
        # 같은 합이라도 7항은 경계가 더 넓다(옛 코드 동일): -3.2는 7항이면 '하락 우세', 6항이면 '강한 하락 신호'.
        self.assertEqual(next(b for b in mb.BUCKETS7 if -3.2 < b['max'])['key'], 'down')
        self.assertEqual(next(b for b in mb.BUCKETS6 if -3.2 < b['max'])['key'], 'strongDown')


class NightSignalTests(unittest.TestCase):
    """옛 test_market_temp_night_signal.js 이식: 날짜 기준(D 저녁 시작 세션)과 미완성 세션 처리."""
    day = bars([('20261021', 893.05), ('20261022', 857.0), ('20261023', 860.0)])
    night = bars([('20261021', 888.3), ('20261022', 834.6)])

    def test_signal_is_night_close_over_prior_day_close(self):
        s = mb.night_signal(self.day, self.night, '20261023', kst(2026, 10, 23, 12, 0))     # 당일 주간 봉(1023)은 제외, D=1022
        self.assertEqual(s['date'], '20261022')
        self.assertAlmostEqual(s['gap'], (834.6 / 857.0 - 1) * 100, places=9)
        self.assertFalse(s['pending'])

    def test_session_pending_until_0505_next_morning(self):
        self.assertTrue(mb.night_signal(self.day, self.night, '20261023', kst(2026, 10, 23, 4, 0))['pending'])
        self.assertFalse(mb.night_signal(self.day, self.night, '20261023', kst(2026, 10, 23, 5, 6))['pending'])

    def test_missing_matching_bar_gives_none(self):
        self.assertIsNone(mb.night_signal(self.day, bars([('20261021', 888.3)]), '20261023', kst(2026, 10, 23, 12, 0)))
        self.assertIsNone(mb.night_signal([], self.night, '20261023', kst(2026, 10, 23, 12, 0)))


class CalendarTests(unittest.TestCase):
    def test_us_session_for_kr_day(self):
        self.assertEqual(market_clock.us_session_before_kr_day(date(2026, 10, 26))[0], date(2026, 10, 23))   # 월 -> 직전 금
        self.assertEqual(market_clock.us_session_before_kr_day(date(2026, 10, 23))[0], date(2026, 10, 22))
        day, skipped = market_clock.us_session_before_kr_day(date(2026, 9, 8))                                  # 노동절 다음 한국 거래일
        self.assertEqual(day, date(2026, 9, 4))
        self.assertEqual([d for d, _ in skipped], [date(2026, 9, 7)])
        day, skipped = market_clock.us_session_before_kr_day(date(2026, 7, 6))                                  # 7/3 독립기념일 대체 휴장
        self.assertEqual(day, date(2026, 7, 2))
        self.assertEqual([d for d, _ in skipped], [date(2026, 7, 3)])

    def test_kr_holidays_are_not_briefing_days(self):
        self.assertFalse(market_clock.is_kr_trading_day(kst(2026, 10, 9)))     # 한글날 대체
        self.assertFalse(market_clock.is_kr_trading_day(kst(2026, 10, 24)))    # 토
        self.assertTrue(market_clock.is_kr_trading_day(kst(2026, 10, 26)))
        self.assertEqual(market_clock.next_kr_trading_day(date(2026, 10, 2)), date(2026, 10, 6))   # 10/3 토·10/5 대체휴일

    def test_special_session_hours(self):
        self.assertEqual(market_clock.kr_session_minutes('2026-11-19'), (600, 990))
        self.assertEqual(market_clock.kr_market_phase(kst(2026, 11, 19, 9, 30))['phase'], 'pre')
        self.assertEqual(market_clock.kr_market_phase(kst(2026, 11, 19, 16, 0))['phase'], 'open')
        self.assertEqual(market_clock.kr_market_phase(kst(2026, 10, 26, 8, 59))['phase'], 'pre')
        self.assertEqual(market_clock.kr_market_phase(kst(2026, 10, 26, 15, 29))['phase'], 'open')
        self.assertEqual(market_clock.kr_market_phase(kst(2026, 10, 26, 15, 30))['phase'], 'post')
        self.assertEqual(market_clock.kr_market_phase(kst(2026, 10, 26, 16, 30))['phase'], 'closed')
        self.assertEqual(market_clock.kr_market_phase(kst(2026, 10, 24, 10, 0))['phase'], 'holiday')


class ComputeTests(unittest.TestCase):
    def test_complete_inputs_confirm_with_night(self):
        conn = make_conn()
        seed(conn)
        res = mb.compute(conn, date(2026, 10, 23), kst(2026, 10, 23, 7, 0))
        self.assertTrue(res['ok'])
        snap = res['snapshot']
        self.assertEqual(snap['usSessionDate'], '20261022')
        self.assertEqual(snap['signal']['model'], 7)
        self.assertTrue(snap['night']['included'])
        self.assertAlmostEqual(snap['night']['gapPct'], -2.0, places=6)
        self.assertEqual(snap['signal']['bucket']['key'], 'strongDown')
        self.assertEqual(snap['signal']['tone'], 'down')
        self.assertAlmostEqual(snap['inputs']['nas']['pct'], -2.0, places=6)

    def test_monday_uses_friday_us_session(self):
        conn = make_conn()
        seed(conn, us_date='20261023', prev='20261022', day_date='20261023', fx_date='20261023', fx_prev='20261022')
        res = mb.compute(conn, date(2026, 10, 26), kst(2026, 10, 26, 7, 0))
        self.assertTrue(res['ok'], res)
        self.assertEqual(res['snapshot']['usSessionDate'], '20261023')
        self.assertTrue(res['snapshot']['night']['included'])
        self.assertEqual(res['snapshot']['night']['sessionDate'], '20261023')   # 금요일 저녁에 시작한 야간 세션

    def test_missing_latest_us_bar_is_not_ready(self):
        conn = make_conn()
        seed(conn)                                    # 미국 최신 봉 10/22
        res = mb.compute(conn, date(2026, 10, 26), kst(2026, 10, 26, 7, 0))   # 월요일은 10/23 봉이 있어야 한다
        self.assertFalse(res['ok'])
        self.assertEqual(res['code'], 'inputs')
        self.assertIn('S&P 500', res['reason'])

    def test_us_holiday_uses_previous_session_without_waiting(self):
        conn = make_conn()
        seed(conn, us_date='20260904', prev='20260903', day_date='20260907', fx_date='20260907', fx_prev='20260904')
        res = mb.compute(conn, date(2026, 9, 8), kst(2026, 9, 8, 7, 0))
        self.assertTrue(res['ok'], res)
        self.assertEqual(res['snapshot']['usSessionDate'], '20260904')
        self.assertEqual(res['snapshot']['usHoliday'][0]['date'], '2026-09-07')

    def test_unlisted_us_holiday_assumed_only_after_0830(self):
        conn = make_conn()
        seed(conn, us_date='20261022', prev='20261021', fx_date='20261023', fx_prev='20261022')    # 10/23 미국 정규장이 열려야 하지만 봉이 없다(표에 없는 휴장 가정)
        early = mb.compute(conn, date(2026, 10, 26), kst(2026, 10, 26, 8, 0))
        self.assertFalse(early['ok'])
        late = mb.compute(conn, date(2026, 10, 26), kst(2026, 10, 26, 8, 40))
        self.assertTrue(late['ok'], late)
        self.assertEqual(late['snapshot']['usHolidayAssumed'], '20261022')

    def test_multi_day_outage_is_not_mistaken_for_holiday(self):
        conn = make_conn()
        seed(conn, us_date='20261021', prev='20261020', fx_date='20261023', fx_prev='20261022')   # 미국 지표가 이틀째 멈춤
        res = mb.compute(conn, date(2026, 10, 26), kst(2026, 10, 26, 8, 40))
        self.assertFalse(res['ok'])

    def test_fx_must_be_recent(self):
        conn = make_conn()
        seed(conn, fx_date='20261016', fx_prev='20261015')
        res = mb.compute(conn, date(2026, 10, 23), kst(2026, 10, 23, 7, 0))
        self.assertFalse(res['ok'])
        self.assertIn('원/달러', res['reason'])

    def test_night_wait_then_six_item_model(self):
        conn = make_conn()
        seed(conn, night=False)
        wait = mb.compute(conn, date(2026, 10, 23), kst(2026, 10, 23, 7, 5))
        self.assertEqual((wait['ok'], wait['code']), (False, 'night-wait'))
        res = mb.compute(conn, date(2026, 10, 23), kst(2026, 10, 23, 7, 16))
        self.assertTrue(res['ok'])
        self.assertFalse(res['snapshot']['night']['included'])
        self.assertEqual(res['snapshot']['signal']['model'], 6)

    def test_night_session_still_open_is_excluded(self):
        conn = make_conn()
        seed(conn)
        res = mb.compute(conn, date(2026, 10, 23), kst(2026, 10, 23, 4, 0))   # 아직 05:05 전 -> 미완성 세션
        self.assertTrue(res['ok'])
        self.assertFalse(res['snapshot']['night']['included'])
        self.assertEqual(res['snapshot']['night']['reason'], 'session-open')


class SchedulerTests(unittest.TestCase):
    def setUp(self):
        self.conn = make_conn()

    def test_not_run_on_kr_holiday_or_before_0700(self):
        seed(self.conn)
        self.assertEqual(mb.run_due(self.conn, kst(2026, 10, 24, 7, 30))[0], 'holiday')
        action, wait = mb.run_due(self.conn, kst(2026, 10, 23, 6, 59))
        self.assertEqual(action, 'waiting')
        self.assertIsNone(mb.get_row(self.conn, '2026-10-23'))

    def test_runs_at_0700_and_final_is_immutable(self):
        seed(self.conn)
        action, _ = mb.run_due(self.conn, kst(2026, 10, 23, 7, 0, 5))
        self.assertEqual(action, 'final')
        first = mb.get_row(self.conn, '2026-10-23')
        self.assertEqual(first['status'], 'final')
        self.assertEqual(first['first_confirmed_at'], '2026-10-23 07:00:05')
        # 장중에 데이터가 바뀌고(미국 선물 등) 다시 점검이 돌아도 본문·확정 시각은 그대로다.
        put(self.conn, 'SP500_INDEX', [('20261022', 50.0)])
        put(self.conn, 'KOSPI200_NIGHT', [('20261022', 120.0)])
        for t in (kst(2026, 10, 23, 7, 30), kst(2026, 10, 23, 11, 0), kst(2026, 10, 23, 15, 31)):
            self.assertEqual(mb.run_due(self.conn, t)[0], 'done')
        again = mb.get_row(self.conn, '2026-10-23')
        self.assertEqual(again['snapshot'], first['snapshot'])
        self.assertEqual(again['first_confirmed_at'], first['first_confirmed_at'])
        self.assertEqual(again['revision'], 0)
        self.assertIsNone(again['revised_at'])
        # 직접 attempt()를 불러도 final은 건드리지 않는다.
        self.assertEqual(mb.attempt(self.conn, date(2026, 10, 23), kst(2026, 10, 23, 12, 0))['snapshot'], first['snapshot'])

    def test_pending_retries_every_five_minutes_then_confirms_when_data_arrives(self):
        seed(self.conn, us_date='20261021', prev='20261020')    # 미국 10/22 봉이 아직 없다
        self.assertEqual(mb.run_due(self.conn, kst(2026, 10, 23, 7, 0, 1))[0], 'pending')
        row = mb.get_row(self.conn, '2026-10-23')
        self.assertEqual(row['status'], 'pending')
        self.assertEqual(row['next_retry_at'], '2026-10-23 07:05:01')
        self.assertIn('S&P 500', row['last_error'])
        self.assertEqual(mb.run_due(self.conn, kst(2026, 10, 23, 7, 3))[0], 'retry-wait')
        self.assertEqual(mb.get_row(self.conn, '2026-10-23')['attempts'], 1)
        seed(self.conn)                                           # 데이터 도착
        self.assertEqual(mb.run_due(self.conn, kst(2026, 10, 23, 7, 5, 30))[0], 'final')
        row = mb.get_row(self.conn, '2026-10-23')
        self.assertEqual((row['attempts'], row['first_confirmed_at']), (2, '2026-10-23 07:05:30'))
        self.assertIsNone(row['last_error'])

    def test_retry_slows_after_open_and_stops_at_close(self):
        seed(self.conn)
        self.conn.execute("DELETE FROM future_chart WHERE symbol='SP500_INDEX' AND date='20261022'")   # S&P 500만 빠짐(휴장 추정 불가)
        mb.run_due(self.conn, kst(2026, 10, 23, 7, 0))
        mb.run_due(self.conn, kst(2026, 10, 23, 9, 10))
        self.assertEqual(mb.get_row(self.conn, '2026-10-23')['next_retry_at'], '2026-10-23 09:40:00')   # 개장 후 30분 간격
        self.assertEqual(mb.run_due(self.conn, kst(2026, 10, 23, 15, 45))[0], 'failed')
        row = mb.get_row(self.conn, '2026-10-23')
        self.assertEqual(row['status'], 'failed')
        self.assertIn('S&P 500', row['last_error'])      # 마지막 실패 사유 보존
        calls = mb.get_row(self.conn, '2026-10-23')['attempts']
        self.assertEqual(mb.run_due(self.conn, kst(2026, 10, 23, 17, 0))[0], 'failed')
        self.assertEqual(mb.get_row(self.conn, '2026-10-23')['attempts'], calls)    # 장 마감 후 더는 시도하지 않는다

    def test_after_close_start_does_not_backfill(self):
        seed(self.conn)
        self.assertEqual(mb.run_due(self.conn, kst(2026, 10, 23, 18, 0))[0], 'failed')
        self.assertEqual(mb.get_row(self.conn, '2026-10-23')['status'], 'failed')
        self.assertIsNone(mb.get_row(self.conn, '2026-10-23')['snapshot'])

    def test_restart_recovers_from_database(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'b.db')
            c1 = make_conn(path)
            seed(c1, us_date='20261021', prev='20261020')
            mb.run_due(c1, kst(2026, 10, 23, 7, 0))
            c1.close()                                    # 프로세스가 죽었다고 가정
            c2 = sqlite3.connect(path)
            seed(c2)
            self.assertEqual(mb.run_due(c2, kst(2026, 10, 23, 7, 2))[0], 'retry-wait')   # 재시도 시각을 DB에서 이어받음
            self.assertEqual(mb.run_due(c2, kst(2026, 10, 23, 7, 6))[0], 'final')
            self.assertEqual(mb.get_row(c2, '2026-10-23')['attempts'], 2)
            c2.close()

    def test_run_log_records_each_attempt(self):
        seed(self.conn, us_date='20261021', prev='20261020')
        mb.run_due(self.conn, kst(2026, 10, 23, 7, 0))
        seed(self.conn)
        mb.run_due(self.conn, kst(2026, 10, 23, 7, 6))
        runs = self.conn.execute('SELECT outcome, trigger FROM morning_briefing_runs ORDER BY id').fetchall()
        self.assertEqual(runs, [('pending', 'scheduled'), ('final', 'scheduled')])

    def test_late_night_data_triggers_one_documented_revision(self):
        seed(self.conn, night=False)
        mb.run_due(self.conn, kst(2026, 10, 23, 7, 0))
        self.assertEqual(mb.get_row(self.conn, '2026-10-23')['status'], 'pending')    # 07:15까지 야간선물을 기다린다
        mb.run_due(self.conn, kst(2026, 10, 23, 7, 16))
        row = mb.get_row(self.conn, '2026-10-23')
        self.assertEqual((row['status'], row['snapshot']['night']['included']), ('final', False))
        confirmed = row['first_confirmed_at']
        put(self.conn, 'KOSPI200_NIGHT', [('20261022', 98.0)])                        # 야간 봉이 뒤늦게 생김
        self.assertEqual(mb.run_due(self.conn, kst(2026, 10, 23, 7, 30))[0], 'revised')
        row = mb.get_row(self.conn, '2026-10-23')
        self.assertTrue(row['snapshot']['night']['included'])
        self.assertEqual(row['first_confirmed_at'], confirmed)                         # 최초 확정 시각 유지
        self.assertEqual(row['revised_at'], '2026-10-23 07:30:00')
        self.assertEqual(row['revision'], 1)
        self.assertFalse(row['revisions'][0]['before']['nightIncluded'])
        self.assertIn('야간선물', row['revisions'][0]['reason'])
        # 정정은 한 번만: 이후에는 night 포함이라 더 이상 점검하지 않는다.
        self.assertEqual(mb.run_due(self.conn, kst(2026, 10, 23, 7, 40))[0], 'done')
        self.assertEqual(mb.get_row(self.conn, '2026-10-23')['revision'], 1)

    def test_no_late_revision_after_open(self):
        seed(self.conn, night=False)
        mb.run_due(self.conn, kst(2026, 10, 23, 7, 16))
        put(self.conn, 'KOSPI200_NIGHT', [('20261022', 98.0)])
        self.assertEqual(mb.run_due(self.conn, kst(2026, 10, 23, 9, 5))[0], 'done')
        self.assertFalse(mb.get_row(self.conn, '2026-10-23')['snapshot']['night']['included'])

    def test_manual_revise_keeps_first_confirmation(self):
        seed(self.conn)
        mb.run_due(self.conn, kst(2026, 10, 23, 7, 0))
        put(self.conn, 'VIX', [('20261022', 120.0)])
        row = mb.revise(self.conn, date(2026, 10, 23), kst(2026, 10, 23, 8, 10), '입력 지표 정정')
        self.assertEqual(row['first_confirmed_at'], '2026-10-23 07:00:00')
        self.assertEqual(row['revised_at'], '2026-10-23 08:10:00')
        self.assertEqual(row['revisions'][0]['reason'], '입력 지표 정정')
        self.assertAlmostEqual(row['snapshot']['inputs']['vix']['pct'], 20.0, places=6)


class ViewTests(unittest.TestCase):
    def setUp(self):
        self.conn = make_conn()

    def test_trading_day_after_0700_shows_today(self):
        seed(self.conn)
        mb.run_due(self.conn, kst(2026, 10, 23, 7, 0))
        view = mb.current_view(self.conn, kst(2026, 10, 23, 10, 24))
        self.assertEqual(view['briefing']['targetDate'], '2026-10-23')
        self.assertEqual(view['briefing']['status'], 'final')
        self.assertEqual(view['briefing']['targetLabel'], '10/23(금)')
        self.assertEqual(view['session']['phase'], 'open')
        self.assertEqual((view['session']['openAt'], view['session']['closeAt']), ('09:00', '15:30'))
        self.assertEqual(view['next']['targetDate'], '2026-10-26')

    def test_before_0700_and_weekend_show_last_final(self):
        seed(self.conn)
        mb.run_due(self.conn, kst(2026, 10, 23, 7, 0))
        pre = mb.current_view(self.conn, kst(2026, 10, 26, 6, 0))        # 월요일 06:00 -> 아직 월요일 브리핑 전
        self.assertEqual(pre['briefing']['targetDate'], '2026-10-23')
        self.assertEqual(pre['next']['targetDate'], '2026-10-26')
        self.assertEqual(pre['session']['phase'], 'pre')
        wk = mb.current_view(self.conn, kst(2026, 10, 24, 12, 0))
        self.assertEqual(wk['briefing']['targetDate'], '2026-10-23')
        self.assertEqual(wk['session']['phase'], 'holiday')
        self.assertEqual(wk['next']['targetDate'], '2026-10-26')

    def test_unconfirmed_today_reports_pending_then_failed_never_old_numbers(self):
        seed(self.conn)
        mb.run_due(self.conn, kst(2026, 10, 22, 7, 0))                    # 어제 확정(과거 행)
        v = mb.current_view(self.conn, kst(2026, 10, 23, 7, 0, 10))        # 오늘 행이 아직 없음
        self.assertEqual(v['briefing']['targetDate'], '2026-10-23')
        self.assertEqual(v['briefing']['status'], 'pending')
        self.assertIsNone(v['briefing']['snapshot'])
        late = mb.current_view(self.conn, kst(2026, 10, 23, 16, 0))
        self.assertEqual(late['briefing']['status'], 'failed')

    def test_no_history_gives_null_briefing(self):
        v = mb.current_view(self.conn, kst(2026, 10, 24, 12, 0))
        self.assertIsNone(v['briefing'])
        self.assertEqual(v['next']['scheduledAt'], '2026-10-26 07:00:00')

    def test_status_summary_for_health(self):
        seed(self.conn)
        mb.run_due(self.conn, kst(2026, 10, 23, 7, 0))
        s = mb.status_summary(self.conn, kst(2026, 10, 23, 9, 0))
        self.assertEqual((s['state'], s['todayStatus'], s['lastRun']['outcome']), ('정상', 'final', 'final'))
        self.assertEqual(mb.status_summary(self.conn, kst(2026, 10, 24, 9, 0))['state'], '휴장')


class EndpointTests(unittest.TestCase):
    def test_http_contract_and_cache_headers(self):
        import main
        from starlette.testclient import TestClient
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'e.db')
            conn = make_conn(path)
            seed(conn)
            mb.run_due(conn, kst(2026, 10, 23, 7, 0))
            conn.close()
            original_get_conn, original_now = db_schema.get_conn, market_clock.kst_now
            db_schema.get_conn = lambda db_file=None: sqlite3.connect(path)
            market_clock.kst_now = lambda: kst(2026, 10, 23, 11, 20)
            try:
                client = TestClient(main.app)
                res = client.get('/morning-briefing')
                self.assertEqual(res.status_code, 200)
                body = res.json()['data']
                self.assertEqual(body['briefing']['status'], 'final')
                self.assertEqual(body['briefing']['snapshot']['signal']['bucket']['key'], 'strongDown')
                self.assertIn('max-age=30', res.headers['cache-control'])
                self.assertEqual(client.get('/morning-briefing?date=2026-10-23').json()['data']['briefing']['targetDate'], '2026-10-23')
                self.assertEqual(client.get('/morning-briefing?date=bad').status_code, 422)
                os.environ['API_TOKEN'] = 'unit-test-token'
                self.assertIn(client.post('/morning-briefing/revise?date=2026-10-23').status_code, (401, 403))
            finally:
                db_schema.get_conn, market_clock.kst_now = original_get_conn, original_now
                os.environ.pop('API_TOKEN', None)


class ThemeFlowTests(unittest.TestCase):
    def test_duplicate_exchange_suffix_is_counted_once(self):
        import theme_flow
        groups = [{'thema_grp_cd': 'T1', 'thema_nm': '반도체', 'flu_rt': '1.0'}]
        stocks = {'T1': [
            {'stk_cd': '005930_AL', 'stk_nm': '삼성전자', 'cur_prc': '70000', 'acc_trde_qty': '100', 'flu_rt': '1'},
            {'stk_cd': '005930_NX', 'stk_nm': '삼성전자', 'cur_prc': '70000', 'acc_trde_qty': '100', 'flu_rt': '1'},
            {'stk_cd': '000660_AL', 'stk_nm': 'SK하이닉스', 'cur_prc': '100000', 'acc_trde_qty': '10', 'flu_rt': '2'},
        ]}
        rows = theme_flow.build_theme_rows(groups, stocks)
        self.assertEqual(rows[0]['stock_count'], 2)
        self.assertEqual(rows[0]['trade_amount'], 7000000 + 1000000)

    def test_rank_change_vs_previous_refresh(self):
        import theme_flow
        prev = {'updatedAt': '2026-10-23 10:00:00', 'rows': [{'theme_code': 'b'}, {'theme_code': 'a'}, {'theme_code': 'z'}]}
        rows = theme_flow.annotate_rank_change([{'theme_code': 'a'}, {'theme_code': 'b'}, {'theme_code': 'c'}], prev)
        self.assertEqual([r['rank_change'] for r in rows], [1, -1, None])
        self.assertEqual([r['prev_rank'] for r in rows], [2, 1, None])
        self.assertEqual(rows[0]['rank_basis'], '2026-10-23 10:00:00')
        none = theme_flow.annotate_rank_change([{'theme_code': 'a'}], None)
        self.assertEqual((none[0]['rank_change'], none[0]['rank_basis']), (None, None))


if __name__ == '__main__':
    unittest.main()
