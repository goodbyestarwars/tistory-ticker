# -*- coding: utf-8 -*-
"""시장·종목 하락 추세 필터 적용 전후 비교 (2026-10-11, 오프라인 전용).

exit_study.py 의 신호·진입·청산 엔진을 그대로 쓰고, 신호일(D) 기준 정보만으로 필터를 건다(미래 데이터 없음).
시장 필터: KOSPI 120일선 대비 -3% 미만이면 하락, 5일 -5% 이하 또는 20일 고점 대비 -10% 이하면 급락.
종목 필터: 종가<60일선 이고 20일선<60일선이면 하락 추세. '하락추세선 첫돌파'(shortTermMaBreakout)는 종목 필터 예외.
비교: 필터 없음(F0) / 시장 필터(F1) / 시장+종목 필터(F2) / 하락·급락 구간만(F3, 대조군).
지표: 건수, 평균 순수익, 승률, 합계, 근사 MDD(겹침 무시).
"""
import argparse
import json
import os
import sqlite3
import sys
from concurrent.futures import ProcessPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import exit_study as ex  # noqa: E402

sb = ex.sb
VARS = ('fix5_10', 'trail_atr', 'time10')


def kfeat(kospi):
    c = [x['close'] for x in kospi]
    out = {}
    for k, row in enumerate(kospi):
        if k < 120:
            continue
        ma120 = sum(c[k - 119:k + 1]) / 120
        gap = c[k] / ma120 - 1
        r5 = c[k] / c[k - 5] - 1
        dd20 = c[k] / max(c[k - 19:k + 1]) - 1
        out[row['date']] = (gap < -0.03, r5 <= -0.05 or dd20 <= -0.10)
    return out


def sfeat(daily, i):
    cl = [d['close'] for d in daily[i - 59:i + 1]]
    ma60 = sum(cl) / 60
    ma20 = sum(cl[-20:]) / 20
    return cl[-1] < ma60 and ma20 < ma60


def for_stock(args):
    db, code, kpath = args
    import pattern_detect as pdx
    kf = kfeat(json.load(open(kpath, encoding='utf-8')))
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
            sigs.append(('BASELINE', i))
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
                sigs.append((name, i))
    out = []
    for name, i in sigs:
        date = daily[i]['date']
        f = kf.get(date)
        if f is None:
            continue
        sdown = sfeat(daily, i)
        for var in VARS:
            res = ex.simulate(daily, i, var, 'open')
            if res:
                out.append((name, var, date, round(res[0], 5), f[0], f[1], sdown))
    return out


def summ(rows):
    if not rows:
        return {'n': 0}
    r = [x[3] for x in rows]
    return {'n': len(r), 'avg': sum(r) / len(r), 'win': sum(1 for v in r if v > 0) / len(r), 'sum': sum(r),
            'mdd': ex.mdd([(0, 0, 0, x[2], x[3]) for x in rows])}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True)
    ap.add_argument('--kospi', required=True)
    ap.add_argument('--out', default='regime.json')
    ap.add_argument('--workers', type=int, default=4)
    a = ap.parse_args()
    conn = sqlite3.connect(a.db)
    codes = [r[0] for r in conn.execute('SELECT code FROM daily_prices GROUP BY code HAVING COUNT(*) >= 250 ORDER BY code')]
    conn.close()
    rows = []
    with ProcessPoolExecutor(max_workers=a.workers) as pool:
        for res in pool.map(for_stock, [(a.db, c, a.kospi) for c in codes], chunksize=2):
            rows.extend(res)
    dates = sorted({r[2] for r in rows})
    cut = dates[int(len(dates) * 0.55)]
    filt = {'F0': lambda r, sc: True,
            'F1': lambda r, sc: not r[4] and not r[5],
            'F2': lambda r, sc: not r[4] and not r[5] and (sc == 'shortTermMaBreakout' or not r[6]),
            'F3': lambda r, sc: r[4] or r[5]}
    table = {}
    for sc in ('BASELINE',) + ex.SCANNERS:
        for var in VARS:
            base = [r for r in rows if r[0] == sc and r[1] == var]
            for fk, fn in filt.items():
                sub = [r for r in base if fn(r, sc)]
                table['%s|%s|%s' % (sc, var, fk)] = {'all': summ(sub), 'dev': summ([r for r in sub if r[2] < cut]),
                                                     'val': summ([r for r in sub if r[2] >= cut])}
    json.dump({'cut': cut, 'table': table}, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('done', len(rows))


if __name__ == '__main__':
    main()
