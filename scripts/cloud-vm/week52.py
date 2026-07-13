# -*- coding: utf-8 -*-
"""52주(약 250영업일) 신고가/신저가 판정 - 순수 계산 함수.
daily: kiwoom_market.fetch_daily_ohlc() 결과(오름차순 날짜, {date,open,high,low,close,volume})."""

WEEK52_TRADING_DAYS = 250


def compute_week52(daily):
    if not daily:
        return None
    window = daily[-WEEK52_TRADING_DAYS:] if len(daily) > WEEK52_TRADING_DAYS else daily
    highs = [d['high'] for d in window if d.get('high')]
    lows = [d['low'] for d in window if d.get('low')]
    if not highs or not lows:
        return None

    high52w = max(highs)
    low52w = min(lows)
    today_close = window[-1]['close']

    return {
        'high52w': high52w,
        'low52w': low52w,
        'isNewHigh': today_close >= high52w,
        'isNewLow': today_close <= low52w,
    }
