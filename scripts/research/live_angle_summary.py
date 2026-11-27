# -*- coding: utf-8 -*-
"""live_angle_watch 결과 요약 (연구 전용). 실행: python live_angle_summary.py <live.jsonl>"""
import json
import sys

fl, tr = {}, {}
for line in open(sys.argv[1], encoding='utf-8'):
    r = json.loads(line)
    if r['ev'] == 'flag':
        fl[r['code']] = r
        tr[r['code']] = [(r['t'], r['px'])]
    elif r['code'] in tr:
        tr[r['code']].append((r['t'], r['px']))
n = len(fl)
if not n:
    print('flagged 0')
    sys.exit(0)
res = []
for c, r in fl.items():
    p0, path = r['px'], tr[c]
    first3 = first5 = firstm3 = None
    for t, p in path:
        g = p / p0 - 1
        if first3 is None and g >= 0.03:
            first3 = t
        if first5 is None and g >= 0.05:
            first5 = t
        if firstm3 is None and g <= -0.03:
            firstm3 = t
    res.append((r['name'], r['t'], p0, path[-1][1] / p0 - 1, max(p for _, p in path) / p0 - 1, min(p for _, p in path) / p0 - 1, first3, first5, firstm3, len(path), path[-1][0]))
print('flagged', n, 'last update', max(x[10] for x in res))
print('hit +3%%: %d (%.0f%%)  hit +5%%: %d (%.0f%%)  touched -3%%: %d (%.0f%%)' % (
    sum(1 for x in res if x[6]), 100 * sum(1 for x in res if x[6]) / n, sum(1 for x in res if x[7]), 100 * sum(1 for x in res if x[7]) / n,
    sum(1 for x in res if x[8]), 100 * sum(1 for x in res if x[8]) / n))
first = lambda x: (x[6] or '99', x[8] or '99')  # noqa: E731
both = [x for x in res if x[6] and x[8]]
tp_first = sum(1 for x in both if x[6] < x[8])
print('둘 다 닿은 %d건 중 +3%%가 먼저: %d' % (len(both), tp_first))
print('현재 평균 %.2f%%, 중앙값 %.2f%%' % (100 * sum(x[3] for x in res) / n, 100 * sorted(x[3] for x in res)[n // 2]))
for x in sorted(res, key=lambda x: -x[4])[:12]:
    print('%-12s 진입 %s 최고 %+.1f%% 최저 %+.1f%% 현재 %+.1f%%' % (x[0], x[1], 100 * x[4], 100 * x[5], 100 * x[3]))
