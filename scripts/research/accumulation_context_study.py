# -*- coding: utf-8 -*-
"""매집봉(대량 양봉) 후보의 '맥락'별 사후 성과(연구용, 실전 연결 없음 - 2026-10-17).

차트의 매집봉 표시는 검색기의 봉 하나 조건(거래량 20일 평균 2.5배·양봉 몸통 2%·종가 위치 0.6·거래대금 30억)만 본다. 같은 모양이라도
바닥·횡보 끝에서 나오면 매집, 큰 상승 뒤 고점권에서 나오면 물량을 터는 봉일 수 있다(분배). 이 도구는 봉 하나 조건을 만족한 봉을
(1) 직전 20봉 상승률 (2) 120봉 고점 대비 종가 위치 (3) 검색기의 후속 확인(이후 거래량 감소+가격 지지) 여부로 나눠,
다음 날 시가 진입 20거래일 뒤 종가 수익률을 비교한다. 기준선은 같은 종목·같은 기간의 모든 봉(조건 없음)이다.
실행: python accumulation_context_study.py <일봉 캐시 디렉터리> <out.json>
"""

import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import yeokmaegongpa112_backtest as bt  # noqa: E402

HORIZON = 20
RUNUP_BUCKETS = ((-9, 0.0, '직전 20봉 하락·보합'), (0.0, 0.10, '0~+10%'), (0.10, 0.25, '+10~25%'), (0.25, 9, '+25% 이상'))
POS_BUCKETS = ((0.0, 0.70, '120봉 고점 대비 70% 미만'), (0.70, 0.90, '70~90%'), (0.90, 9, '90% 이상(고점권)'))


def bucket(value, table):
    for lo, hi, label in table:
        if lo <= value < hi:
            return label
    return table[-1][2]


def followup_ok(rows, i, vol_acc):
    """검색기 후속 확인(find 이후 4봉): 평균 거래량 <= 매집봉의 60%, 이후 저가가 매집봉 저가의 98% 아래로 안 내려가고 종가가 매집봉 종가의 96% 아래로 안 내려감."""
    post = rows[i + 1:i + 5]
    if len(post) < 4:
        return None
    a_l, a_c = rows[i][3], rows[i][4]
    mid_avg = sum(float(r[5] or 0) for r in post[:-1]) / 3
    if mid_avg > bt.DRY_RATIO_LIMIT * vol_acc if hasattr(bt, 'DRY_RATIO_LIMIT') else mid_avg > 0.6 * vol_acc:
        return False
    return not any(r[3] < a_l * 0.98 or r[4] < a_c * 0.96 for r in post)


def main(cache_dir, out_path):
    groups = defaultdict(list)   # label -> [ret%, mfe%, mae%]
    for f in sorted(os.listdir(cache_dir)):
        if not f.endswith('.json'):
            continue
        rows = [tuple(r) for r in json.load(open(os.path.join(cache_dir, f), encoding='utf-8')) if r[1] and r[2] and r[3] and r[4]]
        n = len(rows)
        if n < 160:
            continue
        vol_pre = bt.prefix([float(r[5] or 0) for r in rows])
        flags = bt.accumulation_flags(rows, vol_pre)
        for i in range(140, n - HORIZON - 6):
            entry_i = i + 1
            entry = rows[entry_i][1]
            if entry <= 0:
                continue
            exit_close = rows[min(n - 1, entry_i + HORIZON)][4]
            window = rows[entry_i:entry_i + HORIZON + 1]
            res = ((exit_close / entry - 1) * 100, (max(r[2] for r in window) / entry - 1) * 100, (min(r[3] for r in window) / entry - 1) * 100)
            groups['전체(기준선)'].append(res) if i % 7 == 0 else None
            if not flags[i]:
                continue
            runup = rows[i - 1][4] / rows[i - 21][4] - 1
            pos = rows[i][4] / max(r[2] for r in rows[i - 119:i + 1])
            groups['후보 전체'].append(res)
            groups['상승 ' + bucket(runup, RUNUP_BUCKETS)].append(res)
            groups['위치 ' + bucket(pos, POS_BUCKETS)].append(res)
            fu = followup_ok(rows, i, float(rows[i][5]))
            if fu is True:
                # 확인은 4봉 뒤에야 알 수 있으므로 진입을 i+5 시가로 늦춰 다시 잰다
                e = rows[i + 5][1] if i + 5 < n else 0
                if e > 0:
                    w = rows[i + 5:i + 5 + HORIZON + 1]
                    r2 = ((rows[min(n - 1, i + 5 + HORIZON)][4] / e - 1) * 100, (max(r[2] for r in w) / e - 1) * 100, (min(r[3] for r in w) / e - 1) * 100)
                    groups['후속 확인 통과(진입 i+5)'].append(r2)
            elif fu is False:
                groups['후속 확인 실패'].append(res)
            if runup < 0.10 and pos < 0.90:
                groups['권장 맥락(상승 +10% 미만 & 고점권 아님)'].append(res)
            if runup >= 0.25 or pos >= 0.90:
                groups['분배 의심 맥락(상승 +25% 이상 또는 고점권)'].append(res)
    out = {}
    for label, vals in groups.items():
        k = len(vals)
        rets = sorted(v[0] for v in vals)
        out[label] = {'n': k, 'mean': round(sum(rets) / k, 2), 'median': round(rets[k // 2], 2), 'win': round(sum(1 for x in rets if x > 0) / k * 100, 1),
                      'gt10': round(sum(1 for x in rets if x >= 10) / k * 100, 1), 'lt-10': round(sum(1 for x in rets if x <= -10) / k * 100, 1),
                      'mfe_med': round(sorted(v[1] for v in vals)[k // 2], 1), 'mae_med': round(sorted(v[2] for v in vals)[k // 2], 1)}
    json.dump(out, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('done groups=%d' % len(out))


if __name__ == '__main__':
    main(*sys.argv[1:3])
