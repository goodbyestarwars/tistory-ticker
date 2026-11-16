# -*- coding: utf-8 -*-
"""OHLC ������ + �ݴ���Ż + ���� ���� SQLite DB ��Ű��.
daily_prices: ���� �Ϻ� 260�� - daily_scan.py�� INSERT.
fundamentals: DART �繫��ǥ ��� - migrate_fundamentals.py�� fundamentals_cache.json���� �̰�.
investor_flow_daily: ����/�ܱ���/��� �Ϻ� ���Ÿ� - daily_scan.py�� /foreign-flow�� INSERT.
investor_summary: ���ŵ�/�����ŷ�/����� ���(ka10014/ka20068/ka10059) - migrate_investor_summary.py��
batch_scan.py�� investor_flow_cache.json���� �̰�.
���� �ϳ��� SELECT ... WHERE code=?�� Ŀ�� ��ȸ�ϸ� ��ü ���� ���� �����ϰ� �޸𸮿�
���� 1���и� �ö󰡴� �� SQLite�� ���� �ٽ� ����(JSON ��ü �ε� �� �޸� 4�� ���� ������)."""

import os
import json
import sqlite3
from pathlib import Path

DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ohlc_snapshot.db')
SIGNAL_REVIEW_SCHEMA = '''CREATE TABLE IF NOT EXISTS signal_reviews (
    signal_id TEXT PRIMARY KEY, data_date TEXT NOT NULL,
    evaluated_at TEXT NOT NULL, payload TEXT NOT NULL)'''

SCHEMA = SIGNAL_REVIEW_SCHEMA + ';\n' + '''
CREATE TABLE IF NOT EXISTS volume_power_observations (
    session TEXT NOT NULL, slot INTEGER NOT NULL, observed_ts INTEGER NOT NULL,
    rank INTEGER NOT NULL, code TEXT NOT NULL, name TEXT, price REAL, change_rate REAL,
    strength REAL NOT NULL, trade_amount REAL,
    PRIMARY KEY(session, slot, code)
);
CREATE TABLE IF NOT EXISTS futures_flow_observations (
    session TEXT NOT NULL, observed_ts INTEGER NOT NULL,
    foreign_net INTEGER NOT NULL, institution_net INTEGER NOT NULL, individual_net INTEGER NOT NULL,
    details_json TEXT,
    PRIMARY KEY(session, observed_ts)
);
CREATE TABLE IF NOT EXISTS home_session_reference (
    symbol TEXT NOT NULL, session TEXT NOT NULL, reference REAL NOT NULL,
    ts INTEGER NOT NULL, PRIMARY KEY(symbol,session)
);
CREATE TABLE IF NOT EXISTS home_session_prices (
    symbol TEXT NOT NULL, session TEXT NOT NULL, slot INTEGER NOT NULL,
    open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL,
    ts INTEGER NOT NULL, PRIMARY KEY(symbol,session,slot)
);
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

-- ��û�� ���� �����ϴ� �����ְ� ��Ʈ �̷�. ��ġ/�˻���� daily_prices�� �и��Ѵ�.
CREATE TABLE IF NOT EXISTS chart_daily_prices (
    code TEXT NOT NULL, date TEXT NOT NULL, open REAL NOT NULL, high REAL NOT NULL,
    low REAL NOT NULL, close REAL NOT NULL, volume INTEGER NOT NULL,
    PRIMARY KEY (code, date)
);
CREATE TABLE IF NOT EXISTS chart_history_state (
    code TEXT PRIMARY KEY, earliest TEXT, extended INTEGER NOT NULL DEFAULT 0,
    checked_at TEXT
);
CREATE TABLE IF NOT EXISTS chart_history_fetches (
    date TEXT NOT NULL, code TEXT NOT NULL, PRIMARY KEY(date, code)
);

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

CREATE TABLE IF NOT EXISTS future_contracts (
    symbol TEXT PRIMARY KEY,
    contract_code TEXT NOT NULL
);

-- ��/ǲ �ɼ� ���� ���(��ü ���� �ջ��� �ƴ϶� �ֱٿ��� ���� 1�྿) - ������ �ƴ϶�
-- side(CALL/PUT) ���� ���踸 ����. �� ��簡�� �����ʹ� �������� �ʴ´�(�µ�ǵ� ���踸 �ʿ�).
  CREATE TABLE IF NOT EXISTS option_flow (
      side TEXT PRIMARY KEY,
      volume INTEGER,
      oi INTEGER,
      oi_change INTEGER,
      updated_at TEXT
  );

  -- �ڽ���200 �ɼ� �ֱٿ����� ��簡�� ���ڷ�. �հ� ī��� ������ ������
  -- ���������� ��/ǲ OI���ŷ��� ���������� �׸� �� �ְ� �Ѵ�.
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

-- 2026-07-19: KIS ���������ڸŸŵ���(�Ϻ�, FHPTJ04160001)�� 00:00~15:40(KST)�� TR
-- ��ü�� �����־(OPSQ2001 TIME LIMIT, kiwoom_market.py ����) �� �ð��뿣 ���� ����
-- ����� �����ؾ� �ϴµ�, �θ޸� ĳ�ô� ���� ������(�����) ������� SQLite�� �ű� -
-- daily_prices/investor_flow_daily�� �޸� batch_scan ����� �ƴ϶� �µ�ǵ�� "�׶��׶�
-- ��ȸ�� ����"�� ���δ�(������ �ƴ�, ������ Ŀ���� ���� - ����� �Ⱓ �������� 5�����̶�
-- �־��� ��쵵 "��ȸ�� ���� �� x 5"�� ����). rows_json�� kiwoom_market�� daily ��
-- ����Ʈ�� �״�� ����ȭ(�ٸ� *_json �÷��� ���� ����, fundamentals.annual_json ��).
CREATE TABLE IF NOT EXISTS kis_flow_cache (
    code TEXT NOT NULL,
    target_days INTEGER NOT NULL,
    updated_at TEXT,
    rows_json TEXT,
    PRIMARY KEY (code, target_days)
);

-- 2026-08-23: ��� �����ǰ�(invest_opinion.py, KIS ���������ǰ�)�� ����м� ������������
-- �µ�ǵ� ���̺� ȣ��(VM �޸� ĳ��)�� ������, ��Ʈ�˻�/�����˻�ó�� �� ���� ���� ������
-- �����ϴ� ���������� �ึ�� ���̺� ȣ���ϸ� �ʹ� ������(����� Ȯ��) �Ϸ� 1ȸ ��ġ��
-- �̸� ����� �����صδ� �뵵 - invest_opinion.summarize_opinions()�� ����� �״��
-- JSON ����ȭ�Ѵ�(���� �÷�ȭ ���ʿ�, kis_flow_cache�� ������ ����).
CREATE TABLE IF NOT EXISTS invest_opinions (
    code TEXT PRIMARY KEY,
    updated_at TEXT,
    summary_json TEXT
);

-- 2026-07-20: ���� ������ "�����ں� �Ÿ� ����" ����(�۾����ü� #4) - ���庰(�ڽ���/�ڽ���)
-- ����/�ܱ���/����� �Ϻ� ���ż�(���, KIS FHPTJ04040000 1�� �ҽ�, investor_trend.py ����).
-- 2026-07-21: �ڽ��� ���� ���忡�� �ڽ���/�ڽ��� ���� �������� Ȯ���ϸ� market �÷� �߰�
-- (PK�� date �ܵ����� (market, date) ����Ű�� ����) - _migrate_investor_trend_market()��
-- ���� ���� DB(�÷� ����)�� 'KOSPI'�� ���̱׷��̼��Ѵ�.
CREATE TABLE IF NOT EXISTS investor_trend_daily (
    market TEXT NOT NULL,
    date TEXT NOT NULL,
    ind_amt REAL,
    frgn_amt REAL,
    orgn_amt REAL,
    updated_at TEXT,
    index_close REAL,   -- 2026-10-12: KIS �Ϻ� ������ �������� ����(bstp_nmix_prpr). ������ ���� ���ż��� ������ ���� �Ⱓ�� ���ϴ� ȭ���
    PRIMARY KEY (market, date)
);

-- Half-hour observations from the existing KIS daily-value poll (���).
CREATE TABLE IF NOT EXISTS investor_trend_intraday (
    market TEXT NOT NULL,
    date TEXT NOT NULL,
    slot INTEGER NOT NULL,
    ind_amt REAL NOT NULL,
    frgn_amt REAL NOT NULL,
    orgn_amt REAL NOT NULL,
    frgn_high REAL NOT NULL,
    frgn_low REAL NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (market, date, slot)
);

-- 2026-08-05: ����м� �Ź��� ī�� "���� ü�ᰡ" ��(js/foreign-flow.js) - KIS pbar-tratio��
-- "����"�� �ֹǷ�, ��ȸ�� ������(kis_flow_cache�� ������ �µ�ǵ� ���� ���� - ��ġ ����)
-- �׳� �ֽ� ���� �������� ���ݺ��� UPSERT�� ���� �ŷ���ġ�� �ڿ��� �״´�. pbar-tratio
-- ��ü�� �̹� "�� ���������� ���� ����ġ"�� ���� �� �ȿ����� �� ������ ����⸸ �ϸ�
-- �ǰ�(������ ����), ��¥�� �ٲ�� �� ���� �� �̻� ���ŵ��� �ʾ� �׳��� ���� ����
-- ���������� �ڿ��� �����ȴ�. �µ�ǵ�� "��Ȯ�� �ֱ� N�ŷ���"�� �ƴ϶� "��ȸ�� ��
-- �ִ� ��¥ �� �ֱ� N��"���� ������ ��(main.py pbar_tratio ��������Ʈ ����).
CREATE TABLE IF NOT EXISTS volume_profile_daily (
    code TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    price REAL NOT NULL,
    volume REAL,
    updated_at TEXT,
    PRIMARY KEY (code, trade_date, price)
);
CREATE INDEX IF NOT EXISTS idx_volume_profile_daily_code ON volume_profile_daily(code);

-- User-managed ���ÿµ� ī�� ����. ���� �ü�/�м� ���̺��� �и��ϰ�,
-- ���� ���� JSON�� �� ������ ���������� ��ü�� �б� ���� ���̱׷��̼� ���⵵�� �����.
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

-- 2026-09-23 ����� ��û(�޸� ��� - "DB�� ���� ��������" -> �� ����Ҹ� ���� ������
-- ���� �̹� �ִ� Google �α��Ρ�watchlist_configs�� ���� ������ �����϶�� ������
-- Ȯ����). ����/���� �޸� �� �� �ϳ��� JSON �迭�� ���� - watchlist_configs�� ������
-- ����ڴ� 1�� + revision ������ ���ü� ����.
CREATE TABLE IF NOT EXISTS user_memos (
    user_id INTEGER PRIMARY KEY,
    memos_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
);

-- 2026-10-10 ��Ʈ ����(���������׶�̡����ʡ��ڽ������μ�) ���� ����. ����ڡ����񡤺� �ֱ�(day/week/month)�� 1��,
-- ��� 64KB ����(chart_drawings.py). �޸�� ���� revision ������ ���ü� ����.
CREATE TABLE IF NOT EXISTS user_chart_drawings (
    user_id INTEGER NOT NULL,
    code TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    drawings_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, code, timeframe),
    FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
);

-- ���ÿµ� ī���� ����ں� ������. sector_cards_config�� ��ڰ� ���� ���� �⺻���̰�,
-- �� ���̺��� ���� ���� ����ڸ� �⺻������ �б��Ѵ�.
CREATE TABLE IF NOT EXISTS user_sector_cards_config (
    user_id INTEGER PRIMARY KEY,
    config_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
);

-- 2026-10-02: ���ÿµ� '���� ���� ����' ��ǥ ������ 2�� ���� ���(money_picks.py). �Ϸ� �� �� 15:35 ����
-- ù ���� �� TOP10 �׸��� ��ǥ ���� 2~3���� �� ���� ���簡(rec_price)�� �����.
CREATE TABLE IF NOT EXISTS money_sector_picks (
    rec_date TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    theme TEXT NOT NULL,
    theme_rank INTEGER NOT NULL,
    rec_price REAL NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (rec_date, code)
);

-- 2026-10-02: ���� �ֿ����� '�߰� ����' ī��(Ȱ�� ���� ī���� ���� ���� ����)�� ��� ���� ���ߴ�
-- ����ں� ���. ���� ������ ���� ����ȭ�� �� ���� �����̴�(�� ��ϰ� ����).
CREATE TABLE IF NOT EXISTS user_top_picks (
    user_id INTEGER PRIMARY KEY,
    picks_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
);

-- 2026-08: ���� 2�� ���� ��õ�� ���� ������ ���� ������(2026-08-22: 4�ֿ��� 2�ַ�
-- � �Ⱓ ���, T+20 ���� ���� - monitor_swing_recommendations.py ����). legacy_*��
-- �� ���� �𵨰��� ȸ�� �񱳿��� �� ���� �ൿ�� �������� �ʴ´�. �������
-- daily_prices�� ����� ���� �� monitor_swing_recommendations.py�� T+5/T+10/T+20�� ä���.
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
    big_wave TEXT,
    mid_wave TEXT,
    small_wave TEXT,
    wave_diagnosis TEXT,
    wave_events_json TEXT,
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

-- 2026-09-02: ��ĵ(�����˻�/��Ʈ�˻�) ����� ���� ���� ����. ��ĵ ĳ�� JSON�� ����
-- ��°�� ����Ἥ "���� ���� ������ �� �� ��� �ƴ���"�� ��¤�� �ٰŰ� ������.
-- ��ĵ�� �� �� �׳��� ��Ʈ ����� ���ذ��� ���� ���ܵΰ�, ���ͷ��� ��ȸ ������
-- daily_prices�� ������ ����Ѵ�(�ߺ� ���� �� �� - �Ϻ��� �����Ǹ� ����� ���� ����).
-- scanner�� 'strategy:<ī�װ���id>' / 'pattern:<����Ű>' ������ ���ӽ����̽� ���ڿ�.
-- ���� �� �罺ĵ(rescan_patterns.py)�� ���Ƶ� �׳� ù ����� ���ذ��� �����Ѵ�
-- (INSERT OR IGNORE) - ���� �罺ĵ���� ������ ������ �������� ���� ���δ�.
CREATE TABLE IF NOT EXISTS scan_hits (
    scan_date TEXT NOT NULL,
    scanner TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    base_price REAL,
    score REAL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (scan_date, scanner, code)
);
CREATE INDEX IF NOT EXISTS idx_scan_hits_scanner_date ON scan_hits(scanner, scan_date);
CREATE INDEX IF NOT EXISTS idx_scan_hits_code ON scan_hits(code, scan_date);

-- ���� �긮��(2026-10-23): ���� �ŷ��� KST 07:00�� ������ �� �� Ȯ���ϴ� '�� ���� ��' ������.
-- �ŷ���(target_date)�� 1��. status='final'�̸� �� �ŷ��� �ȿ��� ���ΰ�ħ������ �����ͷ� ����� �ʴ´�
-- (������ morning_briefing.revise()�� �ϸ� first_confirmed_at �� �״�� �ΰ� revised_at/revision/revisions_json �� �����).
-- �ð��� ���� KST 'YYYY-MM-DD HH:MM:SS' ���ڿ�. ������ snapshot_json(�̱� ��ǥ���߰���������ȣ�����).
CREATE TABLE IF NOT EXISTS morning_briefing (
    target_date TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    snapshot_json TEXT,
    us_session_date TEXT,
    scheduled_at TEXT NOT NULL,
    first_confirmed_at TEXT,
    revised_at TEXT,
    revision INTEGER NOT NULL DEFAULT 0,
    revisions_json TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT,
    next_retry_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
-- ���� �̷�(�����������). �õ� 1ȸ���� 1��, ������ ���� morning_briefing.RUN_KEEP �Ǹ� ����� �����.
CREATE TABLE IF NOT EXISTS morning_briefing_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_date TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    trigger TEXT NOT NULL,
    outcome TEXT NOT NULL,
    detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_morning_briefing_runs_date ON morning_briefing_runs(target_date, id);

-- AI ���� �ڸ�Ʈ(2026-10-23): ������ ���� �м��� ��� ��ü�� Groq(GAS ����)�� �Ѱ� ���� ī�庰 �� �� �ؼ�.
-- ai_comments: ī��(slot)�� 1�� = ���� ȭ�鿡 ������ Ȯ�� �ڸ�Ʈ. text �� ������ ����� �͸� ����.
--   state/sig = �ڸ�Ʈ�� ���� ���� ���� ����, current_state/current_sig = ���� �ֱ� ���� ���� ����(���� �ٸ��� ��ȸ API�� �����).
-- ai_comment_history: ����� �ڸ�Ʈ ����(�ֱ� 14�� �ݺ� �����������). ai_comment_runs: Groq ȣ�� 1ȸ�� 1��(ȣ�ⷮ����ū������).
CREATE TABLE IF NOT EXISTS ai_comments (
    slot TEXT PRIMARY KEY,
    group_name TEXT NOT NULL,
    status TEXT NOT NULL,
    text TEXT,
    trade_date TEXT,
    data_asof TEXT,
    state TEXT,
    sig TEXT,
    current_state TEXT,
    current_sig TEXT,
    checked_at TEXT,
    facts_hash TEXT,
    angle TEXT,
    model TEXT,
    prompt_version TEXT,
    run_id INTEGER,
    generated_at TEXT,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_comment_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    text TEXT NOT NULL,
    angle TEXT,
    sig TEXT,
    state TEXT,
    data_asof TEXT,
    generated_at TEXT NOT NULL,
    model TEXT,
    prompt_version TEXT,
    run_id INTEGER,
    similarity REAL
);
CREATE INDEX IF NOT EXISTS idx_ai_comment_history_slot ON ai_comment_history(slot, id);
CREATE TABLE IF NOT EXISTS ai_comment_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_name TEXT NOT NULL,
    trade_date TEXT,
    trigger TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    outcome TEXT NOT NULL,
    calls INTEGER NOT NULL DEFAULT 0,
    slots_requested TEXT,
    slots_accepted TEXT,
    slots_rejected TEXT,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER,
    model TEXT,
    error TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_comment_runs_started ON ai_comment_runs(started_at);
'''


def get_conn(db_file=None, *, read_only=False):
    """timeout=600: daily_scan.py ���� ��ð� ��ġ�� ���� Ʈ������� ���� ��� ���� ��
    �ٸ� ��ũ��Ʈ(migrate_*.py ��)�� ��� 'database is locked' ������ ���� ���
    ��ٷȴٰ� ��õ��ϵ��� ��(������ ���� ���� - 2�����δ� �����ؼ� 10������ �ø�,
    ������ daily_scan.py�� 100���񸶴ٸ� Ŀ���ؼ� API�� ���� �� �� ������ 5�� �Ѱ� �ɸ�)."""
    if read_only:
        # WAL readers must not request a writer lock or change journal mode.
        uri = Path(db_file or DB_FILE).resolve().as_uri() + '?mode=ro'
        return sqlite3.connect(uri, uri=True, timeout=5)
    conn = sqlite3.connect(db_file or DB_FILE, timeout=600)
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA busy_timeout=600000')
    return conn


def _ensure_column(conn, table, column, coltype):
    """CREATE TABLE IF NOT EXISTS�� �̹� �ִ� ���̺��� �� �÷��� �߰������� �����Ƿ�,
    ���� � DB(future_prices)�� ���߿� �÷��� �ø� ��(��: OI) �� ���۷� ���̱׷��̼��Ѵ�."""
    cols = [r[1] for r in conn.execute('PRAGMA table_info(%s)' % table)]
    if column not in cols:
        conn.execute('ALTER TABLE %s ADD COLUMN %s %s' % (table, column, coltype))


def _migrate_investor_trend_market(conn):
    """investor_trend_daily�� PK=date �ܵ�(������)�̸� PK=(market, date)�� ������ϸ�
    ���� ���� ���� 'KOSPI'�� �±��Ѵ�. _ensure_column���δ� PK ��ü�� �� �ٲ㼭(SQLite
    �Ѱ�) ���̺� ������� �ʿ� - �� �����ʹ� KIS/���̹����� ����� ������ ���� �δ���
    �����Ƿ� �����ϰ� ó��."""
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
    _ensure_column(conn, 'futures_flow_observations', 'details_json', 'TEXT')
    # 2026-08-21 �ڵ� ����: fundamentals.fetch_stock()�� dividend Ű���� ��ȯ�ϴµ�
    # migrate_fundamentals.py�� �̰� INSERT�� �� ���̺� ��Ű���� �װ� ���� �÷��� ����
    # DART ��� �����Ͱ� SQLite �̰� �������� ��°�� �����ǰ� �־���. ���� �� ���̺���
    # �д� ���� �ڵ�� ����(���� fundamentals_cache.json�� ���� ����) � ȭ�� ������
    # ������, ���� �� ���̺��� ���� ����� ������ ���� ���� ���׸� �̸� ���Ƶд�.
    _ensure_column(conn, 'fundamentals', 'dividend_json', 'TEXT')
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
    _ensure_column(conn, 'swing_recommendation_snapshots', 'big_wave', 'TEXT')
    _ensure_column(conn, 'swing_recommendation_snapshots', 'mid_wave', 'TEXT')
    _ensure_column(conn, 'swing_recommendation_snapshots', 'small_wave', 'TEXT')
    _ensure_column(conn, 'swing_recommendation_snapshots', 'wave_diagnosis', 'TEXT')
    _ensure_column(conn, 'swing_recommendation_snapshots', 'wave_events_json', 'TEXT')
    _ensure_column(conn, 'swing_recommendation_snapshots', 't20_regime', 'TEXT')
    _ensure_column(conn, 'swing_recommendation_snapshots', 't20_regime_changed', 'INTEGER')
    _migrate_investor_trend_market(conn)
    # 2026-10-12: � ���� investor_trend_daily �� �������� ���� �÷��� ���Ѵ�(������ �߰�). ���� �÷� ���̱׷��̼��� ���̺��� �ٽ� ���� �ڿ� �����Ѵ�.
    _ensure_column(conn, 'investor_trend_daily', 'index_close', 'REAL')
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
    waves = snapshot.get('waves') or {}
    big_wave = waves.get('big') or {}
    mid_wave = waves.get('mid') or {}
    small_wave = waves.get('small') or {}
    wave_events = waves.get('recentEvents') or []
    conn.execute(
        '''INSERT INTO swing_recommendation_snapshots (
            as_of_date, code, name, model_version, close, chart_regime, current_regime,
            recent_event, recent_event_stage, auxiliary_states_json, big_wave, mid_wave,
            small_wave, wave_diagnosis, wave_events_json, turning_point,
            momentum_state, fundamental_state, risk_state, risk_reasons_json,
            holder_action, entry_opinion, internal_priority_score, legacy_score,
            legacy_stars, legacy_label, ma5, ma20, ma60, ma224, relative_strength,
            invalidation_condition, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(as_of_date, code, model_version) DO UPDATE SET
            name=excluded.name, close=excluded.close, chart_regime=excluded.chart_regime,
            current_regime=excluded.current_regime, recent_event=excluded.recent_event,
            recent_event_stage=excluded.recent_event_stage, auxiliary_states_json=excluded.auxiliary_states_json,
            big_wave=excluded.big_wave, mid_wave=excluded.mid_wave, small_wave=excluded.small_wave,
            wave_diagnosis=excluded.wave_diagnosis, wave_events_json=excluded.wave_events_json,
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
            big_wave.get('key') or big_wave.get('label'), mid_wave.get('key') or mid_wave.get('label'),
            small_wave.get('key') or small_wave.get('label'), waves.get('diagnosis') or snapshot.get('diagnosis'),
            json.dumps(wave_events, ensure_ascii=False),
            chart.get('turningPoint'), momentum.get('state'), fundamental.get('state'),
            risk.get('state'), json.dumps(risk.get('flags') or [], ensure_ascii=False),
            snapshot.get('holderAction'), snapshot.get('entryOpinion'),
            snapshot.get('internalPriorityScore'), legacy.get('score'), legacy.get('stars'),
            legacy.get('label'), ma.get('ma5'), ma.get('ma20'), ma.get('ma60'), ma.get('ma224'),
            chart.get('relativeStrength'), chart.get('invalidation'), now,
        ),
    )


def update_swing_snapshot_outcome(conn, as_of_date, code, model_version, outcomes):
    """Fill forward returns after T+5/T+10 become available.

    2026-08-22: � �Ⱓ�� 4��(T+5/T+10/T+20)���� 2��(T+5/T+10)�� �����鼭
    t20_return/t20_excess_return/t20_regime/t20_regime_changed�� �� UPDATE����
    ������ �����ߴ� - �÷� ��ü�� ���� ������ ȣȯ�� ���� DB ��Ű���� �״�� ���ܵε�
    (�� 4�� �� ���� �����Ͱ� �̹� ���� ���� ����), �����δ� �� �Լ��� �� �÷�����
    �ƿ� �ǵ帮�� �ʾƼ� ���� ���� �Ǽ��� NULL�� ������� ������ ����."""
    fields = ('t5_return', 't10_return', 't5_excess_return', 't10_excess_return', 'mfe', 'mae')
    values = [outcomes.get(field) for field in fields]
    values.extend([outcomes.get('outcomeUpdatedAt') or ''])
    conn.execute(
        '''UPDATE swing_recommendation_snapshots SET
           t5_return=?, t10_return=?, t5_excess_return=?,
           t10_excess_return=?, mfe=?, mae=?, outcome_updated_at=?
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
    """����� �������� ���������� �����ϰ� ���� �⺻ ī�忡�� �մ��� �ʴ´�."""
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


def load_user_top_picks(conn, user_id):
    """����� �߰� ���� ���. ���� ������ None(�̵���ȭ), ������ list."""
    row = conn.execute('SELECT picks_json FROM user_top_picks WHERE user_id=?', (user_id,)).fetchone()
    if not row:
        return None
    try:
        picks = json.loads(row[0])
    except (TypeError, ValueError):
        return []
    return picks if isinstance(picks, list) else []


def save_user_top_picks(conn, user_id, picks, updated_at):
    """������ ������ �̱��(����� �۰� �� ����� ���Ƿ� revision �浹 ó���� ���� �ʴ´�)."""
    payload = json.dumps(picks, ensure_ascii=False, separators=(',', ':'))
    conn.execute(
        'INSERT INTO user_top_picks (user_id, picks_json, updated_at) VALUES (?, ?, ?) '
        'ON CONFLICT(user_id) DO UPDATE SET picks_json=excluded.picks_json, updated_at=excluded.updated_at',
        (user_id, payload, updated_at),
    )
    conn.commit()
    return picks


def delete_user_sector_cards_config(conn, user_id):
    conn.execute('DELETE FROM user_sector_cards_config WHERE user_id=?', (user_id,))
    conn.commit()


def find_google_user_id(conn, user):
    row = conn.execute('SELECT id FROM app_users WHERE google_sub=?',
                       (str(user.get('sub', '')).strip(),)).fetchone()
    return row[0] if row else None


def upsert_google_user(conn, user, updated_at):
    google_sub = str(user.get('sub', '')).strip()
    email = str(user.get('email', '')).strip().lower()
    name = str(user.get('name', '')).strip()
    # ���̹� ����(google_sub='naver:<id>')�� �̸��� ���Ǹ� �� �� �־� email�� �� �ȴ�.
    if not google_sub or (not email and not google_sub.startswith('naver:')):
        raise ValueError('Google user identity is incomplete')
    conn.execute(
        'INSERT INTO app_users (google_sub, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?) '
        'ON CONFLICT(google_sub) DO UPDATE SET email=excluded.email, name=excluded.name, updated_at=excluded.updated_at',
        (google_sub, email, name, updated_at, updated_at),
    )
    user_id = find_google_user_id(conn, user)
    conn.commit()
    return user_id


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


def load_user_memos(conn, user_id):
    row = conn.execute(
        'SELECT memos_json, revision, updated_at FROM user_memos WHERE user_id=?',
        (user_id,),
    ).fetchone()
    if not row:
        return None
    try:
        items = json.loads(row[0])
    except (TypeError, ValueError) as exc:
        raise ValueError('user_memos contains invalid JSON') from exc
    return {
        'items': items if isinstance(items, list) else [],
        'revision': row[1],
        'updatedAt': row[2],
    }


def save_user_memos(conn, user_id, items, updated_at, expected_revision=None):
    conn.execute('BEGIN IMMEDIATE')
    try:
        current = conn.execute(
            'SELECT revision FROM user_memos WHERE user_id=?',
            (user_id,),
        ).fetchone()
        current_revision = current[0] if current else 0
        if expected_revision is not None and int(expected_revision) != current_revision:
            raise RuntimeError('MEMO_REVISION_CONFLICT')
        next_revision = current_revision + 1 if current else 1
        payload = json.dumps(items, ensure_ascii=False, separators=(',', ':'))
        conn.execute(
            'INSERT INTO user_memos (user_id, memos_json, revision, updated_at) VALUES (?, ?, ?, ?) '
            'ON CONFLICT(user_id) DO UPDATE SET memos_json=excluded.memos_json, '
            'revision=excluded.revision, updated_at=excluded.updated_at',
            (user_id, payload, next_revision, updated_at),
        )
        conn.commit()
        return {'items': items, 'revision': next_revision, 'updatedAt': updated_at}
    except Exception:
        conn.rollback()
        raise


def load_user_chart_drawings(conn, user_id, code, timeframe):
    row = conn.execute(
        'SELECT drawings_json, revision, updated_at FROM user_chart_drawings WHERE user_id=? AND code=? AND timeframe=?',
        (user_id, code, timeframe),
    ).fetchone()
    if not row:
        return {'drawings': None, 'revision': 0, 'updatedAt': None}
    try:
        drawings = json.loads(row[0])
    except (TypeError, ValueError) as exc:
        raise ValueError('user_chart_drawings contains invalid JSON') from exc
    return {'drawings': drawings, 'revision': row[1], 'updatedAt': row[2]}


def save_user_chart_drawings(conn, user_id, code, timeframe, drawings, updated_at,
                             expected_revision=None, delete_if_empty=False, max_rows=None):
    """revision�� �ٸ��� CHART_DRAWINGS_REVISION_CONFLICT, ����� �� ���� max_rows�� ������
    CHART_DRAWINGS_ROW_LIMIT. delete_if_empty�̸� ������ ��� ����� ���� �����(���� ȸ��)."""
    conn.execute('BEGIN IMMEDIATE')
    try:
        current = conn.execute(
            'SELECT revision FROM user_chart_drawings WHERE user_id=? AND code=? AND timeframe=?',
            (user_id, code, timeframe),
        ).fetchone()
        current_revision = current[0] if current else 0
        if expected_revision is not None and int(expected_revision) != current_revision:
            raise RuntimeError('CHART_DRAWINGS_REVISION_CONFLICT')
        if delete_if_empty:
            if current:
                conn.execute(
                    'DELETE FROM user_chart_drawings WHERE user_id=? AND code=? AND timeframe=?',
                    (user_id, code, timeframe),
                )
            conn.commit()
            return {'drawings': drawings, 'revision': current_revision + 1 if current else 0, 'updatedAt': updated_at}
        if not current and max_rows is not None:
            count = conn.execute('SELECT COUNT(*) FROM user_chart_drawings WHERE user_id=?', (user_id,)).fetchone()[0]
            if count >= max_rows:
                raise RuntimeError('CHART_DRAWINGS_ROW_LIMIT')
        next_revision = current_revision + 1
        payload = json.dumps(drawings, ensure_ascii=False, separators=(',', ':'))
        conn.execute(
            'INSERT INTO user_chart_drawings (user_id, code, timeframe, drawings_json, revision, updated_at) '
            'VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, code, timeframe) DO UPDATE SET '
            'drawings_json=excluded.drawings_json, revision=excluded.revision, updated_at=excluded.updated_at',
            (user_id, code, timeframe, payload, next_revision, updated_at),
        )
        conn.commit()
        return {'drawings': drawings, 'revision': next_revision, 'updatedAt': updated_at}
    except Exception:
        conn.rollback()
        raise


def load_daily_prices(conn, code):
    """daily_prices���� ������ �������� OHLC�� ���� kiwoom_market.fetch_daily_ohlc()��
    ������ �� ����({date, open, high, low, close, volume})���� ��ȯ.
    week52_scan.py/rescan_patterns.py�� ����(API ��ȣ�� ���� �� DB�� �д� ��ũ��Ʈ��)."""
    rows = conn.execute(
        'SELECT date, open, high, low, close, volume FROM daily_prices WHERE code=? ORDER BY date',
        (code,),
    ).fetchall()
    return [
        {'date': r[0], 'open': r[1], 'high': r[2], 'low': r[3], 'close': r[4], 'volume': r[5]}
        for r in rows
    ]


def latest_date(conn, table, code):
    """table(daily_prices �Ǵ� investor_flow_daily)���� ������ ���� �ֱ� ���� ��¥.
    daily_scan.py�� '������ �����Ͱ� �̹� ������ API ��ȣ�� ��ŵ'�� �Ǵ��ϴ� �� ��.
    table�� ȣ��� �ڵ忡 ���� ���ͷ��� �޴´�(����� �Է� �ƴ�) - f-string �����̶� ����."""
    assert table in ('daily_prices', 'investor_flow_daily')
    row = conn.execute('SELECT MAX(date) FROM %s WHERE code=?' % table, (code,)).fetchone()
    return row[0] if row else None


def load_investor_flow_daily(conn, code, limit=None):
    """investor_flow_daily���� ������ ��������(�ֽ��� �켱) ����
    kiwoom_market.fetch_foreign_inst_daily()�� ������ ����({date, close, change_pct,
    ind_net, foreign_net, inst_net})���� ��ȯ. limit�� ��ȸ â�� �����ϸ� ���� �̷��� �����Ѵ�."""
    query = (
        'SELECT date, close, change_pct, ind_net, foreign_net, inst_net FROM investor_flow_daily '
        'WHERE code=? ORDER BY date DESC')
    params = (code,)
    if limit is not None:
        if int(limit) < 1:
            raise ValueError('flow window must be positive')
        query += ' LIMIT ?'
        params += (int(limit),)
    rows = conn.execute(query, params).fetchall()
    return [
        {'date': r[0], 'close': r[1], 'change_pct': r[2], 'ind_net': r[3], 'foreign_net': r[4], 'inst_net': r[5]}
        for r in rows
    ]


def upsert_investor_flow_daily(conn, code, flow_rows):
    """KIS Ȯ�� ���� ������ ������ ���� �Ϻ� ������ ���� �����Ѵ�.
    ���� �����Ͱ� ���� ����ġ�� None�̸� ������ ����� Ȯ��ġ�� ����� �ʴ´�."""
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


def set_future_contract(conn, symbol, contract_code):
    """���� ��ü �� ���� ���� �Ϻ��� ������ �ʰ� �Ѵ�."""
    conn.execute('CREATE TABLE IF NOT EXISTS future_contracts ('
                 'symbol TEXT PRIMARY KEY, contract_code TEXT NOT NULL)')
    previous = conn.execute('SELECT contract_code FROM future_contracts WHERE symbol=?', (symbol,)).fetchone()
    if previous and previous[0] != contract_code:
        conn.execute('DELETE FROM future_chart WHERE symbol=?', (symbol,))
    conn.execute('INSERT INTO future_contracts (symbol, contract_code) VALUES (?, ?) '
                 'ON CONFLICT(symbol) DO UPDATE SET contract_code=excluded.contract_code',
                 (symbol, contract_code))
    conn.commit()


def load_future_contract(conn, symbol):
    try:
        row = conn.execute('SELECT contract_code FROM future_contracts WHERE symbol=?', (symbol,)).fetchone()
    except Exception:
        return None
    return row[0] if row else None


def upsert_future_price(conn, symbol, name, price, change, change_rate, high, low, updated_at, oi=None, oi_change=None):
    """oi/oi_change(�̰�������/����)�� KIS �ҽ�(�߰�����)�� ���� - ���� �ɺ��� None �״�� ����."""
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
    """KIS WebSocket ����/�ɼ� 1�ܰ� ȣ���� �����Ѵ�.

    ���� ƽ�� ȣ�� ƽ�� ���� �ٸ� TR�� �����ϹǷ�, ȣ���� ������ �� ���ݡ����
    �����Ͱ� �������� �ʵ��� ���� UPDATE�� ����Ѵ�.
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
    """rows: [{date, open, high, low, close}, ...]. �ߺ� INSERT�� PRIMARY KEY(symbol,date) UPSERT�� ����."""
    def normalize_date(value):
        return str(value or '').replace('-', '')[:8]

    conn.executemany(
        'INSERT INTO future_chart (symbol, date, open, high, low, close) VALUES (?, ?, ?, ?, ?, ?) '
        'ON CONFLICT(symbol, date) DO UPDATE SET '
        'open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close',
        [(symbol, normalize_date(r['date']), r['open'], r['high'], r['low'], r['close']) for r in rows],
    )
    conn.commit()


def _canonical_future_chart_rows(rows):
    """���� YYYY-MM-DD ��� ǥ�� YYYYMMDD ���� ���� �Ⱓ�� ���ġ��ߺ� �����Ѵ�."""
    by_date = {}
    for row in rows:
        date = str(row[0] or '').replace('-', '')[:8]
        if len(date) != 8 or not date.isdigit():
            continue
        item = {'date': date, 'open': row[1], 'high': row[2], 'low': row[3], 'close': row[4]}
        if date not in by_date or str(row[0]) == date:
            by_date[date] = item
    return [by_date[key] for key in sorted(by_date)]


def load_future_chart(conn, symbol, limit_days=90):
    rows = conn.execute(
        'SELECT date, open, high, low, close FROM future_chart WHERE symbol=?',
        (symbol,),
    ).fetchall()
    return _canonical_future_chart_rows(rows)[-limit_days:]


def load_future_chart_since(conn, symbol, since_date):
    """since_date: 'YYYYMMDD'. date >= since_date�� �ุ - �� load_future_chart�� limit_days��
    row ���� �����̶� �ŷ��� �е��� �ٸ� �ɺ�����(ä���� ��5��, BTC�� ��7��) 'N��ġ' �ǹ̰�
    �޶����� ������ �־���(��: ����ä ��ġ��ũ�� 20����, �̱�ä�� 13������ ���߳��� - 2026-07-18
    ����� �������� �߰�) - main.py�� /futures/avg�� �ɺ��� �����ϰ� ��Ȯ�� ���� �޷� �Ⱓ��
    ���ϰ� ���� �� �� �Լ��� ����."""
    rows = conn.execute(
        'SELECT date, open, high, low, close FROM future_chart WHERE symbol=?',
        (symbol,),
    ).fetchall()
    return [row for row in _canonical_future_chart_rows(rows) if row['date'] >= since_date]


def upsert_future_chart_minute_rows(conn, symbol, rows):
    """rows: [{ts, open, high, low, close}, ...], ts�� UTC epoch��(����)."""
    conn.executemany(
        'INSERT INTO future_chart_minute (symbol, ts, open, high, low, close) VALUES (?, ?, ?, ?, ?, ?) '
        'ON CONFLICT(symbol, ts) DO UPDATE SET '
        'open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close',
        [(symbol, r['ts'], r['open'], r['high'], r['low'], r['close']) for r in rows],
    )
    conn.commit()


def load_future_chart_minute(conn, symbol, limit_bars=1500):
    """�ֱ� limit_bars�� 1�к�(�뷫 �ֱ� 3~4�ŷ���ġ, �Ϸ� ������ ���� �� 390��)."""
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
    """�ֱٿ��� ��簡�� �ɼ� ���� �������� ��ü�Ѵ�.

    API�� �ֱٿ��� ��ü�� �Ź� �����ֹǷ� ���� ���� ��簡�� ������ �ʵ���
    ���� �� ���� �� ���� ���� �� �� �������� �ִ´�. �հ� option_flow ����
    ������ ������ ���� ī�塤AI �ؼ����� ȣȯ���� �����Ѵ�.
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
    """kiwoom_market._daily_rows_from_kis_with_fallback_cache()�� KIS ���� �� ����.
    rows�� json.dumps�� �״�� ����ȭ(dict/list�� ���� �÷�ȭ ���ʿ�)."""
    import json
    conn.execute(
        'INSERT INTO kis_flow_cache (code, target_days, updated_at, rows_json) VALUES (?, ?, ?, ?) '
        'ON CONFLICT(code, target_days) DO UPDATE SET '
        'updated_at=excluded.updated_at, rows_json=excluded.rows_json',
        (code, target_days, updated_at, json.dumps(rows, ensure_ascii=False)),
    )
    conn.commit()


def load_kis_flow_cache(conn, code, target_days):
    """(rows, updated_at) Ʃ�� �Ǵ� ����� �� ������ (None, None)."""
    import json
    row = conn.execute(
        'SELECT rows_json, updated_at FROM kis_flow_cache WHERE code=? AND target_days=?',
        (code, target_days),
    ).fetchone()
    if not row:
        return None, None
    return json.loads(row[0]), row[1]


def upsert_invest_opinion(conn, code, summary, updated_at):
    """invest_opinion_scan.py(�Ϸ� 1ȸ ��ġ)�� ���� �ϳ��� ����� ����. ��Ʈ�˻�/�����˻���
    �ึ�� KIS�� ���̺�� ȣ������ �ʰ� �� ���� �״�� �����Ѵ�."""
    import json
    conn.execute(
        'INSERT INTO invest_opinions (code, updated_at, summary_json) VALUES (?, ?, ?) '
        'ON CONFLICT(code) DO UPDATE SET updated_at=excluded.updated_at, summary_json=excluded.summary_json',
        (code, updated_at, json.dumps(summary, ensure_ascii=False)),
    )
    conn.commit()


def load_invest_opinions(conn, codes=None):
    """{code: summary_dict} - codes�� �ָ� �� ����鸸, �����ϸ� ����� ��ü�� ��ȯ�Ѵ�."""
    import json
    if codes:
        placeholders = ','.join('?' for _ in codes)
        rows = conn.execute(
            'SELECT code, summary_json FROM invest_opinions WHERE code IN (%s)' % placeholders,
            list(codes),
        ).fetchall()
    else:
        rows = conn.execute('SELECT code, summary_json FROM invest_opinions').fetchall()
    result = {}
    for code, summary_json in rows:
        try:
            result[code] = json.loads(summary_json)
        except (TypeError, ValueError):
            continue
    return result


def upsert_investor_trend_rows(conn, market, rows):
    """market: 'KOSPI'/'KOSDAQ'. rows: [{date('YYYYMMDD'), ind, frgn, orgn, index(����)}, ...], �ݾ� ���� ���.
    �̹� Ȯ���� ������ ���� �ٲ��� ������ ����(����) ���� ����ȸ ������ ���ŵž� �ϹǷ� UPSERT.
    index(�������� ����)�� ���� ȣ��(���̹���Ű�� ���� ��)�� �̹� ����� ���� ������ ������ �ʰ� COALESCE �Ѵ�."""
    from datetime import datetime, timezone
    now_iso = datetime.now(timezone.utc).isoformat()
    _ensure_column(conn, 'investor_trend_daily', 'index_close', 'REAL')  # ���̱׷��̼� �� DB ���� �����ϰ�(�̹� ������ �ƹ� �ϵ� �� ��)
    conn.executemany(
        'INSERT INTO investor_trend_daily (market, date, ind_amt, frgn_amt, orgn_amt, updated_at, index_close) '
        'VALUES (?, ?, ?, ?, ?, ?, ?) '
        'ON CONFLICT(market, date) DO UPDATE SET '
        'ind_amt=excluded.ind_amt, frgn_amt=excluded.frgn_amt, orgn_amt=excluded.orgn_amt, '
        'updated_at=excluded.updated_at, index_close=COALESCE(excluded.index_close, investor_trend_daily.index_close)',
        [(market, r['date'], r['ind'], r['frgn'], r['orgn'], now_iso, r.get('index')) for r in rows],
    )
    conn.commit()


def delete_investor_trend_non_trading(conn, market, first_date, last_date, trading_dates):
    """first_date~last_date(YYYYMMDD) ���̿��� trading_dates(�ŷ��Ұ� ������ ������ �ŷ���)�� ���� ��¥�� ���� �����.
    ���� ��¥�� ������ �ָ��������Ͽ� �ְ� �հ� ���� ���� �߸� ������ ��(2026-10-12 � �ڽ��ڿ��� �ָ� 8�� Ȯ��)�� �ٷ���´�.
    �ŷ��� ����� KIS �� �� ���� �� �� 300�������̹Ƿ� �� ���� ���� ��ŷ��ϸ� �����, ���� ���� �ǵ帮�� �ʴ´�. ���� ��¥ ����� �����ش�."""
    trading = set(trading_dates)
    rows = conn.execute('SELECT date FROM investor_trend_daily WHERE market=? AND date>=? AND date<=?',
                        (market, first_date, last_date)).fetchall()
    stale = sorted(r[0] for r in rows if r[0] not in trading)
    if stale:
        conn.executemany('DELETE FROM investor_trend_daily WHERE market=? AND date=?', [(market, d) for d in stale])
        conn.commit()
    return stale


def load_investor_trend_daily(conn, market, limit_days=140):
    """market �ϳ��� ��������(��¥��) �ֱ� limit_days�� - investor_trend.py�� ��/�� ���谡
    �� ������ ����. index_close �� 2026-10-12 �� ������ ���̶� ������ None."""
    # index_close �÷��� create_schema �� �� �� ���ƾ� �����. ���� ���̱׷��̼� ���� DB(���� ���� �ٸ� ���μ��� ��)�� ���� �� �ְ� NULL �� ����Ѵ�.
    has_index = 'index_close' in [c[1] for c in conn.execute('PRAGMA table_info(investor_trend_daily)')]
    rows = conn.execute(
        'SELECT date, ind_amt, frgn_amt, orgn_amt, updated_at, %s FROM investor_trend_daily '
        'WHERE market=? ORDER BY date DESC LIMIT ?' % ('index_close' if has_index else 'NULL'),
        (market, limit_days),
    ).fetchall()
    rows.reverse()
    return [
        {'date': r[0], 'ind': r[1], 'frgn': r[2], 'orgn': r[3], 'updated_at': r[4], 'index': r[5]}
        for r in rows
    ]


def upsert_volume_profile_daily(conn, code, trade_date, bins):
    """bins: [{price, volume}, ...] - �׳��� �ֽ� ���� ���������� �����(������ ����,
    pbar-tratio ���� ��ü�� �̹� �� ���������� ����ġ�� - ��Ű�� �ּ� ����)."""
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
    """code�� ����� �ŷ��� �� �ֽż� �ִ� days��(exclude_date�� ������ �� ��¥�� ���� -
    ���� ���� ��¥�� �Ѱ� ȣ����� �ǽð� ����� ���� �ݿ����� �ʰ� �Ѵ�)�� ��� ���ݺ���
    �ŷ����� �ջ��� ��ȯ�Ѵ�. ��ȯ��: [{price, volume}, ...], ���� �ݿ��� �ŷ��� ����
    len(dates)�� ȣ��ο��� ���� �� �� �ְ� (rows, date_count) Ʃ�÷� �ش�."""
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
    """cutoff_date('YYYY-MM-DD')���� ������ ���� ����� - ��ġ ���� ��ȸ�� ������ ���̱⸸
    �ϴ� �� ���� ������(main.py�� �ֱ������� ȣ��)."""
    conn.execute('DELETE FROM volume_profile_daily WHERE trade_date<?', (cutoff_date,))
    conn.commit()


def list_volume_profile_codes(conn, since_date):
    """since_date('YYYY-MM-DD') ���� volume_profile_daily�� ����� �� �ִ� �����ڵ�, �ֱ� ������ ��.
    volume_profile_collector.py�� "�ֱ� ��ȸ�������� ����"�� ���� ���� ��� ���� �� ����."""
    rows = conn.execute(
        'SELECT code, MAX(trade_date) AS last_date FROM volume_profile_daily WHERE trade_date>=? '
        'GROUP BY code ORDER BY last_date DESC, code',
        (since_date,),
    ).fetchall()
    return [r[0] for r in rows]


if __name__ == '__main__':
    conn = get_conn()
    create_schema(conn)
    conn.close()
    print('��Ű�� ����/Ȯ�� �Ϸ�: %s' % DB_FILE)

