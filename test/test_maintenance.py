import os
import sys
import tempfile
import unittest
from datetime import datetime

CLOUD_VM_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
if CLOUD_VM_DIR not in sys.path:
    sys.path.insert(0, CLOUD_VM_DIR)

import maintenance  # noqa: E402


class MaintenanceTests(unittest.TestCase):
    def test_market_hours_are_blocked(self):
        self.assertFalse(maintenance.is_off_hours(datetime(2026, 8, 17, 10, 0, tzinfo=maintenance.KST)))
        self.assertTrue(maintenance.is_off_hours(datetime(2026, 8, 17, 8, 59, tzinfo=maintenance.KST)))
        self.assertTrue(maintenance.is_off_hours(datetime(2026, 8, 17, 15, 41, tzinfo=maintenance.KST)))

    def test_weekend_is_off_hours(self):
        self.assertTrue(maintenance.is_off_hours(datetime(2026, 8, 16, 12, 0, tzinfo=maintenance.KST)))

    def test_system_log_cleanup_runs_only_on_weekends(self):
        saturday = datetime(2026, 8, 15, 4, 0, tzinfo=maintenance.KST)
        monday = datetime(2026, 8, 17, 4, 0, tzinfo=maintenance.KST)
        self.assertTrue(maintenance.is_weekend(saturday))
        self.assertFalse(maintenance.is_weekend(monday))

    def test_rotated_log_pattern_does_not_match_active_log(self):
        self.assertFalse(maintenance.ROTATED_LOG_RE.match('syslog'))
        self.assertTrue(maintenance.ROTATED_LOG_RE.match('syslog.1'))
        self.assertTrue(maintenance.ROTATED_LOG_RE.match('syslog.2.gz'))

    def test_trim_log_keeps_recent_lines_atomically(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = os.path.join(temp_dir, 'sample.log')
            with open(path, 'w', encoding='utf-8') as output:
                output.writelines('%d\n' % index for index in range(5))
            removed = maintenance.trim_log(path, max_lines=2)
            self.assertEqual(removed, 3)
            with open(path, 'r', encoding='utf-8') as source:
                self.assertEqual(source.read(), '3\n4\n')


if __name__ == '__main__':
    unittest.main()


class RetentionCoverageTests(unittest.TestCase):
    """2026-08-31: 코드가 쓰는 SQLite는 5개인데 유지보수 대상이 2개뿐이었다.
    domestic_news는 삭제 정책이 아예 없어 영구 누적됐고(=/domestic-news 6~13초의 뿌리),
    미국 캐시 2개는 안 보는 심볼이 계속 남았다."""

    def test_all_five_databases_are_covered_by_maintenance(self):
        import io
        with io.open(os.path.join(CLOUD_VM_DIR, 'maintenance.py'), encoding='utf-8') as fh:
            src = fh.read()
        for name in ('ohlc_snapshot.db', 'news_momentum.db', 'domestic_news.db',
                     'us_news_cache.db', 'us_analysis_cache.db'):
            self.assertIn(name, src, '%s 가 유지보수에서 빠졌다' % name)

    def test_domestic_news_prune_deletes_only_rows_past_retention(self):
        import time as _time
        import domestic_news
        from unittest import mock
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = os.path.join(temp_dir, 'domestic.db')
            with mock.patch.object(domestic_news, 'CACHE_DB_FILE', db_path):
                now = _time.time()
                conn = domestic_news._connect()
                try:
                    rows = [
                        ('old', '오래된 기사', now - 200 * 86400),
                        ('edge', '경계 바깥', now - 91 * 86400),
                        ('keep', '최근 기사', now - 3 * 86400),
                    ]
                    for key, title, fetched in rows:
                        conn.execute(
                            'INSERT INTO domestic_news(item_key, title, fetched_at) VALUES (?,?,?)',
                            (key, title, fetched))
                    conn.commit()
                finally:
                    conn.close()
                result = domestic_news.prune_old_rows(now=now)
                conn = domestic_news._connect()
                try:
                    left = {r[0] for r in conn.execute('SELECT item_key FROM domestic_news')}
                finally:
                    conn.close()
        self.assertEqual(result['deleted'], 2)
        self.assertEqual(result['retentionDays'], 90)
        self.assertEqual(left, {'keep'}, '보존 기간 안의 행은 남아야 한다')

    def test_domestic_news_retention_is_far_longer_than_any_read_window(self):
        """읽는 쪽 최대 조회 범위(_load_cached stale 24시간, 주간 리포트 약 7일)보다
        훨씬 길어야 안전하다."""
        import domestic_news
        self.assertGreaterEqual(domestic_news.RETENTION_DAYS, 30)
