# -*- coding: utf-8 -*-
"""백그라운드 수집기가 "지금 자주 돌 필요가 있는가"를 판단하는 공용 시계.

2026-09-15 사용자 지시("돈 쓰는 건 무리야. 다른 방법으로 서버 부하를 낮춰야해"). e2-micro(메모리 1GB)
위의 FastAPI 프로세스 안에서 국내시장지표(60초)·증시온도(3분)·투자자 동향(60초)·국내 선물(30초)이
장이 닫힌 밤·주말·휴장일에도 같은 주기로 외부 조회와 DB 쓰기를 반복하고 있었다. 장이 닫혀 있으면
값이 거의 바뀌지 않으므로 그 시간에는 느린 주기로 돈다.

한국 휴장일 표는 market_temp.KRX_HOLIDAYS_2026 하나만 쓴다(프론트 js/skin-shell.js와 같은 표).
"""

import os
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))

# 휴장일에도 스캔을 돌리고 싶을 때(수동 재실행·디버깅)만 '1'로 둔다.
SCAN_FORCE_ENV = 'KIWOOM_SCAN_FORCE'

# NXT 프리마켓(08:00) 조금 전부터 KRX 애프터마켓·NXT 마감(20:00) 직후까지.
KR_ACTIVE_START_MIN = 7 * 60 + 50
KR_ACTIVE_END_MIN = 20 * 60 + 10
# 장이 닫혔을 때 쓰는 느린 주기.
IDLE_SEC = 15 * 60


def kst_now():
    return datetime.now(KST)


def is_kr_trading_day(now_kst):
    import market_temp  # 휴장일 표의 단일 출처. 이미 프로세스에 올라와 있는 모듈이다.
    return market_temp.is_kr_trading_day(now_kst)


def skip_scan_today(now_kst=None):
    """휴장일(주말·공휴일)이면 (True, 'YYYY-MM-DD') - 스캔 스크립트가 시작하자마자 끝내는 데 쓴다.

    2026-09-16 사용자 지시("휴장은 쉬게 하자"). 스캔은 끝날 때 자기 몫의 결과를 통째로 덮어쓰므로
    (daily_scan.py 주석 "차트검색 캐시도 매일 덮어써서 이력이 없다"), 휴장일에 그냥 돌면 직전 거래일에
    잡힌 목록이 같은 데이터로 다시 계산되거나(주말) 비어버릴 수 있다(공휴일 - 순위 조회가 그날치를
    못 준다). 건너뛰면 화면은 직전 거래일 결과와 그때의 스캔 시각을 그대로 유지한다.
    """
    now_kst = now_kst or kst_now()
    if os.environ.get(SCAN_FORCE_ENV) == '1':
        return False, now_kst.strftime('%Y-%m-%d')
    return (not is_kr_trading_day(now_kst)), now_kst.strftime('%Y-%m-%d')


def kr_market_active(now_kst=None):
    """KRX 정규장·애프터마켓 또는 NXT가 열려 있을 수 있는 시간인가."""
    now_kst = now_kst or kst_now()
    if not is_kr_trading_day(now_kst):
        return False
    minutes = now_kst.hour * 60 + now_kst.minute
    return KR_ACTIVE_START_MIN <= minutes <= KR_ACTIVE_END_MIN


def us_futures_weekend_closed(now_kst=None):
    """미국 지수선물·원자재 선물이 주말로 닫혀 있는 시간인가(KST).

    CME Globex는 금요일 17:00 ET에 닫고 일요일 18:00 ET에 연다 - KST로는 토요일 06:00~07:00,
    월요일 07:00~08:00(서머타임 여부에 따라). 두 경우 모두 안전하게 닫힌 구간만 잡는다:
    토요일 08:00 ~ 월요일 06:00.
    """
    now_kst = now_kst or kst_now()
    weekday = now_kst.weekday()  # 월=0 ... 토=5, 일=6
    minutes = now_kst.hour * 60 + now_kst.minute
    if weekday == 5:
        return minutes >= 8 * 60
    if weekday == 6:
        return True
    if weekday == 0:
        return minutes < 6 * 60
    return False


def sleep_seconds(active, active_sec, idle_sec=IDLE_SEC):
    """활성 구간이면 원래 주기, 아니면 느린 주기(원래 주기보다 짧아지지는 않는다)."""
    return active_sec if active else max(active_sec, idle_sec)
