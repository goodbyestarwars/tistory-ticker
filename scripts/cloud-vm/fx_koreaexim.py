# -*- coding: utf-8 -*-
"""한국수출입은행 환율정보(일별 공식 고시환율) 수집·저장·조회 (2026-10-11).

성격: 한국수출입은행이 영업일마다 고시하는 **일별 환율**이다. 실시간 시장환율(네이버·글로벌 시장지표의 원/달러)이 아니다.
출처: 한국수출입은행 환율정보 Open API (https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON, data=AP01 일반 고시환율).
  공공데이터포털 표기 이용허락범위는 '제한 없음'. 요청 도메인은 2025-06-25 www.koreaexim.go.kr → oapi.koreaexim.go.kr 로 바뀌었다.

실측으로 확인한 응답 형식(2026-10-11, 운영 VM·로컬 모두 같음)
- HTTP 200 + JSON 배열. 영업일: 23개 통화 행, 모든 행 result=1. 공휴일·주말: 빈 배열 `[]`(오류 아님). 잘못된 인증키: result=3 + 값 전부 null.
- 값은 **쉼표가 들어간 문자열**("1,339.2")이다. cur_unit 은 'USD' 처럼 1단위이거나 'JPY(100)'·'IDR(100)' 처럼 **100단위 기준**이다 - 1단위로 환산해 보여 주지 않는다.
- 위안화는 'CNY' 가 아니라 'CNH'(cur_nm '위안화')로 내려온다. 'KRW' 행(deal_bas_r=1, ttb/tts=0)은 외화가 아니라 저장하지 않는다.
- 결과 코드: 1 성공, 3 인증코드 오류(실측). 2(DATA 코드 오류)·4(일일 제한 횟수 마감)는 공식 안내 기준이며 이 저장소에서 응답을 본 적은 없다.
  일일 호출 한도의 숫자는 공표되지 않았다 -> 하루 호출 수를 스스로 제한(KOREAEXIM_DAILY_BUDGET, 기본 300)하고 result=4 가 오면 그날은 멈춘다.

수집 규칙(e2-micro 보호: 별도 프로세스·타이머 없이 FastAPI 안의 가벼운 스레드 1개, 요청 경로에서는 외부 호출 없음)
- 인증키는 서버 환경변수 KOREAEXIM_API_KEY(.env)에서만 읽는다. 응답·로그·예외 문구에 키를 넣지 않는다. 서비스 재시작 없이 .env 에 넣어도 다음 주기에 읽는다.
- 영업일(월~금) 11:00 KST 이후에 그날 고시를 확인한다. 아직 공개 전이면 빈 배열이 오므로 11~13시 10분, 이후 1시간 간격으로 재시도한다(23:30까지).
  공휴일은 계속 빈 배열이라 그날은 비어 있는 채로 남고, 화면은 직전 정상 고시일 값을 유지한다.
- 과거 날짜는 한 번 받으면 다시 호출하지 않는다(fx_dates 에 결과 기록). 주말은 호출하지 않는다. 처음에는 최근 380일을 최신순으로 채운다(약 270회, 하루 예산 안).
- 같은 날 확인한 빈 응답은 '확정'이 아니다. 다음 날 한 번 더 확인해 공휴일이면 확정 처리한다(늦은 공개·VM 중단 보정).
"""

import json
import logging
import math
import os
import re
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

logger = logging.getLogger('fx_koreaexim')

KST = timezone(timedelta(hours=9))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, 'fx_koreaexim.db')
API_URL = 'https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON'
ENV_KEY = 'KOREAEXIM_API_KEY'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

WINDOW_DAYS = 380            # 보관·표시 범위(1년 차트 366일 + 여유)
PUBLISH_HOUR = 11            # 영업일 이 시각 이후에 그날 고시를 확인한다(KST)
MAX_PER_CYCLE = 25
THROTTLE_SEC = 1.0
TODAY_RETRY_EARLY_SEC = 600  # 11~13시
TODAY_RETRY_LATE_SEC = 3600  # 13시 이후
TODAY_RETRY_END_MIN = 23 * 60 + 30
IDLE_SEC = 1800
NO_KEY_SEC = 900
ERROR_BACKOFF_SEC = 300
AUTH_BACKOFF_SEC = 3600
BACKFILL_SEC = 20
DEFAULT_BUDGET = 300
CACHE_TTL_SEC = 30

OFFICIAL_NOTICE = ('한국수출입은행이 영업일마다 고시하는 일별 공식 환율(매매기준율)입니다. 실시간 시장환율이 아니며, '
                   '주말·공휴일에는 직전 정상 고시일 값을 유지합니다.')
FEATURED = ('USD', 'JPY', 'EUR', 'CNH', 'GBP', 'CHF')
SECONDARY = ('AUD', 'CAD', 'HKD', 'SGD', 'NZD')
_CUR_RE = re.compile(r'^([A-Z]{3})(?:\((\d+)\))?$')
_CODE_RE = re.compile(r'^[A-Z]{3}$')
RANGES = {'1m': 31, '3m': 92, '1y': 366}

SCHEMA = """
CREATE TABLE IF NOT EXISTS fx_rates (
  rate_date TEXT NOT NULL, cur_unit TEXT NOT NULL, cur_code TEXT NOT NULL, unit INTEGER NOT NULL, cur_nm TEXT,
  deal_bas_r REAL NOT NULL, ttb REAL, tts REAL, bkpr REAL, kftc_deal_bas_r REAL, kftc_bkpr REAL, yy_efee_r REAL, ten_dd_efee_r REAL,
  fetched_at TEXT NOT NULL, PRIMARY KEY (rate_date, cur_unit));
CREATE INDEX IF NOT EXISTS fx_rates_code ON fx_rates(cur_code, rate_date);
CREATE TABLE IF NOT EXISTS fx_dates (
  rate_date TEXT PRIMARY KEY, status TEXT NOT NULL, rows INTEGER NOT NULL DEFAULT 0, checked_at TEXT NOT NULL, final INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS fx_meta (key TEXT PRIMARY KEY, value TEXT);
"""


# ---- 기본 도구 -----------------------------------------------------------------
def kst_now():
    return datetime.now(KST)


def connect(db_file=None):
    conn = sqlite3.connect(db_file or DB_FILE, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA busy_timeout=30000')
    return conn


_schema_ready = set()


def ensure_schema(db_file=None):
    """DB 파일마다 프로세스당 한 번만 스키마를 만든다(요청 경로에서 DDL 을 반복하지 않는다)."""
    path = db_file or DB_FILE
    if path in _schema_ready:
        return
    conn = connect(path)
    try:
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()
    _schema_ready.add(path)


def get_meta(conn, key, default=None):
    row = conn.execute('SELECT value FROM fx_meta WHERE key=?', (key,)).fetchone()
    return row[0] if row else default


def set_meta(conn, key, value):
    conn.execute('INSERT INTO fx_meta(key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, str(value)))


def api_key(env=None, env_file=None):
    """서버 환경변수 → (없으면) 스크립트 옆 .env 에서 읽는다. main.load_dotenv 는 시작할 때 한 번만 읽으므로,
    재시작 없이 .env 에 키를 넣어도 동작하게 파일을 다시 본다. 키 값은 어디에도 기록하지 않는다."""
    env = os.environ if env is None else env
    key = (env.get(ENV_KEY) or '').strip()
    if key:
        return key
    path = env_file or os.path.join(BASE_DIR, '.env')
    try:
        with open(path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line.startswith(ENV_KEY + '='):
                    return line.split('=', 1)[1].strip().strip('"').strip("'").strip() or None
    except OSError:
        pass
    return None


def daily_budget(env=None):
    env = os.environ if env is None else env
    try:
        value = int(env.get('KOREAEXIM_DAILY_BUDGET') or DEFAULT_BUDGET)
    except ValueError:
        value = DEFAULT_BUDGET
    return max(10, min(value, 900))


# ---- 응답 해석 ------------------------------------------------------------------
def parse_cur_unit(text):
    """'USD' → ('USD', 1), 'JPY(100)' → ('JPY', 100). 형식이 다르면 None."""
    m = _CUR_RE.match(str(text or '').strip())
    if not m:
        return None
    unit = int(m.group(2)) if m.group(2) else 1
    return (m.group(1), unit) if unit > 0 else None


def parse_number(value):
    """'1,339.2' → 1339.2. 비어 있거나 0·음수·비수치면 None(0은 'KRW 행의 송금환율'처럼 값이 없다는 뜻)."""
    if value is None:
        return None
    text = str(value).replace(',', '').strip()
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    return number if math.isfinite(number) and number > 0 else None


def parse_rows(payload):
    """result=1 인 행만 저장 대상으로 바꾼다. KRW 와 매매기준율이 없는 행은 건너뛴다."""
    rows = []
    for item in payload:
        if not isinstance(item, dict) or item.get('result') != 1:
            continue
        parsed = parse_cur_unit(item.get('cur_unit'))
        deal = parse_number(item.get('deal_bas_r'))
        if not parsed or parsed[0] == 'KRW' or deal is None:
            continue
        code, unit = parsed
        rows.append({'cur_unit': str(item['cur_unit']).strip(), 'cur_code': code, 'unit': unit, 'cur_nm': str(item.get('cur_nm') or '').strip(),
                     'deal_bas_r': deal, 'ttb': parse_number(item.get('ttb')), 'tts': parse_number(item.get('tts')), 'bkpr': parse_number(item.get('bkpr')),
                     'kftc_deal_bas_r': parse_number(item.get('kftc_deal_bas_r')), 'kftc_bkpr': parse_number(item.get('kftc_bkpr')),
                     'yy_efee_r': parse_number(item.get('yy_efee_r')), 'ten_dd_efee_r': parse_number(item.get('ten_dd_efee_r'))})
    return rows


def classify(payload):
    """응답 JSON → {'outcome': ok|empty|auth|quota|bad_request|error|format, 'rows': [...]}."""
    if not isinstance(payload, list):
        return {'outcome': 'format', 'detail': '응답이 배열이 아님'}
    if not payload:
        return {'outcome': 'empty'}
    codes = {item.get('result') for item in payload if isinstance(item, dict)}
    if codes == {1}:
        rows = parse_rows(payload)
        return {'outcome': 'ok', 'rows': rows} if rows else {'outcome': 'format', 'detail': '해석 가능한 행 없음'}
    bad = sorted(c for c in codes if c != 1 and c is not None)
    code = bad[0] if bad else None
    return {'outcome': {2: 'bad_request', 3: 'auth', 4: 'quota'}.get(code, 'error'), 'detail': 'result=%s' % code}


def fetch_day(date_str, key, timeout=20, opener=None):
    """한 고시일을 조회한다. 키가 들어 있는 URL·예외 메시지는 밖으로 내보내지 않는다(예외 종류만 기록)."""
    url = '%s?%s' % (API_URL, urllib.parse.urlencode({'authkey': key, 'searchdate': date_str, 'data': 'AP01'}))
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    try:
        with (opener or urllib.request.urlopen)(req, timeout=timeout) as res:
            body = res.read(2_000_000)
    except urllib.error.HTTPError as exc:
        return {'outcome': 'network', 'detail': 'HTTP %d' % exc.code}
    except Exception as exc:
        return {'outcome': 'network', 'detail': type(exc).__name__}
    try:
        payload = json.loads(body.decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        return {'outcome': 'format', 'detail': 'JSON 해석 실패'}
    return classify(payload)


# ---- 저장·수집 ------------------------------------------------------------------
def store_day(conn, rate_date, rows, now):
    stamp = now.isoformat(timespec='seconds')
    conn.executemany(
        'INSERT OR REPLACE INTO fx_rates(rate_date, cur_unit, cur_code, unit, cur_nm, deal_bas_r, ttb, tts, bkpr, kftc_deal_bas_r, kftc_bkpr, yy_efee_r, ten_dd_efee_r, fetched_at) '
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [(rate_date, r['cur_unit'], r['cur_code'], r['unit'], r['cur_nm'], r['deal_bas_r'], r['ttb'], r['tts'], r['bkpr'], r['kftc_deal_bas_r'], r['kftc_bkpr'],
          r['yy_efee_r'], r['ten_dd_efee_r'], stamp) for r in rows])
    conn.execute('INSERT OR REPLACE INTO fx_dates(rate_date, status, rows, checked_at, final) VALUES (?,?,?,?,1)', (rate_date, 'DATA', len(rows), stamp))


def mark_empty(conn, rate_date, now):
    """빈 응답. 그날 안에 받은 빈 응답은 '아직 공개 전'일 수 있어 확정하지 않고, 다음 날 이후에 받은 빈 응답만 확정(공휴일)한다."""
    final = 1 if now.date().isoformat() > rate_date else 0
    conn.execute('INSERT OR REPLACE INTO fx_dates(rate_date, status, rows, checked_at, final) VALUES (?,?,0,?,?)',
                 (rate_date, 'EMPTY', now.isoformat(timespec='seconds'), final))


def mark_weekends(conn, today):
    """토·일은 호출 없이 확정 처리한다."""
    have = {r[0] for r in conn.execute('SELECT rate_date FROM fx_dates')}
    stamp = datetime.now(KST).isoformat(timespec='seconds')
    add = []
    for k in range(0, WINDOW_DAYS + 1):
        d = today - timedelta(days=k)
        if d.weekday() >= 5 and d.isoformat() not in have:
            add.append((d.isoformat(), 'WEEKEND', 0, stamp, 1))
    if add:
        conn.executemany('INSERT OR IGNORE INTO fx_dates(rate_date, status, rows, checked_at, final) VALUES (?,?,?,?,?)', add)


def calls_today(conn, today):
    return int(get_meta(conn, 'calls:%s' % today.isoformat(), 0) or 0)


def bump_calls(conn, today):
    set_meta(conn, 'calls:%s' % today.isoformat(), calls_today(conn, today) + 1)
    conn.execute("DELETE FROM fx_meta WHERE key LIKE 'calls:%' AND key < ?", ('calls:%s' % (today - timedelta(days=7)).isoformat(),))


def today_retry_gap(now):
    return TODAY_RETRY_EARLY_SEC if now.hour < 13 else TODAY_RETRY_LATE_SEC


def pending_dates(conn, now):
    """이번 주기에 조회할 고시일(우선순위 순). 오늘 → 어제부터 과거로."""
    today = now.date()
    status = {r['rate_date']: (r['status'], r['final'], r['checked_at']) for r in conn.execute('SELECT rate_date, status, final, checked_at FROM fx_dates')}
    out = []
    minutes = now.hour * 60 + now.minute
    if today.weekday() < 5 and now.hour >= PUBLISH_HOUR and minutes <= TODAY_RETRY_END_MIN:
        st = status.get(today.isoformat())
        if st is None or (st[0] != 'DATA'):
            due = True
            if st is not None:
                try:
                    due = (now - datetime.fromisoformat(st[2])).total_seconds() >= today_retry_gap(now)
                except ValueError:
                    due = True
            if due:
                out.append(today.isoformat())
    for k in range(1, WINDOW_DAYS + 1):
        d = today - timedelta(days=k)
        if d.weekday() >= 5:
            continue
        st = status.get(d.isoformat())
        if st is None or (st[0] == 'EMPTY' and not st[1]):
            out.append(d.isoformat())
    return out


def run_cycle(conn, now, key, fetch=fetch_day, pause=time.sleep, budget=DEFAULT_BUDGET):
    """한 번의 수집 주기. 반환: {'sleep': 다음 주기까지 초, 'fetched': 저장한 날 수, 'calls': 호출 수, 'state': ...}."""
    today = now.date()
    set_meta(conn, 'last_check_at', now.isoformat(timespec='seconds'))
    mark_weekends(conn, today)
    conn.commit()
    if not key:
        set_meta(conn, 'last_error', 'no_key')
        conn.commit()
        return {'sleep': NO_KEY_SEC, 'fetched': 0, 'calls': 0, 'state': 'no_key'}
    if get_meta(conn, 'quota_blocked_date') == today.isoformat():
        return {'sleep': IDLE_SEC, 'fetched': 0, 'calls': 0, 'state': 'quota'}
    pending = pending_dates(conn, now)
    fetched = calls = 0
    state = 'ok'
    sleep_after = None
    for date_text in pending:
        if calls >= MAX_PER_CYCLE:
            break
        if calls_today(conn, today) >= budget:
            state, sleep_after = 'budget', IDLE_SEC
            break
        result = fetch(date_text.replace('-', ''), key)
        bump_calls(conn, today)
        calls += 1
        outcome = result.get('outcome')
        if outcome == 'ok':
            store_day(conn, date_text, result['rows'], now)
            set_meta(conn, 'last_success_at', now.isoformat(timespec='seconds'))
            set_meta(conn, 'last_error', '')
            fetched += 1
        elif outcome == 'empty':
            mark_empty(conn, date_text, now)
        elif outcome == 'auth':
            set_meta(conn, 'last_error', 'auth')
            state, sleep_after = 'auth', AUTH_BACKOFF_SEC
            conn.commit()
            break
        elif outcome == 'quota':
            set_meta(conn, 'quota_blocked_date', today.isoformat())
            set_meta(conn, 'last_error', 'quota')
            state, sleep_after = 'quota', IDLE_SEC
            conn.commit()
            break
        else:
            set_meta(conn, 'last_error', 'network' if outcome == 'network' else outcome or 'error')
            set_meta(conn, 'last_error_detail', str(result.get('detail') or '')[:80])
            state, sleep_after = 'error', ERROR_BACKOFF_SEC
            conn.commit()
            break
        conn.commit()
        pause(THROTTLE_SEC)
    conn.commit()
    if sleep_after is None:
        sleep_after = next_sleep(conn, now)
    return {'sleep': sleep_after, 'fetched': fetched, 'calls': calls, 'state': state}


def next_sleep(conn, now):
    """남은 과거 조회가 있으면 짧게, 오늘 고시 대기 중이면 재시도 간격, 아니면 11시까지 또는 긴 간격."""
    pend = pending_dates(conn, now)
    past = [d for d in pend if d != now.date().isoformat()]
    if past:
        return BACKFILL_SEC
    today = now.date()
    if today.weekday() < 5:
        if now.hour < PUBLISH_HOUR:
            target = now.replace(hour=PUBLISH_HOUR, minute=0, second=30, microsecond=0)
            return int(max(60, min(IDLE_SEC, (target - now).total_seconds())))
        row = conn.execute('SELECT status FROM fx_dates WHERE rate_date=?', (today.isoformat(),)).fetchone()
        if (row is None or row[0] != 'DATA') and now.hour * 60 + now.minute <= TODAY_RETRY_END_MIN:
            return 300
    return IDLE_SEC


# ---- 조회(요청 경로: 외부 호출 없음, SQLite 읽기만) -------------------------------------
_cache = {}
_cache_lock = threading.Lock()


def _cached(key, producer, ttl=CACHE_TTL_SEC):
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    value = producer()
    with _cache_lock:
        _cache[key] = (now, value)
    return value


def clear_cache():
    with _cache_lock:
        _cache.clear()


def _order(code):
    if code in FEATURED:
        return (0, FEATURED.index(code), code)
    if code in SECONDARY:
        return (1, SECONDARY.index(code), code)
    return (2, 0, code)


def collection_state(conn, now):
    """화면에 보여 줄 수집 상태(코드, 한국어 설명)."""
    last_error = get_meta(conn, 'last_error', '') or ''
    has_data = conn.execute('SELECT 1 FROM fx_rates LIMIT 1').fetchone() is not None
    if last_error == 'no_key':
        return 'no_key', '서버에 수출입은행 인증키가 등록되지 않아 아직 수집하지 못했습니다.'
    if last_error == 'auth':
        return 'auth_error', '수출입은행 인증키가 거부되어 새 데이터를 받지 못하고 있습니다. 직전 수집 데이터를 표시합니다.'
    if get_meta(conn, 'quota_blocked_date') == now.date().isoformat():
        return 'quota', '오늘 API 호출 한도에 도달해 내일 이어서 수집합니다. 직전 수집 데이터를 표시합니다.'
    if last_error in ('network', 'format', 'error', 'bad_request'):
        return 'network_error', '수출입은행 서버와 통신하지 못했습니다. 잠시 후 다시 시도하며 직전 수집 데이터를 표시합니다.'
    if not has_data:
        return 'collecting', '데이터를 처음 수집하는 중입니다.'
    missing = sum(1 for d in pending_dates(conn, now) if d != now.date().isoformat())
    if missing > 5:
        return 'collecting', '과거 환율 이력을 채우는 중입니다(남은 영업일 약 %d일).' % missing
    return 'ok', ''


def snapshot(db_file=None, now=None):
    """GET /fx-rates 본문: 최신 고시일의 통화별 환율 + 직전 고시일 대비 변동."""
    def produce():
        now_dt = now or kst_now()
        ensure_schema(db_file)
        conn = connect(db_file)
        try:
            dates = [r[0] for r in conn.execute('SELECT DISTINCT rate_date FROM fx_rates ORDER BY rate_date DESC LIMIT 2')]
            state, message = collection_state(conn, now_dt)
            base = dates[0] if dates else None
            prev_date = dates[1] if len(dates) > 1 else None
            out = {'source': '한국수출입은행 환율정보 Open API', 'kind': '일별 공식 고시환율(매매기준율)', 'official': True, 'realtime': False,
                   'notice': OFFICIAL_NOTICE, 'baseDate': base, 'prevDate': prev_date, 'state': state, 'stateMessage': message,
                   'lastCheckedAt': get_meta(conn, 'last_check_at'), 'lastSuccessAt': get_meta(conn, 'last_success_at'), 'lastCollectedAt': None,
                   'pendingToday': False, 'currencies': [], 'coverage': None}
            today = now_dt.date()
            if today.weekday() < 5 and now_dt.hour >= PUBLISH_HOUR:
                out['pendingToday'] = base != today.isoformat()
            if not base:
                return out
            cols = ('cur_unit', 'cur_code', 'unit', 'cur_nm', 'deal_bas_r', 'ttb', 'tts', 'bkpr', 'kftc_deal_bas_r', 'fetched_at')
            latest = conn.execute('SELECT %s FROM fx_rates WHERE rate_date=?' % ', '.join(cols), (base,)).fetchall()
            prev = {}
            if prev_date:
                prev = {r[0]: r[1] for r in conn.execute('SELECT cur_unit, deal_bas_r FROM fx_rates WHERE rate_date=?', (prev_date,))}
            items = []
            for r in latest:
                d = dict(zip(cols, r))
                before = prev.get(d['cur_unit'])
                change = round(d['deal_bas_r'] - before, 4) if before else None
                rate = round(change / before * 100, 4) if before else None
                items.append({'code': d['cur_code'], 'curUnit': d['cur_unit'], 'unit': d['unit'], 'name': d['cur_nm'], 'dealBasR': d['deal_bas_r'], 'prev': before,
                              'change': change, 'changeRate': rate, 'ttb': d['ttb'], 'tts': d['tts'], 'bkpr': d['bkpr'], 'kftcDealBasR': d['kftc_deal_bas_r'],
                              'featured': d['cur_code'] in FEATURED})
            items.sort(key=lambda x: _order(x['code']))
            out['currencies'] = items
            out['lastCollectedAt'] = max((r[9] for r in latest), default=None)
            first = conn.execute('SELECT MIN(rate_date), COUNT(DISTINCT rate_date) FROM fx_rates').fetchone()
            out['coverage'] = {'from': first[0], 'to': base, 'days': first[1]}
            return out
        finally:
            conn.close()
    return _cached(('snapshot', db_file or DB_FILE, now.isoformat() if now else None), produce)


def history(code, range_key, db_file=None):
    """GET /fx-rates/history 본문: 한 통화의 매매기준율 추이(기준 단위 그대로)."""
    code = str(code or '').upper()
    if not _CODE_RE.match(code) or range_key not in RANGES:
        raise ValueError('invalid code or range')

    def produce():
        ensure_schema(db_file)
        conn = connect(db_file)
        try:
            last = conn.execute('SELECT MAX(rate_date) FROM fx_rates WHERE cur_code=?', (code,)).fetchone()[0]
            if not last:
                return {'code': code, 'range': range_key, 'points': [], 'count': 0, 'from': None, 'to': None, 'coverageFrom': None, 'incomplete': True}
            cutoff = (datetime.strptime(last, '%Y-%m-%d') - timedelta(days=RANGES[range_key])).strftime('%Y-%m-%d')
            rows = conn.execute('SELECT rate_date, deal_bas_r, cur_unit, unit, cur_nm FROM fx_rates WHERE cur_code=? AND rate_date>=? ORDER BY rate_date', (code, cutoff)).fetchall()
            first_ever = conn.execute('SELECT MIN(rate_date) FROM fx_rates WHERE cur_code=?', (code,)).fetchone()[0]
            latest = rows[-1]
            return {'code': code, 'curUnit': latest[2], 'unit': latest[3], 'name': latest[4], 'range': range_key,
                    'points': [[r[0], r[1]] for r in rows], 'count': len(rows), 'from': rows[0][0], 'to': last, 'coverageFrom': first_ever,
                    'incomplete': first_ever > cutoff}
        finally:
            conn.close()
    return _cached(('history', db_file or DB_FILE, code, range_key), produce)


# ---- 백그라운드 스레드 --------------------------------------------------------------
def _poll_loop():
    try:
        ensure_schema()
    except Exception:
        logger.exception('fx schema init failed')
        return
    while True:
        sleep_for = IDLE_SEC
        try:
            key = api_key()
            conn = connect()
            try:
                result = run_cycle(conn, kst_now(), key, budget=daily_budget())
            finally:
                conn.close()
            sleep_for = result['sleep']
            if result['calls'] or result['state'] not in ('ok',):
                logger.info('fx cycle: state=%s calls=%d stored=%d next=%ds', result['state'], result['calls'], result['fetched'], sleep_for)
            if result['fetched']:
                clear_cache()
        except Exception as exc:                       # 키가 든 URL 이 예외 문구에 섞이지 않게 종류만 기록한다
            logger.error('fx cycle failed: %s', type(exc).__name__)
            sleep_for = ERROR_BACKOFF_SEC
        time.sleep(sleep_for)


def start_background():
    t = threading.Thread(target=_poll_loop, name='fx-koreaexim-poll', daemon=True)
    t.start()
    return t
