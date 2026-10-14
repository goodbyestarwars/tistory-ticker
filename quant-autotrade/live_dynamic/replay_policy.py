# -*- coding: utf-8 -*-
"""고정 정책(최대 3종목 · 30만원 · 예비금 10만원)과 동적 배분(dynamic-v1)의 구조 비교 재현 - 읽기 전용, 주문 없음. (2026-10-15)

사이트 VM의 SQLite(scan_hits 포착 이력 + daily_prices 일봉)를 읽어 같은 후보에 두 정책을 적용한다. 일봉만 있어 체결가는 다음 거래일 시가로 근사하고
손절(-5%)·익절(+6%)·+3% 도달 뒤 이탈(순손익, 비용 0.7%)도 일봉 고저로 근사한다. 엔진의 실제 후보(연구 DB)와 다른 후보(패턴 검색 이력)이고 기간이 짧아
수익성을 증명하지 않는다 - 금액 산정이 위험(최대 손실·낙폭)을 어떻게 바꾸는지 보는 용도다.

사용(VM): PYTHONPATH=<kiwoom-api 폴더>:<이 폴더> python3 replay_policy.py <ohlc_snapshot.db 경로> [시작일]
"""
import sqlite3
import sys

import allocation as al
from live_engine_dynamic import evaluate_candidates

COST_PCT = 0.7
STOP, TAKE, FLOOR = -5.0, 6.0, 3.0
START_CASH = 1_000_000


def load(conn, codes):
    bars = {}
    for code in codes:
        rows = conn.execute('SELECT date, open, high, low, close, volume FROM daily_prices WHERE code=? ORDER BY date', (code,)).fetchall()
        bars[code] = [dict(date=r[0], open=r[1], high=r[2], low=r[3], close=r[4], volume=r[5]) for r in rows]
    return bars


def net(price, avg):
    return (price / avg - 1) * 100 - COST_PCT


class Pos:
    def __init__(self, code, qty, avg, day):
        self.code, self.qty, self.avg, self.day, self.floor = code, qty, avg, day, False


def exit_price(pos, bar):
    """그날 봉에서 청산이 일어나면 청산가, 아니면 None(갭은 시가로 체결)."""
    stop_px = pos.avg * (1 + (STOP + COST_PCT) / 100)
    take_px = pos.avg * (1 + (TAKE + COST_PCT) / 100)
    floor_px = pos.avg * (1 + (FLOOR + COST_PCT) / 100)
    if bar['open'] <= stop_px:
        return bar['open']
    if bar['low'] <= stop_px:
        return stop_px
    if bar['open'] >= take_px:
        return bar['open']
    if pos.floor and bar['low'] <= floor_px:
        return min(bar['open'], floor_px)
    if bar['high'] >= take_px:
        return take_px
    if bar['high'] >= floor_px:
        pos.floor = True
    return None


def simulate(policy, days, cands_by_day, bars):
    cash, positions, closed, equity_curve = START_CASH, [], [], []
    for d in days:
        # 1) 보유 종목 청산 판단(진입일 다음 날부터)
        for pos in list(positions):
            bar = next((b for b in bars[pos.code] if b['date'] == d), None)
            if not bar or d <= pos.day:
                continue
            px = exit_price(pos, bar)
            if px is not None:
                cash += px * pos.qty
                closed.append((pos.code, (px / pos.avg - 1) * 100 - COST_PCT, (px - pos.avg) * pos.qty - pos.avg * pos.qty * COST_PCT / 100))
                positions.remove(pos)
        # 2) 신규 진입: 전 거래일 포착 후보, 오늘 시가로 체결 근사
        todays = cands_by_day.get(d, [])
        entered = set()
        committed = sum(p.avg * p.qty for p in positions)
        if policy == 'fixed':
            for cand in sorted(todays, key=lambda c: (c['last_value'] / 1e9, c['avg_value'] / 1e9, -abs(c['volatility'] - 0.035), c['trend']), reverse=True):
                if len(positions) >= 3 or cash <= 100_000:
                    break
                bar = next((b for b in bars[cand['code']] if b['date'] == d), None)
                if not bar or any(p.code == cand['code'] for p in positions) or bar['open'] >= cand['base'] * 1.02:
                    continue
                qty = int(min(300_000, cash - 100_000, 900_000 - committed) // bar['open'])
                if qty < 1 or qty * bar['open'] > 300_000:
                    continue
                cash -= qty * bar['open']
                committed += qty * bar['open']
                positions.append(Pos(cand['code'], qty, bar['open'], d))
        else:
            live = []
            for cand in todays:
                bar = next((b for b in bars[cand['code']] if b['date'] == d), None)
                if bar and bar['open'] < cand['base'] * 1.02 and not any(p.code == cand['code'] for p in positions):
                    live.append((cand, bar['open']))
            peers = [c for c, _ in live if c['quality'] >= al.MIN_QUALITY][:al.MAX_CONSIDER]
            peer_sum = sum(c['quality'] for c in peers)
            for cand, price in live:                                   # 품질 높은 순(evaluate_candidates가 정렬)
                committed = sum(p.avg * p.qty for p in positions)
                risk_used = committed * al.STOP_PCT / 100
                plan = al.plan_buy(cand, price, budget_room=al.TOTAL_BUDGET - committed, cash_usable=cash, portfolio_risk_used=risk_used,
                                   peers_quality_sum=peer_sum or None, unique_top=len(peers) == 1)
                if plan['qty'] < 1:
                    continue
                cash -= plan['qty'] * price * (1 + al.FEE_BUFFER_PCT / 100)
                positions.append(Pos(cand['code'], plan['qty'], price, d))
        # 3) 일별 평가
        value = cash
        for p in positions:
            bar = next((b for b in bars[p.code] if b['date'] <= d), None)
            last = [b for b in bars[p.code] if b['date'] <= d][-1]['close'] if bar else p.avg
            value += last * p.qty
        equity_curve.append(value)
    for p in positions:
        last = bars[p.code][-1]['close']
        closed.append((p.code, (last / p.avg - 1) * 100 - COST_PCT, (last - p.avg) * p.qty - p.avg * p.qty * COST_PCT / 100))
    peak, mdd = START_CASH, 0.0
    for v in equity_curve:
        peak = max(peak, v)
        mdd = max(mdd, (peak - v) / peak * 100)
    pnl = equity_curve[-1] - START_CASH if equity_curve else 0
    wins = sum(1 for _, r, _ in closed if r > 0)
    return {'trades': len(closed), 'win%': round(wins / len(closed) * 100, 1) if closed else None, 'pnl': round(pnl), 'ret%': round(pnl / START_CASH * 100, 2),
            'max_dd%': round(mdd, 2), 'worst_trade_krw': round(min((x[2] for x in closed), default=0)), 'peak_invested': None}


def main():
    path = sys.argv[1]
    since = sys.argv[2] if len(sys.argv) > 2 else '2026-09-03'
    conn = sqlite3.connect('file:%s?mode=ro' % path, uri=True)
    scan_days = [r[0] for r in conn.execute("SELECT DISTINCT scan_date FROM scan_hits WHERE scanner LIKE 'pattern:%' AND scan_date>=? ORDER BY 1", (since,))]
    codes = sorted({r[0] for r in conn.execute("SELECT DISTINCT code FROM scan_hits WHERE scanner LIKE 'pattern:%' AND scan_date>=?", (since,))})
    bars = load(conn, codes)
    all_days = sorted({b['date'] for code in codes for b in bars[code] if b['date'] > scan_days[0]})
    cands_by_day = {}
    for sd in scan_days:
        nxt = next((d for d in all_days if d > sd), None)
        if not nxt:
            continue
        rows = [{'scan_date': sd, 'scanner': 'p', 'code': r[0], 'base_price': r[1], 'status': 'NEW'}
                for r in conn.execute("SELECT DISTINCT code, base_price FROM scan_hits WHERE scanner LIKE 'pattern:%' AND scan_date=?", (sd,))]
        cands_by_day[nxt] = evaluate_candidates(rows, lambda c: bars[c], nxt)
    days = [d for d in all_days if d <= max(cands_by_day) or True]
    print('기간', scan_days[0], '~', all_days[-1], '| 포착일', len(scan_days), '| 하드필터 통과 후보(일합)', sum(len(v) for v in cands_by_day.values()))
    for policy in ('fixed', 'dynamic'):
        print('%-8s' % policy, simulate(policy, days, cands_by_day, bars))


if __name__ == '__main__':
    main()
