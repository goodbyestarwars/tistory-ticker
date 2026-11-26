# -*- coding: utf-8 -*-
"""일별 상승률 TOP30의 전일 특성 공통점 (연구 전용 - 2026-11-27).

기준은 `docs/TOP_GAINERS_COMMON_STUDY_2026-11-27.md`에 결과 확인 전 고정했다.
실행: python top_gainers_common_study.py <일봉 cache> <out.json>
"""
import json
import os
import sys

import numpy as np

MIN_AMT = 3e8
FEATS = ['relv1', 'relv5', 'r1', 'r5', 'r20', 'r60', 'r120', 'dd52', 'pos52', 'squeeze', 'a20', 'a60', 'a224', 'align', 'amt20',
         'gap', 'relvT', 'closeLoc']


def load(cache):
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


def features(px, i):
    a = np.array([r[1:6] for r in px[max(0, i - 260):i + 1]], float)
    o, h, l, c, v = a[:, 0], a[:, 1], a[:, 2], a[:, 3], a[:, 4]
    n = len(c) - 1                      # 마지막 인덱스 = 당일 t
    p = n - 1                           # 전일
    if p < 125:
        return None
    base20 = v[p - 20:p].mean()
    if base20 <= 0:
        return None
    sma = lambda k: c[p - k + 1:p + 1].mean() if p + 1 >= k else np.nan  # noqa: E731
    hi, lo = h[max(0, p - 251):p + 1].max(), l[max(0, p - 251):p + 1].min()
    rng = (h[p - 9:p + 1] - l[p - 9:p + 1]) / c[p - 9:p + 1]
    rng60 = (h[p - 59:p + 1] - l[p - 59:p + 1]) / c[p - 59:p + 1]
    s20, s60, s224 = sma(20), sma(60), sma(224)
    return {
        'relv1': v[p] / base20,
        'relv5': v[p - 4:p + 1].mean() / max(v[p - 24:p - 4].mean(), 1),
        'r1': c[p] / c[p - 1] - 1, 'r5': c[p] / c[p - 5] - 1, 'r20': c[p] / c[p - 20] - 1, 'r60': c[p] / c[p - 60] - 1,
        'r120': c[p] / c[p - 120] - 1,
        'dd52': c[p] / hi, 'pos52': (c[p] - lo) / (hi - lo) if hi > lo else np.nan,
        'squeeze': rng.mean() / max(rng60.mean(), 1e-9),
        'a20': float(c[p] > s20), 'a60': float(c[p] > s60), 'a224': float(c[p] > s224) if not np.isnan(s224) else np.nan,
        'align': float(s20 > s60) if not np.isnan(s60) else np.nan,
        'amt20': float((c[p - 19:p + 1] * v[p - 19:p + 1]).mean()),
        'gap': o[n] / c[p] - 1, 'relvT': v[n] / base20,
        'closeLoc': (c[n] - l[n]) / (h[n] - l[n]) if h[n] > l[n] else np.nan,
    }


def pct_rank(vals, x):
    vals = vals[~np.isnan(vals)]
    if len(vals) == 0 or np.isnan(x):
        return np.nan
    return float((vals < x).sum() + 0.5 * (vals == x).sum()) / len(vals) * 100


def main():
    cache, outp = sys.argv[1:3]
    data = load(cache)
    alld = sorted({d for px, ix in data.values() for d in ix})
    days = [d for d in alld if d >= '20251201']
    res = {}
    for d in days:
        rows = []
        for code, (px, ix) in data.items():
            i = ix.get(d)
            if not i or i < 130:
                continue
            c, pc = px[i][4], px[i - 1][4]
            if c * px[i][5] < MIN_AMT:
                continue
            rows.append((c / pc - 1, code, i))
        if len(rows) < 300:
            continue
        rows.sort(reverse=True)
        feat = {}
        for r, code, i in rows:
            f = features(data[code][0], i)
            if f:
                feat[code] = (r, f, data[code][0][i][4] * data[code][0][i][5])
        if len(feat) < 300:
            continue
        top = sorted(feat.items(), key=lambda kv: -kv[1][0])[:30]
        top50 = [kv for kv in sorted(feat.items(), key=lambda kv: -kv[1][0]) if kv[1][2] >= 50e8][:30]
        mat = {k: np.array([v[1][k] for v in feat.values()], float) for k in FEATS}
        day = {'n': len(feat), 'top': {}, 'top50': {}, 'topCodes': [c for c, _ in top[:30]]}
        for tag, grp in (('top', top), ('top50', top50)):
            for k in FEATS:
                ps = [pct_rank(mat[k], v[1][k]) for _, v in grp]
                ps = [x for x in ps if not np.isnan(x)]
                day[tag][k] = round(float(np.mean(ps)), 1) if ps else None
        res[d] = day
    json.dump(res, open(outp, 'w', encoding='utf-8'), ensure_ascii=False)
    print('days', len(res))


if __name__ == '__main__':
    main()
