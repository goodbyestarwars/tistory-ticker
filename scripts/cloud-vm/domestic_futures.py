# -*- coding: utf-8 -*-
"""코스피/코스닥 지수 + 코스피200 주간선물(FUT) + 원/달러 환율 - 네이버 국내 API 수집.
foreign_futures.py(나스닥100/S&P500/다우/SOX/VIX/WTI 등, 해외종)와 짝을 이루는 국내판.
관심지수 리본(js/quick-indices.js)의 코스피/코스닥 미니차트, "코스피 선물" 페이지
(주간선물+야간선물), "보조지수" 페이지(환율 카드)가 이 모듈의 데이터를 공유한다.

검증 경위(2026-07-15, curl 실측 - 전부 코드 작성 전에 실제 호출로 확인함):
- 코스피200 주간선물 실시간: polling.finance.naver.com/api/realtime/domestic/index/FUT
  (주의: 카테고리가 'futures'가 아니라 'index' - 과거 일봉 API(chart/domestic/futures/FUT/day)와
  카테고리 표기가 다름, 네이버 API 자체가 그렇게 나뉘어 있음). foreign_futures.py의 fetch_realtime과
  응답 필드가 완전히 동일(closePriceRaw 등)해서 그대로 재사용.
- 원/달러 환율: 현재가는 api.stock.naver.com/marketindex/exchange/FX_USDKRW(exchangeInfo,
  고가/저가 필드 없음 - 카드에 '-'로 표시됨, 정상), 과거 일봉은 같은 경로 뒤에
  /prices?page=1&pageSize=60(최대 60건 - 그 이상 요청하면 에러 메시지 반환, 실측 확인) -
  둘 다 지수/선물 API와 필드 이름이 완전히 달라 별도 파서가 필요하다. 날짜가 'YYYY-MM-DD'로
  오는데 future_chart 테이블은 다른 심볼들과 통일되게 'YYYYMMDD'로 저장한다(대시 제거) -
  프론트 toLwcTime()이 모든 심볼에 동일하게 YYYYMMDD 입력을 가정하기 때문.
User-Agent를 모바일 값으로 고정해야 함 - 아니면 404/에러 HTML이 돌아옴(foreign_futures.py와 동일).

2026-07-16(2차) - 이후 정정됨(3차 참고): 코스피 현물지수(KOSPI_CASH) 수집을 한 차례 제거했었다.
당시 chart/domestic/index/KOSPI/day가 하루 변동폭 5~10%씩 튀는 걸 보고 "신뢰 불가 데이터"로
잘못 판단했는데, 실제로는 실시간 시세(polling.finance.naver.com/api/realtime/domestic/index/*)와
정확히 일치하는 진짜 데이터였다(이 시기 실제로 변동성이 큰 장세였을 뿐) - 사용자가 지적해서
재검증 후 확인. 이 API 자체는 정상이니 앞으로 이 계열(chart/domestic/index/*)을 다시 의심하지
말 것 - 아래 3차에서 코스피/코스닥을 다시 정식으로 추가했다.

2026-07-16(3차): 위 오판을 정정하고 코스피/코스닥 지수(KOSPI/KOSDAQ)를 실시간+과거 일봉 둘 다
정식으로 추가했다(관심지수 리본이 미니차트 없이 현재가만 보여주던 문제 해결 - js/quick-indices.js
쪽에서 source를 'market'(GAS, 이력 없음)에서 'futures'(이 모듈, 이력 있음)로 전환).
KOSPI_CASH라는 이름은 되살리지 않고 그냥 심볼명을 'KOSPI'/'KOSDAQ'로 통일했다(이전엔 리본의
market 소스 키와 겹치지 않게 KOSPI_CASH로 구분했었는데, 이제 이 모듈이 유일한 소스가 됐으니
불필요). "코스피 선물"/"보조지수" 페이지는 여전히 코스피/코스닥을 안 쓴다(사용자가 리본과
중복이라고 명시적으로 뺀 부분 - 이건 데이터 품질과 무관한 별개의 스코프 결정이라 그대로 둠)."""

import json
import logging
import threading
import time
import urllib.request
from datetime import datetime, timedelta, timezone

import db_schema

logger = logging.getLogger('domestic_futures')

UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'

# {symbol: (표시명, 네이버 code)} - realtime/domestic/index/{code} API로 커버됨.
REALTIME_SYMBOLS = {
    'KOSPI200_DAY': ('코스피200 주간선물', 'FUT'),
    'KOSPI': ('코스피', 'KOSPI'),
    'KOSDAQ': ('코스닥', 'KOSDAQ'),
}

# 과거 일봉을 수집하는 심볼 - {symbol: (네이버 chart category, 네이버 code)}.
# chart API는 realtime과 카테고리 표기가 다를 수 있음(FUT는 'futures', KOSPI/KOSDAQ는 'index').
CHART_SYMBOLS = {
    'KOSPI200_DAY': ('futures', 'FUT'),
    'KOSPI': ('index', 'KOSPI'),
    'KOSDAQ': ('index', 'KOSDAQ'),
}

_REALTIME_POLL_SEC = 30
_HISTORY_REFRESH_INTERVAL = 6 * 3600


def _get_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read().decode('utf-8'))


# ---- 코스피200 주간선물 / 코스피 현물지수 (foreign_futures.py의 fetch_realtime과 응답 구조 동일) ----

def fetch_index_realtime(code):
    url = 'https://polling.finance.naver.com/api/realtime/domestic/index/%s' % code
    data = _get_json(url)
    datas = data.get('datas') or []
    if not datas:
        return None
    d = datas[0]
    try:
        price = float(d['closePriceRaw'])
        change = float(d['compareToPreviousClosePriceRaw'])
        change_rate = float(d['fluctuationsRatioRaw'])
        high = float(d['highPriceRaw'])
        low = float(d['lowPriceRaw'])
    except (KeyError, ValueError, TypeError):
        return None
    sign = (d.get('compareToPreviousPrice') or {}).get('name')
    if sign in ('FALLING', 'LOWER_LIMIT'):
        change = -abs(change)
        change_rate = -abs(change_rate)
    return {'price': price, 'change': change, 'change_rate': change_rate, 'high': high, 'low': low}


def fetch_domestic_index_chart(category, code, days=90):
    date2 = datetime.now().strftime('%Y%m%d')
    date1 = (datetime.now() - timedelta(days=days)).strftime('%Y%m%d')
    url = ('https://api.stock.naver.com/chart/domestic/%s/%s/day?startDateTime=%s&endDateTime=%s'
           % (category, code, date1, date2))
    data = _get_json(url)
    rows = []
    for r in data:
        try:
            rows.append({
                'date': r['localDate'],
                'open': float(r['openPrice']),
                'high': float(r['highPrice']),
                'low': float(r['lowPrice']),
                'close': float(r['closePrice']),
            })
        except (KeyError, ValueError, TypeError):
            continue
    return rows


# ---- 원/달러 환율 (필드 구조가 지수/선물과 달라 별도 파서 필요) ----

def fetch_fx_realtime():
    url = 'https://api.stock.naver.com/marketindex/exchange/FX_USDKRW'
    data = _get_json(url)
    info = data.get('exchangeInfo')
    if not info:
        return None
    try:
        price = float(str(info['closePrice']).replace(',', ''))
        change = float(str(info['fluctuations']).replace(',', ''))
        change_rate = float(str(info['fluctuationsRatio']).replace(',', ''))
    except (KeyError, ValueError, TypeError):
        return None
    return {'price': price, 'change': change, 'change_rate': change_rate, 'high': None, 'low': None}


def fetch_fx_daily_chart():
    url = 'https://api.stock.naver.com/marketindex/exchange/FX_USDKRW/prices?page=1&pageSize=60'
    data = _get_json(url)
    rows = []
    for r in data:
        try:
            date = str(r['localTradedAt']).replace('-', '')  # 'YYYY-MM-DD' -> 'YYYYMMDD' 통일
            close = float(str(r['closePrice']).replace(',', ''))
            rows.append({'date': date, 'open': close, 'high': close, 'low': close, 'close': close})
        except (KeyError, ValueError, TypeError):
            continue
    rows.reverse()  # API가 최신순으로 주므로 upsert 전에 날짜 오름차순으로 뒤집음(다른 심볼과 통일)
    return rows


def refresh_realtime_all():
    conn = db_schema.get_conn()
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        for symbol, (name, code) in REALTIME_SYMBOLS.items():
            try:
                q = fetch_index_realtime(code)
            except Exception:
                logger.exception('domestic index realtime fetch failed: %s', symbol)
                continue
            if not q:
                continue
            db_schema.upsert_future_price(
                conn, symbol, name, q['price'], q['change'], q['change_rate'], q['high'], q['low'], now_iso,
            )
        try:
            fx = fetch_fx_realtime()
        except Exception:
            fx = None
            logger.exception('FX realtime fetch failed')
        if fx:
            db_schema.upsert_future_price(
                conn, 'USDKRW', '원/달러', fx['price'], fx['change'], fx['change_rate'], fx['high'], fx['low'], now_iso,
            )
    finally:
        conn.close()


def refresh_history_all():
    conn = db_schema.get_conn()
    try:
        for symbol, (category, code) in CHART_SYMBOLS.items():
            try:
                rows = fetch_domestic_index_chart(category, code)
                if rows:
                    db_schema.upsert_future_chart_rows(conn, symbol, rows)
                    logger.info('domestic futures history refreshed: %s %d rows', symbol, len(rows))
            except Exception:
                logger.exception('%s history fetch failed', symbol)
        try:
            rows = fetch_fx_daily_chart()
            if rows:
                db_schema.upsert_future_chart_rows(conn, 'USDKRW', rows)
                logger.info('domestic futures history refreshed: USDKRW %d rows', len(rows))
        except Exception:
            logger.exception('USDKRW history fetch failed')
    finally:
        conn.close()


def _poll_loop():
    last_history_refresh = 0
    while True:
        try:
            refresh_realtime_all()
        except Exception:
            logger.exception('refresh_realtime_all failed')
        now = time.time()
        if now - last_history_refresh > _HISTORY_REFRESH_INTERVAL:
            try:
                refresh_history_all()
            except Exception:
                logger.exception('refresh_history_all failed')
            last_history_refresh = now
        time.sleep(_REALTIME_POLL_SEC)


def start_background():
    t = threading.Thread(target=_poll_loop, name='domestic-futures-poll', daemon=True)
    t.start()
    return t
