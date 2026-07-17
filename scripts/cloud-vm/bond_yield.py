# -*- coding: utf-8 -*-
"""국고채 3년물 금리(%) - 네이버 금융 marketindex 일별시세 HTML 스크래핑.
JSON API가 없어(realtime/worldstock, chart/foreign 둘 다 이 심볼을 모름 - 2026-07-18 실측으로
확인) finance.naver.com/marketindex/interestDailyQuote.naver?marketindexCd=IRR_GOVT03Y 페이지를
그대로 파싱한다. 페이지당 7일치, page= 파라미터로 과거로 페이징(실측: page=13이 약 4개월 전,
page=30도 계속 다른 날짜를 주는 걸 확인 - 끝까지 감).

이 지표는 "장중 실시간"이 아니라 "하루 1번 갱신되는 채권 종가"라 나머지 해외선물(30초 폴링)과
갱신 주기를 맞출 필요가 없다 - _POLL_INTERVAL_SEC을 6시간으로 길게 잡는다.
금리는 오를수록(채권 가격 하락) 긴축/할인율 상승으로 보통 증시에 부담 - 프론트에서
direction:-1(상승=악재)로 취급한다(js/overnight-market.js CATEGORIES 참고)."""

import logging
import re
import threading
import time
import urllib.request
from datetime import datetime, timezone

import db_schema

logger = logging.getLogger('bond_yield')

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
SYMBOL = 'KTB3Y'
NAME = '국고채 3년물 금리(%)'
MARKET_INDEX_CD = 'IRR_GOVT03Y'
_URL = 'https://finance.naver.com/marketindex/interestDailyQuote.naver?marketindexCd=%s&page=%d'

_POLL_INTERVAL_SEC = 6 * 3600
_HISTORY_DAYS = 90
_ROWS_PER_PAGE = 7

_ROW_RE = re.compile(
    r'<tr class="(?P<dir>up|down|same2)">\s*'
    r'<td class="date">\s*(?P<date>[\d.]+)\s*</td>\s*'
    r'<td class="num">(?P<value>[\d.]+)</td>\s*'
    r'<td class="num">.*?alt="[^"]*">\s*(?P<delta>[\d.]+)</td>\s*'
    r'<td class="num">\s*[+\-]?\s*(?P<pct>[\d.]+)%\s*</td>\s*'
    r'</tr>',
    re.S,
)


def _fetch_page(page):
    req = urllib.request.Request(_URL % (MARKET_INDEX_CD, page), headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=15) as res:
        html = res.read().decode('euc-kr', errors='replace')
    rows = []
    for m in _ROW_RE.finditer(html):
        try:
            value = float(m.group('value'))
            delta = float(m.group('delta'))
            pct = float(m.group('pct'))
        except (TypeError, ValueError):
            continue
        sign = -1 if m.group('dir') == 'down' else (0 if m.group('dir') == 'same2' else 1)
        rows.append({
            'date': m.group('date').replace('.', ''),  # 'YYYY.MM.DD' -> 'YYYYMMDD'
            'value': value,
            'change': delta * sign,
            'change_rate': pct * sign,
        })
    return rows


def fetch_history(days=_HISTORY_DAYS):
    """과거로 페이징하며 days일치를 모은다. 페이지가 빈 값(더 이상 데이터 없음)을 주면 중단."""
    rows = []
    pages = max(1, -(-days // _ROWS_PER_PAGE))  # ceil
    for page in range(1, pages + 1):
        page_rows = _fetch_page(page)
        if not page_rows:
            break
        rows.extend(page_rows)
    return rows


def refresh():
    rows = fetch_history()
    if not rows:
        logger.warning('bond yield: no rows parsed')
        return
    conn = db_schema.get_conn()
    try:
        latest = rows[0]
        now_iso = datetime.now(timezone.utc).isoformat()
        db_schema.upsert_future_price(
            conn, SYMBOL, NAME, latest['value'], latest['change'], latest['change_rate'],
            None, None, now_iso,
        )
        chart_rows = [
            {'date': r['date'], 'open': r['value'], 'high': r['value'], 'low': r['value'], 'close': r['value']}
            for r in reversed(rows)
        ]
        db_schema.upsert_future_chart_rows(conn, SYMBOL, chart_rows)
        logger.info('bond yield refreshed: value=%.2f%% change=%+.2f (%d rows)',
                     latest['value'], latest['change'], len(chart_rows))
    finally:
        conn.close()


def _poll_loop():
    while True:
        try:
            refresh()
        except Exception:
            logger.exception('bond yield refresh failed')
        time.sleep(_POLL_INTERVAL_SEC)


def start_background():
    t = threading.Thread(target=_poll_loop, name='bond-yield-poll', daemon=True)
    t.start()
    return t
