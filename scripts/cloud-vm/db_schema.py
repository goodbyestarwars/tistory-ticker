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

CREATE TABLE IF NOT EXISTS future_prices (
    symbol TEXT PRIMARY KEY,
    name TEXT,
    price REAL,
    change REAL,
    change_rate REAL,
    high REAL,
    low REAL,
    updated_at TEXT
);

-- 콜/풋 옵션 수급 요약(전체 만기 합산이 아니라 최근월물 기준 1행씩) - 종목별이 아니라
-- side(CALL/PUT) 단위 집계만 저장. 상세 행사가별 데이터는 저장하지 않는다(온디맨드 집계만 필요).
CREATE TABLE IF NOT EXISTS option_flow (
    side TEXT PRIMARY KEY,
    volume INTEGER,
    oi INTEGER,
    oi_change INTEGER,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS future_chart (
    symbol TEXT NOT NULL,
    date TEXT NOT NULL,
    open REAL,
    high REAL,
    low REAL,
    close REAL,
    PRIMARY KEY (symbol, date)
);

CREATE TABLE IF NOT EXISTS future_chart_minute (
    symbol TEXT NOT NULL,
    ts INTEGER NOT NULL,
    open REAL,
    high REAL,
    low REAL,
    close REAL,
    PRIMARY KEY (symbol, ts)
);
'''


def get_conn(db_file=None):
    """timeout=600: daily_scan.py 같은 장시간 배치가 쓰기 트랜잭션을 오래 쥐고 있을 때
    다른 스크립트(migrate_*.py 등)가 즉시 'database is locked' 에러를 내는 대신
    기다렸다가 재시도하도록 함(실제로 겪은 문제 - 2분으로는 부족해서 10분으로 늘림,
    구버전 daily_scan.py가 100종목마다만 커밋해서 API가 느릴 때 그 구간이 5분 넘게 걸림)."""
    conn = sqlite3.connect(db_file or DB_FILE, timeout=600)
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA busy_timeout=600000')
    return conn


def _ensure_column(conn, table, column, coltype):
    """CREATE TABLE IF NOT EXISTS는 이미 있는 테이블에 새 컬럼을 추가해주지 않으므로,
    기존 운영 DB(future_prices)에 나중에 컬럼을 늘릴 때(예: OI) 이 헬퍼로 마이그레이션한다."""
    cols = [r[1] for r in conn.execute('PRAGMA table_info(%s)' % table)]
    if column not in cols:
        conn.execute('ALTER TABLE %s ADD COLUMN %s %s' % (table, column, coltype))


def create_schema(conn):
    conn.executescript(SCHEMA)
    _ensure_column(conn, 'future_prices', 'oi', 'INTEGER')
    _ensure_column(conn, 'future_prices', 'oi_change', 'INTEGER')
    conn.commit()


def load_daily_prices(conn, code):
    """daily_prices에서 종목의 오름차순 OHLC를 꺼내 kiwoom_market.fetch_daily_ohlc()와
    동일한 행 형식({date, open, high, low, close, volume})으로 반환.
    week52_scan.py/rescan_patterns.py가 공유(API 재호출 없이 이 DB만 읽는 스크립트들)."""
    rows = conn.execute(
        'SELECT date, open, high, low, close, volume FROM daily_prices WHERE code=? ORDER BY date',
        (code,),
    ).fetchall()
    return [
        {'date': r[0], 'open': r[1], 'high': r[2], 'low': r[3], 'close': r[4], 'volume': r[5]}
        for r in rows
    ]


def latest_date(conn, table, code):
    """table(daily_prices 또는 investor_flow_daily)에서 종목의 가장 최근 저장 날짜.
    daily_scan.py가 '오늘자 데이터가 이미 있으면 API 재호출 스킵'을 판단하는 데 씀.
    table은 호출부 코드에 박힌 리터럴만 받는다(사용자 입력 아님) - f-string 조립이라도 안전."""
    assert table in ('daily_prices', 'investor_flow_daily')
    row = conn.execute('SELECT MAX(date) FROM %s WHERE code=?' % table, (code,)).fetchone()
    return row[0] if row else None


def load_investor_flow_daily(conn, code):
    """investor_flow_daily에서 종목의 내림차순(최신일 우선) 행을
    kiwoom_market.fetch_institution_trend()와 동일한 형식({date, close, change_pct,
    foreign_net, inst_net})으로 반환."""
    rows = conn.execute(
        'SELECT date, close, change_pct, foreign_net, inst_net FROM investor_flow_daily '
        'WHERE code=? ORDER BY date DESC',
        (code,),
    ).fetchall()
    return [
        {'date': r[0], 'close': r[1], 'change_pct': r[2], 'foreign_net': r[3], 'inst_net': r[4]}
        for r in rows
    ]


def upsert_future_price(conn, symbol, name, price, change, change_rate, high, low, updated_at, oi=None, oi_change=None):
    """oi/oi_change(미결제약정/증감)는 KIS 소스(야간선물)만 제공 - 없는 심볼은 None 그대로 저장."""
    conn.execute(
        'INSERT INTO future_prices (symbol, name, price, change, change_rate, high, low, updated_at, oi, oi_change) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) '
        'ON CONFLICT(symbol) DO UPDATE SET '
        'name=excluded.name, price=excluded.price, change=excluded.change, '
        'change_rate=excluded.change_rate, high=excluded.high, low=excluded.low, '
        'updated_at=excluded.updated_at, oi=excluded.oi, oi_change=excluded.oi_change',
        (symbol, name, price, change, change_rate, high, low, updated_at, oi, oi_change),
    )
    conn.commit()


def upsert_future_chart_rows(conn, symbol, rows):
    """rows: [{date, open, high, low, close}, ...]. 중복 INSERT는 PRIMARY KEY(symbol,date) UPSERT로 방지."""
    conn.executemany(
        'INSERT INTO future_chart (symbol, date, open, high, low, close) VALUES (?, ?, ?, ?, ?, ?) '
        'ON CONFLICT(symbol, date) DO UPDATE SET '
        'open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close',
        [(symbol, r['date'], r['open'], r['high'], r['low'], r['close']) for r in rows],
    )
    conn.commit()


def load_future_chart(conn, symbol, limit_days=90):
    rows = conn.execute(
        'SELECT date, open, high, low, close FROM future_chart WHERE symbol=? ORDER BY date DESC LIMIT ?',
        (symbol, limit_days),
    ).fetchall()
    rows.reverse()
    return [{'date': r[0], 'open': r[1], 'high': r[2], 'low': r[3], 'close': r[4]} for r in rows]


def upsert_future_chart_minute_rows(conn, symbol, rows):
    """rows: [{ts, open, high, low, close}, ...], ts는 UTC epoch초(정수)."""
    conn.executemany(
        'INSERT INTO future_chart_minute (symbol, ts, open, high, low, close) VALUES (?, ?, ?, ?, ?, ?) '
        'ON CONFLICT(symbol, ts) DO UPDATE SET '
        'open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close',
        [(symbol, r['ts'], r['open'], r['high'], r['low'], r['close']) for r in rows],
    )
    conn.commit()


def load_future_chart_minute(conn, symbol, limit_bars=1500):
    """최근 limit_bars개 1분봉(대략 최근 3~4거래일치, 하루 정규장 기준 약 390개)."""
    rows = conn.execute(
        'SELECT ts, open, high, low, close FROM future_chart_minute WHERE symbol=? ORDER BY ts DESC LIMIT ?',
        (symbol, limit_bars),
    ).fetchall()
    rows.reverse()
    return [{'ts': r[0], 'open': r[1], 'high': r[2], 'low': r[3], 'close': r[4]} for r in rows]


def load_all_future_prices(conn):
    rows = conn.execute(
        'SELECT symbol, name, price, change, change_rate, high, low, updated_at, oi, oi_change FROM future_prices'
    ).fetchall()
    return [
        {'symbol': r[0], 'name': r[1], 'price': r[2], 'change': r[3], 'change_rate': r[4],
         'high': r[5], 'low': r[6], 'updated_at': r[7], 'oi': r[8], 'oi_change': r[9]}
        for r in rows
    ]


def upsert_option_flow(conn, side, volume, oi, oi_change, updated_at):
    conn.execute(
        'INSERT INTO option_flow (side, volume, oi, oi_change, updated_at) VALUES (?, ?, ?, ?, ?) '
        'ON CONFLICT(side) DO UPDATE SET '
        'volume=excluded.volume, oi=excluded.oi, oi_change=excluded.oi_change, updated_at=excluded.updated_at',
        (side, volume, oi, oi_change, updated_at),
    )
    conn.commit()


def load_option_flow(conn):
    rows = conn.execute('SELECT side, volume, oi, oi_change, updated_at FROM option_flow').fetchall()
    return [
        {'side': r[0], 'volume': r[1], 'oi': r[2], 'oi_change': r[3], 'updated_at': r[4]}
        for r in rows
    ]


if __name__ == '__main__':
    conn = get_conn()
    create_schema(conn)
    conn.close()
    print('스키마 생성/확인 완료: %s' % DB_FILE)
