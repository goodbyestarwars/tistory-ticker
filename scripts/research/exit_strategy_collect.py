# -*- coding: utf-8 -*-
"""매도 전략 재검증(연구용)의 자료 수집 - 진입 목록 만들기와 키움 1분봉 내려받기 (2026-10-18).

읽기 전용 연구 도구다. 주문 함수는 호출하지 않는다(KiwoomClient.call 로 분봉 TR ka10080 만 쓴다). 키움 키는 환경변수 이름
KIWOOM_APPKEY / KIWOOM_SECRETKEY 에서만 읽고(PC `.env`를 프로세스 안에서 읽을 뿐, 출력·저장·로그하지 않는다), 받은 분봉은 저장소 밖 폴더에 둔다.

진입 목록(엔진 재현): 실계좌 엔진(PC live_engine.py)은 전날 밤 후보(눌림목·구름대 돌파·쌍바닥·역헤드앤숄더)를 `rank_candidates` 로 순위를 매겨
다음 날 09:00~10:00 에 사는 구조다. 같은 순위 계산을 일봉(네이버 5년 캐시)으로 다시 하고 하루 상위 N개를 진입으로 삼는다(슬롯·예산 상호작용은
무시 - 같은 진입에 매도 규칙만 바꿔 비교하려고).
사용: python exit_strategy_collect.py <hits.json> <naver 캐시 폴더> <출력 폴더> [env 파일] [top_n] [hold_days]
"""
import json
import os
import sys
import time

CODE_OK = lambda c: len(c) == 6 and c.isdigit()
SCANNERS = ('pullback', 'maCloudBreakout', 'doubleBottom', 'invHeadShoulders')


def _number(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def load_daily(cache_dir, code):
    try:
        rows = json.load(open(os.path.join(cache_dir, code + '.json'), encoding='utf-8'))
    except (OSError, ValueError):
        return []
    return [{'date': r[0], 'open': r[1], 'high': r[2], 'low': r[3], 'close': r[4], 'volume': r[5]} for r in rows if r[1] and r[2] and r[3] and r[4]]


def rank_one(bars, scan_date):
    """live_engine.rank_candidates 의 한 종목 점수(같은 필터·같은 점수). 탈락이면 None."""
    bars = [b for b in bars if b['date'] <= scan_date]
    if len(bars) < 21 or bars[-1]['date'] != scan_date:
        return None
    closes = [_number(b['close']) for b in bars[-20:]]
    values = [_number(b['close']) * _number(b['volume']) for b in bars[-20:]]
    ranges = [(_number(b['high']) - _number(b['low'])) / _number(b['close']) for b in bars[-20:] if _number(b['close']) > 0]
    if len(ranges) < 20 or min(closes) <= 0 or min(values) <= 0:
        return None
    avg_value = sum(values) / 20
    volatility = sum(ranges) / 20
    trend = closes[-1] / (sum(closes) / 20) - 1
    if avg_value < 1_000_000_000 or not 0.01 <= volatility <= 0.08 or trend <= 0:
        return None
    return (values[-1] / 1e9, avg_value / 1e9, -abs(volatility - 0.035), trend)


def build_entries(hits, cache_dir, calendar, top_n, hold_days, last_day):
    by_date = {}
    for h in hits:
        if h.get('scanner', '').replace('pattern:', '') in SCANNERS and CODE_OK(str(h.get('code', ''))):
            by_date.setdefault(h['scanDate'], {})[str(h['code'])] = h
    entries = []
    for scan_date in sorted(by_date):
        later = [d for d in calendar if d > scan_date]
        if not later or later[0] > last_day:
            continue
        ranked = []
        for code, h in by_date[scan_date].items():
            score = rank_one(load_daily(cache_dir, code), scan_date)
            if score:
                ranked.append((score, code, h))
        ranked.sort(reverse=True)
        for rank, (score, code, h) in enumerate(ranked[:top_n], 1):
            days = later[:hold_days]
            if days[0] > last_day:
                continue
            entries.append({'scan_date': scan_date, 'entry_day': days[0], 'days': [d for d in days if d <= last_day], 'code': code, 'rank': rank,
                            'name': h.get('name'), 'scanner': h.get('scanner'), 'base': h.get('basePrice')})
    return entries


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
    """ka10080 응답 -> 해당 날짜 정규장(09:00~15:30) 1분봉 [[hhmm, o, h, l, c, v]] 오름차순."""
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


def main(hits_path, cache_dir, out_dir, env_path=None, top_n=5, hold_days=4):
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'quant-autotrade', 'local_bot'))
    from kiwoom import KiwoomClient
    hits = json.load(open(hits_path, encoding='utf-8'))
    calendar = sorted({r[0] for r in json.load(open(os.path.join(cache_dir, '005930.json'), encoding='utf-8'))})
    last_day = calendar[-1]
    entries = build_entries(hits, cache_dir, calendar, int(top_n), int(hold_days), last_day)
    os.makedirs(out_dir, exist_ok=True)
    json.dump(entries, open(os.path.join(out_dir, 'entries.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    print('entries', len(entries), 'dates', len({e['entry_day'] for e in entries}))
    keys = read_env_keys(env_path or os.path.join(os.path.expanduser('~'), 'autotrader', '.env'))
    client = KiwoomClient(keys.get('KIWOOM_APPKEY'), keys.get('KIWOOM_SECRETKEY'))
    need = sorted({(e['code'], d) for e in entries for d in e['days']})
    done = fail = 0
    for code, day in need:
        path = os.path.join(out_dir, '%s_%s.json' % (code, day))
        if os.path.exists(path):
            continue
        try:
            res = client.call('ka10080', '/api/dostk/chart', {'stk_cd': code, 'tic_scope': '1', 'upd_stkpc_tp': '1', 'base_dt': day.replace('-', '')})
            bars = parse_bars(res.get('stk_min_pole_chart_qry'), day)
            json.dump({'code': code, 'day': day, 'bars': bars, 'rc': res.get('return_code')}, open(path, 'w', encoding='utf-8'))
            done += 1
        except Exception as exc:        # 한 건 실패가 전체를 멈추지 않는다(다음 실행에서 이어 받는다)
            fail += 1
            print('fail', code, day, type(exc).__name__)
        if (done + fail) % 50 == 0:
            print('progress', done, fail, 'of', len(need), flush=True)
    print('done', done, 'fail', fail, 'total', len(need))


if __name__ == '__main__':
    main(*sys.argv[1:7])
