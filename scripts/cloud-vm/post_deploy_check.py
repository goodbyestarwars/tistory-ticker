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
# 2026-09-17: FastAPI가 재시작 후 포트를 여는 데 실측 41~64초가 걸린다(저널 Started ->
# Uvicorn running). 예전 코드는 5초 타임아웃 20회로 기다렸는데, 연결이 즉시 거부되는
# 구간에서는 이게 실측 25초밖에 안 돼 배포마다 점검이 실패했다. 횟수가 아니라 마감
# 시각으로 기다린다.
HEALTH_WAIT_SECONDS = float(os.environ.get('KIWOOM_POST_DEPLOY_HEALTH_WAIT', '180'))


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


def wait_for_health(wait_seconds=None):
    """재시작한 FastAPI가 /health를 정상 응답할 때까지 마감 시각까지 기다린다.

    기다린 초를 돌려준다. 마감까지 못 받으면 마지막 실패 사유를 담아 예외를 낸다 -
    "왜 실패했는지"가 로그에 남아야 다음 사람이 기동 지연과 실제 장애를 구분한다.
    """
    limit = HEALTH_WAIT_SECONDS if wait_seconds is None else wait_seconds
    started = time.monotonic()
    last_error = '응답 없음'
    while True:
        try:
            health = fetch_json('/health', timeout=5)
            status = (health.get('data') or {}).get('status')
            if status == 'ok':
                return time.monotonic() - started
            last_error = 'status=%s' % status
        except Exception as error:  # 연결 거부 = 아직 포트가 안 열린 것
            last_error = '%s: %s' % (type(error).__name__, error)
        waited = time.monotonic() - started
        if waited >= limit:
            raise RuntimeError('/health 회귀 점검 실패(%.0f초 대기, 마지막 사유: %s)'
                               % (waited, last_error))
        time.sleep(2)


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

        waited = wait_for_health()
        print('PASS /health (%.0f초 만에 응답)' % waited)

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
