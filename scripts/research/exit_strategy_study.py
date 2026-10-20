# -*- coding: utf-8 -*-
"""시가 중심 매수 종목의 매도 전략 A(현재 엔진)·B(시초 가격 구조)·C(ATR) 비교 연구(연구용, 실계좌 규칙 변경 없음 - 2026-10-18).

같은 진입(종목·시각·진입 가능 가격)에 매도 규칙만 바꿔 비교한다. 진입은 실계좌 엔진 재현이다(exit_strategy_collect.py):
전날 밤 후보 -> 엔진 순위 -> 다음 날 09:01 첫 분봉의 시가로 진입(엔진은 09:00~10:00 사이 직전 1분봉 종가로 지정가 매수) ->
가격이 후보 기준가의 +2% 이상이면 건너뜀(GAP_UP_OVER_2PCT) -> 하루 최대 3종목.
매도 판정은 분봉 종가(엔진의 '1분봉 종가' 사이클)로 하고, **체결은 다음 분봉 시가 + 슬리피지**로 가정한다(신호 가격에 체결된다고 가정하지 않는다.
갭 하락은 갭 이후 첫 분봉 시가로 체결된다). 판정은 정규장 09:01~15:20 분봉에서만 한다(엔진 거래 구간 09:00~15:20과 같다).
보유 기간은 진입일 포함 hold_days(기본 4)일로 자른다. 그때까지 청산 신호가 없으면 마지막 분봉 종가로 강제 청산(`HORIZON`)한다 - 모든 전략에 같다.
비용: 왕복 COST_PCT(엔진 허용치 0.7%) + 슬리피지(매수 0.1%·시장가 매도 0.15%).

A: 일반 손절 -3%(연속 2회 확인)·비상 손절 -5%(즉시)·고점 +3% 이상 뒤 고점 대비 -2.5% 이탈(연속 2회 확인). live_engine.exit_decision 과 같다.
B: 시초 가격 구조. 비상 손절 -5%는 유지하고 일반 손절·추적을 구조 기준으로 바꾼다(기준: 시초 15분 저점+전일 저점 래칫, 또는 당일 VWAP).
C: ATR(최근 14거래일 평균 진폭, 진입 전날까지)에 따른 손절 폭 m·ATR(비상 손절 -5% 상한)과 고점 대비 k·ATR 추적.
B·C의 임계값은 가설이며 학습 기간에서 고른 뒤 검증 기간에서만 평가한다(과최적화 위험이 크므로 표본 수와 함께 읽는다).
"""
import json
import os
import sys
from collections import defaultdict

COST_PCT = 0.7
SLIP_BUY_PCT = 0.10
SLIP_SELL_PCT = 0.15
STOP_PCT = 3.0
EMERGENCY_PCT = 5.0
TRAIL_ARM_PCT = 3.0
TRAIL_PCT = 2.5
CONFIRM = 2
EVAL_FIRST, EVAL_LAST = '0901', '1520'
GAP_UP_LIMIT = 1.02
PER_STOCK = 300_000
MAX_PER_DAY = 3


# ---- 자료 ----
def load_day(minbars_dir, code, day):
    try:
        d = json.load(open(os.path.join(minbars_dir, '%s_%s.json' % (code, day)), encoding='utf-8'))
    except (OSError, ValueError):
        return []
    return d.get('bars') or []


def build_path(minbars_dir, entry):
    """진입 종목의 분봉 경로: [(day, hhmm, o, h, l, c, v)] 오름차순. 진입일 첫 분봉부터 hold_days 까지, 빈 날이 나오면 거기서 끝."""
    path = []
    for i, day in enumerate(entry['days']):
        bars = load_day(minbars_dir, entry['code'], day)
        if not bars:
            break
        path.extend((day,) + tuple(b) for b in bars)
    return path


def atr_pct(daily, scan_date, n=14):
    """scan_date(진입 전날)까지 최근 n거래일 평균 진폭(고저 폭, 전일 종가 갭 포함)을 종가 대비 %로. 부족하면 None."""
    rows = [r for r in daily if r['date'] <= scan_date]
    if len(rows) < n + 1:
        return None
    trs = []
    for prev, cur in zip(rows[-n - 1:-1], rows[-n:]):
        trs.append(max(cur['high'] - cur['low'], abs(cur['high'] - prev['close']), abs(cur['low'] - prev['close'])))
    last = rows[-1]['close']
    return sum(trs) / n / last * 100 if last else None


def load_daily(cache_dir, code):
    try:
        rows = json.load(open(os.path.join(cache_dir, code + '.json'), encoding='utf-8'))
    except (OSError, ValueError):
        return []
    return [{'date': r[0], 'open': r[1], 'high': r[2], 'low': r[3], 'close': r[4], 'volume': r[5]} for r in rows if r[1] and r[2] and r[3] and r[4]]


def prev_day_low(daily, day):
    rows = [r for r in daily if r['date'] < day]
    return rows[-1]['low'] if rows else None


# ---- 진입 ----
def select_entries(entries, minbars_dir, per_day=MAX_PER_DAY):
    """엔진 재현: 같은 진입일 안에서 순위 순으로 09:01 시가가 기준가의 +2% 미만이고 수량 1주 이상이면 진입, 하루 최대 per_day 종목."""
    by_day = defaultdict(list)
    for e in entries:
        by_day[e['entry_day']].append(e)
    out = []
    for day in sorted(by_day):
        taken = 0
        for e in sorted(by_day[day], key=lambda x: x['rank']):
            if taken >= per_day:
                break
            path = build_path(minbars_dir, e)
            if len(path) < 30 or path[0][1] != '0900':
                continue
            first = next((p for p in path if p[0] == day and p[1] == EVAL_FIRST), None)
            if not first:
                continue
            price = first[2]                      # 09:01 분봉 시가 = 09:00 분봉 종가에 가까운 가격
            base = e.get('base')
            if base and price >= float(base) * GAP_UP_LIMIT:
                continue
            if price <= 0 or PER_STOCK // int(price) < 1:
                continue
            item = dict(e)
            item['path'] = path
            item['entry_price'] = price
            out.append(item)
            taken += 1
    return out


# ---- 매도 규칙 ----
class Rule:
    """한 포지션의 청산 판정기. step(i, bar_state) -> 사유 또는 None. 판정은 i번째 분봉 종가까지의 정보만 쓴다."""
    name = 'rule'

    def __init__(self, entry_price, ctx):
        self.avg = entry_price
        self.peak = entry_price
        self.hits = 0
        self.ctx = ctx

    def gain(self, price):
        return (price / self.avg - 1) * 100

    def emergency(self, price):
        return self.gain(price) <= -EMERGENCY_PCT


class RuleA(Rule):
    name = 'A'

    def step(self, price, bar, day_state):
        self.peak = max(self.peak, price)
        if self.emergency(price):
            return 'STOP_EMERGENCY'
        breach = None
        if self.gain(price) <= -STOP_PCT:
            breach = 'STOP_3'
        elif (self.peak / self.avg - 1) * 100 >= TRAIL_ARM_PCT and price <= self.peak * (1 - TRAIL_PCT / 100):
            breach = 'TRAIL_2_5'
        self.hits = self.hits + 1 if breach else 0
        return breach if breach and self.hits >= CONFIRM else None


class RuleAOld(Rule):
    """2026-10-16 이전 엔진 규칙(순손익 기준): 손절 -5%, 익절 상한 +6%, +3% 도달 뒤 +3% 아래로 내려오면 매도. 시뮬레이터 재현 검증용."""
    name = 'A_old'

    def __init__(self, entry_price, ctx):
        super().__init__(entry_price, ctx)
        self.armed = False

    def step(self, price, bar, day_state):
        net = self.gain(price) - COST_PCT
        if net >= 3.0:
            self.armed = True
        if net <= -5.0:
            return 'STOP_NET5'
        if net >= 6.0:
            return 'TP_CAP'
        if self.armed and net < 3.0:
            return 'TP_FLOOR'
        return None


class RuleB(Rule):
    """시초 가격 구조 기반. ref: 'low15'(시초 15분 저점, 다음 날부터 전일 저점으로 래칫) | 'vwap'(당일 VWAP, 09:15부터).
    일반 손절은 기준선 아래 buf% 종가가 연속 K회일 때. trail=True 면 A 의 추적(+3% 도달 뒤 -2.5%, 연속 2회)을 같이 쓴다. 비상 손절 유지."""

    def __init__(self, entry_price, ctx, ref='low15', buf=0.5, k=3, trail=False):
        super().__init__(entry_price, ctx)
        self.ref, self.buf, self.k, self.trail = ref, buf, k, trail
        self.level = None
        self.trail_hits = 0
        self.name = 'B_%s_b%s_k%d%s' % (ref, buf, k, '_T' if trail else '')

    def step(self, price, bar, day_state):
        self.peak = max(self.peak, price)
        if self.emergency(price):
            return 'STOP_EMERGENCY'
        hhmm = bar[1]
        if self.ref == 'vwap':
            level = day_state['vwap'] if hhmm >= '0915' else None
        else:
            level = day_state['ref_low15']
            if day_state['day_index'] > 0 and day_state.get('prev_low'):
                level = max(level, day_state['prev_low'])
            if self.level is not None:                 # 래칫: 기준선은 내려가지 않는다
                level = max(level, self.level)
            self.level = level
        breach = level is not None and price < level * (1 - self.buf / 100)
        self.hits = self.hits + 1 if breach else 0
        if self.hits >= self.k:
            return 'STRUCT_BREAK'
        if self.trail:
            tb = (self.peak / self.avg - 1) * 100 >= TRAIL_ARM_PCT and price <= self.peak * (1 - TRAIL_PCT / 100)
            self.trail_hits = self.trail_hits + 1 if tb else 0
            if self.trail_hits >= CONFIRM:
                return 'TRAIL_2_5'
        return None


class RuleC(Rule):
    """ATR 기반: 손절 폭 min(m·ATR%, 비상 5%) 이하가 연속 2회, 고점이 +ATR% 이상이 된 뒤 고점 대비 k·ATR% 이탈이 연속 2회. 비상 손절 유지."""

    def __init__(self, entry_price, ctx, m=1.5, k=2.5):
        super().__init__(entry_price, ctx)
        atr = ctx.get('atr_pct') or 3.0
        self.atr, self.m, self.k = atr, m, k
        self.stop = min(m * atr, EMERGENCY_PCT - 0.01)
        self.name = 'C_m%s_k%s' % (m, k)

    def step(self, price, bar, day_state):
        self.peak = max(self.peak, price)
        if self.emergency(price):
            return 'STOP_EMERGENCY'
        breach = None
        if self.gain(price) <= -self.stop:
            breach = 'STOP_ATR'
        elif (self.peak / self.avg - 1) * 100 >= self.atr and price <= self.peak * (1 - self.k * self.atr / 100):
            breach = 'TRAIL_ATR'
        self.hits = self.hits + 1 if breach else 0
        return breach if breach and self.hits >= CONFIRM else None


def make_rules():
    rules = {'A': lambda p, c: RuleA(p, c)}
    for ref in ('low15', 'vwap'):
        for buf in (0.3, 0.7):
            for k in (2, 5):
                for trail in (False, True):
                    rules['B_%s_b%s_k%d%s' % (ref, buf, k, '_T' if trail else '')] = (
                        lambda p, c, ref=ref, buf=buf, k=k, trail=trail: RuleB(p, c, ref, buf, k, trail))
    for m in (1.0, 1.5, 2.0):
        for k in (1.5, 2.5, 3.5):
            rules['C_m%s_k%s' % (m, k)] = lambda p, c, m=m, k=k: RuleC(p, c, m, k)
    return rules


# ---- 시뮬레이션 ----
def simulate(entry, rule_factory, ctx):
    """진입 한 건에 규칙 하나를 적용한다. 반환: dict(exit_reason, entry, exit, ret_pct(비용 전·슬리피지 반영), net_pct, ...). 과거 정보만 쓴다."""
    path = entry['path']
    day0 = entry['entry_day']
    # 실제 체결 재현용(2026-10-21): entry_hhmm/entry_fill_price 가 있으면 그 분봉·체결가에서 진입한다. 없으면 기존처럼 09:01 시가.
    first_hhmm = entry.get('entry_hhmm', EVAL_FIRST)
    entry_idx = next(i for i, p in enumerate(path) if p[0] == day0 and p[1] == first_hhmm)
    entry_fill = entry.get('entry_fill_price') or path[entry_idx][2] * (1 + SLIP_BUY_PCT / 100)
    rule = rule_factory(path[entry_idx][2], ctx)
    rule.avg = entry_fill
    rule.peak = entry_fill
    days = []
    for p in path:
        if p[0] not in days:
            days.append(p[0])
    # 일별 상태: VWAP 누적, 시초 15분 저점, 전일 저점
    state = {}
    cum_pv = cum_v = 0.0
    low15 = None
    cur_day = None
    exit_idx, reason = None, None
    mfe_high, mae_low = entry_fill, entry_fill
    for i in range(entry_idx, len(path)):
        day, hhmm, o, h, l, c, v = path[i]
        if day != cur_day:
            cur_day = day
            cum_pv = cum_v = 0.0
            low15 = None
        typical = (h + l + c) / 3
        cum_pv += typical * v
        cum_v += v
        if hhmm < '0915':
            low15 = l if low15 is None else min(low15, l)
        di = days.index(day)
        # 시초 15분 저점: 당일 09:15 전에는 지금까지의 저점, 이후 고정. 전일 저점은 일봉 캐시(entry['prev_lows'])에서 온다.
        if day == day0:
            ref_low15 = low15 if hhmm < '0915' else state.get('ref_low15', low15)
            if hhmm >= '0915' and 'ref_low15' not in state:
                state['ref_low15'] = low15
                ref_low15 = low15
        else:
            ref_low15 = state.get('ref_low15', low15)
        mfe_high = max(mfe_high, h)
        mae_low = min(mae_low, l)
        if hhmm < EVAL_FIRST or hhmm > EVAL_LAST or i == entry_idx:
            continue
        day_state = {'vwap': cum_pv / cum_v if cum_v else c, 'ref_low15': ref_low15 or l, 'day_index': di, 'prev_low': entry.get('prev_lows', {}).get(day)}
        reason = rule.step(c, path[i], day_state)
        if reason and i + 1 < len(path):
            exit_idx = i + 1
            break
        reason = None
    if exit_idx is None:
        exit_idx = len(path) - 1
        exit_raw, reason = path[exit_idx][5], 'HORIZON'
    else:
        exit_raw = path[exit_idx][2]
    exit_fill = exit_raw * (1 - SLIP_SELL_PCT / 100)
    gross = (exit_fill / entry_fill - 1) * 100
    # 사후 경로: 청산 이후 같은 자료 안에서 더 오른/회복한 정도(보유 기간 제한 안의 값이라 하한이다)
    after_high = max([p[3] for p in path[exit_idx:]] or [exit_raw])
    return {'code': entry['code'], 'entry_day': day0, 'entry': entry_fill, 'exit': exit_fill, 'reason': reason, 'exit_day': path[exit_idx][0],
            'exit_hhmm': path[exit_idx][1], 'hold_days': days.index(path[exit_idx][0]), 'gross_pct': gross, 'net_pct': gross - COST_PCT,
            'mfe_pct': (mfe_high / entry_fill - 1) * 100, 'mae_pct': (mae_low / entry_fill - 1) * 100,
            'after_high_pct': (after_high / exit_fill - 1) * 100, 'recovered': bool(gross < 0 and after_high >= entry_fill),
            'trigger_price': path[exit_idx - 1][5] if reason != 'HORIZON' else exit_raw, 'exit_raw': exit_raw}


# ---- 지표 ----
def max_drawdown(returns):
    """거래 순서대로 쌓은 누적 순수익률(%p)의 최대 낙폭(%p)과 최대 연속 손실 횟수."""
    peak = cum = mdd = 0.0
    streak = best = 0
    for r in returns:
        cum += r
        peak = max(peak, cum)
        mdd = max(mdd, peak - cum)
        streak = streak + 1 if r < 0 else 0
        best = max(best, streak)
    return mdd, best


def summarize(trades):
    n = len(trades)
    if not n:
        return {'n': 0}
    nets = [t['net_pct'] for t in trades]
    wins = [x for x in nets if x > 0]
    losses = [x for x in nets if x <= 0]
    avg_win = sum(wins) / len(wins) if wins else 0.0
    avg_loss = sum(losses) / len(losses) if losses else 0.0
    ordered = sorted(trades, key=lambda t: (t['exit_day'], t['exit_hhmm']))
    mdd, streak = max_drawdown([t['net_pct'] for t in ordered])
    gains = [t for t in trades if t['mfe_pct'] > 0]
    giveback = [(t['mfe_pct'] - t['gross_pct']) for t in gains]
    sl = [t for t in trades if t['reason'] in ('STOP_3', 'STOP_EMERGENCY', 'STOP_ATR', 'STRUCT_BREAK')]
    profit_exit = [t for t in trades if t['reason'] in ('TRAIL_2_5', 'TRAIL_ATR')]
    srt = sorted(nets)
    return {
        'n': n, 'mean': sum(nets) / n, 'median': srt[n // 2], 'win': len(wins) / n * 100, 'avg_win': avg_win, 'avg_loss': avg_loss,
        'payoff': (avg_win / abs(avg_loss)) if avg_loss else None, 'mdd': mdd, 'max_streak': streak,
        'mfe_mean': sum(t['mfe_pct'] for t in trades) / n, 'mae_mean': sum(t['mae_pct'] for t in trades) / n,
        'giveback_mean': sum(giveback) / len(giveback) if giveback else 0.0,
        'early_exit_missed': (sum(1 for t in profit_exit if t['after_high_pct'] >= 3.0) / len(profit_exit) * 100) if profit_exit else None,
        'stop_recovered': (sum(1 for t in sl if t['recovered']) / len(sl) * 100) if sl else None,
        'stops': len(sl), 'profit_exits': len(profit_exit),
        'hold': {'same_day': sum(1 for t in trades if t['hold_days'] == 0), 'next_day': sum(1 for t in trades if t['hold_days'] == 1),
                 'later': sum(1 for t in trades if t['hold_days'] >= 2 and t['reason'] != 'HORIZON'), 'horizon': sum(1 for t in trades if t['reason'] == 'HORIZON')},
        'worst': min(nets), 'p5': srt[max(0, int(n * 0.05))],
        'gap_shortfall_max': max(((t['trigger_price'] - t['exit_raw']) / t['trigger_price'] * 100 for t in trades if t['reason'] not in ('HORIZON',)), default=0.0),
        'reasons': {r: sum(1 for t in trades if t['reason'] == r) for r in sorted({t['reason'] for t in trades})},
    }


def market_returns(cache_dir):
    """캐시 전 종목의 동일가중 일 수익률 {날짜: 수익률}. 시장 국면(진입 전 10거래일 누적 수익률의 부호) 구분용(지수가 아니라 대용값)."""
    sums, counts = defaultdict(float), defaultdict(int)
    for f in os.listdir(cache_dir):
        if not f.endswith('.json') or len(f) != 11:
            continue
        try:
            rows = json.load(open(os.path.join(cache_dir, f), encoding='utf-8'))
        except ValueError:
            continue
        prev = None
        for r in rows:
            if r[4] and prev:
                x = r[4] / prev - 1
                if abs(x) < 0.3:
                    sums[r[0]] += x
                    counts[r[0]] += 1
            prev = r[4] or prev
    return {d: sums[d] / counts[d] for d in sums if counts[d] > 200}


def prior_return(mkt, day, n=10):
    dates = sorted(d for d in mkt if d < day)[-n:]
    total = 1.0
    for d in dates:
        total *= 1 + mkt[d]
    return (total - 1) * 100


def paired_bootstrap(a_trades, x_trades, rounds=2000, seed=7):
    """같은 진입끼리 짝지은 순수익률 차이(x-a)의 평균과 진입일 단위 재표집 95% 구간. 표본이 작아 구간이 넓다."""
    import random
    rng = random.Random(seed)
    by_day = defaultdict(list)
    for ta, tx in zip(a_trades, x_trades):
        by_day[ta['entry_day']].append(tx['net_pct'] - ta['net_pct'])
    days = list(by_day)
    flat = [d for v in by_day.values() for d in v]
    means = []
    for _ in range(rounds):
        pick = [rng.choice(days) for _ in days]
        vals = [d for k in pick for d in by_day[k]]
        means.append(sum(vals) / len(vals))
    means.sort()
    return {'mean_diff': sum(flat) / len(flat), 'lo': means[int(rounds * 0.025)], 'hi': means[int(rounds * 0.975)]}


def split_days(entries, train_share=0.6):
    days = sorted({e['entry_day'] for e in entries})
    cut = days[int(len(days) * train_share) - 1] if len(days) > 1 else days[-1]
    return cut


def run(entries_path, minbars_dir, cache_dir, out_path):
    entries = json.load(open(entries_path, encoding='utf-8'))
    selected = select_entries(entries, minbars_dir)
    caches = {}
    for e in selected:
        daily = caches.setdefault(e['code'], load_daily(cache_dir, e['code']))
        e['prev_lows'] = {d: prev_day_low(daily, d) for d in e['days']}
        e['atr_pct'] = atr_pct(daily, e['scan_date'])
    rules = make_rules()
    results = {name: [] for name in rules}
    for e in selected:
        ctx = {'atr_pct': e['atr_pct']}
        for name, factory in rules.items():
            results[name].append(simulate(e, factory, ctx))
    cut = split_days(selected)
    out = {'entries': len(selected), 'days': len({e['entry_day'] for e in selected}), 'split_day': cut, 'rules': {}}
    for name, trades in results.items():
        out['rules'][name] = {'all': summarize(trades), 'train': summarize([t for t in trades if t['entry_day'] <= cut]),
                              'valid': summarize([t for t in trades if t['entry_day'] > cut])}
    # 규칙 밖 보조: ATR 구간별(변동성 큰 종목 vs 작은 종목) A 의 성과
    atrs = sorted(e['atr_pct'] for e in selected if e['atr_pct'])
    mid = atrs[len(atrs) // 2] if atrs else None
    if mid:
        out['atr_median'] = mid
        for name in ('A', 'C_m1.5_k2.5'):
            tr = results[name]
            lo = [t for t, e in zip(tr, selected) if e['atr_pct'] and e['atr_pct'] <= mid]
            hi = [t for t, e in zip(tr, selected) if e['atr_pct'] and e['atr_pct'] > mid]
            out.setdefault('by_atr', {})[name] = {'low_atr': summarize(lo), 'high_atr': summarize(hi)}
    # 학습 기간 평균이 가장 높은 B·C 한 개씩(표본 20건 이상)을 고르고, 검증 기간에서만 A 와 비교한다
    def best(prefix):
        cands = [(v['train']['mean'], n) for n, v in out['rules'].items() if n.startswith(prefix) and v['train'].get('n', 0) >= 20]
        return max(cands)[1] if cands else None
    picks = {'A': 'A', 'B_train_best': best('B_'), 'C_train_best': best('C_')}
    out['picks'] = picks
    mkt = market_returns(cache_dir)
    out['stability'] = {}
    for label, name in picks.items():
        if not name:
            continue
        tr = results[name]
        reg = {'up': [], 'down': []}
        weeks = defaultdict(list)
        for t, e in zip(tr, selected):
            reg['up' if prior_return(mkt, e['entry_day']) > 0 else 'down'].append(t)
            y, w, _ = __import__('datetime').date.fromisoformat(e['entry_day']).isocalendar()
            weeks['%d-W%02d' % (y, w)].append(t['net_pct'])
        out['stability'][label] = {'rule': name, 'regime': {k: summarize(v) for k, v in reg.items()},
                                   'weekly': {k: round(sum(v) / len(v), 2) for k, v in sorted(weeks.items())},
                                   'weeks_positive': sum(1 for v in weeks.values() if sum(v) > 0), 'weeks': len(weeks)}
    out['paired_vs_A'] = {name: paired_bootstrap(results['A'], results[name]) for name in results if name != 'A'}
    out['trades'] = {name: results[name] for name in ('A', 'C_m1.5_k2.5')}
    json.dump(out, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('entries', len(selected), 'days', out['days'], 'split', cut)


if __name__ == '__main__':
    run(*sys.argv[1:5])
