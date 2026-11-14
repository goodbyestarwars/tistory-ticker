# -*- coding: utf-8 -*-
"""최근 두 달 신호 사후 점검: 연구 결과 조합을 과거 날짜에 그대로 적용 (연구용, 실전 연결 없음 - 2026-11-13).

그룹(날짜별 백분위, t일 종가까지):
  ① 주도주 조용한 눌림  거래대금 상위 15% · auto-wave.shapeOf 120봉 pullback/rebound · 두 숫자 점수 상위 30%
  ② 시간차 매집        accumulation_lead_study 의 E (거래량↑·박스·거래 마름·외국인+기관 순매수)
실적(시점 기준): 네이버 분기 실적 중 '신호일에 이미 공시됐을' 분기만 사용(분기말 + 45일, 12월 결산은 + 90일).
  통과 = 최근 공시 분기 영업이익 > 0 이고 전년 같은 분기보다 증가. 자료 없음은 '미확인'으로 따로 센다.
시장 국면: 유니버스 20일 평균 수익률 > 0 이면 '상승 국면'.
진입 t+1 시가, 같은 종목은 기간 중 첫 신호만. 결과: 마지막 종가까지 수익(비용 0.7%), 기간 중 최고·최저,
  청산 규칙(손절 -10%, 진입 후 최고 종가 대비 -15% 추적, 최대 60거래일) 적용 결과.
실행: python recent_month_scan.py <작업 폴더(prep.pkl·shape.tsv·cache/·universe.json)> <out.json>
"""
import datetime as dt
import json
import os
import sys
import time
import urllib.request
import warnings
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import accumulation_lead_study as A  # noqa: E402

WINDOWS = {'9월 중순~10월 중순(20일 결과 확정)': ('20260914', '20261013'), '최근 한 달(진행 중)': ('20261014', '20261112')}
COST = 0.007


def quarters(code):
    url = 'https://m.stock.naver.com/api/stock/%s/finance/quarter' % code
    for k in range(3):
        try:
            j = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=20).read())
            info = j['financeInfo']
            keys = [t['key'] for t in info['trTitleList'] if t.get('isConsensus') == 'N']
            op = next((r['columns'] for r in info['rowList'] if r['title'] == '영업이익'), {})

            def val(k2):
                v = (op.get(k2) or {}).get('value', '-').replace(',', '')
                try:
                    return float(v)
                except ValueError:
                    return None
            return {k2: val(k2) for k2 in keys}
        except Exception:
            time.sleep(1 + k)
    return None


def known_on(qkey, sig):
    y, m = int(qkey[:4]), int(qkey[4:6])
    end = dt.date(y, m, 28)
    lag = 90 if m == 12 else 45
    return (end + dt.timedelta(days=lag + 3)).strftime('%Y%m%d') <= sig


def earnings_flag(q, sig):
    if not q:
        return '미확인'
    ks = sorted(k for k in q if known_on(k, sig) and q[k] is not None)
    if not ks:
        return '미확인'
    last = ks[-1]
    prev = '%d%s' % (int(last[:4]) - 1, last[4:])
    if q.get(prev) is None:
        return '미확인'
    return '개선' if q[last] > 0 and q[last] > q[prev] else '부진'


def outcome(px, d):
    ds = [r[0] for r in px]
    i = ds.index(d)
    if i + 1 >= len(px):
        return None
    o = np.array([r[1] for r in px]); h = np.array([r[2] for r in px]); l = np.array([r[3] for r in px]); c = np.array([r[4] for r in px])
    e = o[i + 1]
    seg = slice(i + 1, min(len(c), i + 61))
    res = {'entry_date': ds[i + 1], 'entry': e, 'last_date': ds[min(len(c), i + 61) - 1],
           'ret': c[seg][-1] / e - 1 - COST, 'max_up': h[seg].max() / e - 1, 'max_dn': l[seg].min() / e - 1,
           'ret20': (c[i + 20] / e - 1 - COST) if i + 20 < len(c) else None}
    stop, peak, exit_ret = e * 0.9, e, None
    for j in range(i + 1, min(len(c), i + 61)):
        stop = max(stop, peak * 0.85)
        if l[j] <= stop:
            exit_ret = min(o[j], stop) / e - 1 - COST
            res['exit_date'] = ds[j]
            break
        peak = max(peak, c[j])
    res['rule_ret'] = exit_ret if exit_ret is not None else res['ret']
    res['rule_open'] = exit_ret is None
    return res


def main(lab, out_path):
    warnings.filterwarnings('ignore')
    names = json.load(open(os.path.join(lab, 'universe.json'), encoding='utf-8'))
    pre = pd.read_pickle(os.path.join(lab, 'prep.pkl'))[['code', 'd', 'p_score', 'p_logamt', 'rev20']]
    mkt = pre.groupby('d').rev20.mean()
    sh = pd.read_csv(os.path.join(lab, 'shape.tsv'), sep='\t', dtype={'code': str, 'd': str}, usecols=['code', 'd', 't120'])
    pre = pre[pre.d >= '20260901'].merge(sh, on=['code', 'd'])
    g1 = pre[(pre.p_logamt > .85) & pre.t120.isin(['pullback', 'rebound']) & (pre.p_score > .7)][['code', 'd']].assign(grp='① 주도주 조용한 눌림')
    acc = []
    for fn in sorted(os.listdir(os.path.join(lab, 'cache'))):
        fr = A.frame(fn[:-5], json.load(open(os.path.join(lab, 'cache', fn))))
        if fr is not None:
            acc.append(fr[(fr.d >= '20260101')])
    acc = pd.concat(acc)
    acc = acc[(acc.amt20 >= 3e9) & (acc.close >= 1000) & acc.vol_up.notna() & acc.sm60.notna()]
    for k in ('vol_up', 'box60', 'dry10', 'sm60'):
        acc['p_' + k] = acc.groupby('d')[k].rank(pct=True)
    e = acc[(acc.p_vol_up >= .8) & (acc.p_box60 <= .4) & (acc.drift60 < .10) & (acc.p_dry10 <= .3) & (acc.p_sm60 >= .7) & (acc.d >= '20260901')]
    g2 = e[['code', 'd']].assign(grp='② 시간차 매집')
    sig = pd.concat([g1, g2])
    codes = sorted(sig.code.unique())
    with ThreadPoolExecutor(max_workers=6) as ex:
        fin = dict(zip(codes, ex.map(quarters, codes)))
    out = {'market_regime': {d: ('상승' if v > 0 else '하락') for d, v in mkt[mkt.index >= '20260901'].items()}, 'windows': {}}
    for wname, (a, b) in WINDOWS.items():
        rows = []
        w = sig[(sig.d >= a) & (sig.d <= b)].sort_values('d')
        for (code, grp), g in w.groupby(['code', 'grp']):
            d = g.d.iloc[0]
            px = [r for r in json.load(open(os.path.join(lab, 'cache', code + '.json')))['px'] if r[0] < '20261113']
            oc = outcome(px, d)
            if not oc:
                continue
            rows.append(dict(code=code, name=names.get(code, code), grp=grp, signal=d, earn=earnings_flag(fin.get(code), d),
                             regime='상승' if mkt.get(d, 0) > 0 else '하락', **oc))
        out['windows'][wname] = rows
    json.dump(out, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1, default=float)
    print('done')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
