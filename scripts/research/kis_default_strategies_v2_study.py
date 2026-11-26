# -*- coding: utf-8 -*-
"""KIS 기본 전략 v2: 시장·유동성·강세 필터 × 청산 규칙 × 진입 갭 비교 (연구 전용 - 2026-11-27).

기준은 결과 확인 전 `docs/KIS_DEFAULT_STRATEGIES_V2_STUDY_2026-11-27.md`에 고정했다.
신호·통계는 v1(`kis_default_strategies_study`)과 `closing_bet_formula_study`를 재사용한다.

실행: python kis_default_strategies_v2_study.py <일봉 cache 폴더> <kospi_naver.json> <out.json>
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kis_default_strategies_study as K  # noqa: E402
import closing_bet_formula_study as S  # noqa: E402

COST = K.COST
SPLIT = K.SPLIT
MIN_EVENTS = K.MIN_EVENTS
TOP_AMOUNT = 200
RET_PCT = 0.70
NAMES = ['goldenCross', 'momentum', 'high52w', 'consecutive', 'disparity', 'breakoutFail', 'strongClose', 'volatility', 'meanReversion']
FILTERS = ['F0', 'F1', 'F2', 'F3']
EXITS = ['X0', 'X1', 'X2', 'X3']
MTM = False                                              # True면 끝나지 않은 포지션을 마지막 종가로 평가(최근 구간 분석용)
EXIT_PARAM = {'X1': (0.05, 0.03, 5), 'X2': (0.10, 0.05, 20)}   # 익절, 손절, 최대 거래일


def first_true(mask):
    return int(np.argmax(mask)) if mask.any() else -1


def exit_tp_sl(o, h, l, c, e, tp_pct, sl_pct, hold):
    """익절/손절/시간 청산. 같은 날 동시 도달은 손절 우선. 끝나지 않은 포지션은 None."""
    n = len(c)
    entry = o[e]
    end = min(n, e + hold)
    stop, tp = entry * (1 - sl_pct), entry * (1 + tp_pct)
    i_sl = first_true(l[e:end] <= stop)
    i_tp = first_true(h[e:end] >= tp)
    if i_sl >= 0 and (i_tp < 0 or i_sl <= i_tp):
        k = e + i_sl
        return k, (o[k] if (k > e and o[k] <= stop) else stop)
    if i_tp >= 0:
        k = e + i_tp
        return k, (o[k] if (k > e and o[k] >= tp) else tp)
    if e + hold > n and not MTM:
        return None
    return end - 1, c[end - 1]


def exit_trail(o, h, l, c, e, hold=30, init=0.03, trail=0.05):
    n = len(c)
    entry = o[e]
    end = min(n, e + hold)
    hmax = np.maximum.accumulate(h[e:end])
    prev = np.concatenate(([entry], hmax[:-1]))
    stop = np.maximum(entry * (1 - init), prev * (1 - trail))
    i = first_true(l[e:end] <= stop)
    if i >= 0:
        k = e + i
        return k, (o[k] if (k > e and o[k] <= stop[i]) else stop[i])
    if e + hold > n and not MTM:
        return None
    return end - 1, c[end - 1]


def run_trades(o, h, l, c, mask, exit_kind, sell=None):
    """mask(신호일 진입 허용) 위치마다 다음 날 시가 진입. 종목당 동시 1포지션."""
    n = len(c)
    out = []
    last = -1
    for i in np.nonzero(mask)[0]:
        e = i + 1
        if e >= n or e <= last or i <= last:
            continue
        if exit_kind == 'X0':
            r = None
            entry = o[e]
            stop = entry * 0.95
            for k in range(e, min(n, e + K.MAX_HOLD)):
                if k > e and o[k] <= stop:
                    r = (k, o[k]); break
                if l[k] <= stop:
                    r = (k, stop); break
                if sell[k] and k + 1 < n:
                    r = (k + 1, o[k + 1]); break
            if r is None:
                k = min(n - 1, e + K.MAX_HOLD - 1)
                if k == n - 1 and k - e + 1 < K.MAX_HOLD and not MTM:
                    break
                r = (k, c[k])
        elif exit_kind == 'X3':
            r = exit_trail(o, h, l, c, e)
        else:
            tp, sl, hd = EXIT_PARAM[exit_kind]
            r = exit_tp_sl(o, h, l, c, e, tp, sl, hd)
        if r is None:
            break
        k, px = r
        out.append((e, k, px / o[e] - 1))
        last = k
    return out


def load_all(cache_dir):
    stocks = []
    dates = set()
    for f in sorted(os.listdir(cache_dir)):
        if not (f.endswith('.json') and f[0].isdigit()):
            continue
        rows = S.load_px(cache_dir, f[:-5])
        if not rows:
            continue
        d = [r[0] for r in rows]
        arr = np.array([r[1:6] for r in rows], float)
        stocks.append((f[:-5], d, arr))
        dates.update(d)
    return stocks, sorted(dates)


def cross_section(stocks, dates):
    """날짜 x 종목 행렬로 20일 평균 거래대금·20일 수익률의 유효 종목 내 순위/백분위를 만든다."""
    di = {d: i for i, d in enumerate(dates)}
    ns, nd = len(stocks), len(dates)
    amt = np.full((ns, nd), np.nan)
    ret = np.full((ns, nd), np.nan)
    for s, (_, d, a) in enumerate(stocks):
        c, v = a[:, 3], a[:, 4]
        idx = np.array([di[x] for x in d])
        val = (c * v >= K.MIN_AMOUNT) & (np.arange(len(c)) >= 260)
        am20 = S.sma(c * v, 20)
        r20 = np.full(len(c), np.nan)
        r20[20:] = c[20:] / c[:-20] - 1
        amt[s, idx[val]] = am20[val]
        ret[s, idx[val]] = r20[val]
    amt_top = np.zeros((ns, nd), bool)
    ret_top = np.zeros((ns, nd), bool)
    for j in range(nd):
        col = amt[:, j]
        ok = np.nonzero(~np.isnan(col))[0]
        if len(ok) == 0:
            continue
        order = ok[np.argsort(-col[ok])][:TOP_AMOUNT]
        amt_top[order, j] = True
        rc = ret[ok, j]
        good = ~np.isnan(rc)
        if good.any():
            thr = np.quantile(rc[good], RET_PCT)
            ret_top[ok[good & (rc >= thr)], j] = True
    return di, amt_top, ret_top


def regime(kospi_path, dates):
    rows = json.load(open(kospi_path, encoding='utf-8'))['rows']
    cl = {r['date']: float(r['close']) for r in rows if r.get('close')}
    kd = sorted(cl)
    arr = np.array([cl[d] for d in kd])
    ma = S.sma(arr, 60)
    on = {kd[i]: bool(arr[i] > ma[i]) for i in range(len(kd)) if not np.isnan(ma[i])}
    return np.array([on.get(d, False) for d in dates])


def summarize(trades):
    """trades: (진입일 yyyymmdd, 보유일, 비용 전 수익률)."""
    vals = [t[2] - COST for t in trades]
    days = [t[0] for t in trades]
    gross = [t[2] for t in trades]
    wins = [x for x in vals if x > 0]
    loss = [x for x in vals if x <= 0]
    item = {'all': S.stat_rows(vals, days)}
    if vals:
        item['grossMean'] = round(float(np.mean(gross)) * 100, 3)
        item['winRate'] = round(len(wins) / len(vals) * 100, 1)
        item['payoff'] = round(abs(np.mean(wins) / np.mean(loss)), 2) if wins and loss and np.mean(loss) else None
        item['avgHold'] = round(float(np.mean([t[1] for t in trades])), 1)
    for tag, sel in (('early', lambda d: d < SPLIT), ('late', lambda d: d >= SPLIT)):
        pick = [j for j, d in enumerate(days) if sel(d)]
        item[tag] = S.stat_rows([vals[j] for j in pick], [days[j] for j in pick])

    def ok(st):
        return (st.get('n', 0) >= MIN_EVENTS and st['mean'] >= 0.5 and st.get('clusterCi95') and st['clusterCi95'][0] > 0
                and st.get('meanNoTop5') is not None and st['meanNoTop5'] > 0)
    if min(item['early'].get('n', 0), item['late'].get('n', 0)) < MIN_EVENTS:
        item['verdict'] = '판정 불가'
    else:
        item['verdict'] = '신호 있음' if ok(item['early']) and ok(item['late']) else '신호 없음'
    return item


def main():
    cache, kospi, outp = sys.argv[1:4]
    stocks, dates = load_all(cache)
    di, amt_top, ret_top = cross_section(stocks, dates)
    reg = regime(kospi, dates)
    combos = [(f, x, 'E0') for f in FILTERS for x in EXITS] + [('F2', x, 'E1') for x in ('X1', 'X2', 'X3')]
    acc = {(n, f, x, e): [] for n in NAMES for (f, x, e) in combos}
    print('stocks', len(stocks), 'dates', len(dates), 'regime-on days', int(reg.sum()), flush=True)
    for s, (code, d, a) in enumerate(stocks):
        o, h, l, c, v = a[:, 0], a[:, 1], a[:, 2], a[:, 3], a[:, 4]
        idx = np.array([di[x] for x in d])
        valid = (c * v >= K.MIN_AMOUNT) & (np.arange(len(c)) >= 260)
        r_on = reg[idx]
        f_mask = {'F0': valid, 'F1': valid & r_on, 'F2': valid & r_on & amt_top[s, idx]}
        f_mask['F3'] = f_mask['F2'] & ret_top[s, idx]
        gap_ok = np.ones(len(c), bool)
        gap_ok[:-1] = o[1:] <= c[:-1] * 1.03
        sigs = K.signals(o, h, l, c)
        for name in NAMES:
            b, sl = sigs[name]
            for (f, x, e) in combos:
                m = b & f_mask[f]
                if e == 'E1':
                    m = m & gap_ok
                if not m.any():
                    continue
                for (ei, ki, r) in run_trades(o, h, l, c, m, x, sl):
                    acc[(name, f, x, e)].append((d[ei], ki - ei + 1, float(r)))
        if s % 300 == 0:
            print('progress', s, flush=True)
    res = {'cost': COST, 'results': {}}
    for key, tr in acc.items():
        res['results']['|'.join(key)] = summarize(tr)
    json.dump(res, open(outp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    rows = sorted(res['results'].items(), key=lambda kv: -(kv[1]['all'].get('mean') or -99) if kv[1]['all'].get('n', 0) >= 300 else 99)
    for k, v in rows[:25]:
        a = v['all']
        print(k, v['verdict'], 'n=%s mean=%s gross=%s win=%s payoff=%s early=%s late=%s' % (a.get('n'), a.get('mean'), v.get('grossMean'), v.get('winRate'), v.get('payoff'), v['early'].get('mean'), v['late'].get('mean')))
    print('신호 있음:', [k for k, v in res['results'].items() if v['verdict'] == '신호 있음'])


if __name__ == '__main__':
    main()
