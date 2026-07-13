# -*- coding: utf-8 -*-
"""investor_flow_cache.json(batch_scan.py가 매일 전종목 재계산해서 통째로 덮어쓰는 파일 -
공매도/대차거래/연기금 요약) -> SQLite investor_summary 테이블 이관.
fundamentals_cache.json과 달리 종목별 fetchedAt 커서가 없는 파일이라(매일 전수 재계산,
섹터풀 238종목이라 부담도 적음) 매번 파일에 있는 전체를 그대로 UPSERT한다."""

import json
import os

import db_schema

CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'investor_flow_cache.json')


def log(msg):
    print('[migrate_investor_summary] ' + msg, flush=True)


def main():
    if not os.path.exists(CACHE_FILE):
        log('%s 가 없습니다.' % CACHE_FILE)
        return

    with open(CACHE_FILE, 'r', encoding='utf-8') as f:
        cached = json.load(f)
    data = cached.get('data') or {}
    generated_at = cached.get('generatedAt')
    if not data:
        log('data가 비어있습니다 - 이관할 게 없음.')
        return

    conn = db_schema.get_conn()
    db_schema.create_schema(conn)

    for code, payload in data.items():
        conn.execute(
            'INSERT INTO investor_summary (code, name, updated_at, short_json, loan_json, pension_json) '
            'VALUES (?, ?, ?, ?, ?, ?) '
            'ON CONFLICT(code) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at, '
            'short_json=excluded.short_json, loan_json=excluded.loan_json, pension_json=excluded.pension_json',
            (
                code,
                payload.get('name'),
                generated_at,
                json.dumps(payload.get('short'), ensure_ascii=False),
                json.dumps(payload.get('loan'), ensure_ascii=False),
                json.dumps(payload.get('pension'), ensure_ascii=False),
            ),
        )
    conn.commit()
    conn.close()

    log('이관 완료: %d종목 (기준시각 %s, DB: %s)' % (len(data), generated_at, db_schema.DB_FILE))


if __name__ == '__main__':
    main()
