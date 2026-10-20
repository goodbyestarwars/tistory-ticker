# -*- coding: utf-8 -*-
"""지지·저항 기반 청산 연구 B_SR / C_SR vs 현재 엔진 A (연구용 읽기 전용, 2026-10-21).

실계좌 규칙·주문·장부·엔진을 건드리지 않는다. exit_strategy_study.py 의 진입 재현·체결 가정(판정=분봉 종가, 체결=다음 분봉 시가-슬리피지,
왕복 비용)을 그대로 쓰고 매도 규칙만 바꾼다. 모든 지지·저항은 **판정 시점까지 확정된 자료**로만 만든다.

지지 후보(진입 전 확정): 일봉 프랙탈 저점(scan_date까지, 좌우 2봉), 직전 거래일 저점, 당일 시초 15분 저점(09:15 이후 확정).
          진입 후 확정: 5분봉 프랙탈 저점(좌우 2봉이 닫힌 뒤에만 확정) 중 직전 확정 저점보다 높은 것(상승 저점) - 기준선은 내려가지 않는다(래칫).
저항 후보: 진입 전 일봉 프랙탈 고점 중 진입가 위. 5분봉 종가가 저항*(1+buf) 위로 2회 연속 마감하면 '돌파 확정'이고 그 가격이 지지로 전환된다.
확인 방식: bar1(1분봉 종가) / c5(5분봉 종가 1회) / c5x2(5분봉 종가 연속 2회).
B_SR: 구조 지지 이탈 시 청산(일반 손절은 지지선만, 비상 -5% 유지). 저항에서는 팔지 않는다. 지지 자료가 없으면 A.
C_SR: B_SR + 손실 한도를 -3% 이내로 제한(구조선이 -3%보다 아래면 -3%) + 저항 돌파 실패(고가가 저항에 닿았다가 5분봉 종가가 저항 아래로 2회 연속 마감)면 이익 구간에서 청산
      + 상승 저점이 확정돼 있으면 A 의 고정폭 추적(-2.5%)을 쓰지 않는다. atr=True 면 완충 폭을 max(buf, 0.3*ATR%)로 넓힌다(손실 한도는 그대로 -3%).
파라미터 목록은 사전에 고정했다(make_sr_rules). 학습 기간 최고 설정 선택은 다중비교 위험이 있으므로 표본 수와 함께 읽는다.
"""
import csv
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import exit_strategy_study as xs  # noqa: E402

MIN_GROUP_N = 30          # 검색기별 독립 판단에 필요한 최소 표본(미만이면 '표본 부족')
FRACTAL = 2


def fractal_levels(daily, scan_date, lookback=60):
    """scan_date(포함)까지의 일봉에서 프랙탈 저점·고점. 확정에 우측 2봉이 필요하므로 마지막 2봉은 후보가 아니다."""
    rows = [r for r in daily if r['date'] <= scan_date][-lookback:]
    lows, highs = [], []
    for i in range(FRACTAL, len(rows) - FRACTAL):
        win = rows[i - FRACTAL:i + FRACTAL + 1]
        if rows[i]['low'] == min(r['low'] for r in win) and sum(1 for r in win if r['low'] == rows[i]['low']) == 1:
            lows.append(rows[i]['low'])
        if rows[i]['high'] == max(r['high'] for r in win) and sum(1 for r in win if r['high'] == rows[i]['high']) == 1:
            highs.append(rows[i]['high'])
    return lows, highs


class SRRule(xs.Rule):
    """B_SR(hybrid=False) / C_SR(hybrid=True). 1분봉 종가가 들어올 때마다 5분봉을 직접 쌓는다(판정 시점 이후 자료는 보지 않는다)."""

    def __init__(self, entry_price, ctx, sup='combo', confirm='c5x2', buf=0.3, hybrid=False, atr=False):
        super().__init__(entry_price, ctx)
        self.sup, self.confirm, self.hybrid = sup, confirm, hybrid
        atr_pct = ctx.get('atr_pct')
        self.buf = max(buf, 0.3 * atr_pct) if atr and atr_pct else buf
        self.name = '%s_%s_%s%s' % ('C_SR' if hybrid else 'B_SR', sup, confirm, '_atr' if atr else '')
        lows, highs = ctx.get('daily_lows') or [], ctx.get('daily_highs') or []
        below = [x for x in lows if x < entry_price * 0.997]
        self.daily_support = max(below) if below else None
        self.resists = sorted(h for h in highs if h > entry_price * 1.003)
        self.fallback = xs.RuleA(entry_price, ctx)
        self.five, self.cur = [], None            # 닫힌 5분봉 [(h, l, c)], 진행 중 [bucket, h, l, c]
        self.swing = None                        # 확정된 상승 저점(래칫)
        self.flipped = None                      # 지지로 전환된 저항 가격
        self.above_cnt = 0
        self.fail_cnt = 0
        self.touched = None                      # 고가가 닿은 저항
        self.breach_cnt = 0

    def _close_bucket(self):
        b = self.cur
        self.five.append((b[1], b[2], b[3]))
        n = len(self.five)
        k = n - 1 - FRACTAL                      # 우측 2봉이 닫힌 뒤에야 k번째가 확정된다
        if k >= FRACTAL:
            win = self.five[k - FRACTAL:k + FRACTAL + 1]
            low = self.five[k][1]
            # 좌측 두 봉보다 낮고 우측 두 봉보다 높지 않으면(동률 허용) 저점으로 확정한다
            if all(low < x[1] for x in win[:FRACTAL]) and all(low <= x[1] for x in win[FRACTAL + 1:]) and low > self.avg * 0.97:
                if self.swing is None or low > self.swing:
                    self.swing = low

    def _level(self, day_state, hhmm):
        cands = []
        if self.sup in ('daily', 'combo') and self.daily_support:
            cands.append(self.daily_support)
        if self.sup in ('prev_low', 'combo') and day_state.get('prev_low') and day_state['prev_low'] < self.avg * 0.997:
            cands.append(day_state['prev_low'])
        if self.sup in ('low15', 'combo') and hhmm >= '0915' and day_state.get('ref_low15') and day_state['ref_low15'] < self.avg * 0.997:
            cands.append(day_state['ref_low15'])
        if self.sup in ('swing', 'combo') and self.swing:
            cands.append(self.swing)
        if self.flipped:
            cands.append(self.flipped)
        return max(cands) if cands else None

    def step(self, price, bar, day_state):
        self.peak = max(self.peak, price)
        if self.emergency(price):
            return 'STOP_EMERGENCY'
        day, hhmm, _o, high, low, close, _v = bar
        bucket = (day, hhmm[:2] + '%02d' % (int(hhmm[2:]) // 5 * 5))
        new5 = False
        if self.cur is None or self.cur[0] != bucket:
            if self.cur is not None:
                self._close_bucket()
                new5 = True
            self.cur = [bucket, high, low, close]
        else:
            self.cur[1], self.cur[2], self.cur[3] = max(self.cur[1], high), min(self.cur[2], low), close
        c5 = self.five[-1][2] if self.five else None   # 마지막으로 닫힌 5분봉 종가
        # 저항 처리(5분봉이 닫힐 때만)
        if new5 and c5 is not None:
            for r in self.resists:
                if self.five[-1][0] >= r and self.touched is None:
                    self.touched = r
            tgt = self.touched
            if tgt:
                self.above_cnt = self.above_cnt + 1 if c5 > tgt * (1 + self.buf / 100) else 0
                self.fail_cnt = self.fail_cnt + 1 if c5 < tgt * (1 - self.buf / 100) else 0
                if self.above_cnt >= 2 and not self.flipped:
                    self.flipped = tgt
                    self.touched = None
                    self.above_cnt = self.fail_cnt = 0
        level = self._level(day_state, hhmm)
        if level is None:
            return self.fallback_step(price, bar, day_state)
        stop_price = level * (1 - self.buf / 100)
        if self.hybrid:
            stop_price = max(stop_price, self.avg * 0.97)       # 손실 한도를 -3%보다 넓히지 않는다
        if self.confirm == 'bar1':
            breach = price < stop_price
            self.breach_cnt = self.breach_cnt + 1 if breach else 0
            hit = self.breach_cnt >= 1
        elif new5 and c5 is not None:
            self.breach_cnt = self.breach_cnt + 1 if c5 < stop_price else 0
            hit = self.breach_cnt >= (1 if self.confirm == 'c5' else 2)
        else:
            hit = False
        if hit:
            return 'SR_BREAK'
        if self.hybrid:
            if new5 and self.touched and self.fail_cnt >= 2 and self.gain(price) > 0:
                return 'RESIST_FAIL'
            if self.swing is None:                              # 구조(상승 저점)가 없을 때만 고정폭 추적을 쓴다
                tb = (self.peak / self.avg - 1) * 100 >= xs.TRAIL_ARM_PCT and price <= self.peak * (1 - xs.TRAIL_PCT / 100)
                self.hits = self.hits + 1 if tb else 0
                if self.hits >= xs.CONFIRM:
                    return 'TRAIL_2_5'
        return None

    def fallback_step(self, price, bar, day_state):
        self.fallback.avg, self.fallback.peak = self.avg, self.peak
        self.fallback.hits = self.hits
        r = self.fallback.step(price, bar, day_state)
        self.hits = self.fallback.hits
        return r


def make_sr_rules():
    rules = {'A': lambda p, c: xs.RuleA(p, c)}
    for sup in ('prev_low', 'low15', 'combo'):
        for confirm in ('bar1', 'c5', 'c5x2'):
            rules['B_SR_%s_%s' % (sup, confirm)] = lambda p, c, sup=sup, confirm=confirm: SRRule(p, c, sup, confirm)
    for confirm in ('c5', 'c5x2'):
        for atr in (False, True):
            rules['C_SR_combo_%s%s' % (confirm, '_atr' if atr else '')] = (
                lambda p, c, confirm=confirm, atr=atr: SRRule(p, c, 'combo', confirm, hybrid=True, atr=atr))
    return rules


def enrich_entry(entry, daily):
    """진입 전에 확정된 자료만으로 일봉 구조·ATR·전일 저점을 붙인다."""
    lows, highs = fractal_levels(daily, entry['scan_date'])
    entry['prev_lows'] = {d: xs.prev_day_low(daily, d) for d in entry['days']}
    entry['atr_pct'] = xs.atr_pct(daily, entry['scan_date'])
    entry['daily_lows'], entry['daily_highs'] = lows, highs
    return entry


def group_report(trades_by_rule, selected, key='scanner', min_n=MIN_GROUP_N):
    """검색기별 요약. 표본이 min_n 미만이면 평균을 내지 않고 '표본 부족'으로 표시한다(검색기별 독립 규칙 금지)."""
    groups = {}
    for i, e in enumerate(selected):
        groups.setdefault((e.get(key) or '출처 미확인').replace('pattern:', ''), []).append(i)
    out = {}
    for g, idx in groups.items():
        out[g] = {'n': len(idx)}
        if len(idx) < min_n:
            out[g]['status'] = '표본 부족(<%d) - 독립 규칙 판단 보류' % min_n
            continue
        out[g]['rules'] = {r: xs.summarize([tr[i] for i in idx]) for r, tr in trades_by_rule.items()}
    return out


def trade_diff_rows(trades_by_rule, selected):
    rows = []
    for i, e in enumerate(selected):
        a = trades_by_rule['A'][i]
        for name, tr in trades_by_rule.items():
            if name == 'A':
                continue
            t = tr[i]
            rows.append({'code': e['code'], 'name': e.get('name'), 'scanner': e.get('scanner') or '출처 미확인', 'entry_day': e['entry_day'],
                         'rule': name, 'a_reason': a['reason'], 'a_net': round(a['net_pct'], 2), 'x_reason': t['reason'], 'x_net': round(t['net_pct'], 2),
                         'diff': round(t['net_pct'] - a['net_pct'], 2), 'mfe': round(a['mfe_pct'], 2), 'mae': round(a['mae_pct'], 2),
                         'x_exit_day': t['exit_day'], 'x_exit_hhmm': t['exit_hhmm']})
    return rows


def run(entries_path, minbars_dir, cache_dir, out_prefix):
    entries = json.load(open(entries_path, encoding='utf-8'))
    selected = xs.select_entries(entries, minbars_dir)
    for e in selected:
        enrich_entry(e, xs.load_daily(cache_dir, e['code']))
    rules = make_sr_rules()
    results = {n: [] for n in rules}
    for e in selected:
        ctx = {'atr_pct': e['atr_pct'], 'daily_lows': e['daily_lows'], 'daily_highs': e['daily_highs']}
        for n, f in rules.items():
            results[n].append(xs.simulate(e, f, ctx))
    cut = xs.split_days(selected) if selected else None
    out = {'entries': len(selected), 'days': len({e['entry_day'] for e in selected}), 'split_day': cut, 'rules': {}, 'note': 'A와 같은 진입에 매도 규칙만 교체. 실계좌 무관.'}
    for n, tr in results.items():
        out['rules'][n] = {'all': xs.summarize(tr), 'train': xs.summarize([t for t in tr if t['entry_day'] <= cut]),
                           'valid': xs.summarize([t for t in tr if t['entry_day'] > cut])}
    out['paired_vs_A'] = {n: xs.paired_bootstrap(results['A'], tr) for n, tr in results.items() if n != 'A' and tr}
    out['by_scanner'] = group_report(results, selected)
    json.dump(out, open(out_prefix + '.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    rows = trade_diff_rows(results, selected)
    if rows:
        with open(out_prefix + '_trades.csv', 'w', encoding='utf-8-sig', newline='') as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0]))
            w.writeheader()
            w.writerows(rows)
    print('entries', len(selected), 'days', out['days'], 'split', cut)


if __name__ == '__main__':
    run(*sys.argv[1:5])
