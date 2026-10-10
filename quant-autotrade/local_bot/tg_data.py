# -*- coding: utf-8 -*-
"""텔레그램 알림·명령이 쓰는 데이터 읽기 계층. 전부 읽기 전용이다.

- autotrader.db(봇 이벤트·주문)·research/research.db(후보·모의 거래)는 `mode=ro` 로만 연다. 쓰기 SQL 은 이 모듈에 없다.
- research/status.json 은 연구 작업(별도 프로세스)이 갱신한다. 연구 모듈(candidate_gen 등)을 import 하지 않으므로
  PC 의 봇 폴더(복사본)만으로도 동작한다 - 필요한 값은 DB 와 status.json 에서 읽는다.
- 백테스트·모의매매·실계좌 숫자는 서로 합치지 않는다. 이 모듈은 각각을 따로 돌려준다.
"""
import json
import os
import re
import sqlite3

# 봇이 남기는 이벤트 문구(bot.py)에서 필요한 필드를 꺼낸다. bot.py 의 label 형식이 바뀌면 test_telegram 의 왕복 테스트가 깨진다.
LABEL_RE = re.compile(r'(?P<reason>STOP|TP_CAP|TP_FLOOR) 수익률 (?P<gain>-?\d+(?:\.\d+)?)% \(매입 (?P<avg>\d+) / 현재 (?P<price>\d+), (?P<qty>\d+)주\)')
ORD_NO_RE = re.compile(r'주문번호 (?P<ord_no>\S+?):')


def ro_connect(path, timeout=5):
    if not path or not os.path.exists(path):
        return None
    return sqlite3.connect('file:%s?mode=ro' % path.replace(os.sep, '/'), uri=True, timeout=timeout)


def _rows(conn, sql, params=()):
    cur = conn.execute(sql, params)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def _columns(conn, table):
    return {r[1] for r in conn.execute('PRAGMA table_info(%s)' % table)}


# ---- 봇 이벤트·주문 ----------------------------------------------------------
def parse_label(detail):
    """DRY_SELL/SELL_SENT/주문 거부·실패 이벤트 문구에서 사유·수익률·매입가·현재가·수량을 꺼낸다. 못 읽으면 빈 dict."""
    m = LABEL_RE.search(detail or '')
    if not m:
        return {}
    return {'reason': m.group('reason'), 'gain': float(m.group('gain')), 'avg': float(m.group('avg')), 'price': float(m.group('price')), 'qty': int(m.group('qty'))}


def parse_ord_no(detail):
    m = ORD_NO_RE.search(detail or '')
    return m.group('ord_no') if m else None


def bot_events_since(db_path, last_id, limit=200):
    conn = ro_connect(db_path)
    if conn is None:
        return []
    try:
        return _rows(conn, 'SELECT id, ts, type, code, price, detail FROM events WHERE id>? ORDER BY id LIMIT ?', (last_id, limit))
    finally:
        conn.close()


def bot_events_max_id(db_path):
    conn = ro_connect(db_path)
    if conn is None:
        return 0
    try:
        return conn.execute('SELECT COALESCE(MAX(id),0) FROM events').fetchone()[0]
    finally:
        conn.close()


def orders_today_sent(db_path, code, day):
    conn = ro_connect(db_path)
    if conn is None:
        return 0
    try:
        return conn.execute("SELECT COUNT(*) FROM orders WHERE day=? AND code=? AND status='SENT'", (day, code)).fetchone()[0]
    finally:
        conn.close()


def recent_orders(db_path, limit=10):
    conn = ro_connect(db_path)
    if conn is None:
        return []
    try:
        return _rows(conn, 'SELECT id, ts, day, code, qty, reason, status, ord_no, detail FROM orders ORDER BY id DESC LIMIT ?', (limit,))
    finally:
        conn.close()


def order_error_kind(db_path, order):
    """status=ERROR 주문이 '증권사 거부'인지 '전송 실패'인지 같은 시각의 ERROR 이벤트 문구로 가른다(둘 다 status 는 ERROR 로 저장된다)."""
    conn = ro_connect(db_path)
    if conn is None:
        return 'ERROR'
    try:
        row = conn.execute("SELECT detail FROM events WHERE type='ERROR' AND code=? AND ts>=? ORDER BY id LIMIT 1", (order['code'], order['ts'])).fetchone()
    finally:
        conn.close()
    text = row[0] if row else ''
    if text.startswith('매도 주문 거부'):
        return 'REJECTED'
    if text.startswith('매도 주문 실패'):
        return 'FAILED'
    return 'ERROR'


# ---- 연구 상태·후보·모의 -----------------------------------------------------
def read_status_json(research_dir):
    path = os.path.join(research_dir, 'status.json')
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def research_db_path(research_dir):
    return os.path.join(research_dir, 'research.db')


def gen_log_since(research_dir, last_rowid):
    conn = ro_connect(research_db_path(research_dir))
    if conn is None:
        return []
    try:
        return _rows(conn, 'SELECT rowid AS rid, ts, scan_date, ok, reason, created FROM gen_log WHERE rowid>? ORDER BY rowid', (last_rowid,))
    except sqlite3.Error:
        return []
    finally:
        conn.close()


def candidates_for(research_dir, scan_date):
    conn = ro_connect(research_db_path(research_dir))
    if conn is None:
        return []
    try:
        have = _columns(conn, 'candidates')
        reasons = 'reasons' if 'reasons' in have else 'NULL AS reasons'
        return _rows(conn, 'SELECT scan_date, scanner, code, name, score, base_price, status, reason, %s, scanned_at, created_at FROM candidates '
                           'WHERE scan_date=? ORDER BY scanner, score DESC' % reasons, (scan_date,))
    except sqlite3.Error:
        return []
    finally:
        conn.close()


def latest_candidate_date(research_dir):
    conn = ro_connect(research_db_path(research_dir))
    if conn is None:
        return None
    try:
        return conn.execute('SELECT MAX(scan_date) FROM candidates').fetchone()[0]
    except sqlite3.Error:
        return None
    finally:
        conn.close()


def latest_ok_gen(research_dir):
    """가장 최근에 성공한 후보 생성 기록(scan_date, ts, created)."""
    conn = ro_connect(research_db_path(research_dir))
    if conn is None:
        return None
    try:
        rows = _rows(conn, 'SELECT ts, scan_date, created, reason FROM gen_log WHERE ok=1 ORDER BY rowid DESC LIMIT 1')
        return rows[0] if rows else None
    except sqlite3.Error:
        return None
    finally:
        conn.close()


def scanned_count(research_dir, scan_date):
    """그날 스캔이 처리한 종목 수(scan_seen.scanned). 같은 날 여러 번 저장됐으면 마지막 값."""
    conn = ro_connect(research_db_path(research_dir))
    if conn is None:
        return None
    try:
        row = conn.execute("SELECT scanned, scanned_at FROM scan_seen WHERE ok=1 ORDER BY first_seen DESC LIMIT 1").fetchone()
        return {'scanned': row[0], 'scannedAt': row[1]} if row else None
    except sqlite3.Error:
        return None
    finally:
        conn.close()


PAPER_FIELDS = ('scan_date', 'scanner', 'code', 'name', 'variant', 'entry_date', 'entry_price', 'stop_price', 'trail_price', 'signal_date', 'exit_date',
                'exit_price', 'ret', 'exit_reason', 'hold_days', 'status', 'last_bar_date', 'note')


def paper_rows(research_dir):
    conn = ro_connect(research_db_path(research_dir))
    if conn is None:
        return []
    try:
        if 'exit_reason' not in _columns(conn, 'paper_trades'):
            return []
        return _rows(conn, 'SELECT t.scan_date, t.scanner, t.code, c.name, t.variant, t.entry_date, t.entry_price, t.stop_price, t.trail_price, t.signal_date, '
                           't.exit_date, t.exit_price, t.ret, t.exit_reason, t.hold_days, t.status, t.last_bar_date, t.note '
                           'FROM paper_trades t LEFT JOIN candidates c ON c.scan_date=t.scan_date AND c.scanner=t.scanner AND c.code=t.code '
                           'ORDER BY t.scan_date, t.scanner, t.code, t.variant')
    except sqlite3.Error:
        return []
    finally:
        conn.close()


def candidate_status_counts(research_dir):
    conn = ro_connect(research_db_path(research_dir))
    if conn is None:
        return {}
    try:
        return {r[0]: r[1] for r in conn.execute('SELECT status, COUNT(*) FROM candidates GROUP BY status')}
    except sqlite3.Error:
        return {}
    finally:
        conn.close()


def diff_paper(rows, seen, first_run):
    """모의 거래 상태 변화를 사건으로 바꾼다(순수 함수).

    rows : paper_rows() 결과, seen : {키: 상태문자열}(마지막으로 본 상태), first_run : True 면 기준선만 만들고 사건은 내지 않는다.
    반환 (사건 목록, seen 갱신 쌍). 사건: {'kind': 'entry'|'signal'|'close', ...}
      entry  후보 단위(전략 3개가 같은 진입을 공유). 모든 전략 행이 판정을 마친 뒤(last_bar_date 있음)에만 낸다 - 손절선이 비어 있는 진입을 알리지 않는다.
      signal 종가로 청산 신호가 났지만 다음 거래일 시가 봉이 아직 없음(PENDING_EXIT).
      close  청산 확정(CLOSED).
    """
    events, updates = [], []
    by_cand = {}
    for r in rows:
        by_cand.setdefault((r['scan_date'], r['scanner'], r['code']), []).append(r)
    for ckey, group in by_cand.items():
        if any(not r.get('last_bar_date') for r in group):
            continue         # 이번 갱신이 아직 끝나지 않은 후보는 다음 확인 때 본다
        cand_id = 'cand|%s|%s|%s' % ckey
        entered = bool(group[0].get('entry_date'))
        if entered and cand_id not in seen:
            updates.append((cand_id, 'entered'))
            if not first_run:
                head = group[0]
                events.append({'kind': 'entry', 'scan_date': head['scan_date'], 'scanner': head['scanner'], 'code': head['code'], 'name': head.get('name'),
                               'entry_date': head['entry_date'], 'entry_price': head['entry_price'],
                               'variants': {r['variant']: {'stop_price': r.get('stop_price'), 'trail_price': r.get('trail_price')} for r in group}})
        for r in group:
            key = 'var|%s|%s|%s|%s' % (r['scan_date'], r['scanner'], r['code'], r['variant'])
            state = '|'.join(str(r.get(f) or '') for f in ('status', 'entry_date', 'signal_date', 'exit_date'))
            old = seen.get(key)
            if old == state:
                continue
            updates.append((key, state))
            old_status = old.split('|')[0] if old else None
            if first_run:
                continue
            common = {'scan_date': r['scan_date'], 'scanner': r['scanner'], 'code': r['code'], 'name': r.get('name'), 'variant': r['variant']}
            if r['status'] == 'PENDING_EXIT' and old_status != 'PENDING_EXIT':
                events.append(dict(common, kind='signal', signal_date=r.get('signal_date'), trail_price=r.get('trail_price'), note=r.get('note')))
            elif r['status'] == 'CLOSED' and old_status != 'CLOSED':
                events.append(dict(common, kind='close', entry_date=r.get('entry_date'), entry_price=r.get('entry_price'), exit_date=r.get('exit_date'),
                                   exit_price=r.get('exit_price'), ret=r.get('ret'), exit_reason=r.get('exit_reason'), hold_days=r.get('hold_days'),
                                   signal_date=r.get('signal_date')))
    return events, updates


def track_partial_fills(holdings, known_qty, watched):
    """감시 종목의 보유 수량이 줄었지만 0은 아닌 경우를 찾는다(순수 함수). 전량 소멸은 봇의 POSITION_CLOSED 이벤트가 알린다.
    반환 (사건 목록, 새 known_qty)."""
    events, new_known = [], {}
    for h in holdings:
        code = h['code']
        if code not in watched:
            continue
        new_known[code] = h['qty']
        before = known_qty.get(code)
        if before is not None and 0 < h['qty'] < before:
            events.append({'code': code, 'name': h.get('name'), 'before': before, 'after': h['qty'], 'price': h.get('price')})
    return events, new_known
