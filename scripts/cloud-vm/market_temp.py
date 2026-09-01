# -*- coding: utf-8 -*-
"""증시온도 조립·저장·백그라운드 계산.

`docs/BACKEND_CONSOLIDATION.md` 1-d단계. 배점(`market_temp_score.py`)과 수집
(`market_temp_data.py`)을 묶어 GAS `?marketTemp=1`과 **같은 형태의 응답**을 만든다.

GAS와 다른 점은 계산 시점 하나다:
- GAS: 요청을 받고 나서 전종목을 긁는다 → 캐시 미스면 방문자가 7초를 문다.
- VM: 백그라운드 스레드가 주기적으로 계산해 저장 → 방문자는 저장된 값만 읽는다(수십 ms).

증시온도는 방문자마다 달라지지 않는 시장 전체 지표라 요청 경로에서 계산할 이유가 없다.
같은 이유로 캐시 워머 같은 보조 장치도 필요 없다 - 애초에 요청이 계산을 유발하지 않는다.

일별 온도 이력은 GAS가 `PropertiesService`에 넣던 것을 SQLite로 옮긴다
(`market_temp_daily` 테이블). 거래대금 이력과 달리 이건 파생 계산이라 재구성이 불가능해
새로 쌓아야 하고, 이력이 없는 동안 `history`는 null이 된다(GAS도 첫날은 같다).
"""

import json
import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone

import market_temp_data as data
import market_temp_score as score

LOGGER = logging.getLogger('market_temp')
KST = timezone(timedelta(hours=9))

DAILY_HISTORY_MAX = 65          # GAS MT_DAILY_HISTORY_MAX - 40일 흐름 + 30일 기준선 여유분
SPARKLINE_DAYS = 40

REFRESH_INTERVAL_SEC = 180      # 3분. GAS 캐시 TTL은 30분이었지만 방문자가 기다리지
                                # 않으므로 더 자주 갱신해도 체감 비용이 없다.

# 마지막 계산 결과를 디스크에 남긴다. week52_cache.json 등과 같은 관례.
#
# 2026-09-01: 프론트를 GAS에서 이쪽으로 넘기기 전 점검하다 발견한 구멍이다. 결과가
# 메모리에만 있어서 FastAPI가 재시작하면(배포 타이머가 5분마다 새 커밋을 확인하므로
# 배포 때마다) 백그라운드 첫 계산이 끝날 때까지 /market-temp가 503을 냈다. GAS는 그
# 상황에서 직접 계산해 채워줬으니, 그대로 전환하면 배포마다 증시온도가 잠깐 깨진다.
# 요청 경로에서 계산하지 않는다는 원칙(504 사고로 얻은 것)은 그대로 두고, 재시작이
# 값을 잃지 않게만 만든다 - 몇 분 지난 값이라도 빈 화면보다 낫다.
CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'market_temp_cache.json')

_state = {'result': None, 'computed_at': 0.0, 'error': None}
_lock = threading.Lock()
_started = False


def _save_cache(result, computed_at):
    try:
        tmp = CACHE_FILE + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as handle:
            json.dump({'result': result, 'computed_at': computed_at}, handle,
                      ensure_ascii=False)
        os.replace(tmp, CACHE_FILE)      # 원자적 교체 - 읽는 쪽이 반쪽 파일을 보지 않게
    except Exception:
        LOGGER.debug('market temp 캐시 저장 실패 - 메모리 값은 그대로 쓴다', exc_info=True)


def load_cache():
    """기동 시 마지막 결과를 메모리로 올린다. 없거나 깨졌으면 조용히 넘어간다."""
    try:
        with open(CACHE_FILE, 'r', encoding='utf-8') as handle:
            saved = json.load(handle)
    except FileNotFoundError:
        return None
    except Exception:
        LOGGER.warning('market temp 캐시를 읽지 못했다 - 첫 계산까지 503', exc_info=True)
        return None
    result = saved.get('result')
    if not result:
        return None
    with _lock:
        if _state['result'] is None:     # 이미 새로 계산됐으면 덮지 않는다
            _state['result'] = result
            _state['computed_at'] = saved.get('computed_at') or 0.0
    LOGGER.info('market temp 캐시 복원(계산시각 %s)', result.get('updatedAt'))
    return result


# ---- 일별 온도 이력(SQLite) ----

def ensure_schema(conn):
    """일별 온도 이력 테이블. **운영 DB 안에** 만든다 - DB 파일을 새로 늘리지 않는다.

    2026-08-31 유지보수 점검에서 이미 SQLite가 5개인데 2개만 관리되고 있던 걸 고쳤다.
    여기서 6번째 파일을 만들면 보존 정리·백업·WAL 체크포인트 대상을 또 늘려야 하고,
    다음 사람이 같은 함정에 빠진다. 기존 운영 DB에 테이블 하나만 추가한다.
    """
    conn.execute('CREATE TABLE IF NOT EXISTS market_temp_daily ('
                 ' date TEXT PRIMARY KEY, temp REAL NOT NULL)')
    conn.commit()


def read_daily_history(conn):
    rows = conn.execute(
        'SELECT date, temp FROM market_temp_daily ORDER BY date DESC LIMIT ?',
        (DAILY_HISTORY_MAX,)).fetchall()
    return [{'date': r[0], 'temp': r[1]} for r in reversed(rows)]


def upsert_daily_temp(conn, temp, today):
    """오늘 온도를 기록하고 갱신된 이력을 돌려준다(GAS upsertDailyMarketTemp_와 동일)."""
    ensure_schema(conn)
    if temp is None:
        return read_daily_history(conn)
    conn.execute('INSERT INTO market_temp_daily(date, temp) VALUES (?, ?) '
                 'ON CONFLICT(date) DO UPDATE SET temp=excluded.temp', (today, temp))
    conn.execute('DELETE FROM market_temp_daily WHERE date NOT IN '
                 '(SELECT date FROM market_temp_daily ORDER BY date DESC LIMIT ?)',
                 (DAILY_HISTORY_MAX,))
    conn.commit()
    return read_daily_history(conn)


def grade_for_temp(temp):
    """GAS gradeForTemp_ 그대로."""
    if temp < 10:
        return {'emoji': '🧊', 'label': '극도의 공포', 'tone': 'extreme-fear'}
    if temp < 20:
        return {'emoji': '🔵', 'label': '공포', 'tone': 'fear'}
    if temp < 28:
        return {'emoji': '🟡', 'label': '중립', 'tone': 'neutral'}
    if temp < 35:
        return {'emoji': '🟠', 'label': '낙관', 'tone': 'greed'}
    return {'emoji': '🔥', 'label': '과열', 'tone': 'extreme-greed'}


def compute_history(current_temp, stored_history, today):
    """전일 대비 / 1주 / 1개월 평균(GAS computeMarketTempHistory_ 그대로)."""
    prior = [h for h in stored_history if h['date'] != today]
    if not prior:
        return None
    yesterday = prior[-1]
    week = prior[-7:]
    month = prior[-30:]

    def avg(items):
        return sum(i['temp'] for i in items) / len(items)

    return {
        'dayChange': score._round_half_up(current_temp - yesterday['temp'], 1),
        'yesterday': yesterday['temp'],
        'weekAvg': score._round_half_up(avg(week), 1),
        'weekDays': len(week),
        'monthAvg': score._round_half_up(avg(month), 1),
        'monthDays': len(month),
    }


def compute_sparkline(current_temp, stored_history, today):
    prior = [h for h in stored_history if h['date'] != today][-SPARKLINE_DAYS:]
    return prior + [{'date': today, 'temp': current_temp}]


# ---- 조립 ----

def build(conn, week52_cache_file, kofia, now_kst=None):
    """증시온도 한 판을 계산한다. GAS getMarketTemp()와 같은 형태를 돌려준다.

    conn: 운영 SQLite(daily_prices/future_prices) 연결.
    kofia: `public_data.fetch_kofia_market()` 결과 또는 None - GAS는 이걸 VM에 HTTP로
           물어봤지만(브라우저→GAS→VM) 여기선 호출부가 직접 넘긴다.
    수급은 `investor_trend_daily`(시장 전체)에서 conn으로 직접 읽는다.
    """
    now_kst = now_kst or datetime.now(KST)
    today = now_kst.strftime('%Y-%m-%d')

    universe = data.universe_with_sectors()
    codes = [u['code'] for u in universe]
    quotes = data.fetch_quotes(codes)
    prior_values = data.prior_trading_values(conn, codes, today)

    quote_parts = data.build_quote_components(quotes, universe, prior_values)
    market_parts = data.market_components_from_db(conn, now_kst)
    week52 = data.week52_component(week52_cache_file)
    credit = score.score_kofia_credit(kofia)
    flow, _ratios = data.flow_component_from_market_trend(conn)

    components = {
        'vix': market_parts['vix'],
        'flow': flow,
        'tradingValue': quote_parts['tradingValue'],
        'avgChange': quote_parts['avgChange'],
        'riseRatio': quote_parts['riseRatio'],
        'sectorStrength': quote_parts['sectorStrength'],
        'week52': week52,
        'exchange': market_parts['exchange'],
        'usFutures': market_parts['usFutures'],
        'creditRisk': credit,
    }

    credit_available = bool(credit.get('available'))
    totals = score.total_and_temperature(
        [c['score'] for k, c in components.items()
         if not (k == 'creditRisk' and not credit_available)],
        credit_available)

    history_rows = upsert_daily_temp(conn, totals['temp'], today)
    # 테마별 자금 흐름은 위에서 이미 받아둔 시세·유니버스만 쓴다 - 외부 호출이 늘지 않는다.
    industry_flow = data.build_industry_flow(quotes, universe)
    return {
        'score': totals['score'],
        'maxScore': totals['maxScore'],
        'temp': totals['temp'],
        'grade': grade_for_temp(totals['temp']),
        'components': components,
        'kofia': kofia,
        'history': compute_history(totals['temp'], history_rows, today),
        'recentDays': compute_sparkline(totals['temp'], history_rows, today),
        'updatedAt': now_kst.strftime('%Y-%m-%d %H:%M:%S'),
        'quoteCount': len(quotes),
        'industryFlow': industry_flow,
    }


# ---- 백그라운드 계산 ----

def get_cached():
    with _lock:
        return dict(_state)


def refresh_once(conn_factory, week52_cache_file, kofia_factory):
    try:
        conn = conn_factory()
        try:
            kofia = None
            try:
                kofia = kofia_factory()
            except Exception:
                LOGGER.debug('kofia fetch failed - creditRisk 없이 계산', exc_info=True)
            result = build(conn, week52_cache_file, kofia)
        finally:
            conn.close()
        computed_at = time.time()
        with _lock:
            _state['result'] = result
            _state['computed_at'] = computed_at
            _state['error'] = None
        _save_cache(result, computed_at)
        return result
    except Exception as exc:
        LOGGER.exception('market temp refresh failed')
        with _lock:
            _state['error'] = str(exc)
        return None


def start_background(conn_factory, week52_cache_file, kofia_factory,
                     interval=REFRESH_INTERVAL_SEC):
    """주기 계산 스레드. 다른 폴러(foreign_futures 등)와 같은 패턴이다.

    방문자 요청이 계산을 유발하지 않으므로 캐시 워머가 필요 없다.
    """
    global _started
    if _started:
        return
    _started = True

    load_cache()        # 첫 계산이 끝나기 전까지 지난 값으로 버틴다

    def loop():
        while True:
            refresh_once(conn_factory, week52_cache_file, kofia_factory)
            time.sleep(interval)

    threading.Thread(target=loop, name='market-temp', daemon=True).start()
    LOGGER.info('market-temp 백그라운드 계산 시작(%d초 주기)', interval)
