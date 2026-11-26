# -*- coding: utf-8 -*-
"""상승률 TOP30의 장 초반 상대 거래량 연구 (연구 전용, 읽기 전용 조회 - 2026-11-27).

기준은 `docs/TOP_GAINERS_COMMON_STUDY_2026-11-27.md` '추가' 절에 결과 확인 전 고정했다.
  select  <일봉 cache> <manifest.json>                 (키 불필요)
  fetch   <manifest.json> <분봉 cache>                 (KIS 키 환경변수 필요, 분봉 조회만)
  analyze <manifest.json> <일봉 cache> <분봉 cache> <out.json>
"""
import json
import os
import random
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import daytrade_support_breakout_minute_study as B  # noqa: E402

DAYS = 60
MIN_AMT = 3e8
N_TOP = 30
N_CTRL = 90
TIMES = ('0905', '0910', '0920', '0930', '1000')
COST = 0.004


def load_daily(cache):
    out = {}
    for f in os.listdir(cache):
        if not f.endswith('.json'):
            continue
        try:
            px = json.load(open(os.path.join(cache, f), encoding='utf-8'))['px']
        except (OSError, ValueError, KeyError):
            continue
        px = [r for r in px if r[1] and r[2] and r[3] and r[4] and r[2] >= r[3]]
        if len(px) >= 140:
            out[f[:-5]] = (px, {r[0]: i for i, r in enumerate(px)})
    return out


def select(cache, outp):
    data = load_daily(cache)
    days = sorted({d for px, ix in data.values() for d in ix})[-DAYS:]
    rng = random.Random(20261127)
    man = []
    for d in days:
        rows = []
        for code, (px, ix) in data.items():
            i = ix.get(d)
            if not i or i < 25:
                continue
            c, pc = px[i][4], px[i - 1][4]
            if c * px[i][5] >= MIN_AMT:
                rows.append((c / pc - 1, code))
        if len(rows) < 300:
            continue
        rows.sort(reverse=True)
        top = [c for _, c in rows[:N_TOP]]
        rest = sorted(c for _, c in rows[N_TOP:])
        ctrl = rng.sample(rest, N_CTRL)
        w = (len(rows) - N_TOP) / N_CTRL
        man += [{'d': d, 'code': c, 'g': 'top', 'w': 1.0, 'nu': len(rows)} for c in top]
        man += [{'d': d, 'code': c, 'g': 'ctrl', 'w': round(w, 3), 'nu': len(rows)} for c in ctrl]
    json.dump(man, open(outp, 'w'), ensure_ascii=False)
    print('days', len(days), 'stock-days', len(man))


def fetch(manp, cache):
    man = json.load(open(manp))
    call = B.make_kis_call(os.environ['KIS_APPKEY'], os.environ['KIS_APPSECRET'])
    os.makedirs(cache, exist_ok=True)
    got = reused = failed = 0
    for j, m in enumerate(man):
        path = os.path.join(cache, '%s_%s.json' % (m['code'], m['d']))
        if os.path.exists(path):
            reused += 1
            continue
        try:
            bars = B.fetch_day(call, m['code'], m['d'])
        except Exception as exc:  # noqa: BLE001 - 개별 실패는 건너뛰고 계속
            failed += 1
            print('fail', m['code'], m['d'], str(exc)[:80], flush=True)
            continue
        json.dump({'code': m['code'], 'date': m['d'], 'bars': bars}, open(path + '.tmp', 'w'))
        os.replace(path + '.tmp', path)
        got += 1
        if j % 200 == 0:
            print('progress', j, len(man), 'fetched', got, 'failed', failed, flush=True)
    print('fetched', got, 'failed', failed, 'reused', reused)


def feats(px, ix, bars, d):
    i = ix.get(d)
    if not i or i < 25 or not bars:
        return None
    pc = px[i - 1][4]
    base = float(np.mean([r[5] for r in px[i - 20:i]]))
    if base <= 0 or pc <= 0:
        return None
    out = {'gap': bars[0][1] / pc - 1, 'close': bars[-1][4]}
    for T in TIMES:
        early = [b for b in bars if b[0] < T + '00']
        if not early:
            return None
        out['cv' + T] = sum(b[5] for b in early) / base
        out['ret' + T] = early[-1][4] / pc - 1
        out['p' + T] = early[-1][4]
    return out


def auc(pos, neg):
    pos, neg = np.array(pos), np.array(neg)
    if len(pos) == 0 or len(neg) == 0:
        return None
    allv = np.concatenate([pos, neg])
    order = allv.argsort().argsort() + 1
    u = order[:len(pos)].sum() - len(pos) * (len(pos) + 1) / 2
    return round(float(u / (len(pos) * len(neg))), 3)


def wmean(sel, T):
    if not sel:
        return None
    return round(float(np.average([r['close'] / r['p' + T] - 1 - COST for r in sel], weights=[r['w'] for r in sel])) * 100, 2)


def analyze(manp, dcache, mcache, outp):
    man = json.load(open(manp))
    data = load_daily(dcache)
    rows = []
    for m in man:
        path = os.path.join(mcache, '%s_%s.json' % (m['code'], m['d']))
        if not os.path.exists(path) or m['code'] not in data:
            continue
        bars = [tuple(b) for b in json.load(open(path))['bars']]
        f = feats(data[m['code']][0], data[m['code']][1], bars, m['d'])
        if f:
            f.update({'d': m['d'], 'g': m['g'], 'w': m['w'], 'code': m['code']})
            rows.append(f)
    res = {'rows': len(rows), 'top': sum(1 for r in rows if r['g'] == 'top'), 'auc': {}, 'rules': []}
    for T in TIMES:
        res['auc'][T] = {'cv': auc([r['cv' + T] for r in rows if r['g'] == 'top'], [r['cv' + T] for r in rows if r['g'] == 'ctrl']),
                         'ret': auc([r['ret' + T] for r in rows if r['g'] == 'top'], [r['ret' + T] for r in rows if r['g'] == 'ctrl'])}
    days = sorted({r['d'] for r in rows})
    mid = days[len(days) // 2] if days else ''
    base_pct = round(N_TOP / np.mean([m['nu'] for m in man]) * 100, 2)
    for T in ('0910', '0930'):
        for cvm in (0.2, 0.5, 1.0):
            for rtm in (0.03, 0.06, 0.10):
                sel = [r for r in rows if r['cv' + T] >= cvm and rtm <= r['ret' + T] < 0.27]
                if not sel:
                    res['rules'].append({'T': T, 'cv': cvm, 'ret': rtm, 'n': 0})
                    continue
                w = np.array([r['w'] for r in sel])
                istop = np.array([1.0 if r['g'] == 'top' else 0.0 for r in sel])
                res['rules'].append({
                    'T': T, 'cv': cvm, 'ret': rtm, 'nTop': int(istop.sum()), 'nCtrl': int(len(sel) - istop.sum()),
                    'precisionPct': round(float((w * istop).sum() / w.sum()) * 100, 2), 'basePct': base_pct,
                    'meanToClosePct': wmean(sel, T),
                    'half1': wmean([r for r in sel if r['d'] < mid], T), 'half2': wmean([r for r in sel if r['d'] >= mid], T)})
    json.dump(res, open(outp, 'w'), ensure_ascii=False, indent=1)
    print('rows', res['rows'], 'top', res['top'])
    print('AUC', json.dumps(res['auc']))
    for r in res['rules']:
        print(r)


TP_LIST = (0.03, 0.05)
SL_LIST = (None, 0.03, 0.05)


def select_kq(cache, oldman, split, outp):
    """코스닥만: 코스닥 안 TOP30 + 기존 무작위 비교군 중 코스닥·비TOP30. 가중은 코스닥 모집단 기준."""
    kq = set(json.load(open(split))['KOSDAQ'])
    data = load_daily(cache)
    old = json.load(open(oldman))
    ctrl_by_day = {}
    for m in old:
        if m['g'] == 'ctrl' and m['code'] in kq:
            ctrl_by_day.setdefault(m['d'], []).append(m['code'])
    days = sorted({m['d'] for m in old})
    man = []
    for d in days:
        rows = []
        for code, (px, ix) in data.items():
            i = ix.get(d)
            if code not in kq or not i or i < 25:
                continue
            c, pc = px[i][4], px[i - 1][4]
            if c * px[i][5] >= MIN_AMT:
                rows.append((c / pc - 1, code))
        if len(rows) < 100:
            continue
        rows.sort(reverse=True)
        top = [c for _, c in rows[:N_TOP]]
        ctrl = [c for c in ctrl_by_day.get(d, []) if c not in set(top)]
        if not ctrl:
            continue
        w = (len(rows) - N_TOP) / len(ctrl)
        man += [{'d': d, 'code': c, 'g': 'top', 'w': 1.0, 'nu': len(rows)} for c in top]
        man += [{'d': d, 'code': c, 'g': 'ctrl', 'w': round(w, 3), 'nu': len(rows)} for c in ctrl]
    json.dump(man, open(outp, 'w'), ensure_ascii=False)
    missing = sum(1 for m in man if not os.path.exists(os.path.join('/home/ubuntu/study_side/minute/cache', '%s_%s.json' % (m['code'], m['d']))))
    print('days', len(days), 'stock-days', len(man), 'missing', missing)


def simulate_exit(bars, T, tp, sl):
    """T 직전 분봉 종가 진입 → 이후 분봉에서 익절/손절 선터치(같은 분봉이면 손절 우선). 15:20까지 못 닿으면 마지막 가격 평가."""
    early = [b for b in bars if b[0] < T + '00']
    later = [b for b in bars if T + '00' <= b[0] <= '152000']
    if not early or not later:
        return None
    p = early[-1][4]
    for b in later:
        if sl is not None and b[3] <= p * (1 - sl):
            return 'sl', -sl
        if b[2] >= p * (1 + tp):
            return 'tp', tp
    return 'none', later[-1][4] / p - 1


def pct5(vals, w):
    order = np.argsort(vals)
    v, ww = np.array(vals)[order], np.array(w)[order]
    cum = np.cumsum(ww) / ww.sum()
    return round(float(v[np.searchsorted(cum, 0.05)]) * 100, 2)


def analyze_kq(manp, dcache, mcache, outp):
    man = json.load(open(manp))
    data = load_daily(dcache)
    rows = []
    for m in man:
        path = os.path.join(mcache, '%s_%s.json' % (m['code'], m['d']))
        if not os.path.exists(path) or m['code'] not in data:
            continue
        bars = [tuple(b) for b in json.load(open(path))['bars']]
        f = feats(data[m['code']][0], data[m['code']][1], bars, m['d'])
        if f:
            f.update({'d': m['d'], 'g': m['g'], 'w': m['w'], 'code': m['code'], 'bars': bars})
            rows.append(f)
    days = sorted({r['d'] for r in rows})
    mid = days[len(days) // 2] if days else ''
    res = {'rows': len(rows), 'top': sum(1 for r in rows if r['g'] == 'top'), 'rules': []}
    rule_sets = [('ALL', 0.0, -9.0)] + [(None, cv, rt) for cv in (0.2, 0.5, 1.0) for rt in (0.03, 0.06, 0.10)]
    for T in ('0910', '0930'):
        for _, cvm, rtm in rule_sets:
            sel = [r for r in rows if r['cv' + T] >= cvm and rtm <= r['ret' + T] < 0.27]
            if len(sel) < 20:
                continue
            for tp in TP_LIST:
                for sl in SL_LIST:
                    sims = [(r, simulate_exit(r['bars'], T, tp, sl)) for r in sel]
                    sims = [(r, s) for r, s in sims if s]
                    if not sims:
                        continue
                    w = np.array([r['w'] for r, _ in sims])
                    ret = np.array([s[1] - COST for _, s in sims])
                    kind = [s[0] for _, s in sims]
                    share = lambda k: round(float(sum(wi for wi, kd in zip(w, kind) if kd == k) / w.sum()) * 100, 1)  # noqa: E731

                    def half(f):
                        sub = [(r, s) for r, s in sims if f(r['d'])]
                        if not sub:
                            return None
                        return round(float(np.average([s[1] - COST for _, s in sub], weights=[r['w'] for r, _ in sub])) * 100, 2)
                    res['rules'].append({
                        'T': T, 'cv': cvm, 'ret': None if rtm < -1 else rtm, 'tp': tp, 'sl': sl,
                        'nTop': sum(1 for r, _ in sims if r['g'] == 'top'), 'nCtrl': sum(1 for r, _ in sims if r['g'] == 'ctrl'),
                        'tpPct': share('tp'), 'slPct': share('sl'), 'nonePct': share('none'),
                        'mean': round(float(np.average(ret, weights=w)) * 100, 2), 'p5': pct5(ret, w),
                        'half1': half(lambda d: d < mid), 'half2': half(lambda d: d >= mid)})
    json.dump(res, open(outp, 'w'), ensure_ascii=False, indent=1)
    print('rows', res['rows'], 'top', res['top'])
    for r in res['rules']:
        print(json.dumps(r, ensure_ascii=False))


def squeeze_ratio(px, i):
    """t-1까지 최근 10일 일중 변동폭 평균 / 최근 60일 평균. 자료 부족이면 None."""
    if i < 62:
        return None
    seg = px[i - 60:i]
    rng = [(r[2] - r[3]) / r[4] for r in seg]
    base = float(np.mean(rng))
    return float(np.mean(rng[-10:])) / base if base > 0 else None


def analyze_sq(manp, dcache, mcache, split, outp):
    kq = set(json.load(open(split))['KOSDAQ'])
    man = json.load(open(manp))
    data = load_daily(dcache)
    days = sorted({m['d'] for m in man})
    thr = {}
    for d in days:
        vals = []
        for code in kq:
            if code in data:
                px, ix = data[code]
                i = ix.get(d)
                if i and px[i][4] * px[i][5] >= MIN_AMT:
                    v = squeeze_ratio(px, i)
                    if v is not None:
                        vals.append(v)
        if len(vals) > 100:
            thr[d] = (float(np.percentile(vals, 30)), float(np.percentile(vals, 70)))
    rows = []
    for m in man:
        path = os.path.join(mcache, '%s_%s.json' % (m['code'], m['d']))
        if not os.path.exists(path) or m['code'] not in data or m['d'] not in thr:
            continue
        px, ix = data[m['code']]
        sq = squeeze_ratio(px, ix.get(m['d'], 0))
        bars = [tuple(b) for b in json.load(open(path))['bars']]
        f = feats(px, ix, bars, m['d'])
        if f and sq is not None:
            lo, hi = thr[m['d']]
            f.update({'d': m['d'], 'g': m['g'], 'w': m['w'], 'bars': bars, 'sqTag': 'expand' if sq >= hi else ('contract' if sq <= lo else 'mid')})
            rows.append(f)
    mid = days[len(days) // 2]
    res = {'rows': len(rows), 'rules': []}
    for tag in ('any', 'expand', 'contract'):
        for T in ('0910', '0930'):
            for cvm in (0.5, 1.0):
                for rtm in (0.03, 0.06):
                    sel = [r for r in rows if (tag == 'any' or r['sqTag'] == tag) and r['cv' + T] >= cvm and rtm <= r['ret' + T] < 0.27]
                    if len(sel) < 20:
                        continue
                    for tp in TP_LIST:
                        for sl in (None, 0.03):
                            sims = [(r, simulate_exit(r['bars'], T, tp, sl)) for r in sel]
                            sims = [(r, s) for r, s in sims if s]
                            if not sims:
                                continue
                            w = np.array([r['w'] for r, _ in sims])
                            ret = np.array([s[1] - COST for _, s in sims])
                            kind = [s[0] for _, s in sims]

                            def half(f):
                                sub = [(r, s) for r, s in sims if f(r['d'])]
                                return round(float(np.average([s[1] - COST for _, s in sub], weights=[r['w'] for r, _ in sub])) * 100, 2) if sub else None
                            res['rules'].append({
                                'sq': tag, 'T': T, 'cv': cvm, 'ret': rtm, 'tp': tp, 'sl': sl,
                                'nTop': sum(1 for r, _ in sims if r['g'] == 'top'), 'nCtrl': sum(1 for r, _ in sims if r['g'] == 'ctrl'),
                                'tpPct': round(float(sum(wi for wi, kd in zip(w, kind) if kd == 'tp') / w.sum()) * 100, 1),
                                'slPct': round(float(sum(wi for wi, kd in zip(w, kind) if kd == 'sl') / w.sum()) * 100, 1),
                                'mean': round(float(np.average(ret, weights=w)) * 100, 2), 'p5': pct5(ret, w),
                                'half1': half(lambda d: d < mid), 'half2': half(lambda d: d >= mid)})
    json.dump(res, open(outp, 'w'), ensure_ascii=False, indent=1)
    print('rows', res['rows'], {t: sum(1 for r in rows if r['sqTag'] == t) for t in ('expand', 'contract', 'mid')})
    for r in res['rules']:
        print(json.dumps(r, ensure_ascii=False))


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'analyze_sq':
        analyze_sq(*sys.argv[2:7])
        sys.exit(0)
    if cmd == 'select':
        select(sys.argv[2], sys.argv[3])
    elif cmd == 'select_kq':
        select_kq(*sys.argv[2:6])
    elif cmd == 'fetch':
        fetch(sys.argv[2], sys.argv[3])
    elif cmd == 'analyze_kq':
        analyze_kq(*sys.argv[2:6])
    else:
        analyze(*sys.argv[2:6])
