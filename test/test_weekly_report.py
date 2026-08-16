import os
import sys
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import weekly_report


class WeeklyReportTests(unittest.TestCase):
    def test_completed_week_resolves_previous_friday_on_weekday(self):
        start, end = weekly_report.completed_week(datetime(2026, 8, 19, tzinfo=timezone.utc))
        self.assertEqual((start.isoformat(), end.isoformat()), ('2026-08-10', '2026-08-14'))

    def test_index_summary_uses_week_points_and_change(self):
        rows = [{'symbol': 'KOSPI', 'chart': [
            {'date': '2026-08-10', 'close': 100},
            {'date': '2026-08-14', 'close': 105},
        ]}]
        result = weekly_report.index_summary(rows, datetime(2026, 8, 10).date(), datetime(2026, 8, 14).date())
        self.assertEqual(result[0]['name'], '코스피')
        self.assertEqual(result[0]['changeRate'], 5.0)

    def test_hot_stocks_merges_multiple_rank_tags(self):
        board = {'sections': {
            'rising': [{'code': '005930', 'name': '삼성전자', 'change_rate': 8}],
            'volumePower': [{'code': '005930', 'name': '삼성전자', 'change_rate': 8}],
        }}
        result = weekly_report.hot_stocks(board)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['tags'], ['상승 상위', '매수체결강도'])

    def test_hot_stocks_uses_trade_amount_rows_when_rank_sections_are_empty(self):
        result = weekly_report.hot_stocks({'rows': [{'code': 'US:A', 'name': 'A', 'change_rate': 1.2}]})
        self.assertEqual(result[0]['code'], 'US:A')
        self.assertEqual(result[0]['tags'], ['거래대금 상위'])

    def test_next_week_schedule_filters_outside_window(self):
        result = weekly_report.next_week_schedule([
            {'start': '2026-08-17', 'title': '실적'},
            {'start': '2026-08-24', 'title': '다음 주 아님'},
        ], datetime(2026, 8, 10).date(), datetime(2026, 8, 14).date())
        self.assertEqual([item['title'] for item in result], ['실적'])


if __name__ == '__main__':
    unittest.main()
