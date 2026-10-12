# -*- coding: utf-8 -*-
"""KRX 거래일 달력 (2026-10-12). 후보 생성·만료·모의 진입/청산·예약 실행이 같은 판정을 쓰도록 한 곳에 둔다.

휴장일 표는 운영 서버 `scripts/cloud-vm/market_temp.py: KRX_HOLIDAYS_2026` 하나만 쓴다(새 표를 따로 만들지 않는다).
표가 덮는 연도(KNOWN_YEARS)가 아닌 날짜, 또는 표를 읽지 못한 경우는 **거래일을 확정할 수 없다**고 보고
`CalendarUnknown` 을 올린다. 호출자는 이를 '진입 보류 + 오류 기록'으로 처리해야 한다(주말만 거르고 통과시키지 않는다).
"""
import os
import sys
from datetime import date, datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
_CLOUD = os.path.join(REPO, 'scripts', 'cloud-vm')
if _CLOUD not in sys.path:
    sys.path.insert(0, _CLOUD)

# 표가 검증된 연도. 새 해의 휴장일 표가 market_temp 에 들어가면 여기에도 추가한다.
KNOWN_YEARS = (2026,)


class CalendarUnknown(Exception):
    """휴장일 표가 없어 거래일 여부를 확정할 수 없다."""


def _holidays():
    try:
        import market_temp
        return frozenset(market_temp.KRX_HOLIDAYS_2026)
    except Exception as exc:     # 표를 못 읽으면 주말만으로 판정하지 않는다
        raise CalendarUnknown('KRX 휴장일 표를 읽지 못함: %s' % type(exc).__name__)


def _as_date(d):
    if isinstance(d, datetime):
        return d.date()
    if isinstance(d, date):
        return d
    return datetime.strptime(str(d)[:10], '%Y-%m-%d').date()


def is_trading_day(d):
    d = _as_date(d)
    if d.year not in KNOWN_YEARS:
        raise CalendarUnknown('%d년 휴장일 표가 없음' % d.year)
    if d.weekday() >= 5:
        return False
    return d.strftime('%Y-%m-%d') not in _holidays()


def next_trading_day(d):
    """d 다음 첫 거래일(date)."""
    d = _as_date(d) + timedelta(days=1)
    for _ in range(40):
        if is_trading_day(d):
            return d
        d += timedelta(days=1)
    raise CalendarUnknown('40일 안에 거래일을 찾지 못함')


def prev_trading_day(d):
    d = _as_date(d) - timedelta(days=1)
    for _ in range(40):
        if is_trading_day(d):
            return d
        d -= timedelta(days=1)
    raise CalendarUnknown('40일 안에 거래일을 찾지 못함')


def trading_days_between(a, b):
    """a 다음 날부터 b까지(포함) 거래일 수. a>=b 이면 0."""
    a, b = _as_date(a), _as_date(b)
    n, d = 0, a + timedelta(days=1)
    while d <= b:
        if is_trading_day(d):
            n += 1
        d += timedelta(days=1)
    return n
