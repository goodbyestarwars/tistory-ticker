# -*- coding: utf-8 -*-
"""오늘의 증시온도(js/market-temp.js, 52주 신고가/신저가 지표)용 배치.
data/sectors-v3.js 섹터 풀(238종목, 전체 종목이 아님 - gas의 fetchSectorUniverse_와 동일 소스)만
대상으로 52주 고가/저가 갱신 여부를 계산한다.

2026-07-14: 키움 API를 직접 호출하던 걸 SQLite(daily_prices) 읽기로 교체 - daily_scan.py가
매일 07:00 UTC에 전종목(섹터 풀 포함) OHLC를 daily_prices에 이미 저장해두므로, 이 배치가
같은 종목을 또 API로 조회하던 중복 호출을 없앤 것(이 타이머는 10:30 UTC라 daily_scan.py가
끝난 뒤 실행됨). API 키/네트워크 호출이 전혀 필요 없어져서 실행 시간도 초 단위로 줄어듦.
systemd timer로 하루 1회 실행 - main.py의 /week52-batch가 결과를 즉시 서빙한다."""

import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

import db_schema
import week52

SECTOR_POOL_URL = 'https://goodbyestarwars.github.io/tistory-ticker/data/sectors-v3.js'
OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'week52_cache.json')


def log(msg):
    print('[week52_scan] ' + msg, flush=True)


def load_sector_pool():
    """gas의 fetchSectorUniverse_()와 동일한 정규식·소스(data/sectors-v3.js) - {코드: 이름} 맵."""
    req = urllib.request.Request(SECTOR_POOL_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as res:
        text = res.read().decode('utf-8')
    out = {}
    for m in re.finditer(r'name:\s*"([^"]+)",\s*code:\s*"([0-9A-Za-z]{6})",\s*market:\s*"(?:KOSPI|KOSDAQ)"', text):
        out[m.group(2)] = m.group(1)
    return out


def main():
    codes_map = load_sector_pool()
    if not codes_map:
        log('섹터 풀을 못 불러왔습니다.')
        sys.exit(1)
    if '--test' in sys.argv:
        codes_map = dict(list(codes_map.items())[:3])
        log('--test 모드: %d종목만 스모크 테스트' % len(codes_map))
    log('대상 종목 수: %d' % len(codes_map))

    conn = db_schema.get_conn()
    db_schema.create_schema(conn)

    cache = {}
    new_high = 0
    new_low = 0
    missing = 0
    for i, (code, name) in enumerate(codes_map.items()):
        daily = db_schema.load_daily_prices(conn, code)
        if not daily:
            missing += 1
            log('[%d/%d] %s(%s) daily_prices에 데이터 없음 - 스킵' % (i + 1, len(codes_map), name, code))
            continue
        result = week52.compute_week52(daily)
        if result:
            cache[code] = result
            if result['isNewHigh']:
                new_high += 1
            if result['isNewLow']:
                new_low += 1

    conn.close()

    if not cache:
        log('수집된 데이터가 없어 저장을 건너뜁니다(daily_scan.py가 아직 안 돌았을 수 있음).')
        sys.exit(1)

    payload = {
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'universe': len(codes_map),
        'scanned': len(cache),
        'newHighCount': new_high,
        'newLowCount': new_low,
        'data': cache,
    }
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False)
    log('저장 완료: %s (%d/%d종목, 신고가 %d / 신저가 %d, DB 미보유 스킵 %d)'
        % (OUTPUT_FILE, len(cache), len(codes_map), new_high, new_low, missing))


if __name__ == '__main__':
    main()
