# -*- coding: utf-8 -*-
"""매집봉 재검증(연구용, 읽기 전용, 실전 연결 없음 - 2026-10-18): 종가 수익률이 아니라 보유 중 최고가·최저가와 목표/손절 선후관계로 본다.

이전 연구(accumulation_context_study, accumulation_precursor_study)는 N일 뒤 종가 수익과 +10/+20% 도달·-10% 손실 비율까지 봤다.
여기서 새로 더하는 것: ① 목표가와 손절가 중 무엇에 먼저 닿는가(같은 날 둘 다면 손절 우선) ② 익절 +5/+10/+15% × 손절 -3/-5/-7% 조합의 실현 수익
③ 갭 하락 체결(손절가보다 시가가 낮으면 시가) 반영 ④ 대량 양봉형(A)과 긴 윗꼬리형(B) 비교, 국면별 ⑤ 매집봉 뒤 흐름 5유형과 재돌파 규칙.

시점: 신호는 t일 종가까지 확정된 값만 쓰고 t+1 시가에 진입한다. 보유 H일 = 진입일(0일)부터 H일째 종가에서 청산(이전 연구와 같은 계산).
익절은 목표가에서 체결(시가 갭 상승 이익은 보수적으로 안 줌), 손절은 min(시가, 손절가)로 체결. 같은 날 둘 다 닿으면 손절.
재돌파/눌림 규칙은 확인이 끝난 날(k) 종가에서만 신호가 되고 k+1 시가에 산다. 사후에 알 수 있는 흐름 5유형은 설명용이며 매수 규칙이 아니다.
기준선: 같은 날짜 × 250봉 가격 위치 5분위 × 15봉 변동 5분위의 유동성 충족 전 종목 평균(같은 지표를 같은 방식으로 계산).
학습 2021~2023, 검증 2024~2026-10. 비용 왕복 0.7%(민감도 1.2%).
실행: python accumulation_mfe_study.py <일봉 캐시 디렉터리> <out.json>
"""

import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import accumulation_precursor_study as pre  # noqa: E402

swv, roll, csum, window_mean, lag = pre.swv, pre.roll, pre.csum, pre.window_mean, pre.lag
HZ = (5, 10, 20, 40)
COMBO_H = (20, 40)
TPS = (0.05, 0.10, 0.15)
SLS = (0.03, 0.05, 0.07)
COOLDOWN = 10
HOT_RUNUP = 0.25
REGIMES = {0: 'OTHER', 1: 'SIDE', 2: 'LOW', 3: 'N224', 4: 'HOT'}


def thin(flag, cooldown=COOLDOWN):
    out = np.zeros(len(flag), dtype=bool)
    last = -10 ** 9
    for i in np.where(flag)[0]:
        if i - last >= cooldown:
            out[i] = True
            last = i
    return out


def wick_bars(o, h, l, c, v):
    """윗꼬리형(연구용 가설): 윗꼬리 >= 범위 40%, |몸통| <= 3%, 거래량 >= 직전 20봉 평균 2배, 거래대금 30억원."""
    n = len(c)
    cs_v = csum(v)
    prev_avg = np.full(n, np.nan)
    if n > 20:
        prev_avg[20:] = (cs_v[20:n] - cs_v[:n - 20]) / 20
    rng = h - l
    with np.errstate(invalid='ignore', divide='ignore'):
        upper = np.where(rng > 0, (h - np.maximum(o, c)) / np.where(rng > 0, rng, 1), 0)
        body = np.abs(c / o - 1) * 100
        return (v >= 2.0 * prev_avg) & (upper >= 0.4) & (body <= 3.0) & (c * v >= 3e9) & (rng > 0)


def first_touch(Hw, Lw, Ow, e, ret_h, tp, sl):
    """보유 창(진입일 0일부터 H일)에서 익절/손절 선후. 반환: code(0 미청산·1 익절·2 손절), 갭 체결 수익률, 이상적(체결가=손절가) 수익률.
    같은 날 둘 다 닿으면 손절 먼저. 익절은 목표가 체결."""
    hit_tp = Hw >= (e * (1 + tp))[:, None]
    hit_sl = Lw <= (e * (1 - sl))[:, None]
    big = 10 ** 6
    tpd = np.where(hit_tp.any(axis=1), hit_tp.argmax(axis=1), big)
    sld = np.where(hit_sl.any(axis=1), hit_sl.argmax(axis=1), big)
    code = np.where(sld <= tpd, np.where(sld < big, 2, 0), 1)
    code = np.where((tpd < big) & (sld > tpd), 1, code)
    stop_price = e * (1 - sl)
    open_at_sl = Ow[np.arange(len(e)), np.minimum(sld, Ow.shape[1] - 1)]
    gap = np.where(code == 2, np.minimum(open_at_sl, stop_price) / e - 1, np.where(code == 1, tp, ret_h))
    ideal = np.where(code == 2, -sl, np.where(code == 1, tp, ret_h))
    return code.astype(np.int8), gap, ideal


def regimes(c, ma224, pos250, runup, rng40):
    reg = np.zeros(len(c), dtype=np.int8)
    with np.errstate(invalid='ignore', divide='ignore'):
        side = rng40 <= 0.20
        low = pos250 < 0.3
        n224 = np.abs(c / ma224 - 1) <= 0.05
        hot = runup >= HOT_RUNUP
    reg[np.nan_to_num(side.astype(float)).astype(bool)] = 1
    reg[np.nan_to_num(low.astype(float)).astype(bool)] = 2
    reg[np.nan_to_num(n224.astype(float)).astype(bool)] = 3
    reg[np.nan_to_num(hot.astype(float)).astype(bool)] = 4
    return reg


def flow_signals(o, h, l, c, acc_idx):
    """정상(An) 매집봉 s 마다 뒤따르는 규칙 신호(확인이 끝난 날 k)와 사후 5유형 분류. 반환: (s2, s1, s3 불리언 배열[길이 n], cls dict s->유형)."""
    n = len(c)
    s1 = np.zeros(n, dtype=bool)
    s2 = np.zeros(n, dtype=bool)
    s3 = np.zeros(n, dtype=bool)
    cls = {}
    for s in acc_idx:
        hs, ls, cs_ = h[s], l[s], c[s]
        p60 = h[max(0, s - 60):s].max() if s >= 1 else np.nan
        # S2 즉시 재돌파: 10봉 안에 처음 종가가 매집봉 고점 위
        for k in range(s + 1, min(n - 1, s + 11)):
            if c[k] > hs:
                s2[k] = True
                break
        # S1 눌림 뒤 재돌파: 3% 이상 눌린 종가가 있었고(그동안 저가가 매집봉 저가 98% 이상 유지) 20봉 안에 종가가 매집봉 고점 위
        pulled = False
        for k in range(s + 1, min(n - 1, s + 21)):
            if l[k] < ls * 0.98:
                break
            if c[k] > hs and pulled:
                s1[k] = True
                break
            if c[k] <= cs_ * 0.97:
                pulled = True
        # S3 전고점(직전 60봉 고점) 접촉 뒤 안정: 10봉 안에 고가가 전고점의 98% 이상, 이후 3봉 종가가 접촉일 종가의 97% 이상이고 저가가 매집봉 저가 이상
        if np.isfinite(p60):
            for j in range(s + 1, min(n - 4, s + 11)):
                if h[j] >= 0.98 * p60:
                    if all(c[j + m] >= 0.97 * c[j] and l[j + m] >= ls for m in (1, 2, 3)):
                        s3[j + 3] = True
                    break
        # 사후 유형(미래 봉을 쓰는 설명용): 1 급등 2 눌림 후 재상승 3 곧바로 재돌파 4 전고점 접촉 후 안정 5 상승 없이 하락 0 기타
        if s + 20 <= n - 1:
            if h[s + 1:s + 4].max() >= cs_ * 1.10:
                cls[s] = 1
            else:
                seg_c = c[s + 1:s + 21]
                pulled_i = np.where(seg_c <= cs_ * 0.97)[0]
                over_i = np.where(seg_c > hs)[0]
                if len(pulled_i) and len(over_i) and over_i[-1] > pulled_i[0] and (over_i > pulled_i[0]).any():
                    cls[s] = 2
                elif len(over_i):
                    cls[s] = 3
                elif np.isfinite(p60) and h[s + 1:s + 11].max() >= 0.98 * p60 and c[s + 20] >= cs_ * 0.97:
                    cls[s] = 4
                elif c[s + 20] <= cs_ * 0.90 and h[s + 1:s + 21].max() < cs_ * 1.03:
                    cls[s] = 5
                else:
                    cls[s] = 0
    return s2, s1, s3, cls


def build(stocks, pos):
    keys = ['date', 'bucket', 'range15', 'reg', 'nh60', 'A', 'An', 'Ah', 'B', 'S0', 'S1', 'S2', 'S3', 'cls']
    num = ['ret%d' % h for h in HZ] + ['mfe%d' % h for h in HZ] + ['mae%d' % h for h in HZ]
    combo_names = ['%d_%d_%d' % (hh, int(tp * 100), int(sl * 100)) for hh in COMBO_H for tp in TPS for sl in SLS]
    cols = {k: [] for k in keys + num + ['code_' + x for x in combo_names] + ['gap_' + x for x in combo_names] + ['idl_' + x for x in combo_names]}
    for si, (code, ds, a) in enumerate(stocks):
        o, h, l, c, v = a[:, 0], a[:, 1], a[:, 2], a[:, 3], a[:, 4]
        n = len(c)
        didx = np.array([pos[d] for d in ds])
        cs = csum(c)
        ma224 = window_mean(cs, 224)
        low250, high250 = roll(l, 250, 'min'), roll(h, 250, 'max')
        with np.errstate(invalid='ignore', divide='ignore'):
            pos250 = (c - low250) / (high250 - low250)
            runup = c / lag(c, 20) - 1
            rng40 = (roll(h, 40, 'max') - roll(l, 40, 'min')) / roll(l, 40, 'min')
            range15 = (roll(h, 15, 'max') - roll(l, 15, 'min')) / c
            hi60 = lag(roll(h, 60, 'max'), 1)
            nh60 = c >= 0.95 * hi60
        bucket = np.clip(np.floor(pos250 * 5), 0, 4)
        amt20 = window_mean(csum(c * v), 20)
        acc_raw = pre.accumulation_bars(o, h, l, c, v)
        A = thin(acc_raw)
        B = thin(wick_bars(o, h, l, c, v) & ~acc_raw)
        hot = np.nan_to_num((runup >= HOT_RUNUP).astype(float)).astype(bool)
        An, Ah = A & ~hot, A & hot
        s2, s1, s3, clsd = flow_signals(o, h, l, c, np.where(An)[0])
        clsarr = np.full(n, -1, dtype=np.int8)
        for s, k in clsd.items():
            clsarr[s] = k
        t = np.arange(pre.START, n - 1)
        e = o[t + 1]
        ok = (amt20[t] >= pre.MIN_AMOUNT) & np.isfinite(bucket[t]) & (e > 0) & np.isfinite(range15[t])
        t, e = t[ok], e[ok]
        if len(t) == 0:
            continue
        m = len(t)
        for hz in HZ:
            r = np.full(m, np.nan)
            mfe = np.full(m, np.nan)
            mae = np.full(m, np.nan)
            okh = t + 1 + hz <= n - 1
            idx = t[okh] + 1
            r[okh] = c[idx + hz] / e[okh] - 1
            mfe[okh] = swv(h, hz + 1)[idx].max(axis=1) / e[okh] - 1
            mae[okh] = swv(l, hz + 1)[idx].min(axis=1) / e[okh] - 1
            cols['ret%d' % hz].append(r)
            cols['mfe%d' % hz].append(mfe)
            cols['mae%d' % hz].append(mae)
            if hz in COMBO_H:
                Hw, Lw, Ow = swv(h, hz + 1)[idx], swv(l, hz + 1)[idx], swv(o, hz + 1)[idx]
                for tp in TPS:
                    for sl in SLS:
                        nm = '%d_%d_%d' % (hz, int(tp * 100), int(sl * 100))
                        code_c = np.full(m, -1, dtype=np.int8)
                        gap_c = np.full(m, np.nan, dtype=np.float32)
                        idl_c = np.full(m, np.nan, dtype=np.float32)
                        cd, gp, idl = first_touch(Hw, Lw, Ow, e[okh], r[okh], tp, sl)
                        code_c[okh], gap_c[okh], idl_c[okh] = cd, gp, idl
                        cols['code_' + nm].append(code_c)
                        cols['gap_' + nm].append(gap_c)
                        cols['idl_' + nm].append(idl_c)
        cols['date'].append(didx[t])
        cols['bucket'].append(bucket[t].astype(np.int8))
        cols['range15'].append(range15[t])
        cols['reg'].append(regimes(c, ma224, pos250, runup, rng40)[t])
        cols['nh60'].append(np.nan_to_num(nh60.astype(float)).astype(bool)[t])
        cols['A'].append(A[t])
        cols['An'].append(An[t])
        cols['Ah'].append(Ah[t])
        cols['B'].append(B[t])
        cols['S0'].append(An[t])
        cols['S1'].append(s1[t])
        cols['S2'].append(s2[t])
        cols['S3'].append(s3[t])
        cols['cls'].append(clsarr[t])
    return {k: np.concatenate(v) for k, v in cols.items()}, combo_names


def stat(ev, sel, ex, dates, split_sel, combo_names, with_combos=True):
    out = {}
    for part, rows in (('all', sel), ('train', sel & split_sel[0]), ('valid', sel & split_sel[1])):
        d = {'n': int(rows.sum())}
        if d['n'] < 30:
            out[part] = d
            continue
        for hz in HZ:
            r = ev['ret%d' % hz][rows]
            r = r[np.isfinite(r)]
            if len(r) < 30:
                continue
            t_stat, mean_ex = pre.month_t(ex['ret%d' % hz], ev, dates, rows)
            mfe = ev['mfe%d' % hz][rows]
            mfe = mfe[np.isfinite(mfe)]
            mae = ev['mae%d' % hz][rows]
            mae = mae[np.isfinite(mae)]
            d['h%d' % hz] = {
                'n': int(len(r)), 'mean': round(float(r.mean() * 100), 2), 'median': round(float(np.median(r) * 100), 2),
                'win': round(float((r > 0).mean() * 100), 1), 'excess': round(mean_ex * 100, 2),
                't': round(t_stat, 2) if np.isfinite(t_stat) else None,
                'mfeMed': round(float(np.median(mfe) * 100), 2), 'maeMed': round(float(np.median(mae) * 100), 2),
                'reach5': round(float((mfe >= 0.05).mean() * 100), 1), 'reach10': round(float((mfe >= 0.10).mean() * 100), 1),
                'reach20': round(float((mfe >= 0.20).mean() * 100), 1),
                'stop5': round(float((mae <= -0.05).mean() * 100), 1), 'stop10': round(float((mae <= -0.10).mean() * 100), 1)}
        if with_combos:
            combos = {}
            for nm in combo_names:
                code = ev['code_' + nm][rows]
                ok = code >= 0
                if ok.sum() < 30:
                    continue
                gap = ev['gap_' + nm][rows]
                idl = ev['idl_' + nm][rows]
                t_stat, mean_ex = pre.month_t(ex['gap_' + nm], ev, dates, rows)
                combos[nm] = {'pTP': round(float((code[ok] == 1).mean() * 100), 1), 'pSL': round(float((code[ok] == 2).mean() * 100), 1),
                              'pNone': round(float((code[ok] == 0).mean() * 100), 1),
                              'ideal': round(float(np.nanmean(idl[ok]) * 100), 2), 'gap': round(float(np.nanmean(gap[ok]) * 100), 2),
                              'netGap': round(float(np.nanmean(gap[ok]) * 100 - pre.COST), 2), 'netGap12': round(float(np.nanmean(gap[ok]) * 100 - 1.2), 2),
                              'excessGap': round(mean_ex * 100, 2), 't': round(t_stat, 2) if np.isfinite(t_stat) else None}
            d['combos'] = combos
        out[part] = d
    return out


def run(cache_dir, out_path):
    stocks = pre.load(cache_dir)
    dates = sorted({d for _, ds, _ in stocks for d in ds})
    pos = {d: i for i, d in enumerate(dates)}
    ev, combo_names = build(stocks, pos)
    nd = len(dates)
    date_arr = np.array(dates)
    train = date_arr[ev['date']] < pre.SPLIT
    split_sel = (train, ~train)
    ex = {}
    for name in ['ret%d' % hz for hz in HZ] + ['gap_' + nm for nm in combo_names]:
        valid = np.isfinite(ev[name])
        ex[name], _ = pre.baseline_excess(ev, nd, name, valid, vol_matched=True)
    n = len(ev['date'])
    res = {'events': int(n), 'stocks': len(stocks), 'range': [dates[0], dates[-1]], 'combos': combo_names, 'cells': {}}
    res['baseline'] = stat(ev, np.ones(n, dtype=bool), ex, dates, split_sel, combo_names)
    cells = {}
    for typ in ('A', 'An', 'B'):
        base = ev[typ]
        cells[typ + '|ALL'] = base
        for rid, rname in REGIMES.items():
            cells['%s|%s' % (typ, rname)] = base & (ev['reg'] == rid)
        cells[typ + '|NH60'] = base & ev['nh60']
        cells[typ + '|FAR60'] = base & ~ev['nh60']
    cells['Ah|ALL'] = ev['Ah']
    for nm in ('S0', 'S1', 'S2', 'S3'):
        cells[nm + '|ALL'] = ev[nm]
    for name, sel in cells.items():
        res['cells'][name] = stat(ev, sel, ex, dates, split_sel, combo_names)
    # 사후 5유형(설명용, 미래 봉 사용): 정상 매집봉 신호일 기준 20일 성과와 유형별 비율
    cls_names = {1: '급등', 2: '눌림후재상승', 3: '곧바로재돌파', 4: '전고점접촉후안정', 5: '상승없이하락', 0: '기타'}
    res['flowClasses'] = {}
    base_sel = ev['An'] & (ev['cls'] >= 0)
    total = int(base_sel.sum())
    for k, name in cls_names.items():
        sel = base_sel & (ev['cls'] == k)
        res['flowClasses'][name] = {'n': int(sel.sum()), 'share': round(float(sel.sum() / max(total, 1) * 100), 1),
                                    'stats': stat(ev, sel, ex, dates, split_sel, combo_names, with_combos=False)['all']}
    # 학습에서 고르고 검증에서 평가: 학습 초과수익 t>=2·학습 100건 이상인 (칸, 조합)
    picks = []
    for name, st in res['cells'].items():
        tr, va = st.get('train', {}), st.get('valid', {})
        for nm, cb in (tr.get('combos') or {}).items():
            if tr['n'] >= 100 and cb['t'] is not None and cb['t'] >= 2.0 and cb['excessGap'] > 0:
                vb = (va.get('combos') or {}).get(nm)
                picks.append({'cell': name, 'combo': nm, 'trainN': tr['n'], 'train': cb, 'validN': va.get('n'), 'valid': vb})
    res['picks'] = picks
    json.dump(res, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('done events=%d cells=%d picks=%d' % (n, len(res['cells']), len(picks)))


if __name__ == '__main__':
    run(*sys.argv[1:3])
