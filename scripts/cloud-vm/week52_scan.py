# -*- coding: utf-8 -*-
"""오늘의 증시온도(js/market-temp.js, 52주 신고가/신저가 지표)용 배치.
data/sectors-v3.js 섹터 풀(238종목, 전체 종목이 아님 - gas의 fetchSectorUniverse_와 동일 소스)만
대상으로 키움 일봉(ka10081)을 종목당 1회 조회해 52주 고가/저가 갱신 여부를 계산한다.
네이버 페이지 크롤링(종목당 1페이지씩 필요, 배치 API 없음)을 GAS에서 라이브로 돌리면
이 세션 초반에 겪은 UrlFetchApp 할당량 초과를 다시 유발할 위험이 있어, 기존 배치들과
동일하게 VM에서 하루 1회 미리 계산해 캐시로 저장하고 GAS는 /week52-batch로 읽기만 한다.
systemd timer로 하루 1회 실행 - main.py의 /week52-batch가 결과를 즉시 서빙한다."""

import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone

import kiwoom_client
import kiwoom_market
import week52

SECTOR_POOL_URL = 'https://goodbyestarwars.github.io/tistory-ticker/data/sectors-v3.js'
OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'week52_cache.json')
THROTTLE_SEC = 0.25
OHLC_DAYS = 260  # 52주(약 250영업일) + 여유분


def log(msg):
    print('[week52_scan] ' + msg, flush=True)


def load_dotenv():
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if not os.path.exists(env_path):
        return
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, value = line.partition('=')
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


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
    load_dotenv()
    appkey = os.environ.get('KIWOOM_APPKEY')
    secretkey = os.environ.get('KIWOOM_SECRETKEY')
    if not appkey or not secretkey:
        log('KIWOOM_APPKEY / KIWOOM_SECRETKEY 환경변수가 필요합니다.')
        sys.exit(1)

    codes_map = load_sector_pool()
    if not codes_map:
        log('섹터 풀을 못 불러왔습니다.')
        sys.exit(1)
    if '--test' in sys.argv:
        codes_map = dict(list(codes_map.items())[:3])
        log('--test 모드: %d종목만 스모크 테스트' % len(codes_map))
    log('대상 종목 수: %d' % len(codes_map))

    token = kiwoom_client.get_token(appkey, secretkey)

    cache = {}
    new_high = 0
    new_low = 0
    for i, (code, name) in enumerate(codes_map.items()):
        try:
            daily = kiwoom_market.fetch_daily_ohlc(token, code, max_days=OHLC_DAYS)
            result = week52.compute_week52(daily)
            if result:
                cache[code] = result
                if result['isNewHigh']:
                    new_high += 1
                if result['isNewLow']:
                    new_low += 1
                log('[%d/%d] %s(%s) OK' % (i + 1, len(codes_map), name, code))
            else:
                log('[%d/%d] %s(%s) 데이터 없음 - 스킵' % (i + 1, len(codes_map), name, code))
        except Exception as e:
            log('[%d/%d] %s(%s) 실패: %s' % (i + 1, len(codes_map), name, code, e))
        time.sleep(THROTTLE_SEC)

    if not cache:
        log('수집된 데이터가 없어 저장을 건너뜁니다.')
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
    log('저장 완료: %s (%d/%d종목, 신고가 %d / 신저가 %d)'
        % (OUTPUT_FILE, len(cache), len(codes_map), new_high, new_low))


if __name__ == '__main__':
    main()
