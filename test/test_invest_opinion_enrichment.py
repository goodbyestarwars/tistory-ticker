# -*- coding: utf-8 -*-
import os
import sqlite3
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts' / 'cloud-vm'))

import db_schema  # noqa: E402
import invest_opinion  # noqa: E402


class InvestOpinionsDbTests(unittest.TestCase):
    """2026-08-23 신설: 차트검색/전략검색 배치가 종목마다 KIS를 라이브로 부르지 않고
    하루 1회 DB 캐시를 재사용하도록 하는 저장 계층(db_schema.invest_opinions)."""

    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        db_schema.create_schema(self.conn)

    def test_upsert_then_load_round_trips_summary(self):
        summary = {'available': True, 'reportCount': 5, 'avgTargetPrice': 100000}
        db_schema.upsert_invest_opinion(self.conn, '005930', summary, '2026-08-23T00:00:00+00:00')
        self.assertEqual(db_schema.load_invest_opinions(self.conn, ['005930']), {'005930': summary})

    def test_load_filters_by_requested_codes(self):
        db_schema.upsert_invest_opinion(self.conn, '005930', {'available': True}, 't')
        db_schema.upsert_invest_opinion(self.conn, '000660', {'available': True}, 't')
        result = db_schema.load_invest_opinions(self.conn, ['005930'])
        self.assertEqual(list(result.keys()), ['005930'])

    def test_upsert_overwrites_existing_row(self):
        db_schema.upsert_invest_opinion(self.conn, '005930', {'reportCount': 1}, 't1')
        db_schema.upsert_invest_opinion(self.conn, '005930', {'reportCount': 9}, 't2')
        result = db_schema.load_invest_opinions(self.conn, ['005930'])
        self.assertEqual(result['005930']['reportCount'], 9)


class EnrichMatchesWithTargetPriceTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        db_schema.create_schema(self.conn)

    def test_does_nothing_without_kis_credentials(self):
        matches = [{'code': '005930', 'price': 70000}]
        invest_opinion.enrich_matches_with_target_price(matches, None, None, self.conn)
        self.assertNotIn('analystTargetPrice', matches[0])

    def test_fetches_live_when_no_cache_and_attaches_target_price(self):
        matches = [{'code': '005930', 'price': 70000}]
        fake_summary = {'available': True, 'reportCount': 10, 'avgTargetPrice': 84000}
        with mock.patch.object(invest_opinion.kis_client, 'get_token', return_value='tok'), \
                mock.patch.object(invest_opinion, 'fetch_recent_opinion_summary', return_value=fake_summary), \
                mock.patch.object(invest_opinion.time, 'sleep'):
            invest_opinion.enrich_matches_with_target_price(matches, 'key', 'secret', self.conn)
        self.assertEqual(matches[0]['analystTargetPrice'], 84000)
        self.assertAlmostEqual(matches[0]['analystTargetGapPct'], (84000 - 70000) / 70000 * 100, places=2)
        self.assertEqual(matches[0]['analystReportCount'], 10)
        # DB에도 저장됐어야 한다(다음 배치가 재사용할 수 있게).
        cached = db_schema.load_invest_opinions(self.conn, ['005930'])
        self.assertTrue(cached['005930']['available'])

    def test_reuses_fresh_db_cache_without_calling_kis_again(self):
        now = datetime.now(timezone.utc)
        db_schema.upsert_invest_opinion(
            self.conn, '005930',
            {'available': True, 'reportCount': 3, 'avgTargetPrice': 90000, '_updatedAt': now.isoformat()},
            now.isoformat(),
        )
        matches = [{'code': '005930', 'price': 70000}]
        with mock.patch.object(invest_opinion.kis_client, 'get_token') as get_token:
            invest_opinion.enrich_matches_with_target_price(matches, 'key', 'secret', self.conn)
        get_token.assert_not_called()
        self.assertEqual(matches[0]['analystTargetPrice'], 90000)

    def test_stale_cache_triggers_a_fresh_kis_call(self):
        stale = datetime.now(timezone.utc) - timedelta(hours=invest_opinion.FRESH_HOURS + 1)
        db_schema.upsert_invest_opinion(
            self.conn, '005930',
            {'available': True, 'reportCount': 1, 'avgTargetPrice': 50000, '_updatedAt': stale.isoformat()},
            stale.isoformat(),
        )
        matches = [{'code': '005930', 'price': 70000}]
        fake_summary = {'available': True, 'reportCount': 20, 'avgTargetPrice': 95000}
        with mock.patch.object(invest_opinion.kis_client, 'get_token', return_value='tok'), \
                mock.patch.object(invest_opinion, 'fetch_recent_opinion_summary', return_value=fake_summary), \
                mock.patch.object(invest_opinion.time, 'sleep'):
            invest_opinion.enrich_matches_with_target_price(matches, 'key', 'secret', self.conn)
        self.assertEqual(matches[0]['analystTargetPrice'], 95000)

    def test_unavailable_summary_leaves_match_fields_untouched(self):
        matches = [{'code': '005930', 'price': 70000}]
        with mock.patch.object(invest_opinion.kis_client, 'get_token', return_value='tok'), \
                mock.patch.object(invest_opinion, 'fetch_recent_opinion_summary',
                                   return_value={'available': False, 'reportCount': 0}), \
                mock.patch.object(invest_opinion.time, 'sleep'):
            invest_opinion.enrich_matches_with_target_price(matches, 'key', 'secret', self.conn)
        self.assertNotIn('analystTargetPrice', matches[0])

    def test_does_not_collide_with_existing_target_price_gap_fields(self):
        # strategy_scan.py의 targetPriceGap 카테고리는 이미 targetPrice/targetGapPct를
        # 자체 계산해서 갖고 있다 - 분석가 필드는 다른 이름을 써서 덮어쓰지 않아야 한다.
        matches = [{'code': '005930', 'price': 70000, 'targetPrice': 80000, 'targetGapPct': 14.3}]
        fake_summary = {'available': True, 'reportCount': 4, 'avgTargetPrice': 84000}
        with mock.patch.object(invest_opinion.kis_client, 'get_token', return_value='tok'), \
                mock.patch.object(invest_opinion, 'fetch_recent_opinion_summary', return_value=fake_summary), \
                mock.patch.object(invest_opinion.time, 'sleep'):
            invest_opinion.enrich_matches_with_target_price(matches, 'key', 'secret', self.conn)
        self.assertEqual(matches[0]['targetPrice'], 80000)
        self.assertEqual(matches[0]['targetGapPct'], 14.3)
        self.assertEqual(matches[0]['analystTargetPrice'], 84000)

    def test_duplicate_codes_across_matches_only_call_kis_once_per_code(self):
        matches = [{'code': '005930', 'price': 70000}, {'code': '005930', 'price': 71000}]
        fake_summary = {'available': True, 'reportCount': 2, 'avgTargetPrice': 84000}
        with mock.patch.object(invest_opinion.kis_client, 'get_token', return_value='tok'), \
                mock.patch.object(invest_opinion, 'fetch_recent_opinion_summary',
                                   return_value=fake_summary) as fetch_mock, \
                mock.patch.object(invest_opinion.time, 'sleep'):
            invest_opinion.enrich_matches_with_target_price(matches, 'key', 'secret', self.conn)
        self.assertEqual(fetch_mock.call_count, 1)
        self.assertEqual(matches[1]['analystTargetPrice'], 84000)


if __name__ == '__main__':
    unittest.main()
