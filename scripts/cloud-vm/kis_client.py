# -*- coding: utf-8 -*-
"""한국투자증권(KIS) Open API 클라이언트 - 토큰/웹소켓 접속키 발급+캐싱 + REST 조회.
kiwoom_client.py와 동일한 캐싱 패턴. 코스피200 야간선물(FID_COND_MRKT_DIV_CODE=CM) 전용으로
필요한 만큼만 구현 - 계좌/주문 관련 API는 다루지 않는다(시세 조회만 필요)."""

import json
import threading
import time
import urllib.error
import urllib.request

BASE_URL = 'https://openapi.koreainvestment.com:9443'
WS_URL = 'ws://ops.koreainvestment.com:21000'

_token_lock = threading.Lock()
_token_cache = {'token': None, 'expires_at': 0}

_approval_lock = threading.Lock()
_approval_cache = {'key': None, 'issued_at': 0}
_APPROVAL_TTL = 12 * 3600  # 접속키 자체 유효기간은 24h - 여유있게 12h마다 갱신


def _post_json(path, body):
    req = urllib.request.Request(
        BASE_URL + path,
        data=json.dumps(body).encode('utf-8'),
        headers={'Content-Type': 'application/json; charset=UTF-8'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return json.loads(res.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raise RuntimeError('%s HTTP %s: %s' % (path, e.code, e.read().decode('utf-8', 'ignore')))


def get_token(appkey, appsecret):
    """접근토큰(access_token) 캐시. 유효 24h, 만료 10분 전이면 재발급.
    KIS는 짧은 간격 재호출 시 직전 토큰을 그대로 돌려주므로 캐시가 없어도 안전하지만,
    불필요한 API 호출을 줄이기 위해 캐싱한다."""
    with _token_lock:
        now = time.time()
        if _token_cache['token'] and now < _token_cache['expires_at'] - 600:
            return _token_cache['token']
        data = _post_json('/oauth2/tokenP', {
            'grant_type': 'client_credentials',
            'appkey': appkey,
            'appsecret': appsecret,
        })
        token = data.get('access_token')
        if not token:
            raise RuntimeError('KIS 토큰 발급 실패: ' + json.dumps(data, ensure_ascii=False))
        expires_in = int(data.get('expires_in') or 86400)
        _token_cache['token'] = token
        _token_cache['expires_at'] = now + expires_in
        return token


def get_approval_key(appkey, appsecret):
    """웹소켓 접속키 캐시. 세션 연결 시 최초 1회만 필요하지만, 서비스 재시작 시마다
    새로 발급받아야 하므로 여기서 캐싱해 재사용."""
    with _approval_lock:
        now = time.time()
        if _approval_cache['key'] and now < _approval_cache['issued_at'] + _APPROVAL_TTL:
            return _approval_cache['key']
        data = _post_json('/oauth2/Approval', {
            'grant_type': 'client_credentials',
            'appkey': appkey,
            'secretkey': appsecret,  # 필드명이 appsecret이 아니라 secretkey(값은 동일) - KIS 문서 표기 그대로
        })
        key = data.get('approval_key')
        if not key:
            raise RuntimeError('KIS 웹소켓 접속키 발급 실패: ' + json.dumps(data, ensure_ascii=False))
        _approval_cache['key'] = key
        _approval_cache['issued_at'] = now
        return key


def fetch_period_chart(token, appkey, appsecret, mrkt_div_code, iscd, date1, date2, period_div_code='D'):
    """선물옵션기간별시세(일/주/월/년), TR FHKIF03020100. 최대 100건.
    mrkt_div_code: CM=야간선물, F=지수선물 등. date1/date2: YYYYMMDD.
    week/month는 date1/date2를 HHMMSS까지 붙인 YYYYMMDDHHMMSS가 아니라 이 API는 day만
    YYYYMMDD로 충분함(실측 확인됨, 네이버 API와는 다른 규격)."""
    path = ('/uapi/domestic-futureoption/v1/quotations/inquire-daily-fuopchartprice'
            '?FID_COND_MRKT_DIV_CODE=%s&FID_INPUT_ISCD=%s&FID_INPUT_DATE_1=%s&FID_INPUT_DATE_2=%s&FID_PERIOD_DIV_CODE=%s'
            % (mrkt_div_code, iscd, date1, date2, period_div_code))
    req = urllib.request.Request(
        BASE_URL + path,
        headers={
            'Content-Type': 'application/json; charset=utf-8',
            'authorization': 'Bearer ' + token,
            'appkey': appkey,
            'appsecret': appsecret,
            'tr_id': 'FHKIF03020100',
            'custtype': 'P',
        },
        method='GET',
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            data = json.loads(res.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raise RuntimeError('FHKIF03020100 HTTP %s: %s' % (e.code, e.read().decode('utf-8', 'ignore')))
    if data.get('rt_cd') != '0':
        raise RuntimeError('FHKIF03020100 실패: ' + json.dumps(data, ensure_ascii=False))
    return data.get('output1') or {}, data.get('output2') or []
