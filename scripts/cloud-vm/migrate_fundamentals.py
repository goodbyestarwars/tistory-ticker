# -*- coding: utf-8 -*-
"""fundamentals_cache.json(batch_scan.py가 이어달리기로 채우는 중) -> SQLite fundamentals 테이블 이관.
재실행해도 안전(incremental): 코드별 updated_at(=fetchedAt)을 비교해서 새로 갱신된 것만 UPSERT.
스캔이 아직 안 끝난 상태에서도 지금까지 모인 데이터만 우선 옮기고, batch_scan.py가 이어달리기로
더 채우면 이 스크립트를 다시 돌려서 그 사이 새로 추가/갱신된 종목만 마이그레이션하면 된다."""

import json
import os

import db_schema

CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fundamentals_cache.json')
CORP_CODE_MAP_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dart_corp_code_map.json')


def log(msg):
    print('[migrate_fundamentals] ' + msg, flush=True)


def load_corp_code_map():
    if not os.path.exists(CORP_CODE_MAP_FILE):
        return {}
    with open(CORP_CODE_MAP_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)


def main():
    if not os.path.exists(CACHE_FILE):
        log('%s 가 없습니다 - batch_scan.py가 아직 한 번도 안 돌았을 수 있음.' % CACHE_FILE)
        return

    with open(CACHE_FILE, 'r', encoding='utf-8') as f:
        cached = json.load(f)
    data = cached.get('data') or {}
    fetched_at = cached.get('fetchedAt') or {}
    if not data:
        log('data가 비어있습니다 - 이관할 게 없음.')
        return

    corp_map = load_corp_code_map()

    conn = db_schema.get_conn()
    db_schema.create_schema(conn)

    existing = dict(conn.execute('SELECT code, updated_at FROM fundamentals').fetchall())

    migrated, skipped = 0, 0
    for code, payload in data.items():
        ts = fetched_at.get(code)
        if code in existing and existing[code] == ts:
            skipped += 1
            continue
        conn.execute(
            'INSERT INTO fundamentals (code, corp_code, updated_at, annual_json, latest_quarter_json) '
            'VALUES (?, ?, ?, ?, ?) '
            'ON CONFLICT(code) DO UPDATE SET corp_code=excluded.corp_code, updated_at=excluded.updated_at, '
            'annual_json=excluded.annual_json, latest_quarter_json=excluded.latest_quarter_json',
            (
                code,
                corp_map.get(code),
                ts,
                json.dumps(payload.get('annual'), ensure_ascii=False),
                json.dumps(payload.get('latest_quarter'), ensure_ascii=False),
            ),
        )
        migrated += 1
    conn.commit()
    conn.close()

    log('이관 완료: 신규/갱신 %d건, 이미 최신이라 스킵 %d건 (캐시 %d건 중 batch_scan 누적 스캔 %s건, DB: %s)'
        % (migrated, skipped, len(data), cached.get('scanned', len(data)), db_schema.DB_FILE))


if __name__ == '__main__':
    main()
