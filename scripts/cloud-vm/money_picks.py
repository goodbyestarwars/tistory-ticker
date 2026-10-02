# -*- coding: utf-8 -*-
"""증시온도 '돈이 몰린 섹터'의 대표 종목과 2주 추적 기록.

2026-10-02 사용자 요청: 돈이 몰린 섹터마다 대표 종목 2~3개를 참고용으로 띄우고, 2주 정도 수익률을
확인할 수 있게 한다. 투자 권유가 아니라 "그날 그 테마에서 거래대금이 가장 컸던 종목"을 규칙으로
고른 것이고, 규칙·기준가를 화면에 밝힌다.

- 선정: 거래대금 상위 TOP_THEMES개 테마 각각에서 구성종목 거래대금이 큰 순서로 PICKS_PER_THEME개.
  한 종목이 여러 테마에 있으면 순위가 높은 테마에만 둔다. 현재가가 없는 종목은 건너뛴다.
- 기록: 거래일 15:35(KST) 이후 첫 갱신에서 하루 한 번. 기준가는 그 시점 현재가(rec_price)다.
- 수익률은 서버가 아니라 화면이 현재가를 받아 (현재가/기준가-1)로 계산한다.
"""

import logging
from datetime import timedelta

logger = logging.getLogger('money_picks')

TOP_THEMES = 10
PICKS_PER_THEME = 3
RECORD_AFTER_MIN = 15 * 60 + 35
KEEP_DAYS = 60
HISTORY_DAYS = 14


def select_picks(rows, top_n=TOP_THEMES, per_theme=PICKS_PER_THEME):
    """테마 행(theme_flow.build_theme_rows 결과)에서 대표 종목을 고른다(순수 함수)."""
    picks = []
    seen = set()
    for rank, row in enumerate((rows or [])[:max(1, int(top_n))], 1):
        taken = 0
        stocks = sorted((s for s in (row.get('stocks') or []) if isinstance(s, dict)),
                        key=lambda s: -(s.get('trade_amount') or 0))
        for stock in stocks:
            code = str(stock.get('code') or '').strip()
            price = stock.get('price')
            if not code or code in seen or not price or price <= 0:
                continue
            seen.add(code)
            picks.append({
                'rank': rank,
                'theme': row.get('industry'),
                'code': code,
                'name': stock.get('name') or code,
                'price': float(price),
                'change_rate': stock.get('change_rate'),
            })
            taken += 1
            if taken >= per_theme:
                break
    return picks


def record_today(conn, rows, now_kst, trading_day):
    """15:35 이후 첫 호출에서 오늘의 대표 종목을 기록한다. 하루 한 번만. 기록한 개수를 돌려준다."""
    if not trading_day or not rows:
        return 0
    if now_kst.hour * 60 + now_kst.minute < RECORD_AFTER_MIN:
        return 0
    today = now_kst.strftime('%Y-%m-%d')
    exists = conn.execute('SELECT 1 FROM money_sector_picks WHERE rec_date=? LIMIT 1', (today,)).fetchone()
    if exists:
        return 0
    picks = select_picks(rows)
    if not picks:
        return 0
    created = now_kst.isoformat()
    conn.executemany(
        'INSERT OR IGNORE INTO money_sector_picks (rec_date, code, name, theme, theme_rank, rec_price, created_at) '
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
        [(today, p['code'], p['name'], p['theme'], p['rank'], p['price'], created) for p in picks],
    )
    cutoff = (now_kst - timedelta(days=KEEP_DAYS)).strftime('%Y-%m-%d')
    conn.execute('DELETE FROM money_sector_picks WHERE rec_date < ?', (cutoff,))
    conn.commit()
    return len(picks)


def load_history(conn, now_kst, days=HISTORY_DAYS):
    """최근 days일의 기록(최신 날짜 먼저, 같은 날은 테마 순위 순)."""
    since = (now_kst - timedelta(days=int(days))).strftime('%Y-%m-%d')
    rows = conn.execute(
        'SELECT rec_date, code, name, theme, theme_rank, rec_price FROM money_sector_picks '
        'WHERE rec_date >= ? ORDER BY rec_date DESC, theme_rank ASC, code ASC', (since,)).fetchall()
    return [{'date': r[0], 'code': r[1], 'name': r[2], 'theme': r[3], 'rank': r[4], 'rec_price': r[5]}
            for r in rows]
