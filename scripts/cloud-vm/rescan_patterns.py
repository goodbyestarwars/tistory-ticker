# -*- coding: utf-8 -*-
"""daily_scan.py처럼 키움 API를 호출하지 않고, SQLite(daily_prices)에 이미 저장된 OHLC만
읽어서 차트패턴(4종)+눌림목을 전종목 재채점한다. pattern_detect.py에 새 스캐너 함수를
추가했을 때, 다음날 daily_scan.py(API 기반, 07:00 UTC) 실행을 기다리지 않고 즉시
전종목 재채점하는 용도 - 종목 하나씩 커서 순회라 메모리엔 종목 1개분만 올라간다.
investSignal(수급 기반, 실시간성이 필요)은 이 스크립트가 다루지 않고 기존
daily_scan_cache.json의 investSignal 섹션을 그대로 보존한다.
수동 실행 전용(타이머 없음) - 새 패턴 추가했을 때 사람이 직접 돌리면 됨."""

import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

import db_schema
import pattern_detect as pd

FULL_UNIVERSE_URL = 'https://goodbyestarwars.github.io/tistory-ticker/data/krx_map.js'
OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'daily_scan_cache.json')


def log(msg):
    print('[rescan_patterns] ' + msg, flush=True)


def load_code_name_map():
    """data/krx_map.js(window.KRX_MAP={"종목명":"코드",...})를 fetch해서 {코드: 이름} 맵으로
    파싱. daily_prices엔 code만 있고 이름이 없어서 build_pattern_match용 stock 객체를
    만들려면 필요 - 키움 API가 아니라 GitHub Pages 정적 파일 fetch라 Kiwoom 재호출 아님."""
    req = urllib.request.Request(FULL_UNIVERSE_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as res:
        text = res.read().decode('utf-8')
    out = {}
    for m in re.finditer(r'"([^"]+)":"([0-9A-Za-z]{6})"', text):
        out[m.group(2)] = m.group(1)
    return out


def main():
    name_map = load_code_name_map()
    if not name_map:
        log('전종목 이름 매핑을 못 불러왔습니다.')
        sys.exit(1)

    conn = db_schema.get_conn()
    db_schema.create_schema(conn)

    codes = [r[0] for r in conn.execute('SELECT DISTINCT code FROM daily_prices ORDER BY code').fetchall()]
    if not codes:
        log('daily_prices가 비어있습니다 - daily_scan.py가 아직 안 돌았을 수 있음.')
        sys.exit(1)
    if '--test' in sys.argv:
        codes = codes[:3]
        log('--test 모드: %d종목만 스모크 테스트' % len(codes))
    log('대상 종목 수: %d' % len(codes))

    pattern_results = {'risingLows': [], 'doubleBottom': [], 'invHeadShoulders': [], 'boxRangeLow': []}
    pattern_scanned = 0
    pullback_matches = []
    pullback_scanned = 0

    for i, code in enumerate(codes):
        stock = {'name': name_map.get(code, code), 'code': code}
        daily = db_schema.load_daily_prices(conn, code)

        scanned_p, scanned_pb = pd.scan_stock(stock, daily, pattern_results, pullback_matches)
        if scanned_p:
            pattern_scanned += 1
        if scanned_pb:
            pullback_scanned += 1

        if (i + 1) % 300 == 0 or (i + 1) == len(codes):
            log('[%d/%d] 진행 중 (패턴 %d / 눌림목 %d 스캔됨)' % (i + 1, len(codes), pattern_scanned, pullback_scanned))

    conn.close()

    existing = {}
    if os.path.exists(OUTPUT_FILE):
        with open(OUTPUT_FILE, 'r', encoding='utf-8') as f:
            existing = json.load(f)

    existing['patternScan'] = {'scanned': pattern_scanned, 'patterns': pattern_results}
    existing['pullbackScan'] = {'scanned': pullback_scanned, 'matches': pullback_matches}
    existing['patternRescanAt'] = datetime.now(timezone.utc).isoformat()  # investSignal은 그대로라 top-level generatedAt은 안 건드림
    existing.setdefault('universe', len(codes))

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(existing, f, ensure_ascii=False)
    log('저장 완료: %s (패턴 %d / 눌림목 %d / 전체 %d, investSignal 섹션은 기존 값 유지)'
        % (OUTPUT_FILE, pattern_scanned, pullback_scanned, len(codes)))


if __name__ == '__main__':
    main()
