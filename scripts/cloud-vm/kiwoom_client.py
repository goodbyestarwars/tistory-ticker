# -*- coding: utf-8 -*-
"""키움증권 REST API 클라이언트 - 토큰 발급/캐싱 + TR 호출 공통 로직.
scripts/fetch_investor_flow.py의 get_token/call_tr 패턴을 그대로 재사용."""

import json
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

BASE_URL = 'https://api.kiwoom.com'
# 클라우드 VM의 urllib 기본 User-Agent(Python-urllib/x.x)는 WAF가 봇으로 차단하는 경우가 많아
# 일반 브라우저처럼 보이는 값으로 고정
COMMON_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
}

_token_lock = threading.Lock()
_token_cache = {'token': None, 'expires_at': 0}

KST = timezone(timedelta(hours=9))
# 만료 몇 초 전부터 새 토큰을 받을지.
TOKEN_REFRESH_MARGIN_SEC = 300
# 만료 정보를 전혀 못 읽었을 때의 보수적인 수명.
TOKEN_FALLBACK_TTL_SEC = 3600
# 키움이 "이 토큰 못 쓴다"고 답할 때의 코드.
TOKEN_INVALID_CODE = '8005'


def _expires_at_from(data, now):
    """토큰 응답에서 만료 시각(epoch)을 읽는다.

    키움은 `expires_in`(남은 초)이 아니라 `expires_dt`(KST 'YYYYMMDDHHMMSS')를 준다.
    예전 코드는 expires_in만 찾고 없으면 '지금부터 12시간'으로 가정했는데, 키움은
    같은 토큰을 모든 호출자에게 그대로 돌려준다(2026-09-17 실측: 연속 발급해도 문자열이
    같다). 그래서 우리가 토큰을 받는 시점에 이미 수명이 얼마 안 남아 있을 수 있고,
    그때 '12시간 유효'로 캐시하면 죽은 토큰을 반나절 동안 계속 쓴다.

    2026-09-17이 그 경우였다. API는 06:48 UTC에 토큰을 받아 18:48 UTC까지 쓸 생각이었는데
    실제 만료는 11:10 UTC였고, 11:31부터 실시간 WebSocket·국내 호가·미국주식이 모두
    8005(Token이 유효하지 않습니다)로 죽었다.
    """
    text = str(data.get('expires_dt') or '').strip()
    if len(text) == 14 and text.isdigit():
        try:
            return datetime.strptime(text, '%Y%m%d%H%M%S').replace(tzinfo=KST).timestamp()
        except ValueError:
            pass
    try:
        seconds = int(data.get('expires_in'))
    except (TypeError, ValueError):
        seconds = 0
    if seconds > 0:
        return now + seconds
    return now + TOKEN_FALLBACK_TTL_SEC


def is_token_invalid(payload):
    """응답이 '토큰이 유효하지 않다'인지 본다. REST 응답과 WebSocket LOGIN 응답이 같은 모양이다."""
    if not isinstance(payload, dict):
        return False
    if str(payload.get('return_code', '0')).strip() in ('0', ''):
        return False
    message = str(payload.get('return_msg') or '')
    return TOKEN_INVALID_CODE in message or 'Token이 유효하지 않습니다' in message


def invalidate_token(token=None):
    """키움이 토큰을 거부하면 캐시를 비워 다음 get_token()이 새로 받게 한다.

    만료 시각 계산이 어긋나거나 키움이 먼저 토큰을 끊으면, 캐시가 스스로 만료될 때까지
    모든 호출이 8005로 실패한다. 한 번 거부당하면 바로 회복하도록 되돌린다.
    token을 주면 그 토큰이 아직 캐시에 있을 때만 지운다 - 다른 스레드가 이미 새로 받아 둔
    토큰을 지우지 않기 위해서다.
    """
    with _token_lock:
        if token is not None and _token_cache['token'] != token:
            return False
        _token_cache['token'] = None
        _token_cache['expires_at'] = 0
        return True


def _issue_token(appkey, secretkey):
    body = json.dumps({
        'grant_type': 'client_credentials',
        'appkey': appkey,
        'secretkey': secretkey,
    }).encode('utf-8')
    req = urllib.request.Request(
        BASE_URL + '/oauth2/token',
        data=body,
        headers={**COMMON_HEADERS, 'Content-Type': 'application/json;charset=UTF-8'},
        method='POST'
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            data = json.loads(res.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raise RuntimeError('토큰 발급 HTTP %s: %s' % (e.code, e.read().decode('utf-8', 'ignore')))
    token = data.get('token') or data.get('access_token')
    if not token:
        raise RuntimeError('토큰 발급 실패: ' + json.dumps(data, ensure_ascii=False))
    return token, _expires_at_from(data, time.time())


def get_token(appkey, secretkey):
    """스레드 안전 토큰 캐시. 만료 5분 전이면 미리 재발급.

    만료 시각은 발급 응답이 알려 준 절대 시각을 그대로 쓴다(_expires_at_from 주석 참고).
    """
    with _token_lock:
        now = time.time()
        if _token_cache['token'] and now < _token_cache['expires_at'] - TOKEN_REFRESH_MARGIN_SEC:
            return _token_cache['token']
        token, expires_at = _issue_token(appkey, secretkey)
        _token_cache['token'] = token
        _token_cache['expires_at'] = expires_at
        return token


def call_tr(token, api_id, path, body):
    req = urllib.request.Request(
        BASE_URL + path,
        data=json.dumps(body).encode('utf-8'),
        headers={
            **COMMON_HEADERS,
            'Content-Type': 'application/json;charset=UTF-8',
            'authorization': 'Bearer ' + token,
            'api-id': api_id,
        },
        method='POST'
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            payload = json.loads(res.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'ignore')
        if e.code in (401, 403):
            invalidate_token(token)
        raise RuntimeError('%s HTTP %s: %s' % (api_id, e.code, body))
    # 키움은 토큰이 죽어도 HTTP 200에 return_code=3으로 답한다. 여기서 잡아 두지 않으면
    # 호출부는 그냥 '데이터 없음'으로 보고 넘어가고, 캐시된 죽은 토큰은 그대로 남는다.
    if is_token_invalid(payload):
        invalidate_token(token)
    return payload
