# -*- coding: utf-8 -*-
"""증시온도 "그래서 내일은?" 근거 재현 스크립트 (2026-10-04).

운영 API(`/futures?interval=day&days=365`, 공개)로 받은 일봉만 쓴다. 다음 코스피 거래일의 시초 갭·종가 수익률을
미국 전날 마감(나스닥100 선물·SOX·나스닥·S&P500), VIX 변화, 원/달러 변화, 야간선물 일봉과 대조해 상관·방향 일치율을 낸다.
화면(js/market-temp.js TOMORROW_STATS_/TOMORROW_BUCKETS_)의 상수는 이 출력에서 가져왔다.
주의: 야간선물 일봉의 날짜 기준이 확인되지 않아(당일/전일 라벨 해석에 따라 상관이 0.07~0.91로 갈린다) 점수에 쓰지 않는다.
실행: python scripts/analysis/overnight_backtest.py
"""
# -*- coding: utf-8 -*-
import json, urllib.request, math, statistics as st, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
raw = json.load(urllib.request.urlopen('https://goodbyestar.cloud/futures?interval=day&days=365', timeout=60))['data']
S = {r['symbol']: {c['date']: c for c in (r.get('chart') or [])} for r in raw}


def series(sym):
    d = S[sym]
    ds = sorted(d)
    return ds, [float(d[x]['close']) for x in ds], [float(d[x].get('open') or d[x]['close']) for x in ds]


kd, kc, ko = series('KOSPI')
n = len(kd)
kret = {kd[i]: (kc[i] / kc[i - 1] - 1) * 100 for i in range(1, n)}
kgap = {kd[i]: (ko[i] / kc[i - 1] - 1) * 100 for i in range(1, n)}   # 시초 갭
kintra = {kd[i]: (kc[i] / ko[i] - 1) * 100 for i in range(1, n)}


def ret_map(sym):
    ds, cs, _ = series(sym)
    return {ds[i]: (cs[i] / cs[i - 1] - 1) * 100 for i in range(1, len(ds))}


def diff_map(sym):
    ds, cs, _ = series(sym)
    return {ds[i]: cs[i] - cs[i - 1] for i in range(1, len(ds))}


def level_map(sym):
    ds, cs, _ = series(sym)
    return dict(zip(ds, cs))


def prev_date(dates, d):
    """d보다 엄격히 이전 날짜 중 가장 가까운 것"""
    best = None
    for x in dates:
        if x < d:
            best = x
        else:
            break
    return best


def corr(a, b):
    if len(a) < 5:
        return None
    ma, mb = st.mean(a), st.mean(b)
    sa = math.sqrt(sum((x - ma) ** 2 for x in a)); sb = math.sqrt(sum((x - mb) ** 2 for x in b))
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / (sa * sb) if sa and sb else None


def evaluate(name, feat, target, label):
    xs, ys = [], []
    for d in kd[1:]:
        f = feat(d)
        t = target.get(d)
        if f is None or t is None:
            continue
        xs.append(f); ys.append(t)
    if len(xs) < 20:
        print('%-34s %-10s n=%d (표본 부족)' % (name, label, len(xs))); return
    c = corr(xs, ys)
    hit = sum(1 for x, y in zip(xs, ys) if x != 0 and y != 0 and (x > 0) == (y > 0)) / sum(1 for x, y in zip(xs, ys) if x != 0 and y != 0) * 100
    print('%-34s %-10s n=%3d  상관 %+.2f  방향일치 %.0f%%' % (name, label, len(xs), c, hit))


kdates = kd
# 다음 KOSPI 거래일 d에 대해, 직전 KOSPI 거래일 p = prev_date(kd,d)

def feat_kospi_prev(d):
    p = prev_date(kd, d)
    return kret.get(p) if p else None


def make_us_feat(sym):
    m = ret_map(sym)
    ds = sorted(m)

    def f(d):
        # KOSPI d 시초 전에 끝난 미국 정규장 = 날짜 < d 인 가장 가까운 미국 거래일
        p = prev_date(ds, d)
        return m.get(p) if p else None
    return f


night_ret = ret_map('KOSPI200_NIGHT')   # 야간선물 일봉 자체 등락(전일 야간 종가 대비)
day_ret = ret_map('KOSPI200_DAY')
nd, nc, _ = series('KOSPI200_NIGHT')
dd, dc, _ = series('KOSPI200_DAY')
# 야간선물 vs 같은 날짜 주간선물 종가 괴리 = 야간 동안 시장이 본 방향
def feat_night_vs_day(d):
    p = prev_date(kd, d)          # 직전 KOSPI 거래일(주간 마감일)
    # 야간 일봉의 날짜 라벨이 p(시작일)인지 d(종료일)인지 두 가지 모두 시험
    return None

print('=== 다음 KOSPI 거래일 수익률(전일 종가→당일 종가) ===')
tgt_close = kret
tgt_gap = kgap
tgt_intra = kintra
print('표본 기간', kd[0], '~', kd[-1], '거래일', n - 1)
feats = [
    ('미국 나스닥 종합(전날 밤)', make_us_feat('NASDAQ_INDEX')),
    ('미국 S&P500', make_us_feat('SP500_INDEX')),
    ('필라델피아 반도체', make_us_feat('SOX')),
    ('나스닥100 선물', make_us_feat('NASDAQ100')),
    ('코스피 전일 등락(모멘텀)', feat_kospi_prev),
]
for name, f in feats:
    for lab, tg in (('종가수익', tgt_close), ('시초갭', tgt_gap)):
        evaluate(name, f, tg, lab)

# 야간선물: 라벨 날짜 시험 (라벨=d : 그 날 아침 끝난 야간장 / 라벨=이전일)
print()
print('=== 야간선물 등락 (두 가지 날짜 해석) ===')
ns = sorted(night_ret)
def f_night_same(d): return night_ret.get(d)
def f_night_prev(d):
    p = prev_date(ns, d); return night_ret.get(p) if p else None
for name, f in (('야간선물 일봉 등락(라벨=당일)', f_night_same), ('야간선물 일봉 등락(라벨=전일)', f_night_prev)):
    for lab, tg in (('종가수익', tgt_close), ('시초갭', tgt_gap)):
        evaluate(name, f, tg, lab)

# 야간 종가 대비 주간 종가 괴리 (야간선물 종가 vs 직전 KOSPI200 주간선물 종가)
night_c = dict(zip(nd, nc)); day_c = dict(zip(dd, dc))
def f_night_gap_same(d):
    # 라벨=d 인 야간 종가 vs 직전 주간 종가
    p = prev_date(dd, d)
    if d in night_c and p in day_c: return (night_c[d] / day_c[p] - 1) * 100
def f_night_gap_prev(d):
    p = prev_date(dd, d)
    if p in night_c and p in day_c: return (night_c[p] / day_c[p] - 1) * 100
for name, f in (('야간종가÷주간종가 괴리(라벨=당일)', f_night_gap_same), ('야간종가÷주간종가 괴리(라벨=전일)', f_night_gap_prev)):
    for lab, tg in (('종가수익', tgt_close), ('시초갭', tgt_gap)):
        evaluate(name, f, tg, lab)

# 증시온도 구성 지표 중 데이터가 있는 것
print()
print('=== 증시온도 구성 지표(데이터 보유분) -> 다음 거래일 ===')
vix = level_map('VIX'); vd = sorted(vix)
def f_vix_level(d):
    p = prev_date(vd, d); return -vix[p] if p else None      # 낮을수록 좋다고 본 배점 방향
evaluate('VIX 수준(낮을수록 +)', f_vix_level, tgt_close, '종가수익')
vixr = ret_map('VIX'); vrd = sorted(vixr)
def f_vix_chg(d):
    p = prev_date(vrd, d); return -vixr[p] if p else None
evaluate('VIX 변화(내릴수록 +)', f_vix_chg, tgt_close, '종가수익')
fx = ret_map('USDKRW'); fxd = sorted(fx)
def f_fx(d):
    p = prev_date(kd, d); return -fx.get(p) if p and p in fx else None
evaluate('원/달러 변화(내릴수록 +)', f_fx, tgt_close, '종가수익')
us10 = diff_map('US10Y'); u10d = sorted(us10)
def f_us10(d):
    p = prev_date(u10d, d); return -us10[p] if p else None
evaluate('미 10년물 변화(내릴수록 +)', f_us10, tgt_close, '종가수익')

# 같은 날(동행) 관계도 참고: 지표가 '오늘 시장'을 설명하는지
print()
print('=== 참고: 같은 날 동행 관계(설명력) ===')
def same_day(sym_map, sign=1):
    return lambda d: (sign * sym_map.get(d)) if d in sym_map else None
evaluate('원/달러(오를수록 -) 동행', same_day(fx, -1), tgt_close, '당일수익')
evaluate('VIX 변화(오를수록 -) 동행', same_day(vixr, -1), tgt_close, '당일수익')

# 점수 방향성 단순 합성 vs 야간+나스닥 결합
print()
print('=== 결합: 야간선물 + 나스닥 ===')
nas = make_us_feat('NASDAQ_INDEX')
def f_combo(d):
    a = f_night_prev(d); b = nas(d)
    if a is None or b is None: return None
    return a + b
evaluate('야간(전일라벨)+나스닥', f_combo, tgt_close, '종가수익')
def f_combo2(d):
    a = f_night_same(d); b = nas(d)
    if a is None or b is None: return None
    return a + b
evaluate('야간(당일라벨)+나스닥', f_combo2, tgt_close, '종가수익')


print()
print('=== 합성 점수 시험(전반/후반 나눠 확인) ===')
us_feats = {
    'nq100f': make_us_feat('NASDAQ100'),
    'sox': make_us_feat('SOX'),
    'nasdaq': make_us_feat('NASDAQ_INDEX'),
}
vixr_m = ret_map('VIX'); fx_m = ret_map('USDKRW')
def prevval(m, d):
    ds = sorted(m); p = prev_date(ds, d); return m.get(p) if p else None
rows = []
for d in kd[1:]:
    a, b, c = us_feats['nq100f'](d), us_feats['sox'](d), us_feats['nasdaq'](d)
    v = prevval(vixr_m, d); f = prevval(fx_m, d)
    if None in (a, b, c, v, f): continue
    rows.append((d, a, b, c, -v, -f, kret[d], kgap[d]))
def zs(col):
    vals = [r[col] for r in rows]; m = st.mean(vals); s = st.pstdev(vals) or 1
    return m, s
half = len(rows) // 2
def comp(r, cols, stats):
    return sum((r[c] - stats[c][0]) / stats[c][1] for c in cols)
for label, cols in (('나스닥100선물+SOX', (1, 2)), ('나스닥100선물+SOX+VIX변화+환율변화', (1, 2, 4, 5)), ('나스닥100선물만', (1,))):
    train, test = rows[:half], rows[half:]
    stats = {c: (st.mean([r[c] for r in train]), st.pstdev([r[c] for r in train]) or 1) for c in cols}
    for nm, part in (('전반(학습)', train), ('후반(검증)', test)):
        sc = [comp(r, cols, stats) for r in part]
        hit = sum(1 for s_, r in zip(sc, part) if (s_ > 0) == (r[6] > 0)) / len(part) * 100
        hitg = sum(1 for s_, r in zip(sc, part) if (s_ > 0) == (r[7] > 0)) / len(part) * 100
        c_ = corr(sc, [r[6] for r in part])
        # 강한 신호만(상위 30% 절댓값)
        order = sorted(range(len(sc)), key=lambda i: -abs(sc[i]))[:max(1, int(len(sc) * 0.3))]
        hs = sum(1 for i in order if (sc[i] > 0) == (part[i][6] > 0)) / len(order) * 100
        print('%-30s %-9s n=%3d 종가방향 %.0f%% 시초갭방향 %.0f%% 상관 %+.2f | 강한신호 30%% 종가방향 %.0f%%' % (label, nm, len(part), hit, hitg, c_, hs))
# 기준선: 항상 '상승'이라고 답했을 때
base = sum(1 for r in rows if r[6] > 0) / len(rows) * 100
print('기준선: KOSPI 다음날 상승 비율 %.0f%% (아무것도 안 보고 "오른다"만 외쳤을 때)' % base)


print()
print('=== 상수와 구간별 적중률 (전체 표본) ===')
cols = (1, 2, 4, 5)   # 나스닥100선물, SOX, -VIX변화, -환율변화
stats_all = {c: (st.mean([r[c] for r in rows]), st.pstdev([r[c] for r in rows])) for c in cols}
for c, nm in zip(cols, ('nq100f', 'sox', '-vix_chg', '-fx_chg')):
    print(nm, 'mean %.4f std %.4f' % stats_all[c])
sc_all = [sum((r[c] - stats_all[c][0]) / stats_all[c][1] for c in cols) for r in rows]
print('합성 z합 std %.2f' % st.pstdev(sc_all))
# 구간별
bounds = [(-99, -3), (-3, -1.5), (-1.5, 1.5), (1.5, 3), (3, 99)]
for lo, hi in bounds:
    idx = [i for i, s in enumerate(sc_all) if lo <= s < hi]
    if not idx: continue
    g_up = sum(1 for i in idx if rows[i][7] > 0) / len(idx) * 100
    c_up = sum(1 for i in idx if rows[i][6] > 0) / len(idx) * 100
    mg = st.mean(rows[i][7] for i in idx); mc = st.mean(rows[i][6] for i in idx)
    print('z합 %5.1f~%5.1f n=%3d | 시초갭 상승비율 %.0f%% 평균 %+.2f%% | 종가 상승비율 %.0f%% 평균 %+.2f%%' % (lo, hi, len(idx), g_up, mg, c_up, mc))
print('전체 시초갭 상승비율 %.0f%%' % (sum(1 for r in rows if r[7] > 0) / len(rows) * 100))
# 최신 값
last = kd[-1]
print('최신 KOSPI 일자', last)
