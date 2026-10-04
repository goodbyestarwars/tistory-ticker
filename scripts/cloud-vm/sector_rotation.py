# -*- coding: utf-8 -*-
"""업종 로테이션 (2026-10-04): 어느 업종으로 상대강도와 거래가 옮겨 가는지를 유입·주도·둔화·이탈로 분류한다.

핵심: 20일 상대강도로 현재 위치를 보고, 5일 상대강도·순위 변화·거래대금·Breadth로 이동 방향을 판정한다.
업종 상승률 순위가 아니다(절대 등락률은 점수에 쓰지 않고, 시장 대비 초과수익만 쓴다).

데이터 출처
- 업종 분류: 운영 중인 sector_cards 설정(= data/sectors-v3.js 기반 37개 테마). 새 분류를 만들지 않는다.
  시가총액 묶음인 "코스피 3대장"은 업종이 아니라서 제외한다(market_temp_data.BROAD_MARKET_BUCKETS와 동일).
- 시세: daily_prices(일봉 확정값). 장중 틱으로 계산하지 않고, 과거 값이 장중 값으로 덮이는 일도 없다.
- 업종 수익률: 시가총액 데이터가 없어 구성종목 수익률의 median(소형주 한 종목이 업종을 왜곡하지 않게).
- Benchmark: 같은 날짜의 전 종목(일평균 거래대금 하한 이상) 수익률 median. 지수 ETF가 daily_prices에 없다.
저장: sector_rotation_daily(일 1회 스냅샷). 순위·5일 전 순위는 일봉으로 정확히 재계산하고, 저장분은 기록·히스테리시스용.
"""

import logging
from datetime import datetime, timedelta, timezone

LOGGER = logging.getLogger(__name__)
KST = timezone(timedelta(hours=9))

# ---- 판정 기준(튜닝용 상수) ----
ROTATION_SHORT_DAYS = 5
ROTATION_MID_DAYS = 20

EMERGING_RS20_MAX = 70
EMERGING_RS5_MIN = 60
EMERGING_MIN_RANK_CHANGE = 3
EMERGING_MIN_VOLUME_RATIO = 1.10

LEADING_RS20_MIN = 70
LEADING_RS5_MIN = 60

WEAKENING_RS20_MIN = 60
WEAKENING_RS5_MAX = 50
WEAKENING_RANK_CHANGE = -3

LAGGING_RS20_MAX = 40
LAGGING_RS5_MAX = 40

MIN_BREADTH_RATIO = 0.55

# 히스테리시스: 이미 그 상태였다면 경계를 이만큼 느슨하게 적용해 경계 부근에서 상태가 뒤집히지 않게 한다.
HYST_PCT = 5                 # 퍼센타일 기준 완충
HYST_RANK_CHANGE = 1
HYST_VOLUME_RATIO = 0.05
HYST_BREADTH = 0.05

# 점수 가중치(합 100)
W_RS20, W_RS5, W_RANK, W_BREADTH, W_VOLUME = 30, 15, 20, 20, 15

# 데이터 품질 기준
MIN_MEMBERS = 3              # 업종 내 유효 종목이 이보다 적으면 계산 제외
MIN_BENCH_STOCKS = 200       # 벤치마크 종목 수가 이보다 적으면 계산 불가
BENCH_MIN_AVG_TRADING_VALUE = 500_000_000   # 벤치마크 포함 하한(일평균 거래대금 5억)
HISTORY_DAYS = ROTATION_MID_DAYS + ROTATION_SHORT_DAYS + 3   # 5일 전 순위까지 계산하는 데 필요한 거래일 수
EXCLUDED_SECTORS = frozenset({'코스피 3대장'})

PHASES = ('EMERGING', 'LEADING', 'WEAKENING', 'LAGGING')
PHASE_LABEL = {'EMERGING': '유입', 'LEADING': '주도', 'WEAKENING': '둔화', 'LAGGING': '이탈', 'NEUTRAL': '중립'}

DDL = '''
CREATE TABLE IF NOT EXISTS sector_rotation_daily (
    date TEXT NOT NULL,
    sector TEXT NOT NULL,
    return1d REAL, return5d REAL, return20d REAL,
    benchmark_return5d REAL, benchmark_return20d REAL,
    rs5 REAL, rs20 REAL,
    rank5d INTEGER, rank20d INTEGER, rank5_days_ago INTEGER, rank_change5d INTEGER,
    rs5_percentile REAL, rs20_percentile REAL,
    breadth_up_ratio REAL, breadth_above_ma20 REAL,
    avg_trading_value5d REAL, avg_trading_value20d REAL, trading_value_ratio REAL,
    rotation_score REAL,
    phase TEXT,
    final INTEGER NOT NULL DEFAULT 1,
    created_at TEXT,
    PRIMARY KEY (date, sector)
);
'''


def ensure_schema(conn):
    conn.executescript(DDL)
    conn.commit()


# ---------------------------------------------------------------- 순수 계산 함수

def median(values):
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    mid = len(vals) // 2
    return vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2.0


def pct_return(closes, idx, days):
    """closes[idx] / closes[idx-days] - 1 (%). 둘 중 하나라도 없거나 0이면 None."""
    if idx - days < 0 or idx >= len(closes):
        return None
    now, then = closes[idx], closes[idx - days]
    if not now or not then or then <= 0:
        return None
    return (now / then - 1.0) * 100.0


def rank_desc(values):
    """값이 클수록 1위. {key: rank}. 동률은 같은 순위(최소 순위). None 값은 제외."""
    items = sorted(((k, v) for k, v in values.items() if v is not None), key=lambda kv: -kv[1])
    ranks = {}
    last_value, last_rank = None, 0
    for pos, (key, value) in enumerate(items, start=1):
        if value != last_value:
            last_rank, last_value = pos, value
        ranks[key] = last_rank
    return ranks


def percentile_from_rank(rank, n):
    """1위=100, 꼴찌=0. 업종 수가 달라져도 비교되도록 순위를 0~100으로 바꾼다."""
    if rank is None or n is None:
        return None
    if n <= 1:
        return 100.0
    return round((n - rank) / (n - 1) * 100.0, 1)


def value_percentiles(values):
    """{key: 값} -> {key: 0~100 퍼센타일}(값이 클수록 높음)."""
    ranks = rank_desc(values)
    n = len(ranks)
    return {k: percentile_from_rank(r, n) for k, r in ranks.items()}


def rank_change(rank_ago, rank_now):
    """순위는 작을수록 좋으므로 (과거 - 현재)로 계산한다. 15위 -> 5위 = +10(상승), 3위 -> 8위 = -5(하락)."""
    if rank_ago is None or rank_now is None:
        return None
    return rank_ago - rank_now


def classify_phase(row, prev_phase=None):
    """EMERGING/LEADING/WEAKENING/LAGGING 또는 NEUTRAL. prev_phase가 있으면 같은 상태 유지 쪽으로 경계를 느슨하게 본다."""
    rs20, rs5 = row.get('rs20_percentile'), row.get('rs5_percentile')
    if rs20 is None or rs5 is None:
        return 'NEUTRAL'
    rc = row.get('rank_change5d')
    rc = 0 if rc is None else rc
    up = row.get('breadth_up_ratio')
    above = row.get('breadth_above_ma20')
    above_prev = row.get('breadth_above_ma20_prev')
    tv = row.get('trading_value_ratio')

    stay_l = prev_phase == 'LEADING'
    if (rs20 >= LEADING_RS20_MIN - (HYST_PCT if stay_l else 0)
            and rs5 >= LEADING_RS5_MIN - (HYST_PCT if stay_l else 0)
            and up is not None and up >= MIN_BREADTH_RATIO - (HYST_BREADTH if stay_l else 0)):
        return 'LEADING'

    stay_e = prev_phase == 'EMERGING'
    breadth_ok = (up is not None and up >= MIN_BREADTH_RATIO - (HYST_BREADTH if stay_e else 0)) or \
                 (above is not None and above_prev is not None and above > above_prev)
    if (rs20 < EMERGING_RS20_MAX + (HYST_PCT if stay_e else 0)
            and rs5 >= EMERGING_RS5_MIN - (HYST_PCT if stay_e else 0)
            and rc >= EMERGING_MIN_RANK_CHANGE - (HYST_RANK_CHANGE if stay_e else 0)
            and tv is not None and tv >= EMERGING_MIN_VOLUME_RATIO - (HYST_VOLUME_RATIO if stay_e else 0)
            and breadth_ok):
        return 'EMERGING'

    stay_w = prev_phase == 'WEAKENING'
    if (rs20 >= WEAKENING_RS20_MIN - (HYST_PCT if stay_w else 0)
            and (rs5 < WEAKENING_RS5_MAX + (HYST_PCT if stay_w else 0)
                 or rc <= WEAKENING_RANK_CHANGE + (HYST_RANK_CHANGE if stay_w else 0))):
        return 'WEAKENING'

    stay_g = prev_phase == 'LAGGING'
    if (rs20 < LAGGING_RS20_MAX + (HYST_PCT if stay_g else 0)
            and rs5 < LAGGING_RS5_MAX + (HYST_PCT if stay_g else 0)):
        return 'LAGGING'
    return 'NEUTRAL'


def rotation_score(row, pct_rank_change, pct_breadth, pct_volume):
    """100점 내부 점수(정렬·비교·보조용). 모두 업종 간 퍼센타일 기반."""
    def part(pct, weight):
        return (pct if pct is not None else 50.0) / 100.0 * weight
    return round(part(row.get('rs20_percentile'), W_RS20) + part(row.get('rs5_percentile'), W_RS5)
                 + part(pct_rank_change, W_RANK) + part(pct_breadth, W_BREADTH)
                 + part(pct_volume, W_VOLUME), 1)


# ---------------------------------------------------------------- 데이터 로드

def load_history(conn, days=HISTORY_DAYS):
    """최근 거래일 `days`개의 (날짜 목록, {코드: {날짜: (종가, 거래량)}}). 날짜는 오름차순."""
    dates = [r[0] for r in conn.execute(
        'SELECT DISTINCT date FROM daily_prices ORDER BY date DESC LIMIT ?', (int(days),)).fetchall()]
    dates.sort()
    if not dates:
        return [], {}
    by_code = {}
    for code, date, close, volume in conn.execute(
            'SELECT code, date, close, volume FROM daily_prices WHERE date >= ? AND close IS NOT NULL', (dates[0],)):
        by_code.setdefault(code, {})[date] = (close, volume or 0)
    return dates, by_code


def series(by_code, code, dates):
    """날짜 정렬된 종가·거래량 리스트(없는 날은 None)."""
    row = by_code.get(code, {})
    closes = [row[d][0] if d in row else None for d in dates]
    vols = [row[d][1] if d in row else None for d in dates]
    return closes, vols


def tradable(close, volume):
    return bool(close) and bool(volume)


# ---------------------------------------------------------------- 스냅샷 계산

def _members_for(sector_map):
    members = {}
    for sector, stocks in (sector_map or {}).items():
        if sector in EXCLUDED_SECTORS:
            continue
        members[sector] = [s for s in stocks if s.get('code')]
    return members


def _benchmark_returns(by_code, dates, idx):
    """idx 시점의 1/5/20일 전 종목 median 수익률."""
    out = {}
    liquid = []
    for code, row in by_code.items():
        tvs = [(row[d][0] or 0) * (row[d][1] or 0) for d in dates[max(0, idx - 19):idx + 1] if d in row]
        if len(tvs) >= 10 and sum(tvs) / len(tvs) >= BENCH_MIN_AVG_TRADING_VALUE:
            liquid.append(code)
    if len(liquid) < MIN_BENCH_STOCKS:
        return None
    for k in (ROTATION_SHORT_DAYS, ROTATION_MID_DAYS):
        vals = []
        for code in liquid:
            closes, _ = series(by_code, code, dates)
            vals.append(pct_return(closes, idx, k))
        out[k] = median(vals)
    return out


def _sector_stats(members, by_code, dates, idx):
    """한 업종의 idx 시점 지표(수익률 median, Breadth, 거래대금). 유효 종목이 부족하면 None."""
    r1, r5, r20 = [], [], []
    up = valid_day = above = valid_ma = 0
    tv5 = tv20 = 0.0
    tv_members = 0
    for stock in members:
        closes, vols = series(by_code, stock['code'], dates)
        if idx >= len(closes) or not closes[idx]:
            continue
        # 거래정지(당일 거래량 0)는 당일 Breadth·수익률에서 제외한다.
        if not tradable(closes[idx], vols[idx]):
            continue
        a = pct_return(closes, idx, 1)
        b = pct_return(closes, idx, ROTATION_SHORT_DAYS)
        c = pct_return(closes, idx, ROTATION_MID_DAYS)
        if a is not None:
            r1.append(a)
            valid_day += 1
            up += 1 if a > 0 else 0
        if b is not None:
            r5.append(b)
        if c is not None:
            r20.append(c)
        window = closes[idx - 19:idx + 1] if idx >= 19 else []
        if len(window) == 20 and all(window):
            valid_ma += 1
            above += 1 if closes[idx] > sum(window) / 20.0 else 0
            v20 = vols[idx - 19:idx + 1]
            v5 = vols[idx - 4:idx + 1]
            if all(v is not None for v in v20):
                tv20 += sum(cl * v for cl, v in zip(window, v20)) / 20.0
                tv5 += sum(cl * v for cl, v in zip(closes[idx - 4:idx + 1], v5)) / 5.0
                tv_members += 1
    if len(r5) < MIN_MEMBERS or len(r20) < MIN_MEMBERS:
        return None
    return {
        'return1d': median(r1), 'return5d': median(r5), 'return20d': median(r20),
        'breadth_up_ratio': (up / valid_day) if valid_day else None,
        'breadth_above_ma20': (above / valid_ma) if valid_ma else None,
        'avg_trading_value5d': tv5 if tv_members else None,
        'avg_trading_value20d': tv20 if tv_members else None,
        'trading_value_ratio': (tv5 / tv20) if tv_members and tv20 > 0 else None,
        'member_count': len(r20), 'universe_count': len(members),
    }


def _day_rows(members_by_sector, by_code, dates, idx):
    """idx 시점의 업종별 지표 + RS + 순위. 벤치마크를 못 만들면 None."""
    bench = _benchmark_returns(by_code, dates, idx)
    if bench is None or bench.get(ROTATION_SHORT_DAYS) is None or bench.get(ROTATION_MID_DAYS) is None:
        return None
    rows = {}
    for sector, members in members_by_sector.items():
        stats = _sector_stats(members, by_code, dates, idx)
        if not stats:
            continue
        stats['benchmark_return5d'] = bench[ROTATION_SHORT_DAYS]
        stats['benchmark_return20d'] = bench[ROTATION_MID_DAYS]
        stats['rs5'] = stats['return5d'] - bench[ROTATION_SHORT_DAYS]
        stats['rs20'] = stats['return20d'] - bench[ROTATION_MID_DAYS]
        rows[sector] = stats
    n = len(rows)
    r5 = rank_desc({s: r['rs5'] for s, r in rows.items()})
    r20 = rank_desc({s: r['rs20'] for s, r in rows.items()})
    for sector, row in rows.items():
        row['rank5d'] = r5[sector]
        row['rank20d'] = r20[sector]
        row['rs5_percentile'] = percentile_from_rank(r5[sector], n)
        row['rs20_percentile'] = percentile_from_rank(r20[sector], n)
    return rows


def compute_snapshot(conn, sector_map, prev_phases=None, dates_history=None):
    """최신 거래일 기준 업종 로테이션 스냅샷. 반환: {'date', 'rows': [...], 'benchmark': {...}} 또는 None(데이터 부족).

    rank5d(단기 RS 순위)가 화면의 "순위"다 - 5거래일 전 같은 방식의 순위와 비교해 rankChange5d를 낸다.
    """
    dates, by_code = dates_history if dates_history else load_history(conn)
    if len(dates) < ROTATION_MID_DAYS + ROTATION_SHORT_DAYS + 1:
        return None
    idx = len(dates) - 1
    members = _members_for(sector_map)
    today = _day_rows(members, by_code, dates, idx)
    if not today:
        return None
    ago_idx = idx - ROTATION_SHORT_DAYS
    ago = _day_rows(members, by_code, dates, ago_idx) or {}
    ago20 = None
    if len(dates) > ROTATION_MID_DAYS + ROTATION_MID_DAYS:
        ago20 = _day_rows(members, by_code, dates, idx - ROTATION_MID_DAYS)
    # 5일 전 Breadth(MA20 위 비율) - 유입 판정의 "상승 중" 확인용
    prev_above = {}
    for sector, ms in members.items():
        st = _sector_stats(ms, by_code, dates, ago_idx)
        prev_above[sector] = st['breadth_above_ma20'] if st else None

    for sector, row in today.items():
        row['rank5_days_ago'] = ago.get(sector, {}).get('rank5d')
        row['rank_change5d'] = rank_change(row['rank5_days_ago'], row['rank5d'])
        row['rank20_days_ago'] = (ago20 or {}).get(sector, {}).get('rank5d')
        row['breadth_above_ma20_prev'] = prev_above.get(sector)

    pct_rc = value_percentiles({s: r['rank_change5d'] for s, r in today.items()})
    pct_breadth = value_percentiles({
        s: ((r['breadth_up_ratio'] or 0) + (r['breadth_above_ma20'] or 0)) / 2.0 for s, r in today.items()
        if r['breadth_up_ratio'] is not None or r['breadth_above_ma20'] is not None})
    pct_volume = value_percentiles({s: r['trading_value_ratio'] for s, r in today.items()})
    prev_phases = prev_phases or {}
    out = []
    for sector, row in today.items():
        row['rotation_score'] = rotation_score(row, pct_rc.get(sector), pct_breadth.get(sector), pct_volume.get(sector))
        row['phase'] = classify_phase(row, prev_phases.get(sector))
        row['sector'] = sector
        out.append(row)
    out.sort(key=lambda r: (r['rank5d'], -r['rotation_score']))
    first = out[0]
    return {'date': dates[idx], 'rows': out,
            'benchmark': {'return5d': first['benchmark_return5d'], 'return20d': first['benchmark_return20d']},
            'ago_date': dates[ago_idx]}


# ---------------------------------------------------------------- 저장·조회

SNAPSHOT_COLUMNS = ('return1d', 'return5d', 'return20d', 'benchmark_return5d', 'benchmark_return20d', 'rs5', 'rs20',
                    'rank5d', 'rank20d', 'rank5_days_ago', 'rank_change5d', 'rs5_percentile', 'rs20_percentile',
                    'breadth_up_ratio', 'breadth_above_ma20', 'avg_trading_value5d', 'avg_trading_value20d',
                    'trading_value_ratio', 'rotation_score', 'phase')


def previous_phases(conn, before_date):
    """히스테리시스용: before_date 이전 가장 최근 저장 스냅샷의 {업종: phase}."""
    ensure_schema(conn)
    row = conn.execute('SELECT MAX(date) FROM sector_rotation_daily WHERE date < ?', (before_date,)).fetchone()
    if not row or not row[0]:
        return {}
    return {s: p for s, p in conn.execute(
        'SELECT sector, phase FROM sector_rotation_daily WHERE date = ?', (row[0],))}


def save_snapshot(conn, snapshot, final):
    """확정(final=1) 스냅샷은 덮어쓰지 않는다. 미확정(0)은 같은 날 다시 계산하면 갱신된다."""
    ensure_schema(conn)
    date = snapshot['date']
    existing = conn.execute('SELECT MAX(final) FROM sector_rotation_daily WHERE date = ?', (date,)).fetchone()
    if existing and existing[0] == 1:
        return False
    now = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    cols = ','.join(SNAPSHOT_COLUMNS)
    marks = ','.join('?' * (len(SNAPSHOT_COLUMNS) + 4))
    conn.execute('DELETE FROM sector_rotation_daily WHERE date = ?', (date,))
    for row in snapshot['rows']:
        conn.execute('INSERT INTO sector_rotation_daily (date, sector, %s, final, created_at) VALUES (%s)' % (cols, marks),
                     [date, row['sector']] + [row.get(c) for c in SNAPSHOT_COLUMNS] + [1 if final else 0, now])
    conn.commit()
    return True


def is_final(snapshot_date, now=None):
    """일봉 날짜가 오늘 이전이거나 오늘 16:00(KST) 이후면 확정으로 본다(장중에 daily_prices가 갱신돼도 덮이지 않게)."""
    now = now or datetime.now(KST)
    today = now.strftime('%Y-%m-%d')
    return snapshot_date < today or (snapshot_date == today and now.hour >= 16)


def build_payload(conn, sector_map, now=None):
    """API 응답. 계산 → 저장 → 위상별 묶음. 데이터가 부족하면 available=False."""
    dates_history = load_history(conn)
    dates = dates_history[0]
    prev = previous_phases(conn, dates[-1]) if dates else {}
    snap = compute_snapshot(conn, sector_map, prev_phases=prev, dates_history=dates_history)
    if not snap:
        return {'available': False, 'reason': '일봉 데이터 부족', 'updatedAt': None}
    final = is_final(snap['date'], now)
    try:
        save_snapshot(conn, snap, final)
    except Exception:
        LOGGER.warning('업종 로테이션 스냅샷 저장 실패', exc_info=True)
    groups = {p.lower(): [] for p in PHASES}
    groups['neutral'] = []
    for row in snap['rows']:
        groups[row['phase'].lower()].append(item_view(row))
    for key in groups:
        if key == 'emerging':
            groups[key].sort(key=lambda r: (-(r['rankChange5d'] or 0), -r['rotationScore']))
        elif key in ('weakening',):
            groups[key].sort(key=lambda r: ((r['rankChange5d'] or 0), -r['rotationScore']))
        elif key == 'lagging':
            groups[key].sort(key=lambda r: (r['rs20'] if r['rs20'] is not None else 0))
        else:
            groups[key].sort(key=lambda r: r['rank'])
    return {
        'available': True, 'date': snap['date'], 'compareDate': snap['ago_date'], 'final': final, 'period': ROTATION_SHORT_DAYS,
        'benchmark': {'name': '전 종목 median(일평균 거래대금 5억 이상)', **snap['benchmark']},
        'updatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
        'sectorCount': len(snap['rows']),
        **groups,
        'map': [{'sector': r['sector'], 'x': round(r['rs20'], 2), 'y': round(r['rs5'], 2), 'phase': r['phase']} for r in snap['rows']],
    }


def item_view(row):
    def r(v, d=2):
        return None if v is None else round(v, d)
    return {
        'sector': row['sector'], 'phase': row['phase'], 'rank': row['rank5d'], 'rank5DaysAgo': row.get('rank5_days_ago'),
        'rank20DaysAgo': row.get('rank20_days_ago'), 'rankChange5d': row.get('rank_change5d'),
        'rotationScore': row['rotation_score'],
        'return1d': r(row['return1d']), 'return5d': r(row['return5d']), 'return20d': r(row['return20d']),
        'rs5': r(row['rs5']), 'rs20': r(row['rs20']),
        'rs5Percentile': row['rs5_percentile'], 'rs20Percentile': row['rs20_percentile'],
        'breadthUpRatio': r(row['breadth_up_ratio'], 3), 'breadthAboveMA20': r(row['breadth_above_ma20'], 3),
        'tradingValueRatio': r(row['trading_value_ratio']),
        'memberCount': row.get('member_count'),
    }


def sector_detail(conn, sector_map, sector, top_n=5):
    """한 업종 상세: 지표 + 대표 강세 종목(5일 상대수익, 거래대금 고려)."""
    dates_history = load_history(conn)
    snap = compute_snapshot(conn, sector_map, prev_phases=previous_phases(conn, dates_history[0][-1]) if dates_history[0] else {},
                            dates_history=dates_history)
    if not snap:
        return None
    row = next((r for r in snap['rows'] if r['sector'] == sector), None)
    if not row:
        return None
    dates, by_code = dates_history
    idx = len(dates) - 1
    bench5 = row['benchmark_return5d']
    stocks = []
    for stock in (sector_map.get(sector) or []):
        closes, vols = series(by_code, stock['code'], dates)
        if not tradable(closes[idx], vols[idx]):
            continue
        r5 = pct_return(closes, idx, ROTATION_SHORT_DAYS)
        if r5 is None:
            continue
        tv = closes[idx] * vols[idx]
        stocks.append({'code': stock['code'], 'name': stock.get('name'), 'return5d': round(r5, 2),
                       'excess5d': round(r5 - bench5, 2), 'tradingValue': tv})
    # 초과수익이 큰 순서로 정렬하되 거래대금이 너무 작은(상위 업종 평균의 1/10 미만) 종목은 뒤로 미룬다.
    tvs = sorted(s['tradingValue'] for s in stocks)
    floor = (tvs[len(tvs) // 2] * 0.1) if tvs else 0
    stocks.sort(key=lambda s: (s['tradingValue'] < floor, -s['excess5d']))
    return {'date': snap['date'], 'item': item_view(row), 'leaders': stocks[:max(1, int(top_n))]}
