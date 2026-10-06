# -*- coding: utf-8 -*-
"""거래량 돌파 사전포착(장중 연속 감시).

2026-10-06 사용자 지적("스캔 시점에는 스캐너가 의미가 없어. 우리 검색기는 사전포착이야. 과거 브리핑이
아니라고"). 이전 거래량 돌파 탭은 09:05에 한 번 찍은 스냅샷(volume_breakout_scan.py)이라, 감지 시점에
이미 +8~12% 오른 종목을 하루 종일 보여 줬다. 이 모듈은 장중 30초마다 거래량 순위를 읽어, 종목별로
"최근 3분 동안 늘어난 거래량이 전일 거래량의 몇 %인지"(속도)를 계산하고, 거래가 붙기 시작했는데 아직
많이 오르지 않은 초기 구간에서 잡아 감지 시각·감지가를 기록한다. 감지 후 많이 오른 종목은 목록에서 뺀다.

설계 제약:
- VM은 e2-micro(1GB)라 별도 프로세스 없이 FastAPI 안의 스레드 하나로 돈다(binance_flow.py와 같은 방식).
- KIS 순위 REST만 쓴다(거래량·거래증가율·거래대금·상승률 4건/회, ETF·ETN 제외 마스크). 새 필드는 쓰지 않고
  market_board._kis_domestic_row가 이미 쓰는 누적 거래량(acml_vol)·현재가·등락률만 읽는다.
- 순위 API는 섹션당 최대 30~40개라 거래가 아직 순위권에 못 든 아주 초기 종목은 놓칠 수 있다(전 종목 감시 아님).
- 전일 거래량은 daily_prices의 직전 영업일 값이다(volume_breakout_scan.previous_volume과 같은 기준).
- 감지 기록은 같은 날 재시작에도 이어지도록 작은 JSON 파일에 저장한다.
"""

import json
import logging
import os
import threading
import time
from collections import deque
from datetime import datetime, timedelta, timezone

logger = logging.getLogger('volume_surge_live')

KST = timezone(timedelta(hours=9))

POLL_SEC = 30                  # 장중 순위 조회 주기
IDLE_CHECK_SEC = 60            # 장 밖에서 확인하는 주기
WINDOW_SEC = 180               # 속도를 재는 창(3분)
WINDOW_MIN_SEC = 120           # 창 기준 표본이 이보다 최근이면 속도를 말하지 않는다
WINDOW_MAX_SEC = 300           # 이보다 오래된 표본은 기준으로 쓰지 않는다
SAMPLE_KEEP_SEC = 12 * 60

PACE_MIN = 0.03                # 3분 환산 거래량이 전일 거래량의 3% 이상이면 "붙기 시작"
CUM_MAX = 0.6                  # 오늘 누적이 이미 전일의 60%를 넘었으면 초기가 아니다
DETECT_RISE_MAX = 5.0          # 감지 시점 등락률이 이 값 이하일 때만 "아직 안 오른" 초기로 본다
DETECT_FALL_MIN = -2.0         # 빠지는 종목은 잡지 않는다
NOT_FALLING_PCT = -0.5         # 창 기준 가격 대비 이 이상 밀렸으면 잡지 않는다
MIN_PREV_VOLUME = 30000
MIN_TODAY_VOLUME = 10000
EARLY_GAIN_PCT = 3.0           # 감지가 대비 이 미만이면 "초기", 이상이면 "진행 중"
RAN_GAIN_PCT = 6.0             # 감지가 대비 이 이상 올랐으면 이미 늦은 자리라 목록에서 뺀다
LIFETIME_SEC = 45 * 60         # 감지 후 이 시간이 지나면 내린다
MAX_ITEMS = 30
RANK_LIMIT = 30

STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'volume_surge_live.json')
NOTE = ('거래량이 붙기 시작했는데 아직 많이 오르지 않은 초기 구간에서 감지합니다. '
        '방향(상승·하락)을 보장하지 않고, 순위권 밖의 아주 초기 종목은 놓칠 수 있습니다.')

_lock = threading.Lock()
_samples = {}        # code -> deque[(t, cum_volume, price)]
_prev_cache = {}     # (date, code) -> (volume, date) | None
_state = {
    'date': None,
    'detections': {},   # code -> dict
    'updatedAt': None,
    'error': None,
    'polls': 0,
}
_thread = None


def _num(value):
    try:
        if value in (None, ''):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def in_poll_window(now_kst):
    """평일 정규장(09:00~15:35)에만 돈다. 휴장일은 market_clock이 판정한다."""
    import market_clock
    if not market_clock.is_kr_trading_day(now_kst):
        return False
    minutes = now_kst.hour * 60 + now_kst.minute
    return 9 * 60 <= minutes <= 15 * 60 + 35


def pace_from_samples(samples, now_t, prev_volume):
    """samples: deque[(t, cum_volume, price)], 마지막 값이 지금.

    반환: (pace3, cum_ratio, base_price, span_sec) 또는 None. pace3는 3분으로 환산한
    "늘어난 거래량 / 전일 거래량"이다. 기준 표본은 지금으로부터 WINDOW_SEC에 가장 가까운
    (WINDOW_MIN_SEC~WINDOW_MAX_SEC 사이) 표본이다.
    """
    if not samples or not prev_volume or prev_volume <= 0:
        return None
    t_now, vol_now, _price_now = samples[-1]
    base = None
    for t, vol, price in samples:
        age = now_t - t
        if age < WINDOW_MIN_SEC or age > WINDOW_MAX_SEC:
            continue
        if base is None or abs(age - WINDOW_SEC) < abs((now_t - base[0]) - WINDOW_SEC):
            base = (t, vol, price)
    if base is None:
        return None
    span = t_now - base[0]
    if span <= 0:
        return None
    added = vol_now - base[1]
    if added <= 0:
        return None
    pace3 = (added / prev_volume) * (WINDOW_SEC / span)
    return pace3, vol_now / prev_volume, base[2], span


def qualifies(pace, change_rate, price_now):
    """초기 감지 조건. pace는 pace_from_samples 결과."""
    if pace is None:
        return False
    pace3, cum_ratio, base_price, _span = pace
    if pace3 < PACE_MIN or cum_ratio > CUM_MAX:
        return False
    if change_rate is None or change_rate > DETECT_RISE_MAX or change_rate < DETECT_FALL_MIN:
        return False
    if base_price and price_now and (price_now - base_price) / base_price * 100 < NOT_FALLING_PCT:
        return False
    return True


def gain_pct(detect_price, price_now):
    if not detect_price or not price_now:
        return None
    return (price_now - detect_price) / detect_price * 100


def status_for(gain, age_sec):
    """early(감지가 대비 +3% 미만) / moving(+3~6%) / ran(+6% 이상 - 숨김) / expired(시간 초과 - 숨김)."""
    if age_sec > LIFETIME_SEC:
        return 'expired'
    if gain is not None and gain >= RAN_GAIN_PCT:
        return 'ran'
    if gain is not None and gain >= EARLY_GAIN_PCT:
        return 'moving'
    return 'early'


def _kst_hhmm(ts):
    return datetime.fromtimestamp(ts, KST).strftime('%H:%M')


def build_item(det, price_now, change_now, now_t):
    """js/pattern-scan.js의 공통 행 모양으로 만든다(price=감지가, 화면이 실시간가를 덧입힌다)."""
    gain = gain_pct(det['detectPrice'], price_now)
    age = now_t - det['detectedAt']
    status = status_for(gain, age)
    gain_text = ('%+.1f%%' % gain) if gain is not None else '-'
    pace_pct = det['peakPace3'] * 100
    return status, {
        'code': det['code'],
        'name': det['name'],
        'price': det['detectPrice'],
        'changeRate': det['detectChange'],
        'date': datetime.fromtimestamp(det['detectedAt'], KST).strftime('%Y-%m-%d'),
        'miniChart': [],
        'score': min(100, int(round(det['peakPace3'] / PACE_MIN * 50))),
        'reasons': [
            '감지 %s · 감지가 %s원' % (_kst_hhmm(det['detectedAt']), format(int(det['detectPrice']), ',')),
            '최근 3분 거래량이 전일 거래량의 %.1f%%(3분 환산)' % pace_pct,
            '감지 시점 오늘 누적은 전일의 %.0f%%' % (det['detectCum'] * 100),
            '감지 시점 등락률 %+.2f%%' % det['detectChange'],
        ],
        'interpretation': (
            '%s에 거래량이 붙기 시작한 초기 구간에서 감지했습니다(3분 환산 전일 거래량의 %.1f%%). '
            '감지가 대비 지금 %s입니다. 방향(상승·하락)은 이 조건만으로 판단하지 않습니다.'
            % (_kst_hhmm(det['detectedAt']), pace_pct, gain_text)
        ),
        'patternDetail': {
            'score': min(100, int(round(det['peakPace3'] / PACE_MIN * 50))),
            'live': True,
            'status': status,
            'detectedAt': datetime.fromtimestamp(det['detectedAt'], timezone.utc).isoformat(),
            'detectPrice': det['detectPrice'],
            'currentPrice': price_now,
            'gainSinceDetectPct': round(gain, 2) if gain is not None else None,
            'pace3': round(det['peakPace3'], 4),
            'volumeRatio': round(det['detectCum'], 4),
            'changeRate': det['detectChange'],
            'overheated': False,
            'scanned_at': datetime.fromtimestamp(det['detectedAt'], timezone.utc).isoformat(),
        },
    }


def _prev_volume(conn, date_str, code):
    key = (date_str, code)
    if key in _prev_cache:
        return _prev_cache[key]
    row = conn.execute(
        'SELECT volume, date FROM daily_prices WHERE code=? AND date<? AND volume>0 ORDER BY date DESC LIMIT 1',
        (code, date_str)).fetchone()
    value = (float(row[0]), row[1]) if row else None
    _prev_cache[key] = value
    return value


def _reset_for_day(date_str):
    with _lock:
        if _state['date'] == date_str:
            return
        _state.update({'date': date_str, 'detections': {}, 'updatedAt': None, 'error': None, 'polls': 0})
    _samples.clear()
    _prev_cache.clear()


def process_rows(rows, now_t, date_str, prev_lookup, etf_codes=()):
    """순위 행(공통 모델)을 받아 표본을 쌓고 감지 목록을 갱신한다. prev_lookup(code)->(volume,date)|None."""
    latest = {}
    for row in rows:
        code = (row.get('code') or '').strip()
        if not code or code in etf_codes:
            continue
        latest[code] = row
    for code, row in latest.items():
        vol = _num(row.get('trade_volume'))
        price = _num(row.get('price'))
        if not vol or not price:
            continue
        dq = _samples.setdefault(code, deque())
        dq.append((now_t, vol, price))
        while dq and now_t - dq[0][0] > SAMPLE_KEEP_SEC:
            dq.popleft()
    for code, row in latest.items():
        dq = _samples.get(code)
        if not dq or dq[-1][0] != now_t:
            continue
        vol_now = dq[-1][1]
        price_now = dq[-1][2]
        change = _num(row.get('change_rate'))
        prev = prev_lookup(code)
        if not prev or prev[0] < MIN_PREV_VOLUME or vol_now < MIN_TODAY_VOLUME:
            continue
        pace = pace_from_samples(dq, now_t, prev[0])
        if pace is None:
            continue
        with _lock:
            det = _state['detections'].get(code)
            if det is not None:
                det['peakPace3'] = max(det['peakPace3'], pace[0])
                continue
        if not qualifies(pace, change, price_now):
            continue
        det = {
            'code': code, 'name': row.get('name') or code, 'detectedAt': now_t,
            'detectPrice': price_now, 'detectChange': change, 'detectCum': pace[1],
            'peakPace3': pace[0], 'prevVolume': prev[0],
        }
        with _lock:
            _state['detections'][code] = det
        logger.info('거래량 사전포착 %s %s 3분속도 %.1f%% 누적 %.0f%% 등락 %+.2f%%',
                    code, det['name'], pace[0] * 100, pace[1] * 100, change)


def _save():
    with _lock:
        payload = {'date': _state['date'], 'detections': dict(_state['detections'])}
    try:
        tmp = STATE_FILE + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp, STATE_FILE)
    except OSError as exc:
        logger.info('감지 기록 저장 실패: %s', exc)


def _load(date_str):
    try:
        with open(STATE_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return
    if data.get('date') != date_str:
        return
    with _lock:
        if _state['date'] == date_str and not _state['detections']:
            _state['detections'] = data.get('detections') or {}


def get_payload(now_t=None):
    now_t = now_t or time.time()
    with _lock:
        dets = dict(_state['detections'])
        updated = _state['updatedAt']
        error = _state['error']
        day = _state['date']
    items, ran, expired = [], 0, 0
    for code, det in dets.items():
        dq = _samples.get(code)
        price_now = dq[-1][2] if dq else det['detectPrice']
        status, item = build_item(det, price_now, None, now_t)
        if status == 'ran':
            ran += 1
            continue
        if status == 'expired':
            expired += 1
            continue
        items.append((status, det, item))
    items.sort(key=lambda x: (0 if x[0] == 'early' else 1, -x[1]['peakPace3']))
    return {
        'active': in_poll_window(datetime.fromtimestamp(now_t, KST)),
        'date': day,
        'updatedAt': datetime.fromtimestamp(updated, timezone.utc).isoformat() if updated else None,
        'intervalSec': POLL_SEC,
        'items': [it[2] for it in items[:MAX_ITEMS]],
        'ranCount': ran,
        'expiredCount': expired,
        'error': error,
        'note': NOTE,
        'criteria': {
            'paceMin': PACE_MIN, 'windowSec': WINDOW_SEC, 'detectRiseMaxPct': DETECT_RISE_MAX,
            'ranGainPct': RAN_GAIN_PCT, 'lifetimeMin': LIFETIME_SEC // 60,
        },
    }


def _fetch_rows(appkey, appsecret):
    import kis_client
    import market_board
    token = kis_client.get_token(appkey, appsecret)
    rows = []
    for sort_code in ('0', '1', '3'):
        try:
            rows.extend(kis_client.fetch_domestic_volume_rank(
                token, appkey, appsecret, sort_code=sort_code, limit=RANK_LIMIT, exclude_etf=True))
        except Exception as exc:
            logger.info('거래량 순위 조회 실패(%s): %s', sort_code, exc)
    try:
        rows.extend(kis_client.fetch_domestic_fluctuation_rank(
            token, appkey, appsecret, limit=RANK_LIMIT, sort_code='0', exclude_etf=True))
    except Exception as exc:
        logger.info('상승률 순위 조회 실패: %s', exc)
    out = []
    for raw in rows:
        item = market_board._kis_domestic_row(raw)
        if item:
            out.append(item)
    return out


def refresh_once(appkey, appsecret, now_kst=None, fetcher=None):
    import db_schema
    now_kst = now_kst or datetime.now(KST)
    date_str = now_kst.strftime('%Y-%m-%d')
    _reset_for_day(date_str)
    if _state['polls'] == 0:
        _load(date_str)
    try:
        rows = (fetcher or _fetch_rows)(appkey, appsecret)
    except Exception as exc:
        with _lock:
            _state['error'] = str(exc)[:200]
        logger.info('거래량 사전포착 순위 조회 실패: %s', exc)
        return False
    if not rows:
        with _lock:
            _state['error'] = '순위 응답이 비어 있습니다.'
        return False
    conn = db_schema.get_conn()
    try:
        process_rows(rows, now_kst.timestamp(), date_str, lambda code: _prev_volume(conn, date_str, code))
    finally:
        conn.close()
    with _lock:
        _state['updatedAt'] = now_kst.timestamp()
        _state['error'] = None
        _state['polls'] += 1
    _save()
    return True


def _loop(appkey, appsecret):
    while True:
        now_kst = datetime.now(KST)
        if in_poll_window(now_kst):
            try:
                refresh_once(appkey, appsecret, now_kst)
            except Exception:
                logger.exception('거래량 사전포착 갱신 실패')
            time.sleep(POLL_SEC)
        else:
            time.sleep(IDLE_CHECK_SEC)


def start_background(appkey, appsecret):
    global _thread
    if not appkey or not appsecret:
        logger.warning('KIS_APPKEY/KIS_APPSECRET 미설정 - 거래량 사전포착 건너뜀')
        return None
    with _lock:
        if _thread is not None and _thread.is_alive():
            return _thread
        _thread = threading.Thread(target=_loop, args=(appkey, appsecret), name='volume-surge-live', daemon=True)
        _thread.start()
    return _thread
