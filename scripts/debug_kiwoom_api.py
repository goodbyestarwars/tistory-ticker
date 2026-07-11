#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_investor_flow.py가 모든 종목에서 "데이터 없음"으로 스킵되는 문제 진단용.
공매도추이(ka10014) 응답 원문을 그대로 출력해서 실제 필드/래핑 구조를 확인한다.
사용법: KIWOOM_APPKEY=xxx KIWOOM_SECRETKEY=yyy python scripts/debug_kiwoom_api.py
"""
import json
import os
import urllib.request
from datetime import datetime, timedelta

BASE_URL = 'https://api.kiwoom.com'


def get_token(appkey, secretkey):
    body = json.dumps({
        'grant_type': 'client_credentials',
        'appkey': appkey,
        'secretkey': secretkey,
    }).encode('utf-8')
    req = urllib.request.Request(
        BASE_URL + '/oauth2/token',
        data=body,
        headers={'Content-Type': 'application/json;charset=UTF-8'},
        method='POST'
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        data = json.loads(res.read().decode('utf-8'))
    return data.get('token') or data.get('access_token')


def call_tr(token, api_id, path, body):
    req = urllib.request.Request(
        BASE_URL + path,
        data=json.dumps(body).encode('utf-8'),
        headers={
            'Content-Type': 'application/json;charset=UTF-8',
            'authorization': 'Bearer ' + token,
            'api-id': api_id,
        },
        method='POST'
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        headers = dict(res.getheaders())
        raw = res.read().decode('utf-8')
    return headers, raw


def main():
    appkey = os.environ.get('KIWOOM_APPKEY')
    secretkey = os.environ.get('KIWOOM_SECRETKEY')
    token = get_token(appkey, secretkey)
    print('=== 토큰 발급 성공 ===')

    end = datetime.now()
    start = end - timedelta(days=30)
    strt_dt, end_dt = start.strftime('%Y%m%d'), end.strftime('%Y%m%d')

    tests = [
        ('ka10014', '/api/dostk/shsa', {'stk_cd': '005930', 'strt_dt': strt_dt, 'end_dt': end_dt}),
        ('ka20068', '/api/dostk/slb', {'stk_cd': '005930'}),
        ('ka10059', '/api/dostk/stkinfo', {'stk_cd': '005930', 'dt': end_dt, 'amt_qty_tp': '1', 'trde_tp': '0', 'unit_tp': '1'}),
    ]

    for api_id, path, body in tests:
        print('\n=== %s %s ===' % (api_id, path))
        print('요청 바디:', json.dumps(body, ensure_ascii=False))
        try:
            headers, raw = call_tr(token, api_id, path, body)
            print('응답 헤더 일부:', {k: v for k, v in headers.items() if k.lower() in ('cont-yn', 'next-key', 'api-id')})
            print('응답 원문(앞 1500자):')
            print(raw[:1500])
        except Exception as e:
            print('실패:', e)


if __name__ == '__main__':
    main()
