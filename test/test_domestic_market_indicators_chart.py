# -*- coding: utf-8 -*-
"""코스피/코스닥 차트 소스 회귀 테스트.

2026-09-01 사용자 리포트로 두 가지가 드러났다:
1. 분봉 탭이 빈 화면 - KIS inquire-index-timeprice가 당일 장중만 주는 API라
   장 종료 후엔 빈 응답이었다. 네이버 폴백을 붙였다.
2. 그 폴백을 붙이려다 `_fetch_naver`가 **원래부터 깨져 있던 것**을 발견했다.
   네이버 fetch 함수들은 이미 open/high/low/close로 정규화해 주는데 `_sort_rows()`는
   공급자 원본 필드명(open_pric/stck_oprc/openPrice)을 찾아서 전 행이 버려졌다.
   KIS 단일 소스로 바뀐 뒤 이 경로가 안 쓰여 드러나지 않았다.
"""
import os
import sys
import unittest

CLOUD_VM_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
if CLOUD_VM_DIR not in sys.path:
    sys.path.insert(0, CLOUD_VM_DIR)

import domestic_market_indicators as dmi  # noqa: E402


class SortNormalisedTest(unittest.TestCase):
    """네이버가 주는 '이미 정규화된' 행을 그대로 살려야 한다."""

    def test_keeps_already_normalised_minute_rows(self):
        rows = [
            {'ts': 100, 'open': 1.0, 'high': 2.0, 'low': 0.5, 'close': 1.5},
            {'ts': 200, 'open': 1.5, 'high': 2.5, 'low': 1.0, 'close': 2.0},
        ]
        got = dmi._sort_normalised(rows, 'ts', 600)
        self.assertEqual(len(got), 2, '정규화된 행이 버려지면 안 된다')
        self.assertEqual(got[0]['close'], 1.5)
        self.assertEqual(got[0]['volume'], 0, 'volume 누락 시 0으로 채운다')

    def test_normalises_naver_date_format_to_match_kis(self):
        """네이버는 '20260831', KIS 경로는 '2026-08-31'. 안 맞추면 since_date 비교와
        주봉 집계 strptime이 깨진다."""
        rows = [{'date': '20260831', 'open': 1, 'high': 2, 'low': 0, 'close': 1}]
        got = dmi._sort_normalised(rows, 'date', 600)
        self.assertEqual(got[0]['date'], '2026-08-31')

    def test_since_date_filter_uses_normalised_form(self):
        rows = [
            {'date': '20260101', 'open': 1, 'high': 1, 'low': 1, 'close': 1},
            {'date': '20260831', 'open': 2, 'high': 2, 'low': 2, 'close': 2},
        ]
        got = dmi._sort_normalised(rows, 'date', 600, since_date='2026-06-01')
        self.assertEqual([g['date'] for g in got], ['2026-08-31'])

    def test_rows_are_deduped_and_sorted(self):
        rows = [
            {'ts': 200, 'open': 1, 'high': 1, 'low': 1, 'close': 2},
            {'ts': 100, 'open': 1, 'high': 1, 'low': 1, 'close': 1},
            {'ts': 200, 'open': 1, 'high': 1, 'low': 1, 'close': 9},   # 같은 ts는 뒤엣것
        ]
        got = dmi._sort_normalised(rows, 'ts', 600)
        self.assertEqual([g['ts'] for g in got], [100, 200])
        self.assertEqual(got[-1]['close'], 9)


class MinuteFallbackContractTest(unittest.TestCase):
    def test_minute_falls_back_to_naver_but_daily_stays_kis_only(self):
        """KIS가 24시간 정상인 일봉·주봉은 단일 소스를 유지해 숫자 일관성을 지킨다."""
        with open(os.path.join(CLOUD_VM_DIR, 'domestic_market_indicators.py'),
                  encoding='utf-8') as fh:
            src = fh.read()
        start = src.index('def fetch_chart(')
        end = src.index('def _fetch_minute_via_naver')
        body = src[start:end]
        self.assertIn("if interval == 'minute':", body)
        self.assertIn('_fetch_minute_via_naver', body)
        # 일봉/주봉 실패 경로에는 폴백이 없어야 한다.
        self.assertIn("return {'source': 'kis', 'rows': [], 'errors': ['kis: %s' % exc]}", body)

    def test_fallback_reports_which_source_was_used(self):
        with open(os.path.join(CLOUD_VM_DIR, 'domestic_market_indicators.py'),
                  encoding='utf-8') as fh:
            src = fh.read()
        self.assertIn("'source': 'naver'", src, '어느 소스가 쓰였는지 응답으로 알 수 있어야 한다')


if __name__ == '__main__':
    unittest.main()
