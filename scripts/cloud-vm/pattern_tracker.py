# -*- coding: utf-8 -*-
"""패턴 포착 종목의 "포착 -> 추적 -> 결과 판정" 생애주기 (2026-10-04 사용자 요청).

배경: 차트검색은 매일 그날 조건에 맞는 종목만 보여 주고 다음 날 사라져서, 한 번 포착된 종목이 이후 어떻게 됐는지
볼 수 없었다. scan_hits(scan_forward.py)는 포착일·기준가만 남겨 사후 수익률 분포를 계산하지만, 포착 당시의 근거
(저점·고점·지지·저항·점수)와 상태(돌파/실패/만료)는 남기지 않는다. 이 모듈이 그 빈칸을 채운다 - scan_hits와 같은 포착 기록을 대체하지 않는다.

설계 원칙(사용자 지시):
- 포착 당시 값(가격·점수·지지·저항·ATR·스윙 저점·근거)은 immutable snapshot으로 보존하고 절대 덮어쓰지 않는다.
- 현재 값(현재가·현재 점수·상태·최대 상승/하락)은 별도 컬럼으로 매 거래일 갱신한다.
- 오늘 검색 결과에서 사라졌다고 기록을 지우지 않는다(Survivorship Bias 방지). 실패한 종목도 남는다.
- 판정은 종가 기준이다(장중 고가·저가로 돌파/실패를 확정하지 않는다).
- 사이트 문구는 "추천"이 아니라 "패턴 포착"을 쓴다.

상태: NEW(신규 포착) -> TRACKING(추적 중) -> BREAKOUT(저항 돌파) -> BREAKOUT_CONFIRMED(돌파 유지)
      어느 단계에서든 FAILED(지지선 이탈/돌파 실패), 방향이 안 나오면 EXPIRED(추적 종료).
"""

import json
import logging
import math
from datetime import datetime, timedelta, timezone

LOGGER = logging.getLogger(__name__)
KST = timezone(timedelta(hours=9))

# ---- 튜닝 상수(상수로 두어 10/15/20거래일 등으로 쉽게 조정) ----
MAX_TRACKING_DAYS = 15          # 돌파·실패 없이 이만큼 지나면 EXPIRED
BREAKOUT_MARGIN = 1.02          # 종가가 포착 당시 저항선의 이 배율 이상이면 BREAKOUT
CONFIRM_DAYS = 3                # 돌파 뒤 이 거래일 동안 유지하면 BREAKOUT_CONFIRMED
CONFIRM_FLOOR = 0.99            # 돌파 뒤 종가가 저항선의 이 배율 아래로 내려오면 돌파 실패
FAIL_CONSECUTIVE_DAYS = 2       # 지지선 - 허용오차 아래로 종가가 이만큼 연속이면 FAILED
FAIL_TOLERANCE_ATR = 0.5        # 허용오차 = ATR x 이 값
FAIL_IMMEDIATE_ATR = 1.0        # 종가가 지지선 - ATR x 이 값 아래면 즉시 FAILED
ATR_PERIOD = 14
PERF_WINDOW_BARS = 20           # 최대 상승/하락·5/10/20일 수익률을 재는 구간(포착 다음 거래일부터)
VOLUME_RATIO_STRONG = 1.5       # 강한 돌파로 보는 거래량 배수(필수 조건 아님, 점수에만 반영)

OPEN_STATUSES = ('NEW', 'TRACKING', 'BREAKOUT')
CLOSED_STATUSES = ('BREAKOUT_CONFIRMED', 'FAILED', 'EXPIRED')

DDL = '''
CREATE TABLE IF NOT EXISTS pattern_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scanner TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    detected_date TEXT NOT NULL,
    -- 포착 당시(immutable snapshot) - 이후 절대 갱신하지 않는다
    detected_close REAL,
    initial_score REAL,
    initial_support REAL,
    initial_resistance REAL,
    atr REAL,
    snapshot_json TEXT,
    created_at TEXT NOT NULL,
    -- 현재 값(매 거래일 갱신)
    status TEXT NOT NULL DEFAULT 'NEW',
    fail_reason TEXT,
    status_date TEXT,
    tracking_days INTEGER NOT NULL DEFAULT 0,
    current_close REAL,
    current_score REAL,
    current_support REAL,
    current_resistance REAL,
    breakout_date TEXT,
    breakout_quality REAL,
    max_return_pct REAL,
    max_drawdown_pct REAL,
    ret5_pct REAL,
    ret10_pct REAL,
    ret20_pct REAL,
    closed_date TEXT,
    updated_at TEXT,
    UNIQUE (scanner, code, detected_date)
);
CREATE INDEX IF NOT EXISTS idx_pattern_tracks_scanner_status ON pattern_tracks(scanner, status);
CREATE INDEX IF NOT EXISTS idx_pattern_tracks_code ON pattern_tracks(code, detected_date);
'''

def ensure_schema(conn):
    conn.executescript(DDL)
    conn.commit()


def _now_iso():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def _num(value):
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


def load_bars(conn, code, upto=None, after=None, limit=None):
    """daily_prices 일봉을 오름차순 dict 리스트로 읽는다(upto 이하 / after 초과)."""
    sql = 'SELECT date, open, high, low, close, volume FROM daily_prices WHERE code=? AND close IS NOT NULL'
    params = [code]
    if upto:
        sql += ' AND date<=?'
        params.append(upto)
    if after:
        sql += ' AND date>?'
        params.append(after)
    if limit and upto and not after:
        sql += ' ORDER BY date DESC LIMIT ?'
        params.append(int(limit))
        rows = conn.execute(sql, params).fetchall()[::-1]
    else:
        sql += ' ORDER BY date'
        rows = conn.execute(sql, params).fetchall()
    return [{'date': str(r[0]), 'open': r[1], 'high': r[2], 'low': r[3], 'close': r[4], 'volume': r[5] or 0}
            for r in rows]


def compute_atr(bars, period=ATR_PERIOD):
    """단순 평균 ATR(마지막 period개 진폭). 봉이 부족하면 None."""
    if len(bars) < 2:
        return None
    trs = []
    for i in range(1, len(bars)):
        h, l, pc = _num(bars[i]['high']), _num(bars[i]['low']), _num(bars[i - 1]['close'])
        if None in (h, l, pc):
            continue
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    trs = trs[-period:]
    return sum(trs) / len(trs) if trs else None


def _support_line(detail):
    """스윙 저점 두 개 이상이면 첫·마지막 저점을 잇는 상승 지지선을 (날짜, 가격, 날짜, 가격)으로 돌려준다."""
    lows = (detail or {}).get('low_swings') or (detail or {}).get('pivot_lows') or []
    lows = [p for p in lows if _num(p.get('price')) is not None and p.get('date')]
    if len(lows) < 2:
        return None
    return (str(lows[0]['date']), float(lows[0]['price']), str(lows[-1]['date']), float(lows[-1]['price']))


def _support_value_at(line, dates_index, date):
    """지지선의 date 시점 값. dates_index = {거래일: 순번}. 순번을 모르는 날짜는 None."""
    if not line:
        return None
    d1, p1, d2, p2 = line
    i1, i2, i = dates_index.get(d1), dates_index.get(d2), dates_index.get(date)
    if None in (i1, i2, i) or i2 == i1:
        return None
    slope = (p2 - p1) / (i2 - i1)
    return p2 + slope * (i - i2)


def snapshot_from_item(item):
    """검색 결과 항목에서 포착 당시 근거만 골라 JSON으로 직렬화한다."""
    snap = dict((item or {}).get('patternDetail') or {})
    snap.setdefault('reasons', (item or {}).get('reasons') or [])
    snap.setdefault('interpretation', (item or {}).get('interpretation') or '')
    return snap


def initial_levels(detail):
    """포착 당시 지지(마지막 스윙 저점)와 저항 가격."""
    lows = (detail or {}).get('low_swings') or (detail or {}).get('pivot_lows') or []
    support = _num(lows[-1].get('price')) if lows else None
    resistance = _num((detail or {}).get('resistance'))
    if resistance is None:
        neckline = (detail or {}).get('neckline')
        if isinstance(neckline, dict):
            resistance = _num(neckline.get('price'))
    return support, resistance


def record_new(conn, scan_date, scanner, items):
    """오늘 포착된 종목을 추적 대상으로 등록한다. 이미 추적 중인 종목은 건드리지 않고(기록 보존), 새로 등록한 건수를 돌려준다."""
    ensure_schema(conn)
    created = 0
    now = _now_iso()
    for item in items or []:
        code = str((item or {}).get('code') or '').strip()
        if not code:
            continue
        open_row = conn.execute(
            'SELECT 1 FROM pattern_tracks WHERE scanner=? AND code=? AND status IN (?,?,?) LIMIT 1',
            (scanner, code) + OPEN_STATUSES).fetchone()
        if open_row:
            continue
        close = next((float(item[k]) for k in ('price', 'close', 'basePrice')
                      if isinstance(item.get(k), (int, float)) and item[k] > 0), None)
        if close is None:
            continue
        detail = item.get('patternDetail') or {}
        support, resistance = initial_levels(detail)
        atr = compute_atr(load_bars(conn, code, upto=scan_date, limit=ATR_PERIOD + 6))
        score = _num(item.get('score'))
        cur = conn.execute(
            'INSERT OR IGNORE INTO pattern_tracks (scanner, code, name, detected_date, detected_close, initial_score, '
            'initial_support, initial_resistance, atr, snapshot_json, created_at, status, status_date, '
            'current_close, current_score, current_support, current_resistance, updated_at) '
            'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (scanner, code, str(item.get('name') or ''), scan_date, close, score, support, resistance, atr,
             json.dumps(snapshot_from_item(item), ensure_ascii=False, default=str), now, 'NEW', scan_date,
             close, score, support, resistance, now))
        created += cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
    conn.commit()
    return created


def _breakout_quality(bar, history):
    """돌파 신뢰도 0~100: 종가 돌파 60 + 거래량 1.5배 20 + 거래대금 증가 10 + 종가가 고가 부근 10."""
    quality = 60
    vols = [b['volume'] for b in history[-20:] if b['volume']]
    avg_vol = sum(vols) / len(vols) if vols else 0
    if avg_vol and (bar['volume'] or 0) / avg_vol >= VOLUME_RATIO_STRONG:
        quality += 20
    tvs = [(b['close'] or 0) * (b['volume'] or 0) for b in history[-20:]]
    avg_tv = sum(tvs) / len(tvs) if tvs else 0
    if avg_tv and (bar['close'] or 0) * (bar['volume'] or 0) > avg_tv:
        quality += 10
    high, low, close = _num(bar['high']), _num(bar['low']), _num(bar['close'])
    if None not in (high, low, close) and high > low and close >= low + 0.7 * (high - low):
        quality += 10
    return quality


def evaluate_track(track, before_bars, after_bars):
    """포착일 다음 거래일부터의 일봉으로 상태를 처음부터 다시 판정한다(결정적). track은 dict, 변경 필드를 dict로 돌려준다."""
    snapshot = {}
    try:
        snapshot = json.loads(track.get('snapshot_json') or '{}')
    except ValueError:
        snapshot = {}
    line = _support_line(snapshot)
    all_bars = list(before_bars) + list(after_bars)
    dates_index = {b['date']: i for i, b in enumerate(all_bars)}
    atr = _num(track.get('atr')) or 0.0
    resistance = _num(track.get('initial_resistance'))
    detected_close = _num(track.get('detected_close'))

    status, fail_reason, status_date = 'NEW', None, track['detected_date']
    below = 0
    breakout_idx = None
    breakout_date = None
    quality = None
    closed_date = None
    for k, bar in enumerate(after_bars):
        days = k + 1
        close = _num(bar['close'])
        if close is None:
            continue
        if status == 'NEW':
            status, status_date = 'TRACKING', bar['date']
        if status == 'TRACKING':
            support = _support_value_at(line, dates_index, bar['date'])
            if support is not None:
                if close < support - atr * FAIL_IMMEDIATE_ATR and atr > 0:
                    status, fail_reason, status_date, closed_date = 'FAILED', 'SUPPORT_BREAK', bar['date'], bar['date']
                    break
                if close < support - atr * FAIL_TOLERANCE_ATR:
                    below += 1
                    if below >= FAIL_CONSECUTIVE_DAYS:
                        status, fail_reason, status_date, closed_date = 'FAILED', 'SUPPORT_BREAK', bar['date'], bar['date']
                        break
                else:
                    below = 0
            if resistance and close >= resistance * BREAKOUT_MARGIN:
                status, status_date = 'BREAKOUT', bar['date']
                breakout_idx, breakout_date = k, bar['date']
                quality = _breakout_quality(bar, all_bars[:len(before_bars) + k])
                continue
            if days >= MAX_TRACKING_DAYS:
                status, status_date, closed_date = 'EXPIRED', bar['date'], bar['date']
                break
        elif status == 'BREAKOUT':
            if resistance and close < resistance * CONFIRM_FLOOR:
                status, fail_reason, status_date, closed_date = 'FAILED', 'BREAKOUT_FAILED', bar['date'], bar['date']
                break
            if k - breakout_idx >= CONFIRM_DAYS:
                status, status_date, closed_date = 'BREAKOUT_CONFIRMED', bar['date'], bar['date']
                break

    window = after_bars[:PERF_WINDOW_BARS]
    out = {
        'status': status, 'fail_reason': fail_reason, 'status_date': status_date,
        'tracking_days': len(after_bars), 'breakout_date': breakout_date, 'breakout_quality': quality,
        'closed_date': closed_date,
    }
    if after_bars:
        out['current_close'] = _num(after_bars[-1]['close'])
    if detected_close and window:
        highs = [_num(b['high']) for b in window if _num(b['high']) is not None]
        lows = [_num(b['low']) for b in window if _num(b['low']) is not None]
        out['max_return_pct'] = round((max(highs) / detected_close - 1) * 100, 2) if highs else None
        out['max_drawdown_pct'] = round((min(lows) / detected_close - 1) * 100, 2) if lows else None
        for n, key in ((5, 'ret5_pct'), (10, 'ret10_pct'), (20, 'ret20_pct')):
            if len(after_bars) >= n and _num(after_bars[n - 1]['close']):
                out[key] = round((_num(after_bars[n - 1]['close']) / detected_close - 1) * 100, 2)
    return out


def update_tracks(conn, rescore=None):
    """열린 추적 + 최근 닫힌 추적(성과 구간 20거래일 안)을 일봉으로 다시 판정·갱신한다. rescore(code, bars)->(score, support, resistance)는 선택."""
    ensure_schema(conn)
    conn.row_factory = None
    cols = [r[1] for r in conn.execute('PRAGMA table_info(pattern_tracks)')]
    rows = conn.execute(
        'SELECT * FROM pattern_tracks WHERE status IN (?,?,?) OR closed_date >= ?',
        OPEN_STATUSES + ((datetime.now(KST) - timedelta(days=45)).strftime('%Y-%m-%d'),)).fetchall()
    updated = 0
    now = _now_iso()
    for row in rows:
        track = dict(zip(cols, row))
        before = load_bars(conn, track['code'], upto=track['detected_date'], limit=ATR_PERIOD + 40)
        after = load_bars(conn, track['code'], after=track['detected_date'])
        if not after:
            continue
        changes = evaluate_track(track, before, after)
        if track['status'] in OPEN_STATUSES and rescore is not None:
            try:
                result = rescore(track, before + after)
            except Exception:
                LOGGER.debug('rescore 실패 %s', track['code'], exc_info=True)
                result = None
            if result:
                changes['current_score'], changes['current_support'], changes['current_resistance'] = result
        # 포착 당시 값(initial_*, snapshot_json, detected_*)은 이 갱신에서 절대 건드리지 않는다.
        sets = ', '.join('%s=?' % k for k in changes)
        conn.execute('UPDATE pattern_tracks SET ' + sets + ', updated_at=? WHERE id=?',
                     list(changes.values()) + [now, track['id']])
        updated += 1
    conn.commit()
    return updated


def rescore_rising_lows(track, bars):
    """저점상승형의 현재 점수·지지(마지막 저점)·저항. 조건에서 빠졌으면 점수는 None(기록은 남는다)."""
    import pattern_detect as pd
    detail = pd.detect_rising_lows(bars)
    if not detail:
        return None, None, None
    lows = detail.get('low_swings') or []
    return detail.get('score'), (lows[-1]['price'] if lows else None), detail.get('resistance')


def rescore_for(track, bars):
    if track.get('scanner') == 'pattern:risingLows':
        return rescore_rising_lows(track, bars)
    return None


def _row_to_dict(cols, row):
    return dict(zip(cols, row))


def list_tracks(conn, scanner, view='all', days=90, limit=100):
    """화면용 목록. view: active(NEW/TRACKING/BREAKOUT) / closed(BREAKOUT_CONFIRMED/FAILED/EXPIRED) / all."""
    ensure_schema(conn)
    cols = [r[1] for r in conn.execute('PRAGMA table_info(pattern_tracks)')]
    sql = 'SELECT * FROM pattern_tracks WHERE scanner=? AND detected_date>=?'
    since = (datetime.now(KST) - timedelta(days=int(days))).strftime('%Y-%m-%d')
    params = [scanner, since]
    if view == 'active':
        sql += ' AND status IN (?,?,?)'
        params += list(OPEN_STATUSES)
    elif view == 'closed':
        sql += ' AND status IN (?,?,?)'
        params += list(CLOSED_STATUSES)
    sql += ' ORDER BY detected_date DESC, id DESC LIMIT ?'
    params.append(max(1, min(int(limit), 300)))
    out = []
    for row in conn.execute(sql, params).fetchall():
        t = _row_to_dict(cols, row)
        try:
            t['snapshot'] = json.loads(t.pop('snapshot_json') or '{}')
        except ValueError:
            t['snapshot'] = {}
        out.append(t)
    return out


def tracker_stats(conn, scanner, days=90):
    """검색기 자체의 성적표: 포착 수, 상태별 개수, 돌파율, 평균 5/10일 수익률, 평균 최대 상승/하락. 기록이 없으면 None 값."""
    ensure_schema(conn)
    since = (datetime.now(KST) - timedelta(days=int(days))).strftime('%Y-%m-%d')
    rows = conn.execute(
        'SELECT status, fail_reason, breakout_date, ret5_pct, ret10_pct, max_return_pct, max_drawdown_pct '
        'FROM pattern_tracks WHERE scanner=? AND detected_date>=?', (scanner, since)).fetchall()
    total = len(rows)

    def avg(values):
        values = [v for v in values if v is not None]
        return round(sum(values) / len(values), 2) if values else None

    counts = {}
    for status, *_ in rows:
        counts[status] = counts.get(status, 0) + 1
    broke = [r for r in rows if r[2]]
    decided = [r for r in rows if r[0] in CLOSED_STATUSES or r[2]]
    return {
        'days': int(days), 'total': total, 'counts': counts,
        'breakout': len(broke),
        'breakoutConfirmed': counts.get('BREAKOUT_CONFIRMED', 0),
        'failed': counts.get('FAILED', 0),
        'active': sum(counts.get(s, 0) for s in OPEN_STATUSES),
        'breakoutRatePct': round(len(broke) / total * 100, 1) if total else None,
        'confirmRatePct': round(counts.get('BREAKOUT_CONFIRMED', 0) / total * 100, 1) if total else None,
        'decidedSamples': len(decided),
        'avgRet5Pct': avg([r[3] for r in rows]),
        'avgRet10Pct': avg([r[4] for r in rows]),
        'avgMaxReturnPct': avg([r[5] for r in rows]),
        'avgMaxDrawdownPct': avg([r[6] for r in rows]),
    }
