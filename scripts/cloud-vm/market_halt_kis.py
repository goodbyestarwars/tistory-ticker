"""시장 전체 사이드카·서킷브레이커·시장 임시정지 - KIS 실시간 장운영정보(H0STMKO0) 수신 (2026-10-15).

KRX 공시(KIND)는 운영 VM(GCP) IP를 403으로 막아서(docs/MARKET_HALT_KIND.md) 기존 KIS 인증·공유 WebSocket 허브(kis_ws_hub.py)에
구독만 얹는다. 새 세션·새 앱키를 열지 않으므로 시세·자동매매 연결에 영향이 없다(등록 2건 추가).

- 구독: 코스피 대표(005930), 코스닥 대표(247540) 각 1건. 시장 구분은 어느 키로 받았는지로 정한다(프레임 EXCH_CLS_CODE는 거래소 구분이라 시장 구분에 쓰지 않는다).
- 장운영구분코드(mkop_cls_code) 해석은 사용자가 제공한 KIS 코드표를 쓴다: 서킷브레이커 174·175·182·184·185 / 매도 사이드카 387 발동·388 해제 /
  매수 사이드카 397 발동·398 해제 / 시장 임시정지 164. **실제 수신으로 확인되기 전까지는 미검증**이며, 서킷브레이커 코드별 단계(1~3)는 확인하지 못해 단계를 추정하지 않는다.
  코드표에 없는 값은 이벤트로 만들지 않고 최근 수신 기록(raw)에만 남긴다 - 화면 근거와 검증 근거를 분리한다.
- 모든 프레임은 최근 수신 기록과 코드별 카운트에 남겨 `/api/circuit-breaker.market_halt.kis`로 확인할 수 있다.
- 이벤트는 당일 JSON 파일에 저장해 재시작해도 이력이 남는다. 재연결 뒤 첫 프레임이 오기 전에는 '수신 중'으로 보지 않는다(구독 등록 확인 기준).
"""
import asyncio
import json
import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone

import circuit_breaker
import kis_ws_hub

logger = logging.getLogger('market_halt_kis')

KST = timezone(timedelta(hours=9))
TR_ID = 'H0STMKO0'
SOURCE = 'KIS 실시간 장운영정보'
KEYS = (('KOSPI', '005930'), ('KOSDAQ', '247540'))
FIELDS = ('mksc_shrn_iscd', 'trht_yn', 'tr_susp_reas_cntt', 'mkop_cls_code', 'antc_mkop_cls_code', 'mrkt_trtm_cls_code',
          'divi_app_cls_code', 'iscd_stat_cls_code', 'vi_cls_code', 'ovtm_vi_cls_code', 'EXCH_CLS_CODE')
CB_CODES = ('174', '175', '182', '184', '185')
CODE_ACTIONS = {                       # 코드 -> (kind, direction, status)
    '387': ('SIDECAR', 'SELL', 'active'), '388': ('SIDECAR', 'SELL', 'released'),
    '397': ('SIDECAR', 'BUY', 'active'), '398': ('SIDECAR', 'BUY', 'released'),
}
HALT_CODE = '164'
RAW_KEEP = 60
TICK_SEC = 15
STORE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'market_halt_kis_events.json')

_lock = threading.Lock()
_state = {'events': [], 'raw': [], 'codes': {}, 'frames': 0, 'lastFrameAt': None, 'subscribedAt': None, 'error': None, 'date': None}
_thread = None


def parse_frame(raw):
    """'0|H0STMKO0|001|v^v^...' -> dict. 형식이 다르면 None."""
    if not isinstance(raw, str):
        return None
    parts = raw.split('|', 3)
    if len(parts) < 4 or parts[0] != '0' or parts[1] != TR_ID:
        return None
    values = parts[3].split('^')
    if len(values) < 4:
        return None
    return dict(zip(FIELDS, values))


def _market_of(code):
    for market, key in KEYS:
        if key == code:
            return market
    return None


def classify(code):
    """장운영구분코드 -> (kind, direction, status) 또는 None. 서킷브레이커는 상태 구분 없이 ('CB',)로 본다."""
    code = str(code or '').strip()
    if code in CODE_ACTIONS:
        return CODE_ACTIONS[code]
    if code in CB_CODES:
        return ('CIRCUIT_BREAKER', None, 'active')
    if code == HALT_CODE:
        return ('MARKET_HALT', None, 'active')
    return None


def apply_frame(row, now_kst, market):
    """한 프레임을 반영한다. 이벤트가 만들어지거나 갱신되면 True. 호출 측이 락을 잡는다."""
    code = str(row.get('mkop_cls_code') or '').strip()
    action = classify(code)
    at = now_kst.isoformat(timespec='seconds')
    events = _state['events']
    if action is None:
        return False
    kind, direction, status = action
    if status == 'released':
        for ev in reversed(events):
            if ev['market'] == market and ev['kind'] == kind and ev.get('direction') == direction and ev['status'] == 'active':
                ev['status'] = 'released'
                ev['released_at'] = at
                ev['release_code'] = code
                return True
        # 발동을 못 받은 채 해제만 온 경우(재시작 등) - 해제 시각만 이력에 남긴다.
        events.append({'id': 'KIS-%s-%s-%s-%s' % (market, kind, direction, at), 'market': market, 'kind': kind, 'direction': direction,
                       'stage': None, 'status': 'released', 'triggered_at': at, 'released_at': at, 'code': code, 'release_code': code,
                       'trigger_missed': True})
        return True
    for ev in events:                   # 같은 코드가 반복 수신돼도 한 건
        if ev['market'] == market and ev['kind'] == kind and ev.get('code') == code and ev['status'] == 'active':
            return False
    events.append({'id': 'KIS-%s-%s-%s-%s' % (market, kind, code, at), 'market': market, 'kind': kind, 'direction': direction, 'stage': None,
                   'status': 'active', 'triggered_at': at, 'released_at': None, 'code': code})
    return True


def handle_raw(raw, now_kst=None):
    row = parse_frame(raw)
    if row is None:
        return None
    now_kst = now_kst or datetime.now(KST)
    market = _market_of(row.get('mksc_shrn_iscd'))
    code = str(row.get('mkop_cls_code') or '').strip()
    with _lock:
        _roll_day(now_kst)
        _state['frames'] += 1
        _state['lastFrameAt'] = now_kst.isoformat(timespec='seconds')
        slot = '%s:%s' % (market or row.get('mksc_shrn_iscd'), code)
        _state['codes'][slot] = _state['codes'].get(slot, 0) + 1
        _state['raw'].append(dict(row, at=_state['lastFrameAt'], market=market))
        del _state['raw'][:-RAW_KEEP]
        changed = apply_frame(row, now_kst, market) if market else False
        if changed:
            _save()
    if changed:
        logger.warning('KIS 장운영정보 이벤트: market=%s mkop_cls_code=%s', market, code)
    return row


def _roll_day(now_kst):
    today = now_kst.strftime('%Y-%m-%d')
    if _state['date'] != today:
        _state.update({'date': today, 'events': [], 'raw': [], 'codes': {}})


def _save():
    try:
        with open(STORE, 'w', encoding='utf-8') as f:
            json.dump({'date': _state['date'], 'events': _state['events']}, f, ensure_ascii=False)
    except OSError:
        logger.exception('시장조치 이력 저장 실패')


def _load(now_kst):
    try:
        with open(STORE, encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return
    if data.get('date') == now_kst.strftime('%Y-%m-%d') and isinstance(data.get('events'), list):
        with _lock:
            _state.update({'date': data['date'], 'events': data['events']})


def snapshot(now_kst=None):
    """화면·검증용: 수신 이벤트와 최근 수신 기록."""
    with _lock:
        return {'frames': _state['frames'], 'lastFrameAt': _state['lastFrameAt'], 'subscribedAt': _state['subscribedAt'],
                'error': _state['error'], 'codes': dict(_state['codes']), 'raw': list(_state['raw'][-20:]),
                'events': [dict(e) for e in _state['events']]}


def _to_halt_events(events):
    """circuit_breaker.normalize_halt_event 입력 형식으로 바꾼다(코스피/코스닥 사이드카·서킷브레이커만; 시장 임시정지는 별도 이력)."""
    out = []
    for ev in events:
        if ev['kind'] not in ('SIDECAR', 'CIRCUIT_BREAKER'):
            continue
        out.append(dict(ev))
    return out


async def _run_once(appkey, appsecret):
    hub = kis_ws_hub.start(appkey, appsecret)
    if hub is None:
        raise RuntimeError('KIS 공유 WebSocket 허브를 시작하지 못함')
    keys = [(TR_ID, key, kis_ws_hub.PRIORITY_FUTURES) for _m, key in KEYS]
    subscription = hub.subscribe(keys)
    logger.info('KIS 장운영정보 구독: %s', [k[1] for k in keys])
    last_tick = 0.0
    try:
        while True:
            try:
                raw = await asyncio.wait_for(subscription.queue.get(), timeout=TICK_SEC)
            except asyncio.TimeoutError:
                raw = None
            if raw:
                handle_raw(raw)
            if time.time() - last_tick >= TICK_SEC:
                last_tick = time.time()
                _publish(hub)
    finally:
        subscription.close()


def _publish(hub):
    """구독 등록이 확인된 동안만 '수신 중'으로 화면에 넘긴다(프레임이 없는 것은 이벤트 없음이지 오류가 아니다)."""
    now = datetime.now(KST)
    registered = hub.registered_keys()
    ok = all((TR_ID, key) in registered for _m, key in KEYS)
    with _lock:
        _roll_day(now)
        if ok and _state['subscribedAt'] is None:
            _state['subscribedAt'] = now.isoformat(timespec='seconds')
        if not ok:
            _state['subscribedAt'] = None
        _state['error'] = None if ok else 'KIS 장운영정보 구독이 등록되지 않음'
        events = _to_halt_events(_state['events'])
    if ok:
        circuit_breaker.ingest_market_halt(events, SOURCE, now, refresh_sec=None)
    else:
        circuit_breaker.set_halt_error('KIS 장운영정보 구독이 등록되지 않음')


async def _reconnect_loop(appkey, appsecret):
    while True:
        try:
            await _run_once(appkey, appsecret)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception('KIS 장운영정보 수신 오류, 5초 뒤 재시도')
            circuit_breaker.set_halt_error('KIS 장운영정보 수신 오류')
            await asyncio.sleep(5)


def start_background(appkey, appsecret):
    global _thread
    if not appkey or not appsecret:
        return None
    if _thread is not None and _thread.is_alive():
        return _thread
    _load(datetime.now(KST))
    circuit_breaker.declare_halt_source(SOURCE, None, None)
    _thread = threading.Thread(target=lambda: asyncio.run(_reconnect_loop(appkey, appsecret)), name='market-halt-kis', daemon=True)
    _thread.start()
    return _thread
