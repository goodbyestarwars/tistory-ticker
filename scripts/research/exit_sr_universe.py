# -*- coding: utf-8 -*-
"""검색기 포착 이력 전체(실제 매수 여부와 무관)로 A / A_cycle / B_SR / C_SR 을 같은 조건에서 비교하는 가상 백테스트 (연구용 읽기 전용, 2026-10-21).

실제 원장 거래 분석(exit_sr_local.py)과는 별도 결과다. 섞지 않는다.
진입(모든 전략 동일): 저녁 배치로 포착된 날(scan_date)의 다음 거래일 09:01 분봉 시가 + 슬리피지 0.1%. 시가가 포착 기준가의 +2% 이상이면 엔진과 같이 제외.
  기존 검색기 4종(pullback·maCloudBreakout·doubleBottom·invHeadShoulders)만 사용한다. 다른 검색기는 장중 포착과 저녁 배치가 섞여 있고 포착 시각을 모르면
  '다음날 시가 진입'이 성립하는지 검증할 수 없어 제외 사유(ENTRY_TIMING_UNVERIFIED)로 건수만 기록한다. 9Pay A/B 장중 단타는 별도 집단이며 과거 신호 이력 파일이 있을 때만 다룬다.
청산 비교는 exit_strategy_study / exit_sr_study 의 규칙·체결 가정(판정=분봉 종가, 체결=다음 분봉 시가-슬리피지, 왕복 비용)을 그대로 쓴다. 설정은 사전 고정이며 결과에 맞춰 바꾸지 않는다.
분봉이 없는 구간은 일봉 등으로 대체하지 않고 제외한다(1분봉 전략을 재현했다고 주장하지 않는다).
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import exit_ledger_adapter as la  # noqa: E402
import exit_sr_study as sr  # noqa: E402
import exit_strategy_collect as xc  # noqa: E402
import exit_strategy_study as xs  # noqa: E402

CORE = ('pullback', 'maCloudBreakout', 'doubleBottom', 'invHeadShoulders')
PUBLIC_LIMIT = 1500
MIN_VALID = 100
MIN_VALID_MONTHS = 3
SLOTS = 3
BASELINE = 'A_cycle'


def norm_scanner(s):
    return str(s or '').replace('pattern:', '').strip()


# ---------- 포착 이력 수집 ----------
def fetch_public_hits(api, scanner, limit=PUBLIC_LIMIT, timeout=60):
    url = '%s/scan-performance-public?%s' % (api.rstrip('/'), urllib.parse.urlencode({'scanner': scanner, 'horizons': '1', 'limit': limit}))
    body = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=timeout).read().decode('utf-8'))
    data = body.get('data') if isinstance(body, dict) and isinstance(body.get('data'), dict) else body
    return (data or {}).get('hits') or []


def research_db_hits(path):
    if not path or not os.path.exists(path):
        return []
    db = la.open_ro(path)
    try:
        return [{'scanDate': r[0], 'scanner': r[1], 'code': r[2], 'name': r[3], 'score': r[4], 'basePrice': r[5]}
                for r in db.execute('SELECT scan_date, scanner, code, name, score, base_price FROM candidates')]
    except Exception:
        return []
    finally:
        db.close()


def collect_hits(api=None, hits_file=None, research_db=None, fetcher=fetch_public_hits):
    """여러 출처의 포착 이력을 (scanDate, scanner, code) 로 합친다. 출처별 건수·잘림 가능성·실패 원인을 report 에 남긴다."""
    report = {'sources': {}, 'warnings': []}
    allhits = {}

    def add(hits, src):
        n = 0
        for h in hits:
            code = str(h.get('code') or '')
            if not (len(code) == 6 and code.isdigit()) or not h.get('scanDate'):
                continue
            key = (h['scanDate'], norm_scanner(h.get('scanner')), code)
            cur = allhits.setdefault(key, {'scanDate': h['scanDate'], 'scanner': key[1], 'code': code, 'name': h.get('name'),
                                           'basePrice': h.get('basePrice'), 'score': h.get('score'), 'sources': []})
            if src not in cur['sources']:
                cur['sources'].append(src)
            if not cur.get('basePrice') and h.get('basePrice'):
                cur['basePrice'] = h['basePrice']
            n += 1
        return n

    if hits_file:
        data = json.load(open(hits_file, encoding='utf-8'))
        rows = data.get('hits') if isinstance(data, dict) and 'hits' in data else (data.get('data', {}).get('hits') if isinstance(data, dict) and isinstance(data.get('data'), dict) else data)
        report['sources']['hits_file'] = add(rows or [], 'hits_file')
    if research_db:
        report['sources']['research_db'] = add(research_db_hits(research_db), 'research_db')
    if api:
        for s in CORE:
            try:
                rows = fetcher(api, 'pattern:%s' % s)
                report['sources']['api:%s' % s] = add(rows, 'api')
                if len(rows) >= PUBLIC_LIMIT:
                    report['warnings'].append('API 응답이 상한(%d)에 닿아 %s 의 오래된 포착이 잘렸을 수 있다(--hits-file 로 전체 이력을 주면 해결)' % (PUBLIC_LIMIT, s))
            except Exception as exc:
                report['sources']['api:%s' % s] = 'FAIL:%s' % type(exc).__name__
    hits = sorted(allhits.values(), key=lambda h: (h['scanDate'], h['scanner'], h['code']))
    report['total'] = len(hits)
    report['by_scanner'] = {k: sum(1 for h in hits if h['scanner'] == k) for k in sorted({h['scanner'] for h in hits})}
    report['date_range'] = [hits[0]['scanDate'], hits[-1]['scanDate']] if hits else None
    return hits, report


# ---------- 진입 후보 ----------
def plan_entries(hits, calendar, hold_days=4):
    """포착 -> 다음 거래일 진입 후보. 같은 (종목, 진입일)은 하나로 합치고 검색기 목록을 보존한다. 제외 사유별 건수를 센다."""
    ex = defaultdict(int)
    merged = {}
    last = calendar[-1]
    for h in hits:
        if h['scanner'] not in CORE:
            ex['ENTRY_TIMING_UNVERIFIED(%s)' % h['scanner']] += 1
            continue
        later = [d for d in calendar if d > h['scanDate']]
        if not later:
            ex['NO_NEXT_TRADING_DAY'] += 1
            continue
        days = later[:hold_days]
        if days[0] > last:
            ex['ENTRY_DAY_NOT_YET'] += 1
            continue
        key = (h['code'], days[0])
        if key in merged:
            m = merged[key]
            if h['scanner'] not in m['scanners']:
                m['scanners'].append(h['scanner'])
            ex['DUPLICATE_MERGED'] += 1
            continue
        merged[key] = {'scan_date': h['scanDate'], 'entry_day': days[0], 'days': days, 'code': h['code'], 'name': h.get('name'),
                       'scanner': h['scanner'], 'scanners': [h['scanner']], 'base': h.get('basePrice'), 'score': h.get('score')}
    return list(merged.values()), dict(ex)


def attach_paths(plans, minbars_dir, cache_dir, calendar):
    """분봉이 있는 진입만 남기고(없으면 제외 사유 기록) 일봉 구조·순위 점수를 붙인다."""
    ex = defaultdict(int)
    usable = []
    last = calendar[-1]
    for e in plans:
        path = xs.build_path(minbars_dir, e)
        have = {p[0] for p in path}
        if e['entry_day'] not in have:
            ex['MINUTE_BARS_MISSING_ENTRY_DAY'] += 1
            continue
        expected = [d for d in e['days'] if d <= last]
        if any(d not in have for d in expected):
            ex['MINUTE_BARS_MISSING_OR_HALTED_HOLD_DAY'] += 1
            continue
        first = next((p for p in path if p[0] == e['entry_day'] and p[1] == xs.EVAL_FIRST), None)
        if len(path) < 30 or not first:
            ex['NO_0901_BAR'] += 1
            continue
        if e.get('base') and first[2] >= float(e['base']) * xs.GAP_UP_LIMIT:
            ex['GAP_UP_OVER_2PCT'] += 1
            continue
        daily = xs.load_daily(cache_dir, e['code'])
        if not daily:
            ex['NO_DAILY_CACHE'] += 1
            continue
        e['path'] = path
        e['entry_price'] = first[2]
        e['rank_score'] = xc.rank_one(daily, e['scan_date'])
        sr.enrich_entry(e, daily)
        usable.append(e)
    return usable, dict(ex)


def minute_data_range(entries):
    days = sorted({e['entry_day'] for e in entries})
    return [days[0], days[-1]] if days else None


# ---------- 계좌(슬롯) 시뮬레이션 ----------
def slot_sim(entries, trades, slots=SLOTS):
    """같은 후보 흐름에 동시 보유 상한(slots)을 적용: 진입 시각에 빈 슬롯이 있고 같은 종목을 안 들고 있으면 진입, 순위 높은 순.
    전략마다 청산 시각이 달라 슬롯 점유가 달라진다. 종목당 같은 금액으로 보고 거래별 순수익률의 합·평균을 낸다."""
    order = sorted(range(len(entries)), key=lambda i: (entries[i]['entry_day'], tuple(-x for x in (entries[i].get('rank_score') or (0, 0, 0, 0)))))
    open_pos = []                                     # (exit_key, code)
    taken, skipped = [], 0
    for i in order:
        e, t = entries[i], trades[i]
        start = (e['entry_day'], '0901')
        open_pos = [p for p in open_pos if p[0] > start]
        if len(open_pos) >= slots or any(p[1] == e['code'] for p in open_pos):
            skipped += 1
            continue
        open_pos.append(((t['exit_day'], t['exit_hhmm']), e['code']))
        taken.append(t)
    nets = [t['net_pct'] for t in taken]
    return {'taken': len(taken), 'skipped_no_slot': skipped, 'sum_net_pct': round(sum(nets), 2) if nets else 0.0,
            'mean_net_pct': round(sum(nets) / len(nets), 3) if nets else None, 'summary': xs.summarize(taken) if taken else {'n': 0}}


# ---------- 분석 ----------
def months_between(a, b):
    from datetime import date
    da, db_ = date.fromisoformat(a), date.fromisoformat(b)
    return (db_ - da).days / 30.44


def pick_representatives(rules_summary):
    """학습 구간 평균이 가장 높은 B_SR / C_SR 한 개씩(학습 20건 이상). 검증 구간에서만 A 와 비교한다(사후 선택 방지)."""
    out = {}
    for fam in ('B_SR', 'C_SR'):
        cands = [(v['train']['mean'], n) for n, v in rules_summary.items() if n.startswith(fam) and v['train'].get('n', 0) >= 20]
        out[fam] = max(cands)[1] if cands else None
    return out


def verdict(summary):
    """사전 고정 기준: 검증 100건 이상·3개월 이상·분봉 충족률 70% 이상이 아니면 '판정 보류'. 충족하면 대표 B/C 가
    검증에서 A_cycle 대비 평균 차이 95% 구간 하한 > 0, MDD·최악 거래가 A_cycle 보다 나쁘지 않을 때만 우세. 둘 다면 평균 차이가 큰 쪽."""
    v = summary['validation']
    reasons = []
    if v['n'] < MIN_VALID:
        reasons.append('검증 구간 %d건 < %d건' % (v['n'], MIN_VALID))
    if v['months'] is None or v['months'] < MIN_VALID_MONTHS:
        reasons.append('검증 기간 %s개월 < %d개월' % ('-' if v['months'] is None else '%.1f' % v['months'], MIN_VALID_MONTHS))
    if summary['coverage']['usable_pct'] is not None and summary['coverage']['usable_pct'] < 70:
        reasons.append('분봉 충족률 %.0f%% < 70%%' % summary['coverage']['usable_pct'])
    if reasons:
        return {'conclusion': '판정 보류', 'reasons': reasons}
    base = summary['rules'][BASELINE]['valid']
    if not base.get('n'):
        return {'conclusion': '판정 보류', 'reasons': ['검증 구간 A_cycle 결과 없음']}
    wins = []
    for fam, name in summary['representatives'].items():
        if not name:
            continue
        r = summary['rules'][name]['valid']
        d = summary['paired_valid_vs_A_cycle'].get(name)
        if r.get('n') and d and d['lo'] > 0 and r['mdd'] <= base['mdd'] and r['worst'] >= base['worst']:
            wins.append((d['mean_diff'], fam, name))
    if not wins:
        return {'conclusion': 'A 유지', 'reasons': ['대표 B_SR/C_SR 중 검증에서 A 대비 유의한 개선과 위험 악화 없음을 함께 만족한 것이 없다']}
    wins.sort(reverse=True)
    return {'conclusion': '%s 연구상 우세' % wins[0][1], 'reasons': ['%s: 검증 평균차 %+.2f%%p (95%% 하한 > 0), MDD·최악 악화 없음' % (wins[0][2], wins[0][0])]}


def lookahead_audit(entries, rules, trades_by_rule, sample=60):
    """미래 자료 사용 점검: 청산 다음 봉까지만 남기고 경로를 잘라 같은 규칙을 다시 돌렸을 때 청산 사유·시각이 같아야 한다.
    판정이 청산 이후 자료에 의존했다면(룩어헤드) 잘린 경로에서 결과가 달라진다. HORIZON 청산은 경로 끝이 청산이라 제외."""
    out = {}
    step = max(1, len(entries) // sample)
    for name, factory in rules.items():
        checked = bad = 0
        for i in range(0, len(entries), step):
            e, t = entries[i], trades_by_rule[name][i]
            if t['reason'] == 'HORIZON':
                continue
            idx = next((k for k, p in enumerate(e['path']) if p[0] == t['exit_day'] and p[1] == t['exit_hhmm']), None)
            if idx is None:
                continue
            cut = dict(e, path=e['path'][:idx + 1])
            ctx = {'atr_pct': e['atr_pct'], 'daily_lows': e['daily_lows'], 'daily_highs': e['daily_highs']}
            t2 = xs.simulate(cut, factory, ctx)
            checked += 1
            if (t2['reason'], t2['exit_day'], t2['exit_hhmm']) != (t['reason'], t['exit_day'], t['exit_hhmm']):
                bad += 1
        out[name] = {'checked': checked, 'mismatch': bad}
    return out


def sufficiency(hits_report, plan_ex, path_ex, entries, cut):
    """검색기별로 어느 기간·자료가 모자라는지: 포착 -> 진입 후보 -> 사용 가능 진입 -> 검증 구간 건수와 목표 대비 부족분."""
    rows = {}
    for s in CORE:
        mine = [e for e in entries if s in e['scanners']]
        valid = [e for e in mine if e['entry_day'] > cut]
        vdays = sorted({e['entry_day'] for e in valid})
        rows[s] = {'hits': (hits_report.get('by_scanner') or {}).get(s, 0), 'usable_entries': len(mine), 'valid_entries': len(valid),
                   'valid_months': round(months_between(vdays[0], vdays[-1]), 2) if len(vdays) > 1 else None,
                   'short_of_30_per_scanner': max(0, sr.MIN_GROUP_N - len(mine)), 'short_of_100_valid': max(0, MIN_VALID - len(valid))}
    return rows


def analyze(entries, cache_dir, plan_ex, path_ex, hits_report, hold_days):
    rules = sr.make_sr_rules()
    res = {n: [] for n in rules}
    for e in entries:
        ctx = {'atr_pct': e['atr_pct'], 'daily_lows': e['daily_lows'], 'daily_highs': e['daily_highs']}
        for n, f in rules.items():
            res[n].append(xs.simulate(e, f, ctx))
    cut = xs.split_days(entries)
    S = {'basis': '검색기 포착 이력 가상 백테스트(실제 매수 아님). 진입=다음 거래일 09:01 시가+0.1%%, 보유 최대 %d거래일(미청산 시 HORIZON), 비용 왕복 0.7%%, 청산 슬리피지 0.15%%.' % hold_days,
         'entries': len(entries), 'split_day': cut, 'hits': hits_report,
         'exclusions': {'plan': plan_ex, 'path': path_ex},
         'coverage': {}, 'rules': {}}
    raw = hits_report.get('total') or 0
    core_raw = sum(v for k, v in (hits_report.get('by_scanner') or {}).items() if k in CORE)
    S['coverage'] = {'core_hits': core_raw, 'usable_pct': round(len(entries) / max(1, core_raw) * 100, 1) if core_raw else None,
                     'minute_data_entry_range': minute_data_range(entries),
                     'duplicate_overlap_pct': round(plan_ex.get('DUPLICATE_MERGED', 0) / max(1, core_raw) * 100, 1)}
    for n, tr in res.items():
        S['rules'][n] = {'all': xs.summarize(tr), 'train': xs.summarize([t for t in tr if t['entry_day'] <= cut]),
                         'valid': xs.summarize([t for t in tr if t['entry_day'] > cut])}
    vi = [i for i, e in enumerate(entries) if e['entry_day'] > cut]
    vdays = sorted({entries[i]['entry_day'] for i in vi})
    S['validation'] = {'n': len(vi), 'from': vdays[0] if vdays else None, 'to': vdays[-1] if vdays else None,
                       'months': months_between(vdays[0], vdays[-1]) if len(vdays) > 1 else None}
    S['paired_vs_A_cycle'] = {n: xs.paired_bootstrap(res[BASELINE], tr) for n, tr in res.items() if n != BASELINE}
    S['paired_valid_vs_A_cycle'] = ({n: xs.paired_bootstrap([res[BASELINE][i] for i in vi], [tr[i] for i in vi]) for n, tr in res.items() if n != BASELINE}
                                    if len(vi) >= 5 else {})
    S['representatives'] = pick_representatives(S['rules'])
    S['representatives']['A'] = 'A_cycle'
    # 검색기별(겹치는 포착은 각 검색기에 모두 포함) - 30건 미만이면 판단 보류
    by = {}
    for s in CORE:
        idx = [i for i, e in enumerate(entries) if s in e['scanners']]
        by[s] = {'n': len(idx)}
        if len(idx) < sr.MIN_GROUP_N:
            by[s]['status'] = '표본 부족(<%d) - 독립 규칙 판단 보류' % sr.MIN_GROUP_N
            continue
        by[s]['rules'] = {n: xs.summarize([tr[i] for i in idx]) for n, tr in res.items()}
        by[s]['valid_rules'] = {n: xs.summarize([tr[i] for i in idx if entries[i]['entry_day'] > cut]) for n, tr in res.items()}
        by[s]['best_by_mean'] = max(((v['mean'], n) for n, v in by[s]['rules'].items()), default=(None, None))[1]
    S['by_scanner'] = by
    S['common_rule_vs_per_scanner'] = ('검색기별 최적 규칙이 서로 다른지는 표본 30건 이상 검색기가 2개 이상일 때만 판단 가능' if sum(1 for v in by.values() if 'rules' in v) < 2
                                      else {s: v.get('best_by_mean') for s, v in by.items() if 'rules' in v})
    import exit_sr_local as loc
    S['walk_forward'] = loc.walk_forward(entries, res)
    S['regimes'] = loc.regimes(entries, res, cache_dir)
    S['slot_sim'] = {n: slot_sim(entries, tr) for n, tr in res.items() if n in ('A', BASELINE, S['representatives'].get('B_SR'), S['representatives'].get('C_SR'))}
    S['sufficiency'] = sufficiency(hits_report, plan_ex, path_ex, entries, cut)
    for sname, v in S['by_scanner'].items():
        if 'rules' not in v:
            continue
        idx = [i for i, e in enumerate(entries) if sname in e['scanners']]
        vidx = [i for i in idx if entries[i]['entry_day'] > cut]
        v['paired_vs_A_cycle'] = {n: xs.paired_bootstrap([res[BASELINE][i] for i in idx], [res[n][i] for i in idx]) for n in (S['representatives'].get('B_SR'), S['representatives'].get('C_SR')) if n}
        v['paired_valid_vs_A_cycle'] = ({n: xs.paired_bootstrap([res[BASELINE][i] for i in vidx], [res[n][i] for i in vidx]) for n in (S['representatives'].get('B_SR'), S['representatives'].get('C_SR')) if n}
                                        if len(vidx) >= 5 else {})
    S['audits'] = {'lookahead': lookahead_audit(entries, rules, res),
                   'survivorship': {'excluded_no_daily_cache': path_ex.get('NO_DAILY_CACHE', 0), 'excluded_minute_missing_or_halted': path_ex.get('MINUTE_BARS_MISSING_OR_HALTED_HOLD_DAY', 0) + path_ex.get('MINUTE_BARS_MISSING_ENTRY_DAY', 0),
                                    'note': '일봉·분봉이 없는 종목(상장폐지·거래정지·자료 누락)은 평가에서 빠진다. 이런 종목은 대체로 손실이 컸을 가능성이 있어 전략 간 비교보다 절대 성과를 낙관적으로 만들 수 있다. 제외 건수를 위에 그대로 적는다.'},
                   'design': ['지지·저항은 판정 시점까지 확정된 봉만 사용(5분봉 저점은 우측 2봉이 닫힌 뒤 확정, 일봉 구조는 scan_date까지)', '체결은 판정 다음 분봉 시가', '대표 B/C 선택은 학습 구간만 사용']}
    S['verdict'] = verdict(S)
    return S, res


def render(S):
    def pct(x):
        return '-' if x is None else '%+.2f%%' % x
    v = S['validation']
    L = ['# 검색기 포착 이력 전체 가상 백테스트 결과', '', '- ' + S['basis'], '- 포착 이력: %s, 4종 포착 %s건 → 진입 %d건 (중복 합침 %s%%, 분봉 충족률 %s%%). 분봉 보유 진입일 범위 %s.' % (
        S['hits'].get('date_range'), S['coverage']['core_hits'], S['entries'], S['coverage']['duplicate_overlap_pct'], S['coverage']['usable_pct'], S['coverage']['minute_data_entry_range']),
        '- 제외: ' + json.dumps(S['exclusions'], ensure_ascii=False), '- 경고: ' + ('; '.join(S['hits']['warnings']) or '없음'),
        '- 학습/검증 분리일 %s, 검증 %d건 %s~%s (%s개월)' % (S['split_day'], v['n'], v['from'], v['to'], '-' if v['months'] is None else '%.1f' % v['months']), '',
        '## 최종 판정: **%s**' % S['verdict']['conclusion']] + ['- ' + r for r in S['verdict']['reasons']]
    L += ['', '## 자료 충족도 (먼저 읽기)', '', '| 검색기 | 포착 | 사용 가능 진입 | 확보율 | 검증 진입 | 검증 개월 | 30건까지 부족 | 검증 100건까지 부족 |', '|---|---:|---:|---:|---:|---:|---:|---:|']
    for sname, r in S['sufficiency'].items():
        L.append('| %s | %d | %d | %s | %d | %s | %d | %d |' % (sname, r['hits'], r['usable_entries'], '-' if not r['hits'] else '%.0f%%' % (r['usable_entries'] / r['hits'] * 100), r['valid_entries'],
                                                              '-' if r['valid_months'] is None else '%.1f' % r['valid_months'], r['short_of_30_per_scanner'], r['short_of_100_valid']))
    reps = S['representatives']
    L += ['', '## 전체 검색기 — A / B_SR / C_SR (대표 설정은 학습 구간 평균 기준 선택)', '',
          '| 구분 | 규칙 | 건수 | 평균 | 중앙값 | 승률 | 손익비 | MDD(%p) | 최악 | 평균이익반납 | 손절후회복 | 청산후+3%추가상승 | 검증 평균 | 검증 A_cycle 대비 [95%] |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|']
    for label, name in (('A(운영 사이클)', 'A_cycle'), ('A(서로 다른 봉 2개)', 'A'), ('B_SR', reps.get('B_SR')), ('C_SR', reps.get('C_SR'))):
        if not name:
            continue
        r = S['rules'][name]
        a = r['all']
        d = S['paired_valid_vs_A_cycle'].get(name)
        L.append('| %s | %s | %d | %s | %s | %.0f%% | %s | %.1f | %s | %s | %s | %s | %s | %s |' % (
            label, name, a['n'], pct(a['mean']), pct(a['median']), a['win'], '-' if a['payoff'] is None else '%.2f' % a['payoff'], a['mdd'], pct(a['worst']),
            '%.2f%%p' % a['giveback_mean'], '-' if a['stop_recovered'] is None else '%.0f%%' % a['stop_recovered'],
            '-' if a['early_exit_missed'] is None else '%.0f%%' % a['early_exit_missed'], pct(r['valid'].get('mean')),
            '기준' if name == 'A_cycle' else ('-' if not d else '%+.2f [%+.2f, %+.2f]' % (d['mean_diff'], d['lo'], d['hi']))))
    L += ['', '## 검색기별', '']
    for s, v in S['by_scanner'].items():
        L.append('### %s — %d건%s' % (s, v['n'], ' (%s)' % v['status'] if 'status' in v else ''))
        if 'rules' in v:
            L += ['| 규칙 | 평균 | 중앙값 | 승률 | MDD | 최악 | 검증 평균 | A_cycle 대비 전체 [95%] | A_cycle 대비 검증 [95%] |', '|---|---:|---:|---:|---:|---:|---:|---|---|']
            for n in ('A_cycle', reps.get('B_SR'), reps.get('C_SR')):
                if n and v['rules'][n].get('n'):
                    r = v['rules'][n]
                    ci = lambda d: '기준' if n == 'A_cycle' else ('-' if not d else '%+.2f [%+.2f, %+.2f]' % (d['mean_diff'], d['lo'], d['hi']))
                    L.append('| %s | %s | %s | %.0f%% | %.1f | %s | %s | %s | %s |' % (n, pct(r['mean']), pct(r['median']), r['win'], r['mdd'], pct(r['worst']), pct(v['valid_rules'][n].get('mean')),
                                                                                  ci(v.get('paired_vs_A_cycle', {}).get(n)), ci(v.get('paired_valid_vs_A_cycle', {}).get(n))))
        L.append('')
    L += ['## 동시 보유 %d슬롯 반영 — 연구용 가정(실제 운영 엔진의 보유 종목 수 제한은 해제된 상태이므로 실제 계좌 재현이 아님)' % SLOTS, '', '| 규칙 | 진입 | 슬롯부족 건너뜀 | 거래당 평균 | 순수익 합(%p) | MDD |', '|---|---:|---:|---:|---:|---:|']
    for n, r in S['slot_sim'].items():
        L.append('| %s | %d | %d | %s | %s | %s |' % (n, r['taken'], r['skipped_no_slot'], pct(r['mean_net_pct']), r['sum_net_pct'], '-' if not r['summary'].get('n') else '%.1f' % r['summary']['mdd']))
    L += ['', '## 탐색 결과 (채택 판정 아님)', '- 아래는 확보한 데이터에서 어느 쪽이 높게 나왔는지의 **탐색 결과**이며 최종 판정과 별개다. 표본·기간이 기준에 못 미치면 이 숫자로 승자를 선언하지 않는다.']
    for fam in ('B_SR', 'C_SR'):
        n = reps.get(fam)
        if not n:
            L.append('- %s: 학습 구간 20건 미만이라 대표 설정을 고르지 못했다' % fam)
            continue
        dv = S['paired_valid_vs_A_cycle'].get(n)
        da = S['paired_vs_A_cycle'].get(n)
        rv = S['rules'][n]['valid']
        L.append('- %s(%s): 검증 %s건 A_cycle 대비 %s / 전체 %s건 %s. MDD %s vs A_cycle %s, 최악 %s vs %s.' % (
            fam, n, rv.get('n', 0), '%+.2f [%+.2f, %+.2f]%%p' % (dv['mean_diff'], dv['lo'], dv['hi']) if dv else '계산 불가(검증 5건 미만)',
            S['rules'][n]['all']['n'], '%+.2f [%+.2f, %+.2f]%%p' % (da['mean_diff'], da['lo'], da['hi']) if da else '-',
            '-' if not rv.get('n') else '%.1f' % rv['mdd'], '-' if not S['rules'][BASELINE]['valid'].get('n') else '%.1f' % S['rules'][BASELINE]['valid']['mdd'],
            '-' if not rv.get('n') else pct(rv['worst']), '-' if not S['rules'][BASELINE]['valid'].get('n') else pct(S['rules'][BASELINE]['valid']['worst'])))
    L.append('- 신뢰구간이 0을 포함하면 A와 구분되지 않는다. 13개 설정 중 학습 최고를 고르는 구조라 다중비교로 좋아 보일 수 있고, 표본이 작으면 구간이 매우 넓다.')
    la_ = S['audits']['lookahead']
    sv = S['audits']['survivorship']
    L += ['', '## 점검: 미래 데이터·생존 편향', '- 룩어헤드 감사(경로를 청산 다음 봉에서 잘라 재실행했을 때 결과 불일치): ' + ', '.join('%s %d/%d' % (n, v['mismatch'], v['checked']) for n, v in la_.items() if v['checked']) + ' (불일치 0이어야 정상)',
          '- 생존 편향: ' + sv['note'] + ' (일봉 없음 %d건, 분봉 누락·거래정지 의심 %d건)' % (sv['excluded_no_daily_cache'], sv['excluded_minute_missing_or_halted']),
          '- 설계: ' + ' / '.join(S['audits']['design'])]
    L += ['', '## 6개 질문', '']
    a, b, c = (S['rules'].get(BASELINE, {}), S['rules'].get(reps.get('B_SR') or '', {}), S['rules'].get(reps.get('C_SR') or '', {}))
    def vm(r):
        return pct((r.get('valid') or {}).get('mean'))
    L += ['1. 검증 구간 순수익률(평균): A_cycle %s / %s %s / %s %s — 판정은 위 최종 판정을 따른다(표본·기간 미달이면 보류).' % (vm(a), reps.get('B_SR'), vm(b), reps.get('C_SR'), vm(c)),
          '2. 위험: MDD·최악은 위 표. 평균이 높아도 MDD·최악이 A_cycle보다 크면 우세로 치지 않는다(판정 기준에 포함).',
          '3. 손절 후 재상승 비율: 표의 "손절후회복" 열(낮을수록 흔들림에 덜 잘림).',
          '4. 이른 익절 문제: 표의 "청산후+3%추가상승"·"평균이익반납" 열.',
          '5. 검색기별 규칙 필요성: ' + (json.dumps(S['common_rule_vs_per_scanner'], ensure_ascii=False) if isinstance(S['common_rule_vs_per_scanner'], dict) else S['common_rule_vs_per_scanner']) + ' (표본 30건 미만은 독립 규칙 금지, 공통 규칙 성능을 먼저 본다).',
          '6. 주문·예산·동시 보유 반영: 위 슬롯 표. 실제 원장 기반 결과는 RESULT.md 에 따로 있다.', '',
          '## 한계', '- 포착 이력 시작일 이전·분봉 보유 기간 밖은 평가하지 못한다. 일봉·5분봉으로 대체하지 않았다.', '- 진입 09:01 일괄 가정, 보유 최대 %d거래일, 4종 외 검색기와 9Pay A/B 장중 단타는 포함하지 않았다(9Pay A/B는 과거 신호 이력 파일이 있을 때 별도).' % 4,
          '- 같은 날 같은 업종·테마 종목은 상관되어 있다. 신뢰구간은 진입일 단위 재표집이라 일 단위 상관은 반영하지만 업종 상관은 반영하지 않는다.']
    return '\n'.join(L)
