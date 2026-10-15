# -*- coding: utf-8 -*-
"""채권 금리(%) 수집 - 국고채 3년물(네이버) + 미국 국채 10/2/30년물(FRED).

국고채 3년물: 2026-10-08 기존 네이버 HTML 주소가 410으로 폐쇄된 것을 확인.
api.stock.naver.com/marketindex/domesticInterest/KFIA103000/prices의 60행 JSON으로
교체했다. 같은 국고채3년 종가 금리(%)이며 기존 저장본 49일과 대조해 차이 최대
0.01%p(소수 표시 차이)를 확인했다. 400관측치 수집 호출은 최대58회에서7회로 감소.

미국 국채 10/2/30년물: FRED(세인트루이스 연준, fred.stlouisfed.org) 공식 CSV를 API 키 없이
바로 받는다(graph/fredgraph.csv?id=DGS10 등) - 정부 공식 통계라 가장 신뢰도 높은 무료 소스.
한국 국고채 10년물도 FRED에 있긴 하지만(IRLTLT01KRM156N) OECD 월간 집계라 하루 1번 갱신되는
나머지 채권 카드들과 갱신 주기가 안 맞아 보류함(2026-07-18, 사용자와 상의해 결정) - 나중에
일별 소스를 찾으면 추가.

이 지표들은 전부 "장중 실시간"이 아니라 "하루 1번 갱신되는 종가"라 나머지 해외선물(30초 폴링)과
갱신 주기를 맞출 필요가 없다 - _POLL_INTERVAL_SEC을 6시간으로 길게 잡는다.
금리는 오를수록(채권 가격 하락) 긴축/할인율 상승으로 보통 증시에 부담 - 프론트에서
direction:-1(상승=악재)로 취급한다(js/overnight-market.js CATEGORIES 참고)."""

import json
import math
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

_POLL_INTERVAL_SEC = 6 * 3600          # KTB3Y(네이버 58페이지 조회라 무거움)는 예전처럼 6시간마다
# 2026-10-15: FRED 미국 발표(CPI 등)는 6시간 주기라 발표(미국 동부 08:30 = 한국 21:30/22:30)가 FRED에 반영된 뒤에도
# 최대 6시간 이전 값에 머물렀다(2026-10-14 9월 CPI). 발표가 몰리는 평일 21:30~다음날 04:00(KST)에는 15분마다,
# 그 밖에는 2시간마다 받는다. FRED CSV는 가벼운 요청 10건이라 e2-micro 부담이 작다.
_FRED_POLL_SEC = 2 * 3600
_FRED_RELEASE_POLL_SEC = 15 * 60
_KST = timezone(timedelta(hours=9))
# 2026-07-18: 90일 -> 400일로 확대(사용자 지적 - "3개월 평균은 너무 짧다") - 다른 벤치마크
# 심볼(foreign_futures.py의 WTI/VIX/USDKRW, FRED 미국 국채)도 전부 400일 안팎을 쓰므로
# 맞춤. 실측: page=53(약 371일치)까지도 계속 다른 날짜가 나와 400일 확보 가능함을 확인.
_HISTORY_DAYS = 400
_ROWS_PER_PAGE = 60

# 미국 국채·주요 미국 발표 - FRED 시리즈 ID. 값 자체가 %(예: 4.57)라
# db_schema.upsert_future_price에 price로 그대로 넣으면 된다(원/포인트 단위 변환 불필요).
# 거시 발표는 BLS·BEA·미시간대가 공표한 원자료를 FRED 공식 CSV로 받아 6시간마다
# 갱신한다. 화면에서 단순 "지수"만 나열하지 않고 물가·고용·경기를 함께 판단할 수
# 있도록 헤드라인 CPI, 근원 물가, 고용, 소비심리를 모두 같은 수집 경로에 둔다.
FRED_SYMBOLS = {
    'US10Y': {'series': 'DGS10', 'name': '미국 국채 10년물 금리(%)'},
    'US2Y': {'series': 'DGS2', 'name': '미국 국채 2년물 금리(%)'},
    'US30Y': {'series': 'DGS30', 'name': '미국 국채 30년물 금리(%)'},
    'US_CPI': {'series': 'CPIAUCSL', 'name': '미국 소비자물가지수(CPI, 지수)'},
    'US_CORE_CPI': {'series': 'CPILFESL', 'name': '미국 근원 소비자물가지수(Core CPI, 지수)'},
    'US_CORE_PCE': {'series': 'PCEPILFE', 'name': '미국 근원 개인소비지출물가지수(Core PCE, 지수)'},
    'US_PPI': {'series': 'PPIACO', 'name': '미국 생산자물가지수(PPI, 지수)'},
    'US_PPI_FINAL_DEMAND': {'series': 'PPIFIS', 'name': '미국 최종수요 생산자물가지수(PPI, 계절조정)'},
    'US_REAL_GDP_GROWTH': {'series': 'A191RL1Q225SBEA', 'name': '미국 실질 GDP 성장률(연율, %)'},
    'US_NONFARM_PAYROLLS': {'series': 'PAYEMS', 'name': '미국 비농업고용(천 명)'},
    'US_UNEMPLOYMENT': {'series': 'UNRATE', 'name': '미국 실업률(%)'},
    # JOLTS의 구인건수는 고용보고서와 다른 조사다. 채용 수요가 꺾이는지를 가장 빨리
    # 확인할 수 있어, 월초 고용지표와 함께 화면에 제공한다. FRED 값의 단위는 천 건이다.
    'US_JOB_OPENINGS': {'series': 'JTSJOL', 'name': '미국 JOLTS 구인건수(천 건)'},
    'US_RETAIL_SALES': {'series': 'RSAFS', 'name': '미국 소매판매(백만 달러)'},
    'US_CONSUMER_SENTIMENT': {'series': 'UMCSENT', 'name': '미국 소비자심리지수(미시간대, pt)'},
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
    # Legacy interestDailyQuote retired in September 2026 (HTTP 410).
    # KFIA103000 is Naver's domestic 3-year government bond closing-yield series.
    url = ('https://api.stock.naver.com/marketindex/domesticInterest/'
           'KFIA103000/prices?page=%d&pageSize=%d' % (page, _ROWS_PER_PAGE))
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=15) as res:
        data = json.loads(res.read().decode('utf-8'))
    rows = []
    for item in data:
        try:
            value = float(str(item['closePrice']).replace(',', ''))
            change = float(str(item['fluctuations']).replace(',', ''))
            pct = float(str(item['fluctuationsRatio']).replace(',', ''))
            date = item['localTradedAt'][:10].replace('-', '')
            if not re.fullmatch(r'\d{8}', date) or not all(math.isfinite(v) for v in (value, change, pct)):
                continue
        except (KeyError, TypeError, ValueError):
            continue
        rows.append({'date': date, 'value': value, 'change': change, 'change_rate': pct})
    return rows


_PAGE_THROTTLE_SEC = 0.2  # 2026-08-21 코드 감사: 400일/7행 기준 최대 58페이지를 쉬는
                          # 시간 없이 순차 호출하고 있었음(6시간마다 반복) - 네이버 차단
                          # 위험을 줄이기 위한 최소한의 쓰로틀.


def fetch_history(days=_HISTORY_DAYS):
    """과거로 페이징하며 days일치를 모은다. 페이지가 빈 값(더 이상 데이터 없음)을 주면 중단."""
    rows = []
    pages = max(1, -(-days // _ROWS_PER_PAGE))  # ceil
    for page in range(1, pages + 1):
        page_rows = _fetch_page(page)
        if not page_rows:
            break
        rows.extend(page_rows)
        if page < pages:
            time.sleep(_PAGE_THROTTLE_SEC)
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


MACRO_SYMBOLS = tuple(symbol for symbol in FRED_SYMBOLS if symbol.startswith('US_'))
_fred_refresh_lock = threading.Lock()


def refresh_fred_all(symbols=None):
    """Refresh selected FRED series; return successful and failed source counts."""
    with _fred_refresh_lock:
        return _refresh_fred_locked(symbols)


def _refresh_fred_locked(symbols):
    selected = symbols if symbols is not None else FRED_SYMBOLS
    success = 0
    failed = 0
    conn = db_schema.get_conn()
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        for symbol in selected:
            meta = FRED_SYMBOLS[symbol]
            try:
                rows = fetch_fred_series(meta['series'])
            except Exception:
                logger.exception('FRED fetch failed: %s', symbol)
                failed += 1
                continue
            if not rows:
                failed += 1
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
            success += 1
            logger.info('FRED refreshed: %s value=%.3f latest_obs=%s (%d rows)', symbol, latest['value'], latest['date'], len(chart_rows))
    finally:
        conn.close()
    return {'success': success, 'failed': failed}


def _fred_poll_seconds(now=None):
    """다음 FRED 조회까지 기다릴 초. 평일 저녁 21:30~다음날 04:00(KST) 발표·반영 구간이면 15분, 아니면 2시간."""
    now = (now or datetime.now(_KST)).astimezone(_KST)
    minutes = now.hour * 60 + now.minute
    if minutes >= 21 * 60 + 30:
        in_window = now.weekday() < 5            # 월~금 저녁
    elif minutes < 4 * 60:
        in_window = 1 <= now.weekday() <= 5      # 화~토 새벽(전날 저녁 발표분)
    else:
        in_window = False
    return _FRED_RELEASE_POLL_SEC if in_window else _FRED_POLL_SEC


def _poll_step(last_ktb, now_ts=None):
    """한 번의 조회. KTB3Y는 6시간이 지났을 때만, FRED는 매번. 새 last_ktb(시각)를 돌려준다."""
    now_ts = time.time() if now_ts is None else now_ts
    if last_ktb is None or now_ts - last_ktb >= _POLL_INTERVAL_SEC:
        try:
            refresh_ktb3y()
        except Exception:
            logger.exception('KTB3Y refresh failed')
        last_ktb = now_ts
    try:
        refresh_fred_all()
    except Exception:
        logger.exception('refresh_fred_all failed')
    return last_ktb


def _poll_loop():
    last_ktb = None
    while True:
        last_ktb = _poll_step(last_ktb)
        time.sleep(_fred_poll_seconds())


def start_background():
    t = threading.Thread(target=_poll_loop, name='bond-yield-poll', daemon=True)
    t.start()
    return t
