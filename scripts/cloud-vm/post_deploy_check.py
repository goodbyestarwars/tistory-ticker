# -*- coding: utf-8 -*-
"""배포 직후 공개/인증 API를 로컬 루프백으로 회귀 점검한다.

API 키와 응답 본문은 출력하지 않고 엔드포인트별 통과 여부만 기록한다.
"""

import json
import argparse
import os
import time
import urllib.request


BASE_URL = os.environ.get('KIWOOM_LOCAL_API_URL', 'http://127.0.0.1:8080')


def load_dotenv():
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if not os.path.exists(env_path):
        return
    with open(env_path, 'r', encoding='utf-8') as source:
        for line in source:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, value = line.partition('=')
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def fetch_json(path, api_token=None, timeout=30):
    headers = {}
    if api_token:
        headers['X-API-Key'] = api_token
    request = urllib.request.Request(BASE_URL + path, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        if response.status != 200:
            raise RuntimeError('%s HTTP %s' % (path, response.status))
        return json.loads(response.read().decode('utf-8'))


def main(argv=None):
    parser = argparse.ArgumentParser(description='배포 후 API 회귀 점검')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--base-only', action='store_true',
                      help='health와 기존 OHLC API만 점검')
    mode.add_argument('--momentum-only', action='store_true',
                      help='뉴스 모멘텀 API만 점검')
    args = parser.parse_args(argv)
    load_dotenv()

    if not args.momentum_only:
        token = os.environ.get('API_TOKEN')
        if not token:
            raise SystemExit('API_TOKEN이 없어 인증 시세 API 회귀 점검을 수행할 수 없습니다.')

        health = None
        for _ in range(20):
            try:
                health = fetch_json('/health', timeout=5)
                break
            except Exception:
                time.sleep(1)
        if not health or health.get('data', {}).get('status') != 'ok':
            raise RuntimeError('/health 회귀 점검 실패')
        print('PASS /health')

        ohlc = fetch_json('/ohlc/005930', token, timeout=60)
        if not isinstance(ohlc.get('data'), list) or not ohlc['data']:
            raise RuntimeError('/ohlc/005930 응답 계약 불일치')
        print('PASS /ohlc/005930')

    if not args.base_only:
        momentum = fetch_json('/news-momentum/000660')
        momentum_data = momentum.get('data') or {}
        if (momentum_data.get('enabled') is not True
                or momentum_data.get('stockCode') != '000660'
                or not momentum_data.get('coverage')):
            raise RuntimeError('/news-momentum/000660 응답 계약 불일치')
        print('PASS /news-momentum/000660')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
