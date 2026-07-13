# -*- coding: utf-8 -*-
"""차트패턴(4종)+눌림목+투자시그널을 전종목(data/krx_map.js, ~2,691개) 대상으로 하루 1회 스캔.
기존에 gas/ticker-proxy.gs가 이어달리기(relay) 방식으로 GAS UrlFetchApp 할당량(20,000/일)을
넘기며 돌리던 걸(패턴+눌림목+투자시그널 합쳐 종목당 29페이지 네이버 크롤링) 여기로 이전한다.
네이버 스크래핑 대신 키움 공식 REST API(ka10081 일봉, ka10045 기관/외국인 추이)를 쓰므로
IP 차단 위험이 없고, 종목당 일봉 크롤링을 1회만 해서 세 스캔이 공유한다(kiwoom_market 참고).
systemd timer로 하루 1회 실행 - main.py의 /daily-scan-batch가 결과를 즉시 서빙한다."""

import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone

import db_schema
import invest_signal
import kiwoom_client
import kiwoom_market
import pattern_detect as pd

FULL_UNIVERSE_URL = 'https://goodbyestarwars.github.io/tistory-ticker/data/krx_map.js'
INVESTOR_FLOW_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'investor_flow_cache.json')
OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'daily_scan_cache.json')
THROTTLE_SEC = 0.25


def log(msg):
    print('[daily_scan] ' + msg, flush=True)


def load_dotenv():
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if not os.path.exists(env_path):
        return
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, value = line.partition('=')
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def load_full_universe():
    """data/krx_map.js(window.KRX_MAP={"종목명":"코드",...})를 fetch해서 [{name, code}] 목록으로 파싱.
    gas의 fetchFullUniverse_()와 동일한 정규식."""
    req = urllib.request.Request(FULL_UNIVERSE_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as res:
        text = res.read().decode('utf-8')
    out = []
    for m in re.finditer(r'"([^"]+)":"([0-9A-Za-z]{6})"', text):
        out.append({'name': m.group(1), 'code': m.group(2)})
    return out


def load_flow_cache():
    """batch_scan.py(공매도/대차/연기금, 섹터풀 238종목)가 미리 만들어둔 캐시 - short/pension
    점수 계산에 재사용한다(gas의 fetchInvestorFlowCache_와 동일 소스)."""
    if not os.path.exists(INVESTOR_FLOW_CACHE_FILE):
        return {}
    with open(INVESTOR_FLOW_CACHE_FILE, 'r', encoding='utf-8') as f:
        cached = json.load(f)
    return cached.get('data') or {}


def fresh_signal_state():
    return {
        'scanned': 0,
        'counts': {k: 0 for k in invest_signal.INVEST_SIGNAL_BUCKET_KEYS},
        'buckets': {k: [] for k in invest_signal.INVEST_SIGNAL_BUCKET_KEYS},
        'topForeign': [], 'topInst': [], 'topPension': [], 'improved': [], 'worsened': [],
    }


def save_ohlc_snapshot(conn, code, daily):
    """daily(오름차순 OHLC)를 daily_prices에 UPSERT. rescan_patterns.py 등 후속 스캐너가
    키움 API 재호출 없이 이 스냅샷만 커서 순회하도록 하기 위함 - 종목 하나 처리할 때마다
    바로 써서, 하루 전체 스캔이 중간에 죽어도 그때까지 처리한 종목은 남는다."""
    if not daily:
        return
    conn.executemany(
        'INSERT INTO daily_prices (code, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?) '
        'ON CONFLICT(code, date) DO UPDATE SET open=excluded.open, high=excluded.high, low=excluded.low, '
        'close=excluded.close, volume=excluded.volume',
        [(code, r['date'], r['open'], r['high'], r['low'], r['close'], r['volume']) for r in daily],
    )


def save_investor_flow(conn, code, flow_rows):
    """flow_rows(fetch_institution_trend 결과, 외국인/기관 일별 순매매)를 investor_flow_daily에
    UPSERT. 지금까지는 투자시그널 계산에만 쓰고 버렸던 데이터 - OHLC와 동일한 이유로 저장."""
    if not flow_rows:
        return
    conn.executemany(
        'INSERT INTO investor_flow_daily (code, date, close, change_pct, foreign_net, inst_net) '
        'VALUES (?, ?, ?, ?, ?, ?) '
        'ON CONFLICT(code, date) DO UPDATE SET close=excluded.close, change_pct=excluded.change_pct, '
        'foreign_net=excluded.foreign_net, inst_net=excluded.inst_net',
        [(code, r['date'], r['close'], r['change_pct'], r['foreign_net'], r['inst_net']) for r in flow_rows],
    )


def main():
    load_dotenv()
    appkey = os.environ.get('KIWOOM_APPKEY')
    secretkey = os.environ.get('KIWOOM_SECRETKEY')
    if not appkey or not secretkey:
        log('KIWOOM_APPKEY / KIWOOM_SECRETKEY 환경변수가 필요합니다.')
        sys.exit(1)

    universe = load_full_universe()
    if not universe:
        log('전종목 유니버스를 못 불러왔습니다.')
        sys.exit(1)
    if '--test' in sys.argv:
        universe = universe[:3]
        log('--test 모드: %d종목만 스모크 테스트' % len(universe))
    log('대상 종목 수: %d' % len(universe))

    flow_cache = load_flow_cache()
    token = kiwoom_client.get_token(appkey, secretkey)

    conn = db_schema.get_conn()
    db_schema.create_schema(conn)

    pattern_results = {'risingLows': [], 'doubleBottom': [], 'invHeadShoulders': [], 'boxRangeLow': []}
    pattern_scanned = 0
    pullback_matches = []
    pullback_scanned = 0
    signal_state = fresh_signal_state()

    for i, stock in enumerate(universe):
        code, name = stock['code'], stock['name']
        try:
            daily = kiwoom_market.fetch_daily_ohlc(token, code, max_days=kiwoom_market.OHLC_SNAPSHOT_DAYS)
            save_ohlc_snapshot(conn, code, daily)
            time.sleep(THROTTLE_SEC)

            if len(daily) >= pd.BOX_WINDOW:
                pattern_scanned += 1
                rl = pd.detect_rising_lows(daily)
                if rl and not rl['breakout'] and pd.pattern_grade(rl['score']) and len(pattern_results['risingLows']) < pd.PATTERN_MAX_MATCHES:
                    pattern_results['risingLows'].append(pd.build_pattern_match(stock, daily, rl))

                db = pd.detect_double_bottom(daily)
                if db and not db['breakout'] and pd.pattern_grade(db['score']) and len(pattern_results['doubleBottom']) < pd.PATTERN_MAX_MATCHES:
                    pattern_results['doubleBottom'].append(pd.build_pattern_match(stock, daily, db))

                ihs = pd.detect_inv_head_shoulders(daily)
                if ihs and not ihs['breakout'] and pd.pattern_grade(ihs['score']) and len(pattern_results['invHeadShoulders']) < pd.PATTERN_MAX_MATCHES:
                    pattern_results['invHeadShoulders'].append(pd.build_pattern_match(stock, daily, ihs))

                box = pd.detect_box_range_low(daily)
                if box and pd.pattern_grade(box['score']) and len(pattern_results['boxRangeLow']) < pd.PATTERN_MAX_MATCHES:
                    pattern_results['boxRangeLow'].append(pd.build_pattern_match(stock, daily, box))

            if len(daily) >= 65:
                pullback_scanned += 1
                pullback = pd.detect_pullback(daily)
                if pullback and pd.pattern_grade(pullback['score']) and len(pullback_matches) < pd.PATTERN_MAX_MATCHES:
                    pullback_matches.append(pd.build_pattern_match(stock, daily, pullback))

            flow_rows = kiwoom_market.fetch_institution_trend(token, code)
            save_investor_flow(conn, code, flow_rows)
            time.sleep(THROTTLE_SEC)
            flow = invest_signal.build_flow(flow_rows)
            if flow:
                tech = pd.compute_tech_score(daily)

                entry = flow_cache.get(code)
                short_score = None
                pension_score = None
                if entry:
                    pressure = (entry.get('short') or {}).get('pressure') or {}
                    short_score = pressure.get('score')
                    pension_score = invest_signal.compute_pension_score(entry.get('pension'))

                flow_score = invest_signal.compute_flow_score(flow)
                foreign_inst_score = invest_signal.compute_foreign_inst_score(flow['streak'])
                verdict = invest_signal.compute_verdict(flow_score, foreign_inst_score, tech, short_score, pension_score)

                last = flow['daily'][0]  # 최신일 우선 정렬
                r5 = flow['rolling'].get('5d') or {}
                pension_5d = (entry.get('pension') or {}).get('net_5d') if entry else None
                row = {
                    'code': code,
                    'name': name,
                    'price': last['close'],
                    'changeRate': last['change_pct'],
                    'stars': verdict['stars'],
                    'label': verdict['label'],
                    'foreign5d': r5.get('foreign', 0),
                    'inst5d': r5.get('inst', 0),
                    'pension5d': pension_5d,
                    'shift': invest_signal.foreign_inst_shift_score(flow['rolling']),
                }
                signal_state['scanned'] += 1
                signal_state['counts'][verdict['label']] = signal_state['counts'].get(verdict['label'], 0) + 1
                bucket = signal_state['buckets'].get(verdict['label'])
                if bucket is not None and len(bucket) < invest_signal.INVEST_SIGNAL_BUCKET_CAP:
                    bucket.append([row['code'], row['name'], row['price'], row['changeRate'], row['stars']])

                invest_signal.upsert_ranked(signal_state['topForeign'], row, 'foreign5d', invest_signal.INVEST_SIGNAL_TOP_N, 'desc')
                invest_signal.upsert_ranked(signal_state['topInst'], row, 'inst5d', invest_signal.INVEST_SIGNAL_TOP_N, 'desc')
                invest_signal.upsert_ranked(signal_state['topPension'], row, 'pension5d', invest_signal.INVEST_SIGNAL_TOP_N, 'desc')
                invest_signal.upsert_ranked(signal_state['improved'], row, 'shift', invest_signal.INVEST_SIGNAL_TOP_N, 'desc')
                invest_signal.upsert_ranked(signal_state['worsened'], row, 'shift', invest_signal.INVEST_SIGNAL_TOP_N, 'asc')

            if (i + 1) % 100 == 0 or (i + 1) == len(universe):
                conn.commit()  # 중간에 죽어도 여기까지 처리한 종목의 OHLC는 남도록 주기적으로 커밋
                log('[%d/%d] 진행 중 (패턴 %d / 눌림목 %d / 투자시그널 %d 스캔됨)'
                    % (i + 1, len(universe), pattern_scanned, pullback_scanned, signal_state['scanned']))
        except Exception as e:
            log('[%d/%d] %s(%s) 실패: %s' % (i + 1, len(universe), name, code, e))
            continue

    conn.commit()
    conn.close()

    now = datetime.now(timezone.utc).isoformat()
    payload = {
        'generatedAt': now,
        'universe': len(universe),
        'patternScan': {'scanned': pattern_scanned, 'patterns': pattern_results},
        'pullbackScan': {'scanned': pullback_scanned, 'matches': pullback_matches},
        'investSignal': {
            'scanned': signal_state['scanned'],
            'counts': signal_state['counts'],
            'buckets': signal_state['buckets'],
            'rankings': {
                'foreign': signal_state['topForeign'],
                'inst': signal_state['topInst'],
                'pension': signal_state['topPension'],
                'improved': signal_state['improved'],
                'worsened': signal_state['worsened'],
            },
        },
    }
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False)
    log('저장 완료: %s (패턴 %d / 눌림목 %d / 투자시그널 %d / 전체 %d)'
        % (OUTPUT_FILE, pattern_scanned, pullback_scanned, signal_state['scanned'], len(universe)))


if __name__ == '__main__':
    main()
