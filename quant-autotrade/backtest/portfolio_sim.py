# -*- coding: utf-8 -*-
"""일별 포트폴리오 시뮬레이터 (2026-10-11, 오프라인 전용 - 운영 VM·계좌와 무관).

exit_study.py 의 신호·진입·청산 엔진으로 거래 후보를 만들고, 동일한 자금 제약 아래에서 일별 계좌 평가금액을 계산한다.
기존 근사 MDD(겹침 무시 복리)가 -100%로 포화되던 문제를 없앤다: 실제 보유 종목 수·현금·투자 비중에 따라 일별 자산을 갱신한다.

규칙
- 진입: 신호일 다음 거래일 시가 지정가(시가*1.002), 시가가 전일 종가 +2% 이상이면 미진입(exit_study.simulate).
  같은 날 후보가 여러 개면 점수 높은 순(기준선은 코드·날짜 해시 순서 = 무작위 대조군).
- 제약: 동시 보유 최대 5종목, 종목당 최대 per_pos(계좌 평가금액 대비), 전체 투자 상한 total_cap, 같은 종목 중복 보유 금지, 가용 현금 이내.
  최소 주문 비중 1% 미만이면 건너뜀. 종목 수 제한·현금 부족·한도로 못 산 신호는 거절 건수로 집계.
- 비용: exit_study 의 왕복 0.4% + 청산 슬리피지(0.3%) + 진입 슬리피지(0.2%)가 거래 수익률에 이미 반영된다. 호가단위·1주 단위 절사는 무시.
- 평가: 보유 중 종목은 일별 종가 기준 평가, 청산일은 실현 수익률로 확정. 현금 이자 없음.
- 지표: 누적수익률, 연환산(CAGR), MDD, 거래 승률, Profit Factor, 평균 투자 비중, KOSPI/KOSDAQ 매수후보유 대비 초과(CAGR 차이).
- 개발/검증: 같은 시뮬레이션의 일별 자산 곡선을 구간(2024-09-20 기준)으로 잘라 구간별 수익률·MDD 계산.
사용: python portfolio_sim.py --db bt.db --kospi ks11.json --kosdaq kq11.json --out portfolio.json [--cache trades.pkl]
"""
import argparse
import hashlib
import json
import math
import os
import pickle
import sqlite3
import sys
from concurrent.futures import ProcessPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import exit_study as ex  # noqa: E402

sb = ex.sb
VARS = ('fix3_5', 'fix5_10', 'trail_atr', 'time10')
CONFIGS = {'A_spec': {'per_pos': 0.10, 'total_cap': 0.30, 'max_pos': 5},
           'B_wide': {'per_pos': 0.20, 'total_cap': 1.00, 'max_pos': 5}}
MIN_ORDER = 0.01
CUT = '2024-09-20'


def feats(kospi):
    c = [x['close'] for x in kospi]
    out = {}
    for k, row in enumerate(kospi):
        if k < 120:
            continue
        gap = c[k] / (sum(c[k - 119:k + 1]) / 120) - 1
        r5 = c[k] / c[k - 5] - 1
        dd20 = c[k] / max(c[k - 19:k + 1]) - 1
        out[row['date']] = (gap < -0.03, r5 <= -0.05 or dd20 <= -0.10)
    return out


def sdown(daily, i):
    cl = [d['close'] for d in daily[i - 59:i + 1]]
    return cl[-1] < sum(cl) / 60 and sum(cl[-20:]) / 20 < sum(cl) / 60


def for_stock(args):
    db, code, kpath = args
    import pattern_detect as pdx
    kf = feats(json.load(open(kpath, encoding='utf-8')))
    conn = sqlite3.connect(db)
    daily = sb.load(conn, code)
    conn.close()
    n = len(daily)
    if n < 160 or pdx.is_excluded_stock({'code': code, 'name': ''}, daily):
        return []
    det = {'maCloudBreakout': pdx.detect_ma_cloud_breakout, 'doubleBottom': pdx.detect_double_bottom,
           'invHeadShoulders': pdx.detect_inv_head_shoulders, 'pullback': pdx.detect_pullback,
           'shortTermMaBreakout': pdx.detect_short_ma_breakout}
    sigs, last = [], {}
    for i in range(120, n - 2):
        if i % ex.BASE_STEP == 0:
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
        f = kf.get(daily[i]['date'])
        if f is None:
            continue
        sd = sdown(daily, i)
        for var in VARS:
            res = ex.simulate(daily, i, var, 'open')
            if not res:
                continue
            ret, k = res
            entry = daily[i + 1]['open'] * (1 + ex.ENTRY_SLIP)
            path = [round(daily[j]['close'] / entry - 1, 4) for j in range(i + 1, k)]
            path.append(round(ret, 5))  # 청산일은 실현 수익률(비용 포함)
            out.append((name, var, code, daily[i + 1]['date'], daily[k]['date'], round(ret, 5), tuple(path), score, f[0], f[1], sd))
    return out


def build_trades(db, kpath, workers, cache):
    if cache and os.path.exists(cache):
        return pickle.load(open(cache, 'rb'))
    conn = sqlite3.connect(db)
    codes = [r[0] for r in conn.execute('SELECT code FROM daily_prices GROUP BY code HAVING COUNT(*) >= 250 ORDER BY code')]
    conn.close()
    rows = []
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for res in pool.map(for_stock, [(db, c, kpath) for c in codes], chunksize=2):
            rows.extend(res)
    if cache:
        pickle.dump(rows, open(cache, 'wb'))
    return rows


def hrand(code, date):
    return int(hashlib.md5((code + date).encode()).hexdigest()[:8], 16)


def simulate_portfolio(trades, dates, cfg):
    """trades: (scanner,var,code,entry_date,exit_date,ret,path,score,...) 후보 목록(이미 필터 적용).
    dates: 거래일 오름차순. 반환 (일별 평가금액 리스트, 체결 거래 목록, 거절 집계, 평균 투자 비중)."""
    by_entry = {}
    for t in trades:
        by_entry.setdefault(t[3], []).append(t)
    cash, equity = 1.0, 1.0
    pos = []  # dict(trade, size, day)
    eq_curve, executed = [], []
    rej = {'max_pos': 0, 'dup': 0, 'cash_or_cap': 0}
    invested_sum = 0.0
    for d in dates:
        cands = by_entry.get(d)
        if cands:
            cands = sorted(cands, key=lambda t: (-t[7], hrand(t[2], d)) if t[0] != 'BASELINE' else (0, hrand(t[2], d)))
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
                if size < MIN_ORDER * equity:
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
                executed.append(p['t'][5])
            else:
                keep.append(p)
            p['day'] += 1
        pos = keep
        equity = value
        eq_curve.append(equity)
        invested_sum += sum(p['size'] for p in pos) / equity if equity else 0
    return eq_curve, executed, rej, invested_sum / max(1, len(dates))


def curve_stats(curve, years):
    if len(curve) < 2:
        return None
    peak, mdd = curve[0], 0.0
    for v in curve:
        peak = max(peak, v)
        mdd = min(mdd, v / peak - 1)
    total = curve[-1] / curve[0] - 1
    cagr = (curve[-1] / curve[0]) ** (1 / years) - 1 if years > 0 and curve[-1] > 0 else None
    return {'ret': total, 'cagr': cagr, 'mdd': mdd}


def bench(series, dates):
    m = {x['date']: x['close'] for x in series}
    vals, last = [], None
    for d in dates:
        last = m.get(d, last)
        vals.append(last)
    first = next(v for v in vals if v)
    return [(v or first) / first for v in vals]


def trade_stats(rets):
    if not rets:
        return {'n': 0}
    w = [r for r in rets if r > 0]
    l = [r for r in rets if r <= 0]
    return {'n': len(rets), 'win': len(w) / len(rets), 'avg': sum(rets) / len(rets), 'pf': (sum(w) / -sum(l)) if l and sum(l) < 0 else None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True)
    ap.add_argument('--kospi', required=True)
    ap.add_argument('--kosdaq', required=True)
    ap.add_argument('--out', default='portfolio.json')
    ap.add_argument('--cache', default='')
    ap.add_argument('--workers', type=int, default=4)
    a = ap.parse_args()
    rows = build_trades(a.db, a.kospi, a.workers, a.cache)
    kospi = json.load(open(a.kospi, encoding='utf-8'))
    kosdaq = json.load(open(a.kosdaq, encoding='utf-8'))
    all_dates = [x['date'] for x in kospi]
    start_i = next(i for i, d in enumerate(all_dates) if d >= min(r[3] for r in rows))
    dates = all_dates[start_i:]
    years = max(0.1, (len(dates)) / 245.0)
    kb, qb = bench(kospi, dates), bench(kosdaq, dates)
    cut_i = next(i for i, d in enumerate(dates) if d >= CUT)
    bench_stats = {'KOSPI': curve_stats(kb, years), 'KOSDAQ': curve_stats(qb, years),
                   'KOSPI_dev': curve_stats(kb[:cut_i], cut_i / 245.0), 'KOSPI_val': curve_stats(kb[cut_i:], (len(dates) - cut_i) / 245.0)}
    filters = {'F0': lambda t: True, 'F1': lambda t: not t[8] and not t[9],
               'F2': lambda t: not t[8] and not t[9] and (t[0] == 'shortTermMaBreakout' or not t[10])}
    groups = {sc: sc for sc in ('BASELINE',) + ex.SCANNERS}
    result = {'dates': [dates[0], dates[-1]], 'cut': CUT, 'bench': bench_stats, 'runs': {}}
    for cname, cfg in CONFIGS.items():
        for gname in list(groups) + ['ALL']:
            for var in VARS:
                base = [r for r in rows if r[1] == var and ((r[0] == gname) if gname != 'ALL' else (r[0] != 'BASELINE'))]
                for fk, fn in filters.items():
                    cand = [r for r in base if fn(r)]
                    curve, executed, rej, expo = simulate_portfolio(cand, dates, cfg)
                    full = curve_stats(curve, years)
                    dev = curve_stats([1.0] + curve[:cut_i], cut_i / 245.0)
                    val = curve_stats([curve[cut_i - 1]] + curve[cut_i:], (len(dates) - cut_i) / 245.0)
                    ts = trade_stats(executed)
                    full['excessKospiCagr'] = (full['cagr'] - bench_stats['KOSPI']['cagr']) if full['cagr'] is not None else None
                    full['excessKosdaqCagr'] = (full['cagr'] - bench_stats['KOSDAQ']['cagr']) if full['cagr'] is not None else None
                    result['runs']['%s|%s|%s|%s' % (cname, gname, var, fk)] = {'full': full, 'dev': dev, 'val': val, 'trades': ts,
                                                                              'rejected': rej, 'avgInvested': expo, 'candidates': len(cand)}
    json.dump(result, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('done', len(rows), len(result['runs']))


if __name__ == '__main__':
    main()
