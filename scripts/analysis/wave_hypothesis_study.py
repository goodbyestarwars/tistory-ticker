# -*- coding: utf-8 -*-
"""파동 상태 가설 3개(H1·H2·H3)와 기존 '눌림목' 검색기를 같은 진입·청산·비용으로 비교하는 오프라인 연구 (2026-10-13).
운영 화면·VM·계좌·자동매수와 연결하지 않는다. 결과는 가설 비교일 뿐이며 독립 검증(다른 기간·다른 종목군) 없이는 수익성이 확인됐다고 말하지 않는다.

가설(js/auto-wave.js 가 봉을 순차로 읽으며 그 봉까지의 자료만으로 낸 상태 신호)
  H1  대파동 상승 구조 + 중파동 눌림(직전 상승분의 25% 이상 되돌림, 눌림 저점이 직전 중파동 저점 위, 종가가 마지막 대파동 저점 위)이 성립한 첫 봉
  H2  H1 + 눌림 중 확정된 소파동 저점이 중파동 눌림 저점 위에서 소파동 상승 전환
  H3  224일선을 종가로 돌파(10봉 이내) + 중파동 저점 상승 + 중파동 재상승 진행
비교 대상: 기존 눌림목 검색기(pattern_detect.detect_pullback, 점수 80 이상·돌파 전, 쿨다운 5봉) = quant-autotrade/backtest/exit_study.py 의 'pullback' 과 같은 규칙.
기준선: BASE_STEP(6)봉마다 아무 날 진입.

진입·청산·비용은 exit_study.simulate 를 그대로 쓴다(D+1 시가 +0.2% 슬리피지 또는 D+1 종가, 갭 +2% 이상은 건너뜀, 왕복 0.4% + 청산 슬리피지 0.3%,
같은 봉에서 손절·익절이 모두 가능하면 손절 먼저). 변형 8개 × 진입 2개. 신호 판정에 미래 자료를 쓰지 않으며 종목 제외도 신호일 시점 자료로만 한다.
통과 기준은 exit_study 와 같다: 개발·검증 구간 평균 모두 > 0, 검증 n >= 100, 검증 평균의 z-하한(평균-3.2*SE) > 0, 같은 변형 기준선 대비 초과 > 0.
이 연구의 한계: 종목군이 현재 사이트 섹터 목록의 234개(생존 편향), 5년 한 번의 표본, 일봉 근사 체결, 분봉 진입 시각 미검증.

사용: python scripts/analysis/wave_hypothesis_study.py --db bt.db --out wave_study.json [--workers 4]
"""
import argparse
import json
import math
import os
import sqlite3
import subprocess
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'scripts', 'cloud-vm'))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(REPO, 'quant-autotrade', 'backtest'))

import signal_backtest as sb  # noqa: E402
import exit_study as es  # noqa: E402

HYPOTHESES = ('H1', 'H2', 'H3')
EXTRA = ('base_breakout',)
GROUPS = ('BASELINE', 'pullback') + HYPOTHESES + EXTRA
COOLDOWN = es.COOLDOWN


def export_bars(db, path):
    conn = sqlite3.connect(db)
    codes = [r[0] for r in conn.execute('SELECT code FROM daily_prices GROUP BY code HAVING COUNT(*) >= 250 ORDER BY code')]
    data = {}
    for code in codes:
        daily = sb.load(conn, code)
        data[code] = [[b['date'], b['open'], b['high'], b['low'], b['close'], b.get('volume') or 0] for b in daily]
    conn.close()
    json.dump(data, open(path, 'w'))
    return codes


def for_stock(args):
    db, code, wave_signals = args
    import pattern_detect as pdx
    conn = sqlite3.connect(db)
    daily = sb.load(conn, code)
    conn.close()
    n = len(daily)
    if n < 160:
        return []
    by_date = {b['date']: k for k, b in enumerate(daily)}
    sigs, last = [], {}
    for i in range(120, n - 2):
        if es.excluded_at(pdx, code, daily, i):
            continue
        if i % es.BASE_STEP == 0:
            sigs.append(('BASELINE', i))
        if i + 1 >= sb.MIN_HISTORY['pullback'] and i - last.get('pullback', -999) > COOLDOWN:
            try:
                d = pdx.detect_pullback(daily[:i + 1])
            except Exception:
                d = None
            if d is not None and not d.get('breakout') and (d.get('score') or 0) >= es.MIN_SCORE['pullback']:
                last['pullback'] = i
                sigs.append(('pullback', i))
    # 파동 상태 신호(엔진이 순차로 낸 값). 같은 가설은 쿨다운 안에서 한 건으로 센다.
    for s in sorted(wave_signals or [], key=lambda x: x['index']):
        k = by_date.get(s['date'])
        if k is None or k < 120 or k >= n - 2 or s['type'] not in HYPOTHESES + EXTRA:
            continue
        if es.excluded_at(pdx, code, daily, k) or k - last.get(s['type'], -999) <= COOLDOWN:
            continue
        last[s['type']] = k
        sigs.append((s['type'], k))
    out = []
    for name, i in sigs:
        date = daily[i]['date']
        for var in es.VARIANTS:
            for em in es.ENTRIES:
                res = es.simulate(daily, i, var, em)
                if res:
                    out.append((name, var, em, date, round(res[0], 5), code))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True)
    ap.add_argument('--out', default='wave_study.json')
    ap.add_argument('--workers', type=int, default=4)
    args = ap.parse_args()
    tmp = tempfile.mkdtemp(prefix='wave_study_')
    bars_path, sig_path = os.path.join(tmp, 'bars.json'), os.path.join(tmp, 'signals.json')
    codes = export_bars(args.db, bars_path)
    node = subprocess.run(['node', os.path.join(HERE, 'auto_wave_signals.js'), bars_path, sig_path], capture_output=True, text=True, encoding='utf-8')
    print(node.stdout.strip(), node.stderr.strip()[:300])
    wave = json.load(open(sig_path))
    rows = []
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        for k, res in enumerate(pool.map(for_stock, [(args.db, c, wave.get(c)) for c in codes], chunksize=2)):
            rows.extend(res)
            if (k + 1) % 40 == 0:
                print('%d/%d' % (k + 1, len(codes)), len(rows), flush=True)
    dates = sorted({r[3] for r in rows})
    cut = dates[int(len(dates) * 0.55)]
    years = sorted({d[:4] for d in dates})
    table = {}
    for g in GROUPS:
        for var in es.VARIANTS:
            for em in es.ENTRIES:
                sub = [r for r in rows if r[0] == g and r[1] == var and r[2] == em]
                dev = [r[4] for r in sub if r[3] < cut]
                val = [r[4] for r in sub if r[3] >= cut]
                table['%s|%s|%s' % (g, var, em)] = {
                    'all': es.stats([r[4] for r in sub]), 'dev': es.stats(dev), 'val': es.stats(val),
                    'byYear': {y: es.stats([r[4] for r in sub if r[3][:4] == y]) for y in years},
                    'codes': len({r[5] for r in sub}),
                }
    cands = []
    for key, v in table.items():
        g, var, em = key.split('|')
        if g == 'BASELINE':
            continue
        b = table['BASELINE|%s|%s' % (var, em)]['all'].get('avg')
        if (v['dev'].get('avg', -1) > 0 and v['val'].get('avg', -1) > 0 and v['val'].get('n', 0) >= 100
                and v['val'].get('zlow', -1) > 0 and b is not None and v['all'].get('avg', -1) > b):
            cands.append(key)
    # 겹침: 파동 가설 신호가 기존 눌림목 신호와 3거래일 안에 같은 종목에서 겹치는 비율(같은 신호를 다른 이름으로 부르는지 확인)
    overlap = {}
    for h in HYPOTHESES:
        a = {(r[5], r[3]) for r in rows if r[0] == h and r[1] == 'fix3_5' and r[2] == 'open'}
        p = {}
        for r in rows:
            if r[0] == 'pullback' and r[1] == 'fix3_5' and r[2] == 'open':
                p.setdefault(r[5], []).append(r[3])
        hit = sum(1 for (c, d) in a if any(abs((int(d.replace('-', '')) - int(x.replace('-', '')))) <= 5 for x in p.get(c, [])))
        overlap[h] = {'n': len(a), 'withPullbackWithin5days': hit}
    json.dump({'stocks': len(codes), 'engine': 'auto-wave', 'cut': cut, 'params': {'gap': es.GAP_SKIP, 'cost': es.COST, 'exitSlip': es.EXIT_SLIP, 'zBonferroni': 3.2, 'cooldown': COOLDOWN},
               'passed': cands, 'overlap': overlap, 'table': table}, open(args.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('done rows=%d passed=%s' % (len(rows), cands))


if __name__ == '__main__':
    main()
