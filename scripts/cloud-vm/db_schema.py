# -*- coding: utf-8 -*-
"""OHLC 스냅샷 + 펀더멘탈 + 수급 공유 SQLite DB 스키마.
daily_prices: 종목별 일봉 260일 - daily_scan.py가 INSERT.
fundamentals: DART 재무제표 요약 - migrate_fundamentals.py가 fundamentals_cache.json에서 이관.
investor_flow_daily: 외국인/기관 일별 순매매(ka10045) - daily_scan.py가 INSERT(투자시그널 계산에
쓰고 버리던 걸 이제 같이 저장).
investor_summary: 공매도/대차거래/연기금 요약(ka10014/ka20068/ka10059) - migrate_investor_summary.py가
batch_scan.py의 investor_flow_cache.json에서 이관.
종목 하나씩 SELECT ... WHERE code=?로 커서 순회하면 전체 종목 수와 무관하게 메모리에
종목 1개분만 올라가는 게 SQLite를 고른 핵심 이유(JSON 전체 로드 시 메모리 4배 증폭 실측됨)."""

import os
import sqlite3

DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ohlc_snapshot.db')

SCHEMA = '''
CREATE TABLE IF NOT EXISTS daily_prices (
    code TEXT NOT NULL,
    date TEXT NOT NULL,
    open REAL,
    high REAL,
    low REAL,
    close REAL,
    volume INTEGER,
    PRIMARY KEY (code, date)
);
CREATE INDEX IF NOT EXISTS idx_daily_prices_code ON daily_prices(code);

CREATE TABLE IF NOT EXISTS fundamentals (
    code TEXT PRIMARY KEY,
    corp_code TEXT,
    updated_at TEXT,
    annual_json TEXT,
    latest_quarter_json TEXT
);

CREATE TABLE IF NOT EXISTS investor_flow_daily (
    code TEXT NOT NULL,
    date TEXT NOT NULL,
    close REAL,
    change_pct REAL,
    foreign_net REAL,
    inst_net REAL,
    PRIMARY KEY (code, date)
);
CREATE INDEX IF NOT EXISTS idx_investor_flow_daily_code ON investor_flow_daily(code);

CREATE TABLE IF NOT EXISTS investor_summary (
    code TEXT PRIMARY KEY,
    name TEXT,
    updated_at TEXT,
    short_json TEXT,
    loan_json TEXT,
    pension_json TEXT
);
'''


def get_conn(db_file=None):
    conn = sqlite3.connect(db_file or DB_FILE)
    conn.execute('PRAGMA journal_mode=WAL')
    return conn


def create_schema(conn):
    conn.executescript(SCHEMA)
    conn.commit()


if __name__ == '__main__':
    conn = get_conn()
    create_schema(conn)
    conn.close()
    print('스키마 생성/확인 완료: %s' % DB_FILE)
