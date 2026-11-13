"""자동매매 운영센터 제어 중계(Oracle 쪽).

브라우저 -> 이 서버(관리자 Google 세션) -> 명령 대기열 <- Google VM 에이전트가 주기적으로 가져감.
VM에는 들어오는 연결이 없다. 에이전트가 서버 간 비밀(HMAC)로 상태를 올리고 대기 명령을 받아 간다.
이 모듈은 주문·계좌·브로커를 호출하지 않으며 VM 서비스의 start/stop, 그리고 '오늘 신규 매수 보류'(hold/resume) 의도만 전달한다.
보류는 당일(KST) 날짜가 붙은 플래그로만 의미가 있고 자정 이후 자동으로 무효가 된다. 보류 여부의 원본은 에이전트가 올린 값이다.
상태는 에이전트가 올린 값만 쓰고, 오래됐거나 없으면 '미수신'으로 두며 정상·0으로 바꾸지 않는다.
"""
import hashlib
import hmac
import json
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone

import market_calendar
import snapshot_io

KST = timezone(timedelta(hours=9))
HERE = os.path.dirname(os.path.abspath(__file__))
STATE_PATH = os.path.join(HERE, 'autotrader_control_state.json')
AUDIT_PATH = os.path.join(HERE, 'autotrader_control_audit.jsonl')
AUDIT_MAX_BYTES = 1024 * 1024

TARGET_ACTIONS = ('target-add', 'target-cancel')
ACTIONS = ('start', 'stop', 'hold', 'resume') + TARGET_ACTIONS
HOLD_SCOPE = 'buy'            # 신규 매수만 보류한다. 보유분 청산 점검은 막지 않는다.
HOLD_CAPABILITY = 'hold'      # 에이전트가 snapshot.capabilities에 이 값을 올려야 hold/resume을 접수한다.
STALE_AFTER_SEC = 90        # 에이전트는 20초 주기. 이보다 오래되면 미수신으로 본다.
ACTIVITY_MAX_ORDERS = 400     # 화면 "더 보기"가 볼 수 있는 최근 주문 수
ACTIVITY_MAX_CANDIDATES = 120
ACTIVITY_MAX_HISTORY_DATES = 20
COMMAND_TTL_SEC = 150       # 에이전트가 못 가져간 명령은 만료한다(뒤늦게 실행되지 않게).
SIGNATURE_WINDOW_SEC = 60
KNOWN_CALENDAR_YEARS = (2026,)   # market_calendar 표가 검증된 연도. 그 밖은 휴장 여부를 모르므로 start 거부.

_lock = threading.Lock()


class ControlError(Exception):
    def __init__(self, status, detail):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def secret():
    return os.environ.get('AUTOTRADER_CONTROL_SECRET', '').strip()


def configured():
    return len(secret()) >= 32


def _now():
    return datetime.now(KST)


def _load():
    try:
        with open(STATE_PATH, encoding='utf-8') as stream:
            data = json.load(stream)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save(state):
    snapshot_io.atomic_json(STATE_PATH, state)


def audit(account, action, result, reason=''):
    """시각·계정·결과만 남긴다. 비밀·토큰·계좌 값은 기록하지 않는다."""
    row = {'at': _now().isoformat(timespec='seconds'), 'account': account or '-',
           'action': action, 'result': result, 'reason': str(reason)[:200]}
    try:
        if os.path.exists(AUDIT_PATH) and os.path.getsize(AUDIT_PATH) > AUDIT_MAX_BYTES:
            os.replace(AUDIT_PATH, AUDIT_PATH + '.1')
        with open(AUDIT_PATH, 'a', encoding='utf-8') as stream:
            stream.write(json.dumps(row, ensure_ascii=False) + '\n')
    except OSError:
        pass   # 감사 기록 실패가 stop을 막아서는 안 된다.


def sign(ts, body, key=None):
    return hmac.new((key or secret()).encode(), ('%s.' % ts).encode() + body, hashlib.sha256).hexdigest()


def verify_agent(ts, signature, body, now=None):
    if not configured():
        raise ControlError(503, '제어 비밀값이 서버에 설정되지 않았습니다.')
    try:
        stamp = int(ts)
    except (TypeError, ValueError):
        raise ControlError(401, 'invalid signature') from None
    if abs((now or time.time()) - stamp) > SIGNATURE_WINDOW_SEC:
        raise ControlError(401, 'invalid signature')
    if not hmac.compare_digest(signature or '', sign(ts, body)):
        raise ControlError(401, 'invalid signature')


def _fresh(snapshot, now):
    at = (snapshot or {}).get('receivedAt')
    if not at:
        return None
    try:
        return max(0, int((now - datetime.fromisoformat(at)).total_seconds()))
    except ValueError:
        return None


def start_blockers(snapshot, now):
    """start를 막는 사유 목록. 확인하지 못한 값은 통과가 아니라 차단 사유다."""
    out = []
    age = _fresh(snapshot, now)
    if age is None or age > STALE_AFTER_SEC:
        return ['VM 상태 미수신(에이전트 응답 없음)']
    # Web start can re-arm tomorrow's timer outside market hours or on holidays.
    # The VM runner performs the actual calendar and <14:00 entry checks.
    unknown = (snapshot.get('ledger') or {}).get('unknownOrders')
    if unknown is None:
        out.append('UNKNOWN 주문 수 미수신')
    elif unknown > 0:
        out.append('UNKNOWN 주문 %d건' % unknown)
    procs = snapshot.get('runnerProcs')
    if procs is None:
        out.append('실행 중 runner 수 미수신')
    elif procs > 0 or snapshot.get('serviceState') in ('active', 'activating'):
        out.append('autotrader-live가 이미 실행 중(이중 실행 방지)')
    if snapshot.get('tgConflict'):
        out.append('다른 곳에서 같은 텔레그램 봇이 동작 중(PC 실행 흔적 의심)')
    flags = snapshot.get('flags') or {}
    manual = flags.get('manualStop')
    if not isinstance(manual, bool):
        out.append('수동 중지 상태 미수신(에이전트 버전 확인)')
    timer = snapshot.get('timerState')
    if timer not in ('enabled', 'disabled'):
        out.append('타이머 상태 확인 불가')
    elif timer == 'enabled' and manual is not True:
        out.append('타이머가 이미 켜져 있음')
    return out


def hold_supported(snapshot):
    caps = (snapshot or {}).get('capabilities')
    return isinstance(caps, list) and HOLD_CAPABILITY in caps


def hold_view(snapshot, now):
    """오늘 신규 매수 보류 상태. 원본은 에이전트가 올린 flags.hold이며 날짜가 오늘이 아니면 무효다."""
    today = now.strftime('%Y-%m-%d')
    raw = ((snapshot or {}).get('flags') or {}).get('hold')
    reported = isinstance(raw, dict)
    # 에이전트가 파일을 읽지 못하거나 깨졌다고 보고하면({'invalid': True}) 엔진은 안전 방향으로 보류로 본다. 화면도 같게 보여 준다.
    invalid = reported and raw.get('invalid') is True
    active = reported and (invalid or raw.get('day') == today)
    return {'supported': hold_supported(snapshot), 'active': bool(active), 'invalid': bool(invalid), 'day': today,
            'scope': HOLD_SCOPE, 'staleDay': raw.get('day') if reported and not active else None}


def recent_log(limit=10):
    """화면용 최근 명령 기록(최신순). 감사 로그에서 시각·행동·결과·사유만 읽고 계정은 @ 앞부분만 보인다."""
    try:
        with open(AUDIT_PATH, 'rb') as stream:
            stream.seek(0, os.SEEK_END)
            size = stream.tell()
            stream.seek(max(0, size - 64 * 1024))
            lines = stream.read().decode('utf-8', 'replace').splitlines()
    except OSError:
        return []
    rows = []
    for line in reversed(lines):
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if not isinstance(row, dict) or row.get('action') not in ACTIONS:
            continue
        rows.append({'at': _text(row.get('at'), 25), 'action': row['action'], 'result': _text(row.get('result'), 12),
                     'account': _text(str(row.get('account') or '-').split('@')[0], 24), 'reason': _text(row.get('reason'), 80)})
        if len(rows) >= limit:
            break
    return rows


def public_status(now=None):
    now = now or _now()
    state = _load()
    snapshot = state.get('snapshot') or {}
    age = _fresh(snapshot, now)
    received = age is not None and age <= STALE_AFTER_SEC
    keep = ('timerState', 'serviceState', 'lastResult', 'flags', 'ledger', 'feed', 'runnerProcs', 'tgConflict', 'liveStatus', 'capabilities', 'targetBuys')
    view = {key: snapshot.get(key) for key in keep} if received else {key: None for key in keep}
    pending = state.get('pending')
    if pending and (time.time() - pending.get('queuedAt', 0)) > COMMAND_TTL_SEC:
        pending = None
    blockers = start_blockers(snapshot, now)
    hold = hold_view(snapshot if received else {}, now)
    return {'configured': configured(), 'received': received, 'ageSec': age, 'staleAfterSec': STALE_AFTER_SEC,
            'checkedAt': now.isoformat(timespec='seconds'), 'tradingDay': (market_calendar.is_kr_trading_day(now)
                                                                           if now.year in KNOWN_CALENDAR_YEARS else None),
            'activity': state.get('activity') if received else None,
            'vm': view, 'startBlockers': blockers, 'canStart': not blockers and not pending,
            'pending': {'id': pending['id'], 'action': pending['action']} if pending else None,
            'hold': hold, 'log': recent_log(),
            'lastCommand': state.get('last')}


def queue_command(action, account, now=None, params=None):
    now = now or _now()
    if action not in ACTIONS:
        raise ControlError(400, '허용되지 않는 명령')
    if not configured():
        audit(account, action, 'REFUSED', '제어 비밀값 미설정')
        raise ControlError(503, '제어 비밀값이 서버에 설정되지 않았습니다.')
    with _lock:
        state = _load()
        pending = state.get('pending')
        if pending and (time.time() - pending.get('queuedAt', 0)) <= COMMAND_TTL_SEC:
            if action in ('stop', 'hold') and pending.get('action') in TARGET_ACTIONS:
                audit(pending.get('account'), pending['action'], 'REFUSED', '중지·보류 요청 우선')
            else:
                audit(account, action, 'REFUSED', '대기 중인 명령 있음')
                raise ControlError(409, '이전 명령이 아직 처리 중입니다.')
        if action == 'start':
            blockers = start_blockers(state.get('snapshot'), now)
            if blockers:
                audit(account, action, 'REFUSED', '; '.join(blockers))
                raise ControlError(409, '시작할 수 없음: ' + '; '.join(blockers))
        # stop·hold·resume은 상태·시간과 무관하게 접수한다(더 안전한 방향의 명령). hold는 대상 에이전트가 지원할 때만.
        if action in ('hold', 'resume') and not hold_supported(state.get('snapshot')):
            audit(account, action, 'REFUSED', '에이전트 보류 기능 미지원')
            raise ControlError(409, '에이전트가 아직 보류 기능을 지원하지 않습니다.')
        command = {'id': '%d-%s' % (int(time.time()), os.urandom(4).hex()), 'action': action,
                   'queuedAt': time.time(), 'account': account}
        if action in TARGET_ACTIONS:
            snapshot = state.get('snapshot') or {}
            age = _fresh(snapshot, now)
            if age is None or age > STALE_AFTER_SEC or 'target-buy-v1' not in (snapshot.get('capabilities') or []):
                raise ControlError(409, '목표가 매수가 비활성이거나 에이전트 상태가 지연됐습니다.')
            if now.hour >= 14 or now.year not in KNOWN_CALENDAR_YEARS or not market_calendar.is_kr_trading_day(now):
                raise ControlError(409, '당일 등록 시간이 지났거나 휴장입니다.')
            params = params or {}
            code = params.get('code')
            if not isinstance(code, str) or not re.fullmatch(r'[0-9]{6}', code):
                raise ControlError(400, '종목코드는 숫자 6자리여야 합니다.')
            command.update(code=code, day=now.date().isoformat())
            if action == 'target-add':
                price, qty = params.get('price'), params.get('qty')
                if type(price) is not int or type(qty) is not int or not 1 <= price <= 10_000_000 or not 1 <= qty <= 100_000:
                    raise ControlError(400, '가격과 수량은 양의 정수여야 합니다.')
                command.update(price=price, qty=qty)
        if action == 'hold':
            command['day'] = now.strftime('%Y-%m-%d')    # 에이전트는 이 날짜의 플래그만 쓴다(자정 이후 자동 무효).
            command['scope'] = HOLD_SCOPE
        state['pending'] = command
        _save(state)
    audit(account, action, 'QUEUED', command['id'])
    return {'id': command['id'], 'action': action}


_CODE_RE = re.compile(r'^[0-9A-Z]{6}$')


def _int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _float(value):
    try:
        number = float(value)
        return number if number == number and abs(number) != float('inf') else None
    except (TypeError, ValueError):
        return None


def _text(value, limit):
    return str(value or '').strip()[:limit]


def _candidate_rows(rows):
    out = []
    for row in (rows or [])[:ACTIVITY_MAX_CANDIDATES]:
        if isinstance(row, dict) and _CODE_RE.match(str(row.get('code') or '')):
            reasons = [_text(item, 160) for item in (row.get('reasons') or [])[:5]] if isinstance(row.get('reasons'), list) else []
            out.append({'scanner': _text(row.get('scanner'), 24), 'code': row['code'], 'name': _text(row.get('name'), 24),
                        'score': _float(row.get('score')), 'basePrice': _float(row.get('basePrice')), 'reasons': reasons})
    return out


_DECISION_SCANNERS = {'pullback', 'doubleBottom', 'invHeadShoulders', 'maCloudBreakout', '9Pay intraday'}
_DECISION_INTS = ('rank', 'ranked_total', 'slots_used', 'candidates', 'confirm_hits')
_DECISION_NUMBERS = ('base', 'entry_vs_base_pct', 'avg', 'gain_pct', 'net_gain_pct',
                     'peak_gain_pct', 'signal_price', 'checked_price')
_DECISION_SCORE = ('traded_value_eok', 'avg_value_eok', 'volatility_penalty', 'trend_vs_20d')


def _safe_decision(raw):
    """주문 note 원문 대신 화면 복기에 필요한 비식별 수치만 허용한다."""
    if not isinstance(raw, dict):
        return {}
    out = {}
    if isinstance(raw.get('scanner'), str) and raw['scanner'] in _DECISION_SCANNERS:
        out['scanner'] = raw['scanner']
    scan_day = str(raw.get('scan_date') or '')
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', scan_day):
        out['scan_date'] = scan_day
    for key in _DECISION_INTS:
        val = _int(raw.get(key))
        if val is not None and 0 <= val <= 1000000:
            out[key] = val
    for key in _DECISION_NUMBERS:
        val = _float(raw.get(key))
        if val is not None and abs(val) < 1e10:
            out[key] = val
    if isinstance(raw.get('score'), dict):
        score = {}
        for key in _DECISION_SCORE:
            val = _float(raw['score'].get(key))
            if val is not None and abs(val) < 1e10:
                score[key] = val
        if score:
            out['score'] = score
    return out


def sanitize_activity(raw):
    """에이전트가 올린 주문·보유·후보 목록을 화면용 필드만 남기고 걸러 저장한다.

    주문번호·상세·비고·계좌·잔고 같은 필드는 아예 받지 않는다(허용 목록 방식). 모양이 틀린 행은 버린다.
    """
    raw = raw if isinstance(raw, dict) else {}
    orders, positions, cands = [], [], []
    for row in (raw.get('orders') or [])[:ACTIVITY_MAX_ORDERS]:
        if not isinstance(row, dict) or not _CODE_RE.match(str(row.get('code') or '')):
            continue
        side = str(row.get('side') or '').upper()
        if side not in ('BUY', 'SELL'):
            continue
        orders.append({'no': _int(row.get('no')), 'ts': _text(row.get('ts'), 32), 'code': row['code'], 'name': _text(row.get('name'), 24), 'side': side,
                       'qty': _int(row.get('qty')), 'price': _int(row.get('price')),
                       'state': _text(row.get('state'), 12), 'reason': _text(row.get('reason'), 24),
                       'decision': _safe_decision(row.get('decision'))})
    for row in (raw.get('positions') or [])[:100]:
        if isinstance(row, dict) and _CODE_RE.match(str(row.get('code') or '')):
            positions.append({'code': row['code'], 'name': _text(row.get('name'), 24), 'qty': _int(row.get('qty')),
                              'state': _text(row.get('state'), 12), 'buyDay': _text(row.get('buyDay'), 10),
                              'avg': _int(row.get('avg'))})
    block = raw.get('candidates') if isinstance(raw.get('candidates'), dict) else {}
    cands = _candidate_rows(block.get('rows'))
    skips = []
    for row in (raw.get('skips') or [])[:200]:
        if not isinstance(row, dict):
            continue
        day, code = str(row.get('day') or ''), str(row.get('code') or '')
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', day) or (code != '*' and not _CODE_RE.fullmatch(code)):
            continue
        skips.append({'day': day, 'code': code, 'reason': _text(row.get('reason'), 48),
                      'count': _int(row.get('count'))})
    bot_orders = []
    for row in (raw.get('botOrders') or [])[:200]:
        if not isinstance(row, dict) or not _CODE_RE.fullmatch(str(row.get('code') or '')):
            continue
        bot_orders.append({'ts': _text(row.get('ts'), 32), 'code': row['code'], 'name': _text(row.get('name'), 24),
                           'qty': _int(row.get('qty')), 'reason': _text(row.get('reason'), 48),
                           'status': _text(row.get('status'), 16)})
    result = {'orders': orders, 'positions': positions, 'skips': skips, 'botOrders': bot_orders,
              'candidates': {'scanDate': _text(block.get('scanDate'), 10), 'rows': cands}}
    if isinstance(block.get('history'), list):
        result['candidates']['history'] = [{'scanDate': _text(day.get('scanDate'), 10), 'rows': _candidate_rows(day.get('rows'))}
                                           for day in block['history'][:ACTIVITY_MAX_HISTORY_DATES] if isinstance(day, dict)]
    return result


def agent_sync(payload, now=None):
    """에이전트가 올린 상태를 저장하고, 대기 중인 명령(있으면 1건)을 돌려준다."""
    now = now or _now()
    snapshot = payload.get('snapshot')
    ack = payload.get('ack')
    if not isinstance(snapshot, dict):
        raise ControlError(400, 'snapshot 형식 오류')
    with _lock:
        state = _load()
        snapshot['receivedAt'] = now.isoformat(timespec='seconds')
        state['snapshot'] = snapshot
        if 'activity' in payload:
            fresh = sanitize_activity(payload.get('activity'))
            # 과거 후보(history)는 드물게만 오므로 이번에 없으면 이전 값을 유지한다.
            old_hist = ((state.get('activity') or {}).get('candidates') or {}).get('history')
            if 'history' not in fresh['candidates'] and old_hist is not None:
                fresh['candidates']['history'] = old_hist
            state['activity'] = fresh
        pending = state.get('pending')
        if isinstance(ack, dict) and pending and ack.get('id') == pending.get('id'):
            result = 'DONE' if ack.get('ok') else 'FAILED'
            state['last'] = {'action': pending['action'], 'result': result, 'at': now.isoformat(timespec='seconds'),
                             'reason': str(ack.get('reason') or '')[:200]}
            audit(pending.get('account'), pending['action'], result, ack.get('reason') or '')
            state['pending'] = pending = None
        command = None
        if pending:
            if (time.time() - pending.get('queuedAt', 0)) > COMMAND_TTL_SEC:
                audit(pending.get('account'), pending['action'], 'EXPIRED', pending.get('id'))
                state['last'] = {'action': pending['action'], 'result': 'EXPIRED',
                                 'at': now.isoformat(timespec='seconds'), 'reason': '에이전트가 시간 안에 가져가지 못함'}
                state['pending'] = None
            else:
                command = {key: pending[key] for key in ('id', 'action', 'day', 'scope', 'code', 'price', 'qty') if key in pending}
        _save(state)
    return {'command': command}
