# -*- coding: utf-8 -*-
"""메인페이지 VI·사이드카 배지 데이터(서버 1곳 폴링 + 메모리 캐시).

2026-09-15 작업지시서 "VI·사이드카 발동 배지(메인페이지)". 방문자 브라우저가 증권사 API를 각자 부르지
않도록 FastAPI 프로세스 안의 스레드 하나가 20초마다 조회하고, `/api/circuit-breaker`는 캐시만 돌려준다.

VI(개별종목 변동성완화장치): KIS "변동성완화장치(VI) 현황" [v1_국내주식-055]
  GET /uapi/domestic-stock/v1/quotations/inquire-vi-status, tr_id FHPST01390000
  요청: FID_DIV_CLS_CODE=0(전체), FID_COND_SCR_DIV_CODE=20139, FID_MRKT_CLS_CODE=0(전체),
        FID_RANK_SORT_CLS_CODE=0(정적+동적 전체), FID_INPUT_DATE_1=영업일(YYYYMMDD)
  응답 output(목록): hts_kor_isnm(종목명), mksc_shrn_iscd(종목코드), vi_cls_code(VI발동상태),
        bsop_date(영업일), cntg_vi_hour(VI발동시간), vi_cncl_hour(VI해제시간), vi_kind_code(VI종류),
        vi_prc(발동가격), vi_count(발동횟수) - KIS 공식 예제 open-trading-api inquire_vi_status 컬럼 기준.
  vi_cls_code 값의 뜻은 문서로 확인하지 못해, 발동/해제 판정은 해제시간(vi_cncl_hour) 유무로 한다.

시장 전체 사이드카·서킷브레이커(2026-10-15 재조사): KIS 국내주식 REST/실시간 목록 156개(장운영정보 H0STMKO0는 종목별 VI·거래정지 코드뿐,
지수·프로그램매매·업종 API에도 발동 필드 없음)와 키움 문서에서 이를 알려주는 필드를 확인하지 못했고, KRX Open API 카탈로그·공공데이터에도 당일 발동 현황이 없다.
KRX 사이트 크롤링은 금지 원칙이라 추가하지 않았다. 그래서 market_halt는 확인된 수신 경로가 연결될 때까지 available=False(=확인 불가)로 내려가며,
가격 급락만으로 발동을 추정하지 않는다. 수신 경로가 생기면 ingest_market_halt()로 넣기만 하면 화면까지 이어진다.

사이드카(프로그램매매 호가 일시효력정지): KIS·키움 문서에서 이를 알려주는 필드를 찾지 못했다
(국내업종 현재지수·국내지수 실시간프로그램매매·장운영정보 컬럼 확인). 미검증 필드를 쓰지 않고
KRX 크롤링도 새로 추가하지 않는 원칙에 따라, 확인된 출처가 생길 때까지 sidecar.available=False로 두고
화면 배지는 숨긴다.

조회 시간: KRX 거래일 08:55~15:35(정규장) + 15:55~20:05(애프터마켓). 그 밖에는 조회하지 않는다.
"""

import logging
import threading
import time
from datetime import datetime, timedelta, timezone

import kis_client

logger = logging.getLogger('circuit_breaker')

KST = timezone(timedelta(hours=9))
POLL_SEC = 20
IDLE_CHECK_SEC = 60
RELEASED_KEEP_SEC = 5 * 60
MAX_LIST = 10
VI_PATH = '/uapi/domestic-stock/v1/quotations/inquire-vi-status'
VI_TR_ID = 'FHPST01390000'
SIDECAR_NOTE = '사이드카 발동 여부를 알려주는 확인된 증권사 API 필드가 없어 아직 표시하지 않습니다.'
HALT_NOTE = '사이드카·서킷브레이커 자동 수신 경로가 연결되지 않아 발동 여부를 확인할 수 없습니다(정상이라는 뜻이 아닙니다). 한국거래소 공지를 확인하세요.'
HALT_KINDS = ('SIDECAR', 'CIRCUIT_BREAKER')
HALT_MARKETS = ('KOSPI', 'KOSDAQ')
HALT_STATUSES = ('active', 'released', 'resumed')
HALT_STALE_SEC = 180             # 수신이 이보다 오래 끊기면 '정상'으로 두지 않고 확인 불가로 내린다

_lock = threading.Lock()
_state = {
    'date': None,
    'rows': [],
    'fetchedAt': None,
    'error': None,
}
_thread = None
_halt = {'events': [], 'source': None, 'source_url': None, 'refresh_sec': None, 'received_at': None, 'last_error': None}


def in_poll_window(now_kst):
    import market_clock
    if not market_clock.is_kr_trading_day(now_kst):
        return False
    minutes = now_kst.hour * 60 + now_kst.minute
    return (8 * 60 + 55 <= minutes <= 15 * 60 + 35) or (15 * 60 + 55 <= minutes <= 20 * 60 + 5)


def _hhmmss_to_dt(date_str, hhmmss):
    text = str(hhmmss or '').strip()
    if not text or not text.isdigit() or int(text) == 0:
        return None
    text = text.zfill(6)
    try:
        return datetime.strptime(str(date_str) + text, '%Y%m%d%H%M%S').replace(tzinfo=KST)
    except ValueError:
        return None


def parse_rows(output, date_str):
    """KIS 응답 목록 → [{code, name, triggered_at(datetime), released_at(datetime|None), ...}]."""
    rows = []
    for item in output or []:
        if not isinstance(item, dict):
            continue
        code = str(item.get('mksc_shrn_iscd') or '').strip()
        name = str(item.get('hts_kor_isnm') or '').strip()
        row_date = str(item.get('bsop_date') or date_str).strip() or date_str
        triggered = _hhmmss_to_dt(row_date, item.get('cntg_vi_hour'))
        if not code or triggered is None:
            continue
        rows.append({
            'code': code,
            'name': name or code,
            'triggered_at': triggered,
            'released_at': _hhmmss_to_dt(row_date, item.get('vi_cncl_hour')),
            'vi_kind_code': str(item.get('vi_kind_code') or '').strip() or None,
            'vi_cls_code': str(item.get('vi_cls_code') or '').strip() or None,
            'count': _int(item.get('vi_count')),
        })
    return rows


def _int(value):
    try:
        return int(str(value).replace(',', '').strip())
    except (TypeError, ValueError):
        return None


def build_payload(rows, now_kst, fetched_at=None, error=None):
    """배지·드롭다운용 응답. 발동 중 전부 + 해제 후 5분 이내만, 최근 발동 순 최대 10건."""
    visible = []
    active_count = 0
    for row in rows or []:
        released = row.get('released_at')
        if released is not None and released <= now_kst:
            if (now_kst - released).total_seconds() > RELEASED_KEEP_SEC:
                continue
            status = 'released'
        else:
            status = 'active'
            active_count += 1
        visible.append({
            'code': row['code'],
            'name': row['name'],
            'status': status,
            'triggered_at': row['triggered_at'].isoformat(),
            'released_at': released.isoformat() if released is not None and status == 'released' else None,
        })
    visible.sort(key=lambda r: r['triggered_at'], reverse=True)
    return {
        'sidecar': {
            'available': False,
            'active': False,
            'market': None,
            'triggered_at': None,
            'note': SIDECAR_NOTE,
        },
        'vi_active_count': active_count,
        'vi_list': visible[:MAX_LIST],
        'fetchedAt': fetched_at,
        'error': error,
    }


def fetch_vi_output(appkey, appsecret, date_str, getter=None):
    if getter is None:
        def getter(path, tr_id, params):
            token = kis_client.get_token(appkey, appsecret)
            return kis_client._get_domestic_quote(token, appkey, appsecret, path, tr_id, params)
    data = getter(VI_PATH, VI_TR_ID, {
        'FID_DIV_CLS_CODE': '0',
        'FID_COND_SCR_DIV_CODE': '20139',
        'FID_MRKT_CLS_CODE': '0',
        'FID_INPUT_ISCD': '',
        'FID_RANK_SORT_CLS_CODE': '0',
        'FID_INPUT_DATE_1': date_str,
        'FID_TRGT_CLS_CODE': '',
        'FID_TRGT_EXLS_CLS_CODE': '',
    })
    output = (data or {}).get('output')
    if isinstance(output, dict):
        output = [output]
    return output or []


def refresh_once(appkey, appsecret, now_kst=None, getter=None):
    now_kst = now_kst or datetime.now(KST)
    date_str = now_kst.strftime('%Y%m%d')
    with _lock:
        if _state['date'] != date_str:
            _state.update({'date': date_str, 'rows': [], 'fetchedAt': None, 'error': None})
    try:
        rows = parse_rows(fetch_vi_output(appkey, appsecret, date_str, getter), date_str)
    except Exception as exc:
        with _lock:
            _state['error'] = str(exc)[:200]
        logger.info('VI 현황 조회 실패: %s', exc)
        return None
    with _lock:
        _state['rows'] = rows
        _state['fetchedAt'] = now_kst.isoformat(timespec='seconds')
        _state['error'] = None
    return rows


def _iso_kst(value):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    if dt.tzinfo is None:
        return None                      # 시간대 없는 시각은 믿지 않는다
    return dt.astimezone(KST)


def normalize_halt_event(raw):
    """공식 수신 경로에서 온 한 건을 검증·정규화한다. 시장·종류·시각이 불확실하면 None(버림) - 추정으로 채우지 않는다.
    서킷브레이커는 1~3단계 필수. 상태는 active(발동 중) / released(해제) / resumed(거래 재개)."""
    if not isinstance(raw, dict):
        return None
    market, kind, status = raw.get('market'), raw.get('kind'), raw.get('status')
    triggered = _iso_kst(raw.get('triggered_at'))
    if market not in HALT_MARKETS or kind not in HALT_KINDS or status not in HALT_STATUSES or triggered is None:
        return None
    stage = raw.get('stage')
    if kind == 'CIRCUIT_BREAKER':
        # KIS 장운영정보(장운영구분코드)는 단계를 주지 않으므로 코드가 있으면 단계 미확인(None)을 허용한다 - 단계를 추정하지 않는다.
        if stage not in (1, 2, 3) and not (stage is None and raw.get('code')):
            return None
    else:
        stage = None
    released, resumed = _iso_kst(raw.get('released_at')), _iso_kst(raw.get('resumed_at'))
    if status != 'active' and released is None and resumed is None:
        return None                      # 해제·재개라면 그 시각이 있어야 한다
    event_id = str(raw.get('id') or '%s-%s-%s-%s' % (market, kind, stage or 0, triggered.isoformat()))
    ends = _iso_kst(raw.get('ends_at'))
    direction = raw.get('direction') if raw.get('direction') in ('SELL', 'BUY') else None
    precision = 'minute' if raw.get('time_precision') == 'minute' else 'second'
    change = raw.get('change_pct')
    return {'id': event_id, 'market': market, 'kind': kind, 'stage': stage, 'status': status, 'triggered_at': triggered.isoformat(),
            'released_at': released.isoformat() if released else None, 'resumed_at': resumed.isoformat() if resumed else None,
            'ends_at': ends.isoformat() if ends else None, 'direction': direction, 'time_precision': precision,
            'change_pct': float(change) if isinstance(change, (int, float)) else None, 'basis': None,
            'code': str(raw['code']) if raw.get('code') else None}


def declare_halt_source(source, source_url=None, refresh_sec=None):
    """수신 경로를 선언한다(아직 한 번도 못 받았어도 출처·주기를 payload에 싣고, 실패하면 '수신 실패'로 구분해 보여 주기 위함)."""
    with _lock:
        _halt.update({'source': str(source or '')[:60] or None, 'source_url': source_url, 'refresh_sec': refresh_sec})


def set_halt_error(message):
    """수신 실패를 기록한다. 직전 이벤트는 지우지 않지만 수신 시각은 갱신하지 않으므로 오래되면 확인 불가로 내려간다."""
    with _lock:
        _halt['last_error'] = str(message)[:200] if message else None


def ingest_market_halt(events, source, now_kst=None, source_url=None, refresh_sec=None):
    """확인된 공식 수신 경로가 연결되면 이 함수로 현재 상황을 통째로 넣는다(빈 목록 = '확인된 이벤트 없음'). 같은 id는 하나만 남기고(뒤의 것이 이김),
    당일(KST) 발동 건만 보관하며 형식이 틀린 건은 버린다. 반환: 보관한 건수."""
    now_kst = now_kst or datetime.now(KST)
    today = now_kst.strftime('%Y-%m-%d')
    byid = {}
    for raw in events or []:
        event = normalize_halt_event(raw)
        if event and event['triggered_at'][:10] == today:
            byid[event['id']] = event
    with _lock:
        _halt.update({'events': sorted(byid.values(), key=lambda e: e['triggered_at']), 'source': str(source or '')[:60] or None,
                      'source_url': source_url, 'refresh_sec': refresh_sec, 'received_at': now_kst.isoformat(timespec='seconds'), 'last_error': None})
    return len(byid)


def _halt_window(now_kst):
    """(거래일 여부, 수신 창 안인지). 수신 창 = 거래일 08:50~16:10(market_halt_kind와 같은 값)."""
    import market_clock
    trading = market_clock.is_kr_trading_day(now_kst)
    minutes = now_kst.hour * 60 + now_kst.minute
    return trading, trading and (8 * 60 + 50 <= minutes <= 16 * 60 + 10)


def build_market_halt(now_kst=None):
    """화면용 시장 전체 사이드카·서킷브레이커 상태. 수신 경로가 없거나 수신이 끊겼으면 available=False(확인 불가)이며 events는 비운다.
    available=True일 때만 events(오늘 발동 전부)와 active_count를 신뢰할 수 있다.

    신선도: 수신 창(거래일 08:50~16:10) 안에서는 마지막 성공 수신이 HALT_STALE_SEC 안이어야 한다. 창 밖(장 시작 전·휴장일)에는 발동이 있을 수 없어 '이벤트 없음'으로 보고,
    장 마감 뒤에는 오늘 15:45 이후 성공 수신이 있어야 당일 이력을 신뢰한다.
    사이드카는 공시 본문의 지속시간(ends_at)이 지나면 '발동 후 N분 경과'로 자동 해제 처리한다(basis=DURATION_ELAPSED) - 해제 공시가 따로 없기 때문이다."""
    now_kst = now_kst or datetime.now(KST)
    with _lock:
        events, source, received = list(_halt['events']), _halt['source'], _halt['received_at']
        source_url, refresh_sec, last_error = _halt['source_url'], _halt['refresh_sec'], _halt['last_error']
    base = {'available': False, 'source': source, 'source_url': source_url, 'refresh_sec': refresh_sec, 'received_at': received, 'last_error': last_error,
            'delay_note': None, 'events': [], 'active_count': 0, 'reason': None, 'note': HALT_NOTE}
    if not source:
        base['reason'] = 'NO_VERIFIED_SOURCE'
        return base
    trading, in_window = _halt_window(now_kst)
    received_dt = _iso_kst(received)
    today = now_kst.strftime('%Y-%m-%d')
    received_today = received_dt is not None and received_dt.strftime('%Y-%m-%d') == today
    if in_window:
        ok = received_dt is not None and 0 <= (now_kst - received_dt).total_seconds() <= HALT_STALE_SEC
    elif not trading or now_kst.hour * 60 + now_kst.minute < 8 * 60 + 50:
        ok = True                                  # 휴장일·장 시작 전: 발동이 있을 수 없다(받은 당일 이력이 있으면 아래에서 그대로 보여 줌)
    else:
        ok = received_today and received_dt.hour * 60 + received_dt.minute >= 15 * 60 + 45
    if not ok:
        failed = bool(last_error) and not (received_dt is not None and (now_kst - received_dt).total_seconds() <= HALT_STALE_SEC)
        base['reason'] = 'FETCH_FAILED' if failed else 'STALE'
        base['note'] = ('사이드카·서킷브레이커 수신에 실패해 발동 여부를 확인할 수 없습니다(정상이라는 뜻이 아닙니다). 한국거래소 공지를 확인하세요.' if failed else
                        '사이드카·서킷브레이커 수신이 지연되고 있어 발동 여부를 확인할 수 없습니다(정상이라는 뜻이 아닙니다). 한국거래소 공지를 확인하세요.')
        return base
    shown = []
    for event in events:
        if event['triggered_at'][:10] != today:
            continue
        ends = _iso_kst(event.get('ends_at'))
        if event['kind'] == 'SIDECAR' and event['status'] == 'active' and ends is not None and now_kst >= ends:
            event = dict(event, status='released', released_at=ends.isoformat(), basis='DURATION_ELAPSED')
        shown.append(event)
    delay = '공시 기준 · %s초마다 확인 · 실시간 체결 데이터가 아니라 공시 게시 후 반영됩니다' % refresh_sec if refresh_sec else '공시 기준 · 실시간 데이터가 아닙니다'
    if source and source.startswith('KIS'):
        delay = 'KIS 실시간 장운영정보 구독 · 발동·해제 코드 수신 즉시 반영'
    return dict(base, available=True, reason=None, note=None, events=shown, delay_note=delay,
                active_count=sum(1 for e in shown if e['status'] == 'active'))


def get_payload(now_kst=None):
    now_kst = now_kst or datetime.now(KST)
    with _lock:
        rows = list(_state['rows']) if _state['date'] == now_kst.strftime('%Y%m%d') else []
        fetched = _state['fetchedAt']
        error = _state['error']
    payload = build_payload(rows, now_kst, fetched, error)
    halt = build_market_halt(now_kst)
    payload['market_halt'] = halt
    try:
        import market_halt_kis
        halt['kis'] = market_halt_kis.snapshot()
    except Exception:
        halt['kis'] = None
    # 헤더 배지(사이드카)도 같은 수신 경로로만 채운다 - 수신이 없으면 기존처럼 available=False로 숨긴다.
    if halt['available']:
        active = [e for e in halt['events'] if e['kind'] == 'SIDECAR' and e['status'] == 'active']
        if active:
            last = active[-1]
            payload['sidecar'] = {'available': True, 'active': True, 'market': last['market'], 'triggered_at': last['triggered_at'], 'note': None}
        else:
            payload['sidecar'] = {'available': True, 'active': False, 'market': None, 'triggered_at': None, 'note': None}
    return payload


def _loop(appkey, appsecret, on_tick=None):
    while True:
        now_kst = datetime.now(KST)
        if on_tick:
            try:
                on_tick()
            except Exception:
                logger.warning('hour validation tick unavailable')
        if in_poll_window(now_kst):
            refresh_once(appkey, appsecret, now_kst)
            time.sleep(POLL_SEC)
        else:
            time.sleep(IDLE_CHECK_SEC)


def start_background(appkey, appsecret, on_tick=None):
    global _thread
    if not appkey or not appsecret:
        logger.warning('KIS_APPKEY/KIS_APPSECRET 미설정 - VI 배지 조회 건너뜀')
        return None
    with _lock:
        if _thread is not None and _thread.is_alive():
            return _thread
        _thread = threading.Thread(target=_loop, args=(appkey, appsecret, on_tick), name='circuit-breaker', daemon=True)
        _thread.start()
    return _thread
