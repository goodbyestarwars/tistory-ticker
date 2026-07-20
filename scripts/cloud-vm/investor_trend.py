# -*- coding: utf-8 -*-
"""메인 페이지 "투자자별 매매 동향" 위젯(작업지시서 #4, 2026-07-20) - 코스피 시장 전체
개인/외국인/기관계 일별 순매수(억원) 수집 + 일/주/월 집계.

작업지시서는 키움 TR(get_investor_summary/get_investor_trend)을 stk_cd 없이 호출하면
시장 전체(코스피) 값을 준다고 가정했지만, 실측 결과(2026-07-20, MCP get_investor_summary/
get_investor_trend를 stk_cd 없이 직접 호출) 둘 다 `오류: 'stk_cd'`로 실패 - 두 TR 모두
종목별 조회 전용이고 시장 전체 집계를 지원하지 않는다.

**데이터 소스(2026-07-20 2차 개편)**: 1차 소스는 KIS(한국투자증권) TR `FHPTJ04040000`
(시장별 투자자매매동향(일별), kis_client.fetch_market_investor_daily) - 한국투자 HTS
[0404] 시장별 일별동향 화면과 1:1 대응하는 정식 API. 하루치씩만 조회되는 구조라(공식
예제가 FID_INPUT_DATE_1=FID_INPUT_DATE_2만 검증됨) 날짜별로 반복 호출해 DB(investor_trend_daily)
에 쌓는다(사용자 판단: "숫자 데이터라 용량 부담 없으니 일별로 저장" - 2026-07-20).
`_tr_pbmn`(거래대금) 필드 단위는 배포 직후 라이브 응답으로 실측 검증함(2026-07-20) -
처음엔 원 단위로 가정해 /1e8 했더니 결과가 비정상적으로 작았고(0.00349억 등), 그 직전
네이버 캐시값과 비교해보니 정확히 100만배 차이가 나서 실제로는 백만원 단위임을 확인,
/100으로 수정(_kis_row_to_common 참고). 외국인 필드도 종목별 KIS TR(FHPTJ04160001)의
"frgn_reg_ntby_qty(등록 외국인)을 써야 Toss/키움HTS와 일치" 실측 기록을 따라
frgn_ntby_tr_pbmn(등록+비등록 전체) 대신 frgn_reg_ntby_pbmn(등록만)으로 수정함.
KIS_APPKEY/APPSECRET이 없거나 KIS 호출이 실패하면 네이버(finance.naver.com/sise/
investorDealTrendDay.naver, domestic_futures.py와 동일한 소스·우회 사유)로 폴백하고,
그것도 실패하면 키움 ka10051("종합 KOSPI" 행, "오늘"만 제공)로 한 번 더 폴백한다 -
아래 fetch_recent/refresh_recent/refresh_history/fetch_kiwoom_today가 그 폴백 경로들.

**최종 결론(2026-07-20, 3차)**: 이 위젯이 원래 목표했던 "HTS 투자자별매매종합([0780]/
[0404]/[0403] 등) 코스피 행"과 정확히 일치하는 소스는 못 찾음 - KIS 일별(FHPTJ04040000,
필드 수정 포함)/키움 ka10051(stex_tp 무관)/KIS 시세(FHPTJ04030000) 세 가지를 실측했지만
전부 토스·키움 HTS 값과 달랐고, 키움 공식 AI 문의로도 "공개된 REST TR 중 그 화면과
1:1 대응하는 건 없고, 종목별 TR(ka10059)을 전 종목(800여개) 순회 합산해야 하는데 그래도
ETF 포함여부·단위처리 등 화면 내부 로직 차이로 완전 일치는 보장 안 됨"이라는 답을 받음
(전종목 순회는 매 갱신마다 호출량이 비현실적이라 채택 안 함). 사용자 판단으로 KIS
일별을 최종 소스로 채택 - "오늘"과 과거 이력을 동일한 TR·동일한 방법론으로 계산해서
날짜 간 비교의 일관성은 보장되지만, 특정 HTS 위젯의 절대값과는 다를 수 있음을 감안할 것.

네이버 폴백 검증 경위(2026-07-20, curl 실측):
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


# ---- KIS(1차 소스) - 시장별 투자자매매동향(일별), 날짜별 반복 호출 ----

_KIS_CALL_DELAY_SEC = 0.25  # 백필 시 과도한 연속 호출 방지(공식 rate limit 문서화 안 돼있어 보수적으로)
_KIS_TARGET_DAYS = _HISTORY_PAGES * _ROWS_PER_PAGE  # 네이버 폴백과 동일한 보관량(140행)
_KIS_MAX_CALENDAR_DAYS = 220  # 주말/공휴일 포함해도 140영업일을 채우기 충분한 여유


def _kis_row_to_common(date_str, row):
    """2026-07-20 배포 후 라이브 응답으로 실측 검증: /1e8(원 단위 가정) 적용 시 07.20 값이
    0.00349007억 같은 비정상적으로 작은 값이 나옴 - 이전 네이버 캐시값(3490)과 비교해보니
    딱 100만배 차이 -> _tr_pbmn 필드는 원이 아니라 백만원 단위였음. /100이 맞는 환산.

    2026-07-20 2차: 외국인 필드를 frgn_ntby_tr_pbmn(등록+비등록 전체)로 썼었는데, 같은 KIS
    TR 계열의 종목별 버전(FHPTJ04160001, kis_client.fetch_investor_trade_daily 독스트링)에
    이미 "frgn_reg_ntby_qty(등록 외국인)을 써야 Toss/키움HTS와 일치, 전체(등록+비등록)는
    다른 값"이라는 실측 기록이 있었음 - 시장별 TR도 같은 규칙이 적용될 가능성이 높아
    frgn_reg_ntby_pbmn(외국인 등록 순매수 대금)으로 교체."""
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


def fetch_kis_day(token, appkey, appsecret, date_str):
    """date_str('YYYYMMDD') 하루치. 휴장일/데이터 없음이면 None."""
    output = kis_client.fetch_market_investor_daily(token, appkey, appsecret, date_str, date_str, market_iscd='KSP')
    if not output:
        return None
    return _kis_row_to_common(date_str, output[0])


def backfill_kis(appkey, appsecret, target_days=_KIS_TARGET_DAYS, max_calendar_days=_KIS_MAX_CALENDAR_DAYS):
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
                    row = fetch_kis_day(token, appkey, appsecret, date_str)
                except Exception:
                    logger.exception('investor_trend KIS backfill failed at %s', date_str)
                if row:
                    db_schema.upsert_investor_trend_rows(conn, [row])
                    collected += 1
                time.sleep(_KIS_CALL_DELAY_SEC)
            d -= timedelta(days=1)
    finally:
        conn.close()
    logger.info('investor_trend KIS backfill done: %d trading days over %d calendar days', collected, calendar_checked)


_FORCE_KIS_REBACKFILL = False  # 2026-07-20: frgn_ntby_tr_pbmn->frgn_reg_ntby_pbmn 필드 수정을
# 기존 백필 데이터에도 반영하려고 1회 True로 배포해 재백필 완료함(라이브 확인됨) - 다시 False로.


def _ensure_kis_backfill(appkey, appsecret):
    """이미 충분히 쌓여있으면(재시작 등) 백필을 건너뛴다 - 매번 130여회 호출은 낭비.
    _FORCE_KIS_REBACKFILL=True인 동안은 건너뛰지 않고 항상 재백필(필드 수정 반영용)."""
    if not _FORCE_KIS_REBACKFILL:
        conn = db_schema.get_conn()
        try:
            existing = db_schema.load_investor_trend_daily(conn, limit_days=_KIS_TARGET_DAYS)
        finally:
            conn.close()
        if len(existing) >= _KIS_TARGET_DAYS - 5:
            logger.info('investor_trend KIS backfill skipped - already have %d rows', len(existing))
            return
    backfill_kis(appkey, appsecret)


def refresh_recent_kis(appkey, appsecret):
    """1분 폴링용 - 오늘 하루치만 재조회(장중 값 갱신)."""
    token = kis_client.get_token(appkey, appsecret)
    date_str = _today_bizdate()
    row = fetch_kis_day(token, appkey, appsecret, date_str)
    if not row:
        logger.warning('investor_trend: KIS recent fetch got no row for %s', date_str)
        return
    conn = db_schema.get_conn()
    try:
        db_schema.upsert_investor_trend_rows(conn, [row])
        logger.info('investor_trend KIS recent refreshed: %s ind=%.0f frgn=%.0f orgn=%.0f',
                     row['date'], row['ind'], row['frgn'], row['orgn'])
    finally:
        conn.close()


# ---- 키움(3차, "오늘"만) - ka10051 업종별투자자순매수의 "종합(KOSPI)" 행 ----

def fetch_kiwoom_today(appkey, secretkey):
    """ka10051은 날짜 파라미터가 없어 현재/최근 확정 스냅샷만 준다 - "오늘" 전용.
    stex_tp=3(통합 KRX+NXT)이 이 프로젝트 관례(market_rank.py, kis_client.py 등)."""
    token = kiwoom_client.get_token(appkey, secretkey)
    res = kiwoom_client.call_tr(token, 'ka10051', '/api/dostk/sect', {
        'mrkt_tp': '0',
        'amt_qty_tp': '1',
        'stex_tp': '3',
    })
    rows = res.get('inds_netprps') or []
    kospi_row = None
    for r in rows:
        if str(r.get('inds_cd', '')).startswith('001'):
            kospi_row = r
            break
    if not kospi_row:
        logger.warning('investor_trend: ka10051 응답에서 종합(KOSPI) 행을 못 찾음 - return_code=%s',
                        res.get('return_code'))
        return None

    def amt(key):
        try:
            return float(str(kospi_row.get(key) or '0').replace(',', ''))
        except (TypeError, ValueError):
            return 0.0

    return {
        'date': _today_bizdate(),
        'ind': amt('ind_netprps'),
        'frgn': amt('frgnr_netprps'),
        'orgn': amt('orgn_netprps'),
    }


def refresh_recent_kiwoom(appkey, secretkey):
    """1분 폴링용 - "오늘" 행만 키움으로 덮어쓴다(과거 행은 KIS/네이버 백필 그대로 유지)."""
    row = fetch_kiwoom_today(appkey, secretkey)
    if not row:
        return
    conn = db_schema.get_conn()
    try:
        db_schema.upsert_investor_trend_rows(conn, [row])
        logger.info('investor_trend Kiwoom recent refreshed: %s ind=%.0f frgn=%.0f orgn=%.0f',
                     row['date'], row['ind'], row['frgn'], row['orgn'])
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


def _refresh_recent_chain(has_kiwoom, kiwoom_appkey, kiwoom_secretkey, has_kis, kis_appkey, kis_appsecret):
    """"오늘" 행 갱신 - KIS(FHPTJ04040000) 1순위 -> 키움(ka10051) 2순위 -> 네이버 3순위.

    2026-07-20 최종 결론: 이 위젯이 목표로 삼았던 "HTS [0780] 투자자별매매종합 코스피 행"과
    비트단위로 일치하는 공식 REST API는 없음(키움 AI 문의로 확인 - 종목별 TR을 전 종목
    순회하며 합산해야 하는데 그래도 ETF/ETN 포함여부·단위 처리 등이 화면 로직과 다를 수 있어
    완전 일치가 보장 안 됨, 호출량도 800여 종목 x 매 갱신마다라 비현실적).
    시도한 3개 소스(KIS 일별/키움 ka10051/KIS 시세) 전부 그 화면과 다른 값을 냄 - KIS를
    최종으로 택한 이유는 "같은 TR로 오늘과 과거 이력을 동일한 방법론으로 계산"해서 최소한
    날짜 간 비교는 일관되기 때문(키움 ka10051은 "오늘"만 주고 과거를 못 줘서 오늘/과거가
    서로 다른 방법론으로 섞이는 문제가 있었음)."""
    if has_kis:
        try:
            refresh_recent_kis(kis_appkey, kis_appsecret)
            return
        except Exception:
            logger.exception('refresh_recent_kis failed - falling back for this tick')
    if has_kiwoom:
        try:
            refresh_recent_kiwoom(kiwoom_appkey, kiwoom_secretkey)
            return
        except Exception:
            logger.exception('refresh_recent_kiwoom failed - falling back for this tick')
    try:
        refresh_recent()
    except Exception:
        logger.exception('refresh_recent (Naver fallback) failed')


def _poll_loop(kis_appkey=None, kis_appsecret=None, kiwoom_appkey=None, kiwoom_secretkey=None):
    has_kis = bool(kis_appkey and kis_appsecret)
    has_kiwoom = bool(kiwoom_appkey and kiwoom_secretkey)

    # 과거 이력(주/월 탭용)은 키움(ka10051)이 못 주므로 여전히 KIS 1차/네이버 2차로 백필.
    if has_kis:
        try:
            _ensure_kis_backfill(kis_appkey, kis_appsecret)
        except Exception:
            logger.exception('investor_trend KIS backfill failed - falling back to Naver history for now')
            has_kis = False
            try:
                refresh_history()
            except Exception:
                logger.exception('refresh_history (Naver fallback) failed')
    else:
        try:
            refresh_history()
        except Exception:
            logger.exception('refresh_history failed')

    last_naver_history_refresh = time.time()
    while True:
        _refresh_recent_chain(has_kiwoom, kiwoom_appkey, kiwoom_secretkey, has_kis, kis_appkey, kis_appsecret)
        if not has_kis:
            now = time.time()
            if now - last_naver_history_refresh > _HISTORY_REFRESH_SEC:
                try:
                    refresh_history()
                except Exception:
                    logger.exception('refresh_history failed')
                last_naver_history_refresh = now
        time.sleep(_RECENT_POLL_SEC)


def start_background(kis_appkey=None, kis_appsecret=None, kiwoom_appkey=None, kiwoom_secretkey=None):
    t = threading.Thread(
        target=_poll_loop, args=(kis_appkey, kis_appsecret, kiwoom_appkey, kiwoom_secretkey),
        name='investor-trend-poll', daemon=True,
    )
    t.start()
    return t
