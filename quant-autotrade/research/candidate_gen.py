# -*- coding: utf-8 -*-
"""자동매매 연구용 후보 생성 + 모의 진입 기록 (2026-10-11, 읽기 전용·실주문 없음).

원칙
- 후보는 고정 시각(21:00)에 가져오지 않는다. 운영 서버의 `GET /pattern-scan`(이미 공개된 읽기 전용 경로)을 확인해
  '그날 스캔이 정상 완료되어 결과가 확정됐을 때만' 생성한다. 스캔이 실패하면 서버 캐시가 전일 값을 그대로 들고 있으므로
  (daily_scan.py는 실패 시 캐시를 비우지 않는다) 아래 검사로 전일·부분 결과를 걸러낸다.
    1) 항목들의 마지막 봉 날짜(data_date)가 한 값으로 모이고, scannedAt이 그날 20:10 이후 (전일·혼합 데이터 차단)
    2) data_date 다음 평일 09:00 전에만 생성 (오래된 스캔으로 후보를 만들지 않음, 주말·휴장 뒤 재사용 차단)
    3) scanned가 최근 정상 회차 중앙값의 90% 이상 (부분 실행 차단)
    4) 같은 scannedAt이 STABLE_SEC 이상 변하지 않음 (다른 스캔이 아직 쓰는 중인 상태 차단)
  참고: 21:00 batch_scan.py는 공매도·대차·재무 캐시를 만들 뿐 패턴 결과를 만들지 않는다. 패턴 후보의 출처는 20:10 daily_scan.py다.
- 후보는 (scan_date, scanner, code)로 한 번만 만들고 이후 갱신하지 않는다. 진입은 scan_date 다음 거래일에만 허용하고,
  그 뒤로 STALE_DAYS(달력일)가 지나면 만료 처리해 오래된 후보로는 진입하지 않는다.
- 수익성이 검증되지 않은 검색기도 'RESEARCH' 상태로 후보를 만들고 모의 진입·성과를 기록한다. live_eligible은 항상 0이다
  (실거래 연결은 별도 승인 단계).
- 기존 차트검색기 산식·스케줄은 건드리지 않는다. 이 모듈은 서버 응답을 읽기만 한다.
"""
import json
import os
import sqlite3
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
for _p in (os.path.join(REPO, 'quant-autotrade', 'backtest'), os.path.join(REPO, 'scripts', 'analysis'), os.path.join(REPO, 'scripts', 'cloud-vm')):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import account_sim  # noqa: E402
import paper_exits  # noqa: E402

KST = timezone(timedelta(hours=9))
API = os.environ.get('SCAN_API', 'https://goodbyestar.cloud')
# 과거 백테스트로 다룬 검색기만 연구 후보로 만든다(그 외 탭은 성과 근거가 없다). 값은 /pattern-scan patterns 키.
RESEARCH_SCANNERS = ('maCloudBreakout', 'doubleBottom', 'invHeadShoulders', 'pullback')
SCAN_START_KST = (20, 10)
STABLE_SEC = 180
STALE_DAYS = 4
GAP_SKIP = 0.02
ENTRY_SLIP = 0.002
# 모의매매 청산 전략 3종은 같은 후보·진입에 병렬 적용한다(paper_exits.py). 전략별 계좌는 서로 합산하지 않는다.
PAPER_VARIANTS = ('trail_atr', 'atr_close', 'dead35')

SCHEMA = """
CREATE TABLE IF NOT EXISTS scan_seen (scanned_at TEXT PRIMARY KEY, first_seen REAL NOT NULL, scanned INTEGER, ok INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS candidates (
  scan_date TEXT NOT NULL, scanner TEXT NOT NULL, code TEXT NOT NULL, name TEXT, score REAL, base_price REAL,
  scanned_at TEXT NOT NULL, created_at TEXT NOT NULL,
  strategy_status TEXT NOT NULL DEFAULT 'RESEARCH', live_eligible INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'NEW', reason TEXT, reasons TEXT,
  PRIMARY KEY (scan_date, scanner, code));
CREATE TABLE IF NOT EXISTS paper_trades (
  scan_date TEXT NOT NULL, scanner TEXT NOT NULL, code TEXT NOT NULL, variant TEXT NOT NULL,
  entry_date TEXT, entry_price REAL, exit_date TEXT, ret REAL, status TEXT NOT NULL, reason TEXT, updated_at TEXT,
  PRIMARY KEY (scan_date, scanner, code, variant));
CREATE TABLE IF NOT EXISTS gen_log (ts TEXT, scan_date TEXT, ok INTEGER, reason TEXT, created INTEGER);
CREATE TABLE IF NOT EXISTS paper_bars (code TEXT NOT NULL, date TEXT NOT NULL, open REAL, high REAL, low REAL, close REAL, PRIMARY KEY (code, date));
"""


PAPER_EXTRA_COLUMNS = (   # 2026-10-11 전략별 청산 기록. 기존 열(ret=순수익률)은 그대로 두고 필요한 열만 덧붙인다.
    ('stop_price', 'REAL'), ('trail_price', 'REAL'), ('signal_date', 'TEXT'), ('exit_price', 'REAL'), ('gross_ret', 'REAL'),
    ('exit_reason', 'TEXT'), ('hold_days', 'INTEGER'), ('max_hold', 'INTEGER'), ('last_bar_date', 'TEXT'), ('note', 'TEXT'),
)


CANDIDATE_EXTRA_COLUMNS = (('reasons', 'TEXT'),)   # 2026-10-11 스캔 선정 이유(JSON 배열 문자열). 알림·표시용 기록이며 판정에는 쓰지 않는다.


def migrate(conn):
    for table, extra in (('paper_trades', PAPER_EXTRA_COLUMNS), ('candidates', CANDIDATE_EXTRA_COLUMNS)):
        have = {r[1] for r in conn.execute('PRAGMA table_info(%s)' % table)}
        for name, typ in extra:
            if name not in have:
                conn.execute('ALTER TABLE %s ADD COLUMN %s %s' % (table, name, typ))
    conn.commit()


def connect(path):
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    migrate(conn)
    return conn


def fetch_scan(url=None, timeout=30):
    req = urllib.request.Request((url or API) + '/pattern-scan?_=%d' % int(time.time()), headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        body = json.loads(res.read().decode('utf-8'))
    return body.get('data') if isinstance(body, dict) and isinstance(body.get('data'), dict) else body  # {success, updatedAt, data:{...}} 래퍼


def _kst(scanned_at):
    dt = datetime.fromisoformat(str(scanned_at).replace('Z', '+00:00'))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(KST)


def _next_weekday(d):
    d = d + timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def check_scan(conn, payload, now_kst, now_epoch=None):
    """(ok, reason, data_date). ok일 때만 후보를 만든다. 호출할 때마다 scannedAt 첫 관측 시각을 기록한다.

    2026-10-11 실응답 확인: 스캔은 20:10에 시작하지만 scannedAt(저장 시각)이 23:58 KST까지 밀린다 -> 21:00 고정 조회는 어긋난다.
    universe(3,916)에는 ETF·SPAC 등 제외 종목이 포함돼 scanned(2,387)는 정상일 때도 universe의 약 61%다.
    그래서 부분 실행은 '최근 정상 회차의 scanned 중앙값 대비'로 판단한다(이력이 없으면 universe의 50% 이상)."""
    now_epoch = time.time() if now_epoch is None else now_epoch
    scanned_at = payload.get('scannedAt')
    if not scanned_at:
        return False, 'NO_SCANNED_AT', None
    try:
        sdt = _kst(scanned_at)
    except ValueError:
        return False, 'BAD_SCANNED_AT', None
    dates = [str(it.get('date') or '')[:10] for key in RESEARCH_SCANNERS for it in ((payload.get('patterns') or {}).get(key) or [])]
    if dates:
        data_date = max(set(dates), key=dates.count)  # 항목들의 마지막 봉 날짜(최빈값)
        if dates.count(data_date) < len(dates) * 0.9:
            return False, 'MIXED_BAR_DATES', data_date
    else:
        data_date = sdt.strftime('%Y-%m-%d') if sdt.hour >= 12 else (sdt - timedelta(days=1)).strftime('%Y-%m-%d')
    d = datetime.strptime(data_date, '%Y-%m-%d').replace(tzinfo=KST)
    if sdt < d.replace(hour=SCAN_START_KST[0], minute=SCAN_START_KST[1]):
        return False, 'SCAN_BEFORE_CLOSE_DATA(%s)' % data_date, data_date
    # 이 데이터로 진입 가능한 날은 data_date 다음 평일(거래일 가정)뿐이다. 그날 09:00 이후에는 오래된 후보로 간주해 만들지 않는다.
    entry_day = _next_weekday(d)
    if now_kst >= entry_day.replace(hour=9, minute=0):
        return False, 'STALE_SCAN(%s)' % data_date, data_date
    universe, scanned = int(payload.get('universe') or 0), int(payload.get('scanned') or 0)
    hist = sorted(r[0] for r in conn.execute('SELECT scanned FROM scan_seen WHERE ok=1 ORDER BY first_seen DESC LIMIT 5'))
    floor = hist[len(hist) // 2] * 0.9 if hist else universe * 0.5
    if universe <= 0 or scanned < floor:
        return False, 'PARTIAL_SCAN(%d<%d)' % (scanned, floor), data_date
    done = conn.execute('SELECT ok FROM scan_seen WHERE scanned_at=?', (str(scanned_at),)).fetchone()
    if done and done[0]:
        return True, 'ALREADY_DONE', data_date  # 같은 스캔 결과로는 후보를 다시 만들지 않는다(생성은 INSERT OR IGNORE 로 어차피 0건)
    conn.execute('INSERT OR IGNORE INTO scan_seen(scanned_at, first_seen, scanned, ok) VALUES (?, ?, ?, 0)', (str(scanned_at), now_epoch, scanned))
    first = conn.execute('SELECT first_seen FROM scan_seen WHERE scanned_at=?', (str(scanned_at),)).fetchone()[0]
    conn.commit()
    if now_epoch - first < STABLE_SEC:
        return False, 'WAIT_STABLE(%ds)' % int(now_epoch - first), data_date
    conn.execute('UPDATE scan_seen SET ok=1 WHERE scanned_at=?', (str(scanned_at),))
    conn.commit()
    return True, 'OK', data_date


def generate(conn, payload, now_kst, now_epoch=None):
    """스캔이 확정된 경우에만 연구 후보를 만든다. 반환 (ok, reason, 신규 건수)."""
    ok, reason, scan_date = check_scan(conn, payload, now_kst, now_epoch)
    created = 0
    if ok:
        now_iso = now_kst.isoformat(timespec='seconds')
        for key in RESEARCH_SCANNERS:
            for it in (payload.get('patterns') or {}).get(key) or []:
                code, price = str(it.get('code') or '').strip(), it.get('price')
                if not code or not isinstance(price, (int, float)) or price <= 0:
                    continue
                why = it.get('reasons')
                why = json.dumps([str(x) for x in why[:4]], ensure_ascii=False) if isinstance(why, list) and why else None
                cur = conn.execute('INSERT OR IGNORE INTO candidates(scan_date, scanner, code, name, score, base_price, scanned_at, created_at, reasons) '
                                   'VALUES (?,?,?,?,?,?,?,?,?)', (scan_date, key, code, str(it.get('name') or ''),
                                                                  float(it.get('score') or 0), float(price), str(payload.get('scannedAt')), now_iso, why))
                created += cur.rowcount
    conn.execute('INSERT INTO gen_log VALUES (?,?,?,?,?)', (now_kst.isoformat(timespec='seconds'), scan_date, 1 if ok else 0, reason, created))
    conn.commit()
    return ok, reason, created


def expire_old(conn, today):
    cutoff = (datetime.strptime(today, '%Y-%m-%d') - timedelta(days=STALE_DAYS)).strftime('%Y-%m-%d')
    cur = conn.execute("UPDATE candidates SET status='EXPIRED', reason='STALE' WHERE status='NEW' AND scan_date < ?", (cutoff,))
    conn.commit()
    return cur.rowcount


BARS_LOOKBACK = 40


def store_bars(conn, code, daily, scan_date):
    """모의 계좌 평가(종가 기준 미실현 손익·MDD)와 당일 재투입 시나리오 계산에 쓸 확정 일봉을 보관한다.
    스캔일 40봉 전(ATR·이동평균 계산용)부터 보관하며 이미 있는 날짜는 덮어쓰지 않는다(확정 봉은 불변)."""
    i = next((k for k, b in enumerate(daily) if b['date'] == scan_date), None)
    if i is None:
        return 0
    rows = [(code, b['date'], b.get('open'), b.get('high'), b.get('low'), b.get('close')) for b in daily[max(0, i - BARS_LOOKBACK):]]
    cur = conn.executemany('INSERT OR IGNORE INTO paper_bars(code, date, open, high, low, close) VALUES (?,?,?,?,?,?)', rows)
    return cur.rowcount


def ensure_variant_rows(conn, today):
    """진입한 후보마다 모든 청산 전략의 행이 있도록 보충한다(기존 기록은 건드리지 않음). 반환: 새로 만든 행 수."""
    made = 0
    for scan_date, scanner, code in conn.execute("SELECT scan_date, scanner, code FROM candidates WHERE status='PAPER_ENTERED'").fetchall():
        for variant in PAPER_VARIANTS:
            cur = conn.execute('INSERT OR IGNORE INTO paper_trades(scan_date, scanner, code, variant, status, updated_at, max_hold) VALUES (?,?,?,?,?,?,?)',
                               (scan_date, scanner, code, variant, 'OPEN', today, paper_exits.VARIANTS[variant]['maxHold']))
            made += cur.rowcount
    conn.commit()
    return made


def paper_enter(conn, get_daily, today):
    """scan_date 다음 거래일 봉이 생긴 NEW 후보를 모의 진입 처리한다(실주문 없음). 모든 청산 전략이 같은 후보·같은 진입을 쓴다.
    get_daily(code) -> 확정된 일봉 리스트(date, open, high, low, close). 시가가 기준가 대비 +2% 이상이면 SKIPPED.
    진입가는 시가*1.002 가정(연구용, 실제 체결 아님). 세부 가격은 paper_settle 이 전략별로 채운다."""
    n = 0
    rows = conn.execute("SELECT scan_date, scanner, code, base_price FROM candidates WHERE status='NEW' AND scan_date < ? ORDER BY scan_date",
                        (today,)).fetchall()
    for scan_date, scanner, code, base in rows:
        daily = get_daily(code) or []
        nxt = next((b for b in daily if b['date'] > scan_date), None)
        if nxt is None:
            continue
        key = (scan_date, scanner, code)
        if (datetime.strptime(nxt['date'], '%Y-%m-%d') - datetime.strptime(scan_date, '%Y-%m-%d')).days > STALE_DAYS:
            conn.execute("UPDATE candidates SET status='EXPIRED', reason='ENTRY_TOO_LATE' WHERE scan_date=? AND scanner=? AND code=?", key)
            continue
        if base and nxt['open'] / base - 1 >= GAP_SKIP:
            conn.execute("UPDATE candidates SET status='SKIPPED', reason='GAP>=2%' WHERE scan_date=? AND scanner=? AND code=?", key)
            continue
        entry = nxt['open'] * (1 + ENTRY_SLIP)
        conn.execute("UPDATE candidates SET status='PAPER_ENTERED' WHERE scan_date=? AND scanner=? AND code=?", key)
        store_bars(conn, code, daily, scan_date)
        for variant in PAPER_VARIANTS:
            conn.execute('INSERT OR IGNORE INTO paper_trades(scan_date, scanner, code, variant, entry_date, entry_price, status, updated_at, max_hold) '
                         'VALUES (?,?,?,?,?,?,?,?,?)', (scan_date, scanner, code, variant, nxt['date'], entry, 'OPEN', today, paper_exits.VARIANTS[variant]['maxHold']))
        n += 1
    conn.commit()
    ensure_variant_rows(conn, today)
    return n


def paper_settle(conn, get_daily, today):
    """미확정 모의 포지션(OPEN/PENDING_EXIT)을 paper_exits.evaluate 로 다시 판정한다. 반환: 이번에 새로 CLOSED 된 건수.

    - CLOSED 행은 다시 계산하지 않는다(기록 보존, 재실행해도 같은 결과·중복 없음).
    - 종가로 청산 신호가 났는데 다음 거래일 시가 봉이 아직 없으면 PENDING_EXIT 로 남기고 체결 가격·수익률을 만들지 않는다.
    - 일봉을 못 받았거나 스캔일 봉이 없으면 행을 바꾸지 않고 note 만 남긴다(미확정)."""
    settled = 0
    rows = conn.execute("SELECT scan_date, scanner, code, variant FROM paper_trades WHERE status IN ('OPEN','PENDING_EXIT') ORDER BY scan_date, code, variant").fetchall()
    cache = {}
    for scan_date, scanner, code, variant in rows:
        if variant not in paper_exits.VARIANTS:
            continue    # 알 수 없는 과거 전략 이름은 건드리지 않는다
        if code not in cache:
            cache[code] = get_daily(code) or []
        daily = cache[code]
        where = (scan_date, scanner, code, variant)
        i = next((k for k, b in enumerate(daily) if b['date'] == scan_date), None)
        if i is None:
            conn.execute("UPDATE paper_trades SET note=?, updated_at=? WHERE scan_date=? AND scanner=? AND code=? AND variant=?",
                         ('일봉 데이터 부족(스캔일 봉 없음) - 미확정', today) + where)
            continue
        store_bars(conn, code, daily, scan_date)
        r = paper_exits.evaluate(daily, i, variant)
        conn.execute(
            'UPDATE paper_trades SET status=?, entry_date=?, entry_price=?, stop_price=?, trail_price=?, signal_date=?, exit_date=?, exit_price=?, '
            'gross_ret=?, ret=?, exit_reason=?, hold_days=?, max_hold=?, last_bar_date=?, note=?, updated_at=? '
            'WHERE scan_date=? AND scanner=? AND code=? AND variant=? AND status IN (\'OPEN\',\'PENDING_EXIT\')',
            (('OPEN' if r['status'] == 'PENDING_ENTRY' else r['status']), r['entry_date'], r['entry_price'], r['stop_price'], r['trail_price'], r['signal_date'],
             r['exit_date'], r['exit_price'], r['gross_ret'], r['net_ret'], r['exit_reason'], r['hold_days'], r['maxHold'], r['last_bar_date'],
             r.get('note'), today) + where)
        if r['status'] == 'CLOSED':
            settled += 1
    conn.commit()
    return settled


def _account_inputs(conn, variant):
    """전략별 계좌 입력: 진입한 후보의 모의 거래 + 보관된 일봉."""
    cands = []
    for r in conn.execute(
            'SELECT t.scan_date, t.scanner, t.code, t.entry_date, t.entry_price, t.exit_date, t.ret, t.status, t.exit_reason, c.score '
            "FROM paper_trades t JOIN candidates c ON c.scan_date=t.scan_date AND c.scanner=t.scanner AND c.code=t.code "
            "WHERE t.variant=? AND c.status='PAPER_ENTERED' AND t.entry_date IS NOT NULL AND t.entry_price IS NOT NULL ORDER BY t.entry_date, c.score DESC", (variant,)):
        cands.append({'key': (r[0], r[1], r[2]), 'scan_date': r[0], 'scanner': r[1], 'code': r[2], 'entry_date': r[3], 'entry_price': r[4],
                      'exit_date': r[5], 'net': r[6], 'status': r[7], 'exit_class': paper_exits.exit_class(r[8]), 'score': r[9] or 0})
    bars = {}
    for code, date, o, h, l, c in conn.execute('SELECT code, date, open, high, low, close FROM paper_bars ORDER BY code, date'):
        bars.setdefault(code, []).append({'date': date, 'open': o, 'high': h, 'low': l, 'close': c})
    return cands, bars


def paper_account(conn, variant, scenario='conservative', limits=None, broker_cash=None, keep_curve=False):
    """한 전략의 독립 모의 계좌. 날짜순 자산곡선(현금 + 종가 평가 포지션)으로 누적수익률·MDD(미실현 손익 포함)를 계산한다.
    평가에 필요한 종가가 없으면 mddExact=False 로 표시하고 mdd 는 비운다(mddApprox 만 참고값)."""
    cands, bars = _account_inputs(conn, variant)
    if not cands:
        return {'closed': 0, 'avg': None, 'win': None, 'pf': None, 'cumRet': None, 'mdd': None, 'mddExact': True, 'mddApprox': None,
                'missingMarks': 0, 'rejected': {}, 'taken': 0, 'reuseBuys': 0, 'openPositions': 0, 'pendingExit': 0, 'equityLast': 1.0, 'days': 0}
    closes = {code: {b['date']: b['close'] for b in rows} for code, rows in bars.items()}
    first = min(c['entry_date'] for c in cands)
    calendar = sorted({d for rows in closes.values() for d in rows if d >= first})

    def close_at(code, date):
        return closes.get(code, {}).get(date)

    def make_alt(c):
        rows = bars.get(c['code'])
        if not rows:
            return None
        i = next((k for k, b in enumerate(rows) if b['date'] == c['scan_date']), None)
        if i is None:
            return None
        r = paper_exits.evaluate(rows, i, variant, 'close')
        if r['status'] == 'PENDING_ENTRY' or r['entry_price'] is None:
            return None
        return {'key': c['key'], 'code': c['code'], 'score': c['score'], 'entry_date': r['entry_date'], 'entry_price': r['entry_price'], 'exit_date': r['exit_date'],
                'net': r['net_ret'], 'status': r['status'], 'exit_class': paper_exits.exit_class(r['exit_reason'])}

    return account_sim.simulate_account(cands, calendar, close_at, make_alt, scenario, limits, broker_cash, keep_curve)


def paper_portfolios(conn, limits=None, broker_cash=None):
    """전략별 **독립** 모의 계좌(세 전략을 합치지 않음). 같은 후보·같은 자금 규칙(동시 5종목·종목당 10%·투자 30%)을 전략마다 따로 적용한다.
    - 기본값(공식 기록): 청산 대금은 다음 거래일부터 사용(선후를 알 수 없을 때의 보수적 가정). 미청산 포지션은 한도를 점유하고 종가로 평가해 자산곡선·MDD에 반영한다.
    - sameDay: 시가에 못 산 후보를 같은 날 종가에 재투입하는 시나리오(매도가 종가보다 확실히 앞선 경우의 대금만 사용). 두 결과를 따로 보고한다."""
    out = {}
    for variant in PAPER_VARIANTS:
        base = paper_account(conn, variant, 'conservative', limits, broker_cash)
        same = paper_account(conn, variant, 'sameDay', limits, broker_cash)
        rows = conn.execute('SELECT status FROM paper_trades WHERE variant=?', (variant,)).fetchall()
        v = dict(base)
        v.update(label=paper_exits.VARIANTS[variant]['label'], maxHold=paper_exits.VARIANTS[variant]['maxHold'],
                 execution=paper_exits.VARIANTS[variant]['execution'], candidateTrades=len(rows),
                 unsettled=sum(1 for r in rows if r[0] in ('OPEN', 'PENDING_EXIT')), pendingExit=sum(1 for r in rows if r[0] == 'PENDING_EXIT'),
                 sameDay={k: same.get(k) for k in ('cumRet', 'mdd', 'mddExact', 'mddApprox', 'closed', 'avg', 'win', 'pf', 'taken', 'reuseBuys', 'rejected', 'openPositions', 'pendingExit')})
        out[variant] = v
    return out


def summary(conn):
    """전략·검색기별 모의 거래 통계(건수·평균 순수익·승률). 전략끼리, 그리고 백테스트·실거래와 합치지 않는다."""
    out = {}
    for variant, scanner, n, avg, win in conn.execute(
            "SELECT variant, scanner, COUNT(*), AVG(ret), AVG(ret>0) FROM paper_trades WHERE status='CLOSED' GROUP BY variant, scanner"):
        out.setdefault(variant, {})[scanner] = {'closed': n, 'avg': avg, 'win': win}
    return out
