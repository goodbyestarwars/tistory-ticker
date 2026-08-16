# -*- coding: utf-8 -*-
"""OHLC 스냅샷 + 펀더멘탈 + 수급 공유 SQLite DB 스키마.
daily_prices: 종목별 일봉 260일 - daily_scan.py가 INSERT.
fundamentals: DART 재무제표 요약 - migrate_fundamentals.py가 fundamentals_cache.json에서 이관.
investor_flow_daily: 개인/외국인/기관 일별 순매매 - daily_scan.py와 /foreign-flow가 INSERT.
investor_summary: 공매도/대차거래/연기금 요약(ka10014/ka20068/ka10059) - migrate_investor_summary.py가
batch_scan.py의 investor_flow_cache.json에서 이관.
종목 하나씩 SELECT ... WHERE code=?로 커서 순회하면 전체 종목 수와 무관하게 메모리에
종목 1개분만 올라가는 게 SQLite를 고른 핵심 이유(JSON 전체 로드 시 메모리 4배 증폭 실측됨)."""

import os
import json
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
    ind_net REAL,
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

  -- 코스피200 옵션 최근월물의 행사가별 원자료. 합계 카드와 별도로 보관해
  -- 브라우저에서 콜/풋 OI·거래량 프로파일을 그릴 수 있게 한다.
  CREATE TABLE IF NOT EXISTS option_flow_strike (
      side TEXT NOT NULL,
      strike REAL NOT NULL,
      volume INTEGER,
      oi INTEGER,
      oi_change INTEGER,
      updated_at TEXT,
      PRIMARY KEY (side, strike)
  );
  CREATE INDEX IF NOT EXISTS idx_option_flow_strike_side ON option_flow_strike(side);

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

-- 2026-07-19: KIS 종목별투자자매매동향(일별, FHPTJ04160001)이 00:00~15:40(KST)엔 TR
-- 자체가 막혀있어서(OPSQ2001 TIME LIMIT, kiwoom_market.py 참고) 그 시간대엔 직전 성공
-- 결과를 재사용해야 하는데, 인메모리 캐시는 배포 때마다(재시작) 사라져서 SQLite로 옮김 -
-- daily_prices/investor_flow_daily과 달리 batch_scan 대상이 아니라 온디맨드로 "그때그때
-- 조회된 종목"만 쌓인다(전종목 아님, 무한정 커지지 않음 - 종목당 기간 선택지가 5개뿐이라
-- 최악의 경우도 "조회된 종목 수 x 5"행 수준). rows_json은 kiwoom_market의 daily 행
-- 리스트를 그대로 직렬화(다른 *_json 컬럼과 동일 패턴, fundamentals.annual_json 등).
CREATE TABLE IF NOT EXISTS kis_flow_cache (
    code TEXT NOT NULL,
    target_days INTEGER NOT NULL,
    updated_at TEXT,
    rows_json TEXT,
    PRIMARY KEY (code, target_days)
);

-- 2026-07-20: 메인 페이지 "투자자별 매매 동향" 위젯(작업지시서 #4) - 시장별(코스피/코스닥)
-- 개인/외국인/기관계 일별 순매수(억원, KIS FHPTJ04040000 1차 소스, investor_trend.py 참고).
-- 2026-07-21: 코스피 단일 시장에서 코스피/코스닥 다중 시장으로 확장하며 market 컬럼 추가
-- (PK를 date 단독에서 (market, date) 복합키로 변경) - _migrate_investor_trend_market()이
-- 기존 배포 DB(컬럼 없음)를 'KOSPI'로 마이그레이션한다.
CREATE TABLE IF NOT EXISTS investor_trend_daily (
    market TEXT NOT NULL,
    date TEXT NOT NULL,
    ind_amt REAL,
    frgn_amt REAL,
    orgn_amt REAL,
    updated_at TEXT,
    PRIMARY KEY (market, date)
);

-- 2026-08-05: 종목분석 매물대 카드 "실제 체결가" 뷰(js/foreign-flow.js) - KIS pbar-tratio는
-- "오늘"만 주므로, 조회될 때마다(kis_flow_cache와 동일한 온디맨드 적재 패턴 - 배치 없음)
-- 그날 최신 누적 스냅샷을 가격별로 UPSERT해 여러 거래일치를 자연히 쌓는다. pbar-tratio
-- 자체가 이미 "그 시점까지의 당일 누적치"라 같은 날 안에서는 새 값으로 덮어쓰기만 하면
-- 되고(더하지 않음), 날짜가 바뀌면 그 행은 더 이상 갱신되지 않아 그날의 마감 근접
-- 스냅샷으로 자연히 고정된다. 온디맨드라 "정확히 최근 N거래일"이 아니라 "조회된 적
-- 있는 날짜 중 최근 N개"임을 감안할 것(main.py pbar_tratio 엔드포인트 참고).
CREATE TABLE IF NOT EXISTS volume_profile_daily (
    code TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    price REAL NOT NULL,
    volume REAL,
    updated_at TEXT,
    PRIMARY KEY (code, trade_date, price)
);
CREATE INDEX IF NOT EXISTS idx_volume_profile_daily_code ON volume_profile_daily(code);

-- User-managed 증시온도 카드 구성. 실제 시세/분석 테이블과 분리하고,
-- 작은 설정 JSON을 한 행으로 원자적으로 교체해 읽기 비용과 마이그레이션 복잡도를 낮춘다.
CREATE TABLE IF NOT EXISTS sector_cards_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    config_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_sub TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlist_configs (
    user_id INTEGER PRIMARY KEY,
    config_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
);

-- 증시온도 카드의 사용자별 편집본. sector_cards_config는 운영자가 만든 공용 기본값이고,
-- 이 테이블에 행이 생긴 사용자만 기본값에서 분기한다.
CREATE TABLE IF NOT EXISTS user_sector_cards_config (
    user_id INTEGER PRIMARY KEY,
    config_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
);

-- 2026-08: 국내 4주 스윙 추천의 재현 가능한 판정 스냅샷. legacy_*는
-- 구 별점 모델과의 회귀 비교용일 뿐 최종 행동을 결정하지 않는다. 결과값은
-- daily_prices가 충분히 쌓인 뒤 monitor_swing_recommendations.py가 T+5/T+10/T+20을 채운다.
CREATE TABLE IF NOT EXISTS swing_recommendation_snapshots (
    as_of_date TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    model_version TEXT NOT NULL,
    close REAL,
    chart_regime TEXT,
    current_regime TEXT,
    recent_event TEXT,
    recent_event_stage TEXT,
    auxiliary_states_json TEXT,
    turning_point TEXT,
    momentum_state TEXT,
    fundamental_state TEXT,
    risk_state TEXT,
    risk_reasons_json TEXT,
    holder_action TEXT,
    entry_opinion TEXT,
    internal_priority_score REAL,
    legacy_score REAL,
    legacy_stars REAL,
    legacy_label TEXT,
    ma5 REAL,
    ma20 REAL,
    ma60 REAL,
    ma224 REAL,
    relative_strength REAL,
    invalidation_condition TEXT,
    t5_return REAL,
    t10_return REAL,
    t20_return REAL,
    t5_excess_return REAL,
    t10_excess_return REAL,
    t20_excess_return REAL,
    t20_regime TEXT,
    t20_regime_changed INTEGER,
    mfe REAL,
    mae REAL,
    outcome_updated_at TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (as_of_date, code, model_version)
);
CREATE INDEX IF NOT EXISTS idx_swing_snapshots_code_date
    ON swing_recommendation_snapshots(code, as_of_date);
CREATE INDEX IF NOT EXISTS idx_swing_snapshots_regime
    ON swing_recommendation_snapshots(model_version, chart_regime, as_of_date);
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


def _migrate_investor_trend_market(conn):
    """investor_trend_daily가 PK=date 단독(구버전)이면 PK=(market, date)로 재생성하며
    기존 행은 전부 'KOSPI'로 태깅한다. _ensure_column으로는 PK 자체를 못 바꿔서(SQLite
    한계) 테이블 재생성이 필요 - 이 데이터는 KIS/네이버에서 재수집 가능해 유실 부담이
    없으므로 안전하게 처리."""
    cols = [r[1] for r in conn.execute("PRAGMA table_info(investor_trend_daily)")]
    if not cols or 'market' in cols:
        return
    conn.execute('ALTER TABLE investor_trend_daily RENAME TO investor_trend_daily_old')
    conn.execute('''
        CREATE TABLE investor_trend_daily (
            market TEXT NOT NULL,
            date TEXT NOT NULL,
            ind_amt REAL,
            frgn_amt REAL,
            orgn_amt REAL,
            updated_at TEXT,
            PRIMARY KEY (market, date)
        )
    ''')
    conn.execute('''
        INSERT INTO investor_trend_daily (market, date, ind_amt, frgn_amt, orgn_amt, updated_at)
        SELECT 'KOSPI', date, ind_amt, frgn_amt, orgn_amt, updated_at FROM investor_trend_daily_old
    ''')
    conn.execute('DROP TABLE investor_trend_daily_old')


def create_schema(conn):
    conn.executescript(SCHEMA)
    _ensure_column(conn, 'investor_flow_daily', 'ind_net', 'REAL')
    _ensure_column(conn, 'future_prices', 'oi', 'INTEGER')
    _ensure_column(conn, 'future_prices', 'oi_change', 'INTEGER')
    _ensure_column(conn, 'future_prices', 'ask_price', 'REAL')
    _ensure_column(conn, 'future_prices', 'bid_price', 'REAL')
    _ensure_column(conn, 'future_prices', 'ask_qty', 'REAL')
    _ensure_column(conn, 'future_prices', 'bid_qty', 'REAL')
    _ensure_column(conn, 'swing_recommendation_snapshots', 'current_regime', 'TEXT')
    _ensure_column(conn, 'swing_recommendation_snapshots', 'recent_event', 'TEXT')
    _ensure_column(conn, 'swing_recommendation_snapshots', 'recent_event_stage', 'TEXT')
    _ensure_column(conn, 'swing_recommendation_snapshots', 'auxiliary_states_json', 'TEXT')
    _ensure_column(conn, 'swing_recommendation_snapshots', 't20_regime', 'TEXT')
    _ensure_column(conn, 'swing_recommendation_snapshots', 't20_regime_changed', 'INTEGER')
    _migrate_investor_trend_market(conn)
    conn.commit()


def upsert_swing_snapshot(conn, snapshot):
    """Persist one recommendation-time assessment without losing old model rows."""
    now = snapshot.get('createdAt') or snapshot.get('created_at') or ''
    chart = snapshot.get('chartRegime') or {}
    momentum = snapshot.get('momentum') or {}
    fundamental = snapshot.get('fundamental') or {}
    risk = snapshot.get('risk') or {}
    legacy = snapshot.get('legacy') or {}
    ma = chart.get('ma') or {}
    current_regime = snapshot.get('currentRegime') or chart.get('currentRegime') or {}
    recent_event = snapshot.get('recentEvent') or chart.get('recentEvent') or {}
    auxiliary_states = snapshot.get('auxiliaryStates') or chart.get('auxiliaryStates') or []
    conn.execute(
        '''INSERT INTO swing_recommendation_snapshots (
            as_of_date, code, name, model_version, close, chart_regime, current_regime,
            recent_event, recent_event_stage, auxiliary_states_json, turning_point,
            momentum_state, fundamental_state, risk_state, risk_reasons_json,
            holder_action, entry_opinion, internal_priority_score, legacy_score,
            legacy_stars, legacy_label, ma5, ma20, ma60, ma224, relative_strength,
            invalidation_condition, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(as_of_date, code, model_version) DO UPDATE SET
            name=excluded.name, close=excluded.close, chart_regime=excluded.chart_regime,
            current_regime=excluded.current_regime, recent_event=excluded.recent_event,
            recent_event_stage=excluded.recent_event_stage, auxiliary_states_json=excluded.auxiliary_states_json,
            turning_point=excluded.turning_point, momentum_state=excluded.momentum_state,
            fundamental_state=excluded.fundamental_state, risk_state=excluded.risk_state,
            risk_reasons_json=excluded.risk_reasons_json, holder_action=excluded.holder_action,
            entry_opinion=excluded.entry_opinion, internal_priority_score=excluded.internal_priority_score,
            legacy_score=excluded.legacy_score, legacy_stars=excluded.legacy_stars,
            legacy_label=excluded.legacy_label, ma5=excluded.ma5, ma20=excluded.ma20,
            ma60=excluded.ma60, ma224=excluded.ma224, relative_strength=excluded.relative_strength,
            invalidation_condition=excluded.invalidation_condition''',
        (
            snapshot.get('asOfDate'), snapshot.get('code'), snapshot.get('name') or '',
            snapshot.get('modelVersion'), snapshot.get('close'), chart.get('key'),
            current_regime.get('key') or current_regime.get('label'),
            recent_event.get('key') or recent_event.get('label'), recent_event.get('stage'),
            json.dumps(auxiliary_states, ensure_ascii=False),
            chart.get('turningPoint'), momentum.get('state'), fundamental.get('state'),
            risk.get('state'), json.dumps(risk.get('flags') or [], ensure_ascii=False),
            snapshot.get('holderAction'), snapshot.get('entryOpinion'),
            snapshot.get('internalPriorityScore'), legacy.get('score'), legacy.get('stars'),
            legacy.get('label'), ma.get('ma5'), ma.get('ma20'), ma.get('ma60'), ma.get('ma224'),
            chart.get('relativeStrength'), chart.get('invalidation'), now,
        ),
    )


def update_swing_snapshot_outcome(conn, as_of_date, code, model_version, outcomes):
    """Fill forward returns after T+5/T+10/T+20 become available."""
    fields = ('t5_return', 't10_return', 't20_return', 't5_excess_return',
              't10_excess_return', 't20_excess_return', 't20_regime',
              't20_regime_changed', 'mfe', 'mae')
    values = [outcomes.get(field) for field in fields]
    values.extend([outcomes.get('outcomeUpdatedAt') or ''])
    conn.execute(
        '''UPDATE swing_recommendation_snapshots SET
           t5_return=?, t10_return=?, t20_return=?, t5_excess_return=?,
           t10_excess_return=?, t20_excess_return=?, t20_regime=?,
           t20_regime_changed=?, mfe=?, mae=?, outcome_updated_at=?
           WHERE as_of_date=? AND code=? AND model_version=?''',
        values + [as_of_date, code, model_version],
    )


def load_sector_cards_config(conn):
    row = conn.execute(
        'SELECT config_json, revision, updated_at FROM sector_cards_config WHERE id=1'
    ).fetchone()
    if not row:
        return None
    try:
        sectors = json.loads(row[0])
    except (TypeError, ValueError) as exc:
        raise ValueError('sector_cards_config contains invalid JSON') from exc
    return {'sectors': sectors, 'revision': row[1], 'updatedAt': row[2]}


def save_sector_cards_config(conn, sectors, updated_at, expected_revision=None):
    """Atomically replace the card map and enforce optimistic concurrency."""
    conn.execute('BEGIN IMMEDIATE')
    try:
        current = conn.execute(
            'SELECT revision FROM sector_cards_config WHERE id=1'
        ).fetchone()
        current_revision = current[0] if current else 0
        if expected_revision is not None and int(expected_revision) != current_revision:
            raise RuntimeError('SECTOR_CONFIG_REVISION_CONFLICT')

        next_revision = current_revision + 1 if current else 1
        payload = json.dumps(sectors, ensure_ascii=False, separators=(',', ':'))
        conn.execute(
            'INSERT INTO sector_cards_config (id, config_json, revision, updated_at) '
            'VALUES (1, ?, ?, ?) '
            'ON CONFLICT(id) DO UPDATE SET config_json=excluded.config_json, '
            'revision=excluded.revision, updated_at=excluded.updated_at',
            (payload, next_revision, updated_at),
        )
        conn.commit()
        return {'sectors': sectors, 'revision': next_revision, 'updatedAt': updated_at}
    except Exception:
        conn.rollback()
        raise


def load_user_sector_cards_config(conn, user_id):
    row = conn.execute(
        'SELECT config_json, revision, updated_at FROM user_sector_cards_config WHERE user_id=?',
        (user_id,),
    ).fetchone()
    if not row:
        return None
    try:
        sectors = json.loads(row[0])
    except (TypeError, ValueError) as exc:
        raise ValueError('user_sector_cards_config contains invalid JSON') from exc
    return {
        'sectors': sectors,
        'revision': row[1],
        'updatedAt': row[2],
        'customized': True,
    }


def save_user_sector_cards_config(conn, user_id, sectors, updated_at, expected_revision=None):
    """사용자 편집본만 원자적으로 저장하고 공용 기본 카드에는 손대지 않는다."""
    conn.execute('BEGIN IMMEDIATE')
    try:
        current = conn.execute(
            'SELECT revision FROM user_sector_cards_config WHERE user_id=?',
            (user_id,),
        ).fetchone()
        current_revision = current[0] if current else 0
        if expected_revision is not None and int(expected_revision) != current_revision:
            raise RuntimeError('USER_SECTOR_CONFIG_REVISION_CONFLICT')
        next_revision = current_revision + 1 if current else 1
        payload = json.dumps(sectors, ensure_ascii=False, separators=(',', ':'))
        conn.execute(
            'INSERT INTO user_sector_cards_config (user_id, config_json, revision, updated_at) '
            'VALUES (?, ?, ?, ?) '
            'ON CONFLICT(user_id) DO UPDATE SET config_json=excluded.config_json, '
            'revision=excluded.revision, updated_at=excluded.updated_at',
            (user_id, payload, next_revision, updated_at),
        )
        conn.commit()
        return {
            'sectors': sectors,
            'revision': next_revision,
            'updatedAt': updated_at,
            'customized': True,
        }
    except Exception:
        conn.rollback()
        raise


def delete_user_sector_cards_config(conn, user_id):
    conn.execute('DELETE FROM user_sector_cards_config WHERE user_id=?', (user_id,))
    conn.commit()


def upsert_google_user(conn, user, updated_at):
    google_sub = str(user.get('sub', '')).strip()
    email = str(user.get('email', '')).strip().lower()
    name = str(user.get('name', '')).strip()
    if not google_sub or not email:
        raise ValueError('Google user identity is incomplete')
    conn.execute(
        'INSERT INTO app_users (google_sub, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?) '
        'ON CONFLICT(google_sub) DO UPDATE SET email=excluded.email, name=excluded.name, updated_at=excluded.updated_at',
        (google_sub, email, name, updated_at, updated_at),
    )
    row = conn.execute('SELECT id FROM app_users WHERE google_sub=?', (google_sub,)).fetchone()
    conn.commit()
    return row[0]


def load_watchlist_config(conn, user_id):
    row = conn.execute(
        'SELECT config_json, revision, updated_at FROM watchlist_configs WHERE user_id=?',
        (user_id,),
    ).fetchone()
    if not row:
        return None
    try:
        config = json.loads(row[0])
    except (TypeError, ValueError) as exc:
        raise ValueError('watchlist_configs contains invalid JSON') from exc
    return {
        'items': config.get('items', []),
        'groups': config.get('groups', []),
        'revision': row[1],
        'updatedAt': row[2],
    }


def save_watchlist_config(conn, user_id, config, updated_at, expected_revision=None):
    conn.execute('BEGIN IMMEDIATE')
    try:
        current = conn.execute(
            'SELECT revision FROM watchlist_configs WHERE user_id=?',
            (user_id,),
        ).fetchone()
        current_revision = current[0] if current else 0
        if expected_revision is not None and int(expected_revision) != current_revision:
            raise RuntimeError('WATCHLIST_REVISION_CONFLICT')
        next_revision = current_revision + 1 if current else 1
        payload = json.dumps(config, ensure_ascii=False, separators=(',', ':'))
        conn.execute(
            'INSERT INTO watchlist_configs (user_id, config_json, revision, updated_at) VALUES (?, ?, ?, ?) '
            'ON CONFLICT(user_id) DO UPDATE SET config_json=excluded.config_json, '
            'revision=excluded.revision, updated_at=excluded.updated_at',
            (user_id, payload, next_revision, updated_at),
        )
        conn.commit()
        return {
            'items': config['items'],
            'groups': config['groups'],
            'revision': next_revision,
            'updatedAt': updated_at,
        }
    except Exception:
        conn.rollback()
        raise


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
    kiwoom_market.fetch_foreign_inst_daily()와 동일한 형식({date, close, change_pct,
    ind_net, foreign_net, inst_net})으로 반환."""
    rows = conn.execute(
        'SELECT date, close, change_pct, ind_net, foreign_net, inst_net FROM investor_flow_daily '
        'WHERE code=? ORDER BY date DESC',
        (code,),
    ).fetchall()
    return [
        {'date': r[0], 'close': r[1], 'change_pct': r[2], 'ind_net': r[3], 'foreign_net': r[4], 'inst_net': r[5]}
        for r in rows
    ]


def upsert_investor_flow_daily(conn, code, flow_rows):
    """KIS 확정 개인 수급을 포함한 종목별 일별 수급을 영속 저장한다.
    개인 데이터가 아직 잠정치로 None이면 기존에 저장된 확정치를 덮어쓰지 않는다."""
    if not flow_rows:
        return
    conn.executemany(
        'INSERT INTO investor_flow_daily (code, date, close, change_pct, ind_net, foreign_net, inst_net) '
        'VALUES (?, ?, ?, ?, ?, ?, ?) '
        'ON CONFLICT(code, date) DO UPDATE SET close=excluded.close, change_pct=excluded.change_pct, '
        'ind_net=COALESCE(excluded.ind_net, investor_flow_daily.ind_net), '
        'foreign_net=excluded.foreign_net, inst_net=excluded.inst_net',
        [(code, r['date'], r['close'], r['change_pct'], r.get('ind_net'), r['foreign_net'], r['inst_net'])
         for r in flow_rows],
    )


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


def upsert_future_orderbook(conn, symbol, ask_price, bid_price, ask_qty, bid_qty, updated_at):
    """KIS WebSocket 선물/옵션 1단계 호가를 저장한다.

    가격 틱과 호가 틱은 서로 다른 TR로 도착하므로, 호가만 갱신할 때 가격·등락
    데이터가 지워지지 않도록 별도 UPDATE를 사용한다.
    """
    cursor = conn.execute(
        'UPDATE future_prices SET ask_price=?, bid_price=?, ask_qty=?, bid_qty=?, updated_at=? WHERE symbol=?',
        (ask_price, bid_price, ask_qty, bid_qty, updated_at, symbol),
    )
    if cursor.rowcount == 0:
        conn.execute(
            'INSERT INTO future_prices '
            '(symbol, name, ask_price, bid_price, ask_qty, bid_qty, updated_at) '
            'VALUES (?, ?, ?, ?, ?, ?, ?)',
            (symbol, symbol, ask_price, bid_price, ask_qty, bid_qty, updated_at),
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


def load_future_chart_since(conn, symbol, since_date):
    """since_date: 'YYYYMMDD'. date >= since_date인 행만 - 위 load_future_chart의 limit_days는
    row 개수 제한이라 거래일 밀도가 다른 심볼끼리(채권은 주5일, BTC는 주7일) 'N일치' 의미가
    달라지는 문제가 있었음(예: 국고채 벤치마크가 20개월, 미국채는 13개월로 들쭉날쭉 - 2026-07-18
    사용자 지적으로 발견) - main.py의 /futures/avg가 심볼과 무관하게 정확히 같은 달력 기간을
    비교하고 싶을 때 이 함수를 쓴다."""
    rows = conn.execute(
        'SELECT date, open, high, low, close FROM future_chart WHERE symbol=? AND date>=? ORDER BY date',
        (symbol, since_date),
    ).fetchall()
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
        'SELECT symbol, name, price, change, change_rate, high, low, updated_at, oi, oi_change, '
        'ask_price, bid_price, ask_qty, bid_qty FROM future_prices'
    ).fetchall()
    return [
        {'symbol': r[0], 'name': r[1], 'price': r[2], 'change': r[3], 'change_rate': r[4],
         'high': r[5], 'low': r[6], 'updated_at': r[7], 'oi': r[8], 'oi_change': r[9],
         'ask_price': r[10], 'bid_price': r[11], 'ask_qty': r[12], 'bid_qty': r[13]}
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


def replace_option_flow_strikes(conn, rows):
    """최근월물 행사가별 옵션 수급 스냅샷을 교체한다.

    API가 최근월물 전체를 매번 내려주므로 이전 만기 행사가가 섞이지 않도록
    기존 상세 행을 한 번에 지운 뒤 새 스냅샷을 넣는다. 합계 option_flow 행은
    별도로 유지해 기존 카드·AI 해설과의 호환성을 보장한다.
    """
    conn.execute('DELETE FROM option_flow_strike')
    if rows:
        conn.executemany(
            'INSERT INTO option_flow_strike (side, strike, volume, oi, oi_change, updated_at) '
            'VALUES (?, ?, ?, ?, ?, ?)',
            rows,
        )
    conn.commit()


def load_option_flow_strikes(conn):
    rows = conn.execute(
        'SELECT side, strike, volume, oi, oi_change, updated_at '
        'FROM option_flow_strike ORDER BY strike'
    ).fetchall()
    return [
        {'side': r[0], 'strike': r[1], 'volume': r[2], 'oi': r[3], 'oi_change': r[4], 'updated_at': r[5]}
        for r in rows
    ]


def upsert_kis_flow_cache(conn, code, target_days, rows, updated_at):
    """kiwoom_market._daily_rows_from_kis_with_fallback_cache()가 KIS 성공 시 저장.
    rows는 json.dumps로 그대로 직렬화(dict/list라 별도 컬럼화 불필요)."""
    import json
    conn.execute(
        'INSERT INTO kis_flow_cache (code, target_days, updated_at, rows_json) VALUES (?, ?, ?, ?) '
        'ON CONFLICT(code, target_days) DO UPDATE SET '
        'updated_at=excluded.updated_at, rows_json=excluded.rows_json',
        (code, target_days, updated_at, json.dumps(rows, ensure_ascii=False)),
    )
    conn.commit()


def load_kis_flow_cache(conn, code, target_days):
    """(rows, updated_at) 튜플 또는 저장된 게 없으면 (None, None)."""
    import json
    row = conn.execute(
        'SELECT rows_json, updated_at FROM kis_flow_cache WHERE code=? AND target_days=?',
        (code, target_days),
    ).fetchone()
    if not row:
        return None, None
    return json.loads(row[0]), row[1]


def upsert_investor_trend_rows(conn, market, rows):
    """market: 'KOSPI'/'KOSDAQ'. rows: [{date('YYYYMMDD'), ind, frgn, orgn}, ...], 단위 억원.
    이미 확정된 과거일 값은 바뀌지 않지만 당일(장중) 행은 재조회 때마다 갱신돼야 하므로 UPSERT."""
    from datetime import datetime, timezone
    now_iso = datetime.now(timezone.utc).isoformat()
    conn.executemany(
        'INSERT INTO investor_trend_daily (market, date, ind_amt, frgn_amt, orgn_amt, updated_at) '
        'VALUES (?, ?, ?, ?, ?, ?) '
        'ON CONFLICT(market, date) DO UPDATE SET '
        'ind_amt=excluded.ind_amt, frgn_amt=excluded.frgn_amt, orgn_amt=excluded.orgn_amt, '
        'updated_at=excluded.updated_at',
        [(market, r['date'], r['ind'], r['frgn'], r['orgn'], now_iso) for r in rows],
    )
    conn.commit()


def load_investor_trend_daily(conn, market, limit_days=140):
    """market 하나의 오름차순(날짜순) 최근 limit_days개 - investor_trend.py의 주/월 집계가
    이 위에서 돈다."""
    rows = conn.execute(
        'SELECT date, ind_amt, frgn_amt, orgn_amt, updated_at FROM investor_trend_daily '
        'WHERE market=? ORDER BY date DESC LIMIT ?',
        (market, limit_days),
    ).fetchall()
    rows.reverse()
    return [
        {'date': r[0], 'ind': r[1], 'frgn': r[2], 'orgn': r[3], 'updated_at': r[4]}
        for r in rows
    ]


def upsert_volume_profile_daily(conn, code, trade_date, bins):
    """bins: [{price, volume}, ...] - 그날의 최신 누적 스냅샷으로 덮어쓴다(더하지 않음,
    pbar-tratio 응답 자체가 이미 그 시점까지의 누적치라서 - 스키마 주석 참고)."""
    from datetime import datetime, timezone
    now_iso = datetime.now(timezone.utc).isoformat()
    if not bins:
        return
    conn.executemany(
        'INSERT INTO volume_profile_daily (code, trade_date, price, volume, updated_at) '
        'VALUES (?, ?, ?, ?, ?) '
        'ON CONFLICT(code, trade_date, price) DO UPDATE SET '
        'volume=excluded.volume, updated_at=excluded.updated_at',
        [(code, trade_date, b['price'], b['volume'], now_iso) for b in bins],
    )
    conn.commit()


def load_volume_profile_days(conn, code, days, exclude_date=None):
    """code에 저장된 거래일 중 최신순 최대 days개(exclude_date가 있으면 그 날짜는 제외 -
    보통 오늘 날짜를 넘겨 호출부의 실시간 응답과 이중 반영되지 않게 한다)를 골라 가격별로
    거래량을 합산해 반환한다. 반환값: [{price, volume}, ...], 실제 반영된 거래일 수는
    len(dates)로 호출부에서 따로 알 수 있게 (rows, date_count) 튜플로 준다."""
    if exclude_date:
        date_rows = conn.execute(
            'SELECT DISTINCT trade_date FROM volume_profile_daily WHERE code=? AND trade_date<>? '
            'ORDER BY trade_date DESC LIMIT ?',
            (code, exclude_date, days),
        ).fetchall()
    else:
        date_rows = conn.execute(
            'SELECT DISTINCT trade_date FROM volume_profile_daily WHERE code=? ORDER BY trade_date DESC LIMIT ?',
            (code, days),
        ).fetchall()
    dates = [r[0] for r in date_rows]
    if not dates:
        return [], 0
    placeholders = ','.join('?' * len(dates))
    rows = conn.execute(
        'SELECT price, SUM(volume) FROM volume_profile_daily WHERE code=? AND trade_date IN (%s) '
        'GROUP BY price' % placeholders,
        [code] + dates,
    ).fetchall()
    return [{'price': r[0], 'volume': r[1]} for r in rows], len(dates)


def prune_volume_profile_daily(conn, cutoff_date):
    """cutoff_date('YYYY-MM-DD')보다 이전인 행을 지운다 - 배치 없이 조회할 때마다 쌓이기만
    하는 걸 막는 정리용(main.py가 주기적으로 호출)."""
    conn.execute('DELETE FROM volume_profile_daily WHERE trade_date<?', (cutoff_date,))
    conn.commit()


if __name__ == '__main__':
    conn = get_conn()
    create_schema(conn)
    conn.close()
    print('스키마 생성/확인 완료: %s' % DB_FILE)
