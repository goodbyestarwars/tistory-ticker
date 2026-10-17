# -*- coding: utf-8 -*-
"""256 기법(2·5·6 = 20일선·5일선·60일선) 백테스트와 현재 흡사 종목 찾기(연구용, 실전 연결 없음 - 2026-10-17).

사용자가 소개한 기법: "5일선이 20일선을 골든크로스 하면서 20일선을 손절 잡고 매수한다. 매수 후 주가가 60일선을 뚫으면 수익권이 나온다."
그림은 60일선이 위에 평평하게 있고, 20일선이 내려오다 평평해지며, 5일선이 20일선을 위로 뚫고 60일선 쪽으로 올라가는 모양이다.

조건(신호일 종가 확정 뒤, 진입은 다음 날 시가, 종목당 COOLDOWN 봉에 한 번, 최근 20일 평균 거래대금 MIN_AMOUNT 이상, 종가 1,000원 이상):
  M0 5일선이 20일선을 아래→위로 교차 + 종가가 60일선 아래 + 20일선이 60일선 아래
  M1 M0 + 20일선이 내려가고 있지 않음(5봉 전 대비 -0.5% 이상) + 60일선까지 거리 5% 이상
  M2 M1 + 손익비(60일선까지 상승폭 ÷ 20일선까지 손절폭) 3 이상  ("이익 100만원·손절 30만원"에 해당)
  M3 M2 + 5일선의 올라가는 각도: 5일선이 3봉 전보다 1.5% 이상 높음
손절은 신호일 20일선 값(체결은 저가가 닿으면 그 가격, 시가가 넘어서 시작하면 시가), 손절폭 0.5~8% 밖은 진입 포기.
청산 X1: 고가가 그날의 60일선에 닿으면 그 가격(시가가 위면 시가)에 익절, 최대 40봉. X2: 60일선 목표 없이 종가가 그날 20일선 아래로 마감하면 청산(추적), 최대 60봉.
같은 날 손절과 목표가 모두 닿으면 손절 우선. 비용은 왕복 0.7%를 뺀다. 한계: 생존 편향(상장폐지 종목 없음), 일봉 모사, 체결가 미반영.
실행: python ma256_backtest.py <일봉 캐시 디렉터리> <종목명 JSON(krx_map)> <out.json>
"""

import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import yeokmaegongpa112_backtest as bt  # noqa: E402

COOLDOWN = 10
MIN_AMOUNT = 1_000_000_000
COST = bt.COST_PCT
HOLD_X1, HOLD_X2 = 40, 60
RISK_MIN, RISK_MAX = 0.005, 0.08
ROOM_MIN = 0.05
RR_MIN = 3.0
ANGLE_MIN = 0.015
VARIANTS = ('M0', 'M1', 'M2', 'M3')
EXITS = ('X1', 'X2')


def load_rows(path):
    return [tuple(r) for r in json.load(open(path, encoding='utf-8')) if r[1] and r[2] and r[3] and r[4]]


def signals_for(rows):
    """[(variant, i, info)] 와 마지막 봉의 상태. info: stop(20일선), ma60, reward, risk, rr."""
    n = len(rows)
    out = []
    if n < 90:
        return out
    close = [r[4] for r in rows]
    pre = bt.prefix(close)
    amt = bt.prefix([r[4] * float(r[5] or 0) for r in rows])
    last = {v: -10 ** 9 for v in VARIANTS}

    def ma(i, p):
        return bt.sma_at(pre, i, p)

    for i in range(65, n):
        c = close[i]
        if c < bt.PENNY:
            continue
        m5, m20, m60 = ma(i, 5), ma(i, 20), ma(i, 60)
        m5p, m20p = ma(i - 1, 5), ma(i - 1, 20)
        if not (m5p <= m20p and m5 > m20):          # 골든크로스
            continue
        if not (c < m60 and m20 < m60):
            continue
        if (amt[i + 1] - amt[i - 19]) / 20 < MIN_AMOUNT:
            continue
        reward = m60 / c - 1
        risk = c / m20 - 1 if c > m20 else None
        info = {'stop': m20, 'ma60': m60, 'close': c, 'reward': reward, 'risk': risk}
        m20_5 = ma(i - 5, 20)
        flat_ok = m20 >= m20_5 * 0.995
        room_ok = reward >= ROOM_MIN
        rr = reward / risk if risk and risk > 0 else None
        info['rr'] = rr
        info.update({'flat': flat_ok, 'room': room_ok, 'angle': ma(i, 5) / ma(i - 3, 5) - 1})
        hits = {'M0': True, 'M1': flat_ok and room_ok}
        hits['M2'] = hits['M1'] and rr is not None and rr >= RR_MIN
        m5_3 = ma(i - 3, 5)
        hits['M3'] = hits['M2'] and m5 >= m5_3 * (1 + ANGLE_MIN)
        for name in VARIANTS:
            if hits[name] and i - last[name] >= COOLDOWN:
                last[name] = i
                out.append((name, i, info))
    return out


def simulate(rows, i, info, exit_kind, pre):
    n = len(rows)
    if i + 1 >= n:
        return None
    entry = rows[i + 1][1]
    stop = info['stop']
    if not entry or entry <= stop:
        return None
    risk = (entry - stop) / entry
    if risk < RISK_MIN or risk > RISK_MAX:
        return None
    hold = HOLD_X1 if exit_kind == 'X1' else HOLD_X2
    end = min(n - 1, i + hold)
    mfe = mae = 0.0
    exit_price, kind, held = None, 'time', 0
    for k in range(i + 1, end + 1):
        o, h, l, c = rows[k][1], rows[k][2], rows[k][3], rows[k][4]
        held = k - i
        mfe = max(mfe, h / entry - 1)
        mae = min(mae, l / entry - 1)
        if o <= stop:
            exit_price, kind = o, 'stop'
            break
        if l <= stop:
            exit_price, kind = stop, 'stop'
            break
        if exit_kind == 'X1':
            m60 = bt.sma_at(pre, k, 60)
            if m60 and m60 > entry:
                if o >= m60:
                    exit_price, kind = o, 'target'
                    break
                if h >= m60:
                    exit_price, kind = m60, 'target'
                    break
        else:
            m20 = bt.sma_at(pre, k, 20)
            if k > i + 1 and c < m20:
                exit_price, kind = c, 'trail'
                break
    if exit_price is None:
        exit_price = rows[end][4]
        held = end - i
    ret = (exit_price / entry - 1) * 100
    return {'ret': ret, 'net': ret - COST, 'kind': kind, 'held': held, 'mfe': mfe * 100, 'mae': mae * 100, 'risk': risk * 100}


def main(cache_dir, names_path, out_path):
    names = {}
    if names_path and os.path.exists(names_path):
        src = open(names_path, encoding='utf-8').read()
        raw = json.loads(src[src.index('{'):src.rindex('}') + 1])
        names = {code: name for name, code in raw.items()}
    files = sorted(f for f in os.listdir(cache_dir) if f.endswith('.json'))
    ret_sum, ret_cnt = defaultdict(float), defaultdict(int)
    stocks = {}
    for f in files:
        rows = load_rows(os.path.join(cache_dir, f))
        for k in range(1, len(rows)):
            if rows[k - 1][4] > 0:
                r = rows[k][4] / rows[k - 1][4] - 1
                if -0.3 < r < 0.3:
                    ret_sum[rows[k][0]] += r
                    ret_cnt[rows[k][0]] += 1
    dates = sorted(ret_sum)
    level, vals = 100.0, []
    for d in dates:
        level *= 1 + ret_sum[d] / max(1, ret_cnt[d])
        vals.append(level)
    ipre = bt.prefix(vals)
    pos = {d: j for j, d in enumerate(dates)}

    def regime(d):
        j = pos.get(d)
        if j is None or j < 60:
            return 'n/a'
        return 'up' if vals[j] >= (ipre[j + 1] - ipre[j + 1 - 60]) / 60 else 'down'

    results = defaultdict(list)
    current = []
    last_date = dates[-1]
    for f in files:
        rows = load_rows(os.path.join(cache_dir, f))
        if len(rows) < 90:
            continue
        code = f[:-5]
        pre = bt.prefix([r[4] for r in rows])
        for name, i, info in signals_for(rows):
            if rows[-1][0] == last_date and i >= len(rows) - 3:      # 최근 3거래일 안에 골든크로스가 난 종목
                if name == 'M0':
                    current.append({'code': code, 'name': names.get(code, ''), 'variant': name, 'date': rows[i][0], 'close': info['close'],
                                    'stop20': round(info['stop'], 1), 'ma60': round(info['ma60'], 1),
                                    'riskPct': round(info['risk'] * 100, 2) if info['risk'] else None, 'rewardPct': round(info['reward'] * 100, 2),
                                    'rr': round(info['rr'], 2) if info['rr'] else None, 'flat': info['flat'], 'room': info['room'], 'anglePct': round(info['angle'] * 100, 2)})
            for exit_kind in EXITS:
                res = simulate(rows, i, info, exit_kind, pre)
                if res:
                    res['date'] = rows[i][0]
                    results[(name, exit_kind)].append(res)
    out = {'range': [dates[0], dates[-1]], 'cells': {}, 'byYear': {}, 'byRegime': {}, 'current': current}
    for (name, exit_kind), trades in sorted(results.items()):
        key = '%s_%s' % (name, exit_kind)
        out['cells'][key] = bt.stats(trades)
        by_y, by_r = defaultdict(list), defaultdict(list)
        for t in trades:
            by_y[t['date'][:4]].append(t)
            by_r[regime(t['date'])].append(t)
        out['byYear'][key] = {y: bt.stats(v) for y, v in sorted(by_y.items())}
        out['byRegime'][key] = {r: bt.stats(v) for r, v in sorted(by_r.items())}
    json.dump(out, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('done cells=%d current=%d' % (len(out['cells']), len(current)))


if __name__ == '__main__':
    main(*sys.argv[1:4])
