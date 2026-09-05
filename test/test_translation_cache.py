"""번역 캐시 만료·강제 재번역 검증(2026-09-05).

캐시에 TTL도 정리도 없어서 (1) 테이블이 무한히 커지고 (2) 한번 잘못 번역된 제목이
영구 고정됐다. updated_at을 기록만 하고 만료에 쓰지 않았다.
"""
import os
import sys
import tempfile
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))


class TranslationCacheTest(unittest.TestCase):
    def setUp(self):
        import news_aggregator as na
        self.na = na
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        path = os.path.join(self.tmp.name, 'news_cache.db')
        self._orig = na._cache_db_path
        na._cache_db_path = lambda: path
        self.addCleanup(lambda: setattr(na, '_cache_db_path', self._orig))
        with na.TRANSLATION_CACHE_LOCK:
            na._translation_cache.clear()

    def _write(self, title, translated, age_days=0):
        conn = self.na._cache_connect()
        try:
            with conn:
                conn.execute(
                    'INSERT OR REPLACE INTO news_translation_cache(title, translated, updated_at)'
                    ' VALUES (?, ?, ?)',
                    (title, translated, int(time.time()) - age_days * 86400))
        finally:
            conn.close()

    def _rows(self):
        conn = self.na._cache_connect()
        try:
            return {r['title'] for r in conn.execute(
                'SELECT title FROM news_translation_cache').fetchall()}
        finally:
            conn.close()

    def test_prune_removes_only_rows_past_the_retention_window(self):
        self._write('fresh headline', '최신 제목', age_days=1)
        self._write('old headline', '오래된 제목', age_days=200)
        self._write('edge headline', '경계 제목', age_days=89)
        removed = self.na.prune_translation_cache()          # 기본 90일
        self.assertEqual(1, removed)
        self.assertEqual({'fresh headline', 'edge headline'}, self._rows())

    def test_prune_window_is_configurable(self):
        self._write('a', '가', age_days=40)
        self._write('b', '나', age_days=10)
        self.assertEqual(1, self.na.prune_translation_cache(30))
        self.assertEqual({'b'}, self._rows())

    def test_forget_clears_both_memory_and_sqlite(self):
        """오역을 고치는 유일한 방법 - 캐시가 남아 있으면 외부 호출 자체를 안 한다."""
        self._write('bad headline', '엉뚱한 번역')
        with self.na.TRANSLATION_CACHE_LOCK:
            self.na._translation_cache['bad headline'] = '엉뚱한 번역'
        # 지우기 전에는 캐시에서 그대로 읽힌다.
        self.assertEqual({'bad headline': '엉뚱한 번역'},
                         self.na._load_persistent_translations(['bad headline']))
        self.assertEqual(1, self.na.forget_translations(['bad headline']))
        self.assertEqual({}, self.na._load_persistent_translations(['bad headline']))
        self.assertNotIn('bad headline', self.na._translation_cache)

    def test_forget_ignores_empty_input(self):
        self.assertEqual(0, self.na.forget_translations([]))
        self.assertEqual(0, self.na.forget_translations(['', '   ', None]))

    def test_prune_is_rate_limited_to_once_a_day(self):
        """이 루프는 75초마다 도는데 DELETE를 매번 돌릴 이유가 없다."""
        calls = []
        self.na._translation_pruned_at = 0.0
        original = self.na.prune_translation_cache
        self.na.prune_translation_cache = lambda *a, **k: calls.append(1)
        try:
            self.na._prune_translation_cache_if_due()
            self.na._prune_translation_cache_if_due()
            self.na._prune_translation_cache_if_due()
        finally:
            self.na.prune_translation_cache = original
        self.assertEqual(1, len(calls))


if __name__ == '__main__':
    unittest.main()
