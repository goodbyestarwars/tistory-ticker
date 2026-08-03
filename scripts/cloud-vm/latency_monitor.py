# -*- coding: utf-8 -*-
"""주요 엔드포인트의 로컬 응답시간을 주기적으로 재서 로그로 남긴다.

2026-08-03 VM 장애(디스크 91%로 인한 I/O 병목, GCP IAM 권한 누락이 근본 원인) 진단 때
"느려진 것 같다"를 확인하려고 매번 사용자가 VM에 SSH 접속해 `curl -w`로 직접 재야 했다 -
이 스크립트는 그 수작업을 대신해 deploy_check.sh가 5분마다 백그라운드로 돌리고, 그 결과를
main.py의 GET /health/latency가 그대로 노출해 VM 접속 없이 브라우저·curl로 바로 확인할 수
있게 한다.

localhost(같은 VM 안)만 호출한다 - 순수 서버 처리시간이 목적이고, 방문자 브라우저가 겪는
네트워크·CDN 구간은 포함하지 않는다(그건 브라우저 개발자도구로 별도 확인 - 이 스크립트의
목적이 아니다).
"""
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

BASE_URL = 'http://localhost:8080'
# 삼성전자 - 상장폐지·거래정지 위험이 사실상 없어 장기 모니터링용 대표 종목으로 고정.
REPRESENTATIVE_CODE = '005930'
REPRESENTATIVE_NAME = '삼성전자'

# foreign-flow는 5분 서버 캐시가 있어 같은 days로 5분마다 재면 대부분 캐시 히트만 잡힌다 -
# 진짜 콜드 패스(키움+KIS 순차 호출) 성능도 섞어서 보려고 회차마다 days를 돌려가며 바꾼다.
FOREIGN_FLOW_DAY_OPTIONS = [5, 10, 20, 42, 63]


def _foreign_flow_days_for_now():
    slot = int(time.time() // 300) % len(FOREIGN_FLOW_DAY_OPTIONS)
    return FOREIGN_FLOW_DAY_OPTIONS[slot]


def _endpoints():
    return [
        ('/futures', {}),
        ('/market-rank', {}),
        ('/investor-trend', {'period': 'day', 'market': 'kospi'}),
        ('/foreign-flow/%s' % REPRESENTATIVE_CODE, {'days': str(_foreign_flow_days_for_now())}),
        ('/investor-flow/%s' % REPRESENTATIVE_CODE, {'name': REPRESENTATIVE_NAME}),
    ]


LOG_FILE = 'latency_monitor.log'
MAX_LOG_LINES = 10000  # 회차당 5줄 x 5분 간격 = 하루 약 1,440줄 -> 약 1주일치 유지
TIMEOUT_SEC = 25  # 프론트 클라이언트 타임아웃(20초)보다 살짝 여유를 둬 그 타임아웃을 실제로 넘기는지도 관찰


def _build_url(path, params):
    if not params:
        return BASE_URL + path
    query = '&'.join('%s=%s' % (k, v) for k, v in params.items())
    return BASE_URL + path + '?' + query


def check_one(path, params):
    """(elapsed_seconds, status) - status는 HTTP 코드 또는 'ERR:예외타입명'."""
    url = _build_url(path, params)
    started = time.monotonic()
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT_SEC) as res:
            status = res.status
            res.read()  # 본문까지 다 받아야 실제 응답 완료 시간(전송 포함)이 나온다
    except urllib.error.HTTPError as e:
        status = e.code
    except Exception as e:
        status = 'ERR:%s' % type(e).__name__
    elapsed = time.monotonic() - started
    return elapsed, status


def run_once():
    now = datetime.now(timezone.utc).isoformat(timespec='seconds')
    lines = []
    for path, params in _endpoints():
        elapsed, status = check_one(path, params)
        lines.append('%s %s %.3fs %s' % (now, path, elapsed, status))
    return lines


def _trim_log(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            existing = f.readlines()
    except FileNotFoundError:
        return
    if len(existing) > MAX_LOG_LINES:
        with open(path, 'w', encoding='utf-8') as f:
            f.writelines(existing[-MAX_LOG_LINES:])


def main():
    lines = run_once()
    with open(LOG_FILE, 'a', encoding='utf-8') as f:
        for line in lines:
            f.write(line + '\n')
    _trim_log(LOG_FILE)
    for line in lines:
        print(line)


if __name__ == '__main__':
    main()
