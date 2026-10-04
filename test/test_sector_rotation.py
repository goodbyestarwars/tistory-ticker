# -*- coding: utf-8 -*-
import os
import sqlite3
import sys
import unittest
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))

import sector_rotation as sr  # noqa: E402

START = date(2026, 8, 3)


def trading_days(n):
    out, d = [], START
    while len(out) < n:
        if d.weekday() < 5:          # 주말은 휴장 - 연속 거래일 사이에 달력 공백이 생겨도 거래일 수로만 센다
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def make_db(sector_trends, n_days=40, bench_count=210, bench_drift=0.0005, volume=1_000_000, overrides=None):
    """sector_trends: {업종: [일 수익률(소수) per stock...]}. 각 종목은 일정한 일 수익률로 움직인다."""
    conn = sqlite3.connect(':memory:')
    conn.execute('CREATE TABLE daily_prices (code TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL, volume INTEGER, PRIMARY KEY(code, date))')
    days = trading_days(n_days)
    sector_map = {}
    overrides = overrides or {}

    def add(code, drift, vol=volume, start_i=0):
        price = 10000.0
        for i, d in enumerate(days):
            if i < start_i:
                continue
            price *= (1 + drift)
            v = overrides.get((code, i), vol)
            conn.execute('INSERT INTO daily_prices VALUES (?,?,?,?,?,?,?)', (code, d, price, price, price, price, v))

    for sector, drifts in sector_trends.items():
        sector_map[sector] = []
        for k, drift in enumerate(drifts):
            code = '%s%02d' % (abs(hash(sector)) % 9000 + 1000, k)
            code = ('S%d_%d' % (len(sector_map), k))
            add(code, drift)
            sector_map[sector].append({'code': code, 'name': code, 'market': 'KOSPI'})
    for i in range(bench_count):
        add('B%03d' % i, bench_drift)
    conn.commit()
    return conn, sector_map, days


class RankMathTest(unittest.TestCase):
    def test_rank_change_improving(self):
        self.assertEqual(sr.rank_change(15, 5), 10)

    def test_rank_change_worsening(self):
        self.assertEqual(sr.rank_change(3, 8), -5)

    def test_rank_change_missing(self):
        self.assertIsNone(sr.rank_change(None, 5))

    def test_percentile_top_and_bottom(self):
        self.assertEqual(sr.percentile_from_rank(1, 10), 100.0)
        self.assertEqual(sr.percentile_from_rank(10, 10), 0.0)

    def test_rank_ties_share_rank(self):
        self.assertEqual(sr.rank_desc({'a': 3, 'b': 3, 'c': 1}), {'a': 1, 'b': 1, 'c': 3})

    def test_median_ignores_none(self):
        self.assertEqual(sr.median([1, None, 3, 100]), 3)


class PhaseTest(unittest.TestCase):
    def row(self, **kw):
        base = dict(rs20_percentile=50, rs5_percentile=50, rank_change5d=0, breadth_up_ratio=0.6,
                    breadth_above_ma20=0.5, breadth_above_ma20_prev=0.4, trading_value_ratio=1.0)
        base.update(kw)
        return base

    def test_leading(self):
        self.assertEqual(sr.classify_phase(self.row(rs20_percentile=95, rs5_percentile=90)), 'LEADING')

    def test_emerging_requires_rank_jump_and_volume(self):
        r = self.row(rs20_percentile=50, rs5_percentile=85, rank_change5d=10, trading_value_ratio=1.4)
        self.assertEqual(sr.classify_phase(r), 'EMERGING')
        self.assertNotEqual(sr.classify_phase(dict(r, trading_value_ratio=0.9)), 'EMERGING')
        self.assertNotEqual(sr.classify_phase(dict(r, rank_change5d=1)), 'EMERGING')

    def test_weakening(self):
        r = self.row(rs20_percentile=85, rs5_percentile=30, rank_change5d=-5)
        self.assertEqual(sr.classify_phase(r), 'WEAKENING')

    def test_lagging(self):
        self.assertEqual(sr.classify_phase(self.row(rs20_percentile=10, rs5_percentile=10)), 'LAGGING')

    def test_neutral_when_no_rule_matches(self):
        self.assertEqual(sr.classify_phase(self.row()), 'NEUTRAL')

    def test_hysteresis_keeps_leading(self):
        r = self.row(rs20_percentile=67, rs5_percentile=62)
        self.assertNotEqual(sr.classify_phase(r), 'LEADING')
        self.assertEqual(sr.classify_phase(r, prev_phase='LEADING'), 'LEADING')

    def test_missing_percentile_is_neutral(self):
        self.assertEqual(sr.classify_phase(self.row(rs20_percentile=None)), 'NEUTRAL')


class SnapshotTest(unittest.TestCase):
    def test_strong_sector_leads_and_weak_lags(self):
        conn, smap, _ = make_db({'강한업종': [0.01] * 4, '약한업종': [-0.01] * 4, '보통업종': [0.0005] * 4,
                                 '중간A': [0.004] * 4, '중간B': [-0.004] * 4})
        snap = sr.compute_snapshot(conn, smap)
        rows = {r['sector']: r for r in snap['rows']}
        self.assertEqual(rows['강한업종']['rank5d'], 1)
        self.assertEqual(rows['약한업종']['rank5d'], 5)
        self.assertEqual(rows['강한업종']['phase'], 'LEADING')
        self.assertEqual(rows['약한업종']['phase'], 'LAGGING')
        self.assertGreater(rows['강한업종']['rotation_score'], rows['약한업종']['rotation_score'])

    def test_excluded_bucket_and_small_sector_are_skipped(self):
        conn, smap, _ = make_db({'코스피 3대장': [0.01] * 4, '작은업종': [0.01, 0.01], '정상': [0.01] * 4})
        names = {r['sector'] for r in sr.compute_snapshot(conn, smap)['rows']}
        self.assertEqual(names, {'정상'})

    def test_missing_benchmark_returns_none(self):
        conn, smap, _ = make_db({'정상': [0.01] * 4}, bench_count=5)
        self.assertIsNone(sr.compute_snapshot(conn, smap))

    def test_insufficient_history_returns_none(self):
        conn, smap, _ = make_db({'정상': [0.01] * 4}, n_days=15)
        self.assertIsNone(sr.compute_snapshot(conn, smap))

    def test_rank_change_after_reversal(self):
        # 업종 A는 최근 5일에 급등, B는 최근 5일에 급락 - 5일 전과 순위가 뒤집힌다
        conn, smap, days = make_db({'A': [0.0] * 4, 'B': [0.0] * 4, 'C': [0.002] * 4, 'D': [-0.002] * 4})
        for code in [s['code'] for s in smap['A']]:
            for i, d in enumerate(days[-5:]):
                conn.execute('UPDATE daily_prices SET close=close*? WHERE code=? AND date=?', (1.05 ** (i + 1), code, d))
        for code in [s['code'] for s in smap['B']]:
            for i, d in enumerate(days[-5:]):
                conn.execute('UPDATE daily_prices SET close=close*? WHERE code=? AND date=?', (0.95 ** (i + 1), code, d))
        rows = {r['sector']: r for r in sr.compute_snapshot(conn, smap)['rows']}
        self.assertEqual(rows['A']['rank5d'], 1)
        self.assertGreater(rows['A']['rank_change5d'], 0)
        self.assertLess(rows['B']['rank_change5d'], 0)

    def test_suspended_stock_excluded_from_breadth(self):
        # 마지막 날 거래량 0(거래정지) 종목은 당일 상승 비율 분모에서 빠진다
        n = 40
        conn, smap, _ = make_db({'업종': [0.01] * 4}, n_days=n, overrides={('S1_0', n - 1): 0})
        row = sr.compute_snapshot(conn, smap)['rows'][0]
        self.assertEqual(row['member_count'], 3)
        self.assertEqual(row['breadth_up_ratio'], 1.0)

    def test_new_listing_without_history_is_ignored_without_error(self):
        conn, smap, days = make_db({'업종': [0.01] * 3})
        for i, d in enumerate(days[-6:]):
            conn.execute('INSERT INTO daily_prices VALUES (?,?,?,?,?,?,?)', ('NEW1', d, 100.0, 100, 100, 100.0 + i, 1000))
        smap['업종'].append({'code': 'NEW1', 'name': '신규', 'market': 'KOSDAQ'})
        row = sr.compute_snapshot(conn, smap)['rows'][0]
        self.assertEqual(row['member_count'], 3)
        self.assertIsNotNone(row['rs20'])

    def test_no_trading_value_data_gives_none_ratio(self):
        conn, smap, _ = make_db({'업종': [0.01] * 4}, volume=None)
        conn.execute('UPDATE daily_prices SET volume=NULL')
        # 거래량이 없으면 tradable 판정이 모두 False라 업종이 계산에서 빠진다(오류 없이 None)
        self.assertIsNone(sr.compute_snapshot(conn, smap))

    def test_payload_groups_and_persistence(self):
        conn, smap, _ = make_db({'강한업종': [0.01] * 4, '약한업종': [-0.01] * 4, '보통업종': [0.0005] * 4,
                                 '중간A': [0.004] * 4, '중간B': [-0.004] * 4})
        payload = sr.build_payload(conn, smap, now=datetime(2030, 1, 1, 17, 0))
        self.assertTrue(payload['available'])
        self.assertTrue(payload['final'])
        self.assertEqual(payload['leading'][0]['sector'], '강한업종')
        self.assertTrue(payload['map'])
        stored = conn.execute('SELECT COUNT(*), MIN(final) FROM sector_rotation_daily').fetchone()
        self.assertEqual(stored[0], 5)
        self.assertEqual(stored[1], 1)

    def test_final_snapshot_is_not_overwritten_but_intraday_one_is(self):
        conn, smap, _ = make_db({'강한업종': [0.01] * 4, '약한업종': [-0.01] * 4, '보통업종': [0.0005] * 4})
        snap = sr.compute_snapshot(conn, smap)
        self.assertTrue(sr.save_snapshot(conn, snap, final=False))
        self.assertTrue(sr.save_snapshot(conn, snap, final=True))
        snap['rows'][0]['rotation_score'] = 1.0
        self.assertFalse(sr.save_snapshot(conn, snap, final=True))
        self.assertNotEqual(conn.execute('SELECT MIN(rotation_score) FROM sector_rotation_daily').fetchone()[0], 1.0)

    def test_is_final_rule(self):
        self.assertTrue(sr.is_final('2026-10-01', datetime(2026, 10, 2, 9, 0, tzinfo=sr.KST)))
        self.assertFalse(sr.is_final('2026-10-02', datetime(2026, 10, 2, 11, 0, tzinfo=sr.KST)))
        self.assertTrue(sr.is_final('2026-10-02', datetime(2026, 10, 2, 16, 30, tzinfo=sr.KST)))

    def test_detail_lists_leaders(self):
        conn, smap, _ = make_db({'강한업종': [0.01, 0.02, 0.005, 0.015], '약한업종': [-0.01] * 4, '보통업종': [0.0005] * 4})
        detail = sr.sector_detail(conn, smap, '강한업종')
        self.assertEqual(detail['leaders'][0]['excess5d'], max(s['excess5d'] for s in detail['leaders']))


if __name__ == '__main__':
    unittest.main()
