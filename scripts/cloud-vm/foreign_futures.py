# -*- coding: utf-8 -*-
"""나스닥100/S&P500/SOX/VIX/WTI 5종 - 네이버 모바일 증권 API 수집.
실시간: polling.finance.naver.com/api/realtime/worldstock/{category}/{code}
과거일봉: api.stock.naver.com/chart/foreign/{category}/{code}/day (주의: 위 realtime의 'worldstock'과
다르게 chart 쪽은 반드시 'foreign' - 네이버 API 자체가 두 표현을 섞어 씀, 실측으로 확인된 사실).
User-Agent를 모바일 값으로 고정해야 함 - 아니면 404/에러 HTML이 돌아옴(실측 확인)."""

import json
import logging
import threading
import time
import urllib.request
from datetime import datetime, timedelta, timezone

import db_schema

logger = logging.getLogger('foreign_futures')

UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'

SYMBOLS = [
    {'key': 'NASDAQ100', 'name': '나스닥 100 선물', 'code': 'NQcv1', 'category': 'futures'},
    {'key': 'SP500', 'name': 'S&P500 선물', 'code': 'EScv1', 'category': 'futures'},
    # 2026-07-16 추가(사용자 요청) - 코드는 realtime/worldstock/futures/YMcv1로 실측 확인됨
    {'key': 'DOW', 'name': '다우 선물', 'code': 'YMcv1', 'category': 'futures'},
    {'key': 'SOX', 'name': '필라델피아 반도체지수', 'code': '.SOX', 'category': 'index'},
    {'key': 'VIX', 'name': 'VIX(변동성지수)', 'code': '.VIX', 'category': 'index'},
    {'key': 'WTI', 'name': 'WTI 원유', 'code': 'CLcv1', 'category': 'futures'},
    # 2026-07-17 추가(사용자 요청 - 관심지수 리본에 금 시세) - realtime/worldstock/futures/GCcv1
    # (COMEX 금 선물) curl 실측 확인됨. WTI(CLcv1)와 완전히 같은 패턴.
    {'key': 'GOLD', 'name': '금 선물', 'code': 'GCcv1', 'category': 'futures'},
    # 2026-07-16(2차) 추가 - "보조지수" 페이지에 선물뿐 아니라 실제 현물 지수도 같이 보여달라는
    # 요청. .SOX/.VIX와 동일한 category='index' 패턴이라 코드만 추가하면 됨(curl 실측 확인:
    # ac.stock.naver.com autocomplete로 .IXIC/.INX/.DJI 코드 확보, realtime 정상 응답 확인).
    {'key': 'NASDAQ_INDEX', 'name': '나스닥 종합지수', 'code': '.IXIC', 'category': 'index'},
    {'key': 'SP500_INDEX', 'name': 'S&P500 지수', 'code': '.INX', 'category': 'index'},
    {'key': 'DOW_INDEX', 'name': '다우존스 지수', 'code': '.DJI', 'category': 'index'},
]

_REALTIME_POLL_SEC = 30
_HISTORY_REFRESH_INTERVAL = 6 * 3600


def _get_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read().decode('utf-8'))


def fetch_realtime(sym):
    url = 'https://polling.finance.naver.com/api/realtime/worldstock/%s/%s' % (sym['category'], sym['code'])
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


def fetch_daily_chart(sym, days=90):
    date2 = datetime.now().strftime('%Y%m%d')
    date1 = (datetime.now() - timedelta(days=days)).strftime('%Y%m%d')
    url = ('https://api.stock.naver.com/chart/foreign/%s/%s/day?startDateTime=%s&endDateTime=%s'
           % (sym['category'], sym['code'], date1, date2))
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


def refresh_realtime_all():
    conn = db_schema.get_conn()
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        for sym in SYMBOLS:
            try:
                q = fetch_realtime(sym)
            except Exception:
                logger.exception('realtime fetch failed: %s', sym['key'])
                continue
            if not q:
                continue
            db_schema.upsert_future_price(
                conn, sym['key'], sym['name'], q['price'], q['change'], q['change_rate'],
                q['high'], q['low'], now_iso,
            )
    finally:
        conn.close()


def refresh_history_all():
    conn = db_schema.get_conn()
    try:
        for sym in SYMBOLS:
            try:
                rows = fetch_daily_chart(sym)
            except Exception:
                logger.exception('history fetch failed: %s', sym['key'])
                continue
            if rows:
                db_schema.upsert_future_chart_rows(conn, sym['key'], rows)
                logger.info('foreign futures history refreshed: %s %d rows', sym['key'], len(rows))
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
    t = threading.Thread(target=_poll_loop, name='foreign-futures-poll', daemon=True)
    t.start()
    return t
