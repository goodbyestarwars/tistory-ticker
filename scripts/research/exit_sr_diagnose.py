# -*- coding: utf-8 -*-
"""백테스트 수치 신뢰성 진단(읽기 전용, 2026-10-22). 새 전략을 만들거나 최적화하지 않는다.

기존 연구 산출물(`<작업 폴더>/out_universe/trades_abc.csv` 의 진입 목록, `minbars`, `naver`)을 재사용해 같은 진입 집합을 다시 시뮬레이션하고
(키움 분봉 재수집 없음) 아래를 분리해서 본다: 비용 분해, 수익률 분포, 엔진 필터 부분집합, 단순 보유 기준, 청산 시뮬레이터 현실성, 상관·중복.
결과는 `<작업 폴더>/out_diagnose/` 에 새 파일로만 쓴다(원장·기존 산출물은 읽기만 한다).
사용: python exit_sr_diagnose.py <작업 폴더> [--hold-days 4] [--real-cost 0.25]
"""
import argparse
import csv
import json
import os
import statistics
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import exit_sr_study as sr  # noqa: E402
import exit_sr_universe as uni  # noqa: E402
import exit_strategy_study as xs  # noqa: E402

BUCKETS = [(-100, -5), (-5, -3), (-3, -2), (-2, -1), (-1, 0), (0, 1), (1, 3), (3, 5), (5, 100)]


class RuleHold(xs.Rule):
    """기준 전략: 어떤 청산 신호도 없이 정해진 보유기간 끝(HORIZON, 마지막 분봉 종가)에 판다. 비상 손절도 없다."""
    name = 'HOLD'

    def step(self, price, bar, day_state):
        return None


def pct_pts(values, qs=(10, 25, 50, 75, 90)):
    v = sorted(values)
    if not v:
        return {}
    out = {}
    for q in qs:
        k = (len(v) - 1) * q / 100
        lo, hi = int(k), min(int(k) + 1, len(v) - 1)
        out['p%d' % q] = v[lo] + (v[hi] - v[lo]) * (k - lo)
    return out


def trimmed_mean(values, frac=0.05):
    v = sorted(values)
    k = int(len(v) * frac)
    core = v[k:len(v) - k] or v
    return sum(core) / len(core)


def load_entries(work, hold_days):
    """trades_abc.csv 의 (종목, 진입일, 검색기)로 진입 집합을 그대로 복원한다(기준가 갭 필터는 이미 통과한 진입이므로 다시 적용하지 않는다)."""
    cache = os.path.join(work, 'naver')
    cal = sorted({r[0] for r in json.load(open(os.path.join(cache, '005930.json'), encoding='utf-8'))})
    seen = {}
    path = os.path.join(work, 'out_universe', 'trades_abc.csv')
    with open(path, encoding='utf-8-sig') as f:
        for r in csv.DictReader(f):
            seen.setdefault((r['code'], r['entry_day']), r.get('scanner') or '')
    plans = []
    for (code, day), scanners in sorted(seen.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        idx = cal.index(day) if day in cal else None
        if idx is None or idx == 0:
            continue
        plans.append({'scan_date': cal[idx - 1], 'entry_day': day, 'days': cal[idx:idx + hold_days], 'code': code, 'name': None,
                      'scanner': scanners.split('+')[0], 'scanners': scanners.split('+'), 'base': None, 'score': None})
    entries, ex = uni.attach_paths(plans, os.path.join(work, 'minbars'), cache, cal)
    return entries, ex, cache, len(seen)


def simulate_all(entries, summary):
    rules = sr.make_sr_rules()
    reps = (summary or {}).get('representatives') or {}
    keep = {'A', 'A_cycle'}
    for fam in ('B_SR', 'C_SR'):
        if reps.get(fam) in rules:
            keep.add(reps[fam])
    keep = {k: rules[k] for k in rules if k in keep}
    keep['HOLD'] = lambda p, c: RuleHold(p, c)
    res = {n: [] for n in keep}
    for e in entries:
        ctx = {'atr_pct': e['atr_pct'], 'daily_lows': e['daily_lows'], 'daily_highs': e['daily_highs']}
        for n, f in keep.items():
            res[n].append(xs.simulate(e, f, ctx))
    return res, reps


def raw_returns(entry, trade):
    """원가격 수익률(슬리피지·비용 전): 진입 분봉 시가 -> 청산 분봉 시가/종가."""
    raw_entry = trade['entry'] / (1 + xs.SLIP_BUY_PCT / 100)
    raw_exit = trade['exit_raw']
    return (raw_exit / raw_entry - 1) * 100


def scenario_net(raw_pct, sb, ss, cost):
    """같은 청산 시점에 다른 슬리피지·비용을 적용한 수익률(청산 시점은 고정한 근사: 슬리피지가 손절선 도달에 주는 미세한 영향은 무시)."""
    return ((1 + raw_pct / 100) * (1 - ss / 100) / (1 + sb / 100) - 1) * 100 - cost


def cost_breakdown(entries, res, real_cost=None):
    e0, t0 = entries[0], res['A_cycle'][0]
    first = next(p for p in e0['path'] if p[0] == e0['entry_day'] and p[1] == xs.EVAL_FIRST)
    scen = {'원가격(슬리피지·비용 0)': (0, 0, 0), '슬리피지만(0.1/0.15)': (xs.SLIP_BUY_PCT, xs.SLIP_SELL_PCT, 0.0),
            '기존 가정(0.1/0.15/0.7)': (xs.SLIP_BUY_PCT, xs.SLIP_SELL_PCT, xs.COST_PCT), '슬리피지 없음+비용 0.7': (0, 0, xs.COST_PCT),
            '가정 비용 0.25(확인 필요)': (0, xs.SLIP_SELL_PCT, 0.25)}
    if real_cost is not None:
        scen['실제 계좌 확인 비용(%.3f)' % real_cost] = (0, xs.SLIP_SELL_PCT, real_cost)
    out = {'code_check': {}, 'scenarios': {}}
    # 코드 확인: net = gross - COST, gross 는 진입·청산 슬리피지를 한 번씩만 포함하는지
    out['code_check'] = {'COST_PCT': xs.COST_PCT, 'SLIP_BUY_PCT': xs.SLIP_BUY_PCT, 'SLIP_SELL_PCT': xs.SLIP_SELL_PCT,
                         'net_equals_gross_minus_cost': abs(t0['net_pct'] - (t0['gross_pct'] - xs.COST_PCT)) < 1e-9,
                         'entry_fill_is_open_times_1_plus_buy_slip': abs(t0['entry'] - first[2] * (1 + xs.SLIP_BUY_PCT / 100)) < 1e-6,
                         'exit_fill_is_raw_times_1_minus_sell_slip': abs(t0['exit'] - t0['exit_raw'] * (1 - xs.SLIP_SELL_PCT / 100)) < 1e-6,
                         'gross_is_fill_to_fill': abs(t0['gross_pct'] - (t0['exit'] / t0['entry'] - 1) * 100) < 1e-9,
                         'total_modeled_drag_pct_points': xs.SLIP_BUY_PCT + xs.SLIP_SELL_PCT + xs.COST_PCT,
                         'double_count_risk': 'COST_PCT 0.7 은 문서상 "엔진 허용치(수수료+세금+슬리피지 여유)"다. 별도 슬리피지 0.25가 또 더해지므로 허용치가 슬리피지를 이미 포함한다면 중복이다.'}
    for rule, trades in res.items():
        raws = [raw_returns(e, t) for e, t in zip(entries, trades)]
        out['scenarios'][rule] = {name: round(sum(scenario_net(r, *p) for r in raws) / len(raws), 3) for name, p in scen.items()}
        out['scenarios'][rule]['원가격 평균'] = round(sum(raws) / len(raws), 3)
        out['scenarios'][rule]['모델 net 평균(시뮬레이터 값)'] = round(sum(t['net_pct'] for t in trades) / len(trades), 3)
    out['pairwise_vs_A_cycle_net_diff'] = {}
    for rule in res:
        if rule != 'A_cycle':
            d = [t['net_pct'] - a['net_pct'] for t, a in zip(res[rule], res['A_cycle'])]
            out['pairwise_vs_A_cycle_net_diff'][rule] = round(sum(d) / len(d), 3)
    out['note'] = '비용·슬리피지는 모든 전략에 거래당 같은 값이라 전략 간 평균 차이는 비용 시나리오와 거의 무관하다(청산 시점 고정 근사). 비용을 빼면 절대 수익률이 올라갈 뿐 전략 우열이 바뀐다고 단정할 수 없다.'
    return out


def distribution(trades):
    nets = [t['net_pct'] for t in trades]
    n = len(nets)
    d = {'n': n, 'mean': sum(nets) / n, 'median': statistics.median(nets), **pct_pts(nets), 'wins': sum(1 for x in nets if x > 0), 'losses': sum(1 for x in nets if x <= 0),
         'trimmed_mean_5pct': trimmed_mean(nets), 'stdev': statistics.pstdev(nets)}
    order = sorted(nets)
    d['mean_without_top5'] = sum(order[:-5]) / max(1, n - 5) if n > 5 else None
    d['mean_without_bottom5'] = sum(order[5:]) / max(1, n - 5) if n > 5 else None
    top10 = sum(sorted(nets, reverse=True)[:10])
    d['sum_top10_share_of_positive_sum'] = round(top10 / sum(x for x in nets if x > 0) * 100, 1) if any(x > 0 for x in nets) else None
    d['buckets'] = {'%s~%s' % (lo, hi): sum(1 for x in nets if lo <= x < hi) for lo, hi in BUCKETS}
    by = defaultdict(list)
    for t in trades:
        by[t['reason']].append(t['net_pct'])
    d['by_reason'] = {r: {'n': len(v), 'mean': round(sum(v) / len(v), 3), 'median': round(statistics.median(v), 3)} for r, v in sorted(by.items())}
    return d


def subsets(entries, res):
    """엔진 매수 필터 부분집합. rank_one 은 live_engine.rank_candidates 의 한 종목 점수(유동성·변동성·추세 필터)다.
    전체 포착 가정은 이 필터를 건너뛴다. 순위 상위 N/일은 엔진의 하루 매수 상한(과거 3종목)을 가정한 연구용 부분집합이다."""
    passed = [i for i, e in enumerate(entries) if e.get('rank_score')]
    by_day = defaultdict(list)
    for i in passed:
        by_day[entries[i]['entry_day']].append(i)
    sets = {'전체 포착 진입': list(range(len(entries))), '엔진 필터 통과': passed}
    for k in (3, 5):
        top = []
        for day, idx in by_day.items():
            top += sorted(idx, key=lambda i: tuple(-x for x in entries[i]['rank_score']))[:k]
        sets['엔진 필터 통과 + 일 상위 %d' % k] = sorted(top)
    out = {}
    for name, idx in sets.items():
        out[name] = {'n': len(idx), 'days': len({entries[i]['entry_day'] for i in idx})}
        if not idx:
            continue
        out[name]['rules'] = {r: {'mean': round(sum(tr[i]['net_pct'] for i in idx) / len(idx), 3), 'median': round(statistics.median([tr[i]['net_pct'] for i in idx]), 3),
                                  'raw_mean': round(sum(raw_returns(entries[i], tr[i]) for i in idx) / len(idx), 3)} for r, tr in res.items()}
        a = [res['A_cycle'][i] for i in idx]
        out[name]['paired_vs_A_cycle'] = {r: xs.paired_bootstrap(a, [tr[i] for i in idx]) for r, tr in res.items() if r != 'A_cycle'} if len(idx) >= 10 else {}
    return out


def correlation(entries, res):
    by_day = defaultdict(list)
    for i, e in enumerate(entries):
        by_day[e['entry_day']].append(res['A_cycle'][i]['net_pct'])
    nets = [t['net_pct'] for t in res['A_cycle']]
    mean = sum(nets) / len(nets)
    total_var = sum((x - mean) ** 2 for x in nets)
    between = sum(len(v) * (sum(v) / len(v) - mean) ** 2 for v in by_day.values())
    sizes = [len(v) for v in by_day.values()]
    multi = sum(1 for e in entries if len(e['scanners']) > 1)
    return {'entries': len(entries), 'entry_days': len(by_day), 'avg_entries_per_day': round(len(entries) / len(by_day), 2), 'max_entries_in_a_day': max(sizes),
            'share_of_variance_explained_by_entry_day_pct': round(between / total_var * 100, 1) if total_var else None, 'entries_flagged_by_multiple_scanners': multi,
            'effective_sample_note': '같은 날 진입은 같은 시장 흐름을 공유한다. 독립 표본 수는 진입 건수가 아니라 진입일 수에 더 가깝다(신뢰구간은 진입일 단위 재표집).'}


def similarity(entries, res):
    """A/B/C 차이가 작은 근본 원인 진단: 같은 사유·같은 시각에 청산된 비율, 차이 분포, 전체가 HORIZON 으로 끝나는 비율."""
    out = {}
    a = res['A_cycle']
    for r, tr in res.items():
        if r == 'A_cycle':
            continue
        same = sum(1 for x, y in zip(a, tr) if (x['reason'], x['exit_day'], x['exit_hhmm']) == (y['reason'], y['exit_day'], y['exit_hhmm']))
        diffs = [y['net_pct'] - x['net_pct'] for x, y in zip(a, tr)]
        out[r] = {'identical_exit_share_pct': round(same / len(a) * 100, 1), 'mean_diff': round(sum(diffs) / len(diffs), 3), 'stdev_diff': round(statistics.pstdev(diffs), 3),
                  'abs_diff_under_0.3pp_pct': round(sum(1 for d in diffs if abs(d) < 0.3) / len(diffs) * 100, 1),
                  'diff_pctiles': {k: round(v, 2) for k, v in pct_pts(diffs).items()}}
    out['A_cycle_exit_reasons'] = {k: sum(1 for t in a if t['reason'] == k) for k in sorted({t['reason'] for t in a})}
    return out


def hold_effect(entries, res):
    h = res['HOLD']
    out = {'HOLD_raw_mean': round(sum(raw_returns(e, t) for e, t in zip(entries, h)) / len(h), 3), 'HOLD_net_mean': round(sum(t['net_pct'] for t in h) / len(h), 3)}
    for r, tr in res.items():
        if r != 'HOLD':
            out['%s_minus_HOLD' % r] = xs.paired_bootstrap(h, tr)
    return out


def ledger_realism(work):
    p = os.path.join(work, 'out', 'summary.json')
    if not os.path.exists(p):
        return {'status': '실제 원장 현실성 결과(out/summary.json) 없음 - `-Mode ledger` 또는 all 실행 필요'}
    r = (json.load(open(p, encoding='utf-8')).get('realism') or {})
    return {k: r.get(k) for k in ('compared', 'reason_match', 'exit_within_3min', 'skipped_no_actual_sell', 'mismatch_causes', 'low_agreement')} or {'status': 'realism 항목 없음'}


def render(D):
    def f(x):
        return '-' if x is None else ('%.2f' % x if isinstance(x, (int, float)) else str(x))
    cb, A = D['cost'], D['distribution']['A_cycle']
    sc = cb['scenarios']['A_cycle']
    drag = cb['code_check']['total_modeled_drag_pct_points']
    raw = sc['원가격 평균']
    L = ['# 백테스트 수치 신뢰성 진단 (읽기 전용, 전략 최적화 아님)', '',
         '- 진입 %d건(복원 시도 %d, 제외 %s), 진입일 %d일. 기존 분봉·일봉 캐시 재사용, 키움 재수집 없음.' % (D['entries'], D['restored_pairs'], json.dumps(D['exclusions'], ensure_ascii=False), D['correlation']['entry_days']), '',
         '## 1. 비용 분해', '- 코드 확인: ' + json.dumps({k: v for k, v in cb['code_check'].items() if k != 'double_count_risk'}, ensure_ascii=False),
         '- 중복 가능성: ' + cb['code_check']['double_count_risk'],
         '- 모델이 거래마다 깎는 총량: 매수 슬리피지 %.2f + 매도 슬리피지 %.2f + 비용 %.2f = **%.2f%%p**.' % (xs.SLIP_BUY_PCT, xs.SLIP_SELL_PCT, xs.COST_PCT, drag), '',
         '| 규칙 | ' + ' | '.join(k for k in sc) + ' |', '|---|' + '---:|' * len(sc)]
    for r, v in cb['scenarios'].items():
        L.append('| %s | %s |' % (r, ' | '.join(f(x) for x in v.values())))
    L += ['', '- ' + cb['note'], '- 전략 간 평균 차이(net, A_cycle 대비): ' + json.dumps(cb['pairwise_vs_A_cycle_net_diff'], ensure_ascii=False), '',
          '## 2. 수익률 분포 (net, %)', '', '| 규칙 | n | 평균 | 5%절사평균 | 중앙값 | p10 | p25 | p75 | p90 | 흑자 | 적자 | 상위5 제외 평균 | 상위10 이익 비중 |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
    for r, d in D['distribution'].items():
        L.append('| %s | %d | %s | %s | %s | %s | %s | %s | %s | %d | %d | %s | %s%% |' % (r, d['n'], f(d['mean']), f(d['trimmed_mean_5pct']), f(d['median']), f(d.get('p10')), f(d.get('p25')),
                                                                                   f(d.get('p75')), f(d.get('p90')), d['wins'], d['losses'], f(d['mean_without_top5']), f(d['sum_top10_share_of_positive_sum'])))
    L += ['', '손실 폭별 건수(A_cycle): ' + json.dumps(A['buckets'], ensure_ascii=False), '', '청산 사유별(A_cycle): ' + json.dumps(A['by_reason'], ensure_ascii=False), '',
          '## 3. 진입 집합 (엔진 필터 반영)', '', '| 집합 | 건수 | 진입일 | ' + ' | '.join('%s 평균(원/ net)' % r for r in D['distribution']) + ' |', '|---|---:|---:|' + '---:|' * len(D['distribution'])]
    for name, v in D['subsets'].items():
        if 'rules' in v:
            L.append('| %s | %d | %d | %s |' % (name, v['n'], v['days'], ' | '.join('%s/%s' % (f(v['rules'][r]['raw_mean']), f(v['rules'][r]['mean'])) for r in D['distribution'])))
    L += ['', '- 엔진 필터는 `exit_strategy_collect.rank_one`(live_engine.rank_candidates의 유동성·변동성·추세 필터와 같은 점수)을 재사용한 것이며, 실제 엔진의 실시간 호가·VI·예산·보유 제한·잔고 조건은 재현하지 않았다. 일 상위 N은 연구용 가정이다.', '',
          '## 4. 같은 진입에서 전략 간 차이가 작은 이유', json.dumps(D['similarity'], ensure_ascii=False), '',
          '## 5. 단순 보유 기준 대비 (후보 자체의 가격 움직임과 청산 효과 분리)', json.dumps(D['hold'], ensure_ascii=False), '',
          '## 6. 상관·중복', json.dumps(D['correlation'], ensure_ascii=False), '',
          '## 7. 청산 시뮬레이터 현실성 (실제 원장 vs A_cycle)', json.dumps(D['ledger_realism'], ensure_ascii=False), '',
          '- **MDD 주의**: 이 연구의 MDD는 거래별 순수익률(%)을 순서대로 단순 합산한 누적 곡선의 낙폭(%p)이다. 계좌 자본 대비 낙폭이 아니다(종목당 금액·동시 보유·복리 미반영). 계좌 기준 성과와 혼동하지 말 것.', '',
          '## 질문별 답', '']
    ex_drag = A['mean'] - raw
    L += ['- 평균 %s%% 중 비용·슬리피지 몫: 모델 총 차감 %.2f%%p. 원가격 평균 %s%% → 슬리피지 후 %s%% → 비용 후 %s%% (A_cycle).' % (f(A['mean']), drag, f(raw), f(sc['슬리피지만(0.1/0.15)']), f(sc['모델 net 평균(시뮬레이터 값)'])),
          '- 비용을 제외한 가격 움직임의 기대수익: A_cycle 원가격 평균 %s%%, 단순 보유 원가격 평균 %s%%. 신뢰구간과 진입일 수(%d일)를 함께 보고 판단해야 하며 표본이 작으면 0과 구분되지 않을 수 있다.' % (f(raw), f(D['hold']['HOLD_raw_mean']), D['correlation']['entry_days']),
          '- 엔진 필터 적용 시: 위 3번 표에서 집합별 평균을 비교(필터가 평균을 바꾸는지는 건수·신뢰구간과 함께 본다).',
          '- 차이가 작은 근본 원인: 4번 지표(청산이 동일한 비율, 차이의 표준편차)와 모델이 모든 전략에 같이 얹는 %.2f%%p 차감이 전략 간 차이보다 훨씬 크다는 점.' % drag,
          '- 모델 신뢰도: 현실성 일치율(7번), 룩어헤드 감사 0 여부(RESULT_UNIVERSE.md), 독립 표본이 진입일 수에 가깝다는 점, 비용 가정이 허용치 기반이라 절대 수익률은 비관적일 수 있다는 점을 종합해야 한다.']
    return '\n'.join(L)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('work')
    ap.add_argument('--hold-days', type=int, default=4)
    ap.add_argument('--real-cost', type=float, default=None, help='실제 계좌에서 확인한 왕복 수수료+세금(%%). 확인 전에는 쓰지 말 것')
    a = ap.parse_args(argv)
    entries, ex, cache, pairs = load_entries(a.work, a.hold_days)
    if not entries:
        print('복원된 진입이 없습니다:', ex)
        return 2
    sp = os.path.join(a.work, 'out_universe', 'summary.json')
    summary = json.load(open(sp, encoding='utf-8')) if os.path.exists(sp) else {}
    res, reps = simulate_all(entries, summary)
    D = {'entries': len(entries), 'restored_pairs': pairs, 'exclusions': ex, 'representatives': reps, 'cost': cost_breakdown(entries, res, a.real_cost),
         'distribution': {r: distribution(tr) for r, tr in res.items()}, 'subsets': subsets(entries, res), 'similarity': similarity(entries, res),
         'hold': hold_effect(entries, res), 'correlation': correlation(entries, res), 'ledger_realism': ledger_realism(a.work)}
    out = os.path.join(a.work, 'out_diagnose')
    os.makedirs(out, exist_ok=True)
    json.dump(D, open(os.path.join(out, 'diagnose.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    text = render(D)
    open(os.path.join(out, 'DIAGNOSIS.md'), 'w', encoding='utf-8').write(text)
    print(text)
    return 0


if __name__ == '__main__':
    sys.exit(main())
