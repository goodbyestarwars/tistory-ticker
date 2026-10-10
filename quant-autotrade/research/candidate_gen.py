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

KST = timezone(timedelta(hours=9))
API = os.environ.get('SCAN_API', 'https://goodbyestar.cloud')
# 과거 백테스트로 다룬 검색기만 연구 후보로 만든다(그 외 탭은 성과 근거가 없다). 값은 /pattern-scan patterns 키.
RESEARCH_SCANNERS = ('maCloudBreakout', 'doubleBottom', 'invHeadShoulders', 'pullback')
SCAN_START_KST = (20, 10)
STABLE_SEC = 180
STALE_DAYS = 4
GAP_SKIP = 0.02
ENTRY_SLIP = 0.002
PAPER_VARIANT = 'trail_atr'  # 연구 기본 청산 정책(실거래 정책 아님). exit_study.simulate 변형 이름
MAX_HOLD = {'fix3_5': 10, 'fix5_10': 15, 'trail_atr': 30, 'time10': 10}

SCHEMA = """
CREATE TABLE IF NOT EXISTS scan_seen (scanned_at TEXT PRIMARY KEY, first_seen REAL NOT NULL, scanned INTEGER, ok INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS candidates (
  scan_date TEXT NOT NULL, scanner TEXT NOT NULL, code TEXT NOT NULL, name TEXT, score REAL, base_price REAL,
  scanned_at TEXT NOT NULL, created_at TEXT NOT NULL,
  strategy_status TEXT NOT NULL DEFAULT 'RESEARCH', live_eligible INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'NEW', reason TEXT,
  PRIMARY KEY (scan_date, scanner, code));
CREATE TABLE IF NOT EXISTS paper_trades (
  scan_date TEXT NOT NULL, scanner TEXT NOT NULL, code TEXT NOT NULL, variant TEXT NOT NULL,
  entry_date TEXT, entry_price REAL, exit_date TEXT, ret REAL, status TEXT NOT NULL, reason TEXT, updated_at TEXT,
  PRIMARY KEY (scan_date, scanner, code, variant));
CREATE TABLE IF NOT EXISTS gen_log (ts TEXT, scan_date TEXT, ok INTEGER, reason TEXT, created INTEGER);
"""


def connect(path):
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
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
                cur = conn.execute('INSERT OR IGNORE INTO candidates(scan_date, scanner, code, name, score, base_price, scanned_at, created_at) '
                                   'VALUES (?,?,?,?,?,?,?,?)', (scan_date, key, code, str(it.get('name') or ''),
                                                                 float(it.get('score') or 0), float(price), str(payload.get('scannedAt')), now_iso))
                created += cur.rowcount
    conn.execute('INSERT INTO gen_log VALUES (?,?,?,?,?)', (now_kst.isoformat(timespec='seconds'), scan_date, 1 if ok else 0, reason, created))
    conn.commit()
    return ok, reason, created


def expire_old(conn, today):
    cutoff = (datetime.strptime(today, '%Y-%m-%d') - timedelta(days=STALE_DAYS)).strftime('%Y-%m-%d')
    cur = conn.execute("UPDATE candidates SET status='EXPIRED', reason='STALE' WHERE status='NEW' AND scan_date < ?", (cutoff,))
    conn.commit()
    return cur.rowcount


def paper_enter(conn, get_daily, today):
    """scan_date 다음 거래일 봉이 생긴 NEW 후보를 모의 진입 처리한다(실주문 없음).
    get_daily(code) -> 일봉 리스트(date, open, high, low, close). 시가가 기준가 대비 +2% 이상이면 SKIPPED.
    진입가는 시가*1.002 가정(연구용, 실제 체결 아님)."""
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
        conn.execute('INSERT OR IGNORE INTO paper_trades(scan_date, scanner, code, variant, entry_date, entry_price, status, updated_at) '
                     'VALUES (?,?,?,?,?,?,?,?)', (scan_date, scanner, code, PAPER_VARIANT, nxt['date'], entry, 'OPEN', today))
        n += 1
    conn.commit()
    return n


def paper_settle(conn, get_daily, today):
    """열린 모의 포지션을 exit_study.simulate와 같은 규칙으로 판정한다.
    최대 보유일에 못 미친 데이터 끝 봉에서의 '시간 청산'은 확정하지 않는다(아직 진행 중)."""
    import exit_study as ex
    settled = 0
    rows = conn.execute("SELECT scan_date, scanner, code, variant FROM paper_trades WHERE status='OPEN'").fetchall()
    for scan_date, scanner, code, variant in rows:
        daily = get_daily(code) or []
        i = next((k for k, b in enumerate(daily) if b['date'] == scan_date), None)
        if i is None:
            continue
        res = ex.simulate(daily, i, variant, 'open')
        if res is None:
            continue
        ret, k = res
        start = i + 1
        if not (k < len(daily) - 1 or (k - start + 1) >= MAX_HOLD[variant]):
            continue
        conn.execute('UPDATE paper_trades SET status=?, exit_date=?, ret=?, updated_at=? WHERE scan_date=? AND scanner=? AND code=? AND variant=?',
                     ('CLOSED', daily[k]['date'], ret, today, scan_date, scanner, code, variant))
        settled += 1
    conn.commit()
    return settled


def summary(conn):
    """검색기별 모의 성과(건수·평균 순수익·승률). 백테스트·실거래와 합치지 않는 별도 집계."""
    out = {}
    for scanner, n, avg, win in conn.execute("SELECT scanner, COUNT(*), AVG(ret), AVG(ret>0) FROM paper_trades WHERE status='CLOSED' GROUP BY scanner"):
        out[scanner] = {'closed': n, 'avg': avg, 'win': win}
    return out
