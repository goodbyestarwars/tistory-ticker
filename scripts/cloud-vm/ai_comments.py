# -*- coding: utf-8 -*-
"""9Pay AI 시장 코멘트 엔진 (2026-10-23).

예전에는 js/market-temp.js 의 미리 쓴 문장 배열에서 하나를 골랐다(COMMENT_POOLS_ 등). 이제는
    ① 수집  기존 KIS·키움·FRED·네이버·KOFIA 데이터 그대로(이 모듈은 새 시세 API를 쓰지 않는다)
    ② 분석  ai_comment_facts.py 가 전일 대비·5/20일 추세·평균 대비·연속 일수·수급 우위·지표 간 일치를 계산(AI 호출 전)
    ③ 생성  사실 객체만 JSON으로 Groq 에 보내 한국어 코멘트를 받는다(관련 카드를 묶어 요청 1회 = 여러 카드)
    ④ 검증  ai_comment_validator.py 가 숫자·방향·원인 단정·금융 단정·반복을 막고, 통과 못 하면 제한된 재시도 후 '해설 없음'
    ⑤ 저장  SQLite(ai_comments / ai_comment_history / ai_comment_runs). 방문자는 저장된 확정 코멘트를 읽기만 한다.

Groq 키는 이 서버에 없다. 기존 GAS 프록시(gas/ticker-proxy.gs 의 Groq 호출부)에 'marketComments' POST 경로를 열어
VM 이 자기 API_TOKEN 으로 인증한 뒤 프롬프트를 넘기고, GAS 가 callGroq 계열로 호출해 응답을 돌려준다. 브라우저에는 키도 AI 호출도 없다.

묶음(group)과 생성 주기
    brief     07:00 시장 브리핑 확정 후 1회(미국 5지표·야간선물·요약). 같은 거래일엔 바뀌지 않는다(정정 때만 다시)
    intraday  장중 투자심리(거래량·상승하락·외국인·기관·개인·프로그램·풋콜·요약). 점검은 몇 분마다, 호출은 의미 있는 상태 변화에서만
    funds     빚투·예탁금 - 일별 확정 데이터가 새로 들어왔을 때
    macro     금리·환율·원유·금·비트코인 - 새 유효 데이터/단계 변화가 있을 때

같은 날 같은 데이터면 코멘트는 바뀌지 않는다(서명 sig 가 같으면 호출하지 않는다 - 재시작·배포 후에도 DB 의 값이 유지된다).
상태가 바뀌었는데 새 코멘트를 못 만들면(AI 장애) 조회 API 는 그 카드의 옛 코멘트를 숨긴다. 고정 문구로 채우지 않는다.
"""
import json
import logging
import os
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

import ai_comment_facts as facts_mod
import ai_comment_validator as validator
import db_schema
import market_clock

LOGGER = logging.getLogger('ai_comments')
KST = timezone(timedelta(hours=9))

PROMPT_VERSION = 'v1'
GROUP_ORDER = ('brief', 'intraday', 'funds', 'macro')
DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec'
MODEL_FALLBACK_NAME = 'groq(via-gas)'

# ---- 호출량 제한(환경변수로 조정 가능). Groq 요금제 한도는 미확인이므로 보수적으로 둔다 --------------------------------
DAILY_CALL_CAP = int(os.environ.get('AI_COMMENTS_DAILY_CALLS', '60'))
DAILY_TOKEN_CAP = int(os.environ.get('AI_COMMENTS_DAILY_TOKENS', '150000'))
GROUP_DAILY_CALLS = {'brief': 6, 'intraday': 16, 'funds': 4, 'macro': 12}
GROUP_MIN_GAP_SEC = {'brief': 600, 'intraday': 20 * 60, 'funds': 30 * 60, 'macro': 45 * 60}
URGENT_GAP_SEC = 5 * 60            # 카드 상태(방향)가 바뀐 경우의 최소 간격
FIRST_GAP_SEC = 60                 # 아직 코멘트가 없는 카드를 처음 만들 때
MAX_MODEL_CALLS = 2                # 한 번의 생성에서 모델 호출 상한(최초 1회 + 반려된 카드만 교정 재요청 1회)
MAX_OUTPUT_TOKENS = 2200
HISTORY_DAYS = 14                  # 반복 방지에 참조하는 기간
RECENT_PER_SLOT = 6                # 프롬프트에 넣는 카드당 최근 문장 수(날짜가 다른 것 우선)
HISTORY_KEEP_DAYS = 120
RUN_KEEP = 2000
# 코멘트를 보여 줄 수 있는 최대 경과일(그 뒤에는 숨긴다)
MAX_AGE_DAYS = {'brief': 6, 'intraday': 4, 'funds': 8, 'macro': 4}

MISSING = '__missing__'


class ModelError(Exception):
    """모델 호출 실패(네트워크·인증·응답 형식). retryable=False 면 즉시 포기."""

    def __init__(self, message, retryable=True):
        super().__init__(message)
        self.retryable = retryable


def enabled():
    return os.environ.get('AI_COMMENTS_ENABLED', '1') != '0'


def _stamp(dt):
    return dt.strftime('%Y-%m-%d %H:%M:%S')


def _parse_stamp(text):
    try:
        return datetime.strptime(str(text), '%Y-%m-%d %H:%M:%S').replace(tzinfo=KST)
    except ValueError:
        return None


def trade_date_for(now):
    """코멘트가 속하는 국내 기준 거래일: 거래일이면 오늘, 휴장일이면 직전 거래일."""
    if market_clock.is_kr_trading_day(now):
        return now.strftime('%Y-%m-%d')
    return market_clock.prev_kr_trading_day(now.date()).strftime('%Y-%m-%d')


# ---- 저장소 -----------------------------------------------------------------------------------------

def ensure_schema(conn):
    try:
        conn.execute('SELECT 1 FROM ai_comments LIMIT 0')
        conn.execute('SELECT 1 FROM ai_comment_history LIMIT 0')
        conn.execute('SELECT 1 FROM ai_comment_runs LIMIT 0')
    except Exception:
        db_schema.create_schema(conn)


def get_rows(conn):
    cur = conn.execute('SELECT slot, group_name, status, text, trade_date, data_asof, state, sig, current_state, current_sig, '
                       'checked_at, facts_hash, angle, model, prompt_version, run_id, generated_at FROM ai_comments')
    cols = [c[0] for c in cur.description]
    return {r[0]: dict(zip(cols, r)) for r in cur.fetchall()}


def record_current(conn, group, facts, now):
    """이번 점검의 시장 상태를 카드 행에 기록한다(코멘트는 건드리지 않는다). 사실이 없는 카드는 MISSING 으로 표시한다."""
    stamp = _stamp(now)
    rows = get_rows(conn)
    for slot in facts_mod.GROUP_SLOTS[group]:
        f = facts.get(slot)
        state, sig = (f['state'], f['sig']) if f else (MISSING, None)
        if slot in rows:
            conn.execute('UPDATE ai_comments SET current_state=?, current_sig=?, checked_at=? WHERE slot=?', (state, sig, stamp, slot))
        elif f:
            conn.execute('INSERT INTO ai_comments(slot, group_name, status, current_state, current_sig, checked_at, updated_at) '
                         "VALUES (?,?,'none',?,?,?,?)", (slot, group, state, sig, stamp, stamp))
    conn.commit()


def recent_history(conn, slot, today, days=HISTORY_DAYS):
    since = (datetime.strptime(today, '%Y-%m-%d') - timedelta(days=days)).strftime('%Y-%m-%d')
    cur = conn.execute('SELECT trade_date, text, angle, generated_at FROM ai_comment_history WHERE slot=? AND trade_date>=? '
                       'ORDER BY id DESC LIMIT 60', (slot, since))
    return [{'trade_date': r[0], 'text': r[1], 'angle': r[2], 'generated_at': r[3]} for r in cur.fetchall()]


def usage_today(conn, now, group=None):
    day = now.strftime('%Y-%m-%d')
    sql = "SELECT COALESCE(SUM(calls),0), COALESCE(SUM(total_tokens),0) FROM ai_comment_runs WHERE substr(started_at,1,10)=?"
    args = [day]
    if group:
        sql += ' AND group_name=?'
        args.append(group)
    r = conn.execute(sql, args).fetchone()
    return int(r[0]), int(r[1])


def consecutive_failures(conn, group):
    n = 0
    for (outcome,) in conn.execute('SELECT outcome FROM ai_comment_runs WHERE group_name=? ORDER BY id DESC LIMIT 8', (group,)):
        if outcome in ('failed', 'rejected'):
            n += 1
        else:
            break
    return n


def last_run_started(conn, group):
    r = conn.execute('SELECT started_at FROM ai_comment_runs WHERE group_name=? ORDER BY id DESC LIMIT 1', (group,)).fetchone()
    return _parse_stamp(r[0]) if r else None


def _prune(conn, now):
    cutoff = (now - timedelta(days=HISTORY_KEEP_DAYS)).strftime('%Y-%m-%d')
    conn.execute('DELETE FROM ai_comment_history WHERE trade_date<?', (cutoff,))
    conn.execute('DELETE FROM ai_comment_runs WHERE id NOT IN (SELECT id FROM ai_comment_runs ORDER BY id DESC LIMIT ?)', (RUN_KEEP,))


# ---- 어떤 카드를 다시 만들지 -----------------------------------------------------------------------------

def decide_needs(rows, facts):
    """사실이 있는 카드 중 코멘트가 없거나, 만들 때의 서명/프롬프트 버전이 지금과 다른 카드. 반환 [(slot, urgent)]."""
    needs = []
    for slot, f in facts.items():
        row = rows.get(slot)
        if not row or row['status'] != 'ok' or not row['text']:
            needs.append((slot, False, True))
        elif row['sig'] != f['sig'] or row['prompt_version'] != PROMPT_VERSION:
            needs.append((slot, row['state'] != f['state'], False))
    return needs


def gate(conn, group, now, needs, force=False):
    """호출해도 되는가. 되면 None, 아니면 이유 문자열."""
    if not enabled():
        return 'disabled'
    if force:
        return None
    calls, tokens = usage_today(conn, now)
    if calls >= DAILY_CALL_CAP:
        return 'daily-call-cap'
    if tokens >= DAILY_TOKEN_CAP:
        return 'daily-token-cap'
    gcalls, _ = usage_today(conn, now, group)
    if gcalls >= GROUP_DAILY_CALLS[group]:
        return 'group-call-cap'
    last = last_run_started(conn, group)
    if last:
        elapsed = (now - last).total_seconds()
        fails = consecutive_failures(conn, group)
        backoff = min(3600, 300 * 2 ** (fails - 1)) if fails else 0
        first_only = all(first for _, _, first in needs)
        urgent = any(u for _, u, _ in needs)
        gap = FIRST_GAP_SEC if first_only else URGENT_GAP_SEC if urgent else GROUP_MIN_GAP_SEC[group]
        if elapsed < max(gap, backoff):
            return 'backoff' if backoff and elapsed < backoff else 'throttled'
    return None


# ---- 프롬프트 -----------------------------------------------------------------------------------------

SYSTEM_PROMPT = (
    "너는 한국 주식시장 서비스 '9Pay 증권'의 시장 카드 옆에 붙는 짧은 한마디를 쓴다.\n"
    "[말투] 주식을 오래 해본 사람이 화면을 같이 보다가 옆에서 한마디 하는 느낌이다. 자연스럽고 친근한 구어체(~네, ~려나, ~듯, ~겠어)를 쓰고 "
    "가끔만 가벼운 농담을 섞는다. 경제보고서체, 유행어, 비속어, 이모지, 감탄사 남발은 쓰지 않는다. 카드에 숫자가 이미 보이므로 숫자를 되풀이하지 말고 "
    "그 숫자가 시장에서 무슨 뜻인지 한마디로 말한다. 숫자를 꼭 써야 하면 numbers 에 있는 값만 쓴다.\n"
    "[형식] 카드마다 한 문장(짧은 구절 두 개까지). 공백 포함 12~60자(요약 카드는 최대 90자). 줄바꿈·마크다운 없음.\n"
    "[사실 규칙] 아래 JSON 의 facts 에 있는 내용만 말한다. 뉴스·사건·정책·기관·개별 종목·원인을 지어내지 않는다. 원인은 단정하지 않고, 궁금하면 "
    "'~인지 봐야겠네'처럼 의문형으로만 말한다. 매수·매도 권유, 수익 보장, 폭락/급등 예고, 확정적 전망은 쓰지 않는다. 카드별 avoid 를 지킨다. "
    "context 의 수치는 해석에만 쓰고 문장에 옮기지 않는다. flags.big 이 false 면 급등·급락 같은 큰 변동 표현을 쓰지 않고, flags.streak 가 false 면 "
    "연속·내내·계속·줄곧 같은 표현을 쓰지 않으며, flags.extreme 이 false 면 최고·최저·고점·저점·바닥 같은 표현을 쓰지 않는다. "
    "flags.intraday 가 true 면 장중 잠정치이므로 마감 결과처럼 말하지 않는다. related 에 없는 다른 지표는 언급하지 않는다.\n"
    "[관점] 카드마다 angle 이 정해져 있다. 그 관점으로 쓰되 사실이 받쳐 주지 않으면 angles 중 다른 관점을 쓴다. 같은 상황이라도 최근 문장(recent)과 "
    "표현·시작 단어·문장 구조가 달라야 한다.\n"
    "[말투 예시 - 분위기만 참고하고 문장을 그대로 쓰지 말 것] " + ' / '.join(validator.TONE_EXAMPLES) + "\n"
    '[출력] 요청한 카드만 담은 JSON 객체 하나만 출력한다: {"comments": {"<slot>": "문장", ...}}. 다른 글은 쓰지 않는다.'
)


def pick_angle(f, history):
    """사실이 뒷받침하는 관점 중 가장 오래전에 쓴(또는 한 번도 안 쓴) 것을 고른다. 날짜 해시가 아니라 이 카드의 사용 이력 기준."""
    angles = f.get('angles') or []
    if not angles:
        return None
    used = [h['angle'] for h in history if h.get('angle')]     # 최신순
    return max(angles, key=lambda a: ((used.index(a) if a in used else len(used) + 1), -angles.index(a)))


def build_prompt(slots, facts_all, histories, angles, feedback, session):
    payload = {'session': session, 'cards': {}}
    for slot in slots:
        f = facts_all[slot]
        rel = {}
        for r in f.get('related') or []:
            rf = facts_all.get(r)
            if rf:
                rel[rf['label']] = {'state': rf['state'], **{k: v for k, v in list(rf['context'].items())[:4]}}
        card = {'label': f['label'], 'data_date': f['asof'], 'state': f['state'], 'numbers': f['numbers'], 'context': f['context'],
                'flags': f['flags'], 'avoid': f['avoid'], 'angles': f['angles'], 'angle': angles.get(slot),
                'max_chars': validator.MAX_LEN_SUMMARY if slot in validator.SUMMARY_SLOTS else validator.MAX_LEN}
        if rel:
            card['related'] = rel
        recent = []
        for h in histories.get(slot, []):
            if h['text'] not in recent:
                recent.append(h['text'])
            if len(recent) >= RECENT_PER_SLOT:
                break
        card['recent'] = recent
        if slot in feedback:
            card['previous_rejected'] = feedback[slot]
        payload['cards'][slot] = card
    user = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    if feedback:
        user = '앞서 쓴 문장 중 일부가 검증에서 반려됐다. previous_rejected 의 사유를 고쳐 해당 카드만 다시 쓴다.\n' + user
    return SYSTEM_PROMPT, user


# ---- 모델 호출(GAS 경유 Groq) ---------------------------------------------------------------------------

# Groq 무료/저가 요금제는 분당 토큰(TPM) 한도가 작다. 같은 점검에서 묶음 요청이 연달아 나가면 429로 실패하므로(2026-10-24 운영 첫 실행에서 금리·환율 묶음 실패)
# 실제 호출 사이에 최소 간격을 둔다. 목 모델(시험)은 이 함수를 거치지 않는다.
MIN_CALL_SPACING_SEC = 25
_spacing_lock = threading.Lock()
_last_call_at = [0.0]


def _space_calls():
    with _spacing_lock:
        wait = MIN_CALL_SPACING_SEC - (time.time() - _last_call_at[0])
        if wait > 0:
            time.sleep(wait)
        _last_call_at[0] = time.time()


def call_gas(system, user, max_tokens=MAX_OUTPUT_TOKENS, timeout=75):
    """GAS 프록시의 marketComments 로 Groq 를 호출한다. 반환 {'content', 'usage', 'model'}. 실패하면 ModelError.

    인증: 이 서버의 API_TOKEN 을 본문(token)으로 보낸다 - GAS 는 자기 스크립트 속성 KIWOOM_VM_TOKEN(같은 값)과 비교한다.
    토큰은 로그·예외 메시지에 싣지 않는다.
    """
    token = os.environ.get('API_TOKEN')
    if not token:
        raise ModelError('API_TOKEN 미설정', retryable=False)
    url = os.environ.get('AI_COMMENTS_GAS_URL') or DEFAULT_GAS_URL
    _space_calls()
    body = json.dumps({'action': 'marketComments', 'token': token, 'system': system, 'user': user, 'maxTokens': max_tokens},
                      ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url, data=body, method='POST', headers={'Content-Type': 'application/json; charset=utf-8'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as exc:
        raise ModelError('GAS HTTP %s' % exc.code) from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ModelError('GAS 연결 실패: %s' % type(exc).__name__) from None
    try:
        data = json.loads(raw)
    except ValueError:
        raise ModelError('GAS 응답이 JSON 이 아님(배포 전이거나 로그인 페이지)', retryable=False) from None
    if not isinstance(data, dict) or not data.get('ok'):
        err = str((data or {}).get('error') or 'unknown')[:120] if isinstance(data, dict) else 'unknown'
        raise ModelError('GAS 오류: %s' % err, retryable=err not in ('unauthorized', 'unknown-action'))
    content = data.get('content')
    if not content:
        raise ModelError('모델 응답이 비어 있음')
    return {'content': content, 'usage': data.get('usage') or {}, 'model': data.get('model') or MODEL_FALLBACK_NAME}


# ---- 생성 파이프라인 -----------------------------------------------------------------------------------

def _log_run(conn, group, trade_date, trigger, started, outcome, calls, requested, accepted, rejected, usage, latency_ms, model, error):
    cur = conn.execute(
        'INSERT INTO ai_comment_runs(group_name, trade_date, trigger, started_at, finished_at, outcome, calls, slots_requested, '
        'slots_accepted, slots_rejected, prompt_tokens, completion_tokens, total_tokens, latency_ms, model, error) '
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        (group, trade_date, trigger, _stamp(started), _stamp(datetime.now(KST)), outcome, calls, ','.join(requested),
         ','.join(accepted), json.dumps(rejected, ensure_ascii=False)[:800] if rejected else None,
         usage['prompt'], usage['completion'], usage['total'], latency_ms, model, (error or '')[:300] or None))
    conn.commit()
    return cur.lastrowid


def _save_comment(conn, slot, group, f, text, angle, model, run_id, now, trade_date, sim):
    stamp = _stamp(now)
    conn.execute(
        'INSERT INTO ai_comments(slot, group_name, status, text, trade_date, data_asof, state, sig, current_state, current_sig, checked_at, '
        'facts_hash, angle, model, prompt_version, run_id, generated_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) '
        'ON CONFLICT(slot) DO UPDATE SET group_name=excluded.group_name, status=excluded.status, text=excluded.text, '
        'trade_date=excluded.trade_date, data_asof=excluded.data_asof, state=excluded.state, sig=excluded.sig, '
        'current_state=excluded.current_state, current_sig=excluded.current_sig, checked_at=excluded.checked_at, '
        'facts_hash=excluded.facts_hash, angle=excluded.angle, model=excluded.model, prompt_version=excluded.prompt_version, '
        'run_id=excluded.run_id, generated_at=excluded.generated_at, updated_at=excluded.updated_at',
        (slot, group, 'ok', text, trade_date, f['asof'], f['state'], f['sig'], f['state'], f['sig'], stamp, f['hash'], angle,
         model, PROMPT_VERSION, run_id, stamp, stamp))
    conn.execute('INSERT INTO ai_comment_history(slot, trade_date, text, angle, sig, state, data_asof, generated_at, model, prompt_version, run_id, similarity) '
                 'VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                 (slot, trade_date, text, angle, f['sig'], f['state'], f['asof'], stamp, model, PROMPT_VERSION, run_id, sim))


def generate(conn, group, slots, facts_all, now, call_model=None, trigger='scheduled'):
    """slots 의 코멘트를 만들어 검증하고 통과한 것만 저장한다. 반환 요약 dict(outcome, accepted, rejected, calls, tokens ...)."""
    call_model = call_model or call_gas
    started = now
    trade_date = trade_date_for(now)
    session = {'tradeDate': trade_date, 'phase': market_clock.kr_market_phase(now)['phase'], 'now': _stamp(now)}
    histories = {s: recent_history(conn, s, trade_date) for s in slots}
    angles = {s: pick_angle(facts_all[s], histories[s]) for s in slots}
    accepted, rejected, feedback, soft = {}, {}, {}, {}
    usage = {'prompt': 0, 'completion': 0, 'total': 0}
    calls, model_name, error = 0, None, None
    began = time.time()
    pending = list(slots)
    for attempt in range(MAX_MODEL_CALLS):
        if not pending:
            break
        system, user = build_prompt(pending, facts_all, histories, angles, feedback, session)
        calls += 1
        try:
            resp = call_model(system, user)
        except ModelError as exc:
            error = str(exc)
            LOGGER.warning('AI 코멘트 모델 호출 실패(%s): %s', group, error)
            if not exc.retryable:
                break
            continue
        u = resp.get('usage') or {}
        usage['prompt'] += int(u.get('prompt_tokens') or 0)
        usage['completion'] += int(u.get('completion_tokens') or 0)
        usage['total'] += int(u.get('total_tokens') or (int(u.get('prompt_tokens') or 0) + int(u.get('completion_tokens') or 0)))
        model_name = resp.get('model') or model_name
        try:
            data = validator.parse_model_json(resp.get('content'))
        except ValueError as exc:
            error = '응답 해석 실패: %s' % exc
            for s in pending:
                feedback[s] = {'problems': ['JSON 형식 오류 - {"comments": {...}} 객체만 출력']}
            continue
        comments = data.get('comments') if isinstance(data.get('comments'), dict) else data
        still = []
        for slot in pending:
            text = comments.get(slot) if isinstance(comments, dict) else None
            recent_texts = [h['text'] for h in histories[slot]]
            res = validator.validate(facts_all[slot], text, recent_texts)
            if res.ok:
                accepted[slot] = (text.strip(), res.similarity)
                feedback.pop(slot, None)
                soft.pop(slot, None)
                continue
            only_similar = all(r.startswith('최근 14일 문장과 너무 비슷함') for r in res.reasons)
            if only_similar and res.similarity < validator.SIMILAR_HARD and isinstance(text, str):
                soft[slot] = (text.strip(), res.similarity)     # 다른 문제는 없고 반복만 문제: 재시도 뒤에도 남으면 가장 덜 비슷한 것을 쓴다
            feedback[slot] = {'previous': text if isinstance(text, str) else None, 'problems': res.reasons[:4]}
            still.append(slot)
        pending = still
    for slot in list(pending):
        if slot in soft:
            accepted[slot] = soft[slot]
            pending.remove(slot)
    for slot in pending:
        rejected[slot] = (feedback.get(slot) or {}).get('problems') or ([error] if error else ['미생성'])
    for slot, (text, sim) in accepted.items():
        _save_comment(conn, slot, facts_all[slot]['group'], facts_all[slot], text, angles.get(slot), model_name or MODEL_FALLBACK_NAME,
                      None, now, trade_date, sim)
    if accepted:
        outcome = 'partial' if rejected else 'ok'
    else:
        outcome = 'failed' if error else 'rejected'
    run_id = _log_run(conn, group, trade_date, trigger, started, outcome, calls, slots, list(accepted), rejected, usage,
                      int((time.time() - began) * 1000), model_name, error)
    for slot in accepted:
        conn.execute('UPDATE ai_comments SET run_id=? WHERE slot=?', (run_id, slot))
        conn.execute('UPDATE ai_comment_history SET run_id=? WHERE slot=? AND generated_at=?', (run_id, slot, _stamp(now)))
    _prune(conn, now)
    conn.commit()
    return {'group': group, 'outcome': outcome, 'accepted': list(accepted), 'rejected': rejected, 'calls': calls,
            'tokens': usage['total'], 'error': error, 'runId': run_id}


# ---- 점검 1회 -----------------------------------------------------------------------------------------

def run_cycle(conn, now, inputs, call_model=None, groups=GROUP_ORDER, trigger='scheduled', force=False):
    """모든 묶음의 사실을 계산하고, 바뀐 카드가 있고 호출 제한이 허용하면 코멘트를 만든다. 묶음별 결과 dict 를 돌려준다."""
    ensure_schema(conn)
    inputs = dict(inputs)
    inputs['now'] = now
    results = {}
    for group in groups:
        try:
            facts = facts_mod.group_facts(group, inputs)
        except Exception:
            LOGGER.exception('AI 코멘트 사실 계산 실패(%s)', group)
            results[group] = {'skipped': 'facts-error'}
            continue
        record_current(conn, group, facts, now)
        rows = get_rows(conn)
        needs = decide_needs(rows, facts)
        if not needs:
            results[group] = {'skipped': 'no-change'}
            continue
        why = gate(conn, group, now, needs, force)
        if why:
            results[group] = {'skipped': why, 'pending': [s for s, _, _ in needs]}
            continue
        slots = [s for s, _, _ in needs]
        # 요약 카드는 개별 카드가 바뀌면 같이 다시 쓴다(개별 카드와 요약이 어긋나지 않게)
        summary = {'brief': 'brief_summary', 'intraday': 'market_summary'}.get(group)
        if summary and summary in facts and summary not in slots and len(slots) >= 1:
            slots.append(summary)
        results[group] = generate(conn, group, slots, facts, now, call_model, trigger)
    return results


# ---- 입력 수집(운영) -----------------------------------------------------------------------------------

MACRO_SYMBOLS = ('SP500_INDEX', 'NASDAQ_INDEX', 'DOW_INDEX', 'SOX', 'VIX', 'USDKRW', 'US10Y', 'US30Y', 'WTI', 'BRENT', 'GOLD', 'BTC')


def load_macro(conn, now):
    """/futures 와 같은 저장 자료(DB)에서 심볼별 현재값+일봉을 읽는다. BRENT 는 /futures 와 같은 20분 stale 규칙."""
    prices = {p['symbol']: p for p in db_schema.load_all_future_prices(conn)}
    out = {}
    for sym in MACRO_SYMBOLS:
        p = prices.get(sym)
        row = {'symbol': sym, 'chart': db_schema.load_future_chart(conn, sym, limit_days=130), 'stale': False}
        if p:
            row.update({'price': p['price'], 'change_rate': p['change_rate'], 'updated_at': p['updated_at']})
            if sym == 'BRENT':
                try:
                    at = datetime.fromisoformat(str(p['updated_at']).replace('Z', '+00:00'))
                    row['stale'] = (now - at).total_seconds() > 20 * 60
                except (TypeError, ValueError):
                    row['stale'] = True
        out[sym] = row
    return out


def collect_inputs(conn, now, domestic=None, market_temp_result=None):
    import morning_briefing
    view = morning_briefing.current_view(conn, now)
    b = view.get('briefing')
    snapshot = b['snapshot'] if b and b.get('status') == 'final' and b.get('snapshot') else None
    option = {r['side']: r for r in db_schema.load_option_flow(conn)}
    return {'now': now, 'domestic': domestic, 'market_temp': market_temp_result, 'macro': load_macro(conn, now), 'option': option,
            'briefing': snapshot}


# ---- 조회(방문자·운영) ---------------------------------------------------------------------------------

POLES = frozenset(('up', 'down', 'buy', 'sell', 'put', 'call'))


def _contradicts(then, now_state):
    """코멘트를 만들 때 상태와 지금 상태가 서로 반대 극(상승↔하락·매수↔매도·풋↔콜)이면 코멘트를 숨긴다.
    보합·거래량 단계·혼조처럼 극이 아닌 변화는 숨기지 않고(서명이 바뀌면 다시 만든다) 오래된 코멘트로 남는다."""
    return then in POLES and now_state in POLES and then != now_state


def _visible(row, now, trade_date):
    """방문자에게 보여도 되는 코멘트인가. (보임, 숨김 사유)"""
    if row['status'] != 'ok' or not row['text']:
        return False, 'none'
    if row['current_state'] == MISSING:
        return False, 'data-missing'
    if _contradicts(row['state'], row['current_state']):
        return False, 'state-changed'
    at = _parse_stamp(row['generated_at'])
    if at is None or (now - at) > timedelta(days=MAX_AGE_DAYS.get(row['group_name'], 4)):
        return False, 'too-old'
    return True, None


def current_view(conn, now):
    """GET /ai-comments 본문. DB 읽기만 한다(AI 호출·계산 없음)."""
    ensure_schema(conn)
    trade_date = trade_date_for(now)
    comments, hidden = {}, {}
    for slot, row in get_rows(conn).items():
        ok, why = _visible(row, now, trade_date)
        if ok:
            comments[slot] = {'text': row['text'], 'group': row['group_name'], 'generatedAt': row['generated_at'],
                              'dataAsOf': row['data_asof'], 'tradeDate': row['trade_date'], 'model': row['model'],
                              'carried': bool(row['trade_date'] and row['trade_date'] < trade_date)}
        elif why != 'none':
            hidden[slot] = why
    return {'serverTime': _stamp(now), 'tradeDate': trade_date, 'promptVersion': PROMPT_VERSION, 'comments': comments, 'hidden': hidden}


def status_summary(conn, now):
    """/health/ai-comments 와 /health/schedules 의 internalJobs 에 붙는 요약(비밀 없음)."""
    ensure_schema(conn)
    calls, tokens = usage_today(conn, now)
    last = conn.execute('SELECT started_at, group_name, outcome, error FROM ai_comment_runs ORDER BY id DESC LIMIT 1').fetchone()
    ok = conn.execute("SELECT started_at FROM ai_comment_runs WHERE outcome IN ('ok','partial') ORDER BY id DESC LIMIT 1").fetchone()
    groups = {}
    for g in GROUP_ORDER:
        gc, gt = usage_today(conn, now, g)
        lr = conn.execute("SELECT started_at, outcome, slots_accepted, slots_rejected, error FROM ai_comment_runs WHERE group_name=? ORDER BY id DESC LIMIT 1", (g,)).fetchone()
        gok = conn.execute("SELECT started_at FROM ai_comment_runs WHERE group_name=? AND outcome IN ('ok','partial') ORDER BY id DESC LIMIT 1", (g,)).fetchone()
        groups[g] = {'callsToday': gc, 'tokensToday': gt, 'callCap': GROUP_DAILY_CALLS[g], 'lastSuccessAt': gok[0] if gok else None,
                     'lastRun': {'startedAt': lr[0], 'outcome': lr[1], 'accepted': lr[2], 'rejected': lr[3], 'error': lr[4]} if lr else None,
                     'consecutiveFailures': consecutive_failures(conn, g)}
    view = current_view(conn, now)
    state = '꺼짐' if not enabled() else ('오류' if last and last[2] in ('failed', 'rejected') and not (ok and ok[0] >= last[0]) else '정상' if ok else '대기')
    return {'id': 'ai-comments', 'name': 'AI 시장 코멘트', 'state': state, 'enabled': enabled(), 'promptVersion': PROMPT_VERSION,
            'callsToday': calls, 'tokensToday': tokens, 'dailyCallCap': DAILY_CALL_CAP, 'dailyTokenCap': DAILY_TOKEN_CAP,
            'lastSuccessAt': ok[0] if ok else None,
            'lastRun': {'startedAt': last[0], 'group': last[1], 'outcome': last[2], 'error': last[3]} if last else None,
            'visibleComments': len(view['comments']), 'hiddenComments': view['hidden'], 'groups': groups}


# ---- 백그라운드 ---------------------------------------------------------------------------------------

_started = False
_cycle_lock = threading.Lock()


def start_background(conn_factory, get_domestic, get_market_temp):
    """FastAPI 프로세스 안의 가벼운 스레드(별도 타이머·프로세스 없음). get_domestic/get_market_temp 는 이미 메모리에 있는 캐시를 돌려주는 함수."""
    global _started
    if _started:
        return
    _started = True

    def loop():
        time.sleep(90)          # 시작 직후에는 국내지표·증시온도 캐시가 데워질 때까지 기다린다
        while True:
            wait = 300
            try:
                now = market_clock.kst_now()
                phase = market_clock.kr_market_phase(now)['phase']
                wait = 120 if phase in ('open', 'post') else 300
                if enabled() and _cycle_lock.acquire(blocking=False):
                    try:
                        conn = conn_factory()
                        try:
                            res = run_cycle(conn, now, collect_inputs(conn, now, get_domestic(), get_market_temp()))
                            done = {g: r for g, r in res.items() if 'outcome' in r}
                            if done:
                                LOGGER.info('AI 코멘트 생성: %s', json.dumps(done, ensure_ascii=False)[:400])
                        finally:
                            conn.close()
                    finally:
                        _cycle_lock.release()
            except Exception:
                LOGGER.exception('AI 코멘트 점검 실패')
            time.sleep(wait)

    threading.Thread(target=loop, name='ai-comments', daemon=True).start()
    LOGGER.info('AI 시장 코멘트 스케줄러 시작(점검 2~5분, 호출은 의미 있는 상태 변화에서만, 하루 상한 %d회)', DAILY_CALL_CAP)


if __name__ == '__main__':   # 운영자 확인용: python ai_comments.py status | view | facts <group>
    import sys
    logging.basicConfig(level=logging.INFO)
    c = db_schema.get_conn()
    try:
        cmd = sys.argv[1] if len(sys.argv) > 1 else 'status'
        now_ = market_clock.kst_now()
        if cmd == 'status':
            print(json.dumps(status_summary(c, now_), ensure_ascii=False, indent=2))
        elif cmd == 'view':
            print(json.dumps(current_view(c, now_), ensure_ascii=False, indent=2))
        else:
            print(__doc__)
    finally:
        c.close()
