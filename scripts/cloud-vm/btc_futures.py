# -*- coding: utf-8 -*-
"""BTC(KRW-BTC) - 업비트 공개 API 수집.
2026-07-17: 처음엔 방문자 브라우저가 직접 api.upbit.com을 호출하는 방식(js/quick-indices.js)
으로 구현했는데, candles(일봉) 엔드포인트가 ticker보다 훨씬 빡빡하게 레이트리밋을 걸고
그 응답엔 CORS 헤더가 없어(브라우저에서 "Failed to fetch"로만 보임) 라이브에서 차트가
간헐적으로 안 뜨는 문제가 있었다(사용자 실측 보고). 다른 해외지수(foreign_futures.py)와
동일하게 VM이 서버사이드로 수집해 DB에 저장하면, 방문자 브라우저는 이제 이 VM(/futures)
만 호출하므로 업비트 레이트리밋/CORS 문제 자체가 사라진다 - VM 자신은 30초에 한 번만
업비트를 때려서 레이트리밋에 걸릴 일이 거의 없다.
API 문서: https://docs.upbit.com (인증 불필요, public 엔드포인트)."""

import json
import logging
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import db_schema

logger = logging.getLogger('btc_futures')

UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
SYMBOL = 'BTC'
NAME = 'BTC'
MARKET = 'KRW-BTC'

_REALTIME_POLL_SEC = 30
_HISTORY_REFRESH_INTERVAL = 6 * 3600
# 52주(365일) 이동평균선을 보여달라는 요청(2026-07-18) - 업비트 캔들 API는 count가 최대
# 200으로 잘려서(count=365를 줘도 200개만 옴, 실측 확인) 하루치 이상 필요하면 to= 파라미터로
# 과거로 페이징해야 한다. 380일치를 모아 여유를 둔다.
_HISTORY_TOTAL_DAYS = 380


def _get_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read().decode('utf-8'))


def fetch_ticker():
    data = _get_json('https://api.upbit.com/v1/ticker?markets=' + MARKET)
    t = (data or [None])[0]
    if not t:
        return None
    try:
        price = float(t['trade_price'])
        change = float(t['signed_change_price'])
        change_rate = float(t['signed_change_rate']) * 100
        high = float(t['high_price'])
        low = float(t['low_price'])
    except (KeyError, ValueError, TypeError):
        return None
    return {'price': price, 'change': change, 'change_rate': change_rate, 'high': high, 'low': low}


def fetch_daily_chart(total_days=_HISTORY_TOTAL_DAYS):
    """count가 200으로 잘리는 업비트 제약 때문에 to= 파라미터로 과거로 페이징하며 모은다."""
    rows_by_date = {}
    to_param = None
    remaining = total_days
    while remaining > 0:
        count = min(200, remaining)
        url = 'https://api.upbit.com/v1/candles/days?market=%s&count=%d' % (MARKET, count)
        if to_param:
            url += '&to=' + urllib.parse.quote(to_param)
        data = _get_json(url)
        if not data:
            break
        for c in data:
            try:
                # future_chart.date는 다른 수집기(foreign_futures.py의 localDate,
                # domestic_futures.py 등)와 통일되게 'YYYYMMDD'(대시 없음)로 저장해야 한다 -
                # 업비트 응답은 'YYYY-MM-DD...'라 대시를 떼어내지 않으면 js/overnight-market.js의
                # toLwcTime()이 대시 없는 8자리를 가정하고 잘라서 날짜가 깨짐(2026-07-18 발견 -
                # BTC 카드만 미니차트가 다시 안 뜨던 원인. 2026-07-17에 GAS->VM으로 소스를 바꿀 때
                # 이 포맷 통일을 놓쳤었음).
                date_key = c['candle_date_time_kst'][:10].replace('-', '')
                rows_by_date[date_key] = {
                    'date': date_key,
                    'open': float(c['opening_price']),
                    'high': float(c['high_price']),
                    'low': float(c['low_price']),
                    'close': float(c['trade_price']),
                }
            except (KeyError, ValueError, TypeError):
                continue
        remaining -= len(data)
        if len(data) < count:
            break  # 업비트가 더 이상 과거 데이터가 없다고 판단(상장 초기 등)
        to_param = data[-1]['candle_date_time_kst'].replace('T', ' ')
    return sorted(rows_by_date.values(), key=lambda r: r['date'])


def refresh_realtime():
    conn = db_schema.get_conn()
    try:
        q = fetch_ticker()
        if not q:
            return
        now_iso = datetime.now(timezone.utc).isoformat()
        db_schema.upsert_future_price(
            conn, SYMBOL, NAME, q['price'], q['change'], q['change_rate'], q['high'], q['low'], now_iso,
        )
    except Exception:
        logger.exception('btc realtime fetch failed')
    finally:
        conn.close()


def refresh_history():
    conn = db_schema.get_conn()
    try:
        rows = fetch_daily_chart()
        if rows:
            db_schema.upsert_future_chart_rows(conn, SYMBOL, rows)
            logger.info('btc history refreshed: %d rows', len(rows))
    except Exception:
        logger.exception('btc history fetch failed')
    finally:
        conn.close()


def _poll_loop():
    last_history_refresh = 0
    while True:
        try:
            refresh_realtime()
        except Exception:
            logger.exception('refresh_realtime failed')
        now = time.time()
        if now - last_history_refresh > _HISTORY_REFRESH_INTERVAL:
            try:
                refresh_history()
            except Exception:
                logger.exception('refresh_history failed')
            last_history_refresh = now
        time.sleep(_REALTIME_POLL_SEC)


def start_background():
    t = threading.Thread(target=_poll_loop, name='btc-futures-poll', daemon=True)
    t.start()
    return t
