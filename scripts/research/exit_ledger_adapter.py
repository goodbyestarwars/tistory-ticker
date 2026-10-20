# -*- coding: utf-8 -*-
"""실계좌 장부(live_orders.db) 읽기 전용 어댑터 (연구용, 2026-10-21).

- 원본은 `file:...?mode=ro` 로만 연다. 테이블 추가·UPDATE·DELETE·VACUUM 없음. 스냅샷은 SQLite 온라인 백업 API 로 별도 폴더에 만든다.
- 주문 판정 기록(intents)과 실제 체결(order_fills.json)을 구분한다: ACK 는 접수일 뿐 체결이 아니다. 체결가가 없으면 `fill_confirmed=False`
  이고 진입가는 의도가(intents.price)로 쓰되 그렇게 표시한다.
- 검색기 출처는 장부 note(JSON)의 명시 필드 또는 research.db 포착 이력에서만 가져온다. 없으면 '출처 미확인'(추정 금지).
- 출력에서 주문번호(order_no)·계좌 정보는 읽지도 내보내지도 않는다.
"""
import hashlib
import json
import os
import sqlite3

SCANNER_KEYS = ('scanner', 'source', 'pattern', 'pattern_id', '검색기')
RANK_KEYS = ('rank', '순위')
BASE_KEYS = ('base', 'base_price', 'basePrice')
UNKNOWN = '출처 미확인'


def open_ro(path):
    return sqlite3.connect('file:%s?mode=ro' % path.replace('\\', '/'), uri=True, timeout=5)


def snapshot(src, dest):
    """원본을 읽기 전용으로 열어 온라인 백업으로 dest 에 복사한다(원본 잠금 없음)."""
    os.makedirs(os.path.dirname(os.path.abspath(dest)), exist_ok=True)
    s = open_ro(src)
    try:
        d = sqlite3.connect(dest)
        try:
            s.backup(d)
        finally:
            d.close()
    finally:
        s.close()
    return dest


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest().upper()


def _first(d, keys):
    for k in keys:
        if isinstance(d, dict) and d.get(k) not in (None, ''):
            return d[k]
    return None


def _note(raw):
    try:
        v = json.loads(raw) if raw else None
    except (TypeError, ValueError):
        return {}
    return v if isinstance(v, dict) else {}


def load_fills(folder):
    try:
        fills = json.load(open(os.path.join(folder, 'order_fills.json'), encoding='utf-8')).get('fills') or []
    except (OSError, ValueError):
        return {}
    return {(f.get('date'), f.get('code'), f.get('side')): f.get('price') for f in fills if f.get('price')}


def research_scanner(research_db, code, scan_date_hint):
    """research.db 에서 (code, 포착일) 검색기를 찾는다. 스키마를 가정하지 않고 code+검색기 열이 있는 테이블만 쓴다. 못 찾으면 None."""
    if not research_db or not os.path.exists(research_db):
        return None
    db = open_ro(research_db)
    try:
        for (table,) in db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall():
            cols = [r[1] for r in db.execute('PRAGMA table_info("%s")' % table)]
            sc = next((c for c in cols if c.lower() in ('scanner', 'pattern', 'pattern_id')), None)
            dc = next((c for c in cols if c.lower() in ('scandate', 'scan_date', 'day', 'date')), None)
            if 'code' in [c.lower() for c in cols] and sc and dc:
                code_col = next(c for c in cols if c.lower() == 'code')
                row = db.execute('SELECT "%s" FROM "%s" WHERE "%s"=? AND "%s"<=? ORDER BY "%s" DESC LIMIT 1' % (sc, table, code_col, dc, dc),
                                 (code, scan_date_hint)).fetchone()
                if row and row[0]:
                    return str(row[0])
    except sqlite3.Error:
        return None
    finally:
        db.close()
    return None


def read_trades(ledger_path, fills=None, research_db=None):
    """BUY 마다 같은 종목의 다음 SELL(다음 BUY 이전)을 짝지어 거래 목록을 만든다."""
    fills = fills or {}
    db = open_ro(ledger_path)
    try:
        cols = {r[1] for r in db.execute('PRAGMA table_info(intents)')}
        sel = 'id, ts, code, side, qty, price, state' + (', reason' if 'reason' in cols else ", NULL") + (', note' if 'note' in cols else ', NULL')
        rows = db.execute('SELECT %s FROM intents ORDER BY id' % sel).fetchall()
    finally:
        db.close()
    trades = []
    for i, (rid, ts, code, side, qty, price, state, reason, note) in enumerate(rows):
        if side != 'BUY':
            continue
        nxt_buy = next((r[0] for r in rows[i + 1:] if r[2] == code and r[3] == 'BUY'), None)
        sell = next((r for r in rows[i + 1:] if r[2] == code and r[3] == 'SELL' and (nxt_buy is None or r[0] < nxt_buy)), None)
        bn = _note(note)
        scanner = _first(bn, SCANNER_KEYS)
        origin = 'ledger_note' if scanner else None
        if not scanner:
            scanner = research_scanner(research_db, code, ts[:10])
            origin = 'research_db' if scanner else None
        day = ts[:10]
        buy_fill = fills.get((day, code, 'BUY'))
        t = {'id': rid, 'code': code, 'buy_ts': ts, 'buy_state': state, 'buy_qty': qty, 'buy_intent_price': price,
             'buy_price': buy_fill or price, 'buy_fill_confirmed': bool(buy_fill), 'buy_reason': reason,
             'scanner': (str(scanner).replace('pattern:', '') if scanner else UNKNOWN), 'scanner_origin': origin or 'none',
             'rank': _first(bn, RANK_KEYS), 'base': _first(bn, BASE_KEYS), 'sell_ts': None}
        if sell:
            sn = _note(sell[8])
            sday = sell[1][:10]
            sfill = fills.get((sday, code, 'SELL'))
            t.update({'sell_id': sell[0], 'sell_ts': sell[1], 'sell_state': sell[6], 'sell_reason': sell[7],
                      'sell_decision_price': sell[5], 'sell_fill': sfill, 'sell_fill_confirmed': bool(sfill),
                      'sell_gain_pct': _first(sn, ('gain_pct', 'gain', 'ret_pct', '수익률')), 'sell_peak': _first(sn, ('peak', 'peak_price', '고점')),
                      'sell_hits': _first(sn, ('hits', 'exit_hits', '확인'))})
        trades.append(t)
    return trades


def to_entries(trades, calendar, extra_days=3):
    """분석 가능한 실제 매수(ACK, 가격 있음)만 simulate 용 진입으로 바꾼다. 제외 사유는 skipped 에 남긴다."""
    entries, skipped = [], []
    for t in trades:
        why = None
        if t['buy_state'] != 'ACK':
            why = 'BUY_NOT_ACK(%s)' % t['buy_state']
        elif not t['buy_price']:
            why = 'NO_PRICE'
        else:
            day = t['buy_ts'][:10]
            later = [d for d in calendar if d >= day]
            if not later or later[0] != day:
                why = 'BUY_DAY_NOT_IN_CALENDAR'
        if why:
            skipped.append({'code': t['code'], 'buy_ts': t['buy_ts'], 'reason': why})
            continue
        last = t['sell_ts'][:10] if t.get('sell_ts') else calendar[-1]
        span = [d for d in calendar if day <= d <= last]
        after = [d for d in calendar if d > last][:extra_days]
        scan_dates = [d for d in calendar if d < day]
        entries.append({'real': True, 'trade_id': t['id'], 'code': t['code'], 'name': None, 'scanner': t['scanner'], 'rank': t['rank'], 'base': t['base'],
                        'entry_day': day, 'days': span + after, 'actual_last_day': last, 'scan_date': scan_dates[-1] if scan_dates else day,
                        'entry_hhmm': t['buy_ts'][11:13] + t['buy_ts'][14:16], 'entry_fill_price': float(t['buy_price']),
                        'fill_confirmed': t['buy_fill_confirmed'], 'actual': {k: t.get(k) for k in (
                            'sell_ts', 'sell_state', 'sell_reason', 'sell_decision_price', 'sell_fill', 'sell_fill_confirmed', 'sell_gain_pct', 'sell_peak', 'sell_hits')}})
    return entries, skipped
