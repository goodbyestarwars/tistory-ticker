# -*- coding: utf-8 -*-
"""지지선 근처 진입(돌파 전) 분봉 백테스트 (연구 전용, 주문·자동매매 연결 없음 - 2026-11-26).

판정 기준은 결과를 보기 전에 `docs/SUPPORT_PULLBACK_MINUTE_STUDY_2026-11-26.md`에 고정했다.
후보일은 돌파 여부와 무관하게 SUP·HOLD·SURGE·VOLX·LIQ 를 모두 통과한 날(장 시작 전 정보)이다.
분봉 가져오기·통계는 `daytrade_support_breakout_minute_study.py` 의 것을 그대로 재사용한다.

서브명령
  cand    <일봉 cache 폴더> <후보.csv>
  fetch   <후보.csv> <분봉 cache 폴더>        (KIS_APPKEY/KIS_APPSECRET 환경변수)
  analyze <후보.csv> <분봉 cache 폴더> <out.json>
"""
import csv
import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import daytrade_support_breakout_minute_study as B  # noqa: E402

COST = B.COST
MIN_AMT = 2e9
SINCE = '20251127'
BAND = 1.01          # E1 지정가 = S × 1.01
DEEP = 0.97          # 구조 손절·깊은 이탈 기준 = S × 0.97
TP_Y2 = 0.05
LOW_TOL = 0.01
MIN_EVENTS = 100


# ---------------------------------------------------------------- 후보일

def candidates(code, px, since=''):
    """일봉 목록 px=[[date,o,h,l,c,v]...] → 후보일 리스트. 판정식은 일봉 연구 per_code 와 같다(t-1 까지의 값)."""
    n = len(px)
    if n < 260:
        return []
    d = [str(r[0]) for r in px]
    o, h, l, c, v = (np.array([r[i] for r in px], float) for i in range(1, 6))
    cs, vs = pd.Series(c), pd.Series(v)
    ma112 = cs.rolling(112).mean().values
    ma224 = cs.rolling(224).mean().values
    amt20 = (cs * vs).rolling(20).mean().values
    ret = np.r_[np.nan, c[1:] / c[:-1] - 1]
    surge60 = pd.Series(ret).rolling(59).max().values
    low10 = pd.Series(l).rolling(10).min().values
    low5 = pd.Series(l).rolling(5).min().values
    low20 = pd.Series(l).rolling(20).min().values
    vmean5 = vs.rolling(5).mean().values
    out = []
    for t in range(240, n):
        if d[t] < since:
            continue
        if not (amt20[t - 1] >= MIN_AMT):
            continue
        lo10 = low10[t - 1]
        sup = False
        for m in (ma112[t - 1], ma224[t - 1]):
            if m == m and m > 0 and -0.05 <= lo10 / m - 1 <= 0.06:
                sup = True
        hold = low5[t - 1] >= low20[t - 6]
        surge = surge60[t - 2] >= 0.15
        volx = v[t - 1] >= 2 * vmean5[t - 2] if vmean5[t - 2] > 0 else False
        if sup and hold and surge and volx:
            out.append({'code': code, 'd': d[t], 'S': float(lo10), 'prev_close': float(c[t - 1]),
                        'prev_high': float(h[t - 1]), 'day_high': float(h[t]), 'day_low': float(l[t]),
                        'day_open': float(o[t])})
    return out


def cmd_cand(daily_dir, out_csv):
    rows = []
    for f in sorted(os.listdir(daily_dir)):
        if not f.endswith('.json'):
            continue
        try:
            px = json.load(open(os.path.join(daily_dir, f), encoding='utf-8'))['px']
        except Exception:
            continue
        rows.extend(candidates(f[:-5], px, SINCE))
    cols = ['code', 'd', 'S', 'prev_close', 'prev_high', 'day_high', 'day_low', 'day_open']
    with open(out_csv, 'w', encoding='utf-8', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    print('candidates', len(rows), 'days', len({r['d'] for r in rows}))


def load_candidates(path):
    with open(path, encoding='utf-8', newline='') as fh:
        rows = list(csv.DictReader(fh))
    for r in rows:
        for k in ('S', 'prev_close', 'prev_high', 'day_high', 'day_low', 'day_open'):
            r[k] = float(r[k])
    return rows


# ---------------------------------------------------------------- 시뮬레이션

def _walk_levels(bars, start, entry, tp_level, sl_level):
    """start 번째 봉부터 손절선(저가)·익절선(고가)을 판정한다. 같은 봉에서 둘 다 닿으면 손절 우선."""
    for b in bars[start:]:
        if b[3] <= sl_level:
            return sl_level / entry - 1
        if b[2] >= tp_level:
            return tp_level / entry - 1
    return bars[-1][4] / entry - 1


def _result(d0, entry, start, entry_t, S):
    seg = d0[start:] if start < len(d0) else d0[-1:]
    stop = S * DEEP
    return {
        'Y1_close': d0[-1][4] / entry - 1 - COST,
        'Y2_struct': _walk_levels(d0, start, entry, entry * (1 + TP_Y2), stop) - COST,
        'Y3_tp3_sl3': _walk_levels(d0, start, entry, entry * 1.03, entry * 0.97) - COST,
        'MFE': max(b[2] for b in seg) / entry - 1,
        'MAE': min(b[3] for b in seg) / entry - 1,
        'entry': entry, 'entry_t': entry_t,
    }


def simulate(d0, cand, reclaim_minutes=None):
    """한 후보일의 진입 E1·E2·O 결과 또는 제외 사유."""
    if len(d0) < B.MIN_BARS_OK:
        return {'skip': 'short_day'}
    if abs(max(b[2] for b in d0) / cand['day_high'] - 1) > LOW_TOL or \
            abs(min(b[3] for b in d0) / cand['day_low'] - 1) > LOW_TOL:
        return {'skip': 'mismatch'}
    S = cand['S']
    stop = S * DEEP
    out = {}
    open0 = d0[0][1]
    # E1: 시가 >= S 일 때 S×1.01 지정가
    if open0 >= S:
        level = S * BAND
        if open0 <= level:
            if d0[0][0] <= B.LAST_ENTRY_T:
                out['E1'] = _result(d0, open0, 0, d0[0][0], S)
        else:
            i = next((k for k, b in enumerate(d0) if b[3] <= level), None)
            if i is not None and d0[i][0] <= B.LAST_ENTRY_T:
                out['E1'] = _result(d0, min(level, d0[i][1]), i + 1, d0[i][0], S)   # 진입 봉 내부 경로는 모름
    # E2: S 아래로 내려간 뒤 종가가 S 이상인 첫 5분봉 완성 → 다음 1분봉 시가
    k = next((j for j, b in enumerate(d0) if b[3] < S), None)
    if k is not None:
        for g in B.five_min(d0):
            if g[6] < k or g[4] < S:
                continue
            if reclaim_minutes is not None and g[6] - k > reclaim_minutes:
                break                                   # v2: 이탈 뒤 지정 분 안에 복귀해야 한다
            nxt = g[6] + 1
            if nxt >= len(d0) or d0[nxt][0] > B.LAST_ENTRY_T:
                break
            low_so_far = min(b[3] for b in d0[:nxt])
            if low_so_far >= stop and d0[nxt][1] > stop:
                out['E2'] = _result(d0, d0[nxt][1], nxt, d0[nxt][0], S)
            break
    # O: 후보일 시가 진입(기준선)
    if open0 > stop:
        out['O'] = _result(d0, open0, 0, d0[0][0], S)
    if not out:
        return {'skip': 'no_entry'}
    return out


# ---------------------------------------------------------------- 통계

def cluster_ci(values, days, n=2000, seed=7):
    """날짜 단위 군집 부트스트랩 95% 구간(%) — 같은 날 후보는 시장 움직임으로 함께 움직인다."""
    if not values:
        return None
    by = {}
    for v, d in zip(values, days):
        by.setdefault(d, []).append(v)
    keys = list(by)
    if len(keys) < 5:
        return None
    rng = np.random.default_rng(seed)
    sums = np.array([sum(by[k]) for k in keys])
    cnts = np.array([len(by[k]) for k in keys])
    means = []
    for _ in range(n):
        pick = rng.integers(0, len(keys), len(keys))
        means.append(sums[pick].sum() / cnts[pick].sum())
    return [round(float(np.percentile(means, 2.5)) * 100, 2), round(float(np.percentile(means, 97.5)) * 100, 2)]


def stat(rows, key):
    vals = [r[key] for r in rows]
    s = B.stat(vals)
    s['days'] = len({r['d'] for r in rows})
    s['clusterCi95'] = cluster_ci(vals, [r['d'] for r in rows])
    return s


EXITS = ['Y1_close', 'Y2_struct', 'Y3_tp3_sl3']
PRIMARY = [('E1', 'Y1_close'), ('E1', 'Y2_struct'), ('E2', 'Y1_close'), ('E2', 'Y2_struct')]


def verdict(summary, primary=PRIMARY):
    """사전 기준: 주 결과 4개 각각 판정. 체결 100건 미만이면 판정 불가."""
    out = {}
    for entry, ex in primary:
        s = summary[entry]['exits'][ex]
        base = summary['O']['exits'][ex]
        if s['n'] < MIN_EVENTS:
            out['%s×%s' % (entry, ex)] = '판정 불가'
            continue
        ok = (s['mean'] > 0 and s['clusterCi95'] and s['clusterCi95'][0] > 0
              and s['meanNoTop5'] is not None and s['meanNoTop5'] > 0
              and base['n'] > 0 and s['mean'] > base['mean'])
        out['%s×%s' % (entry, ex)] = '신호 있음' if ok else '신호 없음'
    return out


def summarize(events, primary=PRIMARY):
    out = {}
    for entry in ('E1', 'E2', 'O'):
        rows = [dict(e[entry], d=e['d']) for e in events if entry in e]
        out[entry] = {'events': len(rows), 'exits': {k: stat(rows, k) for k in EXITS},
                      'MFEmean': round(float(np.mean([r['MFE'] for r in rows])) * 100, 2) if rows else None,
                      'MAEmean': round(float(np.mean([r['MAE'] for r in rows])) * 100, 2) if rows else None}
    out['verdict'] = verdict(out, primary)
    return out


# ---------------------------------------------------------------- 실행

def cmd_fetch(cand_csv, minute_dir):
    appkey, appsecret = os.environ.get('KIS_APPKEY', '').strip(), os.environ.get('KIS_APPSECRET', '').strip()
    if not appkey or not appsecret:
        raise SystemExit('KIS_APPKEY/KIS_APPSECRET 환경변수가 필요합니다.')
    call = B.make_kis_call(appkey, appsecret)
    os.makedirs(minute_dir, exist_ok=True)
    done = failed = skipped = shown = 0
    for r in load_candidates(cand_csv):
        path = os.path.join(minute_dir, '%s_%s.json' % (r['code'], r['d']))
        if os.path.exists(path):
            skipped += 1
            continue
        try:
            bars = B.fetch_day(call, r['code'], r['d'])
        except Exception as exc:
            failed += 1
            print('fail', r['code'], r['d'], type(exc).__name__, str(exc)[:80].replace(appkey, '***'))
            continue
        json.dump({'code': r['code'], 'date': r['d'], 'bars': bars}, open(path, 'w', encoding='utf-8'))
        done += 1
        if (done + failed) // 100 > shown:
            shown = (done + failed) // 100
            print('progress', done, failed, flush=True)
    print('fetched', done, 'failed', failed, 'reused', skipped)


def cmd_analyze(cand_csv, minute_dir, out_path):
    events, skips = [], {}
    cands = load_candidates(cand_csv)
    for c in cands:
        bars = B._load_bars(minute_dir, c['code'], c['d'])
        r = simulate(bars, c) if bars else {'skip': 'no_minute'}
        if 'skip' in r:
            skips[r['skip']] = skips.get(r['skip'], 0) + 1
            continue
        r['code'], r['d'] = c['code'], c['d']
        events.append(r)
    out = {'candidates': len(cands), 'usable': len(events), 'skips': skips, 'cost': COST,
           'result': summarize(events)}
    json.dump(out, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    a = sys.argv
    if len(a) >= 4 and a[1] == 'cand':
        cmd_cand(a[2], a[3])
    elif len(a) >= 4 and a[1] == 'fetch':
        cmd_fetch(a[2], a[3])
    elif len(a) >= 5 and a[1] == 'analyze':
        cmd_analyze(a[2], a[3], a[4])
    else:
        raise SystemExit(__doc__)
