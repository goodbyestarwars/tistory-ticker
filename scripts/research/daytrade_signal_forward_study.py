# -*- coding: utf-8 -*-
"""실시간 장중 신호(거래량 신호·갭 신호)를 입구로 한 단타 분봉 전진 검증 (연구 전용, 주문·자동매매 연결 없음 - 2026-11-26).

판정 기준은 결과를 보기 전에 `docs/SIGNAL_FORWARD_MINUTE_STUDY_2026-11-26.md`에 고정했다.
분봉 수집·통계는 기존 `daytrade_support_breakout_minute_study`(B)와 `daytrade_support_pullback_minute_study`(P)를 재사용한다.

서브명령
  export  <volume_surge_history.db> <gap_shadow.db> <signals.csv>      (읽기 전용 조회)
  fetch   <signals.csv> <분봉 cache 폴더>                               (KIS_APPKEY/KIS_APPSECRET 환경변수)
  analyze <signals.csv> <분봉 cache 폴더> <out.json>
"""
import csv
import datetime as dt
import json
import os
import sqlite3
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import daytrade_support_breakout_minute_study as B  # noqa: E402
import daytrade_support_pullback_minute_study as P  # noqa: E402

KST = dt.timezone(dt.timedelta(hours=9))
TP, TP3, SL_FIX, SUP_FLOOR = 0.025, 0.03, 0.04, 0.01
COST = B.COST
LAST_ENTRY = '151500'
MIN_EVENTS = 100
BASE_T = '090600'


def to_kst_hms(iso):
    t = dt.datetime.fromisoformat(iso)
    if t.tzinfo is None:
        t = t.replace(tzinfo=KST)
    return t.astimezone(KST).strftime('%H%M%S')


def cmd_export(vs_db, gap_db, out_csv):
    rows = []
    c = sqlite3.connect('file:%s?mode=ro' % vs_db, uri=True)
    for d, code, typ, at in c.execute('select trading_date, code, signal_type, detected_at from signal_history order by detected_at'):
        rows.append({'src': 'VS_' + typ, 'group': 'volume_surge', 'd': d.replace('-', ''), 'code': code, 't': to_kst_hms(at)})
    g = sqlite3.connect('file:%s?mode=ro' % gap_db, uri=True)
    for d, code, at in g.execute('select trading_date, code, signal_at from gap_shadow_signal where signal_at is not null order by signal_at'):
        rows.append({'src': 'GAP', 'group': 'gap_shadow', 'd': d.replace('-', ''), 'code': code, 't': to_kst_hms(at)})
    seen, out = set(), []
    for r in rows:                                    # 같은 날·종목·신호 종류의 첫 신호만
        k = (r['src'], r['d'], r['code'])
        if k in seen:
            continue
        seen.add(k)
        out.append(r)
    with open(out_csv, 'w', encoding='utf-8', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=['src', 'group', 'd', 'code', 't'])
        w.writeheader()
        w.writerows(out)
    print('signals', len(out), 'code-days', len({(r['d'], r['code']) for r in out}))


def load_signals(path):
    with open(path, encoding='utf-8') as fh:
        return list(csv.DictReader(fh))


def cmd_fetch(sig_csv, minute_dir):
    appkey, appsecret = os.environ.get('KIS_APPKEY', '').strip(), os.environ.get('KIS_APPSECRET', '').strip()
    if not appkey or not appsecret:
        raise SystemExit('KIS_APPKEY/KIS_APPSECRET 환경변수가 필요합니다.')
    call = B.make_kis_call(appkey, appsecret)
    os.makedirs(minute_dir, exist_ok=True)
    done = failed = skipped = shown = 0
    for code, d in sorted({(r['code'], r['d']) for r in load_signals(sig_csv)}):
        path = os.path.join(minute_dir, '%s_%s.json' % (code, d))
        if os.path.exists(path):
            skipped += 1
            continue
        try:
            bars = B.fetch_day(call, code, d)
        except Exception as exc:
            failed += 1
            print('fail', code, d, type(exc).__name__, str(exc)[:80].replace(appkey, '***'))
            continue
        json.dump({'code': code, 'date': d, 'bars': bars}, open(path, 'w', encoding='utf-8'))
        done += 1
        if (done + failed) // 100 > shown:
            shown = (done + failed) // 100
            print('progress', done, failed, flush=True)
    print('fetched', done, 'failed', failed, 'reused', skipped)


def entry_index(bars, hms):
    """신호가 속한 분의 다음 1분봉 인덱스(신호 시각 이후 첫 완성 분)."""
    for i, b in enumerate(bars):
        if b[0] > hms[:4] + '59':          # 신호 분(HHMM00~HHMM59) 다음 분봉부터
            return i
    return None


def simulate_exit(bars, i, mode):
    """bars[i] 시가 진입. 당일 청산. 같은 봉에서 손절·익절 모두 닿으면 손절 우선."""
    p = bars[i][1]
    pre_low = min(b[3] for b in bars[:i]) if i > 0 else p * (1 - SUP_FLOOR)
    if mode == 'X1':
        stop, tp = p * (1 - SL_FIX), p * (1 + TP)
    elif mode == 'X3':
        stop, tp = min(pre_low, p * (1 - SUP_FLOOR)), p * (1 + TP3)
    else:                                   # X2
        stop, tp = min(pre_low, p * (1 - SUP_FLOOR)), p * (1 + TP)
    for b in bars[i:]:
        if b[3] <= stop:
            return min(stop, b[1]) / p - 1
        if b[2] >= tp:
            return (tp / p) - 1
    return bars[-1][4] / p - 1


def shape_flag(bars, i):
    """아침 눌림 후 복귀: 진입 전 저가가 시가보다 0.5% 이상 낮았다가 진입가가 시가 이상."""
    if i < 2:
        return False
    o = bars[0][1]
    return min(b[3] for b in bars[:i]) <= o * 0.995 and bars[i][1] >= o


def analyze_one(bars, sig):
    if len(bars) < 120:
        return {'skip': 'short_day'}
    i = entry_index(bars, sig['t'])
    if i is None or bars[i][0] >= LAST_ENTRY:
        return {'skip': 'late_or_none'}
    j = next((k for k, b in enumerate(bars) if b[0] >= BASE_T), None)
    out = {'t0': bars[i][0], 'shape': shape_flag(bars, i), 'early': bars[i][0] < '093000'}
    for m in ('X1', 'X2', 'X3'):
        out[m] = simulate_exit(bars, i, m) - COST
        if j is not None:
            out['O_' + m] = simulate_exit(bars, j, m) - COST
    return out


def stat_rows(rows, key):
    vals = [r[key] for r in rows if key in r]
    if not vals:
        return {'n': 0}
    s = B.stat(vals)
    s['days'] = len({r['d'] for r in rows if key in r})
    s['clusterCi95'] = P.cluster_ci(vals, [r['d'] for r in rows if key in r])
    return s


def verdict(rows, key='X2'):
    s, base = stat_rows(rows, key), stat_rows(rows, 'O_' + key)
    if s['n'] < MIN_EVENTS:
        return '판정 불가'
    ok = (s['mean'] > 0 and s['clusterCi95'] and s['clusterCi95'][0] > 0 and s['meanNoTop5'] is not None
          and s['meanNoTop5'] > 0 and base['n'] > 0 and s['mean'] > base['mean'])
    return '신호 있음' if ok else '신호 없음'


def cmd_analyze(sig_csv, minute_dir, out_path):
    events, skips = [], {}
    sigs = load_signals(sig_csv)
    for s in sigs:
        bars = B._load_bars(minute_dir, s['code'], s['d'])
        r = analyze_one(bars, s) if bars else {'skip': 'no_minute'}
        if 'skip' in r:
            skips[r['skip']] = skips.get(r['skip'], 0) + 1
            continue
        r.update(src=s['src'], group=s['group'], d=s['d'], code=s['code'])
        events.append(r)
    out = {'signals': len(sigs), 'usable': len(events), 'skips': skips, 'cost': COST, 'primary': {}, 'slices': {}}
    for g in ('volume_surge', 'gap_shadow'):
        rows = [e for e in events if e['group'] == g]
        out['primary'][g] = {'n': len(rows), 'verdict': verdict(rows),
                             'exits': {k: stat_rows(rows, k) for k in ('X1', 'X2', 'X3')},
                             'baseline': {k: stat_rows(rows, 'O_' + k) for k in ('X1', 'X2', 'X3')}}
    for name, sel in (('shape_dip_recover', lambda e: e['shape']), ('entry_before_0930', lambda e: e['early']),
                      ('entry_after_0930', lambda e: not e['early'])):
        for g in ('volume_surge', 'gap_shadow'):
            rows = [e for e in events if e['group'] == g and sel(e)]
            out['slices']['%s/%s' % (g, name)] = {'n': len(rows), 'X2': stat_rows(rows, 'X2'), 'O_X2': stat_rows(rows, 'O_X2')}
    for src in sorted({e['src'] for e in events}):
        rows = [e for e in events if e['src'] == src]
        out['slices']['src/%s' % src] = {'n': len(rows), 'X2': stat_rows(rows, 'X2'), 'O_X2': stat_rows(rows, 'O_X2')}
    json.dump(out, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    a = sys.argv
    if len(a) >= 5 and a[1] == 'export':
        cmd_export(a[2], a[3], a[4])
    elif len(a) >= 4 and a[1] == 'fetch':
        cmd_fetch(a[2], a[3])
    elif len(a) >= 5 and a[1] == 'analyze':
        cmd_analyze(a[2], a[3], a[4])
    else:
        raise SystemExit(__doc__)
