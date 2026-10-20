# -*- coding: utf-8 -*-
"""최종 의사결정 보고서(읽기 전용, 2026-10-22): 검색기 고수익 종목 선별 + 같은 종목에서 % 청산 vs 지지·저항 청산.

기존 연구 산출물(out_universe/trades_abc.csv 의 진입 목록, minbars, naver, out/summary.json)을 재사용한다. 키움 재수집·운영 폴더 접근 없음.
산출: <작업 폴더>/out_decision/SCANNER_EXIT_DECISION.md (보고서 하나) + decision.json(수치 원본).
설계 원칙: (1) 선별 변수는 진입 시점(scan_date 종가·09:01 시가)까지 알 수 있는 것만. (2) 후보 점수는 사전 고정 6개(기존 엔진 순위 + 5개)이고 학습 구간의
상위 5 평균 최대상승률로 1개를 고정해 검증 구간에 그대로 적용한다. 검증에서 좋아 보이는 것을 고르지 않는다. (3) 청산 비교는 선별된 같은 진입에서만, 비용은 가정이다.
(4) 실제 원장 재현이 기준(사유·시각 70%)에 못 미치면 청산 우열 판정은 보류한다.
"""
import json
import os
import statistics
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import exit_sr_diagnose as dg  # noqa: E402
import exit_sr_study as sr  # noqa: E402
import exit_sr_universe as uni  # noqa: E402
import exit_strategy_study as xs  # noqa: E402

CORE = uni.CORE
THRESH = (3.0, 5.0, 10.0)
CAND = ('V_volume_surge', 'T_trend', 'L_liquidity', 'Q_volatility', 'COMP_equal_weight')
MIN_SCANNER_TOP3 = 30
NEED_VALID_TOP3 = 100
NEED_VALID_MONTH_DAYS = 63
REALISM_OK = 0.7
# 비용은 가정이다(실제 수수료·세금 미확인): 주 표는 허용치 0.7%에 슬리피지를 별도로 더하지 않는다(중복 방지). 슬리피지 포함 모델 값은 부록.
COST_MAIN = (0.0, 0.0, 0.7)
COST_MODEL = (xs.SLIP_BUY_PCT, xs.SLIP_SELL_PCT, xs.COST_PCT)


# ---------- 진입 시점에 알 수 있는 변수 ----------
def features(entry, daily):
    """scan_date(진입 전 거래일) 종가까지의 일봉과 진입 분봉 시가만 쓴다. 이후 자료는 읽지 않는다."""
    rows = [r for r in daily if r['date'] <= entry['scan_date']]
    if len(rows) < 21:
        return None
    last, prior20 = rows[-1], rows[-21:-1]
    w20 = rows[-20:]
    vol_avg = sum(r['volume'] for r in prior20) / 20
    val20 = sum(r['close'] * r['volume'] for r in w20) / 20
    ma20 = sum(r['close'] for r in w20) / 20
    if not (vol_avg > 0 and val20 > 0 and ma20 > 0 and last['close'] > 0):
        return None
    first = next(p for p in entry['path'] if p[0] == entry['entry_day'] and p[1] == xs.EVAL_FIRST)
    return {'V_volume_surge': last['volume'] / vol_avg, 'T_trend': last['close'] / ma20 - 1, 'L_liquidity': val20,
            'Q_volatility': sum((r['high'] - r['low']) / r['close'] for r in w20) / 20, 'gap_open': first[2] / last['close'] - 1}


def day_percentiles(idx_by_day, feats, key):
    out = {}
    for day, idx in idx_by_day.items():
        vals = sorted((feats[i][key], i) for i in idx if feats[i])
        n = len(vals)
        for r, (_, i) in enumerate(vals):
            out[i] = r / (n - 1) if n > 1 else 0.5
    return out


def build_scores(entries, feats):
    """후보 점수: 기존 엔진 순위(E) + 사전 고정 5개. 같은 날 전체 진입 안에서의 순위 백분위로 합성(가중치 학습 없음)."""
    by_day = defaultdict(list)
    for i, e in enumerate(entries):
        by_day[e['entry_day']].append(i)
    pct = {k: day_percentiles(by_day, feats, k) for k in ('V_volume_surge', 'T_trend', 'L_liquidity')}
    scores = {'E_engine_rank': {i: (tuple(e['rank_score']) if e.get('rank_score') else None) for i, e in enumerate(entries)}}
    for k in CAND[:4]:
        scores[k] = {i: (feats[i][k] if feats[i] else None) for i in range(len(entries))}
    scores['COMP_equal_weight'] = {i: ((pct['V_volume_surge'][i] + pct['T_trend'][i] + pct['L_liquidity'][i]) / 3 if feats[i] else None) for i in range(len(entries))}
    return scores


def top_n(entries, idx, score, n):
    """하루 단위로 점수 높은 순 n개(점수 없는 진입은 제외, 동점은 종목코드 순)."""
    by_day = defaultdict(list)
    for i in idx:
        if score.get(i) is not None:
            by_day[entries[i]['entry_day']].append(i)
    out = []
    for day in sorted(by_day):
        out += sorted(by_day[day], key=lambda i: (tuple(-x for x in score[i]) if isinstance(score[i], tuple) else -score[i], entries[i]['code']))[:n]
    return out


# ---------- 결과 지표 ----------
def path_extremes(entry):
    """진입 후 보유 구간(최대 hold일) 전체의 고가·저가 대비 수익률. 청산 여부와 무관한 '고점을 찍었는가' 지표다."""
    path = entry['path']
    idx = next(i for i, p in enumerate(path) if p[0] == entry['entry_day'] and p[1] == xs.EVAL_FIRST)
    fill = path[idx][2] * (1 + xs.SLIP_BUY_PCT / 100)
    after = path[idx + 1:] or path[idx:]
    return (max(p[3] for p in after) / fill - 1) * 100, (min(p[4] for p in after) / fill - 1) * 100


def retag(trades, entries, cost):
    """같은 청산 시점에 다른 비용 가정을 적용한 거래 사본(청산 시점은 고정한 근사)."""
    out = []
    for t, e in zip(trades, entries):
        raw = dg.raw_returns(e, t)
        net = dg.scenario_net(raw, *cost)
        out.append(dict(t, net_pct=net, gross_pct=net + cost[2]))
    return out


def selection_stats(idx, ext, a_net):
    if not idx:
        return {'n': 0}
    mfe = [ext[i][0] for i in idx]
    mae = [ext[i][1] for i in idx]
    d = {'n': len(idx), 'days': None, 'mean_mfe': sum(mfe) / len(mfe), 'mean_mae': sum(mae) / len(mae), 'worst_mae': min(mae), 'a_cycle_mean_net': sum(a_net[i] for i in idx) / len(idx)}
    for t in THRESH:
        d['reach_%d' % t] = sum(1 for x in mfe if x >= t) / len(idx) * 100
        d['realized_net_ge_%d' % t] = sum(1 for i in idx if a_net[i] >= t) / len(idx) * 100
    return d


def hit_gain_ci(entries, base_idx, new_idx, ext, thr=5.0):
    """같은 날짜 안에서 (개선 선별 적중률 - 기존 선별 적중률)의 평균과 진입일 단위 95% 구간."""
    def day_rate(idx):
        by = defaultdict(list)
        for i in idx:
            by[entries[i]['entry_day']].append(1.0 if ext[i][0] >= thr else 0.0)
        return {d: sum(v) / len(v) for d, v in by.items()}
    b, n = day_rate(base_idx), day_rate(new_idx)
    days = sorted(set(b) & set(n))
    if len(days) < 3:
        return None
    return dg.day_bootstrap_ci([n[d] - b[d] for d in days], days)


# ---------- 시뮬레이터 현실성 ----------
class RuleALag(xs.RuleA):
    """직전 완료 봉 종가로 판정(엔진의 '직전 1분봉 종가' 해석 변형). 진단용이며 전략 후보가 아니다."""
    name = 'A_lag1'

    def __init__(self, entry_price, ctx, dup=False):
        super().__init__(entry_price, ctx)
        self._prev, self._dup = None, dup

    def step(self, price, bar, day_state):
        p, self._prev = self._prev, price
        if p is None:
            return None
        r = super().step(p, bar, day_state)
        return r or (super().step(p, bar, day_state) if self._dup else None)


def realism_variants(work, cache):
    """실제 원장 매도(사유·시각)를 여러 타이밍 해석으로 재현했을 때의 일치율. 어느 해석도 못 맞추면 '재현 불가'로 보고한다."""
    import exit_sr_local as loc
    import exit_sr_study as srs
    try:
        entries, cov = loc.build_real_entries(work, cache)
    except Exception as exc:
        return {'status': '실제 원장 진입 복원 실패: %s' % type(exc).__name__}
    entries = [e for e in entries if (e.get('actual') or {}).get('sell_ts')]
    if not entries:
        return {'status': '실제 매도가 있는 원장 거래 없음 또는 분봉 없음'}
    variants = {'A(서로 다른 봉 2개)': lambda p, c: xs.RuleA(p, c), 'A_cycle(같은 봉 중복 확인)': lambda p, c: srs.RuleACycle(p, c),
                'A_lag1(직전 봉 종가)': lambda p, c: RuleALag(p, c), 'A_lag1_cycle': lambda p, c: RuleALag(p, c, dup=True)}
    out = {'compared': len(entries), 'variants': {}, 'rows': []}
    for name, f in variants.items():
        match = close = 0
        for e in entries:
            ctx = {'atr_pct': e['atr_pct'], 'daily_lows': e['daily_lows'], 'daily_highs': e['daily_highs']}
            t = xs.simulate(e, f, ctx)
            a = e['actual']
            same_reason = a.get('sell_reason') == t['reason']
            sday, shhmm = a['sell_ts'][:10], a['sell_ts'][11:13] + a['sell_ts'][14:16]
            diff = None
            if t['exit_day'] == sday:
                diff = (int(t['exit_hhmm'][:2]) * 60 + int(t['exit_hhmm'][2:])) - (int(shhmm[:2]) * 60 + int(shhmm[2:]))
            match += same_reason
            close += (diff is not None and abs(diff) <= 3)
            if name.startswith('A_cycle'):
                out['rows'].append({'code': e['code'], 'actual_reason': a.get('sell_reason'), 'sim_reason': t['reason'], 'minutes_diff': diff,
                                    'actual_decision_price': a.get('sell_decision_price'), 'sim_trigger_price': t.get('trigger_price'), 'fill_confirmed': e.get('fill_confirmed')})
        out['variants'][name] = {'reason_match': match, 'within_3min': close}
    best = max(out['variants'].values(), key=lambda v: v['reason_match'] + v['within_3min'])
    n = len(entries)
    out['best_agreement'] = {'reason_match_rate': best['reason_match'] / n, 'within_3min_rate': best['within_3min'] / n}
    out['reproduces_engine'] = best['reason_match'] / n >= REALISM_OK and best['within_3min'] / n >= REALISM_OK
    out['coverage'] = {k: cov.get(k) for k in ('trades', 'usable')}
    return out


# ---------- 본 분석 ----------
def pick_reps(summary, entries, res, cut):
    reps = (summary or {}).get('representatives') or {}
    if reps.get('B_SR') in res and reps.get('C_SR') in res:
        return reps['B_SR'], reps['C_SR']
    names = [n for n in res if n.startswith('B_SR')], [n for n in res if n.startswith('C_SR')]
    tr = [i for i, e in enumerate(entries) if e['entry_day'] <= cut]
    pick = lambda ns: max(ns, key=lambda n: sum(res[n][i]['net_pct'] for i in tr) / max(1, len(tr))) if ns else None
    return pick(names[0]), pick(names[1])


def exit_table(entries, res, idx, names, cost):
    if not idx:
        return {}
    out = {}
    for label, n in names.items():
        tr = retag(res[n], entries, cost)
        sel = [tr[i] for i in idx]
        out[label] = xs.summarize(sel)
        out[label]['rule'] = n
    base = retag(res[names['A']], entries, cost)
    for label, n in names.items():
        if label != 'A' and len(idx) >= 5:
            tr = retag(res[n], entries, cost)
            out[label]['vs_A'] = xs.paired_bootstrap([base[i] for i in idx], [tr[i] for i in idx])
    return out


def analyze(work, hold_days=4):
    entries, ex, cache, pairs = dg.load_entries(work, hold_days)
    if not entries:
        return None, 'NO_ENTRIES'
    sp = os.path.join(work, 'out_universe', 'summary.json')
    summary = json.load(open(sp, encoding='utf-8')) if os.path.exists(sp) else {}
    summary = dict(summary or {})
    reps0 = summary.get('representatives') or {}
    rep_note = 'out_universe 의 학습 구간 선택 대표 설정'
    if not (reps0.get('B_SR') and reps0.get('C_SR')):
        # 학습 표본이 모자라 대표 설정이 없으면 사전 정의된 combo 설정을 쓴다(선택 아님).
        summary['representatives'] = {'B_SR': 'B_SR_combo_c5x2', 'C_SR': 'C_SR_combo_c5x2_atr'}
        rep_note = '대표 설정 선택 불가 -> 사전 정의 combo 설정(선택 아님)'
    res, _ = dg.simulate_all(entries, summary)
    cut = xs.split_days(entries)
    train = [i for i, e in enumerate(entries) if e['entry_day'] <= cut]
    valid = [i for i, e in enumerate(entries) if e['entry_day'] > cut]
    vdays = sorted({entries[i]['entry_day'] for i in valid})
    daily = {}
    feats = []
    for e in entries:
        daily.setdefault(e['code'], xs.load_daily(cache, e['code']))
        feats.append(features(e, daily[e['code']]))
    ext = [path_extremes(e) for e in entries]
    scores = build_scores(entries, feats)
    a_net_main = [t['net_pct'] for t in retag(res['A_cycle'], entries, COST_MAIN)]
    B, C = pick_reps(summary, entries, res, cut)
    names = {'A': 'A_cycle', 'B': B, 'C': C}

    # 1) 검색기별 적중률/최대상승 (전체 진입, 선별 전)
    scanner_raw = {}
    for s in CORE:
        idx = [i for i, e in enumerate(entries) if s in e['scanners']]
        st = selection_stats(idx, ext, a_net_main)
        scanner_raw[s] = st
    # 2) 후보 점수: 학습에서 하루 상위 5 평균 최대상승률로 1개 고정
    train_stats = {k: selection_stats(top_n(entries, train, sc, 5), ext, a_net_main) for k, sc in scores.items()}
    cand_only = {k: v for k, v in train_stats.items() if k != 'E_engine_rank' and v.get('n')}
    chosen = max(cand_only, key=lambda k: cand_only[k]['mean_mfe']) if cand_only else None
    out = {'cut_day': cut, 'train_days': len({entries[i]['entry_day'] for i in train}), 'valid_days': len(vdays), 'valid_range': [vdays[0], vdays[-1]] if vdays else None,
           'entries': len(entries), 'exclusions': ex, 'cost_main': 'COST_MAIN: 슬리피지 별도 없음 + 비용 0.7%(허용치, 실제 수수료·세금 미확인 가정)', 'scanner_raw': scanner_raw,
           'train_candidate_stats': train_stats, 'chosen': chosen, 'representatives': {'B': B, 'C': C}, 'representatives_note': rep_note}
    # 3) 고정 기준을 검증 구간에 적용
    sets = {}
    for n_ in (3, 5):
        for label, sc in (('existing', scores['E_engine_rank']), ('improved', scores[chosen] if chosen else {})):
            idx = top_n(entries, valid, sc, n_) if sc else []
            sets[(label, n_)] = idx
    out['validation'] = {}
    for (label, n_), idx in sets.items():
        d = selection_stats(idx, ext, a_net_main)
        d['days'] = len({entries[i]['entry_day'] for i in idx})
        out['validation']['%s_top%d' % (label, n_)] = d
    out['validation_gain'] = {'top%d' % n_: {'reach5_gain': hit_gain_ci(entries, sets[('existing', n_)], sets[('improved', n_)], ext, 5.0),
                                              'reach10_gain': hit_gain_ci(entries, sets[('existing', n_)], sets[('improved', n_)], ext, 10.0)} for n_ in (3, 5)}
    # 4) 같은 선별 종목에서 A/B/C
    out['exit_main'] = {k: exit_table(entries, res, sets[('improved', int(k[3:]))], names, COST_MAIN) for k in ('top3', 'top5')}
    out['exit_model_cost'] = {k: exit_table(entries, res, sets[('improved', int(k[3:]))], names, COST_MODEL) for k in ('top3', 'top5')}
    out['exit_existing_top3'] = exit_table(entries, res, sets[('existing', 3)], names, COST_MAIN)
    # 5) 변수별 단순 분위(학습/검증 각각, 서술용 - 선택에 쓰지 않음)
    fe = {}
    for k in CAND[:4]:
        vals = sorted(feats[i][k] for i in train if feats[i])
        if not vals:
            continue
        thr = vals[int(len(vals) * 0.8)]
        fe[k] = {}
        for name_, pool in (('train', train), ('valid', valid)):
            hi = [i for i in pool if feats[i] and feats[i][k] >= thr]
            lo = [i for i in pool if feats[i] and feats[i][k] < thr]
            fe[k][name_] = {'top20pct_by_train_threshold': selection_stats(hi, ext, a_net_main), 'rest': selection_stats(lo, ext, a_net_main)}
    out['feature_split'] = fe
    # 6) 검색기별 앞 표
    front = {}
    for s in CORE + ('전체',):
        idx = [i for i in valid if (s == '전체' or s in entries[i]['scanners'])]
        row = {'valid_entries': len(idx)}
        for label, sc in (('existing', scores['E_engine_rank']), ('improved', scores[chosen] if chosen else {})):
            sel = top_n(entries, idx, sc, 3) if sc else []
            row[label] = selection_stats(sel, ext, a_net_main)
            row[label + '_sel'] = sel
        row['gain'] = hit_gain_ci(entries, row['existing_sel'], row['improved_sel'], ext, 5.0) if row['existing_sel'] and row['improved_sel'] else None
        row['exit'] = exit_table(entries, res, row['improved_sel'], names, COST_MAIN) if row['improved_sel'] else {}
        for k in ('existing_sel', 'improved_sel'):
            row.pop(k)
        front[s] = row
    out['front'] = front
    out['realism'] = realism_variants(work, cache)
    out['ledger_realism_summary'] = dg.ledger_realism(work)
    return out, 'OK'


def fmt(x, d=1, suf=''):
    return '-' if x is None else ('%.*f%s' % (d, x, suf))


def render(D):
    reasons_exit = []
    real = D['realism']
    if 'status' in real:
        reasons_exit.append('원장 재현 검증 불가(%s)' % real['status'])
    elif not real.get('reproduces_engine'):
        b = real['best_agreement']
        reasons_exit.append('청산 시뮬레이터가 실제 엔진을 재현하지 못함(최선 해석 사유 일치 %.0f%%, 시각 3분 이내 %.0f%%, 기준 %.0f%%)' % (b['reason_match_rate'] * 100, b['within_3min_rate'] * 100, REALISM_OK * 100))
    v = D['valid_days']
    need_days = max(0, -(-NEED_VALID_TOP3 // 3) - v, NEED_VALID_MONTH_DAYS - v)
    L = ['# 검색기 고수익 종목 선별 + 청산 방식 최종 판단', '',
         '- 기준: 진입 %d건 · 학습 %d거래일 / 검증 %d거래일(%s). 선별 기준은 학습 구간에서 1개를 고정해 검증에 그대로 적용. 비용: %s.' % (D['entries'], D['train_days'], v, D['valid_range'], D['cost_main']),
         '- 선별 후보 점수는 사전 고정 5개(거래량 급증·추세·유동성·변동성·동일가중 합성)와 기존 엔진 순위이며, 선택은 **학습 구간 상위 5 평균 최대상승률**로만 했다: **%s**.' % D['chosen'], '',
         '| 검색기 | 검증 진입 | 기존 상위3 +5% 적중률 | 개선 상위3 +5% 적중률 (개선폭 [95%]) | A 순수익 | B 순수익 | C 순수익 | 판단 |', '|---|---:|---:|---:|---:|---:|---:|---|']
    for s, r in D['front'].items():
        ex, im, g = r['existing'], r['improved'], r['gain']
        n3 = im.get('n', 0)
        exit_ = r['exit']
        nets = [fmt(exit_.get(k, {}).get('mean'), 2, '%') for k in ('A', 'B', 'C')]
        if n3 < MIN_SCANNER_TOP3:
            verdict = '판정 보류(검증 상위3 %d건 < %d)' % (n3, MIN_SCANNER_TOP3)
        elif g and g['lo'] > 0:
            verdict = '선별 개선(구간 하한>0); 청산 우열은 아래 보류 사유 참조'
        else:
            verdict = '선별 개선 구분 불가'
        L.append('| %s | %d | %s (n=%s) | %s (n=%s) %s | %s | %s | %s | %s |' % (
            s, r['valid_entries'], fmt(ex.get('reach_5'), 0, '%'), ex.get('n', 0), fmt(im.get('reach_5'), 0, '%'), n3,
            '' if not g else '(%+.0f%%p [%+.0f, %+.0f])' % (g['mean'] * 100, g['lo'] * 100, g['hi'] * 100), nets[0], nets[1], nets[2], verdict))
    L += ['', '순수익 열 = 개선 상위3 선별 종목(검증 구간)의 평균 순수익(비용 가정 포함). A=A_cycle, B/C=학습 구간에서 고른 대표 설정(%s / %s).' % (D['representatives']['B'], D['representatives']['C']), '',
          '## 결론', '']
    sr_ = D['scanner_raw']
    best = max(sr_.items(), key=lambda kv: kv[1].get('reach_5', -1) if kv[1].get('n') else -1)
    L.append('1. **큰 상승을 가장 잘 포착한 검색기(전체 진입 기준, 선별 전)**: %s — +5%% 도달 %s, +10%% 도달 %s, 평균 최대상승 %s (n=%d). 전체: ' % (
        best[0], fmt(best[1].get('reach_5'), 0, '%'), fmt(best[1].get('reach_10'), 0, '%'), fmt(best[1].get('mean_mfe'), 1, '%'), best[1].get('n', 0)) + '; '.join(
        '%s %s/%s(n=%d)' % (k, fmt(v.get('reach_5'), 0, '%'), fmt(v.get('reach_10'), 0, '%'), v.get('n', 0)) for k, v in sr_.items()) + '. (도달은 보유 4거래일 안 장중 고가 기준이며 실제 청산 수익이 아니다.)')
    fs = D['feature_split']
    L.append('2. **매수 전 구분 조건**: 학습 상위 20% 임계값 기준(고정) 변수별 +5% 도달률(검증) — ' + '; '.join(
        '%s 상위 %s vs 나머지 %s' % (k, fmt(v['valid']['top20pct_by_train_threshold'].get('reach_5'), 0, '%'), fmt(v['valid']['rest'].get('reach_5'), 0, '%')) for k, v in fs.items())
        + '. 변동성이 큰 종목은 최대 상승만이 아니라 최대 하락도 커지므로 도달률만으로 좋은 후보라 할 수 없다(평균 최대하락은 아래 표).')
    vg, vv = D['validation_gain'], D['validation']
    L.append('3. **개선 선정 vs 기존 순위(검증, 고정 적용)**: 상위3 +5%% 도달 기존 %s → 개선 %s (n=%s/%s), 상위5 기존 %s → 개선 %s. 개선폭 95%% 구간: 상위3 %s, 상위5 %s. 구간이 0을 포함하면 우연과 구분되지 않는다.' % (
        fmt(vv['existing_top3'].get('reach_5'), 0, '%'), fmt(vv['improved_top3'].get('reach_5'), 0, '%'), vv['existing_top3'].get('n'), vv['improved_top3'].get('n'),
        fmt(vv['existing_top5'].get('reach_5'), 0, '%'), fmt(vv['improved_top5'].get('reach_5'), 0, '%'),
        '-' if not vg['top3']['reach5_gain'] else '%+.0f%%p [%+.0f, %+.0f]' % tuple(vg['top3']['reach5_gain'][k] * 100 for k in ('mean', 'lo', 'hi')),
        '-' if not vg['top5']['reach5_gain'] else '%+.0f%%p [%+.0f, %+.0f]' % tuple(vg['top5']['reach5_gain'][k] * 100 for k in ('mean', 'lo', 'hi'))))
    ex3 = D['exit_main']['top3']
    L.append('4. **%% 방식 vs 지지·저항 방식(개선 상위3, 검증, 같은 진입)**: A 평균 %s / B %s / C %s (n=%s). 차이 95%% 구간 B-A %s, C-A %s.' % (
        fmt(ex3.get('A', {}).get('mean'), 2, '%'), fmt(ex3.get('B', {}).get('mean'), 2, '%'), fmt(ex3.get('C', {}).get('mean'), 2, '%'), ex3.get('A', {}).get('n'),
        '-' if 'vs_A' not in ex3.get('B', {}) else '%+.2f [%+.2f, %+.2f]' % tuple(ex3['B']['vs_A'][k] for k in ('mean_diff', 'lo', 'hi')),
        '-' if 'vs_A' not in ex3.get('C', {}) else '%+.2f [%+.2f, %+.2f]' % tuple(ex3['C']['vs_A'][k] for k in ('mean_diff', 'lo', 'hi'))) + (
        ' **우열 판정 보류**: ' + '; '.join(reasons_exit) + '.' if reasons_exit else ' 시뮬레이터 재현 기준은 통과했으나 표본은 아래 부족분을 따른다.'))
    L.append('5. **실거래 적용 근거**: **판정 보류**. 검증 %d거래일(상위3 기준 약 %d건)로 최소 목표(상위3 검증 %d건·약 %d거래일)에 못 미치며%s 약 **%d거래일 이상** 추가 필요(검증 기준 3개월≈%d거래일 포함).' % (
        v, v * 3, NEED_VALID_TOP3, -(-NEED_VALID_TOP3 // 3), ', 청산 시뮬레이터 불일치가 해소되지 않았고' if reasons_exit else '', need_days, NEED_VALID_MONTH_DAYS))

    L += ['', '## 근거 1 — 선별 (학습에서 고정, 검증에 적용)', '', '| 구분 | 후보 | n | +3% | +5% | +10% 도달 | 평균 최대상승 | 평균 최대하락 | 최악 하락 | A_cycle 평균 순수익 | 청산 후 +5% 이상 |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
    for k, st in D['train_candidate_stats'].items():
        if st.get('n'):
            L.append('| 학습 상위5 | %s | %d | %s | %s | %s | %s | %s | %s | %s | %s |' % (k, st['n'], fmt(st['reach_3'], 0, '%'), fmt(st['reach_5'], 0, '%'), fmt(st['reach_10'], 0, '%'), fmt(st['mean_mfe'], 1, '%'),
                                                                                    fmt(st['mean_mae'], 1, '%'), fmt(st['worst_mae'], 1, '%'), fmt(st['a_cycle_mean_net'], 2, '%'), fmt(st['realized_net_ge_5'], 0, '%')))
    for k, st in vv.items():
        if st.get('n'):
            L.append('| **검증(고정)** | %s | %d | %s | %s | %s | %s | %s | %s | %s | %s |' % (k, st['n'], fmt(st['reach_3'], 0, '%'), fmt(st['reach_5'], 0, '%'), fmt(st['reach_10'], 0, '%'), fmt(st['mean_mfe'], 1, '%'),
                                                                                       fmt(st['mean_mae'], 1, '%'), fmt(st['worst_mae'], 1, '%'), fmt(st['a_cycle_mean_net'], 2, '%'), fmt(st['realized_net_ge_5'], 0, '%')))
    L += ['', '- "도달"은 고점을 찍었는지(장중 고가), "청산 후 +5% 이상"은 A_cycle로 실제 청산해 순수익이 +5% 이상이었던 비율이다. 둘의 차이가 클수록 고점 수익을 청산으로 못 거둔다는 뜻이다.',
          '- 학습 구간 후보 중 1개 선택(다중비교 위험 있음), 검증 상위3은 일수가 적어 불확실성이 크다. 다른 후보의 검증 성적은 보고하지 않는다(사후 선택 방지).', '',
          '## 근거 2 — 같은 선별 종목에서 청산 비교 (검증, 개선 상위3·상위5)', '', '| 집합 | 전략 | n | 평균 | 중앙값 | 승률 | 손익비 | 최악 | 이익 반납 %p | 손절 후 회복 | 청산 후 +3% 추가상승 | A 대비 [95%] |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|']
    for k, tab in D['exit_main'].items():
        for label in ('A', 'B', 'C'):
            r = tab.get(label)
            if not r or not r.get('n'):
                continue
            d = r.get('vs_A')
            L.append('| 개선 %s | %s(%s) | %d | %s | %s | %.0f%% | %s | %s | %s | %s | %s | %s |' % (
                k, label, r['rule'], r['n'], fmt(r['mean'], 2, '%'), fmt(r['median'], 2, '%'), r['win'], fmt(r['payoff'], 2), fmt(r['worst'], 1, '%'), fmt(r['giveback_mean'], 2),
                fmt(r['stop_recovered'], 0, '%'), fmt(r['early_exit_missed'], 0, '%'), '기준' if label == 'A' else ('-' if not d else '%+.2f [%+.2f, %+.2f]' % (d['mean_diff'], d['lo'], d['hi']))))
    L += ['', '- 비용: 위 표는 가정(허용치 0.7%, 슬리피지 별도 없음). 슬리피지(0.1/0.15)를 더한 모델 값은 decision.json 의 exit_model_cost. 실제 수수료·세금은 미확인이다.', '',
          '## 근거 3 — 청산 시뮬레이터가 실제 엔진을 재현하는가', '']
    if 'status' in real:
        L.append('- ' + real['status'])
    else:
        L += ['- 실제 원장 매도 %d건을 4가지 타이밍 해석으로 재현: ' % real['compared'] + '; '.join('%s 사유일치 %d/%d, 시각 3분 이내 %d/%d' % (k, v['reason_match'], real['compared'], v['within_3min'], real['compared']) for k, v in real['variants'].items()),
              '- 불일치 거래(A_cycle 해석): ' + '; '.join('%s 실제 %s ↔ 재현 %s, 시각차 %s분, 판정가 실제 %s / 재현 %s' % (r['code'], r['actual_reason'], r['sim_reason'], r['minutes_diff'], r['actual_decision_price'], r['sim_trigger_price'])
                                             for r in real['rows'] if r['actual_reason'] != r['sim_reason'] or r['minutes_diff'] is None or abs(r['minutes_diff']) > 3),
              '- 판독: 해석을 바꿔도 일치율이 오르지 않으면 원인은 타이밍 해석이 아니라 (a) 엔진이 보는 가격이 분봉 종가와 다름(틱·호가 기준), (b) 실제 체결가 미확인 진입(fill_confirmed=false)으로 손절선 기준이 달라짐, (c) 수동 개입, (d) 운영 엔진 버전/상수 차이일 수 있다. 어느 쪽인지는 이 자료로 단정할 수 없다.']
    L += ['', '## 한계', '- 표본: 진입 %d건이지만 독립 단위는 진입일(학습 %d + 검증 %d일)이고 기간이 짧다. 분봉 보유 기간과 보유 4거래일 상한, 진입 09:01 일괄 가정이 적용된다.' % (D['entries'], D['train_days'], v),
          '- 기존 순위는 엔진 필터(유동성·변동성·추세) 통과 후보만 순위를 매기고, 개선 순위는 변수가 계산되는 전체 후보에서 순위를 매긴다(후보 풀도 다르다). 순위 방식만의 효과를 분리하려면 같은 풀에서 비교해야 하나 여기서는 두 파이프라인을 비교했다.',
          '- 비용은 가정이며 MDD 등 누적 지표는 계좌 자본 기준이 아니다. 실계좌 엔진·주문·스케줄러·VM·운영 검색기 조건은 변경하지 않았고 PR #794는 Draft·미병합이다.']
    return '\n'.join(L)


def main(argv=None):
    work = (argv or sys.argv[1:])[0]
    hold = int(argv[1]) if argv and len(argv) > 1 else 4
    D, status = analyze(work, hold)
    if status != 'OK':
        print('결과 없음:', status)
        return 2
    out = os.path.join(work, 'out_decision')
    os.makedirs(out, exist_ok=True)
    json.dump(D, open(os.path.join(out, 'decision.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1, default=str)
    text = render(D)
    open(os.path.join(out, 'SCANNER_EXIT_DECISION.md'), 'w', encoding='utf-8').write(text)
    print(text)
    return 0


if __name__ == '__main__':
    sys.exit(main())
