# -*- coding: utf-8 -*-
"""역매공파 112 조건의 사후 성과 백테스트(연구용, 읽기 전용, 실전 연결 없음 - 2026-10-16 사용자 요청).

사용자가 소개한 기법(영상 설명)을 조건으로 옮겨 운영 VM의 일봉 DB(daily_prices)에서 신호 후 가격 경로를 잰다.
이 파일은 scripts/cloud-vm 밖에 둔다(자동 배포 대상 아님). DB는 읽기 전용(mode=ro)으로만 열고, 서버 부하를 줄이려고
종목 하나씩 읽어 처리한다(e2-micro 1GB). 실행: python3 yeokmaegongpa112_backtest.py <ohlc_snapshot.db> <excluded_codes.json> <out.json>

조건(모두 일봉 종가 확정 뒤 판단, 미래 정보 없음):
- 역배열: MA112 < MA224 < MA448 (엄격형 V1) 또는 MA112 < MA224 (완화형 V2, 448 데이터가 모자라 표본을 늘리려고)
- 매집봉: 최근 ACC_LOOKBACK 봉 안(신호일 포함)에 검색기와 같은 봉 하나 조건(거래량 직전 20일 평균 2.5배·몸통 2%·종가 위치 0.6·거래대금 30억원)
- 안착: 종가 > MA20 그리고 종가 > MA60, 그리고 공구리(바닥 지지): 최근 20봉 최저가가 그 앞 40봉 최저가의 98% 이상(신저가를 더 만들지 않음)
- 112일선 근접: |종가/MA112 - 1| <= NEAR_PCT
- 볼린저(20,2) 상단 근접(옵션 V3·V4): 종가가 상단선의 BB_MIN_RATIO 이상
- 기준선(V0): 112<224 + 112 근접만(매집봉·안착·공구리 없음) - 위 필터가 실제로 보태는 것이 있는지 비교하려고
신호는 종목당 COOLDOWN 봉에 한 번. 진입은 신호 다음 거래일 시가, 비용은 왕복 COST_PCT를 뺀다.
청산: 일봉 시가/고가/저가로 모사한다 - 같은 날 손절과 목표가 모두 닿으면 손절 우선(보수적), 시가가 손절·목표를 넘어 시작하면 시가 청산.
  R1 고정 손절 3.5% / 목표 +20%, R2 구조 손절(공구리 최저가 아래 0.5%, 손절폭 8% 초과는 진입 포기) / 목표 +20%,
  R3 종가가 112일선의 97%를 이탈하면 그날 종가 청산 / 목표 +20%, R0 손절 없이 목표 +20%만. 최대 보유 HOLD봉, 시간 청산은 종가.
한계: 현재 상장 종목만 있는 DB(상장폐지 종목 없음 = 생존 편향), 일봉이라 장중 순서를 모른다, 체결가·슬리피지 미반영.
"""

import json
import sqlite3
import sys
from collections import defaultdict

# ---- 조건 상수 ----
ACC_VOL_MULT = 2.5
ACC_MIN_BODY_PCT = 2.0
ACC_CLOSE_POS_MIN = 0.6
ACC_AMOUNT_MIN = 3_000_000_000
ACC_LOOKBACK = 30
NEAR_PCT = 0.05
BB_MIN_RATIO = 0.95
COOLDOWN = 10
HOLD = 40
COST_PCT = 0.7
STOP_FIXED = 0.035
TARGET = 0.20
STRUCT_MAX = 0.08
MA112_BREAK = 0.97
PENNY = 1000


def prefix(values):
    out = [0.0]
    for v in values:
        out.append(out[-1] + v)
    return out


def sma_at(pre, i, p):
    return (pre[i + 1] - pre[i + 1 - p]) / p if i + 1 >= p else None


def simulate(bars, i, rule, mas):
    """신호일 i, 다음 날 시가 진입. 반환 dict 또는 None(진입 포기)."""
    n = len(bars)
    if i + 1 >= n:
        return None
    entry = bars[i + 1][1]
    if not entry or entry <= 0:
        return None
    base_low = min(b[3] for b in bars[max(0, i - 19):i + 1])
    stop = None
    if rule == 'R1':
        stop = entry * (1 - STOP_FIXED)
    elif rule == 'R2':
        stop = base_low * 0.995
        if stop >= entry or (entry - stop) / entry > STRUCT_MAX:
            return None
    target = entry * (1 + TARGET)
    risk = (entry - stop) / entry if stop else None
    end = min(n - 1, i + HOLD)
    mfe, mae = 0.0, 0.0
    exit_price, kind, held = None, 'time', 0
    for k in range(i + 1, end + 1):
        o, h, l, c = bars[k][1], bars[k][2], bars[k][3], bars[k][4]
        held = k - i
        mfe = max(mfe, h / entry - 1)
        mae = min(mae, l / entry - 1)
        if stop is not None:
            if o <= stop:
                exit_price, kind = o, 'stop'
                break
            if l <= stop:
                exit_price, kind = stop, 'stop'
                break
        if o >= target:
            exit_price, kind = o, 'target'
            break
        if h >= target:
            exit_price, kind = target, 'target'
            break
        if rule == 'R3':
            m112 = sma_at(mas['p112'], k, 112)
            if m112 and c < m112 * MA112_BREAK:
                exit_price, kind = c, 'break112'
                break
    if exit_price is None:
        exit_price = bars[end][4]
        held = end - i
    ret = (exit_price / entry - 1) * 100
    return {'ret': ret, 'net': ret - COST_PCT, 'kind': kind, 'held': held, 'mfe': mfe * 100, 'mae': mae * 100,
            'risk': risk * 100 if risk else None}


def accumulation_flags(bars, vol_pre):
    """bars[i]가 매집봉 하나 조건을 만족하는가(volume_accumulation.find_accumulation_bar의 봉 하나 조건)."""
    n = len(bars)
    flags = [False] * n
    for i in range(20, n):
        d, o, h, l, c, v = bars[i]
        if o <= 0 or c <= 0 or h <= l or v is None:
            continue
        avg = (vol_pre[i] - vol_pre[i - 20]) / 20
        if avg <= 0 or v < ACC_VOL_MULT * avg or c <= o or (c / o - 1) * 100 < ACC_MIN_BODY_PCT:
            continue
        if (c - l) / (h - l) < ACC_CLOSE_POS_MIN or c * v < ACC_AMOUNT_MIN:
            continue
        flags[i] = True
    return flags


VARIANTS = (
    ('V0', '기준선: 112<224 + 112근접만'),
    ('V1', '엄격형: 112<224<448 + 매집봉 + 안착·공구리 + 112근접'),
    ('V2', '완화형: 112<224 + 매집봉 + 안착·공구리 + 112근접'),
    ('V3', 'V1 + 볼린저 상단 근접'),
    ('V4', 'V2 + 볼린저 상단 근접'),
)
RULES = ('R0', 'R1', 'R2', 'R3')


def scan_stock(code, rows, state_fn):
    """한 종목의 신호 목록 [(variant, i, info)] 반환."""
    n = len(rows)
    if n < 230:
        return []
    close = [r[4] for r in rows]
    vol = [float(r[5] or 0) for r in rows]
    pre = {p: prefix(close) for p in (20, 60, 112, 224, 448)}
    pre_sq = prefix([c * c for c in close])
    vol_pre = prefix(vol)
    acc = accumulation_flags(rows, vol_pre)
    acc_pre = prefix([1.0 if a else 0.0 for a in acc])
    mas = {'p112': pre[112]}
    last_signal = {v[0]: -10 ** 9 for v in VARIANTS}
    signals = []
    for i in range(223, n - 1):
        c = close[i]
        if c < PENNY:
            continue
        m112, m224 = sma_at(pre[112], i, 112), sma_at(pre[224], i, 224)
        if not (m112 < m224):
            continue
        near = abs(c / m112 - 1) <= NEAR_PCT
        if not near:
            continue
        m448 = sma_at(pre[448], i, 448) if i >= 447 else None
        strict = m448 is not None and m224 < m448
        m20, m60 = sma_at(pre[20], i, 20), sma_at(pre[60], i, 60)
        settled = c > m20 and c > m60
        has_acc = acc_pre[i + 1] - acc_pre[max(0, i + 1 - ACC_LOOKBACK)] > 0
        low20 = min(r[3] for r in rows[i - 19:i + 1])
        low_prev = min(r[3] for r in rows[max(0, i - 59):i - 19]) if i >= 59 else None
        base = low_prev is not None and low20 >= low_prev * 0.98
        mean20 = m20
        var20 = max(0.0, (pre_sq[i + 1] - pre_sq[i - 19]) / 20 - mean20 * mean20)
        bb_up = mean20 + 2 * (var20 ** 0.5)
        bb_ok = c >= bb_up * BB_MIN_RATIO
        core = has_acc and settled and base
        hits = {'V0': True, 'V1': strict and core, 'V2': core, 'V3': strict and core and bb_ok, 'V4': core and bb_ok}
        for name, ok in hits.items():
            if ok and i - last_signal[name] >= COOLDOWN:
                last_signal[name] = i
                signals.append((name, i, {'strict': strict}))
    return signals


def stats(trades):
    n = len(trades)
    if not n:
        return {'n': 0}
    nets = sorted(t['net'] for t in trades)
    wins = [x for x in nets if x > 0]
    losses = [x for x in nets if x <= 0]
    avg_win = sum(wins) / len(wins) if wins else None
    avg_loss = sum(losses) / len(losses) if losses else None
    rs = [t['net'] / t['risk'] for t in trades if t.get('risk')]
    kinds = defaultdict(int)
    for t in trades:
        kinds[t['kind']] += 1
    mfes = sorted(t['mfe'] for t in trades)
    maes = sorted(t['mae'] for t in trades)
    return {
        'n': n,
        'expectancy': round(sum(nets) / n, 2),
        'median': round(nets[n // 2], 2),
        'win': round(len(wins) / n * 100, 1),
        'avgWin': round(avg_win, 2) if avg_win is not None else None,
        'avgLoss': round(avg_loss, 2) if avg_loss is not None else None,
        'payoff': round(avg_win / abs(avg_loss), 2) if avg_win is not None and avg_loss else None,
        'exR': round(sum(rs) / len(rs), 2) if rs else None,
        'targetPct': round(kinds['target'] / n * 100, 1),
        'stopPct': round((kinds['stop'] + kinds['break112']) / n * 100, 1),
        'timePct': round(kinds['time'] / n * 100, 1),
        'avgHold': round(sum(t['held'] for t in trades) / n, 1),
        'mfeMed': round(mfes[n // 2], 1), 'maeMed': round(maes[n // 2], 1),
        'mfe20Pct': round(sum(1 for t in trades if t['mfe'] >= 20) / n * 100, 1),
        'mae35Pct': round(sum(1 for t in trades if t['mae'] <= -3.5) / n * 100, 1),
        'worst': round(nets[0], 1), 'best': round(nets[-1], 1),
        'exTop1': round((sum(nets) - nets[-1]) / (n - 1), 2) if n > 1 else None,
    }


def main(db_path, excluded_path, out_path):
    excluded = set(json.load(open(excluded_path, encoding='utf-8')))
    conn = sqlite3.connect('file:%s?mode=ro' % db_path, uri=True, timeout=60)
    codes = [r[0] for r in conn.execute('SELECT DISTINCT code FROM daily_prices ORDER BY code').fetchall()]
    # 시장 상태: 전 종목 동일가중 일수익률로 만든 지수와 그 60일 이동평균(신호일 기준, 미래 정보 없음)
    ret_sum, ret_cnt = defaultdict(float), defaultdict(int)
    all_signals = []     # (variant, code, date, trades{rule: dict})
    scanned = 0
    for code in codes:
        if code in excluded:
            continue
        rows = conn.execute('SELECT date, open, high, low, close, volume FROM daily_prices WHERE code=? ORDER BY date', (code,)).fetchall()
        rows = [r for r in rows if r[1] and r[2] and r[3] and r[4]]
        if len(rows) < 30:
            continue
        for k in range(1, len(rows)):
            if rows[k - 1][4] > 0:
                r = rows[k][4] / rows[k - 1][4] - 1
                if -0.3 < r < 0.3:
                    ret_sum[rows[k][0]] += r
                    ret_cnt[rows[k][0]] += 1
        scanned += 1
        sigs = scan_stock(code, rows, None)
        if not sigs:
            continue
        mas = {'p112': prefix([r[4] for r in rows])}
        # p112 의 prefix 는 sma_at 에 쓰는 112일 이동평균용 누적합
        for name, i, info in sigs:
            trades = {}
            for rule in RULES:
                res = simulate(rows, i, rule, mas)
                if res:
                    trades[rule] = res
            all_signals.append((name, code, rows[i][0], info['strict'], trades))
    dates = sorted(ret_sum)
    index, level = {}, 100.0
    for d in dates:
        level *= 1 + ret_sum[d] / max(1, ret_cnt[d])
        index[d] = level
    idx_vals = [index[d] for d in dates]
    idx_pre = prefix(idx_vals)
    pos = {d: j for j, d in enumerate(dates)}

    def regime(d):
        j = pos.get(d)
        if j is None or j < 60:
            return 'n/a'
        ma = (idx_pre[j + 1] - idx_pre[j + 1 - 60]) / 60
        return 'up' if idx_vals[j] >= ma else 'down'

    result = {'scanned': scanned, 'dbRange': [dates[0], dates[-1]], 'variants': {}, 'byMonth': {}, 'byRegime': {}, 'params': {
        'accLookback': ACC_LOOKBACK, 'nearPct': NEAR_PCT, 'cooldown': COOLDOWN, 'hold': HOLD, 'costPct': COST_PCT,
        'stopFixed': STOP_FIXED, 'target': TARGET, 'structMax': STRUCT_MAX}}
    for name, label in VARIANTS:
        sel = [s for s in all_signals if s[0] == name]
        first = min((s[2] for s in sel), default=None)
        last = max((s[2] for s in sel), default=None)
        result['variants'][name] = {'label': label, 'signals': len(sel), 'stocks': len({s[1] for s in sel}), 'firstSignal': first, 'lastSignal': last,
                                    'rules': {rule: stats([s[4][rule] for s in sel if rule in s[4]]) for rule in RULES}}
        # 시장 구간별·월별: R1(고정 3.5%/20%)와 R2(구조 손절)만
        for rule in ('R1', 'R2'):
            by_m, by_r = defaultdict(list), defaultdict(list)
            for s in sel:
                if rule in s[4]:
                    by_m[s[2][:7]].append(s[4][rule])
                    by_r[regime(s[2])].append(s[4][rule])
            result['byMonth']['%s_%s' % (name, rule)] = {m: stats(v) for m, v in sorted(by_m.items())}
            result['byRegime']['%s_%s' % (name, rule)] = {m: stats(v) for m, v in sorted(by_r.items())}
    json.dump(result, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('done scanned=%d signals=%d' % (scanned, len(all_signals)))


if __name__ == '__main__':
    main(*sys.argv[1:4])
