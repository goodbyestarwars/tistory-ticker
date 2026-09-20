# -*- coding: utf-8 -*-
"""휴장일 종목판 차단은 시장별로 한다(2026-09-21 검토에서 발견).

들어올 때 코드는 시장을 안 가리고 `market_clock.skip_scan_today()` 하나만 봤다. 그 함수는
`is_kr_trading_day()` - **한국 달력**이다. 그래서 개천절·한글날처럼 한국만 쉬는 날에
`/market-board?market=us`까지 막혔다. 미국장은 정상 개장인데 화면이 빈다.

두 번째 문제: 캐시가 없으면 `rows: []`를 내보냈다. 이 캐시는 프로세스 메모리라 배포
(=재시작)마다 날아가는데, 하필 그날이 휴장일이면 종목판이 통째로 빈 채로 남는다.
"""

import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))
os.environ.setdefault('API_TOKEN', 'test')

import main  # noqa: E402
import us_stocks  # noqa: E402

KST = timezone(timedelta(hours=9))


def at_ny(text):
    """뉴욕 시계로 고정한 가짜 datetime.now를 심는다."""
    fixed = datetime.strptime(text, '%Y-%m-%d %H:%M').replace(tzinfo=us_stocks.NY_TZ)

    class FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed if tz is not None else fixed.replace(tzinfo=None)

    return mock.patch.object(main, 'datetime', FakeDatetime)


def kr_holiday(is_holiday):
    return mock.patch.object(main.market_clock, 'skip_scan_today',
                             return_value=(is_holiday, '2026-10-03'))


class KoreanHolidayDoesNotCloseTheUsBoardTest(unittest.TestCase):
    """이게 이번 수정의 핵심이다."""

    def test_korean_holiday_closes_only_the_domestic_board(self):
        # 2026-10-03 개천절(금). 미국장은 그날 정상 개장한다.
        with kr_holiday(True), at_ny('2026-10-02 10:00'):
            self.assertTrue(main._market_board_closed_today('domestic'))
            self.assertFalse(main._market_board_closed_today('us'),
                             '한국 공휴일에 미국 종목판을 막으면 안 된다')

    def test_hangul_day_too(self):
        with kr_holiday(True), at_ny('2026-10-09 10:00'):
            self.assertFalse(main._market_board_closed_today('us'))

    def test_weekend_closes_both(self):
        with kr_holiday(True), at_ny('2026-10-03 10:00'):  # 토요일
            self.assertTrue(main._market_board_closed_today('domestic'))
            self.assertTrue(main._market_board_closed_today('us'))

    def test_a_normal_weekday_closes_neither(self):
        with kr_holiday(False), at_ny('2026-09-21 10:00'):  # 월요일
            self.assertFalse(main._market_board_closed_today('domestic'))
            self.assertFalse(main._market_board_closed_today('us'))

    def test_us_stays_open_all_day_outside_trading_hours(self):
        """이 함수는 "하루 통째로 쉬는가"만 답한다 - 새벽이라고 닫힌 게 아니다."""
        with kr_holiday(False), at_ny('2026-09-21 03:00'):
            self.assertFalse(main._market_board_closed_today('us'))

    def test_default_argument_keeps_the_domestic_meaning(self):
        with kr_holiday(True), at_ny('2026-10-02 10:00'):
            self.assertTrue(main._market_board_closed_today())

    def test_a_broken_calendar_never_blocks_the_board(self):
        """휴장 판정이 깨지면 화면을 막는 쪽이 아니라 평소 경로로 간다."""
        with mock.patch.object(main.market_clock, 'skip_scan_today',
                               side_effect=RuntimeError('달력 깨짐')):
            self.assertFalse(main._market_board_closed_today('domestic'))


class EmptyCacheFallsThroughTest(unittest.TestCase):
    """휴장일에 캐시가 비어 있으면 빈 화면 대신 한 번 조회해서 채운다."""

    def test_the_gate_requires_a_cached_payload(self):
        source = main.__file__.replace('.pyc', '.py')
        with open(source, encoding='utf-8') as handle:
            src = handle.read()
        self.assertIn(
            "if _market_board_closed_today(market) and _market_board_cache.get(key) is not None:",
            src)
        # 빈 rows를 만들어 내보내던 경로가 남아 있으면 안 된다.
        self.assertNotIn("'source': '휴장일 - 외부 조회 생략'", src)
        self.assertNotIn("'session': '휴장'", src)


if __name__ == '__main__':
    unittest.main()
