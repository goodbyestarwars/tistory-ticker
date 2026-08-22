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

    def test_index_summary_includes_rates_commodities_and_bitcoin(self):
        rows = [
            {'symbol': symbol, 'chart': [
                {'date': '2026-08-10', 'close': 100},
                {'date': '2026-08-14', 'close': 110},
            ]}
            for symbol in ('US10Y', 'WTI', 'GOLD', 'BTC')
        ]
        result = weekly_report.index_summary(rows, datetime(2026, 8, 10).date(), datetime(2026, 8, 14).date())
        self.assertEqual([item['name'] for item in result], ['미국 10년 국채', 'WTI 원유', '금 선물', '비트코인'])
        self.assertEqual([item['valueType'] for item in result], ['yield', 'usd', 'usd', 'krw'])

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

    def test_hot_stocks_rotates_across_rank_buckets(self):
        result = weekly_report.hot_stocks({'sections': {
            'rising': [{'code': 'A', 'name': '상승', 'change_rate': 5}],
            'falling': [{'code': 'B', 'name': '하락', 'change_rate': -4}],
            'volumeGrowth': [{'code': 'C', 'name': '거래량', 'change_rate': 1}],
        }}, limit=3)
        self.assertEqual([item['code'] for item in result], ['A', 'C'])

    def test_cold_stocks_prefers_liquid_negative_names_and_adds_reason(self):
        result = weekly_report.cold_stocks({'sections': {
            'falling': [
                {'code': 'SMALL', 'name': '소형주', 'change_rate': -9, 'market_cap': 1, 'trade_amount': 2},
                {'code': 'LARGE', 'name': '대형주', 'change_rate': -3, 'market_cap': 100000, 'trade_amount': 50000},
            ],
        }}, limit=1)
        self.assertEqual(result[0]['code'], 'LARGE')
        self.assertIn('하락률 상위', result[0]['reason'])

    def test_candidate_stocks_require_direction_and_independent_signal(self):
        board = {'sections': {
            'rising': [
                {'code': 'A', 'name': '상승만', 'change_rate': 6},
                {'code': 'B', 'name': '거래량동반', 'change_rate': 3},
            ],
            'volumeGrowth': [
                {'code': 'B', 'name': '거래량동반', 'change_rate': 3},
                {'code': 'C', 'name': '상승아님', 'change_rate': -1},
            ],
            'tradeAmount': [
                {'code': 'B', 'name': '거래량동반', 'change_rate': 3},
            ],
        }}
        result = weekly_report.candidate_stocks(board, limit=5)
        self.assertEqual([item['code'] for item in result], ['B'])
        self.assertIn('거래량 증가', result[0]['reason'])
        self.assertEqual(result[0]['signalCount'], 3)

    def test_cold_candidates_require_falling_and_liquidity_signal(self):
        board = {'sections': {
            'falling': [
                {'code': 'A', 'name': '하락만', 'change_rate': -6},
                {'code': 'B', 'name': '거래대금동반', 'change_rate': -3},
            ],
            'tradeAmount': [
                {'code': 'B', 'name': '거래대금동반', 'change_rate': -3},
            ],
        }}
        result = weekly_report.candidate_stocks(board, cold=True, limit=5)
        self.assertEqual([item['code'] for item in result], ['B'])
        self.assertIn('하락률 상위', result[0]['reason'])

    def test_fx_analysis_classifies_one_year_upper_range(self):
        row = {'symbol': 'USDKRW', 'price': 1418.5, 'chart': [
            {'date': '2025-09-01', 'close': 1200},
            {'date': '2026-01-01', 'close': 1300},
            {'date': '2026-08-14', 'close': 1418.5},
        ]}
        result = weekly_report.fx_analysis(row)
        self.assertEqual(result['analysis']['status'], 'caution')
        self.assertEqual(result['analysis']['current'], 1418.5)

    def test_news_timeline_is_merged_and_week_bounded(self):
        result = weekly_report.news_timeline([
            {'title': '한국 뉴스', 'pubDate': '2026-08-14T09:00:00+09:00'},
            {'title': '지난 뉴스', 'pubDate': '2026-08-07T09:00:00+09:00'},
        ], [
            {'title': '미국 뉴스', 'pubDate': '2026-08-13T09:00:00+09:00'},
        ], datetime(2026, 8, 10).date(), datetime(2026, 8, 14).date())
        self.assertEqual([item['title'] for item in result], ['한국 뉴스', '미국 뉴스'])
        self.assertEqual([item['market'] for item in result], ['한국', '미국'])

    def test_news_timeline_accepts_rfc822_dates(self):
        result = weekly_report.news_timeline([
            {'title': '한국 RFC 뉴스', 'pubDate': 'Fri, 14 Aug 2026 09:00:00 +0900'},
        ], [], datetime(2026, 8, 10).date(), datetime(2026, 8, 14).date())
        self.assertEqual(len(result), 1)

    def test_news_timeline_spreads_articles_across_weekdays(self):
        domestic = [
            {'title': '금요일 주요 뉴스 %d' % index, 'pubDate': '2026-08-14T%02d:00:00+09:00' % (9 + index)}
            for index in range(10)
        ] + [
            {'title': '월요일 주요 뉴스', 'pubDate': '2026-08-10T09:00:00+09:00'},
        ]
        result = weekly_report.news_timeline(
            domestic, [], datetime(2026, 8, 10).date(), datetime(2026, 8, 14).date(), limit=6,
        )
        self.assertIn('월요일 주요 뉴스', [item['title'] for item in result])

    def test_report_news_basis_does_not_claim_view_counts(self):
        result = weekly_report.build_report(
            datetime(2026, 8, 10).date(), datetime(2026, 8, 14).date(),
            futures_rows=[], domestic_news_items=[], foreign_news_items=[],
        )
        self.assertIn('조회수 미제공', result['news']['basis'])

    def test_next_week_schedule_filters_outside_window(self):
        result = weekly_report.next_week_schedule([
            {'start': '2026-08-17', 'title': '$AAPL 실적발표', 'symbol': 'AAPL'},
            {'start': '2026-08-24', 'title': '다음 주 아님'},
        ], datetime(2026, 8, 10).date(), datetime(2026, 8, 14).date())
        self.assertEqual([item['title'] for item in result], ['$AAPL 실적발표'])

    # 2026-08-22 신설(작업지시서: 지난 스윙 추천 결과 "기록 공유") -----------------------

    def test_past_candidate_outcomes_formats_and_limits_rows(self):
        rows = [
            {'asOfDate': '2026-08-10', 'code': '005930', 'name': '삼성전자',
             'entryOpinion': '눌림목 매수 후보', 't5ReturnPct': 2.5, 't10ReturnPct': None},
            {'asOfDate': '2026-08-05', 'code': '000660', 'name': 'SK하이닉스',
             'entryOpinion': '초기 매수 후보', 't5ReturnPct': -1.2, 't10ReturnPct': 3.4},
        ]
        result = weekly_report.past_candidate_outcomes(rows, limit=1)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['code'], '005930')
        self.assertEqual(result[0]['t5ReturnPct'], 2.5)
        self.assertIsNone(result[0]['t10ReturnPct'])

    def test_past_candidate_outcomes_empty_when_no_rows(self):
        self.assertEqual(weekly_report.past_candidate_outcomes(None), [])
        self.assertEqual(weekly_report.past_candidate_outcomes([]), [])

    def test_build_report_includes_past_candidate_outcomes(self):
        rows = [{'asOfDate': '2026-08-10', 'code': '005930', 'name': '삼성전자',
                  'entryOpinion': '눌림목 매수 후보', 't5ReturnPct': 2.5, 't10ReturnPct': 4.1}]
        result = weekly_report.build_report(
            datetime(2026, 8, 10).date(), datetime(2026, 8, 14).date(),
            futures_rows=[], domestic_news_items=[], foreign_news_items=[],
            past_swing_outcomes=rows,
        )
        self.assertEqual(result['pastCandidateOutcomes']['domestic'], [
            {'asOfDate': '2026-08-10', 'code': '005930', 'name': '삼성전자',
             'entryOpinion': '눌림목 매수 후보', 't5ReturnPct': 2.5, 't10ReturnPct': 4.1},
        ])
        self.assertIn('basis', result['pastCandidateOutcomes'])


if __name__ == '__main__':
    unittest.main()
