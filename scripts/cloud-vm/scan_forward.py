# -*- coding: utf-8 -*-
"""스캔 결과의 포워드(사후) 성과 추적.

배경: 전략검색·차트검색은 매일 아침 후보를 뽑아 캐시 JSON을 통째로 덮어쓴다. 그래서
"어제 뽑힌 종목이 그 뒤 어떻게 됐나"를 되짚을 근거가 남지 않았고, 스캔 조건이 실제로
쓸모가 있는지 판단할 방법이 없었다(2026-09-02 사용자 지적 - "다 오른 지표만 보고
매매할 수는 없잖아").

설계:
- 스캔이 돌 때 그날의 히트 종목과 기준가만 scan_hits에 남긴다(record_hits).
- 수익률은 저장하지 않고 조회 시점에 daily_prices와 대조해 계산한다(forward_returns).
  일봉이 나중에 정정되면 성과도 따라 정정되고, 지평(D+1/D+3/D+5)을 바꿔도 재적재가
  필요 없다.
- 기준가는 스캔 시점 종가다. 실제 매수 체결가가 아니므로 이 수치는 "조건의 사후
  분포"이지 매매 성과가 아니다. 화면 문구에서 그 구분을 지운 채 쓰지 않는다.
"""

from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))

DEFAULT_HORIZONS = (1, 3, 5)


def today_kst():
    return datetime.now(KST).strftime('%Y-%m-%d')


def _now_iso():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def _price_of(item):
    for key in ('price', 'close', 'basePrice'):
        value = item.get(key)
        if isinstance(value, (int, float)) and value > 0:
            return float(value)
    return None


def record_hits(conn, scan_date, scanner, items):
    """스캔 히트 종목을 그날 기준가와 함께 기록하고 새로 넣은 건수를 반환.

    같은 (scan_date, scanner, code)가 이미 있으면 건드리지 않는다 - 장중 재스캔이
    돌아도 그날 첫 기록의 기준가를 유지해야 성과가 부풀지 않는다.
    기준가가 없는 항목은 수익률을 계산할 수 없으므로 기록하지 않는다.
    """
    rows = []
    now = _now_iso()
    seen = set()
    for item in items or []:
        if not isinstance(item, dict):
            continue
        code = str(item.get('code') or '').strip()
        if not code or code in seen:
            continue
        price = _price_of(item)
        if price is None:
            continue
        seen.add(code)
        score = item.get('score')
        rows.append((
            scan_date, scanner, code, str(item.get('name') or ''), price,
            float(score) if isinstance(score, (int, float)) else None, now,
        ))
    if not rows:
        return 0
    cur = conn.executemany(
        'INSERT OR IGNORE INTO scan_hits '
        '(scan_date, scanner, code, name, base_price, score, created_at) '
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
        rows,
    )
    conn.commit()
    return cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0


def record_grouped_hits(conn, scan_date, prefix, groups):
    """{그룹키: [히트, ...]} 묶음을 'prefix:그룹키' 스캐너 이름으로 기록.

    차트검색의 pattern_results({패턴키: matches}), 전략검색의 카테고리별 매치가 모두
    이 모양이라 한 함수로 받는다. 반환값은 {스캐너이름: 신규 기록 건수}.
    """
    recorded = {}
    for key, items in (groups or {}).items():
        scanner = '%s:%s' % (prefix, key)
        count = record_hits(conn, scan_date, scanner, items)
        if count:
            recorded[scanner] = count
    return recorded


def flatten_category_matches(categories):
    """전략검색 output['categories'] -> {카테고리id: [매치, ...]}.

    카테고리는 sectors 아래로 섹터별 매치가 나뉘어 있다. 성과 추적은 섹터 구분이
    필요 없으므로 카테고리 단위로 합친다.
    """
    flat = {}
    for cat_id, category in (categories or {}).items():
        merged = []
        for sector in ((category or {}).get('sectors') or {}).values():
            merged.extend((sector or {}).get('matches') or [])
        merged.extend((category or {}).get('matches') or [])
        if merged:
            flat[cat_id] = merged
    return flat


def _forward_prices(conn, code, scan_date, max_horizon):
    """스캔일 다음 거래일부터 종가를 오름차순으로 최대 max_horizon개 반환."""
    cur = conn.execute(
        'SELECT close FROM daily_prices WHERE code=? AND date>? AND close IS NOT NULL '
        'ORDER BY date LIMIT ?',
        (code, scan_date, max_horizon),
    )
    return [float(r[0]) for r in cur.fetchall() if r[0]]


def forward_returns(conn, scanner=None, since=None, horizons=DEFAULT_HORIZONS, limit=2000):
    """scan_hits를 daily_prices와 대조해 지평별 수익률을 계산한다.

    반환: {'horizons': [...], 'hits': [...], 'summary': {스캐너: {...}}}
    아직 지평만큼 거래일이 지나지 않은 히트는 해당 지평 값이 None이고 집계에서 빠진다
    (미성숙 표본을 0%로 세면 평균이 왜곡된다).
    """
    horizons = tuple(sorted({int(h) for h in horizons if int(h) > 0}))
    if not horizons:
        return {'horizons': [], 'hits': [], 'summary': {}}
    max_h = horizons[-1]

    sql = ('SELECT scan_date, scanner, code, name, base_price, score FROM scan_hits '
           'WHERE base_price IS NOT NULL')
    params = []
    if scanner:
        sql += ' AND scanner=?'
        params.append(scanner)
    if since:
        sql += ' AND scan_date>=?'
        params.append(since)
    sql += ' ORDER BY scan_date DESC, scanner, code LIMIT ?'
    params.append(int(limit))

    hits = []
    buckets = {}
    for scan_date, name_scanner, code, name, base_price, score in conn.execute(sql, params).fetchall():
        closes = _forward_prices(conn, code, scan_date, max_h)
        returns = {}
        for h in horizons:
            if len(closes) >= h and base_price:
                returns['d%d' % h] = round((closes[h - 1] - base_price) / base_price * 100, 2)
            else:
                returns['d%d' % h] = None
        hits.append({
            'scanDate': scan_date,
            'scanner': name_scanner,
            'code': code,
            'name': name,
            'basePrice': base_price,
            'score': score,
            'returns': returns,
        })
        bucket = buckets.setdefault(name_scanner, {h: [] for h in horizons})
        for h in horizons:
            value = returns['d%d' % h]
            if value is not None:
                bucket[h].append(value)

    summary = {}
    for name_scanner, bucket in buckets.items():
        entry = {'hits': sum(1 for h in hits if h['scanner'] == name_scanner)}
        for h in horizons:
            values = bucket[h]
            key = 'd%d' % h
            if values:
                entry[key] = {
                    'samples': len(values),
                    'avgPct': round(sum(values) / len(values), 2),
                    'medianPct': round(sorted(values)[len(values) // 2], 2),
                    'winRatePct': round(sum(1 for v in values if v > 0) / len(values) * 100, 1),
                }
            else:
                entry[key] = {'samples': 0, 'avgPct': None, 'medianPct': None, 'winRatePct': None}
        summary[name_scanner] = entry

    return {'horizons': list(horizons), 'hits': hits, 'summary': summary}
