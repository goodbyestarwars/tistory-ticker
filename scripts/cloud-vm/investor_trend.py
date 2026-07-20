# -*- coding: utf-8 -*-
"""메인 페이지 "투자자별 매매 동향" 위젯(작업지시서 #4, 2026-07-20 + UI개선 지시서
2026-07-21) - 시장별(코스피/코스닥) 개인/외국인/기관계 일별 순매수(억원) 수집 + 일/주/월 집계.

작업지시서는 키움 TR(get_investor_summary/get_investor_trend)을 stk_cd 없이 호출하면
시장 전체(코스피) 값을 준다고 가정했지만, 실측 결과(2026-07-20, MCP get_investor_summary/
get_investor_trend를 stk_cd 없이 직접 호출) 둘 다 `오류: 'stk_cd'`로 실패 - 두 TR 모두
종목별 조회 전용이고 시장 전체 집계를 지원하지 않는다.

**데이터 소스**: 1차 소스는 KIS(한국투자증권) TR `FHPTJ04040000`(시장별 투자자매매동향(일별),
kis_client.fetch_market_investor_daily) - 한국투자 HTS [0404] 시장별 일별동향 화면과 1:1
대응하는 정식 API. market_iscd로 'KSP'(코스피)/'KSQ'(코스닥)를 선택. 하루치씩만 조회되는
구조라(공식 예제가 FID_INPUT_DATE_1=FID_INPUT_DATE_2만 검증됨) 날짜별로 반복 호출해
DB(investor_trend_daily, market 컬럼으로 시장 구분)에 쌓는다(사용자 판단: "숫자 데이터라
용량 부담 없으니 일별로 저장" - 2026-07-20). `_tr_pbmn`(거래대금) 필드는 백만원 단위(배포
후 라이브 응답을 이전 네이버 캐시값과 대조해 확정, /100). 외국인 필드는 종목별 KIS
TR(FHPTJ04160001)의 "frgn_reg_ntby_qty(등록 외국인)을 써야 Toss/키움HTS와 일치" 실측
기록을 따라 frgn_reg_ntby_pbmn(등록만) 사용.

KIS_APPKEY/APPSECRET이 없거나 KIS 호출이 실패하면(코스피에 한해) 네이버로 폴백하고,
그것도 실패하면 키움 ka10051("종합" 행, "오늘"만 제공)로 한 번 더 폴백한다. 네이버
(finance.naver.com/sise/investorDealTrendDay.naver)는 코스피 전용 페이지라(sosok 파라미터로
코스닥을 시도했지만 빈 결과만 옴, 2026-07-21 확인) 코스닥은 KIS 실패 시 키움으로 바로
폴백한다(네이버 단계 없음).

**최종 결론(2026-07-20, 코스피 기준)**: 이 위젯이 원래 목표했던 "HTS 투자자별매매종합
([0780]/[0404]/[0403] 등) 코스피 행"과 정확히 일치하는 소스는 못 찾음 - KIS 일별/키움
ka10051/KIS 시세(FHPTJ04030000, 폐기) 세 가지를 실측했지만 전부 토스·키움 HTS 값과
달랐고, 키움 공식 AI 문의로도 "공개된 REST TR 중 그 화면과 1:1 대응하는 건 없고, 종목별
TR(ka10059)을 전 종목(800여개) 순회 합산해야 하는데 그래도 ETF 포함여부·단위처리 등
화면 내부 로직 차이로 완전 일치는 보장 안 됨"이라는 답을 받음(전종목 순회는 매 갱신마다
호출량이 비현실적이라 채택 안 함). 사용자 판단으로 KIS 일별을 최종 소스로 채택.
**2026-07-21 정정**: 그러나 사용자가 KRX 공식 통계(코스피 기관/외국인/개인 순매수, 십억원
단위)를 직접 대조한 결과 KIS 일별 값이 KRX 원본과 거의 정확히 일치함을 확인(개인 오차
0.07억, 기관 4.9억 등 반올림 수준) - 안 맞았던 건 키움/토스 HTS `[0780]` 위젯 쪽이 KRX
공식 수치와 다른 자체 집계를 쓰고 있었던 것으로 결론. KIS 일별이 정답에 가깝다는 뜻이라
그대로 유지.

**코스피 선물은 2026-07-21 조사 결과 데이터 소스가 없어 이 위젯 범위에서 제외**됨 - KIS
국내선물옵션 카테고리 43개 API 전체에 투자자매매동향 API 자체가 없고(kis-code-assistant-mcp
확인), 키움 레퍼런스 문서에도 선물 투자자 TR이 없고, 네이버도 해당 페이지가 없음(사용자
확인 후 코스피/코스닥 2개 시장으로 축소 진행 결정).

네이버 폴백 검증 경위(2026-07-20, curl 실측):
- bizdate 파라미터가 필수 - 생략하면 빈 페이지가 옴(위 URL에 파라미터 없이 호출한 결과 0행).
- sosok는 비우면(또는 생략) 코스피, 값을 넣어도(예: 1) 이 페이지에서는 빈 결과 - 2026-07-21
  재확인해도 여전히 빈 결과라 코스닥은 이 페이지로 못 받음(공식 결론).
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
import kis_client
import kiwoom_client

logger = logging.getLogger('investor_trend')

KST = timezone(timedelta(hours=9))
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
_URL = 'https://finance.naver.com/sise/investorDealTrendDay.naver?bizdate=%s&sosok=&page=%d'

_ROWS_PER_PAGE = 10
_HISTORY_PAGES = 14  # 140행 - "월" 탭 최근 6개월(~126거래일) + 여유분
_RECENT_POLL_SEC = 60  # 일/주 탭 "1분 갱신" 요구사항
_HISTORY_REFRESH_SEC = 6 * 3600  # 월 탭은 장마감 후 확정치면 충분 - 다른 배치 모듈과 동일 주기

# 시장 키(프론트/쿼리파라미터용, 소문자) -> DB에 저장하는 시장명 + 각 소스별 파라미터.
# 선물은 데이터 소스가 없어 제외(위 모듈 독스트링 참고).
MARKETS = {
    'kospi': {'db': 'KOSPI', 'kis_iscd': 'KSP', 'kis_inds_cd': '0001', 'kiwoom_mrkt_tp': '0', 'naver': True, 'label': '코스피'},
    'kosdaq': {'db': 'KOSDAQ', 'kis_iscd': 'KSQ', 'kis_inds_cd': '1001', 'kiwoom_mrkt_tp': '1', 'naver': False, 'label': '코스닥'},
}
DEFAULT_MARKET = 'kospi'

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
    """[네이버 폴백, 코스피 전용] 최근 page*10행(오름차순). pages=1이면 최근 10거래일."""
    bizdate = bizdate or _today_bizdate()
    rows = []
    for page in range(1, pages + 1):
        page_rows = _fetch_page(bizdate, page)
        if not page_rows:
            break
        rows.extend(page_rows)
    rows.reverse()  # 네이버는 최신순으로 주므로 오름차순으로 뒤집음(다른 수집기와 통일)
    return rows


def refresh_recent(market_db='KOSPI'):
    """[네이버 폴백, 코스피 전용] 1분 폴링용 - page=1(최근 10거래일)만 재조회해 당일 장중 값 갱신."""
    rows = fetch_recent(pages=1)
    if not rows:
        logger.warning('investor_trend[%s]: Naver recent fetch got 0 rows', market_db)
        return
    conn = db_schema.get_conn()
    try:
        db_schema.upsert_investor_trend_rows(conn, market_db, rows)
        logger.info('investor_trend[%s] Naver recent refreshed: %d rows (latest=%s)', market_db, len(rows), rows[-1]['date'])
    finally:
        conn.close()


def refresh_history(market_db='KOSPI'):
    """[네이버 폴백, 코스피 전용] 6시간 주기 - 과거 페이지까지 훑어 "주/월" 집계 기간을 채운다."""
    rows = fetch_recent(pages=_HISTORY_PAGES)
    if not rows:
        logger.warning('investor_trend[%s]: Naver history fetch got 0 rows', market_db)
        return
    conn = db_schema.get_conn()
    try:
        db_schema.upsert_investor_trend_rows(conn, market_db, rows)
        logger.info('investor_trend[%s] Naver history refreshed: %d rows (%s ~ %s)',
                     market_db, len(rows), rows[0]['date'], rows[-1]['date'])
    finally:
        conn.close()


# ---- KIS(1차 소스) - 시장별 투자자매매동향(일별), 날짜별 반복 호출 ----

_KIS_CALL_DELAY_SEC = 0.25  # 백필 시 과도한 연속 호출 방지(공식 rate limit 문서화 안 돼있어 보수적으로)
_KIS_TARGET_DAYS = _HISTORY_PAGES * _ROWS_PER_PAGE  # 네이버 폴백과 동일한 보관량(140행)
_KIS_MAX_CALENDAR_DAYS = 220  # 주말/공휴일 포함해도 140영업일을 채우기 충분한 여유


def _kis_row_to_common(date_str, row):
    def amt(key):
        try:
            return float(row.get(key) or 0) / 100  # 백만원 -> 억원(2026-07-20 라이브 실측으로 확정)
        except (TypeError, ValueError):
            return 0.0
    return {
        'date': row.get('stck_bsop_date') or date_str,
        'ind': amt('prsn_ntby_tr_pbmn'),
        'frgn': amt('frgn_reg_ntby_pbmn'),
        'orgn': amt('orgn_ntby_tr_pbmn'),
    }


def fetch_kis_day(token, appkey, appsecret, date_str, kis_iscd='KSP', kis_inds_cd='0001'):
    """date_str('YYYYMMDD') 하루치. 휴장일/데이터 없음이면 None."""
    output = kis_client.fetch_market_investor_daily(
        token, appkey, appsecret, date_str, date_str, market_iscd=kis_iscd, inds_cd=kis_inds_cd)
    if not output:
        return None
    return _kis_row_to_common(date_str, output[0])


def backfill_kis(appkey, appsecret, market_db, kis_iscd, kis_inds_cd, target_days=_KIS_TARGET_DAYS, max_calendar_days=_KIS_MAX_CALENDAR_DAYS):
    """오늘부터 거슬러 올라가며 날짜별로 호출 - target_days(영업일)를 채우거나
    max_calendar_days(달력일)를 다 돌 때까지. 주말은 호출 자체를 건너뛴다(공휴일은 호출은
    하되 빈 응답으로 자연 스킵). 호출마다 upsert해서 중간에 실패해도 그때까지 진행분은 보존."""
    token = kis_client.get_token(appkey, appsecret)
    conn = db_schema.get_conn()
    collected = 0
    calendar_checked = 0
    d = datetime.now(KST)
    try:
        while collected < target_days and calendar_checked < max_calendar_days:
            calendar_checked += 1
            if d.weekday() < 5:  # 월~금만 호출(토/일 스킵)
                date_str = d.strftime('%Y%m%d')
                row = None
                try:
                    row = fetch_kis_day(token, appkey, appsecret, date_str, kis_iscd, kis_inds_cd)
                except Exception:
                    logger.exception('investor_trend[%s] KIS backfill failed at %s', market_db, date_str)
                if row:
                    db_schema.upsert_investor_trend_rows(conn, market_db, [row])
                    collected += 1
                time.sleep(_KIS_CALL_DELAY_SEC)
            d -= timedelta(days=1)
    finally:
        conn.close()
    logger.info('investor_trend[%s] KIS backfill done: %d trading days over %d calendar days',
                 market_db, collected, calendar_checked)


_FORCE_KIS_REBACKFILL = True  # 2026-07-21: 코스닥 업종코드(0001->1001) 수정을 이미 저장된
# 잘못된(전부 0) 백필 데이터에도 반영하려고 1회 True로 배포 - 라이브 확인되면 False로 되돌릴 것.


def _ensure_kis_backfill(appkey, appsecret, market_db, kis_iscd, kis_inds_cd):
    """이미 충분히 쌓여있으면(재시작 등) 백필을 건너뛴다 - 매번 130여회 호출은 낭비.
    _FORCE_KIS_REBACKFILL=True인 동안은 건너뛰지 않고 항상 재백필."""
    if not _FORCE_KIS_REBACKFILL:
        conn = db_schema.get_conn()
        try:
            existing = db_schema.load_investor_trend_daily(conn, market_db, limit_days=_KIS_TARGET_DAYS)
        finally:
            conn.close()
        if len(existing) >= _KIS_TARGET_DAYS - 5:
            logger.info('investor_trend[%s] KIS backfill skipped - already have %d rows', market_db, len(existing))
            return
    backfill_kis(appkey, appsecret, market_db, kis_iscd, kis_inds_cd)


def refresh_recent_kis(appkey, appsecret, market_db, kis_iscd, kis_inds_cd):
    """1분 폴링용 - 오늘 하루치만 재조회(장중 값 갱신)."""
    token = kis_client.get_token(appkey, appsecret)
    date_str = _today_bizdate()
    row = fetch_kis_day(token, appkey, appsecret, date_str, kis_iscd, kis_inds_cd)
    if not row:
        logger.warning('investor_trend[%s]: KIS recent fetch got no row for %s', market_db, date_str)
        return
    conn = db_schema.get_conn()
    try:
        db_schema.upsert_investor_trend_rows(conn, market_db, [row])
        logger.info('investor_trend[%s] KIS recent refreshed: %s ind=%.0f frgn=%.0f orgn=%.0f',
                     market_db, row['date'], row['ind'], row['frgn'], row['orgn'])
    finally:
        conn.close()


# ---- 키움(3차, "오늘"만) - ka10051 업종별투자자순매수의 "종합" 행 ----

def fetch_kiwoom_today(appkey, secretkey, mrkt_tp='0'):
    """ka10051은 날짜 파라미터가 없어 현재/최근 확정 스냅샷만 준다 - "오늘" 전용.
    stex_tp=3(통합 KRX+NXT)이 이 프로젝트 관례(market_rank.py, kis_client.py 등).
    mrkt_tp='0'(코스피)/'1'(코스닥) - 응답의 첫 행이 항상 "종합"(mrkt_tp=0일 때
    inds_cd="001_AL" "종합(KOSPI)"로 실측 확인, 코스닥도 같은 위치일 것으로 가정)."""
    token = kiwoom_client.get_token(appkey, secretkey)
    res = kiwoom_client.call_tr(token, 'ka10051', '/api/dostk/sect', {
        'mrkt_tp': mrkt_tp,
        'amt_qty_tp': '1',
        'stex_tp': '3',
    })
    rows = res.get('inds_netprps') or []
    if not rows:
        logger.warning('investor_trend: ka10051(mrkt_tp=%s) 응답이 비어있음 - return_code=%s',
                        mrkt_tp, res.get('return_code'))
        return None
    top_row = rows[0]

    def amt(key):
        try:
            return float(str(top_row.get(key) or '0').replace(',', ''))
        except (TypeError, ValueError):
            return 0.0

    return {
        'date': _today_bizdate(),
        'ind': amt('ind_netprps'),
        'frgn': amt('frgnr_netprps'),
        'orgn': amt('orgn_netprps'),
    }


def refresh_recent_kiwoom(appkey, secretkey, market_db, mrkt_tp):
    """1분 폴링용 - "오늘" 행만 키움으로 덮어쓴다(과거 행은 KIS/네이버 백필 그대로 유지)."""
    row = fetch_kiwoom_today(appkey, secretkey, mrkt_tp)
    if not row:
        return
    conn = db_schema.get_conn()
    try:
        db_schema.upsert_investor_trend_rows(conn, market_db, [row])
        logger.info('investor_trend[%s] Kiwoom recent refreshed: %s ind=%.0f frgn=%.0f orgn=%.0f',
                     market_db, row['date'], row['ind'], row['frgn'], row['orgn'])
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


def get_result(period, market=DEFAULT_MARKET):
    """main.py의 /investor-trend가 호출 - DB에 쌓인 캐시만 읽는다(실시간 호출 없음).
    market: MARKETS의 키('kospi'/'kosdaq', 소문자) - 모르는 값이면 기본 코스피로 처리."""
    fn = PERIOD_BUCKETS.get(period)
    if fn is None:
        raise ValueError('unknown period: %s' % period)
    market_cfg = MARKETS.get(market, MARKETS[DEFAULT_MARKET])
    conn = db_schema.get_conn()
    try:
        rows = db_schema.load_investor_trend_daily(conn, market_cfg['db'], limit_days=_HISTORY_PAGES * _ROWS_PER_PAGE)
    finally:
        conn.close()
    as_of = rows[-1]['updated_at'] if rows else None
    return {'period': period, 'market': market, 'asOf': as_of, 'rows': fn(rows)}


def _refresh_recent_chain(market_cfg, has_kiwoom, kiwoom_appkey, kiwoom_secretkey, has_kis, kis_appkey, kis_appsecret):
    """"오늘" 행 갱신 - KIS(FHPTJ04040000) 1순위 -> (코스피에 한해)네이버 2순위 ->
    키움(ka10051) 3순위. 상위 소스가 예외를 던지면 그 폴링 tick 안에서 다음 소스로 즉시 넘어간다."""
    market_db = market_cfg['db']
    if has_kis:
        try:
            refresh_recent_kis(kis_appkey, kis_appsecret, market_db, market_cfg['kis_iscd'], market_cfg['kis_inds_cd'])
            return
        except Exception:
            logger.exception('investor_trend[%s] refresh_recent_kis failed - falling back for this tick', market_db)
    if market_cfg['naver']:
        try:
            refresh_recent(market_db)
            return
        except Exception:
            logger.exception('investor_trend[%s] refresh_recent(Naver) failed - falling back for this tick', market_db)
    if has_kiwoom:
        try:
            refresh_recent_kiwoom(kiwoom_appkey, kiwoom_secretkey, market_db, market_cfg['kiwoom_mrkt_tp'])
        except Exception:
            logger.exception('investor_trend[%s] refresh_recent_kiwoom failed', market_db)


def _poll_market(market_key, market_cfg, kis_appkey, kis_appsecret, kiwoom_appkey, kiwoom_secretkey, state):
    """시장 하나에 대한 초기 백필(1회) + "오늘" 갱신(매 tick) - _poll_loop가 시장별로 호출."""
    has_kis = bool(kis_appkey and kis_appsecret)
    has_kiwoom = bool(kiwoom_appkey and kiwoom_secretkey)
    market_db = market_cfg['db']

    if not state.get('backfilled'):
        if has_kis:
            try:
                _ensure_kis_backfill(kis_appkey, kis_appsecret, market_db, market_cfg['kis_iscd'], market_cfg['kis_inds_cd'])
            except Exception:
                logger.exception('investor_trend[%s] KIS backfill failed - falling back to Naver history for now', market_db)
                has_kis = False
                if market_cfg['naver']:
                    try:
                        refresh_history(market_db)
                    except Exception:
                        logger.exception('investor_trend[%s] refresh_history(Naver fallback) failed', market_db)
        elif market_cfg['naver']:
            try:
                refresh_history(market_db)
            except Exception:
                logger.exception('investor_trend[%s] refresh_history failed', market_db)
        state['backfilled'] = True
        state['has_kis'] = has_kis
        state['last_naver_history_refresh'] = time.time()

    has_kis = state.get('has_kis', has_kis)
    _refresh_recent_chain(market_cfg, has_kiwoom, kiwoom_appkey, kiwoom_secretkey, has_kis, kis_appkey, kis_appsecret)

    if not has_kis and market_cfg['naver']:
        now = time.time()
        if now - state.get('last_naver_history_refresh', 0) > _HISTORY_REFRESH_SEC:
            try:
                refresh_history(market_db)
            except Exception:
                logger.exception('investor_trend[%s] refresh_history failed', market_db)
            state['last_naver_history_refresh'] = now


def _poll_loop(kis_appkey=None, kis_appsecret=None, kiwoom_appkey=None, kiwoom_secretkey=None):
    market_state = {key: {} for key in MARKETS}
    while True:
        for market_key, market_cfg in MARKETS.items():
            try:
                _poll_market(market_key, market_cfg, kis_appkey, kis_appsecret, kiwoom_appkey, kiwoom_secretkey,
                              market_state[market_key])
            except Exception:
                logger.exception('investor_trend[%s] poll tick failed', market_cfg['db'])
        time.sleep(_RECENT_POLL_SEC)


def start_background(kis_appkey=None, kis_appsecret=None, kiwoom_appkey=None, kiwoom_secretkey=None):
    t = threading.Thread(
        target=_poll_loop, args=(kis_appkey, kis_appsecret, kiwoom_appkey, kiwoom_secretkey),
        name='investor-trend-poll', daemon=True,
    )
    t.start()
    return t
