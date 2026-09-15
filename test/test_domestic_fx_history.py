# -*- coding: utf-8 -*-
"""원/달러 일봉 이력 수집 계약(2026-09-16).

사용자 리포트: "시장지표 > 글로벌 시장지표 ... 환율이 계속 네이버랑 좀 다른거 같아".
원인: 네이버 FX_USDKRW/prices는 pageSize 60 초과를 HTTP 400으로 거절하는데 pageSize=365로 부르고 있어
일봉이 2026-08-14에서 멈췄다. 60건씩 페이지로 받아 합치는 동작을 고정한다.
"""

import os
import re
import sys
import unittest
from datetime import date, timedelta
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))

import domestic_futures  # noqa: E402


def _naver_rows(start_index, count):
    """최신순 일봉. index 0 = 가장 최근 날(2026-09-15)."""
    newest = date(2026, 9, 15)
    return [{'localTradedAt': (newest - timedelta(days=i)).isoformat(),
             'closePrice': '1,%03d.50' % (300 + i % 500)}
            for i in range(start_index, start_index + count)]


class FakeNaver:
    def __init__(self, total_rows, fail_page=None):
        self.total_rows = total_rows
        self.fail_page = fail_page
        self.urls = []

    def __call__(self, url):
        self.urls.append(url)
        query = parse_qs(urlparse(url).query)
        page, size = int(query['page'][0]), int(query['pageSize'][0])
        if size > 60:
            raise RuntimeError('HTTP Error 400: pageSize must be less than or equal to 60')
        if page == self.fail_page:
            raise RuntimeError('HTTP Error 500')
        start = (page - 1) * size
        return _naver_rows(start, max(0, min(size, self.total_rows - start)))


class FxDailyHistoryTests(unittest.TestCase):
    def test_requests_pages_of_60_and_merges_ascending(self):
        fake = FakeNaver(total_rows=10_000)
        rows = domestic_futures.fetch_fx_daily_chart(get_json=fake, sleep=lambda s: None)
        self.assertEqual(len(fake.urls), domestic_futures.FX_DAILY_PAGES)
        for url in fake.urls:
            self.assertLessEqual(int(parse_qs(urlparse(url).query)['pageSize'][0]), 60)
        dates = [row['date'] for row in rows]
        self.assertEqual(dates, sorted(dates))
        self.assertEqual(len(dates), len(set(dates)))
        self.assertTrue(all(re.match(r'^\d{8}$', d) for d in dates))
        self.assertEqual(rows[-1]['close'], 1300.5)           # 가장 최근 날(index 0)이 마지막
        # 주말 환율 리포트의 1년 관측 구간을 덮는다.
        self.assertGreaterEqual(domestic_futures.FX_DAILY_PAGE_SIZE * domestic_futures.FX_DAILY_PAGES, 365)

    def test_stops_when_a_page_is_short(self):
        fake = FakeNaver(total_rows=75)
        domestic_futures.fetch_fx_daily_chart(get_json=fake, sleep=lambda s: None)
        self.assertEqual(len(fake.urls), 2)

    def test_later_page_failure_keeps_recent_rows(self):
        fake = FakeNaver(total_rows=10_000, fail_page=3)
        rows = domestic_futures.fetch_fx_daily_chart(get_json=fake, sleep=lambda s: None)
        self.assertEqual(len(fake.urls), 3)
        self.assertEqual(len(rows), 120)

    def test_first_page_failure_still_raises(self):
        with self.assertRaises(RuntimeError):
            domestic_futures.fetch_fx_daily_chart(get_json=FakeNaver(10_000, fail_page=1), sleep=lambda s: None)

    def test_never_asks_naver_for_more_than_60_rows(self):
        with open(os.path.join(ROOT, 'scripts', 'cloud-vm', 'domestic_futures.py'), encoding='utf-8') as handle:
            source = handle.read()
        # 주석은 원인 설명으로 'pageSize=365'를 인용하므로 실제 URL 문자열만 본다.
        self.assertIsNone(re.search(r"pageSize=(?:6[1-9]|[7-9]\d|\d{3,})'", source))
        self.assertIn("prices?page=%d&pageSize=%d'", source)
        self.assertIn('FX_DAILY_PAGE_SIZE = 60', source)


if __name__ == '__main__':
    unittest.main()
