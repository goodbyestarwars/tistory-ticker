# -*- coding: utf-8 -*-
"""KIS 실시간 변동성완화장치(H0STVIC0) 수신 - 기존 KIS 공유 WebSocket 허브(kis_ws_hub.py)에 구독만 얹는다. (2026-10-15)

필드는 공식 명세 순서 15개: SOP_DATE, MKSC_SHRN_ISCD, HTS_KOR_ISNM, MRKT_DIV_CLS_CODE, VI_CLS_CODE, VI_CNCL_HOUR, CNTG_VI_HOUR,
VI_KIND_CODE, VI_PRC, VI_STND_PRC, VI_DPRT, VI_DMC_STND_PRC, VI_DMC_DPRT, VI_COUNT, ETP_YN.
종류·상태 코드와 가격·괴리율 단위는 실수신으로 확인되기 전까지 해석하지 않고 원값을 저장한다(vi_store.KIND_LABELS가 비어 있으면 kind=None).

전체 종목 구독은 하지 않는다. 전체 시장 수신이 되는 키가 확인되면 그 키만, 아니면 REST(inquire-vi-status)가 전체 현황의 기본 소스다.
구독 승인/거부 응답은 허브 controlLog에 남고, 이 모듈의 snapshot()으로 /api/circuit-breaker.vi_basis.ws에 노출한다.
"""
import asyncio
import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone

import kis_ws_hub
import vi_store

logger = logging.getLogger('vi_kis')

KST = timezone(timedelta(hours=9))
TR_ID = 'H0STVIC0'
FIELDS = ('sop_date', 'code', 'name', 'market_cls', 'cls_code', 'cancel_hour', 'trigger_hour', 'kind_code', 'price',
          'static_price', 'static_dprt', 'dyn_price', 'dyn_dprt', 'count', 'etp')
# 전체 종목 이벤트를 받는 키가 있는지 실제 승인 응답으로 확인하기 위한 후보(종목별이면 거부되거나 프레임이 오지 않는다). 전체 종목을 무작정 구독하지 않는다.
PROBE_KEYS = tuple(k for k in os.environ.get('VI_WS_KEYS', '000000').split(',') if k.strip())
RAW_KEEP = 40

_lock = threading.Lock()
_state = {'frames': 0, 'lastFrameAt': None, 'raw': [], 'keys': list(PROBE_KEYS), 'subscribedAt': None, 'error': None}
_thread = None


def _hms(date_str, text):
    text = str(text or '').strip()
    if not text.isdigit() or int(text) == 0:
        return None
    try:
        return datetime.strptime((date_str or datetime.now(KST).strftime('%Y%m%d')) + text.zfill(6)[:6], '%Y%m%d%H%M%S').replace(tzinfo=KST)
    except ValueError:
        return None


def _num(value):
    try:
        t = str(value).replace(',', '').strip()
        return float(t) if t else None
    except (TypeError, ValueError):
        return None


def parse_records(raw):
    """'0|H0STVIC0|건수|v^v^...(15개씩 이어짐)' -> 필드 dict 목록. 형식이 다르면 빈 목록."""
    if not isinstance(raw, str):
        return []
    parts = raw.split('|', 3)
    if len(parts) < 4 or parts[0] != '0' or parts[1] != TR_ID:
        return []
    values = parts[3].split('^')
    n = len(FIELDS)
    if len(values) < n:
        return []
    return [dict(zip(FIELDS, values[i:i + n])) for i in range(0, len(values) - n + 1, n)]


def to_store_record(rec):
    date_str = str(rec.get('sop_date') or '').strip() or None
    trig = _hms(date_str, rec.get('trigger_hour'))
    code = str(rec.get('code') or '').strip()
    if not code or trig is None:
        return None
    return {'code': code, 'name': str(rec.get('name') or '').strip() or code, 'triggered_at': trig,
            'released_at': _hms(date_str, rec.get('cancel_hour')),
            'kind_code': str(rec.get('kind_code') or '').strip() or None, 'cls_code': str(rec.get('cls_code') or '').strip() or None,
            'market_cls': str(rec.get('market_cls') or '').strip() or None,
            'price': _num(rec.get('price')), 'static_price': _num(rec.get('static_price')), 'static_dprt': _num(rec.get('static_dprt')),
            'dyn_price': _num(rec.get('dyn_price')), 'dyn_dprt': _num(rec.get('dyn_dprt')),
            'count': int(_num(rec.get('count'))) if _num(rec.get('count')) is not None else None,
            'etp': str(rec.get('etp') or '').strip() or None}


def handle_raw(raw, now_kst=None):
    now_kst = now_kst or datetime.now(KST)
    records = parse_records(raw)
    if not records:
        return 0
    stored = 0
    with _lock:
        _state['frames'] += 1
        _state['lastFrameAt'] = now_kst.isoformat(timespec='seconds')
        for rec in records:
            _state['raw'].append(dict(rec, at=_state['lastFrameAt']))
        del _state['raw'][:-RAW_KEEP]
    for rec in records:
        item = to_store_record(rec)
        if item is not None:
            vi_store.merge(item, 'WS', now_kst)
            stored += 1
    return stored


def snapshot():
    hub = kis_ws_hub.get_hub()
    health = hub.health() if hub is not None else {}
    control = [c for c in (health.get('controlLog') or []) if c.get('trId') == TR_ID]
    with _lock:
        return {'frames': _state['frames'], 'lastFrameAt': _state['lastFrameAt'], 'keys': list(_state['keys']),
                'subscribedAt': _state['subscribedAt'], 'control': control[-10:], 'raw': list(_state['raw'][-8:])}


WATCH_STOCKS = int(os.environ.get('VI_WS_WATCH', '2'))     # 오늘 VI가 잦은 종목 N개를 종목별로도 구독(실시간 필드·종목별 구독 검증, 전체 종목 구독 아님)


def _wanted_keys():
    return list(PROBE_KEYS) + [c for c in vi_store.top_codes(WATCH_STOCKS) if c not in PROBE_KEYS]


async def _run_once(appkey, appsecret):
    hub = kis_ws_hub.start(appkey, appsecret)
    if hub is None:
        raise RuntimeError('KIS 공유 WebSocket 허브를 시작하지 못함')
    keys = _wanted_keys()
    sub = hub.subscribe([(TR_ID, key, kis_ws_hub.PRIORITY_QUOTES) for key in keys])
    with _lock:
        _state['subscribedAt'] = datetime.now(KST).isoformat(timespec='seconds')
        _state['keys'] = keys
    checked = time.time()
    try:
        while True:
            try:
                raw = await asyncio.wait_for(sub.queue.get(), timeout=30)
                handle_raw(raw)
            except asyncio.TimeoutError:
                pass
            if time.time() - checked > 300:
                checked = time.time()
                if _wanted_keys() != keys:
                    return                       # 관찰 대상이 바뀌면 다시 구독(_reconnect_loop가 곧바로 다시 부른다)
    finally:
        sub.close()


async def _reconnect_loop(appkey, appsecret):
    while True:
        try:
            await _run_once(appkey, appsecret)
            await asyncio.sleep(1)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception('KIS 실시간 VI 수신 오류, 5초 뒤 재시도')
            await asyncio.sleep(5)


def start_background(appkey, appsecret):
    global _thread
    if not appkey or not appsecret or not PROBE_KEYS:
        return None
    if _thread is not None and _thread.is_alive():
        return _thread
    _thread = threading.Thread(target=lambda: asyncio.run(_reconnect_loop(appkey, appsecret)), name='vi-kis-ws', daemon=True)
    _thread.start()
    return _thread
