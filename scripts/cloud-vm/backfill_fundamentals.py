# -*- coding: utf-8 -*-
"""fundamentals_cache.json 커서(batch_scan.py의 이어달리기)가 아직 안 닿은 특정 종목을
지정해서 즉시 재수집한다. 배당 스캔(2026-08-12 추가) 기능이 붙기 전에 이미 수집된
레거시 캐시 항목은 dividend 키가 없는데, 정기 커서가 그 위치까지 돌아오기 전에
특정 종목만 먼저 채우고 싶을 때 1회성으로 실행한다. batch_scan.py의 커서 파일은
건드리지 않는다.

사용법:
  python3 backfill_fundamentals.py 017800 023530
  python3 backfill_fundamentals.py --missing-dividend   # dividend 키 없는 종목 전부
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone

import dart_client
import fundamentals
import migrate_fundamentals

CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fundamentals_cache.json')
THROTTLE_SEC = 0.25


def log(msg):
    print('[backfill_fundamentals] ' + msg, flush=True)


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


def load_cache():
    if not os.path.exists(CACHE_FILE):
        return {'generatedAt': None, 'universe': 0, 'scanned': 0, 'data': {}, 'fetchedAt': {}}
    with open(CACHE_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_cache(payload):
    with open(CACHE_FILE, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False)


def resolve_codes(args, cache):
    if args.missing_dividend:
        data = cache.get('data') or {}
        return sorted(code for code, entry in data.items() if 'dividend' not in (entry or {}))
    return args.codes


def main():
    parser = argparse.ArgumentParser(description='지정 종목의 DART 펀더멘탈/배당 데이터를 즉시 재수집')
    parser.add_argument('codes', nargs='*', help='6자리 종목코드 (예: 017800)')
    parser.add_argument('--missing-dividend', action='store_true',
                         help='캐시에 dividend 키가 없는 종목 전부 재수집')
    args = parser.parse_args()

    load_dotenv()
    dart_key = os.environ.get('DART_API_KEY')
    if not dart_key:
        log('DART_API_KEY 환경변수가 없습니다.')
        sys.exit(1)

    cache = load_cache()
    codes = resolve_codes(args, cache)
    if not codes:
        log('대상 종목이 없습니다.')
        return

    corp_map = dart_client.get_corp_code_map(dart_key)
    if not corp_map:
        log('DART corp_code 매핑을 못 불러왔습니다.')
        sys.exit(1)

    data = cache.setdefault('data', {})
    fetched_at = cache.setdefault('fetchedAt', {})
    ok_count = 0
    for i, code in enumerate(codes):
        corp_code = corp_map.get(code)
        if not corp_code:
            log('%s: corp_code 매핑 없음 - 건너뜀' % code)
            continue
        try:
            result = fundamentals.fetch_stock(dart_key, corp_code)
        except dart_client.DartRateLimitError as e:
            log('%s: DART 호출 한도 초과로 추정 - 중단: %s' % (code, e))
            break
        except Exception as e:
            log('%s: 실패: %s' % (code, e))
            time.sleep(THROTTLE_SEC)
            continue
        if result:
            data[code] = result
            fetched_at[code] = datetime.now(timezone.utc).isoformat()
            ok_count += 1
            log('[%d/%d] %s OK (dividend=%s)' % (
                i + 1, len(codes), code, result.get('dividend') is not None))
        else:
            log('[%d/%d] %s 데이터 없음' % (i + 1, len(codes), code))
        time.sleep(THROTTLE_SEC)

    if ok_count:
        cache['scanned'] = len(data)
        cache['generatedAt'] = datetime.now(timezone.utc).isoformat()
        save_cache(cache)
        log('저장 완료 (%d종목 갱신)' % ok_count)
        try:
            migrate_fundamentals.main()
        except Exception as e:
            log('SQLite 이관 실패(JSON은 정상 저장됨): %s' % e)
    else:
        log('갱신된 종목이 없어 저장을 건너뜁니다.')


if __name__ == '__main__':
    main()
