# -*- coding: utf-8 -*-
"""섹터 풀(data/sectors-v3.js) 전 종목의 공매도/대차/연기금을 미리 계산해
로컬 JSON 캐시로 저장한다. systemd timer로 하루 1회 실행.
scripts/fetch_investor_flow.py의 main()과 동일한 로직이지만, git commit 대신
로컬 파일에 저장하고 main.py의 /investor-flow-batch가 그 파일을 즉시 서빙한다."""

import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone

import investor_flow
import kiwoom_client

SECTORS_URL = 'https://goodbyestarwars.github.io/tistory-ticker/data/sectors-v3.js'
OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'investor_flow_cache.json')
THROTTLE_SEC = 0.25


def log(msg):
    print('[batch_scan] ' + msg, flush=True)


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


def load_stock_codes():
    req = urllib.request.Request(SECTORS_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as res:
        src = res.read().decode('utf-8')
    pattern = re.compile(r'\{\s*name:\s*"([^"]+)",\s*code:\s*"([0-9A-Za-z]{6})"\s*,\s*market:\s*"([^"]+)"\s*\}')
    seen = {}
    for m in pattern.finditer(src):
        name, code, market = m.group(1), m.group(2), m.group(3)
        seen[code] = name
    return seen


def main():
    load_dotenv()
    appkey = os.environ.get('KIWOOM_APPKEY')
    secretkey = os.environ.get('KIWOOM_SECRETKEY')
    if not appkey or not secretkey:
        log('KIWOOM_APPKEY / KIWOOM_SECRETKEY 환경변수가 필요합니다.')
        sys.exit(1)

    codes_map = load_stock_codes()
    if not codes_map:
        log('섹터 풀을 못 불러왔습니다.')
        sys.exit(1)
    if '--test' in sys.argv:
        codes_map = dict(list(codes_map.items())[:3])
        log('--test 모드: %d종목만 스모크 테스트' % len(codes_map))
    log('대상 종목 수: %d' % len(codes_map))

    token = kiwoom_client.get_token(appkey, secretkey)

    cache = {}
    for i, (code, name) in enumerate(codes_map.items()):
        try:
            result = investor_flow.fetch_stock(token, code, name)
            if result:
                cache[code] = result
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
        'data': cache,
    }
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False)
    log('저장 완료: %s (%d/%d종목)' % (OUTPUT_FILE, len(cache), len(codes_map)))


if __name__ == '__main__':
    main()
