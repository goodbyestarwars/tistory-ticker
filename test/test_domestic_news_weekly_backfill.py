# -*- coding: utf-8 -*-
import os
import sys
import tempfile
import unittest
from datetime import date
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import domestic_news


class WeeklyNewsBackfillTests(unittest.TestCase):
    """get_weekly_news()의 백필 분기(주간 커버리지 4일 미만일 때)가 초기화 안 된 'oldest'
    변수를 참조+대입해 매번 UnboundLocalError를 던지던 문제(2026-08-21 코드 감사) -
    호출부 try/except가 삼켜서 그 주의 뉴스 아카이브 전체가 조용히 빈 결과로 대체됐었다."""

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
        self.tmp.close()
        self._orig_db_file = domestic_news.CACHE_DB_FILE
        domestic_news.CACHE_DB_FILE = self.tmp.name

    def tearDown(self):
        domestic_news.CACHE_DB_FILE = self._orig_db_file
        if os.path.exists(self.tmp.name):
            os.remove(self.tmp.name)

    def test_backfill_branch_does_not_raise_and_returns_items(self):
        start = date(2024, 1, 1)
        end = date(2024, 1, 7)
        fake_items = [
            {'title': '코스피 상승 마감', 'link': 'https://example.com/1',
             'description': '', 'pubDate': 'Mon, 01 Jan 2024 09:00:00 +0900'},
            {'title': '코스닥 급등', 'link': 'https://example.com/2',
             'description': '', 'pubDate': 'Wed, 03 Jan 2024 09:00:00 +0900'},
        ]
        with mock.patch.dict(os.environ, {'NAVER_APIHUB_CLIENT_ID': 'id', 'NAVER_APIHUB_CLIENT_SECRET': 'secret'}):
            with mock.patch.object(domestic_news.naver_news, 'search_news', return_value=fake_items):
                # 커버리지 캐시가 비어 있어(len(covered_days) < 4) 반드시 백필 분기를 탄다.
                result = domestic_news.get_weekly_news(start.isoformat(), end.isoformat())
        self.assertEqual(len(result), 2)
        titles = {item['title'] for item in result}
        self.assertEqual(titles, {'코스피 상승 마감', '코스닥 급등'})


if __name__ == '__main__':
    unittest.main()
