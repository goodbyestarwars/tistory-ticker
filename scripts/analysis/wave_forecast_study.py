# -*- coding: utf-8 -*-
"""다음 파동 시나리오(js/wave-forecast.js) 오프라인 검증 연구 (2026-10-14).
운영 화면·VM·계좌·자동매수와 연결하지 않는다. 결과는 가설 검증일 뿐이며 독립 검증(다른 기간·다른 종목군) 없이는 예측력이 확인됐다고 말하지 않는다.

질문: 날짜별로 그 날까지의 자료만으로 낸 시나리오(주 시나리오 5종)가 이후 5·10·20거래일의 가격 분포를 '아무 날'(기준선)과 다르게 만드는가?
  - 사전에 정한 기대 방향: continuation(+) · pullback(+) · fakeRally(-) · breakdown(-) · compression(변동폭 확대)
  - 비교 대상: 기준선(아무 날) · 단순 이동평균 규칙(종가>60일선, 20일선>60일선) · 기존 눌림목 검색기(pattern_detect.detect_pullback 점수 80 이상, 돌파 전)
측정(신호일 t 의 종가 기준): 상승/하락 마감 비율, 중앙값·10~90 백분위 수익률, 이후 최대 상승폭(MFE)·최대 하락폭(MAE), 시나리오 자체 가격 조건(확인가·무효화가)의
성공·실패 비율, 1.5xATR 먼저 닿은 쪽, 변동 범위(1σ 참고선)의 적중 비율. 거래비용 반영 값은 '다음 날 시가+0.2% 진입, h일 종가-0.3% 청산, 왕복 0.4%'(exit_study 와 같은 가정).

방법: 표본은 종목별 3거래일 간격, 같은 종목·같은 그룹의 표본은 h일 안에 겹치지 않게 솎아(독립에 가깝게) 센다. 개발/검증은 표본 날짜의 55% 지점으로 나눈다.
표시 문턱(gate): 표본 n>=200, 검증 n>=100, 개발·검증 평균 차이의 부호가 기대 방향과 같고, 검증 |z|>=2.9(15칸 Bonferroni 근사)·개발 |z|>=2.0 일 때만 화면에 숫자를 보여 준다.
한계: 종목군이 현재 사이트 섹터 목록(생존 편향), 5년 한 번의 표본, 일봉 근사 체결, 수정주가 아닌 원 OHLCV, 시장 국면은 이 종목군 동일가중 지수의 120일 수익률로 나눈 대용치.

사용: python scripts/analysis/wave_forecast_study.py --db bt.db --out wave_forecast_study.json [--stats-js data/wave-forecast-stats.js] [--workers 4] [--stride 3]
"""
import argparse
import bisect
import json
import math
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'scripts', 'cloud-vm'))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(REPO, 'quant-autotrade', 'backtest'))

import signal_backtest as sb  # noqa: E402
import exit_study as es  # noqa: E402

H = (5, 10, 20)
SCEN = ('continuation', 'pullback', 'compression', 'fakeRally', 'breakdown')
EXPECT = {'continuation': 1, 'pullback': 1, 'fakeRally': -1, 'breakdown': -1, 'compression': 0}
GATE = {'minSamples': 200, 'minValidationSamples': 100, 'zValidation': 2.9, 'zDevelopment': 2.0}
ATR_K = 1.5
ENTRY_SLIP, EXIT_SLIP, COST, GAP_SKIP = es.ENTRY_SLIP, es.EXIT_SLIP, es.COST, es.GAP_SKIP


# ---------------------------------------------------------------- 입력
def export_bars(db, path, min_rows=500):
    conn = sqlite3.connect(db)
    codes = [r[0] for r in conn.execute('SELECT code FROM daily_prices GROUP BY code HAVING COUNT(*) >= ? ORDER BY code', (min_rows,))]
    data = {}
    for code in codes:
        daily = sb.load(conn, code)
        data[code] = [[b['date'], b['open'], b['high'], b['low'], b['close'], b.get('volume') or 0] for b in daily]
    conn.close()
    json.dump(data, open(path, 'w'))
    return data


def run_node(bars_path, out_dir, stride, shards):
    procs = []
    for k in range(shards):
        out = os.path.join(out_dir, 'samples_%d.json' % k)
        procs.append((out, subprocess.Popen(['node', os.path.join(HERE, 'wave_forecast_study.js'), bars_path, out, '--stride', str(stride), '--shard', '%d/%d' % (k, shards)],
                                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')))
    samples, meta = {}, None
    for out, p in procs:
        so, se = p.communicate()
        print(so.strip(), se.strip().splitlines()[-1:] if se.strip() else '', flush=True)
        if p.returncode != 0:
            raise SystemExit('node shard failed: ' + se[-500:])
        doc = json.load(open(out))
        meta = {k: doc[k] for k in ('modelVersion', 'engineVersion', 'level', 'stride', 'window')}
        samples.update(doc['samples'])
    return samples, meta


# ---------------------------------------------------------------- 기존 눌림목 검색기·단순 이동평균 규칙(그 날까지의 자료만)
def screener_flags(args):
    db, code, idxs = args
    import pattern_detect as pdx
    conn = sqlite3.connect(db)
    daily = sb.load(conn, code)
    conn.close()
    closes = [b['close'] for b in daily]
    pre = [0.0]
    for c in closes:
        pre.append(pre[-1] + c)

    def ma(i, p):
        return (pre[i + 1] - pre[i + 1 - p]) / p if i + 1 >= p else None
    out = {}
    for i in idxs:
        m20, m60 = ma(i, 20), ma(i, 60)
        rule = bool(m20 and m60 and closes[i] > m60 and m20 > m60 and closes[i] > m20)
        excl = False
        try:
            excl = bool(es.excluded_at(pdx, code, daily, i))
        except Exception:
            excl = False
        pb = False
        if not excl:
            try:
                d = pdx.detect_pullback(daily[:i + 1])
                pb = bool(d is not None and not d.get('breakout') and (d.get('score') or 0) >= es.MIN_SCORE['pullback'])
            except Exception:
                pb = False
        out[i] = (rule, pb, excl)
    return code, out


# ---------------------------------------------------------------- 결과 측정
def first_touch(closes, i, h, up, down):
    for k in range(i + 1, i + h + 1):
        c = closes[k]
        if up is not None and c >= up:
            return 'up'
        if down is not None and c <= down:
            return 'down'
    return 'none'


def measure(daily, s, h):
    i = s['i']
    n = len(daily)
    if i + h >= n:
        return None
    c0 = daily[i]['close']
    if not c0 or c0 <= 0:
        return None
    closes = [b['close'] for b in daily]
    r = closes[i + h] / c0 - 1
    mfe = max(daily[k]['high'] for k in range(i + 1, i + h + 1)) / c0 - 1
    mae = min(daily[k]['low'] for k in range(i + 1, i + h + 1)) / c0 - 1
    net = None
    o1 = daily[i + 1]['open']
    if o1 and o1 / c0 - 1 < GAP_SKIP:
        entry = o1 * (1 + ENTRY_SLIP)
        net = closes[i + h] * (1 - EXIT_SLIP) / entry - 1 - COST
    atr = s.get('atr')
    atr_touch = None
    if atr:
        atr_touch = first_touch(closes, i, h, c0 + ATR_K * atr, c0 - ATR_K * atr)
    # 시나리오 자체 가격 조건: 확인가(위)·이탈가(아래)를 종가로 먼저 넘은 쪽. 이미 넘은 쪽은 비교하지 않는다.
    up_ref = s['up'] if s.get('up') is not None and s['up'] > c0 else None
    down_ref = s['down'] if s.get('down') is not None and s['down'] < c0 else None
    if down_ref is None and s.get('inv') is not None and s['inv'] < c0:
        down_ref = s['inv']
    if up_ref is None and s.get('inv') is not None and s['inv'] > c0:
        up_ref = s['inv']
    lv = first_touch(closes, i, h, up_ref, down_ref) if (up_ref is not None or down_ref is not None) else None
    band = s['bands'].get(str(h))
    in_band = None
    if band and band[0] is not None:
        in_band = band[0] <= closes[i + h] <= band[1]
    return {'r': r, 'mfe': mfe, 'mae': mae, 'net': net, 'atr': atr_touch, 'lv': lv, 'refs': (up_ref is not None, down_ref is not None), 'band': in_band}


# ---------------------------------------------------------------- 통계
def pct(sorted_vals, q):
    if not sorted_vals:
        return None
    k = (len(sorted_vals) - 1) * q
    lo, hi = int(math.floor(k)), int(math.ceil(k))
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


def basic(vals):
    n = len(vals)
    if n == 0:
        return {'n': 0}
    m = sum(vals) / n
    sd = math.sqrt(sum((x - m) ** 2 for x in vals) / (n - 1)) if n > 1 else 0
    v = sorted(vals)
    return {'n': n, 'mean': m, 'sd': sd, 'se': sd / math.sqrt(n) if n else 0, 'median': pct(v, 0.5), 'p10': pct(v, 0.1), 'p90': pct(v, 0.9)}


def welch_z(a, b):
    if a.get('n', 0) < 2 or b.get('n', 0) < 2:
        return None
    den = math.sqrt(a['se'] ** 2 + b['se'] ** 2)
    return (a['mean'] - b['mean']) / den if den > 0 else None


def thin(rows, h):
    """같은 종목·같은 그룹의 표본이 h일 안에 겹치지 않게 앞에서부터 솎는다. rows: (code, i, date, meas)"""
    kept, last = [], {}
    for row in sorted(rows, key=lambda x: (x[0], x[1])):
        if row[1] - last.get(row[0], -10 ** 9) >= h:
            kept.append(row)
            last[row[0]] = row[1]
    return kept


def summarize(rows, base_rows, cut, expect):
    """rows: thinned [(code,i,date,meas)] -> 구간별(전체·개발·검증) 통계와 기준선 대비 차이."""
    def block(sel, base_sel):
        rs = [m['r'] for _, _, _, m in sel]
        b = basic(rs)
        bb = basic([m['r'] for _, _, _, m in base_sel])
        mf = sorted(m['mfe'] for _, _, _, m in sel)
        ma = sorted(m['mae'] for _, _, _, m in sel)
        rng = basic([m['mfe'] - m['mae'] for _, _, _, m in sel])
        brng = basic([m['mfe'] - m['mae'] for _, _, _, m in base_sel])
        nets = [m['net'] for _, _, _, m in sel if m['net'] is not None]
        out = {'n': b['n']}
        if b['n']:
            out.update({'mean': b['mean'], 'median': b['median'], 'p10': b['p10'], 'p90': b['p90'],
                        'up': sum(1 for x in rs if x > 0) / b['n'], 'down': sum(1 for x in rs if x < 0) / b['n'],
                        'mfe': pct(mf, 0.5), 'mae': pct(ma, 0.5), 'range': rng['mean'],
                        'net': (sum(nets) / len(nets)) if nets else None, 'netN': len(nets),
                        'dMean': (b['mean'] - bb['mean']) if bb.get('n') else None, 'zMean': welch_z(b, bb),
                        'dRange': (rng['mean'] - brng['mean']) if brng.get('n') else None, 'zRange': welch_z(rng, brng),
                        'baseUp': (sum(1 for _, _, _, m in base_sel if m['r'] > 0) / len(base_sel)) if base_sel else None,
                        'baseMean': bb.get('mean')})
        return out
    all_ = block(rows, base_rows)
    dev = block([r for r in rows if r[2] < cut], [r for r in base_rows if r[2] < cut])
    val = block([r for r in rows if r[2] >= cut], [r for r in base_rows if r[2] >= cut])
    return {'all': all_, 'dev': dev, 'val': val}


def gate_cell(cell, scenario):
    expect = EXPECT[scenario]
    reasons = []
    a, d, v = cell['all'], cell['dev'], cell['val']
    if a.get('n', 0) < GATE['minSamples']:
        reasons.append('표본 %d건(문턱 %d)' % (a.get('n', 0), GATE['minSamples']))
    if v.get('n', 0) < GATE['minValidationSamples']:
        reasons.append('검증 구간 표본 %d건(문턱 %d)' % (v.get('n', 0), GATE['minValidationSamples']))
    if not reasons:
        key_d, key_z = ('dRange', 'zRange') if scenario == 'compression' else ('dMean', 'zMean')
        dd, dv = d.get(key_d), v.get(key_d)
        zd, zv = d.get(key_z), v.get(key_z)
        sign = 1 if expect == 0 else expect
        if dd is None or dv is None or zd is None or zv is None:
            reasons.append('개발·검증 비교 불가')
        else:
            if dd * sign <= 0 or dv * sign <= 0:
                reasons.append('개발·검증 구간 방향이 기대와 다름')
            if abs(zv) < GATE['zValidation'] or zv * sign <= 0:
                reasons.append('검증 구간 유의성 부족(z=%.1f, 문턱 %.1f)' % (zv, GATE['zValidation']))
            if abs(zd) < GATE['zDevelopment'] or zd * sign <= 0:
                reasons.append('개발 구간 유의성 부족(z=%.1f, 문턱 %.1f)' % (zd, GATE['zDevelopment']))
    return {'passed': not reasons, 'reasons': reasons}


# ---------------------------------------------------------------- 본체
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True)
    ap.add_argument('--out', default='wave_forecast_study.json')
    ap.add_argument('--stats-js', default='')
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--stride', type=int, default=3)
    ap.add_argument('--samples', default='', help='이미 만든 표본 파일 재사용(node 단계 생략)')
    args = ap.parse_args()
    t0 = time.time()
    tmp = tempfile.mkdtemp(prefix='wave_forecast_')
    bars_path = os.path.join(tmp, 'bars.json')
    data = export_bars(args.db, bars_path)
    codes = sorted(data)
    print('stocks', len(codes), flush=True)
    if args.samples:
        doc = json.load(open(args.samples))
        samples = doc['samples']
        meta = {k: doc[k] for k in ('modelVersion', 'engineVersion', 'level', 'stride', 'window')}
    else:
        samples, meta = run_node(bars_path, tmp, args.stride, args.workers)
        json.dump({**meta, 'samples': samples}, open(os.path.join(os.path.dirname(os.path.abspath(args.out)), 'wave_forecast_samples.json'), 'w'))
    print('samples', sum(len(v) for v in samples.values()), '%.0fs' % (time.time() - t0), flush=True)

    daily = {c: [dict(date=r[0], open=r[1], high=r[2], low=r[3], close=r[4], volume=r[5]) for r in data[c]] for c in codes}
    # 기존 눌림목 검색기·단순 이동평균 규칙
    flags = {}
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        jobs = [(args.db, c, [s['i'] for s in samples.get(c, [])]) for c in codes]
        for k, (code, res) in enumerate(pool.map(screener_flags, jobs, chunksize=2)):
            flags[code] = res
            if (k + 1) % 40 == 0:
                print('screener %d/%d %.0fs' % (k + 1, len(codes), time.time() - t0), flush=True)

    # 시장 국면: 이 종목군 동일가중 지수의 직전 120거래일 수익률(그 날까지의 자료)
    dates = sorted({b['date'] for c in codes for b in daily[c]})
    pos = {d: k for k, d in enumerate(dates)}
    rets = {d: [] for d in dates}
    for c in codes:
        ds = daily[c]
        for k in range(1, len(ds)):
            if ds[k - 1]['close'] > 0:
                rets[ds[k]['date']].append(ds[k]['close'] / ds[k - 1]['close'] - 1)
    idx, level = [], 1.0
    for d in dates:
        r = [max(-0.3, min(0.3, x)) for x in rets[d]]    # 원 OHLCV 라 분할·병합 날짜의 극단값이 지수를 흔들지 않게 ±30%로 자른다
        level *= 1 + (sum(r) / len(r) if r else 0)
        idx.append(level)

    def regime(d):
        k = pos[d]
        if k < 120:
            return None
        ret = idx[k] / idx[k - 120] - 1
        return 'bull' if ret >= 0.10 else ('bear' if ret <= -0.10 else 'side')

    # 표본 측정
    groups = {g: {h: [] for h in H} for g in ('BASE', 'MA', 'PB') + SCEN}
    cases = {g: [] for g in SCEN}
    allc = []
    for c in codes:
        for s in samples.get(c, []):
            fl = flags.get(c, {}).get(s['i'])
            if fl is None or fl[2]:        # 제외 종목(신호일 시점 자료 기준)은 모든 그룹에서 뺀다
                continue
            s['regime_mkt'] = regime(s['date'])
            allc.append(s['date'])
            for h in H:
                m = measure(daily[c], s, h)
                if not m:
                    continue
                row = (c, s['i'], s['date'], m)
                groups['BASE'][h].append(row)
                if fl[0]:
                    groups['MA'][h].append(row)
                if fl[1]:
                    groups['PB'][h].append(row)
                if s['p']:
                    groups[s['p']][h].append(row)
                    if h == 10:
                        cases[s['p']].append((c, s['date'], m['r'], m['lv'], s['close']))
    ds = sorted(set(allc))
    cut = ds[int(len(ds) * 0.55)]
    years = sorted({d[:4] for d in ds})
    print('dates', ds[0], ds[-1], 'cut', cut, '%.0fs' % (time.time() - t0), flush=True)

    result = {'meta': {**meta, 'universe': len(codes), 'period': [ds[0], ds[-1]], 'cut': cut, 'gate': GATE, 'generated': time.strftime('%Y-%m-%d'),
                       'costs': {'entrySlip': ENTRY_SLIP, 'exitSlip': EXIT_SLIP, 'roundTrip': COST, 'gapSkip': GAP_SKIP}}, 'groups': {}, 'gate': {}, 'byYear': {}, 'byRegime': {},
              'walkForward': {}, 'band': {}, 'resolution': {}}
    thinned = {g: {h: thin(groups[g][h], h) for h in H} for g in groups}
    for h in H:
        base = thinned['BASE'][h]
        for g in groups:
            result['groups'].setdefault(g, {})['h%d' % h] = summarize(thinned[g][h], base, cut, EXPECT.get(g, 0))
        for g in SCEN:
            cell = result['groups'][g]['h%d' % h]
            result['gate'].setdefault(g, {})['h%d' % h] = gate_cell(cell, g)
            # 연도별·국면별(평균 수익률과 표본 수)
            result['byYear'].setdefault(g, {})['h%d' % h] = {y: (lambda sel: {'n': len(sel), 'mean': (sum(m['r'] for _, _, _, m in sel) / len(sel)) if sel else None})([r for r in thinned[g][h] if r[2][:4] == y]) for y in years}
            result['byRegime'].setdefault(g, {})['h%d' % h] = {k: (lambda sel: {'n': len(sel), 'mean': (sum(m['r'] for _, _, _, m in sel) / len(sel)) if sel else None})([r for r in thinned[g][h] if (regime(r[2]) or 'na') == k]) for k in ('bull', 'side', 'bear')}
            # 워크포워드: 연도 Y 의 기대 부호를 Y 이전 자료의 평균 차이 부호로 정하고 Y 에서 실제 부호와 비교
            wf = []
            for y in years[1:]:
                prior = [r for r in thinned[g][h] if r[2][:4] < y]
                prior_base = [r for r in base if r[2][:4] < y]
                cur = [r for r in thinned[g][h] if r[2][:4] == y]
                cur_base = [r for r in base if r[2][:4] == y]
                if len(prior) < 30 or len(cur) < 30:
                    continue
                dp = sum(m['r'] for *_, m in prior) / len(prior) - sum(m['r'] for *_, m in prior_base) / len(prior_base)
                dc = sum(m['r'] for *_, m in cur) / len(cur) - sum(m['r'] for *_, m in cur_base) / len(cur_base)
                wf.append({'year': y, 'priorDiff': dp, 'diff': dc, 'sameSign': (dp > 0) == (dc > 0), 'n': len(cur)})
            result['walkForward'].setdefault(g, {})['h%d' % h] = wf
            # 시나리오 자체 가격 조건의 성공·실패(주 시나리오가 확인가·이탈가를 가진 표본만)
            res = {'up': 0, 'down': 0, 'none': 0, 'atrUp': 0, 'atrDown': 0, 'atrNone': 0}
            for *_, m in thinned[g][h]:
                if m['lv']:
                    res[m['lv']] += 1
                if m['atr']:
                    res['atr' + m['atr'].capitalize()] += 1
            tot = res['up'] + res['down'] + res['none']
            side = EXPECT[g]
            res['n'] = tot
            res['success'] = (res['up'] / tot if side >= 0 else res['down'] / tot) if tot else None
            res['failure'] = (res['down'] / tot if side >= 0 else res['up'] / tot) if tot else None
            result['resolution'].setdefault(g, {})['h%d' % h] = res
        bs = [m['band'] for *_, m in base if m['band'] is not None]
        result['band']['h%d' % h] = {'n': len(bs), 'coverage': sum(bs) / len(bs) if bs else None}
    def pick(rows, ok):
        out, seen = [], set()
        for x in sorted(rows, key=lambda r: (r[1], r[0])):
            if x[3] and ok(x[3]) and x[0] not in seen:
                seen.add(x[0])
                out.append(list(x))
            if len(out) >= 3:
                break
        return out
    result['cases'] = {g: {'success': pick(cases[g], lambda lv, g=g: (lv == 'up') if EXPECT[g] >= 0 else (lv == 'down')),
                           'failure': pick(cases[g], lambda lv, g=g: (lv == 'down') if EXPECT[g] >= 0 else (lv == 'up'))} for g in SCEN}
    json.dump(result, open(args.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('wrote', args.out, '%.0fs' % (time.time() - t0))

    if args.stats_js:
        table = {'modelVersion': meta['modelVersion'], 'engineVersion': meta['engineVersion'], 'level': meta['level'], 'generated': result['meta']['generated'],
                 'period': result['meta']['period'], 'universe': '사이트 섹터 목록 %d종목(현재 상장 종목만 - 생존 편향)' % len(codes), 'cut': cut,
                 'note': '신호일 종가 기준 과거 통계입니다. 3거래일 간격 표본을 같은 종목 안에서 h일 안 겹치지 않게 솎았고, 통과 문턱을 넘은 칸만 숫자를 보여 줍니다.',
                 'gate': GATE, 'scenarios': {}}
        for g in SCEN:
            table['scenarios'][g] = {}
            for h in H:
                cell = result['groups'][g]['h%d' % h]
                a, v = cell['all'], cell['val']
                gate = result['gate'][g]['h%d' % h]
                res = result['resolution'][g]['h%d' % h]
                r4 = lambda x: None if x is None else round(x, 4)
                table['scenarios'][g]['h%d' % h] = {'n': a.get('n', 0), 'nVal': v.get('n', 0), 'gate': gate,
                                                    'up': r4(a.get('up')), 'down': r4(a.get('down')), 'median': r4(a.get('median')), 'p10': r4(a.get('p10')), 'p90': r4(a.get('p90')),
                                                    'mfe': r4(a.get('mfe')), 'mae': r4(a.get('mae')), 'baselineUp': r4(a.get('baseUp')), 'net': r4(a.get('net')),
                                                    'success': r4(res.get('success')), 'failure': r4(res.get('failure'))}
        open(args.stats_js, 'w', encoding='utf-8').write('window.WAVE_FORECAST_STATS = ' + json.dumps(table, ensure_ascii=False, separators=(',', ':')) + ';\n')
        print('wrote', args.stats_js)


if __name__ == '__main__':
    main()
