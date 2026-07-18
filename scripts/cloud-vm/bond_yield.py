# -*- coding: utf-8 -*-
"""채권 금리(%) 수집 - 국고채 3년물(네이버) + 미국 국채 10/2/30년물(FRED).

국고채 3년물: JSON API가 없어(realtime/worldstock, chart/foreign 둘 다 이 심볼을 모름 -
2026-07-18 실측으로 확인) finance.naver.com/marketindex/interestDailyQuote.naver?
marketindexCd=IRR_GOVT03Y 페이지를 그대로 파싱한다. 페이지당 7일치, page= 파라미터로
과거로 페이징(실측: page=13이 약 4개월 전, page=30도 계속 다른 날짜를 주는 걸 확인 - 끝까지 감).
같은 marketindexCd 방식으로 국고채10년물(IRR_GOVT10Y)도 찾아봤지만 해당 코드는 존재하지 않음
(빈 테이블 반환, 2026-07-18 확인) - 네이버는 국내 채권 중 3년물까지만 이 페이지에서 제공.

미국 국채 10/2/30년물: FRED(세인트루이스 연준, fred.stlouisfed.org) 공식 CSV를 API 키 없이
바로 받는다(graph/fredgraph.csv?id=DGS10 등) - 정부 공식 통계라 가장 신뢰도 높은 무료 소스.
한국 국고채 10년물도 FRED에 있긴 하지만(IRLTLT01KRM156N) OECD 월간 집계라 하루 1번 갱신되는
나머지 채권 카드들과 갱신 주기가 안 맞아 보류함(2026-07-18, 사용자와 상의해 결정) - 나중에
일별 소스를 찾으면 추가.

이 지표들은 전부 "장중 실시간"이 아니라 "하루 1번 갱신되는 종가"라 나머지 해외선물(30초 폴링)과
갱신 주기를 맞출 필요가 없다 - _POLL_INTERVAL_SEC을 6시간으로 길게 잡는다.
금리는 오를수록(채권 가격 하락) 긴축/할인율 상승으로 보통 증시에 부담 - 프론트에서
direction:-1(상승=악재)로 취급한다(js/overnight-market.js CATEGORIES 참고)."""

import logging
import re
import threading
import time
import urllib.request
from datetime import datetime, timedelta, timezone

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

# 미국 국채 - FRED 시리즈 ID. 값 자체가 %(예: 4.57)라 db_schema.upsert_future_price에
# price로 그대로 넣으면 된다(원/포인트 단위 변환 불필요).
FRED_SYMBOLS = {
    'US10Y': {'series': 'DGS10', 'name': '미국 국채 10년물 금리(%)'},
    'US2Y': {'series': 'DGS2', 'name': '미국 국채 2년물 금리(%)'},
    'US30Y': {'series': 'DGS30', 'name': '미국 국채 30년물 금리(%)'},
}
_FRED_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=%s&cosd=%s&coed=%s'
_FRED_HISTORY_DAYS = 400

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


def refresh_ktb3y():
    rows = fetch_history()
    if not rows:
        logger.warning('KTB3Y: no rows parsed')
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
        logger.info('KTB3Y refreshed: value=%.2f%% change=%+.2f (%d rows)',
                     latest['value'], latest['change'], len(chart_rows))
    finally:
        conn.close()


def fetch_fred_series(series_id, days=_FRED_HISTORY_DAYS):
    """FRED 공식 CSV(API 키 불필요). 결측일(공휴일 등)은 값이 빈 문자열이나 '.'로 오므로
    건너뛴다. 주의: 이 UA(데스크톱 브라우저 값)를 그대로 보내면 FRED가 응답을 안 주고 그냥
    연결을 붙잡고 있다가 타임아웃남(2026-07-18 실측 확인, curl로도 재현됨) - User-Agent
    헤더 자체를 안 보내야(urllib 기본값) 정상 응답이 옴. 이유는 불명이지만 다른 수집기와
    달리 여기서는 UA를 절대 세팅하지 말 것."""
    coed = datetime.now().strftime('%Y-%m-%d')
    cosd = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
    req = urllib.request.Request(_FRED_URL % (series_id, cosd, coed))
    with urllib.request.urlopen(req, timeout=15) as res:
        text = res.read().decode('utf-8', errors='replace')
    rows = []
    for line in text.strip().split('\n')[1:]:  # 첫 줄은 헤더('observation_date,DGS10')
        parts = line.split(',')
        if len(parts) != 2:
            continue
        date_str, value_str = parts
        if value_str in ('', '.'):
            continue
        try:
            value = float(value_str)
        except ValueError:
            continue
        rows.append({'date': date_str.replace('-', ''), 'value': value})
    return rows


def refresh_fred_all():
    conn = db_schema.get_conn()
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        for symbol, meta in FRED_SYMBOLS.items():
            try:
                rows = fetch_fred_series(meta['series'])
            except Exception:
                logger.exception('FRED fetch failed: %s', symbol)
                continue
            if not rows:
                continue
            latest = rows[-1]
            prev = rows[-2] if len(rows) > 1 else None
            change = (latest['value'] - prev['value']) if prev else None
            change_rate = (change / prev['value'] * 100) if prev and prev['value'] else None
            db_schema.upsert_future_price(
                conn, symbol, meta['name'], latest['value'], change, change_rate, None, None, now_iso,
            )
            chart_rows = [
                {'date': r['date'], 'open': r['value'], 'high': r['value'], 'low': r['value'], 'close': r['value']}
                for r in rows
            ]
            db_schema.upsert_future_chart_rows(conn, symbol, chart_rows)
            logger.info('FRED refreshed: %s value=%.2f%% (%d rows)', symbol, latest['value'], len(chart_rows))
    finally:
        conn.close()


def _poll_loop():
    while True:
        try:
            refresh_ktb3y()
        except Exception:
            logger.exception('KTB3Y refresh failed')
        try:
            refresh_fred_all()
        except Exception:
            logger.exception('refresh_fred_all failed')
        time.sleep(_POLL_INTERVAL_SEC)


def start_background():
    t = threading.Thread(target=_poll_loop, name='bond-yield-poll', daemon=True)
    t.start()
    return t
