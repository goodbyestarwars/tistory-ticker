# -*- coding: utf-8 -*-
"""아침 라이브 갭상승 그림자 검색기 (2026-10-16, Issue #697 승인).

배경: 기존 `openingGap` 검색기는 평일 20:10 일봉 배치가 "그날 시가 대비 더 오른 종목"을 골라, 포착 시점에는
이미 지난 상승(시가→종가 평균 +8%대)을 보여 줬다. 투자자가 실제로 살 수 있었던 가격과 다르다. 이 모듈은
기존 검색기를 대체하지 않고 **옆에서 기록만 하는** 별도 검색기다 - 장중에 실제로 볼 수 있었던 정보만으로
신호를 만들고, 그 뒤 가격 경로(MAE/MFE)와 D+1~D+5 성과를 남겨 손익비로 평가한다. 주문·매매 연결은 없다.

재사용: `volume_surge_live`가 30초마다 받는 KIS 순위 행(추가 외부 호출 없음). 순위 응답에는 시가·고저가
필드가 없으므로(미확인) 시초가·첫 5분 고저는 30초 관측가로 만든다 - 공식 OHLC가 아니다.

규칙(사전 고정, 장 마감 뒤 확정되는 정보는 쓰지 않는다):
- 시초 관측가: 09:00:00~09:03:00 사이 첫 관측(누적 거래량 > 0). 그 구간에 못 보면 그날 신호 없음.
- 갭% = 시초 관측가 / 전일 종가 - 1, GAP_MIN~GAP_MAX 안만.
- 시초 범위(OR): 09:00~09:05 관측가의 고가·저가.
- 신호: 09:05~14:00 중 첫 폴링에서 현재가 > OR 고가, 현재가 >= 시초 관측가, 누적 거래량/전일 거래량 >=
  CUM_RATIO_MIN. 종목·거래일당 첫 신호 1건.
- 가상 진입: 신호 폴링 **다음** 폴링의 관측가(지연 반영). 신호가는 따로 저장.
- 손절 후보가 = OR 저가, 손절폭이 MAX_STOP_PCT를 넘으면 risk_ok=0(기록은 하되 따로 집계).
- 신호 뒤 장중 MAE/MFE는 30초 관측가로, D0~D5는 일봉으로 채운다. D0 일봉 고저는 진입 전 구간을 포함하므로
  손절 판정에 쓰지 않고(OR 저가가 그날 저가에 이미 들어 있다) 장중 관측 경로만 쓴다.
"""

import json
import logging
import os
import sqlite3
import threading
import time
from contextlib import closing
from datetime import datetime, timedelta, timezone

logger = logging.getLogger('gap_shadow')

KST = timezone(timedelta(hours=9))
DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'gap_shadow.db')

# ---- 규칙 상수 (바꾸면 docs/DB_SPEC.md·테스트·이슈 #697 기록도 함께) ----
OPEN_OBS_END = 9 * 3600 + 3 * 60       # 시초 관측가는 이 시각까지 첫 관측이어야 한다
OR_END = 9 * 3600 + 5 * 60             # 시초 범위(첫 5분) 끝
SIGNAL_END = 14 * 3600                 # 신호 허용 마감
GAP_MIN = 1.0
GAP_MAX = 8.0
CUM_RATIO_MIN = 0.05                   # 누적 거래량 / 전일 거래량
MAX_STOP_PCT = 4.0                     # 손절폭이 이보다 멀면 risk_ok=0
COST_PCT = 0.7                         # 왕복 비용 가정(이슈 #697)
DAILY_DAYS = 6                         # D0~D5
MIN_SAMPLE = 15
OUTCOME_REFRESH_SEC = 30 * 60
PATH_GAP_MAX_SEC = 120                 # 진입 뒤 관측 간격이 이보다 길면 장중 경로가 불완전(순위권 이탈·재시작 등)
PATH_END_SOD = 15 * 3600 + 20 * 60     # 마지막 관측이 이 시각 이후여야 장 마감까지 본 것으로 친다

DDL = '''
CREATE TABLE IF NOT EXISTS gap_shadow_signal (
    trading_date TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT,
    prev_close REAL,
    prev_volume REAL,
    open_obs_at TEXT,
    open_obs_price REAL,
    gap_pct REAL,
    or_high REAL,
    or_low REAL,
    signal_at TEXT NOT NULL,
    signal_price REAL NOT NULL,
    signal_cum_volume REAL,
    signal_cum_ratio REAL,
    entry_at TEXT,
    entry_price REAL,
    stop_price REAL,
    stop_pct REAL,
    risk_ok INTEGER,
    intraday_max REAL,
    intraday_min REAL,
    intraday_last REAL,
    intraday_updated_at TEXT,
    stop_hit_intraday INTEGER NOT NULL DEFAULT 0,
    daily_json TEXT,
    outcome_days INTEGER NOT NULL DEFAULT 0,
    outcome_updated_at TEXT,
    path_obs_count INTEGER,
    path_last_obs_ts REAL,
    path_max_gap_sec REAL,
    official_open REAL,
    PRIMARY KEY (trading_date, code)
)'''

_lock = threading.Lock()
_day = {'date': None, 'obs': {}, 'prev': {}}
_runtime = {'date': None, 'polls': 0, 'lastObserveAt': None}
_last_outcome_run = 0.0


def _iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


def _num(value):
    try:
        if value in (None, ''):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def sod(now_kst):
    return now_kst.hour * 3600 + now_kst.minute * 60 + now_kst.second


NEW_COLUMNS = (('path_obs_count', 'INTEGER'), ('path_last_obs_ts', 'REAL'), ('path_max_gap_sec', 'REAL'),
               ('official_open', 'REAL'))


def connect(db_file=None):
    conn = sqlite3.connect(db_file or DB_FILE, timeout=5)
    conn.execute(DDL)
    have = {r[1] for r in conn.execute('PRAGMA table_info(gap_shadow_signal)').fetchall()}
    for name, kind in NEW_COLUMNS:       # 2026-10-16 사후 리뷰 보완: 먼저 만들어진 DB에도 열을 덧붙인다
        if name not in have:
            conn.execute('ALTER TABLE gap_shadow_signal ADD COLUMN %s %s' % (name, kind))
    return conn


# ---------------------------------------------------------------- 신호 판정(순수 함수)

def new_obs(prev_close, prev_volume):
    return {'prev_close': prev_close, 'prev_volume': prev_volume, 'status': 'WATCH',
            'first_t': None, 'first_price': None, 'gap_pct': None, 'or_high': None, 'or_low': None,
            'signal': None, 'entry': None}


def step(ob, t_sod, ts, price, volume):
    """관측 한 건을 반영한다. 반환: 'SIGNAL' | 'ENTRY' | None.

    상태: WATCH(감시) -> SIGNALED(신호, 다음 관측 대기) -> ENTERED(가상 진입 후 경로 추적).
    NO_OPEN(시초 관측 실패)·GAP_OUT(갭 범위 밖)은 그날 더는 보지 않는다.
    """
    if not price or price <= 0:
        return None
    status = ob['status']
    if status in ('NO_OPEN', 'GAP_OUT'):
        return None
    if status == 'ENTERED':
        e = ob['entry']
        e['max'] = max(e['max'], price)
        e['min'] = min(e['min'], price)
        e['last'] = price
        if e.get('last_ts'):
            e['max_gap'] = max(e.get('max_gap') or 0, ts - e['last_ts'])
        e['count'] = (e.get('count') or 0) + 1
        e['last_ts'] = ts
        e['updated_at'] = ts
        if price <= e['stop_price']:
            e['stop_hit'] = 1
        return None
    if status == 'SIGNALED':
        stop = ob['or_low']
        stop_pct = (price - stop) / price * 100 if price > 0 else None
        ob['entry'] = {
            'at': ts, 'price': price, 'stop_price': stop, 'stop_pct': stop_pct,
            'risk_ok': int(stop_pct is not None and 0 < stop_pct <= MAX_STOP_PCT),
            'max': price, 'min': price, 'last': price, 'updated_at': ts,
            'stop_hit': int(price <= stop), 'count': 1, 'last_ts': ts, 'max_gap': 0,
        }
        ob['status'] = 'ENTERED'
        return 'ENTRY'
    # WATCH
    if ob['first_t'] is None:
        if not volume or volume <= 0:
            return None  # 아직 체결 전(예상가일 수 있음) - 시초 관측으로 쓰지 않는다
        if t_sod > OPEN_OBS_END:
            ob['status'] = 'NO_OPEN'
            return None
        prev_close = ob['prev_close']
        if not prev_close or prev_close <= 0:
            ob['status'] = 'NO_OPEN'
            return None
        gap = (price / prev_close - 1) * 100
        ob['first_t'], ob['first_price'], ob['gap_pct'] = ts, price, gap
        ob['or_high'] = ob['or_low'] = price
        if not (GAP_MIN <= gap <= GAP_MAX):
            ob['status'] = 'GAP_OUT'
        return None
    if t_sod <= OR_END:
        ob['or_high'] = max(ob['or_high'], price)
        ob['or_low'] = min(ob['or_low'], price)
        return None
    if t_sod > SIGNAL_END:
        return None
    if price <= ob['or_high'] or price < ob['first_price']:
        return None
    prev_volume = ob['prev_volume']
    if not prev_volume or prev_volume <= 0 or not volume:
        return None
    ratio = volume / prev_volume
    if ratio < CUM_RATIO_MIN:
        return None
    ob['signal'] = {'at': ts, 'price': price, 'volume': volume, 'ratio': ratio}
    ob['status'] = 'SIGNALED'
    return 'SIGNAL'


# ---------------------------------------------------------------- 저장

def _insert_signal(conn, date_str, code, name, ob):
    sig = ob['signal']
    conn.execute(
        'INSERT OR IGNORE INTO gap_shadow_signal (trading_date, code, name, prev_close, prev_volume, '
        'open_obs_at, open_obs_price, gap_pct, or_high, or_low, signal_at, signal_price, '
        'signal_cum_volume, signal_cum_ratio) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        (date_str, code, name, ob['prev_close'], ob['prev_volume'], _iso(ob['first_t']), ob['first_price'],
         round(ob['gap_pct'], 3), ob['or_high'], ob['or_low'], _iso(sig['at']), sig['price'], sig['volume'],
         round(sig['ratio'], 5)))


def _save_entry(conn, date_str, code, ob):
    e = ob['entry']
    conn.execute(
        'UPDATE gap_shadow_signal SET entry_at=?, entry_price=?, stop_price=?, stop_pct=?, risk_ok=?, '
        'intraday_max=?, intraday_min=?, intraday_last=?, intraday_updated_at=?, stop_hit_intraday=?, '
        'path_obs_count=?, path_last_obs_ts=?, path_max_gap_sec=? '
        'WHERE trading_date=? AND code=? AND entry_at IS NULL',
        (_iso(e['at']), e['price'], e['stop_price'], round(e['stop_pct'], 3) if e['stop_pct'] is not None else None,
         e['risk_ok'], e['max'], e['min'], e['last'], _iso(e['updated_at']), e['stop_hit'],
         e['count'], e['last_ts'], e['max_gap'], date_str, code))


def _save_path(conn, date_str, code, ob):
    e = ob['entry']
    conn.execute(
        'UPDATE gap_shadow_signal SET intraday_max=?, intraday_min=?, intraday_last=?, intraday_updated_at=?, '
        'stop_hit_intraday=?, path_obs_count=?, path_last_obs_ts=?, path_max_gap_sec=? WHERE trading_date=? AND code=?',
        (e['max'], e['min'], e['last'], _iso(e['updated_at']), e['stop_hit'],
         e['count'], e['last_ts'], e['max_gap'], date_str, code))


def _restore_day(conn, date_str):
    """같은 날 프로세스가 재시작돼도 이미 기록한 신호·가상 진입·경로를 이어 간다."""
    obs = {}
    for row in conn.execute(
            'SELECT code, prev_close, prev_volume, open_obs_price, gap_pct, or_high, or_low, signal_price, '
            'signal_cum_volume, signal_cum_ratio, entry_price, stop_price, stop_pct, risk_ok, '
            'intraday_max, intraday_min, intraday_last, stop_hit_intraday, path_obs_count, path_last_obs_ts, '
            'path_max_gap_sec FROM gap_shadow_signal WHERE trading_date=?',
            (date_str,)).fetchall():
        (code, prev_close, prev_volume, open_price, gap, or_high, or_low, sig_price, sig_vol, sig_ratio,
         entry_price, stop_price, stop_pct, risk_ok, imax, imin, ilast, stop_hit, obs_count, last_ts, max_gap) = row
        ob = new_obs(prev_close, prev_volume)
        ob.update({'first_t': 0, 'first_price': open_price, 'gap_pct': gap, 'or_high': or_high, 'or_low': or_low,
                   'signal': {'at': 0, 'price': sig_price, 'volume': sig_vol, 'ratio': sig_ratio}})
        if entry_price is None:
            ob['status'] = 'SIGNALED'
        else:
            ob['status'] = 'ENTERED'
            ob['entry'] = {'at': 0, 'price': entry_price, 'stop_price': stop_price, 'stop_pct': stop_pct,
                           'risk_ok': risk_ok, 'max': imax if imax is not None else entry_price,
                           'min': imin if imin is not None else entry_price,
                           'last': ilast if ilast is not None else entry_price, 'updated_at': 0,
                           'stop_hit': stop_hit or 0, 'count': obs_count or 1, 'last_ts': last_ts,
                           'max_gap': max_gap or 0}
        obs[code] = ob
    return obs


def _prev_lookup(conn, date_str, code):
    cache = _day['prev']
    if code not in cache:
        row = conn.execute(
            'SELECT close, volume FROM daily_prices WHERE code=? AND date<? AND close>0 AND volume>0 '
            'ORDER BY date DESC LIMIT 1', (code, date_str)).fetchone()
        cache[code] = (float(row[0]), float(row[1])) if row else None
    return cache[code]


def in_signal_session(now_kst):
    import market_clock
    if not market_clock.is_kr_trading_day(now_kst):
        return False
    t = sod(now_kst)
    return 9 * 3600 <= t <= 15 * 3600 + 35 * 60


def observe(rows, now_kst, prices_conn, db_file=None):
    """volume_surge_live가 30초마다 받은 순위 행으로 호출한다. 실패해도 호출한 쪽을 막지 않도록 예외는 삼킨다."""
    try:
        return _observe(rows, now_kst, prices_conn, db_file)
    except Exception:
        logger.exception('갭 그림자 검색기 관측 실패')
        return None


def _observe(rows, now_kst, prices_conn, db_file=None):
    if not in_signal_session(now_kst):
        return None
    date_str = now_kst.strftime('%Y-%m-%d')
    ts = now_kst.timestamp()
    t = sod(now_kst)
    events = []
    with closing(connect(db_file)) as conn:
        with _lock:
            if _day['date'] != date_str:
                _day.update({'date': date_str, 'obs': _restore_day(conn, date_str), 'prev': {}})
            obs = _day['obs']
        latest = {}
        for row in rows or []:
            code = (row.get('code') or '').strip()
            if code:
                latest[code] = row
        with _lock:
            if _runtime['date'] != date_str:
                _runtime.update({'date': date_str, 'polls': 0})
            _runtime['polls'] += 1
            _runtime['lastObserveAt'] = _iso(ts)
        for code, row in latest.items():
            price, volume = _num(row.get('price')), _num(row.get('trade_volume'))
            ob = obs.get(code)
            if ob is None:
                prev = _prev_lookup(prices_conn, date_str, code)
                ob = obs[code] = new_obs(prev[0] if prev else None, prev[1] if prev else None)
            event = step(ob, t, ts, price, volume)
            if event == 'SIGNAL':
                _insert_signal(conn, date_str, code, row.get('name') or code, ob)
                events.append((code, 'SIGNAL'))
            elif event == 'ENTRY':
                _save_entry(conn, date_str, code, ob)
                events.append((code, 'ENTRY'))
            elif ob['status'] == 'ENTERED':
                _save_path(conn, date_str, code, ob)
        conn.commit()
    return events


# ---------------------------------------------------------------- 사후 성과(일봉)

def update_outcomes(prices_conn, db_file=None, today=None):
    """D0~D5 일봉을 채운다(일봉은 20시대 배치 뒤에 들어오므로 장 밖에 반복 호출). 멱등.

    진입이 없는 신호(순위권 이탈)도 채워 선택 편향을 비교할 수 있게 하고, D0 일봉 시가는 `official_open`으로 저장해
    30초 시초 관측가와의 차이를 잰다(2026-10-16 ChatGPT 사후 리뷰).
    """
    today = today or datetime.now(KST).strftime('%Y-%m-%d')
    updated = 0
    with closing(connect(db_file)) as conn:
        pending = conn.execute(
            'SELECT trading_date, code FROM gap_shadow_signal WHERE outcome_days<? AND trading_date<=?',
            (DAILY_DAYS, today)).fetchall()
        for date_str, code in pending:
            bars = prices_conn.execute(
                'SELECT date, open, high, low, close FROM daily_prices WHERE code=? AND date>=? ORDER BY date LIMIT ?',
                (code, date_str, DAILY_DAYS)).fetchall()
            if not bars or bars[0][0] != date_str:
                continue
            days = [{'date': b[0], 'open': b[1], 'high': b[2], 'low': b[3], 'close': b[4]} for b in bars]
            conn.execute(
                'UPDATE gap_shadow_signal SET daily_json=?, outcome_days=?, outcome_updated_at=?, official_open=? '
                'WHERE trading_date=? AND code=?',
                (json.dumps(days), len(days), _iso(time.time()), days[0]['open'], date_str, code))
            updated += 1
        conn.commit()
    return updated


def maybe_update_outcomes(now_t=None, db_file=None):
    """장 밖 대기 루프에서 부르는 얇은 진입점: 30분에 한 번만 일봉 대조(SQLite 읽기·쓰기만)."""
    global _last_outcome_run
    now_t = now_t or time.time()
    if now_t - _last_outcome_run < OUTCOME_REFRESH_SEC:
        return None
    _last_outcome_run = now_t
    try:
        import db_schema
        conn = db_schema.get_conn()
        try:
            return update_outcomes(conn, db_file)
        finally:
            conn.close()
    except Exception:
        logger.exception('갭 그림자 사후 성과 갱신 실패')
        return None


def evaluate_trade(entry_price, stop_price, intraday, days, horizon, cost_pct=COST_PCT, use_stop=True):
    """가상 거래 한 건의 horizon(거래일, 0=당일 종가) 청산 결과. 자료가 모자라면 None.

    intraday: {'max','min','last'} 진입 이후 30초 관측 경로. days: D0~ 일봉 리스트.
    D0는 진입 전 구간을 포함하는 일봉 고저를 쓰지 않고 장중 관측 경로로만 손절을 본다.
    D1+ : 시가가 손절가 이하면 시가 청산(갭), 아니면 저가가 손절가 이하일 때 손절가 청산.
    반환: {'ret_pct','net_pct','stopped','exit_k','r','mfe_pct'} (r = net/손절폭, 손절폭은 진입가 대비 %)
    """
    if not entry_price or entry_price <= 0 or len(days) <= horizon:
        return None
    stop_pct = (entry_price - stop_price) / entry_price * 100 if stop_price else None
    best = intraday.get('max') if intraday.get('max') is not None else entry_price
    exit_price, stopped, exit_k = None, False, horizon
    if use_stop and stop_price and intraday.get('min') is not None and intraday['min'] <= stop_price:
        exit_price, stopped, exit_k = stop_price, True, 0
    else:
        for k in range(1, horizon + 1):
            d = days[k]
            best = max(best, d['high'] or 0)
            if use_stop and stop_price:
                if d['open'] is not None and d['open'] <= stop_price:
                    exit_price, stopped, exit_k = d['open'], True, k
                    break
                if d['low'] is not None and d['low'] <= stop_price:
                    exit_price, stopped, exit_k = stop_price, True, k
                    break
    if exit_price is None:
        exit_price = days[horizon]['close']
        if exit_price is None:
            return None
    ret = (exit_price / entry_price - 1) * 100
    net = ret - cost_pct
    return {'ret_pct': ret, 'net_pct': net, 'stopped': stopped, 'exit_k': exit_k,
            'r': (net / stop_pct) if stop_pct and stop_pct > 0 else None,
            'mfe_pct': (best / entry_price - 1) * 100}


def _stats(results, cost_pct):
    n = len(results)
    if not n:
        return {'n': 0, 'enough': False}
    nets = sorted(r['net_pct'] for r in results)
    wins = [x for x in nets if x > 0]
    losses = [x for x in nets if x <= 0]
    avg_win = sum(wins) / len(wins) if wins else None
    avg_loss = sum(losses) / len(losses) if losses else None
    rs = [r['r'] for r in results if r['r'] is not None]
    out = {
        'n': n, 'enough': n >= MIN_SAMPLE,
        'expectancyNetPct': round(sum(nets) / n, 3),
        'medianNetPct': round(nets[n // 2] if n % 2 else (nets[n // 2 - 1] + nets[n // 2]) / 2, 3),
        'winRatePct': round(len(wins) / n * 100, 1),
        'avgWinPct': round(avg_win, 3) if avg_win is not None else None,
        'avgLossPct': round(avg_loss, 3) if avg_loss is not None else None,
        'payoffRatio': round(avg_win / abs(avg_loss), 2) if avg_win is not None and avg_loss else None,
        'expectancyR': round(sum(rs) / len(rs), 3) if rs else None,
        'reach15Pct': round(sum(1 for r in results if r['mfe_pct'] >= 15) / n * 100, 1),
        'stoppedPct': round(sum(1 for r in results if r['stopped']) / n * 100, 1),
        'worstNetPct': round(nets[0], 3),
    }
    if n > 1:
        out['expectancyNetExTopPct'] = round((sum(nets) - nets[-1]) / (n - 1), 3)
    return out


def path_complete(count, last_ts, max_gap):
    """진입 뒤 30초 관측 경로가 장 마감까지 끊김 없이 이어졌는가(순위권 이탈·재시작이 있으면 False)."""
    if not count or not last_ts:
        return False
    if (max_gap or 0) > PATH_GAP_MAX_SEC:
        return False
    return sod(datetime.fromtimestamp(last_ts, KST)) >= PATH_END_SOD


def _median(values):
    values = sorted(values)
    n = len(values)
    if not n:
        return None
    return values[n // 2] if n % 2 else (values[n // 2 - 1] + values[n // 2]) / 2


def summarize(db_file=None, horizons=(0, 1, 3, 5), cost_pct=COST_PCT):
    with closing(connect(db_file)) as conn:
        rows = conn.execute(
            'SELECT entry_price, stop_price, risk_ok, intraday_max, intraday_min, intraday_last, daily_json, '
            'path_obs_count, path_last_obs_ts, path_max_gap_sec, signal_price, open_obs_price, official_open '
            'FROM gap_shadow_signal').fetchall()
    trades, missing_fwd, entered_fwd, open_diffs = [], [], [], []
    for (entry, stop, risk_ok, imax, imin, ilast, dj, cnt, last_ts, max_gap, sig_price, open_obs, official) in rows:
        try:
            days = json.loads(dj) if dj else []
        except ValueError:
            days = []
        if official and open_obs:
            open_diffs.append((open_obs / official - 1) * 100)
        fwd = {}
        for k in (0, 1):
            if len(days) > k and days[k].get('close') and sig_price:
                fwd['d%d' % k] = (days[k]['close'] / sig_price - 1) * 100
        if entry is None:
            missing_fwd.append(fwd)
            continue
        entered_fwd.append(fwd)
        trades.append({'entry': entry, 'stop': stop, 'risk_ok': risk_ok,
                       'intraday': {'max': imax, 'min': imin, 'last': ilast}, 'days': days,
                       'complete': path_complete(cnt, last_ts, max_gap)})
    total, entered = len(rows), len(trades)
    complete = sum(1 for t in trades if t['complete'])

    def fwd_stats(items, key):
        values = [i[key] for i in items if key in i]
        return {'n': len(values), 'meanPct': round(sum(values) / len(values), 3) if values else None,
                'medianPct': round(_median(values), 3) if values else None}

    sets = (('all', lambda t: True), ('riskOk', lambda t: t['risk_ok'] == 1),
            ('complete', lambda t: t['complete']), ('completeRiskOk', lambda t: t['complete'] and t['risk_ok'] == 1))
    by_horizon = {}
    for h in horizons:
        item = {}
        for label, pred in sets:
            for stop_label, use_stop in (('withStop', True), ('noStop', False)):
                results = []
                for t in trades:
                    if not pred(t):
                        continue
                    r = evaluate_trade(t['entry'], t['stop'], t['intraday'], t['days'], h, cost_pct, use_stop)
                    if r:
                        results.append(r)
                item['%s_%s' % (label, stop_label)] = _stats(results, cost_pct)
        by_horizon['D%d' % h] = item
    return {
        'signals': total, 'entered': entered, 'costPct': cost_pct, 'minSample': MIN_SAMPLE,
        'byHorizon': by_horizon,
        'observation': {
            'entryMissing': total - entered,
            'entryMissingPct': round((total - entered) / total * 100, 1) if total else None,
            'pathComplete': complete, 'pathIncomplete': entered - complete,
            'pathGapMaxSec': PATH_GAP_MAX_SEC, 'pathEndsAfter': '15:20',
            # 진입이 누락된 신호와 진입된 신호의 신호가 대비 D0/D1 종가 수익(선택 편향 점검, 비용 미반영)
            'forwardFromSignalPrice': {
                'entered': {'D0': fwd_stats(entered_fwd, 'd0'), 'D1': fwd_stats(entered_fwd, 'd1')},
                'entryMissing': {'D0': fwd_stats(missing_fwd, 'd0'), 'D1': fwd_stats(missing_fwd, 'd1')},
            },
        },
        'openObsVsOfficial': {
            'n': len(open_diffs),
            'medianDiffPct': round(_median(open_diffs), 3) if open_diffs else None,
            'meanAbsDiffPct': round(sum(abs(d) for d in open_diffs) / len(open_diffs), 3) if open_diffs else None,
            'maxAbsDiffPct': round(max(abs(d) for d in open_diffs), 3) if open_diffs else None,
            'note': '30초 시초 관측가 대 D0 일봉 시가(daily_prices). 일봉이 들어온 신호만 계산',
        },
        'note': ('실제 매매 성과가 아닌 그림자 기록입니다. 시초가·첫 5분 고저는 30초 관측가이며 공식 OHLC가 아니고, '
                 '체결가·슬리피지·호가는 반영하지 않았습니다. 손절은 실계좌의 -3%%·2회 확인과 다르게 시초 범위 저가(손절폭 %d%% 이하만 risk_ok)입니다. '
                 'complete_* 는 진입 뒤 관측이 장 마감까지 %d초 간격 안에서 이어진 건만, all_* 는 순위권 이탈로 경로가 끊긴 건도 포함합니다. '
                 '표본이 %d건 미만이면 결론으로 쓰지 않습니다.' % (MAX_STOP_PCT, PATH_GAP_MAX_SEC, MIN_SAMPLE)),
    }


def recent_signals(db_file=None, limit=50):
    with closing(connect(db_file)) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            'SELECT trading_date, code, name, gap_pct, open_obs_price, or_high, or_low, signal_at, signal_price, '
            'signal_cum_ratio, entry_at, entry_price, stop_price, stop_pct, risk_ok, intraday_max, intraday_min, '
            'stop_hit_intraday, outcome_days, path_obs_count, path_last_obs_ts, path_max_gap_sec, official_open '
            'FROM gap_shadow_signal ORDER BY signal_at DESC LIMIT ?',
            (max(1, min(int(limit), 200)),)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d['path_complete'] = (path_complete(d.get('path_obs_count'), d.get('path_last_obs_ts'), d.get('path_max_gap_sec'))
                              if d.get('entry_price') else None)
        out.append(d)
    return out


def runtime_status():
    """오늘 이 프로세스가 본 것(재시작하면 초기화): 폴링 횟수·마지막 관측·종목 상태 개수. 장중 동작 확인용."""
    with _lock:
        counts = {}
        for ob in _day['obs'].values():
            counts[ob['status']] = counts.get(ob['status'], 0) + 1
        return {'date': _runtime['date'], 'polls': _runtime['polls'], 'lastObserveAt': _runtime['lastObserveAt'],
                'watched': len(_day['obs']), 'statusCounts': counts}


def get_payload(db_file=None):
    return {
        'runtime': runtime_status(),
        'rules': {
            'openObsEnd': '09:03', 'orEnd': '09:05', 'signalEnd': '14:00', 'gapPct': [GAP_MIN, GAP_MAX],
            'cumVolumeRatioMin': CUM_RATIO_MIN, 'maxStopPct': MAX_STOP_PCT, 'costPct': COST_PCT,
            'stopRule': '시초 범위(09:00~09:05 관측가) 저가. 실계좌의 -3%·2회 확인과 다름',
            'pathGapMaxSec': PATH_GAP_MAX_SEC,
        },
        'summary': summarize(db_file),
        'recent': recent_signals(db_file),
    }
