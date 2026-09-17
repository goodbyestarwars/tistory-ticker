# -*- coding: utf-8 -*-
"""미국 시세가 '어느 장 기준'인지(2026-09-17 사용자 지적).

> 미국장 인텔 기준으로 아직도 4%대 상승인데? 이거 어제 기준 같은데?

맞는 지적이었다. 한국 낮 12:40은 뉴욕 수요일 밤 23:40이라 정규장이 7시간 전에 끝나 있다.
값이 안 변하는 게 정상인데, 화면이 조회 시각(`updated_at`)을 한국시간으로 찍고 "15초 자동
갱신"이라고 적어서 수요일 종가를 방금 시세처럼 읽게 만들었다.

`session_date`를 응답에 넣어 화면이 "9/16(수) 미국장 마지막 체결가 기준"으로 말할 수 있게 했다.
KIS 현재가상세 응답에는 체결 날짜가 없어 뉴욕 시각으로 유추한다(공휴일 미반영 - 여기서 더
정확한 척하지 않는다).

us_stocks.py는 무거운 이웃을 임포트하므로 해당 함수만 떼어 실행한다.
"""

import io
import os
import unittest
from datetime import datetime, timedelta, time as datetime_time

try:
    from zoneinfo import ZoneInfo
    NY_TZ = ZoneInfo('America/New_York')
except Exception:  # tzdata가 없는 환경
    NY_TZ = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, 'scripts', 'cloud-vm', 'us_stocks.py')
FRONT = os.path.join(ROOT, 'js', 'us-stocks.js')


def read(path):
    with io.open(path, encoding='utf-8') as handle:
        return handle.read()


def load_funcs():
    text = read(SOURCE)
    start = text.index('def _market_state(')
    end = text.index('def _normalize_quote(')
    namespace = {'datetime': datetime, 'timedelta': timedelta,
                 'datetime_time': datetime_time, 'NY_TZ': NY_TZ}
    exec(compile(text[start:end], SOURCE, 'exec'), namespace)  # noqa: S102
    return namespace


@unittest.skipUnless(NY_TZ, 'tzdata가 있어야 뉴욕 시각을 계산할 수 있다')
class SessionDateTest(unittest.TestCase):
    def setUp(self):
        self.session_date = load_funcs()['_session_date']
        self.market_state = load_funcs()['_market_state']

    def ny(self, y, m, d, hh, mm=0):
        return datetime(y, m, d, hh, mm, tzinfo=NY_TZ)

    def test_after_hours_still_counts_as_today(self):
        """애프터마켓이 끝난 뒤(20:00 ET~자정)의 시세는 그날 장 기준이다."""
        self.assertEqual(self.session_date(self.ny(2026, 9, 16, 23, 41)), '2026-09-16')

    def test_korean_lunchtime_maps_to_the_previous_us_session(self):
        """사용자가 본 그 시각. 한국 9/17 12:41 = 뉴욕 9/16(수) 23:41 -> 9/16 장 기준."""
        when = self.ny(2026, 9, 16, 23, 41)
        self.assertEqual(self.session_date(when), '2026-09-16')
        self.assertEqual(self.market_state(when), 'closed')

    def test_before_premarket_falls_back_to_the_previous_weekday(self):
        """자정~04:00 ET는 아직 새 장이 안 열렸다 - 어제 장이 마지막이다."""
        self.assertEqual(self.session_date(self.ny(2026, 9, 17, 2, 0)), '2026-09-16')

    def test_open_sessions_use_today(self):
        for hour, expected_state in ((5, 'pre'), (10, 'regular'), (17, 'post')):
            with self.subTest(hour=hour):
                when = self.ny(2026, 9, 17, hour)
                self.assertEqual(self.session_date(when), '2026-09-17')
                self.assertEqual(self.market_state(when), expected_state)

    def test_weekend_falls_back_to_friday(self):
        self.assertEqual(self.session_date(self.ny(2026, 9, 19, 12)), '2026-09-18')  # 토
        self.assertEqual(self.session_date(self.ny(2026, 9, 20, 12)), '2026-09-18')  # 일

    def test_monday_dawn_falls_back_to_friday(self):
        self.assertEqual(self.session_date(self.ny(2026, 9, 21, 2)), '2026-09-18')


class ResponseContractTest(unittest.TestCase):
    def test_quote_carries_the_session_date(self):
        self.assertIn("'session_date': _session_date(),", read(SOURCE))


class FrontendContractTest(unittest.TestCase):
    """장이 닫혀 있으면 조회 시각 대신 기준 장을 보여준다."""

    def setUp(self):
        self.js = read(FRONT)

    def test_auto_refresh_text_is_not_hardcoded_anymore(self):
        # 예전에는 상태와 무관하게 항상 "15초 자동 갱신"이라고 적혀 있었다.
        self.assertNotIn('<span data-us-state></span> · 15초 자동 갱신', self.js)
        self.assertIn('data-us-basis', self.js)

    def test_closed_market_shows_the_session_instead_of_query_time(self):
        start = self.js.index('function updatedLabel(')
        body = self.js[start:self.js.index('function marketStateLabel(', start)]
        self.assertIn('session_date', body)
        self.assertIn('장 마감', body)

    def test_no_date_means_no_invented_label(self):
        """날짜를 못 만들면 없는 말을 지어내지 않는다."""
        start = self.js.index('function basisLabel(')
        body = self.js[start:self.js.index('function updatedLabel(', start)]
        self.assertIn('마지막 체결가 기준', body)
        # 날짜가 있을 때만 날짜를 붙인다.
        self.assertIn('when ?', body)


if __name__ == '__main__':
    unittest.main()
