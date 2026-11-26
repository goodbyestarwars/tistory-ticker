# -*- coding: utf-8 -*-
"""지지 방어·거래량 재폭발·전일 고가 돌파 단타의 분봉 백테스트 (연구 전용, 주문·자동매매 연결 없음 - 2026-11-26).

일봉 백테스트(`daytrade_support_breakout_study.py`)가 풀지 못한 것 - 같은 날 고가·저가의 순서와 실제 진입 가능한
가격 - 를 1분봉으로 다시 본다. 판정 기준은 결과를 보기 전에 `docs/SUPPORT_BREAKOUT_MINUTE_STUDY_2026-11-26.md`에
고정했다. 신호(4개 조건)는 일봉 연구와 같은 입력(`dt_out_full.csv`)을 쓴다.

서브명령
  fetch   <signals.csv> <일봉 cache 폴더> <분봉 cache 폴더>   KIS 주식일별분봉조회(FHKST03010230)로 D0·D1 1분봉 저장
  analyze <signals.csv> <일봉 cache 폴더> <분봉 cache 폴더> <out.json>

fetch 는 KIS_APPKEY/KIS_APPSECRET 환경변수와 scripts/cloud-vm/kis_client.py 를 쓴다(키는 출력·저장하지 않는다).
"""
import csv
import json
import os
import sys
import time

import numpy as np

COST = 0.004
GAP_MAX = 0.15
OPEN_T, CLOSE_T = '090000', '153000'
LAST_ENTRY_T = '151500'        # 이 시각 이후 진입 신호는 당일 청산 구간이 없어 제외
BURST_MULT = 3.0               # ⓐ 진입 5분봉 거래량 >= 직전 5분봉 평균의 3배
BURST_LOOKBACK, BURST_MIN_BARS = 12, 3
EARLY_BEFORE = '103000'        # ⓑ 진입 시각 < 10:30
MIN_BARS_OK = 292              # 390봉의 75% 미만이면 결측일
HIGH_TOL = 0.01                # 분봉 일중 고가와 일봉 고가가 1% 넘게 다르면 데이터 불일치
SPACING_SEC = 0.12
TPSL = {'X2_TP3_SL3': (0.03, 0.03), 'X3_TP5_SL3': (0.05, 0.03), 'X4_TP5_SL5': (0.05, 0.05)}


# ---------------------------------------------------------------- 분봉 가져오기

def parse_rows(output2, date):
    """KIS output2 → [(hhmmss, o, h, l, c, v)] 오름차순. 해당 날짜의 정규장 시각만 남긴다."""
    bars = {}
    for r in output2 or []:
        if str(r.get('stck_bsop_date') or '') != date:
            continue
        t = str(r.get('stck_cntg_hour') or '').zfill(6)
        if not (OPEN_T <= t <= CLOSE_T):
            continue
        try:
            bars[t] = (t, float(r['stck_oprc']), float(r['stck_hgpr']), float(r['stck_lwpr']),
                       float(r['stck_prpr']), float(r['cntg_vol']))
        except (KeyError, TypeError, ValueError):
            continue
    return [bars[k] for k in sorted(bars)]


def _minus_minute(t):
    h, m = int(t[:2]), int(t[2:4])
    total = h * 60 + m - 1
    return '%02d%02d00' % (total // 60, total % 60)


def fetch_day(call, code, date, max_calls=6):
    """call(code, date, hour) → output2 행 목록(최신순). 120개씩 과거로 넘어가며 하루치를 모은다."""
    got, hour = {}, CLOSE_T
    for _ in range(max_calls):
        rows = parse_rows(call(code, date, hour), date)
        new = [b for b in rows if b[0] not in got]
        for b in new:
            got[b[0]] = b
        if not new:
            break
        earliest = min(b[0] for b in new)
        if earliest <= '090100':
            break
        hour = _minus_minute(earliest)
    return [got[k] for k in sorted(got)]


def make_kis_call(appkey, appsecret):
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'cloud-vm'))
    import kis_client

    token = None
    for attempt in range(3):          # 토큰 발급은 분당 1회 제한(EGW00133) - 다른 프로세스와 겹치면 기다렸다 다시
        try:
            token = kis_client.get_token(appkey, appsecret)
            break
        except RuntimeError as exc:
            if 'EGW00133' not in str(exc) or attempt == 2:
                raise
            time.sleep(65)

    def call(code, date, hour):
        time.sleep(SPACING_SEC)
        params = {'FID_COND_MRKT_DIV_CODE': 'J', 'FID_INPUT_ISCD': code, 'FID_INPUT_HOUR_1': hour,
                  'FID_INPUT_DATE_1': date, 'FID_PW_DATA_INCU_YN': 'Y', 'FID_FAKE_TICK_INCU_YN': ''}
        data = kis_client._get_domestic_quote(
            token, appkey, appsecret, '/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice',
            'FHKST03010230', params)
        return data.get('output2') or []
    return call


# ---------------------------------------------------------------- 신호·일봉

def load_signals(path, since='20251127'):
    out = []
    with open(path, encoding='utf-8', newline='') as fh:
        for r in csv.DictReader(fh):
            if r['d'] >= since:
                out.append((r['code'], r['d']))
    return sorted(set(out), key=lambda x: (x[1], x[0]))


def daily_context(px, date):
    """일봉 목록 px=[[date,o,h,l,c,v]...]에서 date 의 전일 고가·종가, 당일 고가, 다음 거래일을 돌려준다."""
    idx = {r[0]: i for i, r in enumerate(px)}
    i = idx.get(date)
    if i is None or i < 1 or i + 1 >= len(px):
        return None
    return {'prev_high': float(px[i - 1][2]), 'prev_close': float(px[i - 1][4]),
            'day_high': float(px[i][2]), 'next_date': str(px[i + 1][0])}


# ---------------------------------------------------------------- 시뮬레이션

def five_min(bars):
    """1분봉 → 5분봉 [(시작 hhmm00, o, h, l, c, v, 마지막 1분봉 인덱스)]. 시각 라벨 기준 5분 묶음."""
    groups = {}
    for i, b in enumerate(bars):
        key = b[0][:2] + '%02d' % (int(b[0][2:4]) // 5 * 5) + '00'
        groups.setdefault(key, []).append(i)
    out = []
    for key in sorted(groups):
        ids = groups[key]
        seg = [bars[i] for i in ids]
        out.append((key, seg[0][1], max(s[2] for s in seg), min(s[3] for s in seg), seg[-1][4],
                    sum(s[5] for s in seg), ids[-1]))
    return out


def _walk(bars, start, entry, tp, sl):
    """start 번째 봉부터 TP/SL 을 판정한다(같은 봉에서 둘 다 닿으면 손절 우선). 끝까지 안 닿으면 마지막 종가."""
    up, dn = entry * (1 + tp), entry * (1 - sl)
    for b in bars[start:]:
        if b[3] <= dn:
            return -sl
        if b[2] >= up:
            return tp
    return bars[-1][4] / entry - 1


def _evaluate(d0, d1, entry, start, entry_t):
    """진입가·진입 뒤 첫 판정 봉 번호(start)로 청산별 순수익률(비용 차감)을 만든다."""
    res = {'X1_close': d0[-1][4] / entry - 1 - COST}
    for name, (tp, sl) in TPSL.items():
        res[name] = _walk(d0, start, entry, tp, sl) - COST
    if d1:
        res['X5_d1open'] = d1[0][1] / entry - 1 - COST
        res['X6_d1close'] = d1[-1][4] / entry - 1 - COST
    seg = d0[start:] if start < len(d0) else d0[-1:]
    res['MFE'] = max(b[2] for b in seg) / entry - 1
    res['MAE'] = min(b[3] for b in seg) / entry - 1
    res['entry'] = entry
    res['entry_t'] = entry_t
    return res


def simulate(d0, d1, ctx):
    """한 신호의 진입 A(지정가 가정)·B(5분봉 확인 후 다음 봉 시가) 결과. 진입이 없으면 사유 문자열."""
    if not d0:
        return {'skip': 'no_minute'}
    ph, pc = ctx['prev_high'], ctx['prev_close']
    if len(d0) < MIN_BARS_OK:
        return {'skip': 'short_day'}
    if abs(max(b[2] for b in d0) / ctx['day_high'] - 1) > HIGH_TOL:
        return {'skip': 'mismatch'}
    if d0[0][1] >= pc * (1 + GAP_MAX):
        return {'skip': 'gap'}
    first = next((i for i, b in enumerate(d0) if b[2] > ph), None)
    if first is None:
        return {'skip': 'no_break'}
    out = {}
    if d0[first][0] <= LAST_ENTRY_T:
        entry_a = max(ph, d0[first][1])
        out['A'] = _evaluate(d0, d1, entry_a, first + 1, d0[first][0])   # 진입 봉 내부 경로는 모르므로 다음 봉부터
    bars5 = five_min(d0)
    for j, g in enumerate(bars5):
        if g[4] > ph and g[6] >= first:
            nxt = g[6] + 1
            if nxt >= len(d0) or d0[nxt][0] > LAST_ENTRY_T:
                break
            res = _evaluate(d0, d1, d0[nxt][1], nxt, d0[nxt][0])
            prev = [x[5] for x in bars5[max(0, j - BURST_LOOKBACK):j]]
            res['burst'] = (len(prev) >= BURST_MIN_BARS and g[5] >= BURST_MULT * (sum(prev) / len(prev)))
            res['burst_defined'] = len(prev) >= BURST_MIN_BARS
            res['early'] = d0[nxt][0] < EARLY_BEFORE
            out['B'] = res
            break
    if not out:
        return {'skip': 'late_or_unconfirmed'}
    return out


# ---------------------------------------------------------------- 통계

def boot_ci(x, n=2000, seed=7):
    x = np.asarray(x, float)
    if len(x) < 5:
        return None
    rng = np.random.default_rng(seed)
    m = rng.choice(x, size=(n, len(x)), replace=True).mean(axis=1)
    return [round(float(np.percentile(m, 2.5)) * 100, 2), round(float(np.percentile(m, 97.5)) * 100, 2)]


def stat(vals):
    x = np.asarray([v for v in vals if v is not None], float)
    if len(x) == 0:
        return {'n': 0}
    top5_removed = np.sort(x)[:-5] if len(x) > 5 else x[:0]
    w, ls = x[x > 0], x[x <= 0]
    return {'n': int(len(x)), 'mean': round(float(x.mean()) * 100, 2), 'median': round(float(np.median(x)) * 100, 2),
            'win': round(float((x > 0).mean()) * 100, 1),
            'meanNoTop5': round(float(top5_removed.mean()) * 100, 2) if len(top5_removed) else None,
            'ci95': boot_ci(x),
            'pf': round(float(w.sum() / -ls.sum()), 2) if len(ls) and ls.sum() < 0 else None}


EXITS = ['X1_close', 'X2_TP3_SL3', 'X3_TP5_SL3', 'X4_TP5_SL5', 'X5_d1open', 'X6_d1close']


def summarize(events):
    """events: simulate 결과(진입 키 A/B 포함) 리스트 → 진입·분할·청산별 통계."""
    out = {}
    for entry in ('A', 'B'):
        rows = [e[entry] for e in events if entry in e]
        out[entry] = {'events': len(rows),
                      'exits': {k: stat([r.get(k) for r in rows]) for k in EXITS},
                      'MFEmean': round(float(np.mean([r['MFE'] for r in rows])) * 100, 2) if rows else None,
                      'MAEmean': round(float(np.mean([r['MAE'] for r in rows])) * 100, 2) if rows else None}
    rows_b = [e['B'] for e in events if 'B' in e]
    splits = {'burst': [r for r in rows_b if r['burst']],
              'noBurst': [r for r in rows_b if r['burst_defined'] and not r['burst']],
              'burstUndefined': [r for r in rows_b if not r['burst_defined']],
              'early': [r for r in rows_b if r['early']], 'late': [r for r in rows_b if not r['early']]}
    out['B_splits'] = {k: {'events': len(v), 'X1_close': stat([r['X1_close'] for r in v]),
                           'X2_TP3_SL3': stat([r['X2_TP3_SL3'] for r in v])} for k, v in splits.items()}
    return out


# ---------------------------------------------------------------- 실행

def cmd_fetch(signals_csv, daily_dir, minute_dir):
    appkey, appsecret = os.environ.get('KIS_APPKEY', '').strip(), os.environ.get('KIS_APPSECRET', '').strip()
    if not appkey or not appsecret:
        raise SystemExit('KIS_APPKEY/KIS_APPSECRET 환경변수가 필요합니다.')
    call = make_kis_call(appkey, appsecret)
    os.makedirs(minute_dir, exist_ok=True)
    sigs = load_signals(signals_csv)
    done = failed = shown = 0
    for code, date in sigs:
        try:
            px = json.load(open(os.path.join(daily_dir, code + '.json'), encoding='utf-8'))['px']
        except Exception:
            continue
        ctx = daily_context(px, date)
        if not ctx:
            continue
        for d in (date, ctx['next_date']):
            path = os.path.join(minute_dir, '%s_%s.json' % (code, d))
            if os.path.exists(path):
                continue
            try:
                bars = fetch_day(call, code, d)
            except Exception as exc:       # 키·본문은 남기지 않고 종류만 기록
                failed += 1
                print('fail', code, d, type(exc).__name__, str(exc)[:80].replace(appkey, '***'))
                continue
            json.dump({'code': code, 'date': d, 'bars': bars}, open(path, 'w', encoding='utf-8'))
            done += 1
        if (done + failed) // 50 > shown:
            shown = (done + failed) // 50
            print('progress', done, failed, flush=True)
    print('fetched', done, 'failed', failed)


def _load_bars(minute_dir, code, date):
    try:
        return [tuple(b) for b in json.load(open(os.path.join(minute_dir, '%s_%s.json' % (code, date)),
                                                  encoding='utf-8'))['bars']]
    except Exception:
        return []


def cmd_analyze(signals_csv, daily_dir, minute_dir, out_path):
    events, skips = [], {}
    sigs = load_signals(signals_csv)
    for code, date in sigs:
        try:
            px = json.load(open(os.path.join(daily_dir, code + '.json'), encoding='utf-8'))['px']
        except Exception:
            skips['no_daily'] = skips.get('no_daily', 0) + 1
            continue
        ctx = daily_context(px, date)
        if not ctx:
            skips['no_context'] = skips.get('no_context', 0) + 1
            continue
        r = simulate(_load_bars(minute_dir, code, date), _load_bars(minute_dir, code, ctx['next_date']), ctx)
        if 'skip' in r:
            skips[r['skip']] = skips.get(r['skip'], 0) + 1
            continue
        r['code'], r['date'] = code, date
        events.append(r)
    out = {'signals': len(sigs), 'usable': len(events), 'skips': skips, 'cost': COST, 'result': summarize(events)}
    json.dump(out, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    if len(sys.argv) >= 5 and sys.argv[1] == 'fetch':
        cmd_fetch(sys.argv[2], sys.argv[3], sys.argv[4])
    elif len(sys.argv) >= 6 and sys.argv[1] == 'analyze':
        cmd_analyze(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
    else:
        raise SystemExit(__doc__)
