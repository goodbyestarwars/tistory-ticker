# -*- coding: utf-8 -*-
"""메인 페이지 "투자자별 매매 동향" 위젯(작업지시서 #4, 2026-07-20) - 코스피 시장 전체
개인/외국인/기관계 일별 순매수(억원) 수집 + 일/주/월 집계.

작업지시서는 키움 TR(get_investor_summary/get_investor_trend)을 stk_cd 없이 호출하면
시장 전체(코스피) 값을 준다고 가정했지만, 실측 결과(2026-07-20, MCP get_investor_summary/
get_investor_trend를 stk_cd 없이 직접 호출) 둘 다 `오류: 'stk_cd'`로 실패 - 두 TR 모두
종목별 조회 전용이고 시장 전체 집계를 지원하지 않는다. 대신 domestic_futures.py(코스피/코스닥
지수)와 동일하게 네이버(finance.naver.com/sise/investorDealTrendDay.naver)를 소스로 우회.

검증 경위(2026-07-20, curl 실측):
- bizdate 파라미터가 필수 - 생략하면 빈 페이지가 옴(위 URL에 파라미터 없이 호출한 결과 0행).
- sosok는 비우면(또는 생략) 코스피, 값을 넣어도(예: 1) 이 페이지에서는 빈 결과 - 코스닥이
  필요해지면 별도 확인 필요(이 위젯은 지시서상 "코스피 전체 기준"만 필요해 미대응).
- page=N으로 bizdate 기준 과거 페이지네이션 가능(1페이지=10행, page=14가 약 6개월 전) -
  bond_yield.py의 interestDailyQuote.naver와 동일한 페이징 관례.
- 응답 테이블 컬럼 순서: 날짜, 개인, 외국인, 기관계, (기관 세부 6컬럼), 기타법인 - 이 모듈은
  앞 4컬럼(날짜/개인/외국인/기관계)만 쓴다. 값 부호는 셀 클래스(rate_up3/rate_down3)가 아니라
  텍스트 자체에 '-'로 포함돼 있음(클래스는 색상용, 파싱엔 안 씀)."""

import logging
import re
import threading
import time
import urllib.request
from collections import OrderedDict
from datetime import datetime, timedelta, timezone

import db_schema

logger = logging.getLogger('investor_trend')

KST = timezone(timedelta(hours=9))
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
_URL = 'https://finance.naver.com/sise/investorDealTrendDay.naver?bizdate=%s&sosok=&page=%d'

_ROWS_PER_PAGE = 10
_HISTORY_PAGES = 14  # 140행 - "월" 탭 최근 6개월(~126거래일) + 여유분
_RECENT_POLL_SEC = 60  # 일/주 탭 "1분 갱신" 요구사항
_HISTORY_REFRESH_SEC = 6 * 3600  # 월 탭은 장마감 후 확정치면 충분 - 다른 배치 모듈과 동일 주기

# 날짜 셀 + 개인/외국인/기관계 3개 값 셀만 뽑는다(뒤 기관세부/기타법인 컬럼은 무시).
_ROW_RE = re.compile(
    r'<td class="date2">(?P<date>[\d.]+)</td>\s*'
    r'<td class="rate_\w+3">(?P<ind>-?[\d,]+)</td>\s*'
    r'<td class="rate_\w+3">(?P<frgn>-?[\d,]+)</td>\s*'
    r'<td class="rate_\w+3">(?P<orgn>-?[\d,]+)</td>',
)


def _today_bizdate():
    return datetime.now(KST).strftime('%Y%m%d')


def _fetch_page(bizdate, page):
    req = urllib.request.Request(_URL % (bizdate, page), headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=15) as res:
        html = res.read().decode('euc-kr', errors='replace')
    rows = []
    for m in _ROW_RE.finditer(html):
        try:
            rows.append({
                'date': '20' + m.group('date').replace('.', ''),  # 'YY.MM.DD' -> 'YYYYMMDD'
                'ind': float(m.group('ind').replace(',', '')),
                'frgn': float(m.group('frgn').replace(',', '')),
                'orgn': float(m.group('orgn').replace(',', '')),
            })
        except (TypeError, ValueError):
            continue
    return rows


def fetch_recent(pages=1, bizdate=None):
    """최근 page*10행(오름차순). pages=1이면 최근 10거래일 - "일" 탭 그대로 쓸 수 있는 양."""
    bizdate = bizdate or _today_bizdate()
    rows = []
    for page in range(1, pages + 1):
        page_rows = _fetch_page(bizdate, page)
        if not page_rows:
            break
        rows.extend(page_rows)
    rows.reverse()  # 네이버는 최신순으로 주므로 오름차순으로 뒤집음(다른 수집기와 통일)
    return rows


def refresh_recent():
    """1분 폴링용 - page=1(최근 10거래일)만 재조회해 당일 장중 값 갱신."""
    rows = fetch_recent(pages=1)
    if not rows:
        logger.warning('investor_trend: recent fetch got 0 rows')
        return
    conn = db_schema.get_conn()
    try:
        db_schema.upsert_investor_trend_rows(conn, rows)
        logger.info('investor_trend recent refreshed: %d rows (latest=%s)', len(rows), rows[-1]['date'])
    finally:
        conn.close()


def refresh_history():
    """6시간 주기 - 과거 페이지까지 훑어 "주/월" 집계에 필요한 기간을 채운다."""
    rows = fetch_recent(pages=_HISTORY_PAGES)
    if not rows:
        logger.warning('investor_trend: history fetch got 0 rows')
        return
    conn = db_schema.get_conn()
    try:
        db_schema.upsert_investor_trend_rows(conn, rows)
        logger.info('investor_trend history refreshed: %d rows (%s ~ %s)', len(rows), rows[0]['date'], rows[-1]['date'])
    finally:
        conn.close()


# ---- 일/주/월 집계 - rows는 오름차순(날짜순) [{date, ind, frgn, orgn}, ...] 가정 ----

def bucket_daily(rows, count=10):
    rows = rows[-count:]
    return [
        {'label': '%s.%s' % (r['date'][4:6], r['date'][6:8]), 'ind': r['ind'], 'frgn': r['frgn'], 'orgn': r['orgn']}
        for r in rows
    ]


def _week_monday(date_str):
    d = datetime.strptime(date_str, '%Y%m%d')
    return (d - timedelta(days=d.weekday())).strftime('%Y%m%d')


def _week_label(monday_str):
    d = datetime.strptime(monday_str, '%Y%m%d')
    week_of_month = (d.day - 1) // 7 + 1
    return '%d월 %d주' % (d.month, week_of_month)


def bucket_weekly(rows, count=5):
    buckets = OrderedDict()
    for r in rows:
        key = _week_monday(r['date'])
        b = buckets.setdefault(key, {'ind': 0.0, 'frgn': 0.0, 'orgn': 0.0})
        b['ind'] += r['ind']
        b['frgn'] += r['frgn']
        b['orgn'] += r['orgn']
    keys = list(buckets.keys())[-count:]
    return [
        {'label': _week_label(k), 'ind': buckets[k]['ind'], 'frgn': buckets[k]['frgn'], 'orgn': buckets[k]['orgn']}
        for k in keys
    ]


def bucket_monthly(rows, count=6):
    buckets = OrderedDict()
    for r in rows:
        key = r['date'][:6]  # YYYYMM
        b = buckets.setdefault(key, {'ind': 0.0, 'frgn': 0.0, 'orgn': 0.0})
        b['ind'] += r['ind']
        b['frgn'] += r['frgn']
        b['orgn'] += r['orgn']
    keys = list(buckets.keys())[-count:]
    return [
        {'label': '%s.%s' % (k[:4], k[4:6]), 'ind': buckets[k]['ind'], 'frgn': buckets[k]['frgn'], 'orgn': buckets[k]['orgn']}
        for k in keys
    ]


PERIOD_BUCKETS = {
    'day': lambda rows: bucket_daily(rows, 10),
    'week': lambda rows: bucket_weekly(rows, 5),
    'month': lambda rows: bucket_monthly(rows, 6),
}


def get_result(period):
    """main.py의 /investor-trend가 호출 - DB에 쌓인 캐시만 읽는다(실시간 네이버 호출 없음)."""
    fn = PERIOD_BUCKETS.get(period)
    if fn is None:
        raise ValueError('unknown period: %s' % period)
    conn = db_schema.get_conn()
    try:
        rows = db_schema.load_investor_trend_daily(conn, limit_days=_HISTORY_PAGES * _ROWS_PER_PAGE)
    finally:
        conn.close()
    as_of = rows[-1]['updated_at'] if rows else None
    return {'period': period, 'asOf': as_of, 'rows': fn(rows)}


def _poll_loop():
    last_history_refresh = 0
    while True:
        try:
            refresh_recent()
        except Exception:
            logger.exception('refresh_recent failed')
        now = time.time()
        if now - last_history_refresh > _HISTORY_REFRESH_SEC:
            try:
                refresh_history()
            except Exception:
                logger.exception('refresh_history failed')
            last_history_refresh = now
        time.sleep(_RECENT_POLL_SEC)


def start_background():
    t = threading.Thread(target=_poll_loop, name='investor-trend-poll', daemon=True)
    t.start()
    return t
