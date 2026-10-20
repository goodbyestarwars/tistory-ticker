# -*- coding: utf-8 -*-
"""운영 PC 실행용 연구 드라이버(읽기 전용, 2026-10-21). 주문·잔고·계좌 API 호출 없음(분봉 TR ka10080 조회만).

extract : 장부·포착 DB 스냅샷(온라인 백업) + 운영 엔진 파일 해시 대조 + 실제 거래 목록(trades.json, 주문번호 제외)
bars    : 거래에 필요한 1분봉을 키움에서 조회 전용으로 받는다(키는 .env 에서 프로세스 안으로만 읽음, 출력 안 함)
analyze : 실제 진입에서 A / A_cycle / B_SR / C_SR 을 비교하고 사례 보고서·검색기별·국면별·워크포워드·분봉 충족률을 만든다
사용: python exit_sr_local.py extract <autotrader 폴더> <작업 폴더> [저장소 live_engine.py 경로]
      python exit_sr_local.py bars <작업 폴더> <autotrader .env> <네이버 일봉 캐시>
      python exit_sr_local.py analyze <작업 폴더> <네이버 일봉 캐시> [사례 종목코드,...]
작업 폴더는 autotrader 운영 폴더와 분리한다. 출력 JSON/CSV 에는 계좌·키·주문번호가 없다.
"""
import csv
import json
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import exit_ledger_adapter as la  # noqa: E402
import exit_sr_study as sr  # noqa: E402
import exit_strategy_collect as xc  # noqa: E402
import exit_strategy_study as xs  # noqa: E402

EXPECTED = {'live_runner.py': 'F3C8F1ACD883DFF47744F3764F8E770472C3F970580B622EBB2DC4E4A8D338E0',
            'live_engine.py': 'A1B1DAC1A14EDE22CD7E9A6ABBF05B2990F4FF81307D940AECD503DD77491040'}
CONSTANTS = {'STOP_PCT': 3.0, 'EMERGENCY_STOP_PCT': 5.0, 'TRAIL_ARM_PCT': 3.0, 'TRAIL_PCT': 2.5, 'CONFIRM_CHECKS': 2}
CASES = {'352820': '하이브', '441270': '파인엠텍', '089590': '제주항공'}
EXTRA_DAYS = 3


def engine_constants(path):
    out = {}
    try:
        for line in open(path, encoding='utf-8'):
            for k in CONSTANTS:
                if line.startswith(k + ' ='):
                    out[k] = float(line.split('=')[1].split('#')[0].strip())
    except OSError:
        pass
    return out


def engine_check(folder, repo_engine=None):
    res = {}
    for name, want in EXPECTED.items():
        p = os.path.join(folder, name)
        got = la.sha256(p) if os.path.exists(p) else None
        res[name] = {'sha256': got, 'matches_expected': got == want if got else None}
    pe = os.path.join(folder, 'live_engine.py')
    res['pc_constants'] = engine_constants(pe)
    res['constants_match_study'] = res['pc_constants'] == CONSTANTS
    if repo_engine and os.path.exists(repo_engine):
        res['repo_live_engine_sha256'] = la.sha256(repo_engine)
        res['repo_equals_pc_engine'] = res['repo_live_engine_sha256'] == res['live_engine.py']['sha256']
        res['repo_constants'] = engine_constants(repo_engine)
    res['note'] = '해시는 현재 파일 기준이다. 과거 거래 시점에 같은 버전이 실행됐다는 증거가 아니다(수정 시각으로도 단정 불가).'
    return res


def cmd_extract(folder, work, repo_engine=None):
    os.makedirs(work, exist_ok=True)
    snap = os.path.join(work, 'snapshots')
    la.snapshot(os.path.join(folder, 'live_orders.db'), os.path.join(snap, 'live_orders.db'))
    rdb = os.path.join(folder, 'research', 'research.db')
    if os.path.exists(rdb):
        la.snapshot(rdb, os.path.join(snap, 'research.db'))
    json.dump(engine_check(folder, repo_engine), open(os.path.join(work, 'engine_check.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    fills = la.load_fills(folder)
    trades = la.read_trades(os.path.join(snap, 'live_orders.db'), fills, os.path.join(snap, 'research.db'))
    json.dump(trades, open(os.path.join(work, 'trades.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('trades', len(trades), 'fills', len(fills))


def calendar_from(cache_dir):
    return sorted({r[0] for r in json.load(open(os.path.join(cache_dir, '005930.json'), encoding='utf-8'))})


def cmd_bars(work, env_path, cache_dir):
    sys.path.insert(0, os.path.join(HERE, '..', '..', 'quant-autotrade', 'local_bot'))
    from kiwoom import KiwoomClient
    import exit_strategy_calibrate as cal
    trades = json.load(open(os.path.join(work, 'trades.json'), encoding='utf-8'))
    entries, skipped = la.to_entries(trades, calendar_from(cache_dir), EXTRA_DAYS)
    out = os.path.join(work, 'minbars')
    os.makedirs(out, exist_ok=True)
    keys = xc.read_env_keys(env_path)
    client = KiwoomClient(keys.get('KIWOOM_APPKEY'), keys.get('KIWOOM_SECRETKEY'))
    ok = fail = 0
    for e in entries:
        for d in e['days']:
            try:
                cal.ensure_bars(client, out, e['code'], d)
                ok += 1
            except Exception as exc:
                fail += 1
                print('fail', e['code'], d, type(exc).__name__)
    print('bars ok', ok, 'fail', fail, 'skipped trades', len(skipped))


def build_real_entries(work, cache_dir):
    trades = json.load(open(os.path.join(work, 'trades.json'), encoding='utf-8'))
    entries, skipped = la.to_entries(trades, calendar_from(cache_dir), EXTRA_DAYS)
    minbars = os.path.join(work, 'minbars')
    usable, coverage = [], {'trades': len(trades), 'entries': len(entries), 'excluded': list(skipped), 'bar_days_missing': []}
    for e in entries:
        path = xs.build_path(minbars, e)
        have_days = {p[0] for p in path}
        miss = [d for d in e['days'] if d <= e['actual_last_day'] and d not in have_days]
        if miss:
            coverage['excluded'].append({'code': e['code'], 'buy_ts': e['entry_day'], 'reason': 'MINUTE_BARS_MISSING', 'days': miss})
            coverage['bar_days_missing'].extend({'code': e['code'], 'day': d} for d in miss)
            continue
        idx = next((i for i, p in enumerate(path) if p[0] == e['entry_day'] and p[1] >= e['entry_hhmm']), None)
        if idx is None:
            coverage['excluded'].append({'code': e['code'], 'buy_ts': e['entry_day'], 'reason': 'NO_BAR_AT_ENTRY'})
            continue
        e['entry_hhmm'] = path[idx][1]            # 매수 시각 이후 첫 분봉(분봉이 비어 있으면 그다음 봉)
        e['path'] = path
        e['entry_price'] = path[idx][2]
        daily = xs.load_daily(cache_dir, e['code'])
        sr.enrich_entry(e, daily)
        usable.append(e)
    coverage['usable'] = len(usable)
    coverage['coverage_pct'] = round(len(usable) / len(trades) * 100, 1) if trades else None
    return usable, coverage


def simulate_all(entries):
    rules = sr.make_sr_rules()
    res = {n: [] for n in rules}
    for e in entries:
        ctx = {'atr_pct': e['atr_pct'], 'daily_lows': e['daily_lows'], 'daily_highs': e['daily_highs']}
        for n, f in rules.items():
            res[n].append(xs.simulate(e, f, ctx))
    return res


def walk_forward(entries, results, folds=3):
    """진입일 기준 시간순 폴드. 각 폴드에서 규칙별 A 대비 평균 차이를 낸다(설정 선택 없음). 표본이 폴드당 5건 미만이면 보류."""
    days = sorted({e['entry_day'] for e in entries})
    if len(days) < folds:
        return {'status': '진입일 %d일 < %d 폴드 - 보류' % (len(days), folds)}
    bounds = [days[int(len(days) * k / folds)] for k in range(folds)] + [days[-1] + '~']
    out = {}
    for name, tr in results.items():
        if name == 'A':
            continue
        per = []
        for k in range(folds):
            lo, hi = bounds[k], bounds[k + 1]
            idx = [i for i, e in enumerate(entries) if e['entry_day'] >= lo and (k == folds - 1 or e['entry_day'] < hi)]
            per.append({'from': lo, 'n': len(idx), 'mean_diff': round(sum(tr[i]['net_pct'] - results['A'][i]['net_pct'] for i in idx) / len(idx), 3) if len(idx) >= 5 else None})
        out[name] = per
    return out


def regimes(entries, results, cache_dir):
    """국면 구분: 진입 전 10거래일 KODEX200(069500) 수익률이 +1% 초과 상승 / -1% 미만 하락 / 그 사이 횡보. 069500 일봉이 없으면 판정 불가."""
    path = os.path.join(cache_dir, '069500.json')
    try:
        rows = [r for r in json.load(open(path, encoding='utf-8')) if r[4]]
    except (OSError, ValueError):
        return {'status': '국면 판정 불가: 069500(KODEX200) 일봉 캐시 없음'}

    def prior(day, n=10):
        prev = [r for r in rows if r[0] < day][-(n + 1):]
        return (prev[-1][4] / prev[0][4] - 1) * 100 if len(prev) == n + 1 else None
    out = {'proxy': '069500 KODEX200, 진입 전 10거래일 수익률'}
    for name, tr in results.items():
        buckets = defaultdict(list)
        for t, e in zip(tr, entries):
            r = prior(e['entry_day'])
            buckets['판정불가' if r is None else 'up' if r > 1 else 'down' if r < -1 else 'flat'].append(t)
        out[name] = {k: xs.summarize(v) for k, v in buckets.items()}
    return out


def realism(entries, res):
    """백테스트 현실성: 실제 원장 매도를 A_cycle(운영 사이클 재현)로 다시 돌린 결과와 비교한다. 규칙을 맞추는 용도가 아니라 시뮬레이터가
    실제 엔진을 얼마나 재현하는지 보는 검증이다. 원장 매도가 없거나(보유 중·수동) 사유가 비교 불가면 제외하고 건수를 센다."""
    rows, skipped = [], 0
    for i, e in enumerate(entries):
        a = e.get('actual') or {}
        if not a.get('sell_ts'):
            skipped += 1
            continue
        t = res['A_cycle'][i]
        sday, shhmm = a['sell_ts'][:10], a['sell_ts'][11:13] + a['sell_ts'][14:16]
        same_day = t['exit_day'] == sday
        diff = None
        if same_day:
            diff = (int(t['exit_hhmm'][:2]) * 60 + int(t['exit_hhmm'][2:])) - (int(shhmm[:2]) * 60 + int(shhmm[2:]))
        px = None
        if a.get('sell_decision_price') and t.get('trigger_price'):
            px = (t['trigger_price'] / float(a['sell_decision_price']) - 1) * 100
        rows.append({'code': e['code'], 'actual_reason': a.get('sell_reason'), 'sim_reason': t['reason'], 'reason_match': a.get('sell_reason') == t['reason'],
                     'same_day': same_day, 'minutes_diff': diff, 'decision_price_diff_pct': None if px is None else round(px, 2)})
    n = len(rows)
    close = [r for r in rows if r['same_day'] and r['minutes_diff'] is not None and abs(r['minutes_diff']) <= 3]
    return {'compared': n, 'skipped_no_actual_sell': skipped, 'reason_match': sum(1 for r in rows if r['reason_match']),
            'exit_within_3min': len(close), 'rows': rows,
            'note': '일치율이 낮으면 시뮬레이터 현실성이 부족한 것이다. 불일치 거래는 원인(분봉 시차·사이클 간격·수동 청산)을 확인하기 전에는 성과 평가에 쓰지 않는다.'}


def structure_at(entry, until_idx):
    """매도 시점까지의 구조 상태(그 시점에 알 수 있었던 것만): 확정된 5분봉 상승 저점, 일봉 지지, 직전일 저점, 시초 15분 저점."""
    path = entry['path']
    ctx = {'atr_pct': entry['atr_pct'], 'daily_lows': entry['daily_lows'], 'daily_highs': entry['daily_highs']}
    entry_idx = next(i for i, p in enumerate(path) if p[0] == entry['entry_day'] and p[1] == entry['entry_hhmm'])
    fill = entry['entry_fill_price']
    rule = sr.SRRule(path[entry_idx][2], ctx, 'combo', 'c5')
    rule.avg = rule.peak = fill
    low15 = None
    day0 = entry['entry_day']
    for i in range(entry_idx + 1, min(until_idx, len(path) - 1) + 1):
        day, hhmm, o, h, l, c, v = path[i]
        if day == day0 and hhmm < '0915':
            low15 = l if low15 is None else min(low15, l)
        rule.step(c, path[i], {'ref_low15': low15, 'prev_low': entry['prev_lows'].get(day), 'day_index': 0})
    px = path[min(until_idx, len(path) - 1)][5]
    levels = {'swing_5m': rule.swing, 'daily_support': rule.daily_support, 'prev_day_low': entry['prev_lows'].get(path[min(until_idx, len(path) - 1)][0]), 'low15': low15}
    broken = {k: (px < v * (1 - rule.buf / 100)) for k, v in levels.items() if v}
    return {'levels': levels, 'price': px, 'broken': broken, 'swing_higher_low_held': bool(rule.swing and px >= rule.swing)}


def case_report(entry, results_by_rule, idx):
    path = entry['path']
    fill = entry['entry_fill_price']
    a = results_by_rule['A_cycle'][idx]
    sell_i = next((i for i, p in enumerate(path) if p[0] == a['exit_day'] and p[1] == a['exit_hhmm']), len(path) - 1)
    after = path[sell_i:]
    hi = max(p[3] for p in after) if after else None
    lo = min(p[4] for p in after) if after else None
    rows = {n: {'reason': tr[idx]['reason'], 'exit': '%s %s' % (tr[idx]['exit_day'], tr[idx]['exit_hhmm']), 'net_pct': round(tr[idx]['net_pct'], 2),
                'mfe_pct': round(tr[idx]['mfe_pct'], 2), 'mae_pct': round(tr[idx]['mae_pct'], 2)} for n, tr in results_by_rule.items()}
    return {'code': entry['code'], 'scanner': entry['scanner'], 'rank': entry.get('rank'), 'entry': '%s %s' % (entry['entry_day'], entry['entry_hhmm']),
            'entry_fill': fill, 'fill_confirmed': entry['fill_confirmed'], 'actual': entry['actual'],
            'daily_structure_before_entry': {'supports': entry['daily_lows'][-3:], 'resistances': entry['daily_highs'][-3:]},
            'structure_at_A_exit': structure_at(entry, sell_i),
            'after_A_exit': {'high_pct': round((hi / path[sell_i][5] - 1) * 100, 2) if hi else None, 'low_pct': round((lo / path[sell_i][5] - 1) * 100, 2) if lo else None,
                             'days_covered': sorted({p[0] for p in after})},
            'rules': rows}


def cmd_analyze(work, cache_dir, case_codes=None):
    entries, coverage = build_real_entries(work, cache_dir)
    out_dir = os.path.join(work, 'out')
    os.makedirs(out_dir, exist_ok=True)
    json.dump(coverage, open(os.path.join(out_dir, 'coverage.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    if not entries:
        print('분석 가능한 실제 거래가 없습니다. coverage.json 확인')
        return
    res = simulate_all(entries)
    cut = xs.split_days(entries)
    summary = {'basis': '실제 진입에 매도 규칙만 교체한 시뮬레이션(실제 체결 결과 아님). A=서로 다른 완료 봉 2개 확인, A_cycle=운영 사이클 2회(같은 봉 중복 가능)',
               'entries': len(entries), 'fill_confirmed': sum(1 for e in entries if e['fill_confirmed']), 'split_day': cut, 'rules': {}}
    for n, tr in res.items():
        summary['rules'][n] = {'all': xs.summarize(tr), 'train': xs.summarize([t for t in tr if t['entry_day'] <= cut]),
                               'valid': xs.summarize([t for t in tr if t['entry_day'] > cut])}
    summary['paired_vs_A_cycle'] = {n: xs.paired_bootstrap(res['A_cycle'], tr) for n, tr in res.items() if n != 'A_cycle'}
    summary['paired_valid_vs_A_cycle'] = {}
    vi = [i for i, e in enumerate(entries) if e['entry_day'] > cut]
    if len(vi) >= 5:
        for n, tr in res.items():
            if n != 'A_cycle':
                summary['paired_valid_vs_A_cycle'][n] = xs.paired_bootstrap([res['A_cycle'][i] for i in vi], [tr[i] for i in vi])
    summary['realism'] = realism(entries, res)
    summary['by_scanner'] = sr.group_report(res, entries)
    summary['walk_forward'] = walk_forward(entries, res)
    summary['regimes'] = regimes(entries, res, cache_dir)
    summary['adoption_check'] = {'min_valid_trades': 100, 'valid_trades': len(vi), 'sufficient': len(vi) >= 100,
                                 'note': '검증 100건 이상·3개월 이상, A 대비 95% 구간 하한 > 0, MDD·최악 악화 없음, 계좌 단위 재현이 모두 필요'}
    json.dump(summary, open(os.path.join(out_dir, 'summary.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    rows = sr.trade_diff_rows(res, entries)
    with open(os.path.join(out_dir, 'trades_abc.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    wanted = set(case_codes or CASES)
    cases = [case_report(e, res, i) for i, e in enumerate(entries) if e['code'] in wanted]
    json.dump(cases, open(os.path.join(out_dir, 'cases.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('entries', len(entries), 'cases', len(cases), 'valid', len(vi), '->', out_dir)


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'extract':
        cmd_extract(*sys.argv[2:5])
    elif cmd == 'bars':
        cmd_bars(*sys.argv[2:5])
    elif cmd == 'analyze':
        cmd_analyze(sys.argv[2], sys.argv[3], sys.argv[4].split(',') if len(sys.argv) > 4 else None)
    else:
        sys.exit(__doc__)
