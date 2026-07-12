# -*- coding: utf-8 -*-
"""키움증권 REST API 클라이언트 - 토큰 발급/캐싱 + TR 호출 공통 로직.
scripts/fetch_investor_flow.py의 get_token/call_tr 패턴을 그대로 재사용."""

import json
import threading
import time
import urllib.error
import urllib.request

BASE_URL = 'https://api.kiwoom.com'
# 클라우드 VM의 urllib 기본 User-Agent(Python-urllib/x.x)는 WAF가 봇으로 차단하는 경우가 많아
# 일반 브라우저처럼 보이는 값으로 고정
COMMON_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
}

_token_lock = threading.Lock()
_token_cache = {'token': None, 'expires_at': 0}


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
    # expires_in이 없으면 보수적으로 12시간만 신뢰
    expires_in = int(data.get('expires_in') or 43200)
    return token, expires_in


def get_token(appkey, secretkey):
    """스레드 안전 토큰 캐시. 만료 5분 전이면 미리 재발급."""
    with _token_lock:
        now = time.time()
        if _token_cache['token'] and now < _token_cache['expires_at'] - 300:
            return _token_cache['token']
        token, expires_in = _issue_token(appkey, secretkey)
        _token_cache['token'] = token
        _token_cache['expires_at'] = now + expires_in
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
            return json.loads(res.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raise RuntimeError('%s HTTP %s: %s' % (api_id, e.code, e.read().decode('utf-8', 'ignore')))
