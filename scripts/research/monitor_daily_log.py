# -*- coding: utf-8 -*-
"""코스닥 모니터링 일지 생성 (연구 전용, 주문 없음 - 2026-11-27).

live_angle_watch 의 jsonl 과 monitor_snapshots 의 정시 스냅샷, 일봉 캐시(20일 평균 거래량)를 합쳐 하루치 일지를 만든다.
  python monitor_daily_log.py <날짜 YYYY-MM-DD> <live.jsonl> <스냅샷 폴더> <일봉 cache> <out 폴더> [book.jsonl] [prev.json]
out 폴더에 <날짜>.md(사람이 읽는 일지)와 <날짜>.json(원자료)을 쓴다.
"""
import json
import os
import sys

COST = 0.004
SNAP_TIMES = ('0920', '0930', '1000', '1100', '1300', '1400', '1500', '1520', '1535')


def avg20(cache, code):
    try:
        px = json.load(open(os.path.join(cache, code + '.json'), encoding='utf-8'))['px']
    except (OSError, ValueError, KeyError):
        return None
    v = [r[5] for r in px[-20:] if r[5]]
    return sum(v) / len(v) if len(v) >= 15 else None


def load_flags(path):
    fl, tr = {}, {}
    for line in open(path, encoding='utf-8'):
        r = json.loads(line)
        if r['ev'] == 'flag' and r['code'] not in fl:     # 재시작으로 같은 종목이 다시 flag 되면 첫 신호만 인정
            fl[r['code']] = r
            tr[r['code']] = [(r['t'], r['px'], r['cv'])]
        elif r['ev'] == 'flag':
            tr[r['code']].append((r['t'], r['px'], r['cv']))
        elif r['code'] in tr:
            tr[r['code']].append((r['t'], r['px'], r['cv']))
    return fl, tr


def load_book(path):
    out = {}
    try:
        for line in open(path, encoding='utf-8'):
            r = json.loads(line)
            out.setdefault(r['code'], []).append(r)
    except OSError:
        pass
    return out


def book_at(rows, t):
    """신호 시각 이후 첫 호가 기록(없으면 None). 호가 수집이 45초 주기라 최대 약 1분 늦다."""
    for r in rows:
        if r['t'] >= t:
            return {'t': r['t'], 'ratio': r['ratio'], 'ratio5': r['ratio5'], 'spreadPct': r['spreadPct'], 'askTot': r['askTot'], 'bidTot': r['bidTot']}
    return None


def outcome(entry, path):
    first3 = first5 = firstm3 = None
    for t, p, _ in path:
        g = p / entry - 1
        if first3 is None and g >= 0.03:
            first3 = t
        if first5 is None and g >= 0.05:
            first5 = t
        if firstm3 is None and g <= -0.03:
            firstm3 = t
    prices = [p for _, p, _ in path]
    return {'max': max(prices) / entry - 1, 'min': min(prices) / entry - 1, 'last': prices[-1] / entry - 1, 'lastT': path[-1][0],
            'hit3': first3, 'hit5': first5, 'touchM3': firstm3}


def main():
    date, live, snapdir, cache, outdir = sys.argv[1:6]
    book = load_book(sys.argv[6]) if len(sys.argv) > 6 else {}
    os.makedirs(outdir, exist_ok=True)
    flags, tracks = load_flags(live)
    snaps = {}
    for hhmm in SNAP_TIMES:
        p = os.path.join(snapdir, 'snap_%s.json' % hhmm)
        if os.path.exists(p):
            snaps[hhmm] = json.load(open(p, encoding='utf-8'))
    if len(sys.argv) > 7:                  # 2026-11-27 부호 오류 보정: 올바른 전일 종가로 등락률 재계산, 규칙 범위 밖은 제외
        prev = json.load(open(sys.argv[7]))
        for s in snaps.values():
            for c, v in s['rows'].items():
                if len(v) < 5 and prev.get(c):
                    v[1] = round(v[0] / prev[c] - 1, 4)
        for c in list(flags):
            p = prev.get(c)
            if not p or not 0.02 <= flags[c]['px'] / p - 1 < 0.27:
                del flags[c]
            else:
                flags[c]['ret'] = round(flags[c]['px'] / p - 1, 4)
    last = snaps[max(snaps)] if snaps else None
    data = {'date': date, 'flags': [], 'snapshotTimes': sorted(snaps), 'top30': [], 'market': {}}
    # 시장 요약(마지막 스냅샷)
    if last:
        rets = [v[1] for v in last['rows'].values() if v[1] is not None]
        data['market'] = {'asOf': last['t'], 'stocks': len(rets), 'up': sum(1 for x in rets if x > 0), 'down': sum(1 for x in rets if x < 0),
                          'flat': sum(1 for x in rets if x == 0), 'ge5pct': sum(1 for x in rets if x >= 0.05), 'ge10pct': sum(1 for x in rets if x >= 0.10),
                          'limitUpLike': sum(1 for x in rets if x >= 0.29)}
    # 규칙 신호
    for code, f in sorted(flags.items(), key=lambda kv: kv[1]['t']):
        o = outcome(f['px'], tracks[code])
        item = {'code': code, 'name': f['name'], 'flagT': f['t'], 'primary': f['primary'], 'entry': f['px'], 'ret': f['ret'], 'a5': f['a5'], 'cv': f['cv'], **o}
        base = avg20(cache, code)
        item['cvAt'] = {h: round(s['rows'][code][2] / base, 3) for h, s in snaps.items() if code in s['rows'] and base}
        item['book'] = book_at(book.get(code, []), f['t'])
        if last and code in last['rows']:
            item['dayRet'] = last['rows'][code][1]
        data['flags'].append(item)
    # 당일 상승률 TOP30 (마지막 스냅샷)
    if last:
        top = sorted(((v[1], c, v) for c, v in last['rows'].items() if v[1] is not None), reverse=True)[:30]
        for r, code, v in top:
            base = avg20(cache, code)
            row = {'code': code, 'name': v[3], 'dayRet': r, 'caught': code in flags, 'caughtT': flags[code]['t'] if code in flags else None,
                   'retAt': {h: s['rows'][code][1] for h, s in snaps.items() if code in s['rows']},
                   'cvAt': {h: round(s['rows'][code][2] / base, 3) for h, s in snaps.items() if code in s['rows'] and base}}
            data['top30'].append(row)
    json.dump(data, open(os.path.join(outdir, date + '.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    write_md(data, os.path.join(outdir, date + '.md'))


def pct(x):
    return '-' if x is None else '%+.1f%%' % (100 * x)


def write_md(d, path):
    fl = d['flags']
    prim = [f for f in fl if f['primary']]
    L = ['# 코스닥 모니터링 일지 %s' % d['date'], '',
         '연구 기록이며 투자 권유·주문과 무관하다. 규칙·정의는 [README](README.md).', '']
    m = d['market']
    if m:
        L += ['## 시장', '', '- 기준 %s: 코스닥 보통주 %d개, 상승 %d · 하락 %d · 보합 %d, +5%% 이상 %d개, +10%% 이상 %d개, 상한가급(+29%%↑) %d개.' % (
            m['asOf'], m['stocks'], m['up'], m['down'], m['flat'], m['ge5pct'], m['ge10pct'], m['limitUpLike']), '']

    def summ(rows, title):
        n = len(rows)
        if not n:
            return ['### %s' % title, '', '해당 없음.', '']
        h3 = sum(1 for r in rows if r['hit3'])
        h5 = sum(1 for r in rows if r['hit5'])
        m3 = sum(1 for r in rows if r['touchM3'])
        avg = sum(r['last'] for r in rows) / n
        return ['### %s' % title, '',
                '- 신호 %d건. +3%% 도달 %d(%.0f%%), +5%% 도달 %d(%.0f%%), −3%% 터치 %d(%.0f%%). 진입 후 마지막 관측가 평균 %s(비용 전), 중앙값 %s.' % (
                    n, h3, 100 * h3 / n, h5, 100 * h5 / n, m3, 100 * m3 / n, pct(avg), pct(sorted(r['last'] for r in rows)[n // 2])), '']
    L += ['## 규칙 신호 (수급 들어오기 전 + 강력한 각도)', '']
    L += summ(prim, '09:10 평가 시각 판정(검증 대상)')
    L += summ([f for f in fl if not f['primary']], '그 외 시각(탐색용)')
    L += ['| 종목 | 코드 | 판정 | 구분 | 진입가 | 등락률 | 5분 상승 | 누적거래량비 | 최고 | 최저 | 마지막 | +3% | +5% | −3% | 호가 총매수/총매도 | 스프레드 |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|']
    for f in fl:
        L.append('| %s | %s | %s | %s | %s | %s | %s | %.3f | %s | %s | %s | %s | %s | %s | %s | %s |' % (
            f['name'], f['code'], f['flagT'], '09:10' if f['primary'] else '탐색', '{:,.0f}'.format(f['entry']), pct(f['ret']), pct(f['a5']), f['cv'],
            pct(f['max']), pct(f['min']), pct(f['last']), f['hit3'] or '-', f['hit5'] or '-', f['touchM3'] or '-',
            ('%.2f' % f['book']['ratio']) if f.get('book') and f['book']['ratio'] is not None else '-', pct(f['book']['spreadPct']) if f.get('book') else '-'))
    bk = [f for f in fl if f.get('book') and f['book']['ratio'] is not None]
    if bk:
        L += ['', '## 호가 비율과 결과 (규칙 신호, 신호 직후 첫 호가 기준)', '', '| 구간 | 신호 수 | +3% 도달 | −3% 터치 | 마지막 평균 |', '|---|---|---|---|---|']
        for title, rows in (('총매수/총매도 ≥ 1', [f for f in bk if f['book']['ratio'] >= 1]), ('0.3 ≤ 비율 < 1', [f for f in bk if 0.3 <= f['book']['ratio'] < 1]), ('비율 < 0.3', [f for f in bk if f['book']['ratio'] < 0.3])):
            n = len(rows)
            L.append('| %s | %d | %s | %s | %s |' % (title, n, ('%d (%.0f%%)' % (sum(1 for r in rows if r['hit3']), 100 * sum(1 for r in rows if r['hit3']) / n)) if n else '-',
                                                      ('%d (%.0f%%)' % (sum(1 for r in rows if r['touchM3']), 100 * sum(1 for r in rows if r['touchM3']) / n)) if n else '-',
                                                      pct(sum(r['last'] for r in rows) / n) if n else '-'))
    L += ['', '## 당일 코스닥 상승률 TOP30 (마지막 스냅샷 기준)', '',
          '| 종목 | 코드 | 당일 | 규칙에 잡힘 | ' + ' | '.join('등락 %s' % h for h in d['snapshotTimes'][:3]) + ' | ' + ' | '.join('거래량비 %s' % h for h in d['snapshotTimes'][:3]) + ' |',
          '|---|---|---|---|' + '---|' * (2 * len(d['snapshotTimes'][:3]))]
    for t in d['top30']:
        cols = [pct(t['retAt'].get(h)) for h in d['snapshotTimes'][:3]] + ['%.2f' % t['cvAt'][h] if h in t['cvAt'] else '-' for h in d['snapshotTimes'][:3]]
        L.append('| %s | %s | %s | %s | %s |' % (t['name'], t['code'], pct(t['dayRet']), ('예 ' + t['caughtT']) if t['caught'] else '아니오', ' | '.join(cols)))
    caught = sum(1 for t in d['top30'] if t['caught'])
    L += ['', '- TOP30 중 규칙에 잡힌 종목: %d/30.' % caught, '']
    open(path, 'w', encoding='utf-8').write('\n'.join(L) + '\n')


if __name__ == '__main__':
    main()
