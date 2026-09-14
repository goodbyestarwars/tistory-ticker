# -*- coding: utf-8 -*-
"""KIS 실시간 등록 자리에 못 들어간 국내 종목을 REST 통합 시세로 채운다.

2026-09-14 사용자 지적("지금도 구분이 안되어 있잖아?"). KIS WebSocket 세션 하나에 등록할 수
있는 자리가 40개라, 종목이 많은 페이지(국내 주요종목 카드 등)는 일부 종목이 실시간에서
빠졌다(라이브 `droppedCount` 53). 그런데 화면은 그 사실을 몰라, 멈춘 가격이 실시간처럼 보였고
국내 주요종목 카드는 소켓이 열린 동안 아예 갱신되지 않았다.

이 모듈은 브라우저 중계(`realtime_quotes`)가 "허브에 등록되지 못한 종목"을 알려주면 그 종목만
주식현재가 시세(FHKST01010100, 시장 `UN`=KRX+NXT 통합)로 주기 조회해 둔다. 중계는 이 값을
평소 체결과 같은 `quote` 메시지에 `delayed: true`를 붙여 보내므로, 화면은 기존 갱신 경로를 그대로
쓰면서 "지연" 표시만 더하면 된다. KIS WebSocket이 통째로 끊기면 모든 종목이 여기로 넘어온다.

응답 필드(stck_prpr·prdy_vrss·prdy_vrss_sign·prdy_ctrt·acml_vol)는 KIS 공식 예제
`open-trading-api/examples_llm/domestic_stock/inquire_price/chk_inquire_price.py` 컬럼 목록 기준이다.
부호 코드(1 상한·2 상승·3 보합·4 하한·5 하락)는 KIS 전일 대비 부호 관례를 따른다.
여러 방문자가 같은 종목을 원해도 서버 전체에서 한 번만 조회한다.
"""

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import kis_client

logger = logging.getLogger('rest_quote_fallback')

KST = timezone(timedelta(hours=9))
SESSION_INTERVAL_SEC = 15
OFF_SESSION_INTERVAL_SEC = 600
MAX_CODES_PER_CYCLE = 60
WORKERS = 4
_LOOP_SLEEP_SEC = 1.0

_SIGN = {'1': 1, '2': 1, '3': 0, '4': -1, '5': -1}


def _number(value):
    if value in (None, ''):
        return None
    try:
        return float(str(value).replace(',', '').strip())
    except ValueError:
        return None


def quote_event(code, raw, fetched_at):
    """KIS 현재가 응답을 실시간 중계의 quote 메시지 모양으로 바꾼다."""
    if not isinstance(raw, dict):
        return None
    price = _number(raw.get('stck_prpr'))
    if not price:
        return None
    change = _number(raw.get('prdy_vrss'))
    rate = _number(raw.get('prdy_ctrt'))
    sign = _SIGN.get(str(raw.get('prdy_vrss_sign') or '').strip())
    if sign is not None:
        change = abs(change) * sign if change is not None else None
        rate = abs(rate) * sign if rate is not None else None
    return {
        'type': 'quote',
        'code': code,
        'price': abs(price),
        'change': change,
        'changeRate': rate,
        'volume': _number(raw.get('acml_vol')),
        'source': 'KIS REST',
        'delayed': True,
        'fetchedAt': fetched_at,
    }


def in_session(now_kst):
    """NXT 프리마켓(08:00)부터 KRX 애프터마켓·NXT 마감(20:00) 직후까지의 평일."""
    if now_kst.weekday() >= 5:
        return False
    minutes = now_kst.hour * 60 + now_kst.minute
    return 7 * 60 + 55 <= minutes <= 20 * 60 + 5


class RestQuoteFallback:
    def __init__(self, fetch, clock=time.time, now_kst=lambda: datetime.now(KST),
                 max_codes=MAX_CODES_PER_CYCLE, workers=WORKERS):
        self._fetch = fetch
        self._clock = clock
        self._now_kst = now_kst
        self.max_codes = max_codes
        self._workers = workers
        self._lock = threading.Lock()
        self._wanted = {}
        self._latest = {}
        self._fetched_at = {}
        self._thread = None
        self._running = False

    def want(self, codes):
        with self._lock:
            for code in codes:
                self._wanted[code] = self._wanted.get(code, 0) + 1

    def release(self, codes):
        with self._lock:
            for code in codes:
                left = self._wanted.get(code, 0) - 1
                if left > 0:
                    self._wanted[code] = left
                else:
                    self._wanted.pop(code, None)

    def wanted_codes(self):
        with self._lock:
            return sorted(self._wanted)

    def latest(self, code):
        with self._lock:
            return self._latest.get(code)

    def due_codes(self):
        interval = SESSION_INTERVAL_SEC if in_session(self._now_kst()) else OFF_SESSION_INTERVAL_SEC
        now = self._clock()
        with self._lock:
            due = [code for code in self._wanted
                   if now - self._fetched_at.get(code, 0) >= interval]
            # 가장 오래 못 받은 종목부터. 한 주기 상한을 넘으면 다음 주기로 넘긴다.
            due.sort(key=lambda code: self._fetched_at.get(code, 0))
        return due[:self.max_codes]

    def _fetch_one(self, code):
        started = self._clock()
        try:
            event = quote_event(code, self._fetch(code), started)
        except Exception as exc:
            logger.info('REST 통합 시세 실패(%s): %s', code, exc)
            event = None
        with self._lock:
            self._fetched_at[code] = started
            if event is not None:
                self._latest[code] = event
        return event

    def poll_once(self, pool=None):
        codes = self.due_codes()
        if not codes:
            return 0
        if pool is None:
            for code in codes:
                self._fetch_one(code)
        else:
            list(pool.map(self._fetch_one, codes))
        return len(codes)

    def start(self):
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return self
            self._running = True
            self._thread = threading.Thread(target=self._loop, name='rest-quote-fallback', daemon=True)
            self._thread.start()
        return self

    def _loop(self):
        with ThreadPoolExecutor(max_workers=self._workers) as pool:
            while self._running:
                try:
                    self.poll_once(pool)
                except Exception:
                    logger.exception('REST 통합 시세 폴백 주기 실패')
                time.sleep(_LOOP_SLEEP_SEC)

    def stop(self):
        self._running = False


_instance = None
_instance_lock = threading.Lock()


def start(appkey, appsecret):
    """프로세스 공용 폴백을 시작한다(여러 번 불러도 하나)."""
    global _instance
    if not appkey or not appsecret:
        return None

    def fetch(code):
        token = kis_client.get_token(appkey, appsecret)
        return kis_client.fetch_domestic_quote(token, appkey, appsecret, code, market='UN')

    with _instance_lock:
        if _instance is None:
            _instance = RestQuoteFallback(fetch)
        instance = _instance
    return instance.start()
