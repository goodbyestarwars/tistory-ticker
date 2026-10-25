# -*- coding: utf-8 -*-
"""전 종목(data/krx_map.js)의 공매도/대차/연기금 + DART 재무제표를 미리 계산해
로컬 JSON 캐시로 저장한다. systemd timer로 하루 1회 실행.

2026-07-13: 섹터풀(238종목)에서 전종목(2,691~2,766개)으로 확장(블로그 대원칙 - 전종목 검색).
- 공매도/대차/연기금(키움 API)은 daily_scan.py가 이미 같은 규모로 매일 문제없이 처리하고
  있어 그대로 단순 전수 스캔.
- DART 재무제표는 하루 호출 한도를 공식 문서에서 못 찾아서(비공개/미확인) 안전하게
  이어달리기(relay) + 증분 캐싱으로 처리한다: 재무제표는 거의 안 바뀌는 데이터라 최근에
  수집한 종목은 재조회하지 않고(FUNDAMENTALS_STALE_DAYS), 하루 안에 전체를 못 돌면
  커서를 저장해뒀다가 다음날 실행에서 이어간다. DART가 한도 초과로 보이는 에러를 주면
  그 즉시 중단(dart_client.DartRateLimitError)."""

import json
from snapshot_io import atomic_json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone

import dart_client
import fundamentals
import investor_flow
import kiwoom_client
import migrate_fundamentals
import migrate_investor_summary

FULL_UNIVERSE_URL = 'https://goodbyestarwars.github.io/tistory-ticker/data/krx_map.js'
OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'investor_flow_cache.json')
FUNDAMENTALS_OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fundamentals_cache.json')
FUNDAMENTALS_CURSOR_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fundamentals_cursor.json')
THROTTLE_SEC = 0.25
DISCLOSURE_CHECK_DAYS = 2           # 90일 이내 수집분도 이 주기로 DART 공시목록(1회 호출)만 확인해 신규·정정 공시를 잡는다
FUNDAMENTALS_STALE_DAYS = 90       # 분기보고서 공시 주기(연 4회)에 맞춰 재조회 스킵 기간 설정
FUNDAMENTALS_TIME_BUDGET_SEC = 20 * 60  # 이 실행에서 펀더멘탈 스캔에 쓸 시간 예산(넘으면 커서 저장하고 중단)


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


def load_full_universe():
    """data/krx_map.js(전 상장종목, window.KRX_MAP={"종목명":"코드",...})를 fetch해서
    {코드: 이름} 맵으로 파싱. daily_scan.py의 load_full_universe()와 동일한 소스."""
    req = urllib.request.Request(FULL_UNIVERSE_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as res:
        text = res.read().decode('utf-8')
    out = {}
    for m in re.finditer(r'"([^"]+)":"([0-9A-Za-z]{6})"', text):
        out[m.group(2)] = m.group(1)
    return out


def main():
    load_dotenv()

    codes_map = load_full_universe()
    if not codes_map:
        log('전종목 유니버스를 못 불러왔습니다.')
        sys.exit(1)
    if '--test' in sys.argv:
        codes_map = dict(list(codes_map.items())[:3])
        log('--test 모드: %d종목만 스모크 테스트' % len(codes_map))
    log('대상 종목 수: %d' % len(codes_map))

    if '--long-term-only' in sys.argv:
        path = os.path.join(os.path.dirname(__file__), 'daily_scan_cache.json')
        with open(path, encoding='utf-8') as f:
            candidates = (((json.load(f).get('patternScan') or {}).get('patterns') or {}).get('maCloudBreakout') or [])
        codes_map = {r['code']: r.get('name', r['code']) for r in candidates}
        if codes_map: scan_fundamentals(codes_map, candidate_only=True)
        return

    if '--fundamentals-only' in sys.argv:
        log('--fundamentals-only 모드: 수급 재수집 건너뛰고 펀더멘탈 이어달리기만 실행')
        scan_fundamentals(codes_map)
        return

    appkey = os.environ.get('KIWOOM_APPKEY')
    secretkey = os.environ.get('KIWOOM_SECRETKEY')
    if not appkey or not secretkey:
        log('KIWOOM_APPKEY / KIWOOM_SECRETKEY 환경변수가 필요합니다.')
        sys.exit(1)

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
    atomic_json(OUTPUT_FILE, payload)
    log('저장 완료: %s (%d/%d종목)' % (OUTPUT_FILE, len(cache), len(codes_map)))

    try:
        migrate_investor_summary.main()
    except Exception as e:
        log('investor_summary SQLite 이관 실패(JSON 캐시는 정상 저장됨): %s' % e)

    scan_fundamentals(codes_map)


def load_fundamentals_state():
    """이전에 저장된 결과(데이터+종목별 수집시각)와 이어달리기 커서를 불러온다."""
    cache, fetched_at = {}, {}
    if os.path.exists(FUNDAMENTALS_OUTPUT_FILE):
        try:
            with open(FUNDAMENTALS_OUTPUT_FILE, 'r', encoding='utf-8') as f:
                prev = json.load(f)
            cache = prev.get('data') or {}
            fetched_at = prev.get('fetchedAt') or {}
        except Exception:
            pass
    cursor = 0
    if os.path.exists(FUNDAMENTALS_CURSOR_FILE):
        try:
            with open(FUNDAMENTALS_CURSOR_FILE, 'r', encoding='utf-8') as f:
                cursor = int(json.load(f).get('cursor', 0))
        except Exception:
            cursor = 0
    return cache, fetched_at, cursor


def save_fundamentals_cursor(cursor):
    atomic_json(FUNDAMENTALS_CURSOR_FILE, {'cursor': cursor})


def is_stale(fetched_at, code):
    ts = fetched_at.get(code)
    if not ts:
        return True
    try:
        fetched = datetime.fromisoformat(ts)
    except ValueError:
        return True
    age_days = (datetime.now(timezone.utc) - fetched).total_seconds() / 86400
    return age_days >= FUNDAMENTALS_STALE_DAYS


def disclosure_due(entry, now=None):
    """마지막 공시 확인 후 DISCLOSURE_CHECK_DAYS가 지났는지(확인 기록이 없으면 True)."""
    now = now or datetime.now(timezone.utc)
    stamp = ((entry or {}).get('disclosure') or {}).get('checked_at')
    try:
        return (now - datetime.fromisoformat(stamp)).total_seconds() / 86400 >= DISCLOSURE_CHECK_DAYS
    except (TypeError, ValueError):
        return True


def disclosure_needs_refetch(dart_key, corp_code, entry):
    """90일 안에 수집한 항목에 신규/정정 정기공시가 있는지 DART 공시목록 1회로 확인한다.
    변화 없으면 확인 시각만 갱신하고 전체 재수집은 하지 않는다. DART 장애 시엔 기존 데이터를 유지한다."""
    try:
        filing = fundamentals.latest_periodic_filing(
            dart_client.call_periodic_reports(dart_key, corp_code, datetime.now(timezone.utc).date()))
    except dart_client.DartRateLimitError:
        raise
    except Exception:
        return False
    if fundamentals.disclosure_check(entry, filing) == 'refetch':
        return True
    disc = dict(entry.get('disclosure') or fundamentals.make_disclosure(filing, entry.get('latest_quarter')))
    disc['checked_at'] = datetime.now(timezone.utc).isoformat()
    entry['disclosure'] = disc
    return False


def scan_fundamentals(codes_map, candidate_only=False):
    """DART 재무제표(5년 실적 추세 + 최근 분기 YoY) - 이 배치(하루 1회) 안에서 이어서 실행.
    이미 최근(FUNDAMENTALS_STALE_DAYS 이내)에 수집한 종목은 재조회하지 않고, 하루 안에
    전체(2,691~2,766종목)를 다 못 돌면 커서를 저장해뒀다가 다음날 실행에서 이어간다."""
    dart_key = os.environ.get('DART_API_KEY')
    if not dart_key:
        log('DART_API_KEY 환경변수가 없어 펀더멘탈 스캔을 건너뜁니다.')
        return

    corp_map = dart_client.get_corp_code_map(dart_key)
    if not corp_map:
        log('DART corp_code 매핑을 못 불러왔습니다 - 펀더멘탈 스캔 건너뜀.')
        return

    cache, fetched_at, cursor = load_fundamentals_state()
    items = list(codes_map.items())
    universe_count = len(items)
    if candidate_only:
        cursor = 0
        try:
            with open(FUNDAMENTALS_OUTPUT_FILE, encoding='utf-8') as f:
                universe_count = json.load(f).get('universe') or max(len(cache), len(items))
        except (OSError, ValueError):
            universe_count = max(len(cache), len(items))
    if cursor >= len(items):
        cursor = 0  # 전체를 한 바퀴 다 돌았으면 처음부터(오래된 데이터부터 자연스럽게 갱신됨)

    started_at = time.time()
    i = cursor
    new_count = 0
    skipped_count = 0
    stop_reason = '전체 순회 완료'

    priority = []
    if not candidate_only:
        try:
            with open(os.path.join(os.path.dirname(__file__), 'daily_scan_cache.json'), encoding='utf-8') as f:
                raw = (((json.load(f).get('patternScan') or {}).get('patterns') or {}).get('maCloudBreakout') or [])
            priority = [(r['code'], codes_map[r['code']]) for r in raw if r.get('code') in codes_map]
        except (OSError, ValueError, TypeError):
            priority = []
    technical_codes = {code for code, _ in priority} if not candidate_only else set(codes_map)
    visited = set()
    while priority or i < len(items):
        if time.time() - started_at > FUNDAMENTALS_TIME_BUDGET_SEC:
            stop_reason = '시간예산 초과로 중단'
            break

        is_priority = bool(priority)
        code, name = priority.pop(0) if is_priority else items[i]
        if code in visited:
            if not is_priority: i += 1
            continue
        visited.add(code)
        needs_screening = code in technical_codes
        # Dividend screening was added after the original fundamentals cache.
        # Revisit legacy entries once, then let the normal 90-day freshness
        # window apply even when DART has no dividend rows for that company.
        corp_code = corp_map.get(code)
        fresh = not is_stale(fetched_at, code) and 'dividend' in (cache.get(code) or {}) and (not needs_screening or fundamentals.screening_cache_fresh(cache.get(code)))
        if fresh and corp_code and disclosure_due(cache.get(code)):
            # 90일 이내라도 신규 분기·반기·사업보고서나 정정공시가 나왔으면 다시 수집한다.
            try:
                if disclosure_needs_refetch(dart_key, corp_code, cache[code]):
                    fresh = False
                    log('[펀더멘탈] %s(%s) 신규/정정 정기공시 감지 - 재수집' % (name, code))
                time.sleep(THROTTLE_SEC)
            except dart_client.DartRateLimitError as e:
                log('[펀더멘탈] 공시 확인 중 DART 한도 초과 추정: %s - 오늘은 중단' % e)
                stop_reason = '한도 초과로 중단'
                break
        if fresh:
            skipped_count += 1
            if not is_priority: i += 1
            continue

        if not corp_code:
            if not is_priority: i += 1
            continue
        try:
            result = fundamentals.fetch_stock(dart_key, corp_code, include_screening=needs_screening)
            if result:
                if not needs_screening and (cache.get(code) or {}).get('screening'):
                    # Retain old evidence with its original date; never refresh it by association.
                    result['screening'] = cache[code]['screening']
                cache[code] = result
                fetched_at[code] = datetime.now(timezone.utc).isoformat()
                new_count += 1
                log('[펀더멘탈 %d/%d] %s(%s) OK' % (i + 1, len(items), name, code))
            else:
                log('[펀더멘탈 %d/%d] %s(%s) 데이터 없음 - 스킵' % (i + 1, len(items), name, code))
        except dart_client.DartRateLimitError as e:
            log('[펀더멘탈 %d/%d] %s(%s) DART 호출 한도 초과로 추정: %s - 커서 저장하고 오늘은 중단'
                % (i + 1, len(items), name, code, e))
            stop_reason = '한도 초과로 중단'
            break
        except Exception as e:
            log('[펀더멘탈 %d/%d] %s(%s) 실패: %s' % (i + 1, len(items), name, code, e))
        time.sleep(THROTTLE_SEC)
        if not is_priority: i += 1

    if not candidate_only: save_fundamentals_cursor(i)

    if not cache:
        log('펀더멘탈 데이터가 없어 저장을 건너뜁니다.')
        return

    payload = {
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'universe': universe_count,
        'scanned': len(cache),
        'data': cache,
        'fetchedAt': fetched_at,
    }
    atomic_json(FUNDAMENTALS_OUTPUT_FILE, payload)
    log('펀더멘탈 저장 완료: %s (누적 %d/%d종목, 이번 실행 신규 %d / 스킵 %d, %s)'
        % (FUNDAMENTALS_OUTPUT_FILE, len(cache), len(items), new_count, skipped_count, stop_reason))

    try:
        migrate_fundamentals.main()
    except Exception as e:
        log('fundamentals SQLite 이관 실패(JSON 캐시는 정상 저장됨): %s' % e)


if __name__ == '__main__':
    main()
