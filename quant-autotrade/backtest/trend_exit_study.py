# -*- coding: utf-8 -*-
"""추세 이탈 청산 전략 연구 (2026-10-11, 오프라인 전용 - 실계좌·로컬 매도 봇 규칙과 무관).

목표: 고정 익절 없이 상승 추세가 이어지는 동안 보유하고, 추세가 꺾이는 신호에서 판다.
신호는 **일봉 종가**로 판단하고 체결은 **다음 거래일 시가**(슬리피지 반영)로 가정한다. 당일 종가에 판 것으로 계산하지 않는다.
진입·비용·포트폴리오 제한(동시 5종목, 종목당 10%, 투자 30% / 넓은 설정 20%·100%)은 portfolio_sim.py 와 동일하다.

청산 전략(strat)
  ma3        종가 < 3일 이동평균
  ma3slope   3일선 기울기 하락(오늘 MA3 < 어제 MA3) 이면서 종가 < MA3
  dead35     3일선이 5일선을 아래로 교차(데드크로스)
  ma5        종가 < 5일 이동평균
  atr_intraday  기존 ATR 추적 청산(비교 기준: 장중 이탈 가정, 이탈가 체결) - exit_study.trail_atr 와 같은 규칙
  atr_close  ATR 추적선(고점-2.5ATR)을 종가가 이탈하면 다음 날 시가 매도(체결 방식을 맞춘 공정 비교용)
  ma3a / ma5a  '무장' 조건: 진입 뒤 종가가 해당 이평선 위로 한 번 올라선 이후의 이탈만 신호(눌림목 진입 직후 즉시 이탈 방지)
  ma2,ma4,ma7,ma10,ma20  이탈 기준 일수 민감도(과최적화 점검: 3·5일이 우연히 좋은지 확인)
비상 손실 제한(emergency, 전략과 별도 층): x0 없음 / x7 진입가 -7% / x10 진입가 -10% (장중 저가가 닿으면 체결, 갭하락이면 시가 체결).
  백테스트 연구용이며 실계좌에는 적용하지 않는다.
최대 보유 150거래일(환경변수 TREND_MAX_HOLD 로 변경 가능), 데이터 끝까지 남은 포지션은 마지막 종가로 평가(open_at_end).

추가 지표(거래 단위): 평균 보유일, 평균 이익 거래, 큰 상승(고점 +20% 이상) 거래의 포착률, 청산 뒤 20일 안에 더 오른 정도(놓친 상승),
횡보장(KOSPI 120일선 ±3%) 성과, 3일 이내 짧은 매매 비중, 연도별 수익률(안정성), 개발/검증 구간.
사용: python trend_exit_study.py --db bt.db --kospi ks11.json --kosdaq kq11.json --out trend.json [--cache trend_trades.pkl]
"""
import argparse
import json
import math
import os
import pickle
import sqlite3
import sys
from array import array
from concurrent.futures import ProcessPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import exit_study as ex  # noqa: E402
import portfolio_sim as ps  # noqa: E402

sb = ex.sb
MAX_HOLD = int(os.environ.get('TREND_MAX_HOLD', '150'))   # 거래일. 환경변수로 상한 민감도(30/60/150) 점검
BIG_TREND = 0.20
POST_DAYS = 20
STRATS = ('ma3', 'ma3slope', 'dead35', 'ma5', 'atr_intraday', 'atr_close', 'ma3a', 'ma5a')
SENS = ('ma2', 'ma4', 'ma7', 'ma10', 'ma20')
EMERG = {'x0': None, 'x7': 0.07, 'x10': 0.10}
BASE_STEP = 12     # 무작위 대조군 표본 간격(거래 수 폭증 방지)
CONFIGS = ps.CONFIGS
ALLCOST = ex.COST + ex.ENTRY_SLIP + ex.EXIT_SLIP


def sma_list(closes, n):
    out = [None] * len(closes)
    run = 0.0
    for k, c in enumerate(closes):
        run += c
        if k >= n:
            run -= closes[k - n]
        if k >= n - 1:
            out[k] = run / n
    return out


def simulate_trend(daily, closes, mas, i, strat, limit):
    """신호일 인덱스 i. 반환 dict 또는 None. mas: {n: sma_list}."""
    n = len(daily)
    if i + 2 >= n:
        return None
    prev_close, open1 = daily[i]['close'], daily[i + 1]['open']
    if not prev_close or not open1 or open1 / prev_close - 1 >= ex.GAP_SKIP:
        return None
    entry = open1 * (1 + ex.ENTRY_SLIP)
    start = i + 1
    atr = ex.atr14(daily, i)
    if not atr:
        return None
    window = 0
    if strat.startswith('ma'):
        digits = ''.join(ch for ch in strat if ch.isdigit())
        window = int(digits)
    armed = not strat.endswith('a') or strat in ('ma2', 'ma4', 'ma7', 'ma10', 'ma20')
    slope = strat == 'ma3slope'
    dead = strat == 'dead35'
    hh, trail = entry, entry - 2.5 * atr
    pending = False
    stop = entry * (1 - limit) if limit else None
    last = min(n - 1, start + MAX_HOLD - 1)
    exit_k = fill = reason = None
    for k in range(start, last + 1):
        bar = daily[k]
        o, lo, hi, cl = bar['open'], bar['low'], bar['high'], bar['close']
        if pending:
            exit_k, fill, reason = k, o * (1 - ex.EXIT_SLIP), 'signal'
            break
        if stop is not None and lo <= stop:
            exit_k, fill, reason = k, min(o, stop) * (1 - ex.EXIT_SLIP), 'emergency'
            break
        if strat == 'atr_intraday':
            if lo <= trail:
                exit_k, fill, reason = k, min(o, trail) * (1 - ex.EXIT_SLIP), 'atr'
                break
            hh = max(hh, hi)
            trail = max(trail, hh - 2.5 * atr)
        elif strat == 'atr_close':
            hh = max(hh, hi)
            trail = max(trail, hh - 2.5 * atr)
            if cl < trail:
                pending = True
        elif dead:
            m3, m5 = mas[3][k], mas[5][k]
            p3, p5 = mas[3][k - 1], mas[5][k - 1]
            if m3 is not None and m5 is not None and p3 is not None and p5 is not None and m3 < m5 and p3 >= p5:
                pending = True
        else:
            w = 3 if slope else window
            m = mas[w][k]
            if m is not None:
                if cl > m:
                    armed = True
                elif armed and cl < m:
                    if not slope or (mas[3][k - 1] is not None and m < mas[3][k - 1]):
                        pending = True
        if k == last and not pending:
            exit_k, fill, reason = k, cl * (1 - ex.EXIT_SLIP / 3), 'end'
    if exit_k is None:   # pending 이 마지막 봉에서 생겨 다음 시가가 없는 경우 -> 마지막 종가로 평가
        exit_k, fill, reason = last, daily[last]['close'] * (1 - ex.EXIT_SLIP / 3), 'end'
    gross_exit = fill / entry - 1
    net = gross_exit - ex.COST
    path = array('f', [round(closes[j] / entry - 1, 4) for j in range(start, exit_k)] + [net])
    upto = exit_k if reason in ('signal',) else exit_k  # 평가 구간: 진입~청산일 종가까지(신호 청산은 청산일 시가 이전 종가들)
    seg = closes[start:exit_k] or [closes[start]]
    peak = max(seg) / entry - 1
    after = closes[exit_k + 1:exit_k + 1 + POST_DAYS]
    ref = fill / (1 - ex.EXIT_SLIP)
    missed = (max(after) / ref - 1) if len(after) >= 5 else None
    return {'net': net, 'gross': gross_exit, 'exit_k': exit_k, 'hold': exit_k - start + 1, 'path': path, 'peak': peak, 'missed': missed, 'reason': reason}


def for_stock(args):
    db, code, kpath = args
    import pattern_detect as pdx
    kospi = json.load(open(kpath, encoding='utf-8'))
    kf = ps.feats(kospi)
    kc = [x['close'] for x in kospi]
    kreg = {}
    for k, row in enumerate(kospi):
        if k >= 120:
            gap = kc[k] / (sum(kc[k - 119:k + 1]) / 120) - 1
            kreg[row['date']] = 'up' if gap > 0.03 else ('down' if gap < -0.03 else 'flat')
    conn = sqlite3.connect(db)
    daily = sb.load(conn, code)
    conn.close()
    n = len(daily)
    if n < 160:   # 제외 판정은 신호일 시점 데이터로만 한다(아래 excluded_at) - 전체 이력의 마지막 봉을 보면 미래 참조가 된다
        return []
    closes = [d['close'] for d in daily]
    mas = {w: sma_list(closes, w) for w in (2, 3, 4, 5, 7, 10, 20)}
    det = {'maCloudBreakout': pdx.detect_ma_cloud_breakout, 'doubleBottom': pdx.detect_double_bottom,
           'invHeadShoulders': pdx.detect_inv_head_shoulders, 'pullback': pdx.detect_pullback,
           'shortTermMaBreakout': pdx.detect_short_ma_breakout}
    sigs, last = [], {}
    for i in range(120, n - 2):
        if ex.excluded_at(pdx, code, daily, i):
            continue
        if i % BASE_STEP == 0:
            sigs.append(('BASELINE', i, 0))
        w = daily[:i + 1]
        for name, fn in det.items():
            if i + 1 < sb.MIN_HISTORY[name] or i - last.get(name, -999) <= ex.COOLDOWN:
                continue
            try:
                d = fn(w)
            except Exception:
                d = None
            if d is not None and not d.get('breakout') and (d.get('score') or 0) >= ex.MIN_SCORE.get(name, 0):
                last[name] = i
                sigs.append((name, i, d.get('score') or 0))
    out = []
    for name, i, score in sigs:
        date = daily[i]['date']
        f = kf.get(date)
        if f is None:
            continue
        sd = ps.sdown(daily, i)
        reg = kreg.get(date, 'na')
        variants = [(s, em) for s in STRATS for em in EMERG] + [(s, 'x0') for s in SENS]
        for strat, em in variants:
            r = simulate_trend(daily, closes, mas, i, strat, EMERG[em])
            if not r:
                continue
            out.append((name, '%s|%s' % (strat, em), code, daily[i + 1]['date'], daily[r['exit_k']]['date'], round(r['net'], 5), r['path'], score,
                        f[0], f[1], sd, r['hold'], round(r['peak'], 4), None if r['missed'] is None else round(r['missed'], 4), reg, r['reason'], round(r['gross'], 4)))
    return out


def build(db, kpath, workers, cache):
    if cache and os.path.exists(cache):
        return pickle.load(open(cache, 'rb'))
    conn = sqlite3.connect(db)
    codes = [r[0] for r in conn.execute('SELECT code FROM daily_prices GROUP BY code HAVING COUNT(*) >= 250 ORDER BY code')]
    conn.close()
    rows = []
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for k, res in enumerate(pool.map(for_stock, [(db, c, kpath) for c in codes], chunksize=2)):
            rows.extend(res)
            if (k + 1) % 40 == 0:
                print('%d/%d' % (k + 1, len(codes)), len(rows), flush=True)
    if cache:
        pickle.dump(rows, open(cache, 'wb'), protocol=4)
    return rows


def sim(trades, dates, cfg):
    """portfolio_sim.simulate_portfolio 와 같은 규칙 + 체결된 거래 객체·비용 누적 반환."""
    by_entry = {}
    for t in trades:
        by_entry.setdefault(t[3], []).append(t)
    cash = equity = 1.0
    pos, curve, executed = [], [], []
    rej = {'max_pos': 0, 'dup': 0, 'cash_or_cap': 0}
    invested_sum = cost_paid = 0.0
    for d in dates:
        cands = by_entry.get(d)
        if cands:
            cands = sorted(cands, key=lambda t: (-t[7], ps.hrand(t[2], d)) if t[0] != 'BASELINE' else (0, ps.hrand(t[2], d)))
            held = {p['t'][2] for p in pos}
            for t in cands:
                if t[2] in held:
                    rej['dup'] += 1
                    continue
                if len(pos) >= cfg['max_pos']:
                    rej['max_pos'] += 1
                    continue
                invested = sum(p['size'] for p in pos)
                size = min(cfg['per_pos'] * equity, cash, cfg['total_cap'] * equity - invested)
                if size < ps.MIN_ORDER * equity:
                    rej['cash_or_cap'] += 1
                    continue
                cash -= size
                pos.append({'t': t, 'size': size, 'day': 0})
                held.add(t[2])
        value = cash
        keep = []
        for p in pos:
            path = p['t'][6]
            idx = min(p['day'], len(path) - 1)
            value += p['size'] * (1 + path[idx])
            if d >= p['t'][4] or idx == len(path) - 1:
                cash += p['size'] * (1 + path[-1])
                executed.append((p['t'], p['size']))
                cost_paid += p['size'] * ALLCOST
            else:
                keep.append(p)
            p['day'] += 1
        pos = keep
        equity = value
        curve.append(equity)
        invested_sum += sum(p['size'] for p in pos) / equity if equity else 0
    return curve, executed, rej, invested_sum / max(1, len(dates)), cost_paid


def trade_metrics(executed, years):
    if not executed:
        return {'n': 0}
    rets = [t[5] for t, _ in executed]
    wins = [r for r in rets if r > 0]
    losses = [r for r in rets if r <= 0]
    holds = [t[11] for t, _ in executed]
    big = [t for t, _ in executed if t[12] >= BIG_TREND]
    missed = [t[13] for t, _ in executed if t[13] is not None]
    cap = [max(-1.0, t[16] / t[12]) for t in big if t[12] > 0]
    flat = [t[5] for t, _ in executed if t[14] == 'flat']
    gw, gl = sum(wins), -sum(losses)
    return {
        'n': len(rets), 'perYear': len(rets) / years, 'win': len(wins) / len(rets), 'avg': sum(rets) / len(rets),
        'avgWin': (sum(wins) / len(wins)) if wins else None, 'avgLoss': (sum(losses) / len(losses)) if losses else None,
        'pf': (gw / gl) if gl > 0 else None, 'avgHold': sum(holds) / len(holds), 'short3': sum(1 for h in holds if h <= 3) / len(holds),
        'bigN': len(big), 'bigAvg': (sum(t[5] for t in big) / len(big)) if big else None, 'bigCapture': (sum(cap) / len(cap)) if cap else None,
        'missedAvg': (sum(missed) / len(missed)) if missed else None, 'missedShare': (sum(1 for m in missed if m >= 0.10) / len(missed)) if missed else None,
        'flatN': len(flat), 'flatAvg': (sum(flat) / len(flat)) if flat else None,
        'endOpen': sum(1 for t, _ in executed if t[15] == 'end'), 'emergency': sum(1 for t, _ in executed if t[15] == 'emergency') / len(executed),
    }


def yearly(curve, dates):
    out, prev, cur_year = {}, curve[0], dates[0][:4]
    last_val = {}
    for d, v in zip(dates, curve):
        last_val[d[:4]] = v
    ys = sorted(last_val)
    base = 1.0
    for y in ys:
        out[y] = last_val[y] / base - 1
        base = last_val[y]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True)
    ap.add_argument('--kospi', required=True)
    ap.add_argument('--kosdaq', required=True)
    ap.add_argument('--out', default='trend.json')
    ap.add_argument('--cache', default='')
    ap.add_argument('--workers', type=int, default=4)
    a = ap.parse_args()
    rows = build(a.db, a.kospi, a.workers, a.cache)
    kospi = json.load(open(a.kospi, encoding='utf-8'))
    kosdaq = json.load(open(a.kosdaq, encoding='utf-8'))
    all_dates = [x['date'] for x in kospi]
    start_i = next(i for i, d in enumerate(all_dates) if d >= min(r[3] for r in rows))
    dates = all_dates[start_i:]
    years = len(dates) / 245.0
    cut_i = next(i for i, d in enumerate(dates) if d >= ps.CUT)
    kb, qb = ps.bench(kospi, dates), ps.bench(kosdaq, dates)
    result = {'dates': [dates[0], dates[-1]], 'cut': ps.CUT, 'years': years,
              'bench': {'KOSPI': ps.curve_stats(kb, years), 'KOSDAQ': ps.curve_stats(qb, years)}, 'runs': {}}
    by = {}
    for r in rows:
        by.setdefault((r[0], r[1]), []).append(r)
    scanners = ('BASELINE',) + ex.SCANNERS
    variants = sorted({v for (_, v) in by})
    for cname, cfg in CONFIGS.items():
        for sc in scanners:
            for var in variants:
                cand = by.get((sc, var))
                if not cand:
                    continue
                curve, executed, rej, expo, cost = sim(cand, dates, cfg)
                full = ps.curve_stats(curve, years)
                dev = ps.curve_stats([1.0] + curve[:cut_i], cut_i / 245.0)
                val = ps.curve_stats([curve[cut_i - 1]] + curve[cut_i:], (len(dates) - cut_i) / 245.0)
                result['runs']['%s|%s|%s' % (cname, sc, var)] = {
                    'full': full, 'dev': dev, 'val': val, 'trades': trade_metrics(executed, years), 'yearly': yearly(curve, dates),
                    'avgInvested': expo, 'costDrag': cost, 'rejected': rej, 'candidates': len(cand)}
    json.dump(result, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('done rows=%d runs=%d' % (len(rows), len(result['runs'])))


if __name__ == '__main__':
    main()
