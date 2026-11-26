# -*- coding: utf-8 -*-
"""지지 방어 + 거래량 재폭발 + 전일 고가 돌파 단타의 '그림자 기록'(2026-11-26, 연구 전용, 주문·자동매매 연결 없음).

배경: 일봉만으로 같은 조건을 5년 백테스트한 결과(scripts/research/daytrade_support_breakout_study.py, n=2,988)는
종가·익일 청산 기대값이 음수였다. 사용자가 실제로 보는 신호(체결강도, 호가 공백, 5분 단위 거래량·가격 흐름)는
일봉에 없고 과거 분봉·체결강도 이력도 서버에 없다. 그래서 같은 조건의 종목을 **장 시작 전에 확정**해 두고,
장중 5분마다 그 종목들의 실제 값을 쌓아 몇 주 뒤 장중 확인 신호의 효과를 같은 기준으로 검증한다.

사전 후보(장 시작 전 정보만): 일봉이 직전 거래일까지 들어와 있을 때 daily_prices로 판정한다.
  SUP   최근 10봉 최저가가 112일선 또는 224일선의 -5% ~ +6% 안
  HOLD  최근 5봉 최저가 >= 그 앞 20봉(t-25~t-6) 최저가
  SURGE 직전 60봉(t-60~t-2) 안 일간 상승률 +15% 이상이 한 번 이상
  VOLX  어제 거래량 >= 직전 5일(t-6~t-2) 평균의 2배
  LIQ   20일 평균 거래대금 >= 20억
  기록 대상 = LIQ 통과 + 위 4개 중 3개 이상(4/4가 본 후보, 3/4은 조건 하나를 뺀 비교군). 판정식은 연구 스크립트와 같고
  test_support_breakout_shadow.py가 두 구현의 일치를 검증한다. 임계값은 연구에서 정한 출발점이며 이 기록으로 바꾸지 않는다.

장중 기록: 5분 슬롯마다 한 번(09:00~15:30), 후보 전체의 네이버 polling 배치(시가·고가·저가·현재가·누적 거래량·거래대금, 40종목/요청)를
읽어 저장한다. 4/4 후보가 전일 고가 -1.5% 안으로 들어오거나 전일 고가를 넘었으면(armed) 최대 20종목에 한해 KIS 체결강도(FHKST01010300
tday_rltv)와 10호가 잔량(FHKST01010200)을 추가로 읽는다. 값이 없으면 NULL이며 0이나 직전 값으로 채우지 않는다.
기록 시각은 실제 관측 시각이고, 놓친 슬롯은 나중에 복원하지 않는다(재시작·실패로 비는 슬롯은 그대로 빈다).
외부 호출은 별도 스레드에서만 하므로 volume_surge_live 30초 루프를 막지 않는다. 새 상시 프로세스·타이머는 없다.

사후 성과: 장 밖에서 일봉이 들어오면 후보일 D0~D3 일봉을 daily_json에 채운다(멱등).
"""
import json
import logging
import math
import os
import re
import sqlite3
import threading
import time
from contextlib import closing
from datetime import datetime, timedelta, timezone

logger = logging.getLogger('support_breakout_shadow')

KST = timezone(timedelta(hours=9))
MODEL = 'support-breakout-shadow-v1'
DB_FILE = os.environ.get('SUPPORT_SHADOW_DB') or os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                                             'support_breakout_shadow.db')

# ---- 판정 규칙(연구 스크립트와 동일. 바꾸면 연구 스크립트·테스트·docs도 함께) ----
MIN_ROWS = 240
SUP_LOW, SUP_HIGH = -0.05, 0.06
SURGE_MIN = 0.15
VOLX_MULT = 2.0
MIN_AMT = 2e9

# ---- 운영 상수 ----
MAX_CANDIDATES = 120
MIN_PASS = 3                      # 4개 조건 중 최소 통과 수(3 = 비교군 포함)
SLOT_MIN = 5
SESSION_START, SESSION_END = 9 * 60, 15 * 60 + 30
ARMED_RATIO = 0.985               # 현재가 >= 전일 고가 x 이 값이면 armed
MAX_ARMED = 20                    # 슬롯당 KIS 추가 조회 종목 상한(종목당 2요청)
NAVER_BATCH = 40
KIS_SPACING_SEC = 0.12
MIN_FRESH_RATIO = 0.6             # 직전 거래일 일봉이 들어온 종목 비율이 이보다 낮으면 그날 후보를 만들지 않는다
MIN_ETF_CODES = 50                # ETF 목록이 이보다 적으면 목록 조회 실패로 본다
RETRY_SEC = 300
KEEP_DAYS = 400
OUTCOME_DAYS = 4                  # D0~D3
OUTCOME_REFRESH_SEC = 30 * 60

DDL = ('''
CREATE TABLE IF NOT EXISTS sbs_day (
    trading_date TEXT PRIMARY KEY, state TEXT NOT NULL, built_at TEXT, examined INTEGER, fresh INTEGER,
    candidates INTEGER, note TEXT, model TEXT)''', '''
CREATE TABLE IF NOT EXISTS sbs_candidate (
    trading_date TEXT NOT NULL, code TEXT NOT NULL, name TEXT, prev_date TEXT,
    prev_open REAL, prev_high REAL, prev_low REAL, prev_close REAL, prev_volume REAL,
    ma112 REAL, ma224 REAL, low10 REAL, low5 REAL, support_ref TEXT, support_gap REAL,
    surge_max REAL, vmean5 REAL, amt20 REAL,
    sup INTEGER, hold INTEGER, surge INTEGER, volx INTEGER, n_pass INTEGER,
    daily_json TEXT, outcome_days INTEGER NOT NULL DEFAULT 0, outcome_updated_at TEXT,
    PRIMARY KEY (trading_date, code))''', '''
CREATE TABLE IF NOT EXISTS sbs_obs (
    trading_date TEXT NOT NULL, slot INTEGER NOT NULL, code TEXT NOT NULL, observed_ts REAL NOT NULL,
    price REAL, open REAL, day_high REAL, day_low REAL, cum_volume REAL, cum_amount REAL,
    base_price REAL, base_ok INTEGER, market_state TEXT, armed INTEGER NOT NULL DEFAULT 0,
    strength REAL, strength_time TEXT, ask_qty10 REAL, bid_qty10 REAL, ask1_price REAL, ask10_price REAL,
    PRIMARY KEY (trading_date, slot, code))''')

_lock = threading.Lock()
_state = {'date': None, 'status': 'pending', 'cands': {}, 'slots': set(), 'running': False, 'retry_at': 0.0,
          'last': None, 'note': None}
_last_outcome_run = 0.0


def _num(value):
    try:
        if value in (None, ''):
            return None
        result = float(str(value).replace(',', ''))
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def _iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


def connect(db_file=None):
    conn = sqlite3.connect(db_file or DB_FILE, timeout=5)
    for ddl in DDL:
        conn.execute(ddl)
    conn.execute('CREATE INDEX IF NOT EXISTS sbs_obs_code ON sbs_obs(code, trading_date)')
    return conn


def slot_of(now_kst):
    """5분 슬롯 시작(분 단위, 자정 기준). 장 밖이면 None."""
    minute = now_kst.hour * 60 + now_kst.minute
    if not SESSION_START <= minute <= SESSION_END:
        return None
    return minute // SLOT_MIN * SLOT_MIN


# ---------------------------------------------------------------- 사전 후보 판정(순수 함수)

def _valid_tail(rows):
    for r in rows:
        for key in ('open', 'high', 'low', 'close', 'volume'):
            v = r.get(key)
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
                return False
        if r['close'] <= 0 or r['low'] <= 0 or r['volume'] < 0:
            return False
    return True


def evaluate_candidate(rows):
    """rows: 날짜 오름차순 일봉, 마지막 행 = 직전 거래일(t-1). 연구 스크립트의 t 시점 판정과 같다. 부족·불량이면 None."""
    n = len(rows)
    if n < MIN_ROWS or not _valid_tail(rows[-MIN_ROWS:]):
        return None
    c = [r['close'] for r in rows]
    h = [r['high'] for r in rows]
    lo = [r['low'] for r in rows]
    v = [r['volume'] for r in rows]
    ma = {'ma112': sum(c[-112:]) / 112, 'ma224': sum(c[-224:]) / 224}
    low10, low5 = min(lo[-10:]), min(lo[-5:])
    best = None
    for name, m in ma.items():
        gap = low10 / m - 1
        if SUP_LOW <= gap <= SUP_HIGH and (best is None or abs(gap) < abs(best[1])):
            best = (name, gap)
    sup = best is not None
    hold = low5 >= min(lo[-25:-5])
    surge_max = max(c[i] / c[i - 1] - 1 for i in range(n - 60, n - 1))
    surge = surge_max >= SURGE_MIN
    vmean5 = sum(v[-6:-1]) / 5
    volx = vmean5 > 0 and v[-1] >= VOLX_MULT * vmean5
    amt20 = sum(c[i] * v[i] for i in range(n - 20, n)) / 20
    last = rows[-1]
    return {'sup': sup, 'hold': hold, 'surge': surge, 'volx': volx, 'liq': amt20 >= MIN_AMT,
            'n_pass': int(sup) + int(hold) + int(surge) + int(volx),
            'support_ref': best[0] if best else None, 'support_gap': best[1] if best else None,
            'ma112': ma['ma112'], 'ma224': ma['ma224'], 'low10': low10, 'low5': low5,
            'surge_max': surge_max, 'vmean5': vmean5, 'amt20': amt20,
            'prev_date': last['date'], 'prev_open': last['open'], 'prev_high': last['high'], 'prev_low': last['low'],
            'prev_close': last['close'], 'prev_volume': last['volume']}


def select_candidates(evals, limit=MAX_CANDIDATES):
    """LIQ 통과 + 조건 3개 이상. 4/4를 먼저, 같은 통과 수 안에서는 거래대금이 큰 순. {code: eval}"""
    pool = [(code, e) for code, e in evals.items() if e and e['liq'] and e['n_pass'] >= MIN_PASS]
    pool.sort(key=lambda item: (-item[1]['n_pass'], -item[1]['amt20'], item[0]))
    return dict(pool[:limit])


def build_candidates(prices_conn, date_str, prev_day, allowed=None):
    """daily_prices를 종목 단위로 흘려 읽어 후보를 만든다. 반환: (후보 dict, examined, fresh)."""
    evals, examined, fresh = {}, 0, 0
    cur = prices_conn.execute('SELECT code, date, open, high, low, close, volume FROM daily_prices '
                              'WHERE date < ? ORDER BY code, date', (date_str,))
    code, buf = None, []

    def flush():
        nonlocal examined, fresh
        if code is None or (allowed is not None and code not in allowed):
            return
        examined += 1
        if not buf or buf[-1]['date'] != prev_day:
            return
        fresh += 1
        e = evaluate_candidate(buf)
        if e:
            evals[code] = e

    for row in cur:
        if row[0] != code:
            flush()
            code, buf = row[0], []
        buf.append({'date': row[1], 'open': row[2], 'high': row[3], 'low': row[4], 'close': row[5],
                    'volume': row[6]})
        if len(buf) > 260:
            del buf[0]
    flush()
    return select_candidates(evals), examined, fresh


def _common_stock(code):
    """보통주 코드는 끝자리가 0이다(우선주 5·7·9·K·L 등 제외)."""
    return bool(re.fullmatch(r'[0-9A-Z]{5}0', code or ''))


def prepare_day(prices_conn, date_str, etf_codes=None, previous_day=None):
    """그날 후보를 만든다. 반환: (state, 후보 dict, examined, fresh, note)."""
    import market_clock
    day = datetime.strptime(date_str, '%Y-%m-%d').date()
    prev_day = previous_day or market_clock.prev_kr_trading_day(day).strftime('%Y-%m-%d')
    if etf_codes is None:
        import volume_breakout_scan
        etf_codes = volume_breakout_scan.load_etf_codes()
    if len(etf_codes) < MIN_ETF_CODES:
        return 'no_universe', {}, 0, 0, 'ETF 목록 조회 실패(%d개)' % len(etf_codes)
    codes = {r[0] for r in prices_conn.execute('SELECT DISTINCT code FROM daily_prices WHERE date=?', (prev_day,))}
    allowed = {c for c in codes if _common_stock(c) and c not in etf_codes}
    cands, examined, fresh = build_candidates(prices_conn, date_str, prev_day, allowed)
    total = prices_conn.execute('SELECT COUNT(DISTINCT code) FROM daily_prices WHERE date<?', (date_str,)).fetchone()[0]
    if not total or len(codes) / total < MIN_FRESH_RATIO:
        return ('stale_daily', {}, total, len(codes),
                '직전 거래일(%s) 일봉이 %d/%d종목만 있다' % (prev_day, len(codes), total or 0))
    return 'ready', cands, examined, fresh, None


def _save_day(conn, date_str, state, cands, examined, fresh, note):
    conn.execute('INSERT OR REPLACE INTO sbs_day VALUES (?,?,?,?,?,?,?,?)',
                 (date_str, state, _iso(time.time()), examined, fresh, len(cands), note, MODEL))
    for code, e in cands.items():
        conn.execute(
            'INSERT OR IGNORE INTO sbs_candidate (trading_date, code, prev_date, prev_open, prev_high, prev_low, '
            'prev_close, prev_volume, ma112, ma224, low10, low5, support_ref, support_gap, surge_max, vmean5, amt20, '
            'sup, hold, surge, volx, n_pass) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (date_str, code, e['prev_date'], e['prev_open'], e['prev_high'], e['prev_low'], e['prev_close'],
             e['prev_volume'], e['ma112'], e['ma224'], e['low10'], e['low5'], e['support_ref'], e['support_gap'],
             e['surge_max'], e['vmean5'], e['amt20'], int(e['sup']), int(e['hold']), int(e['surge']), int(e['volx']),
             e['n_pass']))
    conn.commit()


def _load_day(conn, date_str):
    day = conn.execute('SELECT state, note FROM sbs_day WHERE trading_date=?', (date_str,)).fetchone()
    if not day:
        return None
    cands = {}
    for r in conn.execute('SELECT code, prev_date, prev_open, prev_high, prev_low, prev_close, prev_volume, n_pass '
                          'FROM sbs_candidate WHERE trading_date=?', (date_str,)):
        cands[r[0]] = {'prev_date': r[1], 'prev_open': r[2], 'prev_high': r[3], 'prev_low': r[4], 'prev_close': r[5],
                       'prev_volume': r[6], 'n_pass': r[7]}
    return day[0], cands, day[1]


# ---------------------------------------------------------------- 장중 기록

def parse_naver(body):
    """네이버 polling 응답 -> {code: 값}. 필드(2026-11-26 실응답 확인): nv 현재가, ov 시가, hv 고가, lv 저가,
    sv 전일 종가, aq 누적 거래량, aa 누적 거래대금(원), ms 장 상태, nm 종목명."""
    areas = ((body or {}).get('result') or {}).get('areas') or []
    area = next((a for a in areas if a.get('name') == 'SERVICE_ITEM'), {})
    out = {}
    for d in area.get('datas') or []:
        code = d.get('cd')
        if not code:
            continue
        out[code] = {'name': d.get('nm'), 'price': _num(d.get('nv')), 'open': _num(d.get('ov')),
                     'high': _num(d.get('hv')), 'low': _num(d.get('lv')), 'base': _num(d.get('sv')),
                     'volume': _num(d.get('aq')), 'amount': _num(d.get('aa')), 'state': d.get('ms')}
    return out


def fetch_naver(codes):
    import urllib.parse
    import market_temp_data as data
    out = {}
    for i in range(0, len(codes), NAVER_BATCH):
        batch = codes[i:i + NAVER_BATCH]
        url = data.NAVER_POLLING_URL + urllib.parse.quote(','.join(batch), safe=',')
        try:
            out.update(parse_naver(data._get_json(url, timeout=6, encoding='euc-kr')))
        except Exception as exc:
            logger.info('네이버 시세 배치 실패(%s)', type(exc).__name__)
    return out


def make_kis_fetcher(appkey, appsecret):
    """armed 종목의 KIS 체결강도·10호가. 실패한 쪽은 None(0으로 채우지 않는다)."""
    import kis_client
    token = kis_client.get_token(appkey, appsecret)

    def fetch(code):
        result = {'strength': None, 'strength_time': None, 'ask_qty10': None, 'bid_qty10': None,
                  'ask1_price': None, 'ask10_price': None}
        try:
            rows = kis_client.fetch_domestic_trade(token, appkey, appsecret, code, market='J')
            latest = max(rows, key=lambda r: str(r.get('stck_cntg_hour') or ''), default=None)
            if latest:
                result['strength'] = _num(latest.get('tday_rltv'))
                result['strength_time'] = latest.get('stck_cntg_hour')
        except Exception as exc:
            logger.info('체결강도 조회 실패 %s(%s)', code, type(exc).__name__)
        time.sleep(KIS_SPACING_SEC)
        try:
            book, _ = kis_client.fetch_domestic_order_book(token, appkey, appsecret, code, market='J')
            asks = [_num(book.get('askp_rsqn%d' % i)) for i in range(1, 11)]
            bids = [_num(book.get('bidp_rsqn%d' % i)) for i in range(1, 11)]
            if all(x is not None for x in asks):
                result['ask_qty10'] = sum(asks)
            if all(x is not None for x in bids):
                result['bid_qty10'] = sum(bids)
            result['ask1_price'] = _num(book.get('askp1'))
            result['ask10_price'] = _num(book.get('askp10'))
        except Exception as exc:
            logger.info('호가 조회 실패 %s(%s)', code, type(exc).__name__)
        time.sleep(KIS_SPACING_SEC)
        return result
    return fetch


def is_armed(price, high, prev_high):
    if not prev_high or prev_high <= 0:
        return False
    return bool((price and price >= prev_high * ARMED_RATIO) or (high and high > prev_high))


def record_slot(conn, date_str, slot, cands, quotes, kis_fetch, observed_ts):
    """한 슬롯의 관측을 저장한다. 반환: (저장 행 수, armed 수, KIS 조회 수). 같은 슬롯은 INSERT OR IGNORE라 멱등."""
    rows, armed_rank = {}, []
    for code, cand in cands.items():
        q = quotes.get(code)
        if not q or not q.get('price') or q['price'] <= 0:
            continue
        if '스팩' in (q.get('name') or ''):
            continue
        base_ok = None
        if q.get('base') and cand.get('prev_close'):
            base_ok = int(abs(q['base'] / cand['prev_close'] - 1) <= 0.001)   # 권리락 등으로 기준가가 다르면 0
        armed = cand.get('n_pass') == 4 and is_armed(q['price'], q.get('high'), cand.get('prev_high'))
        rows[code] = {'q': q, 'base_ok': base_ok, 'armed': int(armed), 'kis': {}}
        if armed:
            armed_rank.append((-(q['price'] / cand['prev_high']), code))
    kis_calls = 0
    if kis_fetch:
        for _, code in sorted(armed_rank)[:MAX_ARMED]:
            try:
                rows[code]['kis'] = kis_fetch(code) or {}
                kis_calls += 1
            except Exception as exc:
                logger.info('KIS 추가 조회 실패 %s(%s)', code, type(exc).__name__)
    for code, item in rows.items():
        q, k = item['q'], item['kis']
        conn.execute(
            'INSERT OR IGNORE INTO sbs_obs (trading_date, slot, code, observed_ts, price, open, day_high, day_low, '
            'cum_volume, cum_amount, base_price, base_ok, market_state, armed, strength, strength_time, ask_qty10, '
            'bid_qty10, ask1_price, ask10_price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (date_str, slot, code, observed_ts, q['price'], q.get('open'), q.get('high'), q.get('low'),
             q.get('volume'), q.get('amount'), q.get('base'), item['base_ok'], q.get('state'), item['armed'],
             k.get('strength'), k.get('strength_time'), k.get('ask_qty10'), k.get('bid_qty10'),
             k.get('ask1_price'), k.get('ask10_price')))
        if q.get('name'):
            conn.execute('UPDATE sbs_candidate SET name=? WHERE trading_date=? AND code=? AND name IS NULL',
                         (q['name'], date_str, code))
    conn.execute('DELETE FROM sbs_obs WHERE trading_date < ?',
                 ((datetime.strptime(date_str, '%Y-%m-%d') - timedelta(days=KEEP_DAYS)).strftime('%Y-%m-%d'),))
    conn.commit()
    return len(rows), len(armed_rank), kis_calls


# ---------------------------------------------------------------- 호출 진입점(volume_surge_live 30초 루프)

def observe(now_kst, appkey, appsecret, db_file=None, runner=None):
    """30초 루프가 부른다. 슬롯 첫 호출에서만 작업 스레드를 띄우고 바로 돌아온다. 예외는 삼킨다."""
    try:
        return _observe(now_kst, appkey, appsecret, db_file, runner)
    except Exception:
        logger.exception('지지 돌파 그림자 기록 시작 실패')
        return None


def _observe(now_kst, appkey, appsecret, db_file, runner):
    import market_clock
    if not market_clock.is_kr_trading_day(now_kst):
        return None
    slot = slot_of(now_kst)
    if slot is None:
        return None
    date_str = now_kst.strftime('%Y-%m-%d')
    with _lock:
        if _state['date'] != date_str:
            _state.update(date=date_str, status='pending', cands={}, slots=set(), running=False, retry_at=0.0,
                          last=None, note=None)
        if _state['running'] or slot in _state['slots']:
            return 'skip'
        if _state['status'] != 'ready' and time.time() < _state['retry_at']:
            return 'skip'
        _state['running'] = True
        _state['slots'].add(slot)
    args = (date_str, slot, now_kst.timestamp(), appkey, appsecret, db_file)
    if runner:
        runner(*args)
    else:
        threading.Thread(target=_work, args=args, name='support-breakout-shadow', daemon=True).start()
    return 'started'


def _work(date_str, slot, observed_ts, appkey, appsecret, db_file, quote_fetcher=None, kis_factory=None,
          prices_conn_factory=None, etf_codes=None):
    try:
        with closing(connect(db_file)) as conn:
            if _state['status'] != 'ready':
                loaded = _load_day(conn, date_str)
                if loaded and loaded[0] == 'ready':
                    with _lock:
                        _state.update(status='ready', cands=loaded[1], note=None)
                else:
                    if prices_conn_factory is None:
                        import db_schema
                        prices_conn_factory = lambda: db_schema.get_conn(read_only=True)  # noqa: E731
                    with closing(prices_conn_factory()) as prices:
                        state, cands, examined, fresh, note = prepare_day(prices, date_str, etf_codes)
                    if state == 'ready':
                        _save_day(conn, date_str, state, cands, examined, fresh, note)
                        with _lock:
                            _state.update(status='ready', cands=cands, note=None)
                        logger.info('지지 돌파 그림자 후보 %d종목(4/4 %d, 일봉 %d/%d)', len(cands),
                                    sum(1 for e in cands.values() if e['n_pass'] == 4), fresh, examined)
                    else:
                        with _lock:
                            _state.update(status=state, note=note, retry_at=time.time() + RETRY_SEC)
                            _state['slots'].discard(slot)
                        logger.warning('지지 돌파 그림자 후보 생성 보류(%s): %s', state, note)
                        return
            cands = _state['cands']
            if not cands:
                return
            quotes = (quote_fetcher or fetch_naver)(list(cands))
            kis = None
            if kis_factory is not None or (appkey and appsecret):
                try:
                    kis = (kis_factory or make_kis_fetcher)(appkey, appsecret)
                except Exception as exc:
                    logger.info('KIS 토큰 실패(%s) - 체결강도·호가 없이 기록', type(exc).__name__)
            stored, armed, kis_calls = record_slot(conn, date_str, slot, cands, quotes, kis, observed_ts)
            with _lock:
                _state['last'] = {'slot': slot, 'stored': stored, 'armed': armed, 'kisCalls': kis_calls,
                                  'at': _iso(observed_ts)}
    except Exception:
        logger.exception('지지 돌파 그림자 슬롯 기록 실패')
    finally:
        with _lock:
            _state['running'] = False


# ---------------------------------------------------------------- 사후 성과(일봉)

def update_outcomes(prices_conn, db_file=None, today=None):
    """후보일 D0~D3 일봉을 채운다(일봉은 20시대 배치 뒤에 들어오므로 장 밖에서 반복 호출). 멱등."""
    today = today or datetime.now(KST).strftime('%Y-%m-%d')
    updated = 0
    with closing(connect(db_file)) as conn:
        pending = conn.execute('SELECT trading_date, code FROM sbs_candidate WHERE outcome_days<? AND trading_date<=?',
                               (OUTCOME_DAYS, today)).fetchall()
        for date_str, code in pending:
            bars = prices_conn.execute('SELECT date, open, high, low, close, volume FROM daily_prices '
                                       'WHERE code=? AND date>=? ORDER BY date LIMIT ?',
                                       (code, date_str, OUTCOME_DAYS)).fetchall()
            if not bars or bars[0][0] != date_str:
                continue
            days = [{'date': b[0], 'open': b[1], 'high': b[2], 'low': b[3], 'close': b[4], 'volume': b[5]}
                    for b in bars]
            conn.execute('UPDATE sbs_candidate SET daily_json=?, outcome_days=?, outcome_updated_at=? '
                         'WHERE trading_date=? AND code=?',
                         (json.dumps(days), len(days), _iso(time.time()), date_str, code))
            updated += 1
        conn.commit()
    return updated


def maybe_update_outcomes(now_t=None, db_file=None):
    """장 밖 대기 루프에서 부르는 얇은 진입점: 30분에 한 번만 일봉 대조(SQLite 읽기·쓰기만)."""
    global _last_outcome_run
    now_t = now_t or time.time()
    if now_t - _last_outcome_run < OUTCOME_REFRESH_SEC:
        return None
    _last_outcome_run = now_t
    try:
        import db_schema
        with closing(db_schema.get_conn(read_only=True)) as prices:
            return update_outcomes(prices, db_file)
    except Exception:
        logger.exception('지지 돌파 그림자 사후 성과 갱신 실패')
        return None


def runtime_status():
    with _lock:
        return {'date': _state['date'], 'status': _state['status'], 'candidates': len(_state['cands']),
                'slotsStarted': len(_state['slots']), 'running': _state['running'], 'last': _state['last'],
                'note': _state['note']}
