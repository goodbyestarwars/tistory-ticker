# -*- coding: utf-8 -*-
"""52주(약 250영업일) 신고가/신저가 판정 - 순수 계산 함수.
daily: kiwoom_market.fetch_daily_ohlc() 결과(오름차순 날짜, {date,open,high,low,close,volume}).
종가(close) 기준으로 판정한다(장중 고가/저가 기준 아님) - 장중 고가로 판정하면 오늘 종가가
바로 그날 장중 고점과 정확히 같아야만 신고가로 잡혀서 지나치게 엄격해짐(과거 어느 날의
장중 고가라도 오늘 종가보다 조금이라도 높으면 매번 걸림)."""

WEEK52_TRADING_DAYS = 250


def compute_week52(daily):
    if not daily:
        return None
    window = daily[-WEEK52_TRADING_DAYS:] if len(daily) > WEEK52_TRADING_DAYS else daily
    closes = [d['close'] for d in window if d.get('close')]
    if not closes:
        return None

    high52w = max(closes)
    low52w = min(closes)
    today_close = window[-1]['close']

    return {
        'high52w': high52w,
        'low52w': low52w,
        'isNewHigh': today_close >= high52w,
        'isNewLow': today_close <= low52w,
    }
