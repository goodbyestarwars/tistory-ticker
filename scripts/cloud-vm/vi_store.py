# -*- coding: utf-8 -*-
"""당일 VI(변동성완화장치) 이력 저장소 - REST(inquire-vi-status)와 실시간(H0STVIC0)을 (종목코드, 발동시각)으로 합친다. (2026-10-15)

- REST가 전체 시장 현황의 기본 소스다(20초). 실시간은 구독 가능한 종목의 보완이며 같은 (코드, 발동시각)이면 한 건으로 합쳐 필드만 채운다.
- 상태: active(발동 중) / released(해제) / unknown(확인 불가). 해제시각이 없다는 이유만으로 무기한 발동 중으로 두지 않는다 -
  발동 후 ACTIVE_MAX_SEC가 지나도 해제를 못 받았으면 unknown이다.
- VI 종류 코드(vi_kind_code) 해석은 실수신으로 확인된 값만 쓴다(KIND_LABELS). 모르는 값은 kind=None('확인 불가')로 둔다.
- 메모리 한도: 하루 MAX_RECORDS건(초과 시 오래된 해제 건부터 버림), 날짜가 바뀌면 비운다.
"""
import threading
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
ACTIVE_MAX_SEC = 10 * 60          # 정적·동적 VI는 보통 2분 단일가 - 10분 넘게 해제를 못 받으면 발동 중으로 두지 않는다
MAX_RECORDS = 600
# 실수신으로 확인된 vi_kind_code만 채운다(확인 전에는 비워 '확인 불가'). 값은 vi_kind_labels_verified()로 점검.
KIND_LABELS = {}

_lock = threading.Lock()
_store = {'date': None, 'records': {}, 'markets': {}, 'ws_events': 0, 'rest_events': 0}
_FILL = ('name', 'kind_code', 'cls_code', 'price', 'static_price', 'static_dprt', 'dyn_price', 'dyn_dprt', 'count', 'etp', 'market_cls')


def _iso(dt):
    return dt.isoformat() if dt else None


def _roll(date_str):
    if _store['date'] != date_str:
        _store.update({'date': date_str, 'records': {}, 'ws_events': 0, 'rest_events': 0})


def merge(rec, source, now_kst):
    """rec: {code, name, triggered_at(datetime), released_at(datetime|None), ...확장 필드}. 같은 (코드, 발동시각)이면 합친다. 반환: True=신규."""
    code, trig = rec.get('code'), rec.get('triggered_at')
    if not code or trig is None:
        return False
    key = '%s|%s' % (code, trig.strftime('%H%M%S'))
    with _lock:
        _roll(now_kst.strftime('%Y%m%d'))
        cur = _store['records'].get(key)
        new = cur is None
        if new:
            cur = {'code': code, 'triggered_at': trig, 'released_at': None, 'sources': set()}
            _store['records'][key] = cur
        cur['sources'].add(source)
        _store['ws_events' if source == 'WS' else 'rest_events'] += 1
        if rec.get('released_at') is not None:
            cur['released_at'] = rec['released_at']
        for field in _FILL:
            if rec.get(field) is not None:
                cur[field] = rec[field]
        cur['seen_at'] = now_kst
        if len(_store['records']) > MAX_RECORDS:
            for k in sorted(_store['records'], key=lambda k: (_store['records'][k]['released_at'] is None, _store['records'][k]['triggered_at']))[:len(_store['records']) - MAX_RECORDS]:
                _store['records'].pop(k, None)
    return new


def set_markets(mapping):
    with _lock:
        _store['markets'].update({k: v for k, v in mapping.items() if v in ('KOSPI', 'KOSDAQ')})


def codes_without_market():
    with _lock:
        return sorted({r['code'] for r in _store['records'].values() if r['code'] not in _store['markets']})[:120]


def top_codes(n=2):
    """오늘 VI가 가장 잦았던 종목코드(발동횟수 기준) - 실시간 필드 검증용 구독 후보."""
    with _lock:
        best = {}
        for r in _store['records'].values():
            best[r['code']] = max(best.get(r['code'], 0), r.get('count') or 1)
    return [c for c, _ in sorted(best.items(), key=lambda kv: -kv[1])[:n]]


def status_of(rec, now_kst):
    released = rec.get('released_at')
    if released is not None and released <= now_kst:
        return 'released'
    if (now_kst - rec['triggered_at']).total_seconds() > ACTIVE_MAX_SEC:
        return 'unknown'
    return 'active'


def snapshot(now_kst, fresh=True):
    """화면용 당일 이력(발동 중 우선, 최근 발동 순). fresh=False(수신이 오래 끊김)면 active를 unknown으로 내려 과거 상태를 현재처럼 보이지 않는다."""
    with _lock:
        if _store['date'] != now_kst.strftime('%Y%m%d'):
            return [], {'ws': 0, 'rest': 0}
        recs = [dict(r, sources=sorted(r['sources'])) for r in _store['records'].values()]
        markets = dict(_store['markets'])
        counts = {'ws': _store['ws_events'], 'rest': _store['rest_events']}
    out = []
    for r in recs:
        status = status_of(r, now_kst)
        if status == 'active' and not fresh:
            status = 'unknown'
        kind = KIND_LABELS.get(r.get('kind_code'))
        out.append({
            'code': r['code'], 'name': r.get('name') or r['code'], 'market': markets.get(r['code']), 'status': status,
            'triggered_at': _iso(r['triggered_at']), 'released_at': _iso(r['released_at']) if status == 'released' else None,
            'kind': kind, 'kind_code': r.get('kind_code'), 'price': r.get('price'),
            'static_price': r.get('static_price'), 'static_dprt': r.get('static_dprt'),
            'dyn_price': r.get('dyn_price'), 'dyn_dprt': r.get('dyn_dprt'), 'count': r.get('count'),
            'etp': r.get('etp'), 'sources': r['sources'],
        })
    out.sort(key=lambda x: (0 if x['status'] == 'active' else 1, _neg(x['triggered_at'])))
    return out, counts


def _neg(iso):
    return tuple(-ord(c) for c in (iso or ''))
