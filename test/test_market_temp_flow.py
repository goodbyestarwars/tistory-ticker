# -*- coding: utf-8 -*-
"""증시온도 수급(flow) - 시장 전체 investor_trend_daily 기반 계산 검증.

2026-09-01 종단 비교에서 VM foreign v5=-14590.49가 나왔는데, 그 5일 창에 **거래 전
당일 0행**이 섞여 있었다(09.01 개인/외국인/기관 모두 0.0). 산수는 맞았지만 입력이
틀렸던 경우다 - 값이 나온다고 맞는 게 아니라서 실제 관측 데이터를 그대로 고정해 둔다.
"""

import os
import sqlite3
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))

import db_schema                      # noqa: E402
import market_temp_data as data       # noqa: E402


# 2026-09-01 06:11 KST에 /domestic-market-indicators가 실제로 돌려준 KOSPI 행.
# 마지막 09.01은 장이 열리기 전이라 셋 다 0이다.
OBSERVED = [
    ('2026-08-18', 5120.30, -9033.11, 3180.44),
    ('2026-08-19', -2044.10, -34726.00, 20551.02),
    ('2026-08-20', -8801.55, 17068.00, -9210.33),
    ('2026-08-21', 3355.90, -12044.28, 8100.51),
    ('2026-08-24', 15220.44, -36691.00, 21044.19),
    ('2026-08-25', 10509.05, -38193.91, 11710.83),
    ('2026-08-26', -22460.92, -1039.10, 7615.15),
    ('2026-08-27', -19115.75, 1435.46, 1835.28),
    ('2026-08-28', 4193.78, -8547.57, -11875.53),
    ('2026-08-31', -1464.06, -6439.28, -7891.41),
    ('2026-09-01', 0.0, 0.0, 0.0),          # 개장 전 자리표시자
]


def _conn(rows):
    conn = sqlite3.connect(':memory:')
    db_schema.init_db(conn) if hasattr(db_schema, 'init_db') else None
    conn.execute('CREATE TABLE IF NOT EXISTS investor_trend_daily ('
                 ' market TEXT NOT NULL, date TEXT NOT NULL,'
                 ' ind_amt REAL, frgn_amt REAL, orgn_amt REAL, updated_at TEXT,'
                 ' PRIMARY KEY (market, date))')
    conn.executemany(
        'INSERT OR REPLACE INTO investor_trend_daily'
        ' (market, date, ind_amt, frgn_amt, orgn_amt, updated_at)'
        ' VALUES (?,?,?,?,?,?)',
        [('KOSPI', d, i, f, o, d) for d, i, f, o in rows])
    conn.commit()
    return conn


class PlaceholderRowTest(unittest.TestCase):
    def test_all_zero_row_is_placeholder(self):
        self.assertFalse(data._has_investor_data(
            {'ind': 0.0, 'frgn': 0.0, 'orgn': 0.0}))
        self.assertFalse(data._has_investor_data(
            {'ind': None, 'frgn': None, 'orgn': None}))

    def test_real_trading_day_is_kept(self):
        # 외국인만 0이어도 나머지가 살아 있으면 실제 거래일이다.
        self.assertTrue(data._has_investor_data(
            {'ind': -1464.06, 'frgn': 0.0, 'orgn': -7891.41}))
        self.assertTrue(data._has_investor_data(
            {'ind': 0.0, 'frgn': -6439.28, 'orgn': 0.0}))

    def test_placeholder_excluded_from_five_day_sum(self):
        """버그 재현: 0행이 남아 있으면 v5가 실질 4일치가 된다."""
        conn = _conn(OBSERVED)
        try:
            _component, ratios = data.flow_component_from_market_trend(conn)
        finally:
            conn.close()

        # 고쳤을 때: 실제 거래일 5일(08.25~08.31)
        expected_frgn = -38193.91 + -1039.10 + 1435.46 + -8547.57 + -6439.28
        expected_orgn = 11710.83 + 7615.15 + 1835.28 + -11875.53 + -7891.41
        self.assertAlmostEqual(ratios['foreign_v5'], expected_frgn, places=2)
        self.assertAlmostEqual(ratios['inst_v5'], expected_orgn, places=2)

        # 고치기 전 값(0행 포함, 실질 4일치)으로 되돌아가지 않는지 못박는다.
        self.assertNotAlmostEqual(ratios['foreign_v5'], -14590.49, places=2)
        self.assertNotAlmostEqual(ratios['inst_v5'], -10316.51, places=2)

    def test_placeholder_excluded_from_baseline(self):
        """0행은 20일 기준선의 분모에서도 빠져야 한다.

        남아 있으면 평균 |순매매|가 낮아져 비율이 부풀려진다.
        """
        with_zero = _conn(OBSERVED)
        without_zero = _conn([r for r in OBSERVED if r[0] != '2026-09-01'])
        try:
            a = data.flow_component_from_market_trend(with_zero)[1]
            b = data.flow_component_from_market_trend(without_zero)[1]
        finally:
            with_zero.close()
            without_zero.close()
        # 0행이 있든 없든 결과가 같아야 한다 - 걸러지고 있다는 뜻.
        self.assertAlmostEqual(a['foreign'], b['foreign'], places=6)
        self.assertAlmostEqual(a['inst'], b['inst'], places=6)

    def test_ratio_stays_in_range_and_is_not_saturated(self):
        """KODEX200 시절의 ±1.0 포화가 재발하지 않는지."""
        conn = _conn(OBSERVED)
        try:
            _component, ratios = data.flow_component_from_market_trend(conn)
        finally:
            conn.close()
        for key in ('foreign', 'inst'):
            self.assertIsNotNone(ratios[key])
            self.assertGreaterEqual(ratios[key], -1.0)
            self.assertLessEqual(ratios[key], 1.0)
            self.assertNotAlmostEqual(abs(ratios[key]), 1.0, places=6,
                                      msg='%s 비율이 포화됨 - 기준선이 무너졌는지 확인' % key)

    def test_empty_table_is_handled(self):
        conn = _conn([])
        try:
            component, ratios = data.flow_component_from_market_trend(conn)
        finally:
            conn.close()
        self.assertIsNone(ratios['foreign'])
        self.assertIsNone(ratios['inst'])
        self.assertIsNotNone(component)

    def test_all_rows_placeholder_is_handled(self):
        """휴장 연휴처럼 전부 0이어도 죽지 않아야 한다."""
        conn = _conn([('2026-09-01', 0.0, 0.0, 0.0), ('2026-09-02', 0.0, 0.0, 0.0)])
        try:
            component, ratios = data.flow_component_from_market_trend(conn)
        finally:
            conn.close()
        self.assertIsNone(ratios['foreign'])
        self.assertIsNone(ratios['inst'])
        self.assertIsNotNone(component)


if __name__ == '__main__':
    unittest.main(verbosity=2)
