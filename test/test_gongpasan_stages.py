# -*- coding: utf-8 -*-
"""급락 후 첫 눌림목(공파산) 4단계·이력 회귀 테스트 (2026-10-15)."""
import os
import sqlite3
import sys
import types
import unittest
from datetime import datetime
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))
sys.path.insert(0, os.path.dirname(__file__))

try:
    import fcntl  # noqa: F401
except ImportError:   # Windows 개발 PC - 잠금 모듈만 대체(VM은 리눅스)
    sys.modules['fcntl'] = types.ModuleType('fcntl')

try:
    import numpy as np
    import pandas as pd
    PANDAS = True
except ImportError:
    PANDAS = False

if PANDAS:
    import db_schema
    import gongpasan_scan as scan
    import gongpasan_stages as gs
    import gongpasan_strategy as gp
    from test_gongpasan_strategy import _decline_gongguri_breakout_pullback_rows


def fake_df(n, breakouts=(), low=None, close=None, ma=100.0, cond1=()):
    """stage_trace가 읽는 컬럼만 가진 최소 DataFrame."""
    low = list(low if low is not None else [120.0] * n)
    close = list(close if close is not None else [125.0] * n)
    return pd.DataFrame({
        'date': pd.date_range('2026-01-01', periods=n),
        'breakout_signal': [i in breakouts for i in range(n)],
        'low': low, 'close': close, 'sma20': [ma] * n,
        'retreat_pct': [-30.0 if i in cond1 else 0.0 for i in range(n)],
        'is_gongguri': [i in cond1 for i in range(n)],
        'has_daejip_bong': [i in cond1 for i in range(n)],
        'high': [c + 5.0 for c in close], 'open': close, 'volume': [1000.0] * n,
        'daejip_bar': [False] * n, 'daejip_vol_ratio': [0.0] * n, 'blue_line': [1.0] * n,
    })


@unittest.skipUnless(PANDAS, 'pandas 필요')
class StageTraceTests(unittest.TestCase):
    def real_df(self):
        rows, _, _ = _decline_gongguri_breakout_pullback_rows()
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            return gp.calculate_gongpasan_signal('005930', conn=object())

    def test_stage4_matches_existing_entry_signal(self):
        df = self.real_df()
        trace = gs.stage_trace(df)
        self.assertEqual(list(np.where(trace['stage'] == 4)[0]), list(np.where(df['entry_signal'])[0]))
        self.assertTrue(df['entry_signal'].any())

    def test_stage_sequence_observe_breakout_wait_support(self):
        df = self.real_df()
        trace = gs.stage_trace(df)
        stage = trace['stage']
        b = int(np.where(df['breakout_signal'])[0][0])
        e = int(np.where(df['entry_signal'])[0][0])
        self.assertEqual(stage[b], 2)
        self.assertEqual(stage[e], 4)
        self.assertEqual(gs.describe_stage(df, trace, e)['stage'], gs.SUPPORT_CONFIRMED)
        self.assertEqual(gs.describe_stage(df, trace, b)['stage'], gs.BREAKOUT)
        # 합성 데이터에서는 첫 돌파 직후 지지 확인 뒤 매집 관찰(1)로 돌아갔다가 다시 돌파(2)한다
        self.assertIn(1, list(stage))
        observed = gs.describe_stage(df, trace, int(np.where(stage == 1)[0][0]))
        self.assertEqual(observed['stage'], gs.WATCH_ACCUM)
        self.assertTrue(observed['unmet'])

    def test_waiting_stage_reports_days_and_ma_gap(self):
        df = fake_df(6, breakouts={1})
        t = gs.stage_trace(df)
        d = gs.describe_stage(df, t, 3)
        self.assertEqual(d['stage'], gs.WAIT_PULLBACK)
        self.assertEqual(d['daysSinceBreakout'], 2)
        self.assertEqual(d['breakoutDate'], '2026-01-02')
        self.assertAlmostEqual(d['ma20GapPct'], 25.0)
        self.assertTrue(any('20일선 첫 접근' in u for u in d['unmet']))

    def test_no_future_bars_are_used(self):
        df = self.real_df()
        full = gs.stage_trace(df)['stage']
        for i in range(150, len(df), 7):
            part = gs.stage_trace(df.iloc[:i + 1].reset_index(drop=True))['stage']
            self.assertEqual(part[i], full[i], 'i=%d' % i)

    def test_failed_first_approach_does_not_reenter_same_breakout(self):
        # 돌파(0) 후 3봉째 20일선 접근했지만 종가가 20일선-1% 아래 -> 실패, 이후 다시 접근해 지지해도 신호 아님
        low = [150, 140, 130, 100, 150, 150, 99, 150]
        close = [150, 140, 130, 90, 150, 150, 101, 150]
        t = gs.stage_trace(fake_df(8, breakouts={0}, low=low, close=close))
        self.assertEqual(t['episodes'][0]['outcome'], 'SUPPORT_FAILED')
        self.assertNotIn(4, list(t['stage']))
        self.assertEqual(list(t['stage'][:4]), [2, 3, 3, 0])

    def test_expires_after_20_bars(self):
        t = gs.stage_trace(fake_df(25, breakouts={0}))
        self.assertEqual(t['episodes'][0]['outcome'], 'EXPIRED')
        self.assertEqual(list(t['stage'][1:21]), [3] * 20)
        self.assertEqual(t['stage'][21], 0)

    def test_new_breakout_replaces_waiting_one(self):
        t = gs.stage_trace(fake_df(6, breakouts={0, 3}))
        self.assertEqual([e['outcome'] for e in t['episodes']], ['REPLACED', None])

    def test_stage_item_has_no_score_and_is_not_a_final_signal(self):
        df = self.real_df()
        b = int(np.where(df['breakout_signal'])[0][0])
        sub = df.iloc[:b + 1].reset_index(drop=True)
        d = gs.describe_stage(sub, gs.stage_trace(sub))
        item = gs.build_stage_item({'code': '005930', 'name': '테스트'}, sub, d)
        self.assertIsNone(item['score'])
        self.assertIn('아닙니다', item['interpretation'])
        self.assertEqual(item['patternDetail']['stage'], gs.BREAKOUT)


@unittest.skipUnless(PANDAS, 'pandas 필요')
class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        gs.ensure_schema(self.conn)

    def detail(self, stage=gs.WAIT_PULLBACK, since='2026-10-01'):
        return {'stage': stage, 'stageSince': since, 'breakoutDate': since, 'breakoutLevel': 100.0,
                'ma20': 95.0, 'ma20GapPct': 4.2, 'daysSinceBreakout': 3}

    def test_no_duplicate_rows_for_same_episode(self):
        self.assertTrue(gs.record_stage(self.conn, '2026-10-05', 'A', '000001', self.detail(), 'n'))
        self.assertFalse(gs.record_stage(self.conn, '2026-10-06', 'A', '000001', self.detail(), 'n'))
        rows = self.conn.execute('SELECT first_seen_date, last_seen_date, source FROM gongpasan_stage_log').fetchall()
        self.assertEqual(rows, [('2026-10-05', '2026-10-06', 'live')])
        self.assertTrue(gs.record_stage(self.conn, '2026-10-06', 'A', '000001', self.detail(gs.SUPPORT_CONFIRMED), 'n'))
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM gongpasan_stage_log').fetchone()[0], 2)

    def test_ended_rows_get_reason_from_episode_outcome(self):
        df = fake_df(8, breakouts={0}, low=[150, 140, 130, 100, 150, 150, 150, 150],
                     close=[150, 140, 130, 90, 150, 150, 150, 150])
        trace = gs.stage_trace(df)
        since = df.iloc[0]['date'].strftime('%Y-%m-%d')
        gs.record_stage(self.conn, '2026-01-03', 'A', '000001', self.detail(gs.WAIT_PULLBACK, since), 'n')
        n = gs.close_ended(self.conn, '2026-01-08', {}, {'000001': (df, trace)})
        self.assertEqual(n, 1)
        self.assertEqual(self.conn.execute('SELECT end_reason, ended_date FROM gongpasan_stage_log').fetchone(),
                         ('SUPPORT_FAILED', '2026-01-08'))

    def test_open_row_for_current_stage_is_kept_open(self):
        gs.record_stage(self.conn, '2026-10-05', 'A', '000001', self.detail(), 'n')
        n = gs.close_ended(self.conn, '2026-10-06', {'000001': (gs.WAIT_PULLBACK, '2026-10-01')}, {})
        self.assertEqual(n, 0)

    def test_observe_row_ends_promoted_or_lost(self):
        gs.record_stage(self.conn, '2026-10-05', 'A', '000001', self.detail(gs.WATCH_ACCUM, '2026-09-20'), 'n')
        gs.record_stage(self.conn, '2026-10-05', 'B', '000002', self.detail(gs.WATCH_ACCUM, '2026-09-20'), 'n')
        f = fake_df(3)
        frames = {'000001': (f, gs.stage_trace(f)), '000002': (f, gs.stage_trace(f))}
        gs.close_ended(self.conn, '2026-10-06', {'000001': (gs.BREAKOUT, '2026-10-06')}, frames)
        got = dict(self.conn.execute('SELECT code, end_reason FROM gongpasan_stage_log').fetchall())
        self.assertEqual(got, {'000001': 'PROMOTED', '000002': 'CONDITION_LOST'})

    def test_final_signal_goes_to_scan_hits_and_pattern_tracks_only(self):
        path = os.path.join(os.path.dirname(__file__), '_gp_hist_test.db')

        def cleanup():
            for suffix in ('', '-wal', '-shm'):
                if os.path.exists(path + suffix):
                    os.remove(path + suffix)
        cleanup()
        conn = db_schema.get_conn(path)
        try:
            db_schema.create_schema(conn)
            gs.ensure_schema(conn)
            match = {'code': '000001', 'name': 'A', 'price': 100.0, 'score': 88, 'patternDetail': {}}
            det = self.detail(gs.WAIT_PULLBACK, '2026-10-01')
            for _ in range(2):   # 같은 날 두 번 돌아도 중복 등록되지 않는다
                scan._record_history(conn, '2026-10-14', [match], [({'code': '000002', 'name': 'B'}, det)],
                                     {'000002': (gs.WAIT_PULLBACK, '2026-10-01')}, {})
            self.assertEqual(conn.execute('SELECT scan_date, scanner, code FROM scan_hits').fetchall(),
                             [('2026-10-14', 'pattern:gongpasan', '000001')])
            self.assertEqual(conn.execute('SELECT scanner, code, detected_date FROM pattern_tracks').fetchall(),
                             [('pattern:gongpasan', '000001', '2026-10-14')])
            self.assertEqual(conn.execute('SELECT code FROM gongpasan_stage_log').fetchall(), [('000002',)])
        finally:
            conn.close()
            cleanup()


@unittest.skipUnless(PANDAS, 'pandas 필요')
class PayloadTests(unittest.TestCase):
    def test_stale_data_is_not_shown_as_new_results(self):
        items = {gs.WATCH_ACCUM: [{'code': '1'}], gs.BREAKOUT: [], gs.WAIT_PULLBACK: []}
        stale = scan.build_stage_payload(items, {'WATCH_ACCUM': 1}, '2026-10-13', '2026-10-14', 100, 'x')
        self.assertEqual(stale['status'], 'stale')
        self.assertEqual(stale['stages'][gs.WATCH_ACCUM], [])
        ok = scan.build_stage_payload(items, {'WATCH_ACCUM': 1}, '2026-10-14', '2026-10-14', 100, 'x')
        self.assertEqual((ok['status'], len(ok['stages'][gs.WATCH_ACCUM])), ('ok', 1))
        self.assertEqual(scan.build_stage_payload({}, {}, None, '2026-10-14', 0, 'x')['status'], 'stale')

    def test_latest_bar_date_ignores_a_handful_of_early_updates(self):
        self.assertEqual(scan.latest_bar_date({'2026-10-14': 50, '2026-10-13': 1000}), '2026-10-13')
        self.assertEqual(scan.latest_bar_date({'2026-10-14': 600, '2026-10-13': 400}), '2026-10-14')

    def test_expected_bar_date(self):
        kst = scan.market_clock.KST
        self.assertEqual(scan.expected_bar_date(datetime(2026, 10, 14, 20, 40, tzinfo=kst)), '2026-10-14')
        self.assertEqual(scan.expected_bar_date(datetime(2026, 10, 14, 9, 0, tzinfo=kst)), '2026-10-13')


if __name__ == '__main__':
    unittest.main()
