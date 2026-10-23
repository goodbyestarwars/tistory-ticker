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


# ---- 거래소 캘린더(2026-10-23, 시장 브리핑·장중 갱신 분리) -------------------------------------------
# 한국: 휴장일 표는 market_temp.KRX_HOLIDAYS_2026 하나다. 정규장은 평소 09:00~15:30이고, 수능일처럼
# 개장이 늦춰진 날만 아래 표에 둔다(개장·마감이 모두 1시간씩 늦다). 표에 없는 날은 평소 시간이다.
KR_OPEN_MIN = 9 * 60
KR_CLOSE_MIN = 15 * 60 + 30
KR_SPECIAL_SESSIONS = {
    '2026-11-19': (10 * 60, 16 * 60 + 30),   # 2027학년도 대학수학능력시험일 - 해마다 교육부 공고로 확인한다
}
# 마감 뒤 늦게 확정되는 자료(투자자 수급 15:40 등)를 위해 마감 후 이 시간까지만 후속 갱신을 허용한다.
KR_POST_CLOSE_MIN = 60

# 미국(NYSE) 휴장일. js/skin-shell.js MarketHours.US_HOLIDAYS_2026과 같은 표다(해가 바뀌면 둘을 같이 갱신).
US_HOLIDAYS_2026 = {
    '2026-01-01': '신정', '2026-01-19': '마틴 루터 킹 데이', '2026-02-16': '대통령의 날',
    '2026-04-03': '성금요일', '2026-05-25': '메모리얼 데이', '2026-06-19': '준틴스',
    '2026-07-03': '독립기념일(7/4 대체)', '2026-09-07': '노동절',
    '2026-11-26': '추수감사절', '2026-12-25': '성탄절',
}


def kr_session_minutes(day):
    """(개장, 마감) 분(KST 자정 기준). day는 date 또는 'YYYY-MM-DD'."""
    key = day if isinstance(day, str) else day.strftime('%Y-%m-%d')
    return KR_SPECIAL_SESSIONS.get(key, (KR_OPEN_MIN, KR_CLOSE_MIN))


def kr_market_phase(now_kst=None):
    """국내 정규장 기준 현재 단계.

    phase: 'holiday'(휴장일) / 'pre'(개장 전) / 'open'(정규장) / 'post'(마감 후 후속 갱신 구간)
           / 'closed'(그 이후). open_min·close_min은 그날의 실제 개장·마감 분이다.
    """
    now_kst = now_kst or kst_now()
    if not is_kr_trading_day(now_kst):
        return {'phase': 'holiday', 'tradingDay': False, 'openMin': KR_OPEN_MIN, 'closeMin': KR_CLOSE_MIN}
    open_min, close_min = kr_session_minutes(now_kst)
    minutes = now_kst.hour * 60 + now_kst.minute
    if minutes < open_min:
        phase = 'pre'
    elif minutes < close_min:
        phase = 'open'
    elif minutes < close_min + KR_POST_CLOSE_MIN:
        phase = 'post'
    else:
        phase = 'closed'
    return {'phase': phase, 'tradingDay': True, 'openMin': open_min, 'closeMin': close_min}


def next_kr_trading_day(day, include_today=False):
    """day(date) 이후 첫 국내 거래일(date). include_today면 day 자신도 후보."""
    d = day if include_today else day + timedelta(days=1)
    for _ in range(400):
        if is_kr_trading_day(datetime(d.year, d.month, d.day, tzinfo=KST)):
            return d
        d += timedelta(days=1)
    return d


def prev_kr_trading_day(day):
    d = day - timedelta(days=1)
    for _ in range(400):
        if is_kr_trading_day(datetime(d.year, d.month, d.day, tzinfo=KST)):
            return d
        d -= timedelta(days=1)
    return d


def is_us_trading_day(day):
    """미국 현지 날짜 기준. 표에 없는 해는 주말만 걸러진다(보수적으로 거래일)."""
    return day.weekday() < 5 and day.strftime('%Y-%m-%d') not in US_HOLIDAYS_2026


def us_session_before_kr_day(target):
    """한국 거래일 target의 장 시작 전(KST 07:00)에 이미 끝나 있는 가장 최근 미국 정규장 날짜.

    KST 07:00은 뉴욕 전날 17~18시라 target의 전날(달력)이 미국의 '어제'다. 그날이 주말·휴장이면 거슬러 올라간다.
    반환: (미국 세션 date, 건너뛴 미국 휴장일 [(date, 이름)]).
    """
    d = target - timedelta(days=1)
    skipped = []
    for _ in range(14):
        if is_us_trading_day(d):
            return d, skipped
        name = US_HOLIDAYS_2026.get(d.strftime('%Y-%m-%d'))
        if name:
            skipped.append((d, name))
        d -= timedelta(days=1)
    return d, skipped
