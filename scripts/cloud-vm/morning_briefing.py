# -*- coding: utf-8 -*-
"""시장 브리핑 - 국내 거래일 KST 07:00에 서버가 한 번 확정하는 '장 시작 전' 스냅샷 (2026-10-23).

왜 서버인가: 예전 '다음 거래일 전망'은 방문자 브라우저가 접속할 때마다 /futures 일봉으로 계산해서,
접속 시각·새로고침·장중 값에 따라 같은 날 결과가 바뀔 수 있었다. 이제 이 모듈이
  1) 국내 거래일 07:00(+재시도)에 미국 정규장 마감 지표와 코스피200 야간선물 최종 봉으로 신호를 계산하고
  2) 거래일(target_date)당 한 행으로 SQLite(morning_briefing)에 저장하며
  3) 한 번 'final'이 되면 그 거래일 동안 덮어쓰지 않는다(정정은 revise()만, 최초 확정 시각은 그대로).
프런트(js/market-temp.js)는 GET /morning-briefing 응답을 그리기만 한다.

계산식(7항/6항 z점수 합, 구간 경계, 통계 문구)은 js/market-temp.js 의 옛 tomorrowSignal_ 와 같다.
계산 근거와 표본(232거래일)은 그쪽 주석에 있었고, 숫자는 여기로 그대로 옮겼다 - 바꾸려면 재검증 후 같이 바꾼다.
test/test_morning_briefing.py 가 같은 입력으로 옛 JS 결과와 일치함을 확인한다.

실행: FastAPI 프로세스 안의 가벼운 스레드(start_background). 별도 systemd 타이머·프로세스를 만들지 않는다
(e2-micro 1GB, 배포 경로 변경 없음). 상태는 전부 DB에 있어 재시작해도 이어서 재시도한다.
요청 경로(GET /morning-briefing)는 DB를 읽기만 하고 계산하지 않는다.
"""
import json
import logging
import threading
import time
from datetime import datetime, timedelta, timezone

import db_schema
import market_clock

LOGGER = logging.getLogger('morning_briefing')
KST = timezone(timedelta(hours=9))

RUN_MINUTE = 7 * 60                  # 07:00 KST - 이 시각부터 생성을 시도한다
NIGHT_GRACE_UNTIL_MIN = 7 * 60 + 15  # 야간선물 최종 봉이 늦으면 07:15까지만 기다리고, 그 뒤엔 야간선물 없이 확정한다
HOLIDAY_ASSUME_MIN = 8 * 60 + 30     # 미국 휴장표에 없는 휴장 추정은 08:30 이후에만 허용한다
LATE_REVISE_UNTIL_MIN = 9 * 60       # 야간선물이 늦게 들어오면 개장(09:00) 전까지만 자동 정정한다
RETRY_BEFORE_OPEN_SEC = 5 * 60
RETRY_INTRADAY_SEC = 30 * 60
NIGHT_RECHECK_SEC = 5 * 60
RUN_KEEP = 600                       # morning_briefing_runs 보관 행 수
ROW_KEEP = 400                       # morning_briefing 보관 행 수(거래일 기준 약 1.5년)
FORMAT_VERSION = 1

# ---- 신호 모델(js/market-temp.js 옛 TOMORROW_* 상수 이식, 2026-10-23 232거래일 재검증값) -----------------
STATS7 = {
    'spx': (0.0751, 0.8105), 'nas': (0.0927, 1.1704), 'dji': (0.0638, 0.8084), 'sox': (0.294, 2.9111),
    'vix': (0.1618, 7.5683), 'fx': (-0.0377, 0.6251), 'night': (0.8621, 1.7382),
}
WEIGHTS7 = {'spx': 1 / 3, 'nas': 1 / 3, 'dji': 1 / 3, 'sox': 1, 'vix': 1, 'fx': 1, 'night': 1}
SIGN7 = {'spx': 1, 'nas': 1, 'dji': 1, 'sox': 1, 'vix': -1, 'fx': -1, 'night': 1}
BUCKETS7 = [
    {'max': -3.42, 'key': 'strongDown', 'label': '강한 하락 신호', 'gap': '시초 하락 출발 91%', 'close': '하락 마감 79%', 'n': 34, 'span': '최근 232일'},
    {'max': -1.73, 'key': 'down', 'label': '하락 우세', 'gap': '시초 하락 출발 86%', 'close': '하락 마감 51% · 장중 반등도 잦음', 'n': 35, 'span': '최근 232일'},
    {'max': 1.73, 'key': 'flat', 'label': '방향 모름', 'gap': '시초 상승 64%', 'close': '상승 마감 59%', 'n': 91, 'span': '최근 232일'},
    {'max': 3.42, 'key': 'up', 'label': '상승 우세', 'gap': '시초 상승 출발 93%', 'close': '상승 마감 78%', 'n': 41, 'span': '최근 232일'},
    {'max': 999, 'key': 'strongUp', 'label': '강한 상승 신호', 'gap': '시초 상승 출발 94%', 'close': '상승 마감 87%', 'n': 31, 'span': '최근 232일'},
]
BUCKETS6 = [
    {'max': -2.99, 'key': 'strongDown', 'label': '강한 하락 신호', 'gap': '시초 하락 출발 92%', 'close': '하락 마감 81%', 'n': 37, 'span': '최근 232일'},
    {'max': -1.51, 'key': 'down', 'label': '하락 우세', 'gap': '시초 하락 출발 81%', 'close': '하락 마감 38% · 장중 반등이 더 많음', 'n': 26, 'span': '최근 232일'},
    {'max': 1.51, 'key': 'flat', 'label': '방향 모름', 'gap': '시초 상승 64%', 'close': '상승 마감 59%', 'n': 96, 'span': '최근 232일'},
    {'max': 2.99, 'key': 'up', 'label': '상승 우세', 'gap': '시초 상승 출발 85%', 'close': '상승 마감 69%', 'n': 39, 'span': '최근 232일'},
    {'max': 999, 'key': 'strongUp', 'label': '강한 상승 신호', 'gap': '시초 상승 출발 91%', 'close': '상승 마감 88%', 'n': 34, 'span': '최근 232일'},
]
INPUTS = (  # (키, 화면 이름, /futures 심볼)
    ('spx', 'S&P 500', 'SP500_INDEX'),
    ('nas', '나스닥 종합', 'NASDAQ_INDEX'),
    ('dji', '다우존스', 'DOW_INDEX'),
    ('sox', '필라델피아 반도체', 'SOX'),
    ('vix', 'VIX', 'VIX'),
    ('fx', '원/달러', 'USDKRW'),
)
US_KEYS = ('spx', 'nas', 'dji', 'sox', 'vix')
WEEKDAY_KO = ('월', '화', '수', '목', '금', '토', '일')


def _stamp(dt):
    return dt.strftime('%Y-%m-%d %H:%M:%S')


def _label(day):
    return '%d/%d(%s)' % (day.month, day.day, WEEKDAY_KO[day.weekday()])


def _num(value):
    try:
        out = float(value)
    except (TypeError, ValueError):
        return 0.0
    return out if out == out else 0.0


def _ymd(day):
    return day.strftime('%Y%m%d')


# ---- 계산 -------------------------------------------------------------------------------------------

def last_return_before(chart, ymd):
    """ymd 이전에 끝난 가장 최근 일봉의 전일 대비 등락률(%) - 옛 lastReturnBefore_."""
    idx = -1
    for i, bar in enumerate(chart or []):
        if str(bar['date']) < ymd:
            idx = i
    if idx < 1:
        return None
    a, b = _num(chart[idx]['close']), _num(chart[idx - 1]['close'])
    if not a or not b:
        return None
    return {'pct': (a / b - 1) * 100, 'date': str(chart[idx]['date']), 'close': a, 'prevClose': b}


def night_signal(day_chart, night_chart, ymd, now_kst):
    """야간선물 신호 - 옛 nightSignal_. ymd 이전 마지막 주간 거래일 D의 야간 일봉(D 저녁~D+1 05:00)을 D 주간 종가와 비교한다."""
    if not day_chart or not night_chart:
        return None
    d_bar = None
    for bar in day_chart:
        if str(bar['date']) < ymd:
            d_bar = bar
    if d_bar is None:
        return None
    n_bar = None
    for bar in night_chart:
        if str(bar['date']) == str(d_bar['date']):
            n_bar = bar
    d_close = _num(d_bar['close'])
    n_close = _num(n_bar['close']) if n_bar else 0.0
    if not d_close > 0 or not n_close > 0:
        return None
    text = str(d_bar['date'])
    try:
        session_day = datetime(int(text[:4]), int(text[4:6]), int(text[6:8]), tzinfo=KST)
    except ValueError:
        return None
    end = session_day + timedelta(days=1, hours=5, minutes=5)   # D 다음 날 05:05 KST 이후에야 야간 세션이 끝난 것으로 본다
    return {'gap': (n_close / d_close - 1) * 100, 'date': text, 'pending': now_kst < end,
            'close': n_close, 'dayClose': d_close, 'sessionEnd': _stamp(end)}


def score_signal(vals):
    """vals: {키: 등락률%}. night 키가 있으면 7항, 없으면 6항 - 옛 tomorrowSignal_ 의 합산·구간 선택."""
    zsum = 0.0
    for key, value in vals.items():
        mean, sd = STATS7[key]
        zsum += WEIGHTS7[key] * SIGN7[key] * (value - mean) / sd
    buckets = BUCKETS7 if 'night' in vals else BUCKETS6
    bucket = next((b for b in buckets if zsum < b['max']), buckets[2])   # NaN이면 가운데 구간(옛 코드와 같다)
    return zsum, bucket


def compute(conn, target, now_kst, night_grace=True):
    """target(date)의 브리핑 계산. 반환:
    {'ok': True, 'snapshot': {...}}                       - 확정 가능
    {'ok': False, 'code': 'inputs'|'night-wait', 'reason': 문자열}  - 아직 못 만듦(재시도 대상)
    DB는 읽기만 한다.
    """
    ymd = _ymd(target)
    us_date, skipped = market_clock.us_session_before_kr_day(target)
    us_ymd = _ymd(us_date)
    fx_expected = _ymd(market_clock.prev_kr_trading_day(target))
    day_min = now_kst.hour * 60 + now_kst.minute if now_kst.date() == target else None
    charts = {sym: db_schema.load_future_chart(conn, sym, limit_days=120) for _, _, sym in INPUTS}
    charts['KOSPI200_DAY'] = db_schema.load_future_chart(conn, 'KOSPI200_DAY', limit_days=120)
    charts['KOSPI200_NIGHT'] = db_schema.load_future_chart(conn, 'KOSPI200_NIGHT', limit_days=120)

    returns, names, problems = {}, {}, []
    for key, name, sym in INPUTS:
        names[key] = name
        returns[key] = last_return_before(charts[sym], ymd)
        if returns[key] is None:
            problems.append('%s 일봉 없음' % name)
    holiday_assumed = None
    us_stale = [k for k in US_KEYS if returns[k] and returns[k]['date'] != us_ymd]
    if us_stale and len(us_stale) == len(US_KEYS):
        dates = {returns[k]['date'] for k in US_KEYS}
        # 미국 휴장표에 없는 휴장일: 다섯 미국 지표가 모두 같은 옛 날짜에 멈춰 있으면 휴장으로 보고 그 날짜 종가로 확정한다(08:30 이후).
        # 건너뛴 것이 정확히 미국 거래일 하루(직전 미국 거래일에 멈춤)일 때만 허용한다 - 며칠 묵은 수집 장애를 휴장으로 덮지 않는다.
        before = us_date - timedelta(days=1)
        while not market_clock.is_us_trading_day(before):
            before -= timedelta(days=1)
        if len(dates) == 1 and day_min is not None and day_min >= HOLIDAY_ASSUME_MIN and next(iter(dates)) == _ymd(before):
            holiday_assumed = next(iter(dates))
            us_stale = []
    for key in us_stale:
        problems.append('%s 최신 일봉 %s (기대 %s)' % (names[key], returns[key]['date'], us_ymd))
    if returns['fx'] and returns['fx']['date'] < fx_expected:
        problems.append('원/달러 최신 일봉 %s (기대 %s 이후)' % (returns['fx']['date'], fx_expected))
    if problems:
        return {'ok': False, 'code': 'inputs', 'reason': '; '.join(problems)}

    night = night_signal(charts['KOSPI200_DAY'], charts['KOSPI200_NIGHT'], ymd, now_kst)
    night_info = {'included': False, 'reason': 'missing'}
    vals = {k: returns[k]['pct'] for k in ('spx', 'nas', 'dji', 'sox', 'vix', 'fx')}
    if night and not night['pending']:
        night_info = {'included': True, 'sessionDate': night['date'], 'sessionEnd': night['sessionEnd'],
                      'close': night['close'], 'dayClose': night['dayClose'], 'gapPct': night['gap'],
                      'change': night['close'] - night['dayClose']}
        vals['night'] = night['gap']
    elif night:
        night_info = {'included': False, 'reason': 'session-open', 'sessionDate': night['date'], 'sessionEnd': night['sessionEnd']}
    elif night_grace and day_min is not None and day_min < NIGHT_GRACE_UNTIL_MIN:
        return {'ok': False, 'code': 'night-wait', 'reason': '코스피200 야간선물 최종 봉 대기'}
    zsum, bucket = score_signal(vals)
    tone = 'up' if 'up' in bucket['key'].lower() else 'down' if 'down' in bucket['key'].lower() else 'flat'
    snapshot = {
        'version': FORMAT_VERSION,
        'targetDate': target.strftime('%Y-%m-%d'),
        'targetLabel': _label(target),
        'usSessionDate': us_ymd if not holiday_assumed else holiday_assumed,
        'usHoliday': ([{'date': d.strftime('%Y-%m-%d'), 'name': n} for d, n in skipped] or None),
        'usHolidayAssumed': holiday_assumed,
        'inputs': {k: {'name': names[k], 'pct': returns[k]['pct'], 'date': returns[k]['date'],
                       'close': returns[k]['close'], 'prevClose': returns[k]['prevClose']} for k in names},
        'night': night_info,
        'signal': {'zsum': zsum, 'model': 7 if 'night' in vals else 6, 'tone': tone,
                   'bucket': {k: bucket[k] for k in ('key', 'label', 'gap', 'close', 'n', 'span')}},
    }
    return {'ok': True, 'snapshot': snapshot}


# ---- 저장 -------------------------------------------------------------------------------------------

def ensure_schema(conn):
    try:
        conn.execute('SELECT 1 FROM morning_briefing LIMIT 0')
        conn.execute('SELECT 1 FROM morning_briefing_runs LIMIT 0')
    except Exception:
        db_schema.create_schema(conn)


def get_row(conn, target_str):
    cur = conn.execute('SELECT target_date, status, snapshot_json, us_session_date, scheduled_at, first_confirmed_at, '
                       'revised_at, revision, revisions_json, attempts, last_attempt_at, next_retry_at, last_error '
                       'FROM morning_briefing WHERE target_date=?', (target_str,))
    r = cur.fetchone()
    if not r:
        return None
    return {'target_date': r[0], 'status': r[1], 'snapshot': json.loads(r[2]) if r[2] else None,
            'us_session_date': r[3], 'scheduled_at': r[4], 'first_confirmed_at': r[5], 'revised_at': r[6],
            'revision': r[7], 'revisions': json.loads(r[8]) if r[8] else [], 'attempts': r[9],
            'last_attempt_at': r[10], 'next_retry_at': r[11], 'last_error': r[12]}


def _log_run(conn, target_str, started, trigger, outcome, detail):
    conn.execute('INSERT INTO morning_briefing_runs(target_date, started_at, finished_at, trigger, outcome, detail) '
                 'VALUES (?,?,?,?,?,?)', (target_str, _stamp(started), _stamp(datetime.now(KST)), trigger, outcome,
                                          (detail or '')[:500]))
    conn.execute('DELETE FROM morning_briefing_runs WHERE id NOT IN (SELECT id FROM morning_briefing_runs ORDER BY id DESC LIMIT ?)',
                 (RUN_KEEP,))


def _prune(conn):
    conn.execute('DELETE FROM morning_briefing WHERE target_date NOT IN '
                 '(SELECT target_date FROM morning_briefing ORDER BY target_date DESC LIMIT ?)', (ROW_KEEP,))


def _retry_after(now_kst, target):
    if now_kst.date() != target:
        return None          # 수동으로 지난 거래일을 시도한 경우: 스케줄러는 오늘만 재시도하므로 pending으로 남기지 않는다
    close_min = market_clock.kr_session_minutes(target)[1]
    minutes = now_kst.hour * 60 + now_kst.minute
    if minutes >= close_min:
        return None
    sec = RETRY_BEFORE_OPEN_SEC if minutes < market_clock.kr_session_minutes(target)[0] else RETRY_INTRADAY_SEC
    return now_kst + timedelta(seconds=sec)


def attempt(conn, target, now_kst, trigger='scheduled'):
    """한 번 시도한다. final 행은 건드리지 않는다. 반환: 갱신된 행(dict)."""
    ensure_schema(conn)
    target_str = target.strftime('%Y-%m-%d')
    row = get_row(conn, target_str)
    if row and row['status'] == 'final':
        return row
    started = now_kst
    scheduled = _stamp(datetime(target.year, target.month, target.day, 7, 0, tzinfo=KST))
    try:
        result = compute(conn, target, now_kst)
    except Exception as exc:    # 계산 중 예외도 재시도 대상으로 남긴다(원인은 runs/last_error)
        LOGGER.exception('시장 브리핑 계산 예외 %s', target_str)
        result = {'ok': False, 'code': 'error', 'reason': '계산 오류: %s' % type(exc).__name__}
    attempts = (row['attempts'] if row else 0) + 1
    now_s = _stamp(now_kst)
    if result['ok']:
        snap = result['snapshot']
        conn.execute(
            'INSERT INTO morning_briefing(target_date, status, snapshot_json, us_session_date, scheduled_at, first_confirmed_at, '
            'attempts, last_attempt_at, next_retry_at, last_error, created_at, updated_at) '
            "VALUES (?,?,?,?,?,?,?,?,NULL,NULL,?,?) ON CONFLICT(target_date) DO UPDATE SET status='final', "
            'snapshot_json=excluded.snapshot_json, us_session_date=excluded.us_session_date, '
            'first_confirmed_at=excluded.first_confirmed_at, attempts=excluded.attempts, '
            'last_attempt_at=excluded.last_attempt_at, next_retry_at=NULL, last_error=NULL, updated_at=excluded.updated_at',
            (target_str, 'final', json.dumps(snap, ensure_ascii=False), snap['usSessionDate'], scheduled, now_s,
             attempts, now_s, now_s, now_s))
        outcome, detail = 'final', '%s · 야간선물 %s' % (snap['signal']['bucket']['label'], '반영' if snap['night']['included'] else '미반영')
        LOGGER.info('시장 브리핑 확정 %s (%s) 시도 %d회', target_str, detail, attempts)
    else:
        retry_at = _retry_after(now_kst, target)
        status = 'pending' if retry_at else 'failed'
        conn.execute(
            'INSERT INTO morning_briefing(target_date, status, scheduled_at, attempts, last_attempt_at, next_retry_at, last_error, '
            'created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(target_date) DO UPDATE SET status=excluded.status, '
            'attempts=excluded.attempts, last_attempt_at=excluded.last_attempt_at, next_retry_at=excluded.next_retry_at, '
            'last_error=excluded.last_error, updated_at=excluded.updated_at',
            (target_str, status, scheduled, attempts, now_s, _stamp(retry_at) if retry_at else None,
             result['reason'][:300], now_s, now_s))
        outcome, detail = status, result['reason']
        (LOGGER.warning if status == 'failed' else LOGGER.info)('시장 브리핑 미확정 %s (%s) 시도 %d회', target_str, result['reason'], attempts)
    _log_run(conn, target_str, started, trigger, outcome, detail)
    _prune(conn)
    conn.commit()
    return get_row(conn, target_str)


def revise(conn, target, now_kst, reason):
    """확정된 브리핑을 정정한다(최초 확정 시각은 유지, 정정 시각·이력 기록). 확정 전이면 일반 시도와 같다."""
    ensure_schema(conn)
    target_str = target.strftime('%Y-%m-%d')
    row = get_row(conn, target_str)
    if not row or row['status'] != 'final':
        return attempt(conn, target, now_kst, trigger='manual')
    result = compute(conn, target, now_kst, night_grace=False)
    if not result['ok']:
        _log_run(conn, target_str, now_kst, 'revise', 'revise-failed', result['reason'])
        conn.commit()
        return row
    before = row['snapshot']
    entry = {'at': _stamp(now_kst), 'reason': reason,
             'before': {'bucketKey': before['signal']['bucket']['key'], 'bucketLabel': before['signal']['bucket']['label'],
                        'zsum': before['signal']['zsum'], 'model': before['signal']['model'],
                        'nightIncluded': before['night']['included']}}
    history = (row['revisions'] or []) + [entry]
    conn.execute('UPDATE morning_briefing SET snapshot_json=?, us_session_date=?, revised_at=?, revision=revision+1, '
                 'revisions_json=?, next_retry_at=NULL, updated_at=? WHERE target_date=?',
                 (json.dumps(result['snapshot'], ensure_ascii=False), result['snapshot']['usSessionDate'], _stamp(now_kst),
                  json.dumps(history, ensure_ascii=False), _stamp(now_kst), target_str))
    _log_run(conn, target_str, now_kst, 'revise', 'revised', reason)
    conn.commit()
    LOGGER.warning('시장 브리핑 정정 %s: %s', target_str, reason)
    return get_row(conn, target_str)


def run_due(conn, now_kst):
    """스케줄러 한 번 점검. 반환: (동작 문자열, 다음 점검까지 권장 대기 초)."""
    ensure_schema(conn)
    if not market_clock.is_kr_trading_day(now_kst):
        return 'holiday', 1800
    target = now_kst.date()
    target_str = target.strftime('%Y-%m-%d')
    minutes = now_kst.hour * 60 + now_kst.minute
    if minutes < RUN_MINUTE:
        return 'waiting', min(300, (RUN_MINUTE - minutes) * 60)
    row = get_row(conn, target_str)
    close_min = market_clock.kr_session_minutes(target)[1]
    if row and row['status'] == 'final':
        snap = row['snapshot'] or {}
        night_missing = not (snap.get('night') or {}).get('included') and (snap.get('night') or {}).get('reason') == 'missing'
        if night_missing and minutes < LATE_REVISE_UNTIL_MIN:
            due = row['next_retry_at']
            if due is None or due <= _stamp(now_kst):
                conn.execute('UPDATE morning_briefing SET next_retry_at=? WHERE target_date=?',
                             (_stamp(now_kst + timedelta(seconds=NIGHT_RECHECK_SEC)), target_str))
                conn.commit()
                after = revise_if_night_arrived(conn, target, now_kst)
                return ('revised' if after else 'night-recheck'), NIGHT_RECHECK_SEC
            return 'night-recheck-wait', 60
        return 'done', 600
    if row and row['status'] == 'failed':
        return 'failed', 1800
    if row and row['next_retry_at'] and row['next_retry_at'] > _stamp(now_kst):
        return 'retry-wait', 60
    if minutes >= close_min:
        # 장이 끝난 뒤에는 새로 만들지 않는다(07:00 브리핑이 아니라 소급 생성이 되므로). 상태만 남긴다.
        now_s = _stamp(now_kst)
        scheduled = _stamp(datetime(target.year, target.month, target.day, 7, 0, tzinfo=KST))
        conn.execute("INSERT INTO morning_briefing(target_date, status, scheduled_at, attempts, last_error, created_at, updated_at) "
                     "VALUES (?, 'failed', ?, 0, ?, ?, ?) ON CONFLICT(target_date) DO UPDATE SET status='failed', "
                     "last_error=COALESCE(morning_briefing.last_error, excluded.last_error), updated_at=excluded.updated_at",
                     (target_str, scheduled, '장 마감 전에 생성하지 못함', now_s, now_s))
        _log_run(conn, target_str, now_kst, 'scheduled', 'failed', '장 마감 전에 생성하지 못함')
        conn.commit()
        return 'failed', 1800
    updated = attempt(conn, target, now_kst)
    return updated['status'], 60


def revise_if_night_arrived(conn, target, now_kst):
    """야간선물 없이 확정된 브리핑에 야간선물 최종 봉이 나중에 들어왔으면 한 번 정정한다."""
    result = compute(conn, target, now_kst, night_grace=False)
    if result['ok'] and result['snapshot']['night']['included']:
        revise(conn, target, now_kst, '야간선물 최종 봉 확보 후 반영')
        return True
    return False


# ---- 조회(API) --------------------------------------------------------------------------------------

def _row_view(row, now_kst):
    snap = row.get('snapshot')
    return {
        'targetDate': row['target_date'],
        'targetLabel': _label(datetime.strptime(row['target_date'], '%Y-%m-%d').date()),
        'status': row['status'],
        'scheduledAt': row['scheduled_at'],
        'firstConfirmedAt': row['first_confirmed_at'],
        'revisedAt': row['revised_at'],
        'revision': row['revision'],
        'revisions': row['revisions'],
        'attempts': row['attempts'],
        'lastAttemptAt': row['last_attempt_at'],
        'nextRetryAt': row['next_retry_at'] if row['status'] == 'pending' else None,
        'lastError': row['last_error'] if row['status'] != 'final' else None,
        'snapshot': snap,
    }


def _placeholder(target, status, now_kst, error=None):
    return {'targetDate': target.strftime('%Y-%m-%d'), 'targetLabel': _label(target), 'status': status,
            'scheduledAt': _stamp(datetime(target.year, target.month, target.day, 7, 0, tzinfo=KST)),
            'firstConfirmedAt': None, 'revisedAt': None, 'revision': 0, 'revisions': [], 'attempts': 0,
            'lastAttemptAt': None, 'nextRetryAt': None, 'lastError': error, 'snapshot': None}


def current_view(conn, now_kst, date_str=None):
    """GET /morning-briefing 본문. DB 읽기만 한다(계산·외부 호출 없음).

    기본 선택: 오늘이 거래일이고 07:00이 지났으면 오늘 행(확정 전이면 pending/failed 상태 그대로),
    그 외(휴장일·07:00 전)에는 가장 최근에 확정된 이전 거래일 행. date를 주면 그 날짜 행.
    """
    ensure_schema(conn)
    today = now_kst.date()
    minutes = now_kst.hour * 60 + now_kst.minute
    phase = market_clock.kr_market_phase(now_kst)
    trading = phase['tradingDay']
    next_day = today if trading and minutes < RUN_MINUTE else market_clock.next_kr_trading_day(today)
    chosen = None
    if date_str:
        try:
            wanted = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            wanted = None
        row = get_row(conn, date_str) if wanted else None
        chosen = _row_view(row, now_kst) if row else None
    elif trading and minutes >= RUN_MINUTE:
        row = get_row(conn, today.strftime('%Y-%m-%d'))
        if row:
            chosen = _row_view(row, now_kst)
        else:
            close_min = phase['closeMin']
            chosen = _placeholder(today, 'pending' if minutes < close_min else 'failed', now_kst,
                                  None if minutes < close_min else '장 마감 전에 생성하지 못함')
    else:
        r = conn.execute("SELECT target_date FROM morning_briefing WHERE status='final' AND target_date<? "
                         'ORDER BY target_date DESC LIMIT 1', (today.strftime('%Y-%m-%d'),)).fetchone()
        if r:
            chosen = _row_view(get_row(conn, r[0]), now_kst)
    open_min, close_min = phase['openMin'], phase['closeMin']
    return {
        'serverTime': _stamp(now_kst),
        'today': today.strftime('%Y-%m-%d'),
        'session': {'phase': phase['phase'], 'tradingDay': trading,
                    'openAt': '%02d:%02d' % divmod(open_min, 60), 'closeAt': '%02d:%02d' % divmod(close_min, 60),
                    'postCloseMinutes': market_clock.KR_POST_CLOSE_MIN,
                    'nextTradingDay': market_clock.next_kr_trading_day(today).strftime('%Y-%m-%d')},
        'briefing': chosen,
        'next': {'targetDate': next_day.strftime('%Y-%m-%d'), 'targetLabel': _label(next_day),
                 'scheduledAt': _stamp(datetime(next_day.year, next_day.month, next_day.day, 7, 0, tzinfo=KST))},
    }


def status_summary(conn, now_kst):
    """/health/schedules 에 붙이는 요약(비밀 없음): 마지막 실행과 오늘 상태."""
    ensure_schema(conn)
    today = now_kst.date().strftime('%Y-%m-%d')
    row = get_row(conn, today)
    last = conn.execute('SELECT target_date, started_at, outcome FROM morning_briefing_runs ORDER BY id DESC LIMIT 1').fetchone()
    final = conn.execute("SELECT target_date, first_confirmed_at FROM morning_briefing WHERE status='final' "
                         'ORDER BY target_date DESC LIMIT 1').fetchone()
    trading = market_clock.is_kr_trading_day(now_kst)
    if not trading:
        state = '휴장'
    elif row and row['status'] == 'final':
        state = '정상'
    elif now_kst.hour * 60 + now_kst.minute < RUN_MINUTE:
        state = '대기'
    elif row and row['status'] == 'failed':
        state = '오류'
    else:
        state = '미확정'
    nxt = today if trading and now_kst.hour * 60 + now_kst.minute < RUN_MINUTE else None
    if nxt is None:
        d = market_clock.next_kr_trading_day(now_kst.date())
        nxt = d.strftime('%Y-%m-%d')
    return {'id': 'morning-briefing', 'name': '시장 브리핑(07:00 확정)', 'state': state,
            'todayStatus': row['status'] if row else None, 'attempts': row['attempts'] if row else 0,
            'lastSuccessAt': final[1] if final else None, 'lastSuccessTarget': final[0] if final else None,
            'lastRun': {'target': last[0], 'startedAt': last[1], 'outcome': last[2]} if last else None,
            'nextRunAt': nxt + ' 07:00:00'}


# ---- 백그라운드 --------------------------------------------------------------------------------------

_started = False


def start_background(conn_factory):
    """FastAPI 프로세스 안의 점검 스레드. 상태가 DB에 있어 재시작해도 이어간다."""
    global _started
    if _started:
        return
    _started = True

    def loop():
        while True:
            wait = 60
            try:
                conn = conn_factory()
                try:
                    _, wait = run_due(conn, market_clock.kst_now())
                finally:
                    conn.close()
            except Exception:
                LOGGER.exception('시장 브리핑 스케줄 점검 실패')
            time.sleep(max(15, min(wait, 600)))

    threading.Thread(target=loop, name='morning-briefing', daemon=True).start()
    LOGGER.info('시장 브리핑 스케줄러 시작(거래일 07:00 확정, 실패 시 %d초 간격 재시도)', RETRY_BEFORE_OPEN_SEC)


if __name__ == '__main__':   # 수동 복구용: python morning_briefing.py status | run YYYY-MM-DD | revise YYYY-MM-DD 사유
    import sys
    logging.basicConfig(level=logging.INFO)
    c = db_schema.get_conn()
    try:
        cmd = sys.argv[1] if len(sys.argv) > 1 else 'status'
        now = market_clock.kst_now()
        if cmd == 'status':
            print(json.dumps(status_summary(c, now), ensure_ascii=False, indent=2))
        elif cmd in ('run', 'revise') and len(sys.argv) > 2:
            day = datetime.strptime(sys.argv[2], '%Y-%m-%d').date()
            row = revise(c, day, now, ' '.join(sys.argv[3:]) or '수동 정정') if cmd == 'revise' else attempt(c, day, now, 'manual')
            print(json.dumps(_row_view(row, now), ensure_ascii=False, indent=2))
        else:
            print(__doc__)
    finally:
        c.close()
