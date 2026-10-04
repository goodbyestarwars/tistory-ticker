# -*- coding: utf-8 -*-
"""미국장 업종 로테이션·주요 ETF 수익률 (2026-10-04 사용자 요청).

"한국증시에는 업종 로테이션을 넣었고, 미국장에도 넣어줘" / "미국시장 밑에 S&P ETF 등 주요 ETF 수익률".
외부 API를 직접 부르지 않는 순수 함수만 둔다 - main.py가 us_stocks.chart(symbol, 'daily')(Yahoo 2년 일봉,
이미 캐시되는 경로)로 받은 일봉을 넘긴다.

업종 로테이션(미국)
- 업종 = SPDR 섹터 ETF 11개(XLK·XLF·…), 벤치마크 = SPY. 국내판(sector_rotation.py)은 구성종목 median과
  Breadth(상승 종목 비율)를 쓰지만, ETF 하나로 업종을 대표하므로 구성종목 Breadth가 없다.
  대신 "ETF 종가가 자기 20일 평균 위인가"를 1/0으로 넣어 같은 분류기(classify_phase)를 그대로 쓴다.
  화면에는 이 값을 Breadth로 보여주지 않는다(item에서 None).
- 상대강도 = ETF 수익률 - SPY 수익률(5일·20일), 순위 = 5일 상대강도 순위, 순위 변화 = 5거래일 전 같은 방식 순위와 비교.
- 거래대금 강도 = (종가×거래량) 5일 평균 / 20일 평균.
- 히스테리시스는 저장 없이 하루 전 데이터로 계산한 상태를 prev_phase로 넘겨서 적용한다.
"""

from datetime import date, datetime, timedelta, timezone

import sector_rotation as sr

try:
    from zoneinfo import ZoneInfo
    NY_TZ = ZoneInfo('America/New_York')
except Exception:  # pragma: no cover - tzdata가 없는 환경
    NY_TZ = timezone(timedelta(hours=-4))

SECTOR_ETFS = (
    ('XLK', '기술'), ('XLC', '커뮤니케이션'), ('XLY', '임의소비재'), ('XLF', '금융'),
    ('XLV', '헬스케어'), ('XLI', '산업재'), ('XLE', '에너지'), ('XLP', '필수소비재'),
    ('XLB', '소재'), ('XLU', '유틸리티'), ('XLRE', '부동산'),
)
BENCHMARK = 'SPY'

# 주요 ETF 수익률 띠(미국 시장 카드 아래). 지수·스타일·반도체·채권·금을 한 줄씩.
MAJOR_ETFS = (
    ('SPY', 'S&P500'), ('QQQ', '나스닥100'), ('DIA', '다우30'), ('IWM', '러셀2000'),
    ('SOXX', '반도체'), ('SCHD', '배당'), ('TLT', '미국 장기채'), ('GLD', '금'),
)


def _points(series):
    """[{time:'YYYY-MM-DD', close, volume}] → 날짜순 [(date, close, volume)] (close 없는 행 제외)."""
    out = []
    for row in series or []:
        if not isinstance(row, dict):
            continue
        day = str(row.get('time') or '')[:10]
        try:
            close = float(row.get('close'))
        except (TypeError, ValueError):
            continue
        if len(day) != 10 or close <= 0:
            continue
        try:
            volume = float(row.get('volume') or 0)
        except (TypeError, ValueError):
            volume = 0.0
        out.append((day, close, volume))
    out.sort(key=lambda r: r[0])
    return out


def _ma(values, idx, days):
    if idx - days + 1 < 0:
        return None
    window = values[idx - days + 1: idx + 1]
    if any(v is None for v in window):
        return None
    return sum(window) / float(days)


def _day_rows(closes, values, bench, idx):
    """idx일 기준 업종별 지표 행 목록(분류 전)."""
    b5 = sr.pct_return(bench, idx, sr.ROTATION_SHORT_DAYS)
    b20 = sr.pct_return(bench, idx, sr.ROTATION_MID_DAYS)
    if b5 is None or b20 is None:
        return None, None
    rows = {}
    for sym, _ in SECTOR_ETFS:
        c = closes.get(sym)
        if not c:
            continue
        r5 = sr.pct_return(c, idx, sr.ROTATION_SHORT_DAYS)
        r20 = sr.pct_return(c, idx, sr.ROTATION_MID_DAYS)
        if r5 is None or r20 is None:
            continue
        tv = values.get(sym) or []
        tv5, tv20 = _ma(tv, idx, 5), _ma(tv, idx, 20)
        ma20 = _ma(c, idx, 20)
        rows[sym] = {
            'return1d': sr.pct_return(c, idx, 1), 'return5d': r5, 'return20d': r20,
            'rs5': r5 - b5, 'rs20': r20 - b20,
            'trading_value_ratio': (tv5 / tv20) if tv5 and tv20 else None,
            'above_ma20': (c[idx] > ma20) if ma20 else None,
        }
    return rows, {'return5d': b5, 'return20d': b20}


def _rank_rows(rows):
    rank5 = sr.rank_desc({k: v['rs5'] for k, v in rows.items()})
    pct5 = sr.value_percentiles({k: v['rs5'] for k, v in rows.items()})
    pct20 = sr.value_percentiles({k: v['rs20'] for k, v in rows.items()})
    for k, v in rows.items():
        v['rank5d'] = rank5.get(k)
        v['rs5_percentile'] = pct5.get(k)
        v['rs20_percentile'] = pct20.get(k)
    return rows


def _classify(rows, prev_rows, prev_phases):
    for sym, row in rows.items():
        ago = prev_rows.get(sym) if prev_rows else None
        row['rank5_days_ago'] = ago['rank5d'] if ago else None
        row['rank_change5d'] = sr.rank_change(row['rank5_days_ago'], row['rank5d'])
        # ETF 하나가 업종이라 구성종목 Breadth 대신 "자기 20일 평균 위"를 1/0으로 넣는다(모듈 설명 참고).
        row['breadth_up_ratio'] = None if row['above_ma20'] is None else (1.0 if row['above_ma20'] else 0.0)
        row['breadth_above_ma20'] = None
        row['phase'] = sr.classify_phase(row, (prev_phases or {}).get(sym))
    pct_rc = sr.value_percentiles({k: v['rank_change5d'] for k, v in rows.items()})
    pct_tv = sr.value_percentiles({k: v['trading_value_ratio'] for k, v in rows.items()})
    for k, row in rows.items():
        row['rotation_score'] = sr.rotation_score(row, pct_rc.get(k), None, pct_tv.get(k))
    return rows


def _aligned(series_by_symbol):
    """SPY 날짜를 기준으로 종가·거래대금 배열을 맞춘다. 비는 날은 None."""
    bench_pts = _points(series_by_symbol.get(BENCHMARK))
    dates = [d for d, _, _ in bench_pts]
    closes, values = {}, {}
    for sym in [BENCHMARK] + [s for s, _ in SECTOR_ETFS]:
        by_day = {d: (c, v) for d, c, v in _points(series_by_symbol.get(sym))}
        closes[sym] = [by_day[d][0] if d in by_day else None for d in dates]
        values[sym] = [(by_day[d][0] * by_day[d][1]) if d in by_day and by_day[d][1] else None for d in dates]
    return dates, closes, values


def is_final(last_date, now=None):
    """미국 정규장 마감(16:00 ET) 뒤이거나 지난 날짜면 확정 종가."""
    now = (now or datetime.now(timezone.utc)).astimezone(NY_TZ)
    today = now.date().isoformat()
    return last_date < today or (last_date == today and (now.hour, now.minute) >= (16, 10))


def compute_rotation(series_by_symbol, now=None):
    dates, closes, values = _aligned(series_by_symbol)
    need = sr.ROTATION_MID_DAYS + sr.ROTATION_SHORT_DAYS + 2
    if len(dates) < need:
        return {'available': False, 'reason': '일봉 데이터 부족', 'market': 'us'}
    bench = closes[BENCHMARK]
    idx = len(dates) - 1
    # 하루 전 상태(히스테리시스용) → 오늘 상태 순으로 계산. 각 날짜의 5거래일 전 순위도 같은 방식으로 다시 계산한다.
    phases_prev = None
    result_rows, bench_now = None, None
    for day_idx in (idx - 1, idx):
        rows, b = _day_rows(closes, values, bench, day_idx)
        ago_rows, _ = _day_rows(closes, values, bench, day_idx - sr.ROTATION_SHORT_DAYS)
        if not rows:
            return {'available': False, 'reason': '벤치마크(SPY) 데이터 부족', 'market': 'us'}
        _rank_rows(rows)
        if ago_rows:
            _rank_rows(ago_rows)
        _classify(rows, ago_rows, phases_prev)
        phases_prev = {k: v['phase'] for k, v in rows.items()}
        result_rows, bench_now = rows, b
    names = dict(SECTOR_ETFS)
    groups = {p.lower(): [] for p in sr.PHASES}
    groups['neutral'] = []
    for sym, row in result_rows.items():
        row['sector'] = names[sym]
        view = sr.item_view(dict(row, member_count=1))
        # ETF 하나라 구성종목 Breadth가 없다 - 분류에 쓴 "20일 평균 위" 대용값은 Breadth로 보여주지 않는다.
        view['breadthUpRatio'] = None
        view['breadthAboveMA20'] = None
        view['ticker'] = sym
        view['aboveMa20'] = row['above_ma20']
        groups[row['phase'].lower()].append(view)
    for key in groups:
        if key == 'emerging':
            groups[key].sort(key=lambda r: (-(r['rankChange5d'] or 0), -r['rotationScore']))
        elif key == 'weakening':
            groups[key].sort(key=lambda r: ((r['rankChange5d'] or 0), -r['rotationScore']))
        elif key == 'lagging':
            groups[key].sort(key=lambda r: (r['rs20'] if r['rs20'] is not None else 0))
        else:
            groups[key].sort(key=lambda r: r['rank'] or 99)
    return {
        'available': True, 'market': 'us', 'date': dates[idx],
        'compareDate': dates[idx - sr.ROTATION_SHORT_DAYS], 'final': is_final(dates[idx], now),
        'period': sr.ROTATION_SHORT_DAYS,
        'benchmark': {'name': 'SPY(S&P500 ETF)', 'return5d': round(bench_now['return5d'], 2), 'return20d': round(bench_now['return20d'], 2)},
        'sectorCount': len(result_rows),
        'updatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
        **groups,
    }


def etf_returns(series_by_symbol, now=None):
    """주요 ETF 1일·1주(5거래일)·1개월(21거래일)·연초 이후 수익률."""
    rows = []
    last_date = None
    for sym, name in MAJOR_ETFS:
        pts = _points(series_by_symbol.get(sym))
        if len(pts) < 2:
            continue
        closes = [c for _, c, _ in pts]
        idx = len(closes) - 1
        last_day = pts[idx][0]
        last_date = max(last_date or last_day, last_day)
        year_start = None
        for d, c, _ in pts:
            if d[:4] < last_day[:4]:
                year_start = c  # 직전 연도 마지막 종가
        ytd = (closes[idx] / year_start - 1.0) * 100.0 if year_start else None

        def r(v):
            return None if v is None else round(v, 2)
        rows.append({
            'symbol': sym, 'name': name, 'close': round(closes[idx], 2), 'date': last_day,
            'return1d': r(sr.pct_return(closes, idx, 1)), 'return1w': r(sr.pct_return(closes, idx, 5)),
            'return1m': r(sr.pct_return(closes, idx, 21)), 'returnYtd': r(ytd),
        })
    return {
        'available': bool(rows), 'date': last_date, 'final': is_final(last_date, now) if last_date else None,
        'items': rows,
        'basis': '일봉 종가 기준 · 1주 5거래일 · 1개월 21거래일 · 연초 이후는 직전 연도 마지막 종가 대비',
    }
