# -*- coding: utf-8 -*-
"""연구용 일회성 분석: MA112/224 지지 + 저점 유지 + 앞선 급등 + 거래량 재증가 + 돌파 단타 패턴 (2026-11-27).

운영 기능과 분리된 읽기 전용 연구다. 운영 코드·DB는 수정하지 않는다(sqlite는 mode=ro로만 연다).
기존 scripts/analysis/signal_backtest.py의 규칙을 그대로 따른다(해당 파일은 수정하지 않고 --selftest에서 outcome()과 대조).

신호일 D의 판정은 D까지의 일봉만 사용한다(미래 봉 금지).
  1) 지지   : 최근 20일(D-19~D) 안에 장중 저가 <= 그날의 MA112 또는 MA224 x 1.02 인 날이 있고, D 종가 > MA112(D)
  2) 저점유지: 최근 5일(D-4~D) 최저가 >= 그 앞 15일(D-19~D-5) 최저가 x 0.99
  3) 급등이력: 최근 40일(D-42~D-3, 최근 3일 제외) 중 하루라도 거래량 >= 직전 60일 평균의 5배 또는 일 등락률 >= +15%
  4) 거래량  : D-1 거래량 >= 그 앞 5일(D-6~D-2) 평균의 2배
  5) 돌파    : D 고가 > D-1 고가 이고 D 종가 >= D-1 고가
진입 = D+1 시가, 왕복 비용 0.4%, N=5/10/20일 종가 수익률, MFE/MAE(D+1~D+N 고저),
+5%/-5% 선도달(10거래일, 같은 봉이면 LOSS), 같은 종목 5거래일 쿨다운, 실패·하락 종목 포함.

비교군(모두 같은 구간: 종목당 인덱스 >= START_I, 즉 MA224·급등 60일 평균이 모두 계산되는 구간)
  - ALL      : 조건 없이 전종목·전일자 D+1 시가 진입(쿨다운 없음)
  - ALL@DATE : 신호가 뜬 날짜와 같은 날짜들의 전종목 평균(시장 흐름 제거용, 신호 가중)
  - C45      : 조건 4)+5)만(쿨다운 적용)
  - C123     : 조건 1)+2)+3)만(트리거 없는 셋업, 참고용)

사용: python3 scripts/research/support_breakout_surge_study.py --db ohlc_snapshot.db --out result.json
      python3 scripts/research/support_breakout_surge_study.py --profile-only --db ohlc_snapshot.db
      python3 scripts/research/support_breakout_surge_study.py --selftest
"""
import argparse
import importlib.util
import json
import math
import os
import sqlite3
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
COOLDOWN = 5
COST = 0.004
HORIZONS = (5, 10, 20)
START_I = 265          # 이 인덱스 이전 봉은 신호·비교군 모두 제외(MA224 + 40일 창 + 60일 평균이 전부 유효한 구간)
MIN_ROWS = 250         # signal_backtest.main()의 종목 선정(HAVING COUNT >= 250)과 동일


# ---------------------------------------------------------------- 조건 계산(벡터화)
def conditions(o, h, l, c, v):
    """각 인덱스 i가 i까지의 데이터만으로 판정되는 5개 조건 불리언 배열을 돌려준다."""
    n = len(c)
    sc, sv, sl = pd.Series(c), pd.Series(v), pd.Series(l)
    ma112 = sc.rolling(112).mean().to_numpy()
    ma224 = sc.rolling(224).mean().to_numpy()
    with np.errstate(invalid='ignore'):
        touch = (l <= ma112 * 1.02) | (l <= ma224 * 1.02)           # NaN 비교는 False
        c1 = (pd.Series(touch.astype(float)).rolling(20).max().to_numpy() > 0) & (c > ma112)
        min5 = sl.rolling(5).min()
        prev15 = sl.rolling(15).min().shift(5)
        c2 = (min5 >= prev15 * 0.99).to_numpy()
        avg60 = sv.rolling(60).mean().shift(1).to_numpy()
        prev_c = np.concatenate([[np.nan], c[:-1]])
        spike = ((avg60 > 0) & (v >= 5 * avg60)) | ((c / prev_c - 1) >= 0.15)
        c3 = (pd.Series(spike.astype(float)).shift(3).rolling(40).max().to_numpy() > 0)
        avg5 = sv.rolling(5).mean().shift(2).to_numpy()
        c4 = (avg5 > 0) & (np.concatenate([[np.nan], v[:-1]]) >= 2 * avg5)
        prev_h = np.concatenate([[np.nan], h[:-1]])
        c5 = (h > prev_h) & (c >= prev_h)
    out = [np.nan_to_num(np.asarray(x, dtype=float)).astype(bool) if x.dtype != bool else x for x in (c1, c2, c3, c4, c5)]
    # NaN가 섞인 pandas 결과는 False 처리
    return [np.asarray(x, dtype=bool) for x in out]


def conditions_naive(o, h, l, c, v, i):
    """명세를 글자 그대로 옮긴 단일 인덱스 판정(--selftest에서 벡터 결과와 대조)."""
    if i < 223 + 19 or i < 102:
        return None
    def ma(k, j):
        return c[j - k + 1:j + 1].mean()
    t = any((l[j] <= ma(112, j) * 1.02) or (l[j] <= ma(224, j) * 1.02) for j in range(i - 19, i + 1) if j >= 223)
    c1 = t and c[i] > ma(112, i)
    c2 = l[i - 4:i + 1].min() >= l[i - 19:i - 4].min() * 0.99
    c3 = False
    for j in range(i - 42, i - 2):
        a = v[j - 60:j].mean()
        if (a > 0 and v[j] >= 5 * a) or (c[j] / c[j - 1] - 1 >= 0.15):
            c3 = True
            break
    a5 = v[i - 6:i - 1].mean()
    c4 = a5 > 0 and v[i - 1] >= 2 * a5
    c5 = h[i] > h[i - 1] and c[i] >= h[i - 1]
    return [bool(c1), bool(c2), bool(c3), bool(c4), bool(c5)]


# ---------------------------------------------------------------- 성과(signal_backtest.outcome과 동일 규칙, 벡터화)
def outcomes(o, h, l, c):
    n = len(c)
    entry = np.concatenate([o[1:], [np.nan]])
    entry = np.where(entry > 0, entry, np.nan)                       # None/0/음수 진입가 = 무효
    res = {'valid': ~np.isnan(entry), 'gap': entry / c - 1}
    for k in HORIZONS:
        ret = np.full(n, np.nan)
        mfe = np.full(n, np.nan)
        mae = np.full(n, np.nan)
        m = n - 1 - k + 1                                            # i + k <= n-1  ->  i in [0, n-1-k]
        if m > 0:
            idx = np.arange(m)
            ret[:m] = c[idx + k] / entry[:m] - 1
            win_h = np.lib.stride_tricks.sliding_window_view(h[1:], k)[:m]
            win_l = np.lib.stride_tricks.sliding_window_view(l[1:], k)[:m]
            mfe[:m] = win_h.max(axis=1) / entry[:m] - 1
            mae[:m] = win_l.min(axis=1) / entry[:m] - 1
        res['ret%d' % k], res['mfe%d' % k], res['mae%d' % k] = ret, mfe, mae
    first = np.zeros(n, dtype=np.int8)                               # 0=NONE 1=WIN -1=LOSS
    done = np.zeros(n, dtype=bool)
    for k in range(1, 11):                                           # daily[i+1:i+11] (끝에서는 잘림)
        hk = np.concatenate([h[k:], np.full(k, np.nan)])[:n]
        lk = np.concatenate([l[k:], np.full(k, np.nan)])[:n]
        with np.errstate(invalid='ignore'):
            up = hk / entry - 1 >= 0.05
            down = lk / entry - 1 <= -0.05
        hit_down = down & ~done
        first[hit_down] = -1
        done |= down
        hit_up = up & ~done
        first[hit_up] = 1
        done |= up
    res['first5'] = first
    return res


def apply_cooldown(idx):
    keep, last = [], -999
    for i in idx:
        if i - last <= COOLDOWN:
            continue
        keep.append(i)
        last = i
    return np.array(keep, dtype=int)


# ---------------------------------------------------------------- 데이터 로드·프로파일
def open_ro(db):
    return sqlite3.connect('file:%s?mode=ro' % os.path.abspath(db), uri=True)


def parse_date(d):
    s = str(d).replace('-', '')[:8]
    return int(s)


def profile_sql(conn):
    p = {}
    q = lambda sql: conn.execute(sql).fetchone()
    p['rows'] = q('SELECT COUNT(*) FROM daily_prices')[0]
    p['codes'] = q('SELECT COUNT(DISTINCT code) FROM daily_prices')[0]
    p['dateMin'], p['dateMax'] = q('SELECT MIN(date), MAX(date) FROM daily_prices')
    p['distinctDates'] = q('SELECT COUNT(DISTINCT date) FROM daily_prices')[0]
    p['nullOpen'] = q('SELECT COUNT(*) FROM daily_prices WHERE open IS NULL OR open<=0')[0]
    p['nullHighLowClose'] = q('SELECT COUNT(*) FROM daily_prices WHERE high IS NULL OR low IS NULL OR close IS NULL')[0]
    p['highLtLow'] = q('SELECT COUNT(*) FROM daily_prices WHERE high < low')[0]
    p['zeroVolume'] = q('SELECT COUNT(*) FROM daily_prices WHERE volume IS NULL OR volume<=0')[0]
    per = [r[0] for r in conn.execute('SELECT COUNT(*) FROM daily_prices GROUP BY code')]
    s = pd.Series(per)
    p['rowsPerCode'] = {'min': int(s.min()), 'p25': float(s.quantile(.25)), 'median': float(s.median()),
                        'p75': float(s.quantile(.75)), 'max': int(s.max())}
    p['codesGE250'] = int((s >= MIN_ROWS).sum())
    p['codesGE%d' % (START_I + 1 + 20)] = int((s >= START_I + 21).sum())
    pd_ = pd.Series([r[0] for r in conn.execute('SELECT COUNT(*) FROM daily_prices GROUP BY date')])
    p['codesPerDate'] = {'min': int(pd_.min()), 'median': float(pd_.median()), 'max': int(pd_.max())}
    return p


def load_all(db, min_rows, limit=0):
    conn = open_ro(db)
    codes = [r[0] for r in conn.execute('SELECT code FROM daily_prices GROUP BY code HAVING COUNT(*) >= ? ORDER BY code', (min_rows,))]
    if limit:
        codes = codes[:limit]
    prof = profile_sql(conn)
    stocks = []
    for code in codes:
        rows = conn.execute('SELECT date,open,high,low,close,volume FROM daily_prices WHERE code=? AND close IS NOT NULL ORDER BY date', (code,)).fetchall()
        if len(rows) < min_rows:
            continue
        a = np.array([[parse_date(r[0])] + [np.nan if x is None else float(x) for x in r[1:5]] + [float(r[5] or 0)] for r in rows])
        stocks.append((code, a))
    conn.close()
    return prof, stocks


def anomalies(stocks):
    gaps = jumps = 0
    gap_codes, jump_codes = set(), set()
    for code, a in stocks:
        dt = pd.to_datetime(pd.Series(a[:, 0].astype(int).astype(str)), format='%Y%m%d')
        g = (dt.diff().dt.days > 10).sum()
        r = np.abs(a[1:, 4] / a[:-1, 4] - 1)
        j = int((r > 0.31).sum())
        if g:
            gaps += int(g)
            gap_codes.add(code)
        if j:
            jumps += j
            jump_codes.add(code)
    return {'gapsOver10CalendarDays': gaps, 'codesWithGaps': len(gap_codes),
            'dailyMoveOver31pct': jumps, 'codesWithDailyMoveOver31pct': len(jump_codes)}


# ---------------------------------------------------------------- 집계
def mdd_by_date(dates, net):
    """진입일별 평균 순수익률을 날짜순으로 복리 연결한 에쿼티의 최대낙폭(겹치는 보유·자본 제약 무시한 근사)."""
    df = pd.DataFrame({'d': dates, 'r': net}).groupby('d')['r'].mean().sort_index()
    eq = (1 + df).cumprod()
    peak = eq.cummax()
    return float((eq / peak - 1).min()) if len(eq) else None


def summarize(rec, cost=COST):
    """rec: dict of numpy arrays (같은 길이). 승률 등은 순수익률(왕복 비용 차감) 기준."""
    n = len(rec['gap'])
    row = {'signals': int(n)}
    for k in HORIZONS:
        r = rec['ret%d' % k]
        ok = ~np.isnan(r)
        net = r[ok] - cost
        row['n%d' % k] = int(ok.sum())
        if ok.sum() == 0:
            continue
        row['win%d' % k] = float((net > 0).mean())
        row['avg%d' % k] = float(net.mean())
        row['med%d' % k] = float(np.median(net))
        row['gross%d' % k] = float(r[ok].mean())
        row['mfe%d' % k] = float(np.nanmean(rec['mfe%d' % k]))
        row['mae%d' % k] = float(np.nanmean(rec['mae%d' % k]))
        row['worst%d' % k] = float(net.min())
        row['p5_%d' % k] = float(np.percentile(net, 5))
        if k == 10:
            wins, losses = net[net > 0].sum(), net[net <= 0].sum()
            row['profitFactor10'] = float(wins / abs(losses)) if losses < 0 else None
            row['mdd10_dateCohort'] = mdd_by_date(rec['entryDate'][ok], net)
            row['stdDateCohort10'] = None
    f5 = rec['first5']
    row['first5win'] = float((f5 == 1).mean())
    row['first5loss'] = float((f5 == -1).mean())
    row['first5none'] = float((f5 == 0).mean())
    row['avgGap'] = float(np.nanmean(rec['gap']))
    row['distinctStocks'] = int(len(set(rec['code']))) if 'code' in rec else None
    row['distinctSignalDates'] = int(len(set(rec['signalDate']))) if 'signalDate' in rec else None
    return row


def take(rec, mask):
    return {k: v[mask] for k, v in rec.items()}


def date_matched_baseline(sig, daily_stats):
    """신호가 뜬 날짜(D)의 전종목 평균 net 수익률을 신호 가중으로 평균한 값(시장 흐름 통제)과
    신호별 초과수익을 날짜 군집으로 묶은 t값."""
    out = {}
    for k in HORIZONS:
        s = daily_stats['ret%d' % k]            # DataFrame index=signalDate, sum, cnt
        r = sig['ret%d' % k]
        ok = ~np.isnan(r)
        d = sig['signalDate'][ok]
        m = s.reindex(d)
        base = (m['sum'] / m['cnt']).to_numpy() - COST
        net = r[ok] - COST
        out['base%d' % k] = float(np.nanmean(base))
        ex = pd.DataFrame({'d': d, 'e': net - base}).dropna().groupby('d')['e'].mean()
        out['excess%d' % k] = float((net - base)[~np.isnan(base)].mean())
        out['excessT%d_dateCluster' % k] = float(ex.mean() / (ex.std(ddof=1) / math.sqrt(len(ex)))) if len(ex) > 2 and ex.std(ddof=1) > 0 else None
    return out


def run(args):
    prof, stocks = load_all(args.db, MIN_ROWS, args.limit)
    pdx = None
    if args.apply_signal_backtest_exclusion:
        sys.path.insert(0, os.path.join(HERE, '..', 'cloud-vm'))
        import pattern_detect as pdx
    excl = 0
    groups = {k: [] for k in ('PATTERN', 'C45', 'C123', 'ALL')}
    daily_sum = {k: {} for k in HORIZONS}
    total_codes = 0
    for code, a in stocks:
        if len(a) < START_I + 21:
            continue
        if pdx is not None:
            daily = [{'close': a[-1, 4], 'volume': a[-1, 5]}]
            if pdx.is_excluded_stock({'code': code, 'name': ''}, daily):
                excl += 1
                continue
        total_codes += 1
        o, h, l, c, v = a[:, 1], a[:, 2], a[:, 3], a[:, 4], a[:, 5]
        dates = a[:, 0].astype(int)
        c1, c2, c3, c4, c5 = conditions(o, h, l, c, v)
        oc = outcomes(o, h, l, c)
        n = len(c)
        base = oc['valid'].copy()
        base[:START_I] = False
        base[n - 1] = False
        entry_dates = np.concatenate([dates[1:], [0]])
        def pack(idx):
            rec = {key: oc[key][idx] for key in ('gap', 'first5', 'ret5', 'ret10', 'ret20', 'mfe5', 'mfe10', 'mfe20', 'mae5', 'mae10', 'mae20')}
            rec['signalDate'] = dates[idx]
            rec['entryDate'] = entry_dates[idx]
            rec['code'] = np.array([code] * len(idx))
            return rec
        all_idx = np.where(base)[0]
        groups['ALL'].append(pack(all_idx))
        sig_masks = {'PATTERN': c1 & c2 & c3 & c4 & c5, 'C45': c4 & c5, 'C123': c1 & c2 & c3}
        for name, m in sig_masks.items():
            idx = apply_cooldown(np.where(m & base)[0])
            if len(idx):
                groups[name].append(pack(idx))
    cat = {}
    for name, parts in groups.items():
        cat[name] = {k: np.concatenate([p[k] for p in parts]) for k in parts[0]} if parts else None
    allrec = cat['ALL']
    ds = {}
    for k in HORIZONS:
        r = allrec['ret%d' % k]
        ok = ~np.isnan(r)
        df = pd.DataFrame({'d': allrec['signalDate'][ok], 'r': r[ok]}).groupby('d')['r'].agg(['sum', 'count'])
        df.columns = ['sum', 'cnt']
        ds['ret%d' % k] = df
    result = {'db': os.path.basename(args.db), 'profile': prof, 'anomalies': anomalies(stocks),
              'rules': {'cost': COST, 'cooldown': COOLDOWN, 'startIndex': START_I, 'minRows': MIN_ROWS,
                        'signalBacktestExclusionApplied': bool(pdx), 'excludedCodes': excl, 'stocksUsed': total_codes}}
    result['groups'] = {name: (summarize(rec) if rec is not None else {'signals': 0}) for name, rec in cat.items()}
    if cat['PATTERN'] is not None:
        result['patternVsDateMatchedAll'] = date_matched_baseline(cat['PATTERN'], ds)
        if cat['C45'] is not None:
            result['c45VsDateMatchedAll'] = date_matched_baseline(cat['C45'], ds)
        p = cat['PATTERN']
        years = (p['signalDate'] // 10000)
        result['patternByYear'] = {str(y): summarize(take(p, years == y)) for y in sorted(set(years))}
        sigs = pd.DataFrame({'code': p['code'], 'signalDate': p['signalDate'], 'entryDate': p['entryDate'], 'gap': p['gap'],
                             'ret5': p['ret5'], 'ret10': p['ret10'], 'ret20': p['ret20'],
                             'mfe10': p['mfe10'], 'mae10': p['mae10'], 'first5': p['first5']})
        sigs.to_csv(args.out + '.pattern_signals.csv', index=False)
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=1, default=lambda x: None if isinstance(x, float) and math.isnan(x) else x)
    return result


def print_report(res):
    pr = res['profile']
    print('== 데이터 ==')
    print(' DB 기간 %s ~ %s, 일자 %s, 종목 %s, 행 %s' % (pr['dateMin'], pr['dateMax'], pr['distinctDates'], pr['codes'], pr['rows']))
    print(' 종목당 행수', pr['rowsPerCode'], '| >=250행 종목', pr['codesGE250'], '| 일자당 종목수', pr['codesPerDate'])
    print(' 결측: open<=0/NULL %s, high/low/close NULL %s, high<low %s, 거래량0 %s' % (pr['nullOpen'], pr['nullHighLowClose'], pr['highLtLow'], pr['zeroVolume']))
    print(' 이상치:', res['anomalies'])
    print(' 규칙:', res['rules'])
    print('== 그룹별(순수익률, 왕복비용 %.1f%% 차감) ==' % (COST * 100))
    for name, g in res['groups'].items():
        if g.get('signals', 0) == 0:
            print(' %-8s 신호 0건' % name)
            continue
        line = ' %-8s n=%-8d' % (name, g['signals'])
        for k in HORIZONS:
            if 'win%d' % k in g:
                line += ' | %dd 승률%5.1f%% 평균%+6.2f%% 중앙%+6.2f%%' % (k, g['win%d' % k] * 100, g['avg%d' % k] * 100, g['med%d' % k] * 100)
        print(line)
        print('          10d MFE%+.1f%% MAE%+.1f%% 최악%+.1f%% MDD(일자코호트)%s PF%s | +5선도달 %.1f%% -5선도달 %.1f%% 미도달 %.1f%% | 종목%s 신호일%s' % (
            g.get('mfe10', 0) * 100, g.get('mae10', 0) * 100, g.get('worst10', 0) * 100,
            '%.1f%%' % (g['mdd10_dateCohort'] * 100) if g.get('mdd10_dateCohort') is not None else 'NA',
            '%.2f' % g['profitFactor10'] if g.get('profitFactor10') else 'NA',
            g['first5win'] * 100, g['first5loss'] * 100, g['first5none'] * 100, g.get('distinctStocks'), g.get('distinctSignalDates')))
    for key in ('patternVsDateMatchedAll', 'c45VsDateMatchedAll'):
        if key in res:
            print('==', key, '(같은 신호일의 전종목 평균 대비) ==')
            print(' ', {k: (round(v, 4) if isinstance(v, float) else v) for k, v in res[key].items()})
    if 'patternByYear' in res:
        print('== 패턴 연도별 ==')
        for y, g in res['patternByYear'].items():
            if g.get('n10'):
                print('  %s n=%d 10d 승률%.1f%% 평균%+.2f%%' % (y, g['signals'], g['win10'] * 100, g['avg10'] * 100))


# ---------------------------------------------------------------- 자체 검증
def selftest():
    spec = importlib.util.spec_from_file_location('signal_backtest', os.path.join(HERE, '..', 'analysis', 'signal_backtest.py'))
    sb = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sb)
    rng = np.random.default_rng(7)
    bad = checked = tot_true = 0
    for trial in range(8):
        n = 700
        ret = rng.standard_t(3, n) * 0.02
        ret[rng.random(n) < 0.01] += 0.18
        c = 10000 * np.exp(np.cumsum(ret))
        o = c * (1 + rng.normal(0, 0.01, n))
        h = np.maximum(o, c) * (1 + np.abs(rng.normal(0, 0.012, n)))
        l = np.minimum(o, c) * (1 - np.abs(rng.normal(0, 0.012, n)))
        v = np.exp(rng.normal(12, 0.6, n)) * (1 + 6 * (rng.random(n) < 0.03))
        o[5] = np.nan if trial == 0 else o[5]
        conds = conditions(o, h, l, c, v)
        for i in range(260, n - 1):
            ref = conditions_naive(o, h, l, c, v, i)
            got = [bool(x[i]) for x in conds]
            checked += 1
            tot_true += sum(got)
            if ref != got:
                bad += 1
                if bad < 5:
                    print('조건 불일치', trial, i, ref, got)
        # outcome 대조
        oc = outcomes(o, h, l, c)
        daily = [dict(date=str(i), open=None if np.isnan(o[i]) else o[i], high=h[i], low=l[i], close=c[i], volume=v[i]) for i in range(n)]
        for i in list(range(200, n - 1, 7)) + [n - 2, n - 8, n - 21]:
            ref = sb.outcome(daily, i, c[i])
            if ref is None:
                if oc['valid'][i]:
                    bad += 1
                    print('outcome 무효 불일치', i)
                continue
            for key in ('gap', 'ret5', 'ret10', 'ret20', 'mfe5', 'mfe10', 'mfe20', 'mae5', 'mae10', 'mae20'):
                a, b = ref[key], oc[key][i]
                if (a is None) != bool(np.isnan(b)) or (a is not None and abs(a - b) > 1e-12):
                    bad += 1
                    print('outcome 불일치', i, key, a, b)
            code = {'WIN': 1, 'LOSS': -1, 'NONE': 0}[ref['first5']]
            if code != oc['first5'][i]:
                bad += 1
                print('first5 불일치', i, ref['first5'], oc['first5'][i])
    print('selftest: 조건 대조 %d점(참 %d개), 불일치 %d' % (checked, tot_true, bad))
    return bad == 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db')
    ap.add_argument('--out', default='support_breakout_surge_result.json')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--profile-only', action='store_true')
    ap.add_argument('--selftest', action='store_true')
    ap.add_argument('--apply-signal-backtest-exclusion', action='store_true',
                    help='signal_backtest와 같은 pattern_detect.is_excluded_stock(최신 봉 기준 → 상폐·정지 종목 제외 생존편향) 적용')
    args = ap.parse_args()
    if args.selftest:
        sys.exit(0 if selftest() else 1)
    if not args.db:
        ap.error('--db 필요')
    if args.profile_only:
        conn = open_ro(args.db)
        print(json.dumps(profile_sql(conn), ensure_ascii=False, indent=1))
        return
    print_report(run(args))


if __name__ == '__main__':
    main()
