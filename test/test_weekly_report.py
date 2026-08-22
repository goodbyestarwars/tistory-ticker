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
        self.assertEqual(result['pastCandidateOutcomes']['stats'], {
            't5': {'count': 1, 'winRatePct': 100.0, 'avgReturnPct': 2.5},
            't10': {'count': 1, 'winRatePct': 100.0, 'avgReturnPct': 4.1},
        })

    # 2026-08-22(2차) 신설(사용자 요청: "지난 2주 추천 결과 리스트 위에 승률/평균수익률
    # 요약카드가 없다") - 목록(8건)과 별개로, 백엔드가 넉넉히 넘긴 전체 표본으로 계산한
    # 승률/평균수익률 요약카드 ------------------------------------------------------

    def test_horizon_stats_computes_win_rate_and_average(self):
        rows = [
            {'t5ReturnPct': 3.0}, {'t5ReturnPct': -1.0}, {'t5ReturnPct': 2.0},
        ]
        result = weekly_report._horizon_stats(rows, 't5ReturnPct')
        self.assertEqual(result['count'], 3)
        self.assertAlmostEqual(result['winRatePct'], round(2 / 3 * 100, 1))
        self.assertAlmostEqual(result['avgReturnPct'], round((3.0 - 1.0 + 2.0) / 3, 2))

    def test_horizon_stats_ignores_rows_missing_the_field(self):
        rows = [{'t5ReturnPct': 1.0}, {'t5ReturnPct': None}, {'other': 1}]
        result = weekly_report._horizon_stats(rows, 't5ReturnPct')
        self.assertEqual(result['count'], 1)

    def test_horizon_stats_none_when_no_samples(self):
        self.assertIsNone(weekly_report._horizon_stats([], 't5ReturnPct'))
        self.assertIsNone(weekly_report._horizon_stats(None, 't5ReturnPct'))
        self.assertIsNone(weekly_report._horizon_stats([{'t5ReturnPct': None}], 't5ReturnPct'))

    def test_past_candidate_outcome_stats_splits_t5_and_t10(self):
        rows = [
            {'t5ReturnPct': 2.0, 't10ReturnPct': None},
            {'t5ReturnPct': -1.0, 't10ReturnPct': 5.0},
        ]
        result = weekly_report.past_candidate_outcome_stats(rows)
        self.assertEqual(result['t5']['count'], 2)
        self.assertEqual(result['t10']['count'], 1)

    # 2026-08-22(2차) 신설(라이브 스크린샷 확인: "상승 추세 · 장기 국면 상승 추세 · 중기
    # 국면 상승 추세 · 단기 국면 상승 추세 · ..."처럼 8개 필드가 한 줄에 다 붙어 좁은
    # 목록 칸에서 문장 중간에 잘리고 반복돼 보이던 문제) -----------------------------

    def _candidate_assessment(self, diagnosis='상승 추세 내 단기 상방 변곡 · 확인 대기', recent_event_label=None):
        return {
            'waves': {
                'big': {'available': True, 'label': '상승 추세'},
                'mid': {'key': 'uptrend', 'label': '상승 추세'},
                'small': {'key': 'uptrend', 'label': '상승 추세'},
            },
            'risk': {'blocksEntry': False, 'state': '낮음'},
            'entryOpinion': '눌림목 매수 후보',
            'diagnosis': diagnosis,
            'recentEvent': {'label': recent_event_label} if recent_event_label else {},
            'momentum': {'state': '양호'},
            'fundamental': {'state': '양호'},
        }

    def test_swing_candidate_reason_keeps_only_diagnosis_by_default(self):
        result = weekly_report.swing_candidates({'candidates': [
            {'code': '005930', 'name': '삼성전자', 'swing': self._candidate_assessment()},
        ]})
        self.assertEqual(result[0]['reason'], '상승 추세 내 단기 상방 변곡 · 확인 대기')

    def test_swing_candidate_reason_appends_distinct_recent_event(self):
        result = weekly_report.swing_candidates({'candidates': [
            {'code': '005930', 'name': '삼성전자',
             'swing': self._candidate_assessment(recent_event_label='거래량 급증')},
        ]})
        self.assertEqual(result[0]['reason'], '상승 추세 내 단기 상방 변곡 · 확인 대기 · 거래량 급증')

    def test_swing_candidate_reason_does_not_repeat_wave_labels(self):
        result = weekly_report.swing_candidates({'candidates': [
            {'code': '005930', 'name': '삼성전자', 'swing': self._candidate_assessment()},
        ]})
        self.assertNotIn('장기 국면', result[0]['reason'])
        self.assertNotIn('중기 국면', result[0]['reason'])
        self.assertNotIn('단기 국면', result[0]['reason'])

    def test_past_candidate_outcome_stats_none_when_both_horizons_empty(self):
        rows = [{'t5ReturnPct': None, 't10ReturnPct': None}]
        self.assertIsNone(weekly_report.past_candidate_outcome_stats(rows))
        self.assertIsNone(weekly_report.past_candidate_outcome_stats(None))
        self.assertIsNone(weekly_report.past_candidate_outcome_stats([]))


if __name__ == '__main__':
    unittest.main()
