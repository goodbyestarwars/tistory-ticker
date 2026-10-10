# -*- coding: utf-8 -*-
"""당일 자금 재투입 시나리오 비교 백테스트 (2026-10-11, 오프라인 전용).

모의 계좌와 같은 코드(research/account_sim.py·allocation.py·paper_exits.py)로 같은 신호를 두 가지 체결 선후 가정으로 돌려 차이를 본다.
 - conservative : 그날 청산된 대금은 다음 거래일부터 사용(선후를 알 수 없을 때의 보수적 가정)
 - sameDay      : 시가에 자금·자리가 없어 못 산 후보를 같은 날 장 마감(종가+0.2%)에 매수. 매도가 종가보다 확실히 앞선 경우(신호 청산·장중 이탈)의 대금만 사용
시가 매수는 어느 시나리오에서도 같은 날 매도 대금을 쓰지 않는다. 일봉으로 선후를 알 수 없는 경우 유리한 순서를 만들지 않는다.
세 청산 전략(trail_atr·atr_close·dead35)은 변경하지 않는다. 후보는 장 마감 1회 검색 결과(신호) 그대로다.
사용: python reuse_study.py --db bt.db --kospi ks11.json --out reuse.json [--cache signals.pkl]
"""
import argparse
import json
import os
import pickle
import sqlite3
import sys
from concurrent.futures import ProcessPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
for _p in (HERE, os.path.join(REPO, 'quant-autotrade', 'research'), os.path.join(REPO, 'scripts', 'analysis'), os.path.join(REPO, 'scripts', 'cloud-vm')):
    if _p not in sys.path:
        sys.path.insert(0, _p)
import exit_study as ex  # noqa: E402
import account_sim  # noqa: E402
import paper_exits as pe  # noqa: E402

sb = ex.sb
BASE_STEP = 12
VARIANTS = ('trail_atr', 'atr_close', 'dead35')
GROUPS = ('pullback', 'maCloudBreakout', 'doubleBottom', 'invHeadShoulders', 'shortTermMaBreakout', 'BASELINE')


def detect(args):
    db, code = args
    import pattern_detect as pdx
    conn = sqlite3.connect(db)
    daily = sb.load(conn, code)
    conn.close()
    n = len(daily)
    if n < 160:
        return []
    det = {'maCloudBreakout': pdx.detect_ma_cloud_breakout, 'doubleBottom': pdx.detect_double_bottom,
           'invHeadShoulders': pdx.detect_inv_head_shoulders, 'pullback': pdx.detect_pullback,
           'shortTermMaBreakout': pdx.detect_short_ma_breakout}
    out, last = [], {}
    for i in range(120, n - 2):
        if ex.excluded_at(pdx, code, daily, i):
            continue
        if i % BASE_STEP == 0:
            out.append(('BASELINE', code, i, 0))
        w = daily[:i + 1]
        for name, fn in det.items():
            if i + 1 < sb.MIN_HISTORY[name] or i - last.get(name, -999) <= ex.COOLDOWN:
                continue
            try:
                d = fn(w)
            except Exception:
                d = None
            if d is not None and not d.get('breakout') and (d.get('score') or 0) >= ex.MIN_SCORE.get(name, 0):
                last[name] = i
                out.append((name, code, i, d.get('score') or 0))
    return out


def load_bars(db, codes):
    conn = sqlite3.connect(db)
    bars = {c: sb.load(conn, c) for c in codes}
    conn.close()
    return bars


def to_cand(r, scanner, code, i, score, daily):
    return {'key': (scanner, code, i), 'code': code, 'score': score, 'entry_date': r['entry_date'], 'entry_price': r['entry_price'], 'exit_date': r['exit_date'],
            'net': r['net_ret'], 'status': r['status'], 'exit_class': pe.exit_class(r['exit_reason'])}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True)
    ap.add_argument('--kospi', required=True)
    ap.add_argument('--out', default='reuse.json')
    ap.add_argument('--cache', default='')
    ap.add_argument('--workers', type=int, default=4)
    a = ap.parse_args()
    conn = sqlite3.connect(a.db)
    codes = [r[0] for r in conn.execute('SELECT code FROM daily_prices GROUP BY code HAVING COUNT(*) >= 250 ORDER BY code')]
    conn.close()
    if a.cache and os.path.exists(a.cache):
        sigs = pickle.load(open(a.cache, 'rb'))
    else:
        sigs = []
        with ProcessPoolExecutor(max_workers=a.workers) as pool:
            for res in pool.map(detect, [(a.db, c) for c in codes], chunksize=2):
                sigs.extend(res)
        if a.cache:
            pickle.dump(sigs, open(a.cache, 'wb'))
    bars = load_bars(a.db, codes)
    kospi = json.load(open(a.kospi, encoding='utf-8'))
    all_dates = [x['date'] for x in kospi]
    # 평가 종가: 거래정지·결측일은 직전 종가를 이어서 쓴다(백테스트 데이터의 달력 차이 보정). 종목 첫 봉 이전 날짜는 비워 둔다.
    closes = {}
    for c, rows in bars.items():
        own = {b['date']: b['close'] for b in rows}
        last, filled = None, {}
        for d in all_dates:
            last = own.get(d, last)
            if last is not None:
                filled[d] = last
        closes[c] = filled
    result = {'signals': len(sigs), 'runs': {}}
    open_cache = {}

    def evaluate(variant, code, i, mode):
        key = (variant, code, i, mode)
        if key not in open_cache:
            open_cache[key] = pe.evaluate(bars[code], i, variant, mode)
        return open_cache[key]

    for variant in VARIANTS:
        for group in GROUPS:
            cands = []
            for scanner, code, i, score in sigs:
                if scanner != group:
                    continue
                daily = bars[code]
                prev, open1 = daily[i]['close'], daily[i + 1]['open']
                if not prev or not open1 or open1 / prev - 1 >= ex.GAP_SKIP:     # 후보 필터(갭 +2% 이상 제외)는 모의매매와 같다
                    continue
                r = evaluate(variant, code, i, 'open')
                if r['status'] == 'PENDING_ENTRY' or r['entry_price'] is None:
                    continue
                cands.append(to_cand(r, scanner, code, i, score, daily))
            if not cands:
                continue
            first = min(c['entry_date'] for c in cands)
            calendar = [d for d in all_dates if d >= first]

            def close_at(code, date):
                return closes.get(code, {}).get(date)

            def make_alt(c):
                scanner, code, i = c['key']
                r = evaluate(variant, code, i, 'close')
                if r['status'] == 'PENDING_ENTRY' or r['entry_price'] is None:
                    return None
                return to_cand(r, scanner, code, i, c['score'], bars[code])

            for scenario in ('conservative', 'sameDay'):
                res = account_sim.simulate_account(cands, calendar, close_at, make_alt, scenario)
                years = len(calendar) / 245.0
                res['cagr'] = ((1 + res['cumRet']) ** (1 / years) - 1) if res.get('cumRet') is not None and years > 0 and 1 + res['cumRet'] > 0 else None
                res['candidates'] = len(cands)
                result['runs']['%s|%s|%s' % (variant, group, scenario)] = res
            print(variant, group, 'done', flush=True)
    json.dump(result, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('done signals=%d runs=%d' % (len(sigs), len(result['runs'])))


if __name__ == '__main__':
    main()
