# -*- coding: utf-8 -*-
import os
import sys
import tempfile
import unittest
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import db_schema
import monitor_swing_recommendations as msr
import swing_model


def _insert_daily_prices(conn, code, n=40, base=10000):
    cursor = date(2024, 1, 1)
    for i in range(n):
        price = base + i * 10
        conn.execute(
            'INSERT INTO daily_prices (code, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)',
            (code, cursor.isoformat(), price, price + 20, price - 20, price, 1000),
        )
        cursor += timedelta(days=1)


def _insert_snapshot(conn, code, as_of_date, model_version, close, t10_return=None, t20_return=None):
    conn.execute(
        '''INSERT INTO swing_recommendation_snapshots
           (as_of_date, code, name, model_version, close, t10_return, t20_return, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
        (as_of_date, code, code, model_version, close, t10_return, t20_return, as_of_date),
    )


class MonitorSwingRecommendationsTests(unittest.TestCase):
    """2026-08-21: t20_return까지 이미 채워진 오래된 스냅샷을 매일 무제한 전량 재처리하던
    문제의 수정 대상이었던 재처리 필터가, 2026-08-22 2주 모델 전환으로 완료 판정 기준이
    t20_return에서 t10_return으로 바뀌었다 - t10_return IS NULL인 행만 재처리해야 한다."""

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix='.sqlite', delete=False)
        self.tmp.close()
        self.db_file = self.tmp.name
        conn = db_schema.get_conn(self.db_file)
        db_schema.create_schema(conn)
        self.conn = conn

    def tearDown(self):
        self.conn.close()
        if os.path.exists(self.db_file):
            os.remove(self.db_file)

    def test_only_reprocesses_snapshots_missing_t10_return(self):
        _insert_daily_prices(self.conn, '005930', n=40)
        # 이미 확정된 스냅샷(t10_return 있음, 옛 4주 모델 시절 t20_return도 남아있음) -
        # 재처리 대상에서 빠져야 하고, 옛 t20_return도 그대로 보존돼야 한다.
        _insert_snapshot(self.conn, '005930', '2024-01-01', swing_model.MODEL_VERSION, 10000,
                          t10_return=3.0, t20_return=5.0)
        # 아직 확정 안 된 스냅샷(t10_return 없음) - 재처리 대상
        _insert_snapshot(self.conn, '005930', '2024-01-02', swing_model.MODEL_VERSION, 10010,
                          t10_return=None, t20_return=None)
        self.conn.commit()

        result = msr.run(db_file=self.db_file)

        self.assertEqual(result['snapshots'], 1)  # t10_return이 이미 있는 행은 안 셈

        conn2 = db_schema.get_conn(self.db_file)
        rows = conn2.execute(
            'SELECT as_of_date, t10_return, t20_return FROM swing_recommendation_snapshots ORDER BY as_of_date'
        ).fetchall()
        conn2.close()
        # 이미 확정됐던 행(2024-01-01)은 t10_return=3.0, 옛 t20_return=5.0 모두 그대로
        # 유지돼야 한다(재처리 대상이 아니었으므로 건드리지 않음).
        self.assertEqual(rows[0][0], '2024-01-01')
        self.assertEqual(rows[0][1], 3.0)
        self.assertEqual(rows[0][2], 5.0)

    def test_reprocessed_snapshot_never_writes_t20_return(self):
        """2주 모델은 더 이상 t20_return을 계산하지 않으므로, 재처리된 행의 t20_return은
        (원래 없었다면) None으로 남아야 한다 - update_swing_snapshot_outcome이 그 컬럼을
        아예 안 건드리기 때문."""
        _insert_daily_prices(self.conn, '005930', n=40)
        _insert_snapshot(self.conn, '005930', '2024-01-02', swing_model.MODEL_VERSION, 10010)
        self.conn.commit()

        msr.run(db_file=self.db_file)

        conn2 = db_schema.get_conn(self.db_file)
        row = conn2.execute(
            'SELECT t10_return, t20_return FROM swing_recommendation_snapshots WHERE as_of_date=?',
            ('2024-01-02',),
        ).fetchone()
        conn2.close()
        self.assertIsNotNone(row[0])  # t10_return은 채워짐(40일치 데이터가 있으므로)
        self.assertIsNone(row[1])    # t20_return은 이 함수가 더 이상 안 씀

    def test_no_matching_snapshots_returns_zero(self):
        result = msr.run(db_file=self.db_file)
        self.assertEqual(result, {'snapshots': 0, 'updated': 0})


if __name__ == '__main__':
    unittest.main()
