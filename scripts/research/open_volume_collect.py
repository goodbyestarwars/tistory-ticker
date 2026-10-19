# -*- coding: utf-8 -*-
"""시초 30분 거래량 돌파 연구(연구용)의 자료 수집 - 층화 표본 계획과 키움 1분봉 내려받기 (2026-10-18).

읽기 전용: KiwoomClient.call 로 분봉 TR ka10080 만 부른다(주문·잔고·계좌 API 없음). 키움 키는 PC `.env`의 KIWOOM_APPKEY/KIWOOM_SECRETKEY 를
프로세스 안에서만 읽고 출력·저장하지 않는다. 받은 분봉은 저장소 밖 폴더에 둔다.

## 표본 선정은 미래 정보를 쓴다 (실시간 신호와 엄격히 구분)
'당일 최종 거래량 / 전일 거래량'(ratio)은 장 마감 뒤에야 아는 값이다. 이 값은 **연구 표본을 고르는 데만** 쓴다. 실시간 신호(시초 30분 누적, 플래그)는
09:00~09:29 분봉만으로 계산하며 ratio 를 어디에도 쓰지 않는다(open_volume_study.py).
시초 30분 누적 거래량이 전일 거래량의 X배 이상이려면 그날 최종 거래량도 전일의 X배 이상이어야 한다(필요조건). 따라서 100% 돌파 후보는 ratio >= 1.0,
150% 돌파 후보는 ratio >= 1.5 구간에 있다. 층(stratum): S0 <0.3(돌파 불가, 정의상 0) · S1 [0.3,0.5) · S2 [0.5,1.0) · S3 [1.0,1.5) · S4 [1.5,2.0) · S5 >=2.0.
- `census` 모드(먼저 시작한 수집): S5 전체(무작위 순서로 받아 중간에 멈춰도 무작위 부분집합) + 날짜별 무작위 기준선(비율 무관 11종목).
- `bands` 모드(보완): S1~S4 각 층에서 날짜별 무작위로 추가 추출. 층·날짜별 모집단 수 N 과 추출 수를 `universe_bands.json` 에 보존한다.
  분석에서 층·날짜별 가중치 N/n 으로 모집단을 추정하고, 표본이 0 인데 모집단이 있는 칸은 '추정 불가'로 센다.
모집단 = 20일 평균 거래대금 30억원 이상, 전일 거래량 > 0 인 종목일(2026-05-01 이후).
사용: python open_volume_collect.py <census|bands> <네이버 일봉 캐시> <출력 폴더> [시작일=2026-05-01] [날짜·층당 추출 수=6] [env 파일]
"""
import json
import os
import random
import sys

MIN_AMOUNT20 = 3e9
STRATA = ('S0', 'S1', 'S2', 'S3', 'S4', 'S5')


def stratum(ratio):
    if ratio < 0.3:
        return 'S0'
    if ratio < 0.5:
        return 'S1'
    if ratio < 1.0:
        return 'S2'
    if ratio < 1.5:
        return 'S3'
    if ratio < 2.0:
        return 'S4'
    return 'S5'


def population(cache_dir, start_day):
    """모집단 전체(종목일) 목록 {day: [(code, ratio, prev_vol)]}."""
    by_day = {}
    for f in sorted(os.listdir(cache_dir)):
        if len(f) != 11 or not f.endswith('.json'):
            continue
        rows = [r for r in json.load(open(os.path.join(cache_dir, f), encoding='utf-8')) if r[1] and r[4]]
        if len(rows) < 300:
            continue
        code = f[:-5]
        cum = [0.0]
        for r in rows:
            cum.append(cum[-1] + r[4] * r[5])
        for i in range(21, len(rows)):
            day = rows[i][0]
            if day < start_day or rows[i - 1][5] <= 0:
                continue
            if (cum[i] - cum[i - 20]) / 20 < MIN_AMOUNT20:
                continue
            by_day.setdefault(day, []).append((code, rows[i][5] / rows[i - 1][5], rows[i - 1][5]))
    return by_day


def census_items(pop, base_per_day, seed=11):
    cands = [{'code': c, 'day': d, 'kind': 'cand', 'ratio': round(r, 3), 'prev_vol': pv} for d, v in pop.items() for c, r, pv in v if r >= 2.0]
    rng = random.Random(seed)
    base = []
    for day, v in sorted(pop.items()):
        for c, r, pv in rng.sample(v, min(base_per_day, len(v))):
            base.append({'code': c, 'day': day, 'kind': 'base'})
    seen = {(c['code'], c['day']) for c in cands}
    items = cands + [b for b in base if (b['code'], b['day']) not in seen]
    random.Random(7).shuffle(items)        # 중간에 멈춰도 받은 부분이 코드 순서에 치우치지 않은 무작위 부분집합
    return items


def band_items(pop, per_cell, collected, seed=23):
    """S1~S4 각 (날짜, 층)에서 이미 받은 것을 뺀 나머지 중 무작위 per_cell 개. 모집단 수와 추출 수를 함께 돌려준다."""
    rng = random.Random(seed)
    plan, cells = [], {}
    for day, v in sorted(pop.items()):
        for s in ('S1', 'S2', 'S3', 'S4'):
            members = [(c, r, pv) for c, r, pv in v if stratum(r) == s]
            fresh = [m for m in members if (m[0], day) not in collected]
            take = rng.sample(fresh, min(per_cell, len(fresh)))
            cells['%s|%s' % (day, s)] = {'N': len(members), 'planned_new': len(take), 'already': len(members) - len(fresh)}
            for c, r, pv in take:
                plan.append({'code': c, 'day': day, 'kind': 'band', 'stratum': s, 'ratio': round(r, 3), 'prev_vol': pv})
    rng.shuffle(plan)
    return plan, cells


# ---- 키움 호출(읽기 전용) ----
def read_env_keys(path):
    keys = {}
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                if k.strip() in ('KIWOOM_APPKEY', 'KIWOOM_SECRETKEY'):
                    keys[k.strip()] = v.strip().strip('"').strip("'")
    return keys


def abs_price(v):
    try:
        return abs(float(str(v).replace(',', '').replace('+', '')))
    except ValueError:
        return 0.0


def parse_bars(rows, day):
    """ka10080 응답 -> 해당 날짜 정규장(09:00~15:30) 1분봉 [[hhmm, o, h, l, c, v]] 오름차순. 라벨은 그 분의 시작."""
    out = {}
    for r in rows or []:
        tm = str(r.get('cntr_tm') or '')
        if len(tm) < 12 or tm[:8] != day.replace('-', ''):
            continue
        hhmm = tm[8:12]
        if not ('0900' <= hhmm <= '1530'):
            continue
        out[hhmm] = [hhmm, abs_price(r.get('open_pric')), abs_price(r.get('high_pric')), abs_price(r.get('low_pric')), abs_price(r.get('cur_prc')),
                     abs_price(r.get('trde_qty'))]
    return [out[k] for k in sorted(out)]


def download(items, out_dir, env_path, label):
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'quant-autotrade', 'local_bot'))
    from kiwoom import KiwoomClient
    keys = read_env_keys(env_path or os.path.join(os.path.expanduser('~'), 'autotrader', '.env'))
    client = KiwoomClient(keys.get('KIWOOM_APPKEY'), keys.get('KIWOOM_SECRETKEY'))
    done = fail = 0
    for it in items:
        path = os.path.join(out_dir, '%s_%s.json' % (it['code'], it['day']))
        if os.path.exists(path):
            continue
        try:
            res = client.call('ka10080', '/api/dostk/chart', {'stk_cd': it['code'], 'tic_scope': '1', 'upd_stkpc_tp': '1', 'base_dt': it['day'].replace('-', '')})
            bars = parse_bars(res.get('stk_min_pole_chart_qry'), it['day'])
            json.dump({'code': it['code'], 'day': it['day'], 'bars': bars, 'rc': res.get('return_code')}, open(path, 'w', encoding='utf-8'))
            done += 1
        except Exception as exc:        # 실패해도 계속(다음 실행에서 이어 받는다)
            fail += 1
            print(label, 'fail', it['code'], it['day'], type(exc).__name__, flush=True)
        if (done + fail) % 200 == 0:
            print(label, 'progress', done, fail, flush=True)
    print(label, 'done', done, 'fail', fail, 'total', len(items), flush=True)


def main(mode, cache_dir, out_dir, start_day='2026-05-01', per_cell=6, env_path=None):
    os.makedirs(out_dir, exist_ok=True)
    pop = population(cache_dir, start_day)
    if mode == 'census':
        items = census_items(pop, 11)
        json.dump({'items': items, 'liquid_counts': {d: len(v) for d, v in pop.items()}}, open(os.path.join(out_dir, 'universe.json'), 'w', encoding='utf-8'), ensure_ascii=False)
        print('census items', len(items), flush=True)
        download(items, out_dir, env_path, 'census')
    elif mode == 'bands':
        collected = {tuple(f[:-5].split('_')) for f in os.listdir(out_dir) if f.endswith('.json') and '_' in f and f[0].isdigit()}
        items, cells = band_items(pop, int(per_cell), collected)
        pops = {}
        for day, v in pop.items():
            pops[day] = {s: sum(1 for c, r, pv in v if stratum(r) == s) for s in STRATA}
        json.dump({'items': items, 'cells': cells, 'population': pops, 'per_cell': int(per_cell)}, open(os.path.join(out_dir, 'universe_bands.json'), 'w', encoding='utf-8'), ensure_ascii=False)
        print('band items', len(items), 'cells', len(cells), flush=True)
        download(items, out_dir, env_path, 'bands')
    else:
        raise SystemExit('mode 는 census 또는 bands')


if __name__ == '__main__':
    main(*sys.argv[1:7])
