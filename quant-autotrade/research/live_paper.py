# -*- coding: utf-8 -*-
"""장중 실시간 페이퍼 트레이딩 엔진 (2026-10-12). **실주문 없음** - 주문 API를 호출하는 코드가 이 파일에 없다.

종가 데이터로 사후 계산하는 기존 모의매매(candidate_gen.paper_*, 'B 일봉 사후')와 별개로, 장중에 **실제로 관측한 시세와 시각**으로 가상 체결을 만든다('C 장중 실시간').
C의 체결은 시장 체결이 아니라 '관측가 + 슬리피지 가정'의 **가상 체결**이다. 모든 행에 simulationType='LIVE_PAPER' 와 체결 가정(assumptions)을 남긴다.

규칙 요약
- 후보: 직전 거래일(KRX 달력) 장 마감 스캔이 만든 `candidates`(scan_date = 직전 거래일). 검색기별 점수 체계가 달라 원점수로 섞어 정렬하지 않고
  검색기 안의 순위(rank_norm)로 번갈아 배치한다. 같은 종목이 여러 검색기에 나오면 앞 순위만 사고 나머지는 중복으로 기록한다.
- 진입: 09:00 이후 **처음 관측한 신선한 시세**(진입 마감 entry_deadline 이전)에 관측가×(1+진입 슬리피지)로 가상 매수. 특정 '최적 시각'을 쓰지 않는다.
  시세가 없으면 미체결(DATA_UNAVAILABLE)로 남기고 마감이 지나면 그날은 포기한다. 기준가 대비 +2% 이상 갭은 SKIPPED(연구 모델과 동일).
- 자금: 전략(청산 방식)마다 **독립 계좌**. 동시 5종목·종목당 10%·총투자 30%(allocation.entry_size). 매도 체결 대금만 현금.
- 청산: paper_exits 와 같은 3전략.
    trail_atr  장중 관측가가 ATR 추적선 이하이면 가상 매도(관측가×(1−슬리피지)). 최대 30거래일(마지막 날 확정 종가).
    atr_close  확정 일봉 종가가 추적선 아래이면 신호 → 다음 거래일 처음 관측한 시세에 매도. 미확정 장중 가격으로는 신호를 확정하지 않는다.
    dead35     확정 일봉 MA3가 MA5 아래로 교차하면 신호 → 다음 거래일 처음 관측한 시세에 매도.
  선택 대조군 fix3_5(−3%/+5%)는 기본 꺼짐이며 검증된 전략이 아니다.
- 데이터가 없으면 위조하지 않는다: 시세 단절 중에는 신규 진입 보류, 단절 동안 놓친 추적선 이탈은 일봉으로 사후 발견해도 관측 체결로 쓰지 않고
  PENDING_EXIT(STOP_BREACH_UNOBSERVED) 후 다음 거래일 관측가로 체결한다.
- 모든 체결·계좌 변경은 SQLite 트랜잭션 하나로 원자적이다. UNIQUE 키로 같은 신호의 중복 매수를 막는다(재시작해도 동일).
"""
import json
import math
import os
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
for _p in (HERE, os.path.join(REPO, 'quant-autotrade', 'backtest'), os.path.join(REPO, 'scripts', 'analysis'), os.path.join(REPO, 'scripts', 'cloud-vm')):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import allocation  # noqa: E402
import exit_study as ex  # noqa: E402
import krx_calendar  # noqa: E402
import paper_exits  # noqa: E402

KST = timezone(timedelta(hours=9))
SIM_TYPE = 'LIVE_PAPER'
STRATEGIES = tuple(paper_exits.PRIMARY_ORDER)          # trail_atr, atr_close, dead35
CONTROL_STRATEGY = 'fix3_5'                            # 선택 대조군(기본 꺼짐)
SCANNER_ORDER = ('pullback', 'maCloudBreakout', 'doubleBottom', 'invHeadShoulders')
MAX_HOLD = {'trail_atr': 30, 'atr_close': 150, 'dead35': 150, CONTROL_STRATEGY: 30}


class Config:
    """설정값. 기본값은 기존 연구(백테스트·paper_exits)와 비교 가능하게 맞췄다."""
    def __init__(self, **kw):
        self.initial_cash = 10_000_000
        self.limits = dict(allocation.LIMITS)
        self.entry_slip = ex.ENTRY_SLIP            # 0.2%  (호가가 없어 관측가 기준 가정. 호가를 쓰게 되면 0으로 두어 이중 차감을 막는다)
        self.exit_slip = ex.EXIT_SLIP              # 0.3%
        self.cost = ex.COST                        # 왕복 0.4%(수수료·세금 가정) - 연구와 동일하게 순수익률에서 차감
        self.gap_skip = ex.GAP_SKIP                # 기준가 대비 +2% 이상이면 진입 안 함
        self.session_open = (9, 0)
        self.entry_deadline = (9, 30)              # 이 시각 이후엔 새로 진입하지 않는다(연구 모델의 '시가 진입'과 비교 가능한 범위)
        self.stop_check_end = (15, 20)             # 장 마감 동시호가(15:20~) 가격은 손절 판정에 쓰지 않는다
        self.session_close = (15, 30)
        self.eod_after = (15, 45)                  # 이후 확정 일봉으로 신호·보유일 갱신
        self.stale_quote_sec = 150                 # 시세 관측 시각이 이보다 오래되면 '신선하지 않음'
        self.feed_down_sec = 180                   # 장중 이 시간 동안 시세를 못 받으면 단절로 본다
        self.max_watch = 30                        # 감시(진입 시도) 후보 상한. 시세 조회 부하 제한
        self.control_strategies = ()               # ('fix3_5',) 로 켜면 대조군 계좌 추가
        self.fix_stop, self.fix_target = -0.03, 0.05
        for k, v in kw.items():
            if not hasattr(self, k):
                raise AttributeError(k)
            setattr(self, k, v)

    @property
    def strategies(self):
        return STRATEGIES + tuple(self.control_strategies)

    def assumptions(self):
        return {'fill': '관측 시세(1분봉 종가) 기준 가상 체결', 'orderbook': '미사용(호가 필드 미검증)', 'entrySlip': self.entry_slip,
                'exitSlip': self.exit_slip, 'costRoundTrip': self.cost, 'gapSkip': self.gap_skip, 'entryDeadline': '%02d:%02d' % self.entry_deadline,
                'restrictions': '거래정지·관리종목 여부는 별도 조회하지 않음(시세 미수신 시 미체결 처리)'}


SCHEMA = """
CREATE TABLE IF NOT EXISTS lp_accounts (strategy_id TEXT PRIMARY KEY, initial_cash REAL NOT NULL, cash REAL NOT NULL, realized_pnl REAL NOT NULL DEFAULT 0,
  created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS lp_selection (scan_date TEXT NOT NULL, scanner TEXT NOT NULL, code TEXT NOT NULL, name TEXT, score REAL, rank_in_scanner INTEGER,
  rank_norm REAL, base_price REAL, decision TEXT NOT NULL, reason TEXT, decided_at TEXT, PRIMARY KEY (scan_date, scanner, code));
CREATE TABLE IF NOT EXISTS lp_decisions (strategy_id TEXT NOT NULL, scan_date TEXT NOT NULL, scanner TEXT NOT NULL, code TEXT NOT NULL,
  decision TEXT NOT NULL, reason TEXT, ts TEXT, PRIMARY KEY (strategy_id, scan_date, scanner, code));
CREATE TABLE IF NOT EXISTS lp_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, strategy_id TEXT NOT NULL, scan_date TEXT NOT NULL, scanner TEXT NOT NULL, code TEXT NOT NULL, name TEXT,
  simulation_type TEXT NOT NULL DEFAULT 'LIVE_PAPER', qty INTEGER NOT NULL, entry_ts TEXT NOT NULL, entry_date TEXT NOT NULL, entry_price REAL NOT NULL,
  quote_price REAL, quote_ts TEXT, quality TEXT, atr REAL, hh REAL, stop_price REAL, trail_price REAL, status TEXT NOT NULL,
  signal_date TEXT, signal_reason TEXT, exit_ts TEXT, exit_price REAL, exit_reason TEXT, gross_ret REAL, net_ret REAL, pnl_krw REAL, fee_krw REAL,
  last_price REAL, last_ts TEXT, last_bar_date TEXT, hold_days INTEGER NOT NULL DEFAULT 0, max_hold INTEGER, assumptions TEXT,
  UNIQUE (strategy_id, code, scan_date));
CREATE TABLE IF NOT EXISTS lp_events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, kind TEXT NOT NULL, strategy_id TEXT, code TEXT,
  level TEXT NOT NULL DEFAULT 'info', payload TEXT, dedupe_key TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS lp_equity (strategy_id TEXT NOT NULL, date TEXT NOT NULL, equity REAL, cash REAL, invested REAL, positions INTEGER,
  realized_pnl REAL, PRIMARY KEY (strategy_id, date));
CREATE TABLE IF NOT EXISTS lp_kv (k TEXT PRIMARY KEY, v TEXT);
"""


def ensure_schema(conn):
    conn.executescript(SCHEMA)
    conn.commit()


def _iso(dt):
    return dt.isoformat(timespec='seconds')


def _hm(dt):
    return (dt.hour, dt.minute)


def live_sell_active(environ=None):
    """로컬 봇의 LIVE_SELL(실주문 매도 스위치)이 켜져 있는가. 켜져 있으면 이 엔진은 돌지 않는다."""
    env = os.environ if environ is None else environ
    return str(env.get('LIVE_SELL', '')).strip().lower() in ('1', 'true', 'yes', 'on')


def order_candidates(rows):
    """rows: dict(scanner, code, score ...). 검색기별로 점수 순위를 매기고(원점수를 검색기 사이에서 비교하지 않음) 순위 위치 → 검색기 순서로 번갈아 배치한다.
    같은 종목이 이미 앞 순위로 나왔으면 decision 후보에서 제외할 수 있도록 dup 표시를 단다."""
    by = {}
    for r in rows:
        by.setdefault(r['scanner'], []).append(dict(r))
    out = []
    for sc, items in by.items():
        items.sort(key=lambda r: (-(r.get('score') or 0), r['code']))
        n = len(items)
        for i, r in enumerate(items):
            r['rank_in_scanner'] = i
            r['rank_norm'] = 1.0 - (i / n if n else 0.0)
            out.append(r)
    order = {s: k for k, s in enumerate(SCANNER_ORDER)}
    out.sort(key=lambda r: (r['rank_in_scanner'], order.get(r['scanner'], 99), r['code']))
    seen = set()
    for r in out:
        r['dup'] = r['code'] in seen
        seen.add(r['code'])
    return out


class Engine:
    """quotes.quote(code) -> {'price': float, 'ts': datetime(KST)|None, 'source': str}  (실패 시 예외)
    get_daily(code) -> 오름차순 일봉 [{date, open, high, low, close}] (확정 여부는 엔진이 날짜로 판단)"""

    def __init__(self, conn, quotes, get_daily, cfg=None, environ=None):
        self.conn, self.quotes, self.get_daily = conn, quotes, get_daily
        self.cfg = cfg or Config()
        self.environ = environ
        ensure_schema(conn)
        self.halted = None
        self._last_ok = None            # 마지막으로 시세를 성공 수신한 시각
        self._feed_down = False
        self._daily_cache = {}

    # ---- 기록 --------------------------------------------------------------
    def event(self, ts, kind, strategy=None, code=None, level='info', payload=None, key=None):
        cur = self.conn.execute('INSERT OR IGNORE INTO lp_events(ts, kind, strategy_id, code, level, payload, dedupe_key) VALUES (?,?,?,?,?,?,?)',
                                (_iso(ts), kind, strategy, code, level, json.dumps(payload or {}, ensure_ascii=False), key))
        return cur.rowcount

    def kv(self, k, default=None):
        r = self.conn.execute('SELECT v FROM lp_kv WHERE k=?', (k,)).fetchone()
        return r[0] if r else default

    def set_kv(self, k, v):
        self.conn.execute('INSERT INTO lp_kv(k, v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', (k, str(v)))

    # ---- 시작·안전 확인 -------------------------------------------------------
    def start(self, now):
        """계좌를 만들고(없을 때만), 안전 조건을 확인한다. 거래일이 아니거나 LIVE_SELL 이 켜져 있으면 halted 에 이유를 남기고 아무것도 하지 않는다."""
        with self.conn:
            for sid in self.cfg.strategies:
                self.conn.execute('INSERT OR IGNORE INTO lp_accounts(strategy_id, initial_cash, cash, created_at, updated_at) VALUES (?,?,?,?,?)',
                                  (sid, self.cfg.initial_cash, self.cfg.initial_cash, _iso(now), _iso(now)))
            restart = self.kv('last_start_date') == now.strftime('%Y-%m-%d')
            self.set_kv('last_start_date', now.strftime('%Y-%m-%d'))
            if live_sell_active(self.environ):
                self.halted = 'LIVE_SELL_ACTIVE'
                self.event(now, 'LIVE_SELL_ACTIVE', level='critical', payload={'msg': '실주문 스위치(LIVE_SELL)가 켜져 있어 모의매매 엔진을 중지했습니다'},
                           key='live_sell:%s' % now.strftime('%Y-%m-%d'))
                return self.halted
            try:
                if not krx_calendar.is_trading_day(now):
                    self.halted = 'NOT_TRADING_DAY'
                    return self.halted
            except krx_calendar.CalendarUnknown as exc:
                self.halted = 'CALENDAR_UNKNOWN'
                self.event(now, 'CALENDAR_ERROR', level='error', payload={'msg': str(exc)}, key='calendar:%s' % now.strftime('%Y-%m-%d'))
                return self.halted
            self.halted = None
            self.event(now, 'ENGINE_RESTART' if restart else 'ENGINE_START', payload={'strategies': list(self.cfg.strategies)},
                       key='start:%s:%s' % (now.strftime('%Y-%m-%d'), now.strftime('%H%M%S')))
        return None

    # ---- 후보 선정 -----------------------------------------------------------
    def load_candidates(self, now):
        """직전 거래일 스캔의 후보를 가져와 선정/제외를 이유와 함께 기록한다. 반환: 진입 시도 순서의 후보 목록."""
        today = now.strftime('%Y-%m-%d')
        scan_date = krx_calendar.prev_trading_day(now).strftime('%Y-%m-%d')
        rows = [dict(zip(('scanner', 'code', 'name', 'score', 'base_price'), r)) for r in self.conn.execute(
            'SELECT scanner, code, name, score, base_price FROM candidates WHERE scan_date=?', (scan_date,))]
        with self.conn:
            if not rows:
                self.event(now, 'NO_CANDIDATES', level='warn', payload={'scan_date': scan_date, 'msg': '직전 거래일 스캔 후보가 없어 오늘은 진입하지 않습니다'},
                           key='nocand:%s' % today)
                return []
            ordered = order_candidates(rows)
            picked = []
            for r in ordered:
                if r['dup']:
                    dec, why = 'EXCLUDED', 'DUPLICATE_SIGNAL(다른 검색기에서 먼저 선정)'
                elif len(picked) >= self.cfg.max_watch:
                    dec, why = 'EXCLUDED', 'WATCH_CAP(%d)' % self.cfg.max_watch
                else:
                    dec, why = 'SELECTED', 'RANK_%d_OF_%s' % (r['rank_in_scanner'] + 1, r['scanner'])
                    picked.append(r)
                self.conn.execute('INSERT OR IGNORE INTO lp_selection(scan_date, scanner, code, name, score, rank_in_scanner, rank_norm, base_price, decision, reason, decided_at) '
                                  'VALUES (?,?,?,?,?,?,?,?,?,?,?)', (scan_date, r['scanner'], r['code'], r['name'], r['score'], r['rank_in_scanner'], r['rank_norm'],
                                                                     r['base_price'], dec, why, _iso(now)))
            per = {}
            for r in picked:
                per[r['scanner']] = per.get(r['scanner'], 0) + 1
            self.event(now, 'CANDIDATES_SELECTED', payload={'scan_date': scan_date, 'selected': len(picked), 'excluded': len(ordered) - len(picked), 'byScanner': per},
                       key='selected:%s' % today)
        for r in picked:
            r['scan_date'] = scan_date
        return picked

    # ---- 시세 ---------------------------------------------------------------
    def fresh_quote(self, now, code, cache=None):
        """신선한 관측 시세 또는 None. 단절 상태는 호출한 쪽(tick)이 관리한다. 같은 tick 안에서는 코드별로 한 번만 조회한다."""
        if cache is not None and code in cache:
            return cache[code]
        q = None
        try:
            raw = self.quotes.quote(code)
            ts = raw.get('ts')
            px = raw.get('price')
            if px and ts and ts.date() == now.date() and _hm(ts) >= self.cfg.session_open and (now - ts).total_seconds() <= self.cfg.stale_quote_sec:
                q = {'price': float(px), 'ts': ts, 'source': raw.get('source', '?')}
        except Exception:
            q = None
        if cache is not None:
            cache[code] = q
        return q

    def _feed_state(self, now, cache):
        """시세 수신 성공/실패를 모아 단절·복구 이벤트를 만든다. 장중에만 판단한다."""
        if any(v for v in cache.values()):
            self._last_ok = now
            if self._feed_down:
                self._feed_down = False
                with self.conn:
                    self.event(now, 'FEED_RECOVERED', level='info', payload={'msg': '시세 수신 복구. 단절 구간은 채우지 않습니다'}, key='feedup:%s' % _iso(now))
        elif cache:
            ref = self._last_ok or datetime.strptime(now.strftime('%Y-%m-%d'), '%Y-%m-%d').replace(tzinfo=KST, hour=self.cfg.session_open[0], minute=self.cfg.session_open[1])
            if (now - ref).total_seconds() >= self.cfg.feed_down_sec and not self._feed_down:
                self._feed_down = True
                with self.conn:
                    self.event(now, 'FEED_DOWN', level='error', payload={'since': _iso(ref), 'msg': '시세 수신 중단: 신규 진입 보류'}, key='feeddown:%s' % _iso(now))

    @property
    def feed_ok(self):
        return not self._feed_down

    # ---- 계좌 ---------------------------------------------------------------
    def account(self, sid):
        r = self.conn.execute('SELECT initial_cash, cash, realized_pnl FROM lp_accounts WHERE strategy_id=?', (sid,)).fetchone()
        return {'initial': r[0], 'cash': r[1], 'realized': r[2]}

    def holdings(self, sid):
        return self.conn.execute("SELECT id, code, qty, entry_price, last_price, status FROM lp_positions WHERE strategy_id=? AND status IN ('OPEN','PENDING_EXIT')", (sid,)).fetchall()

    def equity(self, sid):
        """평가자산 = 예수금 + 보유 평가액(마지막 관측가, 없으면 매입가). 실현손익은 이미 예수금에 반영돼 있다."""
        acct = self.account(sid)
        pos = self.holdings(sid)
        mv = sum(p[2] * (p[4] or p[3]) for p in pos)
        invested = sum(p[2] * p[3] for p in pos)
        return acct['cash'] + mv, invested, len(pos)

    # ---- 진입 ---------------------------------------------------------------
    def try_entries(self, now, cands, cache):
        """아직 결정되지 않은 (전략, 후보)마다 진입을 시도한다. 반환: 새 가상 매수 건수."""
        if not cands or self.halted:
            return 0
        deadline = now.replace(hour=self.cfg.entry_deadline[0], minute=self.cfg.entry_deadline[1], second=0, microsecond=0)
        opened = now.replace(hour=self.cfg.session_open[0], minute=self.cfg.session_open[1], second=0, microsecond=0)
        if now < opened:
            return 0
        bought = 0
        for r in cands:
            for sid in self.cfg.strategies:
                key = (sid, r['scan_date'], r['scanner'], r['code'])
                if self.conn.execute('SELECT 1 FROM lp_decisions WHERE strategy_id=? AND scan_date=? AND scanner=? AND code=?', key).fetchone():
                    continue
                if now > deadline:
                    self._decide(now, key, 'UNFILLED', 'ENTRY_WINDOW_CLOSED(DATA_UNAVAILABLE)')
                    continue
                if not self.feed_ok:
                    continue                                      # 단절 중 신규 진입 보류(마감 전이면 복구 후 다시 시도)
                q = self.fresh_quote(now, r['code'], cache)
                if not q:
                    continue
                bought += 1 if self._enter(now, sid, r, q) else 0
        return bought

    def _decide(self, now, key, decision, reason):
        with self.conn:
            self.conn.execute('INSERT OR IGNORE INTO lp_decisions(strategy_id, scan_date, scanner, code, decision, reason, ts) VALUES (?,?,?,?,?,?,?)',
                              key + (decision, reason, _iso(now)))

    def _atr(self, code, scan_date):
        if code not in self._daily_cache:
            try:
                self._daily_cache[code] = self.get_daily(code) or []
            except Exception:
                self._daily_cache[code] = []
        daily = self._daily_cache[code]
        i = next((k for k, b in enumerate(daily) if b['date'] == scan_date), None)
        if i is None or i < 15:
            return None
        return ex.atr14(daily, i) or None

    def _enter(self, now, sid, r, q):
        key = (sid, r['scan_date'], r['scanner'], r['code'])
        price = q['price']
        base = r.get('base_price')
        if base and price / base - 1 >= self.cfg.gap_skip:
            self._decide(now, key, 'SKIPPED', 'GAP>=%.0f%%' % (self.cfg.gap_skip * 100))
            return False
        atr = None
        if sid in ('trail_atr', 'atr_close'):
            atr = self._atr(r['code'], r['scan_date'])
            if not atr:
                self._decide(now, key, 'UNFILLED', 'ATR_UNAVAILABLE(DATA_UNAVAILABLE)')
                return False
        entry = price * (1 + self.cfg.entry_slip)
        equity, invested, npos = self.equity(sid)
        acct = self.account(sid)
        held = {p[1] for p in self.holdings(sid)}
        size, reason = allocation.entry_size(1.0, acct['cash'] / equity, invested / equity, npos, held, r['code'], self.cfg.limits)
        if reason:
            self._decide(now, key, 'REJECTED', reason)
            return False
        qty = int(math.floor(size * equity / entry))
        if qty < 1:
            self._decide(now, key, 'REJECTED', 'SIZE_TOO_SMALL')
            return False
        cost = qty * entry
        trail = (entry - paper_exits.ATR_MULT * atr) if atr else None
        stop = trail if sid in ('trail_atr', 'atr_close') else (entry * (1 + self.cfg.fix_stop) if sid == CONTROL_STRATEGY else None)
        assumptions = json.dumps(self.cfg.assumptions(), ensure_ascii=False)
        try:
            with self.conn:                                       # 계좌·포지션·결정·이벤트를 한 트랜잭션으로
                cur = self.conn.execute('INSERT INTO lp_positions(strategy_id, scan_date, scanner, code, name, qty, entry_ts, entry_date, entry_price, quote_price, quote_ts, '
                                        'quality, atr, hh, stop_price, trail_price, status, last_price, last_ts, max_hold, assumptions) '
                                        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                                        (sid, r['scan_date'], r['scanner'], r['code'], r.get('name'), qty, _iso(now), now.strftime('%Y-%m-%d'), entry, price, _iso(q['ts']),
                                         'LAST_ONLY', atr, entry, stop, trail, 'OPEN', price, _iso(q['ts']), MAX_HOLD[sid], assumptions))
                self.conn.execute('UPDATE lp_accounts SET cash = cash - ?, updated_at=? WHERE strategy_id=?', (cost, _iso(now), sid))
                self.conn.execute('INSERT INTO lp_decisions(strategy_id, scan_date, scanner, code, decision, reason, ts) VALUES (?,?,?,?,?,?,?)',
                                  key + ('FILLED', 'VIRTUAL_BUY', _iso(now)))
                self.event(now, 'BUY', sid, r['code'], payload={'name': r.get('name'), 'scanner': r['scanner'], 'qty': qty, 'price': entry, 'quote': price, 'quoteTs': _iso(q['ts']),
                                                                'cost': cost, 'stop': stop, 'quality': 'LAST_ONLY', 'simulationType': SIM_TYPE},
                           key='buy:%s:%s:%s' % (sid, r['scan_date'], r['code']))
            return True
        except Exception:
            return False   # UNIQUE 충돌(이미 매수됨) 등 - 계좌는 롤백됐다

    # ---- 장중 감시·청산 --------------------------------------------------------
    def monitor(self, now, cache):
        """보유 포지션의 평가가를 갱신하고 장중 청산 조건을 확인한다. 반환: 새 가상 매도 건수."""
        if self.halted:
            return 0
        sold = 0
        rows = self.conn.execute("SELECT id, strategy_id, code, status, entry_date, trail_price, stop_price, entry_price, qty, signal_date FROM lp_positions "
                                 "WHERE status IN ('OPEN','PENDING_EXIT')").fetchall()
        today = now.strftime('%Y-%m-%d')
        for pid, sid, code, status, entry_date, trail, stop, entry, qty, signal_date in rows:
            q = self.fresh_quote(now, code, cache)
            if not q:
                continue
            with self.conn:
                self.conn.execute('UPDATE lp_positions SET last_price=?, last_ts=? WHERE id=?', (q['price'], _iso(q['ts']), pid))
            px = q['price']
            if status == 'PENDING_EXIT':
                if signal_date and signal_date < today:       # 신호 다음 거래일 이후 처음 관측한 시세에 체결(신호 당일 장중에는 체결하지 않는다)
                    sold += 1 if self._exit(now, pid, px, 'SIGNAL_EXIT', q) else 0
                continue
            if _hm(now) > self.cfg.stop_check_end:
                continue
            if sid == 'trail_atr' and trail and px <= trail:
                sold += 1 if self._exit(now, pid, px, 'STOP_INTRADAY', q) else 0
            elif sid == CONTROL_STRATEGY:
                if px <= stop:
                    sold += 1 if self._exit(now, pid, px, 'FIX_STOP', q) else 0
                elif px >= entry * (1 + self.cfg.fix_target):
                    sold += 1 if self._exit(now, pid, px, 'FIX_TARGET', q) else 0
        return sold

    def _exit(self, now, pid, price, reason, q, slip=None, quality=None):
        r = self.conn.execute('SELECT strategy_id, code, name, qty, entry_price, status FROM lp_positions WHERE id=?', (pid,)).fetchone()
        sid, code, name, qty, entry, status = r
        if status not in ('OPEN', 'PENDING_EXIT'):
            return False
        fill = price * (1 - (self.cfg.exit_slip if slip is None else slip))
        gross = fill / entry - 1
        net = gross - self.cfg.cost
        fee = qty * entry * self.cfg.cost
        proceeds = qty * entry * (1 + net)                   # 연구 계좌와 같은 방식: 매입금액 × (1 + 순수익률)
        pnl = proceeds - qty * entry
        with self.conn:
            self.conn.execute("UPDATE lp_positions SET status='CLOSED', exit_ts=?, exit_price=?, exit_reason=?, gross_ret=?, net_ret=?, pnl_krw=?, fee_krw=?, last_price=?, last_ts=?, quality=COALESCE(?, quality) "
                              "WHERE id=? AND status IN ('OPEN','PENDING_EXIT')", (_iso(now), fill, reason, gross, net, pnl, fee, price, _iso(q['ts']) if q else None, quality, pid))
            self.conn.execute('UPDATE lp_accounts SET cash = cash + ?, realized_pnl = realized_pnl + ?, updated_at=? WHERE strategy_id=?', (proceeds, pnl, _iso(now), sid))
            kind = 'SELL_STOP' if reason in ('STOP_INTRADAY', 'FIX_STOP') else 'SELL'
            self.event(now, kind, sid, code, payload={'name': name, 'qty': qty, 'price': fill, 'quote': price, 'reason': reason, 'netRet': net, 'pnl': pnl, 'fee': fee,
                                                      'simulationType': SIM_TYPE}, key='sell:%d' % pid)
        return True

    # ---- 장 마감 후 확정 일봉 갱신 ---------------------------------------------------
    def end_of_day(self, now):
        """확정 일봉(오늘 봉 포함, 15:45 이후)으로 추적선·신호·보유일을 갱신하고 자산 스냅샷을 남긴다. 반환: 새 신호/청산 수."""
        if self.halted or _hm(now) < self.cfg.eod_after:
            return 0
        today = now.strftime('%Y-%m-%d')
        changed = 0
        rows = self.conn.execute("SELECT id, strategy_id, code, entry_date, last_bar_date FROM lp_positions WHERE status='OPEN'").fetchall()
        for pid, sid, code, entry_date, last_bar in rows:
            try:
                daily = [b for b in (self.get_daily(code) or []) if b['date'] <= today]
            except Exception:
                continue
            changed += self._advance(now, pid, sid, daily)
        with self.conn:
            for sid in self.cfg.strategies:
                eq, inv, n = self.equity(sid)
                self.conn.execute('INSERT OR REPLACE INTO lp_equity(strategy_id, date, equity, cash, invested, positions, realized_pnl) VALUES (?,?,?,?,?,?,?)',
                                  (sid, today, eq, self.account(sid)['cash'], inv, n, self.account(sid)['realized']))
            self.event(now, 'EOD_REPORT', payload={'accounts': {sid: {'equity': self.equity(sid)[0], 'positions': self.equity(sid)[2]} for sid in self.cfg.strategies}},
                       key='eod:%s' % today)
        return changed

    def _advance(self, now, pid, sid, daily):
        p = self.conn.execute('SELECT entry_date, last_bar_date, atr, hh, trail_price, stop_price, entry_price, hold_days, max_hold, qty, code FROM lp_positions WHERE id=?', (pid,)).fetchone()
        entry_date, last_bar, atr, hh, trail, stop, entry, hold, max_hold, qty, code = p
        changed = 0
        closes = [b['close'] for b in daily]
        for k, bar in enumerate(daily):
            if bar['date'] < entry_date or (last_bar and bar['date'] <= last_bar):
                continue
            hold += 1
            lo, hi, cl = bar['low'], bar['high'], bar['close']
            signal = None
            if sid in ('trail_atr', 'atr_close'):
                if sid == 'trail_atr' and lo <= trail and bar['date'] > entry_date:
                    signal = 'STOP_BREACH_UNOBSERVED'        # 장중 감시에서 못 본 이탈(시세 단절 등) - 관측 체결로 위조하지 않는다. 진입 당일 봉은 진입 전 저가가 섞여 판정하지 않는다
                hh = max(hh, hi)
                trail = max(trail, hh - paper_exits.ATR_MULT * atr)
                if sid == 'atr_close' and cl < trail and not signal:
                    signal = 'SIGNAL_ATR_CLOSE'
            elif sid == 'dead35':
                m = lambda j, n: (sum(closes[j - n + 1:j + 1]) / n) if j >= n - 1 else None
                m3, m5, p3, p5 = m(k, 3), m(k, 5), m(k - 1, 3), m(k - 1, 5)
                if None not in (m3, m5, p3, p5) and m3 < m5 and p3 >= p5:
                    signal = 'SIGNAL_DEAD35'
            elif sid == CONTROL_STRATEGY:
                hit_stop, hit_tgt = lo <= entry * (1 + self.cfg.fix_stop), hi >= entry * (1 + self.cfg.fix_target)
                if hit_stop:                                  # 같은 봉에 손절·익절이 모두 가능하면 손절을 먼저 맞은 것으로(보수적) 취급
                    signal = 'FIX_STOP_BAR' + ('_BOTH_ASSUMED_STOP_FIRST' if hit_tgt else '')
                elif hit_tgt:
                    signal = 'FIX_TARGET_BAR'
            with self.conn:
                self.conn.execute('UPDATE lp_positions SET hh=?, trail_price=?, last_bar_date=?, hold_days=? WHERE id=?', (hh, trail, bar['date'], hold, pid))
                if signal:
                    self.conn.execute("UPDATE lp_positions SET status='PENDING_EXIT', signal_date=?, signal_reason=? WHERE id=? AND status='OPEN'", (bar['date'], signal, pid))
                    self.event(now, 'EXIT_SIGNAL', sid, code, payload={'reason': signal, 'barDate': bar['date'], 'note': '다음 거래일 처음 관측한 시세에 가상 매도'},
                               key='signal:%d' % pid)
            if signal:
                return 1
            if hold >= max_hold:
                # 최대 보유일: 확정 종가로 청산(연구 모델과 같은 가정). 관측 시세가 아니라 확정 종가이므로 체결 품질을 따로 표시한다.
                self._exit(now, pid, cl, 'MAX_HOLD_%d' % max_hold, None, slip=self.cfg.exit_slip / 3, quality='CONFIRMED_CLOSE')
                return 1
        return changed

    # ---- 한 번의 주기 ------------------------------------------------------------
    def tick(self, now, cands):
        """장중 한 주기. 반환 dict(bought, sold). 시세는 코드별로 한 번만 조회한다."""
        out = {'bought': 0, 'sold': 0}
        if self.halted or not (self.cfg.session_open <= _hm(now) <= self.cfg.session_close):
            return out
        cache = {}
        want = {r['code'] for r in cands if self.conn.execute('SELECT 1 FROM lp_decisions WHERE strategy_id=? AND scan_date=? AND scanner=? AND code=?',
                                                               (self.cfg.strategies[0], r['scan_date'], r['scanner'], r['code'])).fetchone() is None}
        want |= {r[0] for r in self.conn.execute("SELECT code FROM lp_positions WHERE status IN ('OPEN','PENDING_EXIT')")}
        for code in sorted(want):
            self.fresh_quote(now, code, cache)
        self._feed_state(now, cache)
        out['bought'] = self.try_entries(now, cands, cache)
        out['sold'] = self.monitor(now, cache)
        return out

    # ---- 요약 ---------------------------------------------------------------------
    def summary(self):
        res = {}
        for sid in self.cfg.strategies:
            eq, inv, n = self.equity(sid)
            acct = self.account(sid)
            curve = [r[0] for r in self.conn.execute('SELECT equity FROM lp_equity WHERE strategy_id=? ORDER BY date', (sid,))]
            peak, mdd = acct['initial'], 0.0
            for v in curve + [eq]:
                peak = max(peak, v)
                mdd = min(mdd, v / peak - 1)
            closed = [r[0] for r in self.conn.execute("SELECT net_ret FROM lp_positions WHERE strategy_id=? AND status='CLOSED'", (sid,))]
            wins, losses = [x for x in closed if x > 0], [x for x in closed if x <= 0]
            res[sid] = {'simulationType': SIM_TYPE, 'initialCash': acct['initial'], 'cash': acct['cash'], 'equity': eq, 'invested': inv, 'positions': n,
                        'realizedPnl': acct['realized'], 'unrealizedPnl': eq - acct['cash'] - inv, 'cumRet': eq / acct['initial'] - 1, 'mdd': mdd,
                        'closed': len(closed), 'win': (len(wins) / len(closed)) if closed else None,
                        'pf': (sum(wins) / -sum(losses)) if losses and sum(losses) < 0 else None, 'cashRatio': acct['cash'] / eq if eq else None}
        return res
