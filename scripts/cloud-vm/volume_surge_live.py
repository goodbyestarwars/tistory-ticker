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

2026-10-15 같은 검색기에 두 패턴을 함께 싣는다(volume_accumulation.py): ① 실시간 매집 의심(RVOL·거래대금·종가 위치·5분봉 가격 방어, 분배 신호 감점)은
위 30초 표본으로 5분봉을 만들어 판정하고, ② 기존 매집봉 재상승은 일봉(daily_prices) 기반 일봉 스캔 결과(accumulationBar)를 장중 현재가·거래량으로 갱신한다.
한 종목이 여러 신호를 가지면 한 행에 신호를 함께 담는다. 장 밖에는 일봉 기반 신호와 마지막 장중 판정만 남는다.
"""

import json
import logging
import os
import sqlite3
import threading
import time
from collections import deque
from datetime import datetime, timedelta, timezone

import volume_accumulation as va
import volume_surge_history

logger = logging.getLogger('volume_surge_live')

KST = timezone(timedelta(hours=9))

POLL_SEC = 30                  # 장중 순위 조회 주기
IDLE_CHECK_SEC = 60            # 장 밖에서 확인하는 주기
WINDOW_SEC = 180               # 속도를 재는 창(3분)
WINDOW_MIN_SEC = 120           # 창 기준 표본이 이보다 최근이면 속도를 말하지 않는다
WINDOW_MAX_SEC = 300           # 이보다 오래된 표본은 기준으로 쓰지 않는다
SAMPLE_KEEP_SEC = 75 * 60        # 5분봉(가격 방어 판정)을 만들 수 있도록 길게 보관 - 종목당 최대 150표본

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
_accum = {}          # code -> {'name','price','change','firstAt','lastAt','realtime': 신호|없음, 'old': 신호|없음, 'meta': 일봉 행}
_stats_cache = {}    # (date, code) -> (20일 평균 거래량, 20일 평균 거래대금) | None
_bars_cache = {}     # (date, code) -> 최근 일봉(오늘 제외) | []
QUOTE_SUPPLEMENT_MAX = 120   # 순위권 밖 매집봉 후보 시세 보강 상한(배치 2요청 이하)
_acc_loader = None   # 일봉 스캔의 accumulationBar 행 목록을 돌려주는 함수(main이 주입 - 큰 캐시 파일을 두 번 읽지 않기 위해)


def set_daily_loader(fn):
    global _acc_loader
    _acc_loader = fn


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


def _avg_stats(conn, date_str, code):
    """(20일 평균 거래량, 20일 평균 거래대금) - 오늘 제외 최근 20거래일. 15일 미만이면 None(판정 보류)."""
    key = (date_str, code)
    if key in _stats_cache:
        return _stats_cache[key]
    rows = conn.execute('SELECT volume, close FROM daily_prices WHERE code=? AND date<? AND volume>0 ORDER BY date DESC LIMIT 20', (code, date_str)).fetchall()
    value = None
    if len(rows) >= 15:
        value = (sum(r[0] for r in rows) / len(rows), sum(r[0] * (r[1] or 0) for r in rows) / len(rows))
    _stats_cache[key] = value
    return value


def _recent_bars(conn, date_str, code):
    key = (date_str, code)
    if key not in _bars_cache:
        rows = conn.execute('SELECT date, open, high, low, close, volume FROM daily_prices WHERE code=? AND date<? ORDER BY date DESC LIMIT 60', (code, date_str)).fetchall()
        _bars_cache[key] = [{'date': r[0], 'open': r[1], 'high': r[2], 'low': r[3], 'close': r[4], 'volume': r[5]} for r in reversed(rows)]
    return _bars_cache[key]


def _reset_for_day(date_str):
    with _lock:
        if _state['date'] == date_str:
            return
        _state.update({'date': date_str, 'detections': {}, 'updatedAt': None, 'error': None, 'polls': 0})
    _samples.clear()
    _prev_cache.clear()
    _accum.clear()
    _stats_cache.clear()
    _bars_cache.clear()


def process_rows(rows, now_t, date_str, prev_lookup, etf_codes=(), stats_lookup=None, bars_lookup=None, now_kst=None, quote_fetcher=None):
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
            'peakPace3': pace[0], 'prevVolume': prev[0], 'detectVolume': vol_now,
            'detectValueRaw': _num(str(row.get('_history_cum_value_raw')).replace(',', '')),
        }
        with _lock:
            _state['detections'][code] = det
        logger.info('거래량 사전포착 %s %s 3분속도 %.1f%% 누적 %.0f%% 등락 %+.2f%%',
                    code, det['name'], pace[0] * 100, pace[1] * 100, change)
    if stats_lookup is not None and now_kst is not None:
        _evaluate_accumulation(latest, now_t, now_kst, stats_lookup, bars_lookup, quote_fetcher)


def _evaluate_accumulation(latest, now_t, now_kst, stats_lookup, bars_lookup, quote_fetcher=None):
    """① 실시간 매집 의심(30초 표본 → 5분봉)과 ② 기존 매집봉 재상승(일봉 + 장중 현재가·거래량)을 갱신한다."""
    for code, row in latest.items():
        dq = _samples.get(code)
        if not dq or dq[-1][0] != now_t:
            continue
        stats = stats_lookup(code)
        if not stats:
            continue
        price, vol = dq[-1][2], dq[-1][1]
        sig = va.realtime_signal(list(dq), now_t, now_kst, price, _num(row.get('change_rate')), vol, _num(row.get('trade_amount')), stats[0], stats[1])
        with _lock:
            entry = _accum.get(code)
            if sig:
                entry = _accum.setdefault(code, {'firstAt': now_t})
                if 'realtime' not in entry:
                    entry['firstRealtimeAt'], entry['firstPrice'], entry['firstVolume'] = now_t, price, vol
                    entry['firstValueRaw'] = _num(str(row.get('_history_cum_value_raw')).replace(',', ''))
                entry.update({'name': row.get('name') or code, 'price': price, 'change': _num(row.get('change_rate')), 'lastAt': now_t, 'realtime': sig})
            elif entry is not None:
                entry.pop('realtime', None)
    if bars_lookup is None or _acc_loader is None:
        return
    try:
        daily_items = _acc_loader() or []
    except Exception:
        logger.exception('기존 매집봉 목록 읽기 실패')
        return
    elapsed = va.elapsed_minutes(now_kst)
    # 순위권 밖 매집봉 후보는 기존 시세 캐시·배치 조회(domestic_quotes, 60종목/요청·5초 캐시)로 한 번에 갱신한다 - 종목별 REST 호출 없음.
    extra = {}
    if quote_fetcher is not None:
        need = []
        for item in daily_items:
            code = item.get('code')
            dq = _samples.get(code)
            if code and not (code in latest and dq and dq[-1][0] == now_t) and code not in need:
                need.append(code)
        if need:
            try:
                for q in quote_fetcher(need[:QUOTE_SUPPLEMENT_MAX]) or []:
                    extra[q.get('code')] = q
            except Exception as exc:
                logger.info('매집봉 후보 시세 보강 실패(일봉 기준 유지): %s', exc)
    for item in daily_items:
        code = item.get('code')
        bars = bars_lookup(code) if code else None
        if not bars:
            continue
        row = latest.get(code)
        dq = _samples.get(code)
        live_price = live_rvol = live_change = None
        if row is not None and dq and dq[-1][0] == now_t:
            live_price = dq[-1][2]
            live_change = _num(row.get('change_rate'))
            post_avg = va.old_bar_post_avg(bars)
            live_rvol = va.rvol_time_proportional(dq[-1][1], post_avg, elapsed) if post_avg else None
        elif code in extra and _num(extra[code].get('price')):
            live_price = _num(extra[code].get('price'))
            live_change = _num(extra[code].get('changeRate'))
            post_avg = va.old_bar_post_avg(bars)
            live_rvol = va.rvol_time_proportional(_num(extra[code].get('volume')), post_avg, elapsed) if post_avg else None
        sig = va.old_bar_signal(bars, live_price, live_rvol)
        with _lock:
            entry = _accum.setdefault(code, {'firstAt': now_t})
            entry['meta'] = {'name': item.get('name') or code, 'price': item.get('price'), 'changeRate': item.get('changeRate'), 'date': item.get('date'),
                             'miniChart': item.get('miniChart') or []}
            if live_price is not None:
                entry.update({'price': live_price, 'change': live_change, 'lastAt': now_t})
            if sig:
                entry['old'] = sig
            else:
                entry.pop('old', None)


def _save():
    with _lock:
        payload = {'date': _state['date'], 'detections': dict(_state['detections']), 'accum': json.loads(json.dumps(_accum, default=str))}
    try:
        tmp = STATE_FILE + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp, STATE_FILE)
    except OSError as exc:
        logger.info('감지 기록 저장 실패: %s', exc)


def _record_signal_history(rows, now_t, date_str):
    """Record first visible intraday signals; never infer unverified metrics."""
    with _lock:
        detections = list(_state['detections'].values())
        accum = {code: dict(entry) for code, entry in _accum.items() if entry.get('realtime')}
    events = []
    for signal_type, observations in (
        ('EARLY_PACE', ((d['code'], d['detectedAt'], d['detectPrice'], d.get('detectVolume'), d.get('detectValueRaw')) for d in detections)),
        (va.TYPE_REALTIME, ((code, entry['firstRealtimeAt'], entry['firstPrice'], entry.get('firstVolume'), entry.get('firstValueRaw'))
                            for code, entry in accum.items() if entry.get('firstRealtimeAt'))),
    ):
        for code, detected_at, price, volume, value_raw in observations:
            # The ranking response has no trustworthy exchange as-of time. Its
            # normalized trade_amount can also be a price*volume fallback.
            events.append({
                'trading_date': date_str, 'code': code, 'signal_type': signal_type,
                'detected_at': volume_surge_history.iso(detected_at),
                'usable_at': volume_surge_history.iso(now_t),
                'detected_price': price,
                'cumulative_volume': volume,
                'cumulative_value_raw': value_raw,
                'value_field': 'acml_tr_pbmn' if value_raw is not None else None,
                'value_unit': None,
                'vwap_relative_pct': None, 'index_relative_pct': None,
                'rejection_reason': None, 'source': 'KIS domestic ranking poll',
                'source_as_of': None,
            })
    try:
        volume_surge_history.record(events)
    except (OSError, ValueError, sqlite3.Error):
        logger.exception('장중 신호 이력 저장 실패')


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
        if _state['date'] == date_str and not _accum:
            _accum.update(data.get('accum') or {})


def _early_signal(det, item):
    return {'type': 'EARLY_PACE', 'label': '거래량 초기 급증', 'status': 'confirmed', 'score': item['score'], 'volumeMultiple': None,
            'paceOfPrevVolumePct': round(det['peakPace3'] * 100, 1), 'distribution': {'risk': 'LOW', 'flags': []}, 'reasons': item['reasons'][:3]}


def _merge_accumulation(early_items, now_t):
    """기존 '초기 급증' 감지 행과 ①·② 신호를 종목별 한 행으로 합친다(중복 표시 없음). 정렬: 두 매집 신호 동시 > 매집봉 재돌파 > 초기 급증 > 나머지."""
    by_code = {}
    for status, det, item in early_items:
        by_code[det['code']] = {'early': (status, det, item)}
    with _lock:
        accum = {c: dict(v) for c, v in _accum.items()}
    for code, entry in accum.items():
        if entry.get('realtime') or entry.get('old'):
            by_code.setdefault(code, {}).update({'accum': entry})
    rows = []
    for code, parts in by_code.items():
        signals, extra, status = [], {}, 'watch'
        base = None
        if 'early' in parts:
            st, det, item = parts['early']
            signals.append(_early_signal(det, item))
            extra = {k: v for k, v in item['patternDetail'].items() if k not in ('score', 'live', 'status', 'signals', 'distribution', 'volumeMultiple')}
            base = item
            status = st
        entry = parts.get('accum') or {}
        if entry.get('realtime'):
            signals.append(entry['realtime'])
        if entry.get('old'):
            signals.append(entry['old'])
        meta = entry.get('meta') or {}
        name = (base or {}).get('name') or entry.get('name') or meta.get('name') or code
        # 가격 기준: 장중 감지(초기 급증·실시간 매집)는 감지가, 일봉 매집봉만 있으면 일봉 스캔가(현재가는 화면이 실시간으로 따로 덮는다).
        if base:
            price, change, day, basis = base.get('price'), base.get('changeRate'), base.get('date'), 'DETECT'
        elif entry.get('realtime') and entry.get('firstPrice') is not None:
            price, change, basis = entry['firstPrice'], entry.get('change'), 'DETECT'
            day = datetime.fromtimestamp(entry.get('firstRealtimeAt') or now_t, KST).strftime('%Y-%m-%d')
        else:
            price, change, day, basis = meta.get('price'), meta.get('changeRate'), meta.get('date') or _state.get('date'), 'SCAN'
        row = va.combined_item(code, name, price, change, day, signals, status=status, extra_detail=extra, price_basis=basis)
        if base:
            row['miniChart'] = base.get('miniChart') or []
        elif meta.get('miniChart'):
            row['miniChart'] = meta['miniChart']
        rows.append(row)

    def rank(row):
        kinds = {s['type'] for s in row['patternDetail']['signals']}
        both = va.TYPE_REALTIME in kinds and va.TYPE_OLD_BAR in kinds
        rebreak = any(s.get('stage') == 'REBREAK' for s in row['patternDetail']['signals'])
        return (-int(both), -int(rebreak), 0 if 'EARLY_PACE' in kinds else 1, -(row.get('score') or 0))
    rows.sort(key=rank)
    return rows


def _data_basis(now_t):
    """장중/장마감에 쓸 수 있는 데이터 구분(화면 안내용)."""
    live = in_poll_window(datetime.fromtimestamp(now_t, KST))
    return {'realtime': live, 'realtimeNote': '장중 30초 순위 표본으로 만든 5분봉·RVOL(장 마감 뒤에는 마지막 장중 판정만 남음)' if live else '장 마감: 일봉 기반 매집봉 추적과 마지막 장중 판정만 표시',
            'dailyNote': '기존 매집봉 재상승은 일봉(확정 종가) 기준이며 장중에는 현재가·거래량으로 갱신'}


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
    merged = _merge_accumulation([(it[0], it[1], it[2]) for it in items], now_t)
    return {
        'active': in_poll_window(datetime.fromtimestamp(now_t, KST)),
        'date': day,
        'updatedAt': datetime.fromtimestamp(updated, timezone.utc).isoformat() if updated else None,
        'intervalSec': POLL_SEC,
        'items': merged[:MAX_ITEMS],
        'dataBasis': _data_basis(now_t),
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
            # Preserve the original field separately from market_board's
            # price*volume fallback; the KIS unit remains unverified.
            item['_history_cum_value_raw'] = raw.get('acml_tr_pbmn')
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
        import domestic_quotes
        process_rows(rows, now_kst.timestamp(), date_str, lambda code: _prev_volume(conn, date_str, code), quote_fetcher=domestic_quotes.fetch_quotes,
                     stats_lookup=lambda code: _avg_stats(conn, date_str, code), bars_lookup=lambda code: _recent_bars(conn, date_str, code), now_kst=now_kst)
        _record_signal_history(rows, now_kst.timestamp(), date_str)
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
