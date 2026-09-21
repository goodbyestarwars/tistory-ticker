# -*- coding: utf-8 -*-
"""스윙 추천 결과 채우기의 메모리·조회 비용(2026-09-21).

2026-09-18 실측(운영 VM, 953MB e2-micro): 47,690행 처리에 **21분 19초**, 메모리 최대
**512.9MB**, 스왑 최대 **885.9MB**. 원인 두 가지였다.

1. `daily_cache = {code: load_daily_prices(conn, code) for code in codes}` - 대상 종목
   **전부**의 일봉을 한꺼번에 올렸다. 정작 쿼리는 `ORDER BY code, as_of_date`라 같은 code가
   붙어 있어서, 지금 보는 종목 하나만 들고 있으면 된다(코드 주석도 그렇게 적혀 있었다).
2. `load_future_chart_since(conn, 'KOSPI', ...)`를 **행마다** 불렀다. 그 함수는 future_chart의
   KOSPI 전체를 매번 다시 읽고 정규화한 뒤 날짜로 거른다 - 같은 전체 스캔이 47,690번 돌았다.

여기서는 (a) 결과가 예전 방식과 완전히 같은지, (b) 조회 횟수가 실제로 줄었는지를 본다.
"""

import os
import sys
import tempfile
import unittest
from datetime import date, timedelta
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                'scripts', 'cloud-vm'))

import db_schema  # noqa: E402
import monitor_swing_recommendations as msr  # noqa: E402
import swing_model  # noqa: E402

CODES = ['005930', '000660', '035420']


def seed(conn, codes=CODES, days=40):
    """종목별 일봉 + KOSPI 벤치마크 + 미확정 스냅샷을 여러 날짜로 심는다."""
    start = date(2024, 1, 1)
    for index, code in enumerate(codes):
        cursor = start
        for i in range(days):
            price = 10000 + index * 500 + i * 10
            conn.execute(
                'INSERT INTO daily_prices (code, date, open, high, low, close, volume)'
                ' VALUES (?, ?, ?, ?, ?, ?, ?)',
                (code, cursor.isoformat(), price, price + 20, price - 20, price, 1000))
            cursor += timedelta(days=1)
    cursor = start
    for i in range(days):
        close = 2500 + i * 3
        conn.execute(
            'INSERT INTO future_chart (symbol, date, open, high, low, close)'
            ' VALUES (?, ?, ?, ?, ?, ?)',
            ('KOSPI', cursor.strftime('%Y%m%d'), close, close + 5, close - 5, close))
        cursor += timedelta(days=1)
    for index, code in enumerate(codes):
        for offset in (0, 1, 2):
            as_of = (start + timedelta(days=offset)).isoformat()
            conn.execute(
                '''INSERT INTO swing_recommendation_snapshots
                   (as_of_date, code, name, model_version, close, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)''',
                (as_of, code, code, swing_model.MODEL_VERSION,
                 10000 + index * 500 + offset * 10, as_of))
    conn.commit()


def outcomes_the_old_way(conn):
    """수정 전 알고리즘을 그대로 재현한다 - 전량 preload + 행마다 벤치마크 재조회."""
    rows = conn.execute(
        '''SELECT as_of_date, code, model_version, chart_regime, current_regime, close
           FROM swing_recommendation_snapshots
           WHERE model_version=? AND t10_return IS NULL ORDER BY code, as_of_date''',
        (swing_model.MODEL_VERSION,)).fetchall()
    codes = {row[1] for row in rows}
    daily_cache = {code: db_schema.load_daily_prices(conn, code) for code in codes}
    out = {}
    for row in rows:
        # benchmark_by_date를 안 넘기면 예전처럼 행마다 다시 읽는다.
        out[(row[0], row[1])] = msr.outcome_for_snapshot(conn, row, daily_cache)
    return out


class Base(unittest.TestCase):
    def setUp(self):
        handle = tempfile.NamedTemporaryFile(suffix='.sqlite', delete=False)
        handle.close()
        self.db_file = handle.name
        self.conn = db_schema.get_conn(self.db_file)
        db_schema.create_schema(self.conn)
        seed(self.conn)

    def tearDown(self):
        self.conn.close()
        if os.path.exists(self.db_file):
            os.remove(self.db_file)


class SameResultsTest(Base):
    """가장 중요한 것 - 빨라지고 가벼워졌다고 값이 달라지면 안 된다."""

    def test_new_path_matches_the_old_algorithm_exactly(self):
        expected = outcomes_the_old_way(self.conn)
        benchmark = msr.load_benchmark_by_date(self.conn)
        rows = self.conn.execute(
            '''SELECT as_of_date, code, model_version, chart_regime, current_regime, close
               FROM swing_recommendation_snapshots
               WHERE model_version=? AND t10_return IS NULL ORDER BY code, as_of_date''',
            (swing_model.MODEL_VERSION,)).fetchall()
        for row in rows:
            got = msr.outcome_for_snapshot(
                self.conn, row, {row[1]: db_schema.load_daily_prices(self.conn, row[1])}, benchmark)
            want = dict(expected[(row[0], row[1])])
            # 실행 시각만 다르다.
            got.pop('outcomeUpdatedAt'), want.pop('outcomeUpdatedAt')
            self.assertEqual(got, want, '%s %s' % (row[1], row[0]))

    def test_run_still_fills_returns(self):
        result = msr.run(self.db_file)
        self.assertEqual(result['snapshots'], len(CODES) * 3)
        self.assertGreater(result['updated'], 0)
        filled = self.conn.execute(
            'SELECT COUNT(*) FROM swing_recommendation_snapshots WHERE t10_return IS NOT NULL'
        ).fetchone()[0]
        self.assertEqual(filled, result['updated'])


class QueryCountTest(Base):
    """조회 횟수가 실제로 줄었는지."""

    def _counts(self):
        counts = {'daily': 0, 'benchmark': 0}
        real_daily = db_schema.load_daily_prices
        real_benchmark = db_schema.load_future_chart_since

        def daily(conn, code):
            counts['daily'] += 1
            return real_daily(conn, code)

        def benchmark(conn, symbol, since):
            counts['benchmark'] += 1
            return real_benchmark(conn, symbol, since)

        with mock.patch.object(db_schema, 'load_daily_prices', side_effect=daily), \
                mock.patch.object(db_schema, 'load_future_chart_since', side_effect=benchmark):
            msr.run(self.db_file)
        return counts

    def test_the_benchmark_is_read_once_not_once_per_row(self):
        """행마다 KOSPI 전체를 다시 읽던 것이 21분의 주범이었다."""
        self.assertEqual(self._counts()['benchmark'], 1)

    def test_daily_prices_are_read_once_per_code_not_held_all_at_once(self):
        """종목당 한 번이면 충분하다 - 정렬이 code 기준이라 같은 code가 붙어 있다."""
        self.assertEqual(self._counts()['daily'], len(CODES))


class NoBulkPreloadTest(unittest.TestCase):
    """전량 preload 구문이 되살아나지 않게 못 박는다."""

    def test_the_bulk_dict_comprehension_is_gone(self):
        path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            'scripts', 'cloud-vm', 'monitor_swing_recommendations.py')
        with open(path, encoding='utf-8') as handle:
            src = handle.read()
        self.assertNotIn('{code: db_schema.load_daily_prices(conn, code) for code in codes}', src)
        self.assertIn('if code != cached_code:', src)
        self.assertIn('benchmark_by_date = load_benchmark_by_date(conn)', src)


if __name__ == '__main__':
    unittest.main()
