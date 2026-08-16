# -*- coding: utf-8 -*-
"""차트패턴(5종)+눌림목+투자시그널을 전종목(data/krx_map.js, ~2,691개) 대상으로 하루 1회 스캔.
기존에 gas/ticker-proxy.gs가 이어달리기(relay) 방식으로 GAS UrlFetchApp 할당량(20,000/일)을
넘기며 돌리던 걸(패턴+눌림목+투자시그널 합쳐 종목당 29페이지 네이버 크롤링) 여기로 이전한다.
네이버 스크래핑 대신 키움 공식 REST API(ka10081 일봉)+KIS 종목별투자자매매동향(일별, 외국인/
기관 순매매)을 쓰므로 IP 차단 위험이 없고, 종목당 일봉 크롤링을 1회만 해서 세 스캔이
공유한다(kiwoom_market 참고). 수급(외국인/기관) 소스는 2026-07-20부터 ka10045(NXT 미포함,
부정확) 대신 fetch_foreign_inst_daily(KIS 우선, 종목분석 페이지와 동일 소스)로 교체됨.
systemd timer로 하루 1회 실행(16:00 KST, KIS TIME LIMIT 15:40 이후라 안전) - main.py의
/daily-scan-batch가 결과를 즉시 서빙한다."""

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
import public_data
import pattern_detect as pd
import swing_model

FULL_UNIVERSE_URL = 'https://goodbyestarwars.github.io/tistory-ticker/data/krx_map.js'
INVESTOR_FLOW_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'investor_flow_cache.json')
FUNDAMENTALS_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fundamentals_cache.json')
OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'daily_scan_cache.json')
MARKET_CAP_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'market_cap_cache.json')
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
    try:
        req = urllib.request.Request(FULL_UNIVERSE_URL, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=20) as res:
            text = res.read().decode('utf-8')
        etf_names = set()
        if 'window.KRX_ETF_NAMES=' in text:
            etf_text = text.split('window.KRX_ETF_NAMES=', 1)[1]
            etf_names = set(re.findall(r'"([^"]+)"', etf_text))
        out = []
        for m in re.finditer(r'"([^"]+)":"([0-9A-Za-z]{6})"', text):
            out.append({'name': m.group(1), 'code': m.group(2), 'is_etf': m.group(1) in etf_names})
        if out:
            return out
    except Exception as primary_error:
        log('GitHub 종목목록 조회 실패, KRX 공공데이터 fallback 시도: %s' % primary_error)

    # 정적 KRX_MAP을 못 읽는 배포/네트워크 장애 때만 KRX상장종목정보를 사용한다.
    return [
        {'name': item['name'], 'code': item['code'], 'market': item.get('market', '')}
        for item in public_data.fetch_krx_universe()
    ]


def load_flow_cache():
    """batch_scan.py(공매도/대차/연기금/반대매매, 섹터풀 238종목)가 미리 만들어둔 캐시 -
    short/pension/credit 점수 계산에 재사용한다(gas의 fetchInvestorFlowCache_와 동일 소스)."""
    if not os.path.exists(INVESTOR_FLOW_CACHE_FILE):
        return {}
    with open(INVESTOR_FLOW_CACHE_FILE, 'r', encoding='utf-8') as f:
        cached = json.load(f)
    return cached.get('data') or {}


def load_fundamentals_cache():
    """batch_scan.py(DART 재무, 전종목 2,691~2,766개, 하루 시간예산 내에서 순회)가 미리
    만들어둔 캐시 - 펀더멘탈 점수 계산에 재사용(2026-07-19 추가). 같은 VM 로컬 파일이라
    HTTP 호출 없이 그대로 읽는다(투자자흐름 캐시와 동일 패턴)."""
    if not os.path.exists(FUNDAMENTALS_CACHE_FILE):
        return {}
    with open(FUNDAMENTALS_CACHE_FILE, 'r', encoding='utf-8') as f:
        cached = json.load(f)
    return cached.get('data') or {}


def load_market_cap_cache():
    if not os.path.exists(MARKET_CAP_CACHE_FILE):
        return {}
    try:
        with open(MARKET_CAP_CACHE_FILE, 'r', encoding='utf-8') as f:
            payload = json.load(f)
        return payload.get('data') or {}
    except (OSError, ValueError):
        return {}


def save_market_cap_cache(cache):
    tmp_path = MARKET_CAP_CACHE_FILE + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump({'updatedAt': datetime.now(timezone.utc).isoformat(), 'data': cache}, f, ensure_ascii=False)
    os.replace(tmp_path, MARKET_CAP_CACHE_FILE)


def market_cap_getter(token, cache):
    """Return a per-run Kiwoom ka10001 market cap callback for box scanning."""
    def get(code):
        if code in cache:
            return cache[code]
        try:
            raw = kiwoom_client.call_tr(token, 'ka10001', '/api/dostk/stkinfo', {'stk_cd': code})
            value = raw.get('mac')
            if isinstance(value, str):
                value = value.replace(',', '').strip()
            value = float(value) if value not in (None, '') else None
        except (TypeError, ValueError, RuntimeError, OSError):
            value = None
        if value is not None:
            cache[code] = value
        return value
    return get


def fresh_signal_state():
    return {
        'scanned': 0,
        'counts': {k: 0 for k in invest_signal.INVEST_SIGNAL_BUCKET_KEYS},
        'buckets': {k: [] for k in invest_signal.INVEST_SIGNAL_BUCKET_KEYS},
        'topForeign': [], 'topInst': [], 'topPension': [], 'improved': [], 'worsened': [],
        # 2026-07-20: 종목분석 페이지 가중치 탭(수급/외국인·기관/기술적/공매도/펀더멘탈) 통합용 신규 랭킹.
        'topFlow': [], 'topForeignInst': [], 'topTech': [], 'topShortSafe': [], 'topFundamental': [],
        'swingScanned': 0, 'swingCandidates': [], 'swingRegimeCounts': {}, 'swingEventCounts': {},
        'swingWaveCoverage': {
            'total': 0, 'bigAvailable': 0, 'bigInsufficient': 0,
            'midAvailable': 0, 'smallAvailable': 0, 'sampleDaysMin': None, 'sampleDaysMax': None,
        },
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
    """flow_rows(fetch_foreign_inst_daily 결과, 개인/외국인/기관 일별 순매매)를 investor_flow_daily에
    UPSERT. 지금까지는 투자시그널 계산에만 쓰고 버렸던 데이터 - OHLC와 동일한 이유로 저장."""
    db_schema.upsert_investor_flow_daily(conn, code, flow_rows)


def main():
    load_dotenv()
    appkey = os.environ.get('KIWOOM_APPKEY')
    secretkey = os.environ.get('KIWOOM_SECRETKEY')
    if not appkey or not secretkey:
        log('KIWOOM_APPKEY / KIWOOM_SECRETKEY 환경변수가 필요합니다.')
        sys.exit(1)
    # 2026-07-20: 수급 랭킹(외국인/기관 순매수 TOP20)이 ka10045(NXT 미포함, stex_tp 파라미터
    # 자체가 없는 구조적 한계) 기반이라 종목분석 페이지(KIS UN 기반, foreign-flow.js)와
    # 값이 완전히 다르게 나오는 문제가 실측 확인됨(예: SK하이닉스 5일 외국인 순매수가 여기선
    # +16,830,892인데 종목분석 페이지는 -783,700) - 아래에서 kis_appkey/secret이 있으면
    # fetch_foreign_inst_daily(KIS 우선)로 전환한다. 미설정이면 그 함수 내부 폴백으로 예전
    # ka10045 경로가 그대로 쓰이므로 하위 호환됨.
    kis_appkey = os.environ.get('KIS_APPKEY')
    kis_appsecret = os.environ.get('KIS_APPSECRET')
    if not kis_appkey or not kis_appsecret:
        log('KIS_APPKEY / KIS_APPSECRET 미설정 - 수급 랭킹이 예전 ka10045 폴백 경로로 계산됩니다(부정확할 수 있음).')

    universe = load_full_universe()
    if not universe:
        log('전종목 유니버스를 못 불러왔습니다.')
        sys.exit(1)
    if '--test' in sys.argv:
        universe = universe[:3]
        log('--test 모드: %d종목만 스모크 테스트' % len(universe))
    log('대상 종목 수: %d' % len(universe))

    flow_cache = load_flow_cache()
    fundamentals_cache = load_fundamentals_cache()
    market_cap_cache = load_market_cap_cache()
    market_cap_run_cache = {}
    token = kiwoom_client.get_token(appkey, secretkey)
    get_market_cap = market_cap_getter(token, market_cap_run_cache)

    conn = db_schema.get_conn()
    db_schema.create_schema(conn)

    today_str = datetime.now().strftime('%Y-%m-%d')  # VM 서버 로컬 날짜 - kiwoom_market의 base_dt 계산과 동일 기준

    pattern_results = {
        'risingLows': [], 'maCloudBreakout': [], 'doubleBottom': [], 'invHeadShoulders': [],
        'boxRangeLow': [], 'openingGap': [],
    }
    pattern_scanned = 0
    pullback_matches = []
    pullback_scanned = 0
    ohlc_skipped = 0
    flow_skipped = 0
    signal_state = fresh_signal_state()

    for i, stock in enumerate(universe):
        code, name = stock['code'], stock['name']
        try:
            if db_schema.latest_date(conn, 'daily_prices', code) == today_str:
                daily = db_schema.load_daily_prices(conn, code)
                ohlc_skipped += 1
            else:
                daily = kiwoom_market.fetch_daily_ohlc(token, code, max_days=kiwoom_market.OHLC_SNAPSHOT_DAYS)
                save_ohlc_snapshot(conn, code, daily)
                conn.commit()
                time.sleep(THROTTLE_SEC)

            scanned_p, scanned_pb = pd.scan_stock(
                stock, daily, pattern_results, pullback_matches, market_cap_getter=get_market_cap,
                require_common_market_cap=True)
            if scanned_p:
                pattern_scanned += 1
            if scanned_pb:
                pullback_scanned += 1

            flow_rows = db_schema.load_investor_flow_daily(conn, code)
            has_confirmed_individual = bool(flow_rows and flow_rows[0].get('ind_net') is not None)
            if flow_rows and flow_rows[0].get('date') == today_str and has_confirmed_individual:
                flow_skipped += 1
            else:
                # target_days=25: rolling 20일 합산에 여유분만 더한 최소치(fetch_institution_trend가
                # 정확도가 떨어져 KIS 기반으로 교체됨, 위 main() 주석 참고) - KIS는 한 번에 약
                # 30영업일을 주므로 이 정도면 추가 페이지네이션 호출 없이 1콜로 끝난다.
                flow_rows = kiwoom_market.fetch_foreign_inst_daily(token, code, kis_appkey, kis_appsecret, target_days=25)
                save_investor_flow(conn, code, flow_rows)
                conn.commit()  # 종목마다 즉시 커밋 - 쓰기 트랜잭션을 오래 쥐고 있으면 다른 스크립트(migrate_*.py)가 락에 걸림
                time.sleep(THROTTLE_SEC)
            flow = invest_signal.build_flow(flow_rows)
            if flow:
                tech = pd.compute_tech_score(daily)

                entry = flow_cache.get(code)
                short_score = None
                short_ratio = None
                pension_score = None
                credit_score = None
                if entry:
                    pressure = (entry.get('short') or {}).get('pressure') or {}
                    short_score = pressure.get('score')
                    short_ratio = (entry.get('short') or {}).get('today_ratio_pct')
                    pension_score = invest_signal.compute_pension_score(entry.get('pension'))
                    credit_score = invest_signal.compute_credit_score(entry.get('credit'))

                fund_entry = fundamentals_cache.get(code)
                fundamental_score = invest_signal.compute_fundamental_score(
                    (fund_entry or {}).get('annual')
                )

                flow_score = invest_signal.compute_flow_score(flow)
                foreign_inst_score = invest_signal.compute_foreign_inst_score(flow['streak'])
                verdict = invest_signal.compute_verdict(flow_score, foreign_inst_score, tech, short_score, pension_score,
                                                         credit_score, fundamental_score)

                assessment = swing_model.build_swing_assessment(
                    daily, flow_score=flow_score, foreign_inst_score=foreign_inst_score,
                    fundamental_score=fundamental_score, short_score=short_score,
                    entry=entry, legacy=verdict,
                )

                last = flow['daily'][0]  # 최신일 우선 정렬
                r5 = flow['rolling'].get('5d') or {}
                pension_5d = (entry.get('pension') or {}).get('net_5d') if entry else None
                row = {
                    'code': code,
                    'name': name,
                    'price': last['close'],
                    'changeRate': last['change_pct'],
                    'stars': verdict['stars'],
                    'score': verdict['score'],
                    'tradingValue': last['close'] * (last.get('volume') or 0),
                    'label': verdict['label'],
                    'foreign5d': r5.get('foreign', 0),
                    'inst5d': r5.get('inst', 0),
                    'pension5d': pension_5d,
                    'shift': invest_signal.foreign_inst_shift_score(flow['rolling']),
                    # 2026-07-20: 종목분석 페이지 가중치 탭 랭킹용(작업지시서 - 수급/외국인·기관/
                    # 기술적/공매도/펀더멘탈 TOP20). shortRatio는 낮을수록 좋아서(공매도 비중 적음)
                    # upsert_ranked를 asc로 호출한다(아래).
                    'flowScore': flow_score,
                    'foreignInstSum5d': r5.get('foreign', 0) + r5.get('inst', 0),
                    'techScore': tech.get('score') if tech else None,
                    'shortRatio': short_ratio,
                    'fundamentalScore': fundamental_score,
                    # 기존 score/stars/label은 API 하위 호환·회귀 비교용이다.
                    # 화면의 최종 의견과 주간 후보 판정에는 assessment만 사용한다.
                    'swing': assessment,
                }
                signal_state['scanned'] += 1
                signal_state['swingScanned'] += 1
                regime_key = (assessment.get('chartRegime') or {}).get('key') or 'neutral'
                signal_state['swingRegimeCounts'][regime_key] = signal_state['swingRegimeCounts'].get(regime_key, 0) + 1
                event_key = (assessment.get('recentEvent') or {}).get('key') or 'none'
                signal_state['swingEventCounts'][event_key] = signal_state['swingEventCounts'].get(event_key, 0) + 1
                coverage = signal_state['swingWaveCoverage']
                waves = assessment.get('waves') or {}
                big_wave = waves.get('big') or {}
                mid_wave = waves.get('mid') or {}
                small_wave = waves.get('small') or {}
                sample_days = big_wave.get('sampleDays')
                coverage['total'] += 1
                coverage['bigAvailable'] += int(bool(big_wave.get('available')))
                coverage['bigInsufficient'] += int(not big_wave.get('available'))
                coverage['midAvailable'] += int(bool(mid_wave.get('available')))
                coverage['smallAvailable'] += int(bool(small_wave.get('available')))
                if isinstance(sample_days, int):
                    coverage['sampleDaysMin'] = sample_days if coverage['sampleDaysMin'] is None else min(coverage['sampleDaysMin'], sample_days)
                    coverage['sampleDaysMax'] = sample_days if coverage['sampleDaysMax'] is None else max(coverage['sampleDaysMax'], sample_days)
                as_of_date = last.get('date') or today_str
                db_schema.upsert_swing_snapshot(conn, {
                    'asOfDate': as_of_date, 'code': code, 'name': name,
                    'modelVersion': assessment.get('modelVersion'), 'close': last.get('close'),
                    'createdAt': datetime.now(timezone.utc).isoformat(),
                    **assessment,
                })
                if swing_model.is_four_week_candidate(assessment):
                    signal_state['swingCandidates'].append(row)
                signal_state['counts'][verdict['label']] = signal_state['counts'].get(verdict['label'], 0) + 1
                bucket = signal_state['buckets'].get(verdict['label'])
                if bucket is not None and len(bucket) < invest_signal.INVEST_SIGNAL_BUCKET_CAP:
                    # 뒤 2개 필드는 2026-07-28 전체 목록 정렬용. 앞 5개 순서는 기존 프론트와
                    # 호환 유지: [code,name,price,changeRate,stars,totalScore,tradingValue].
                    bucket.append([row['code'], row['name'], row['price'], row['changeRate'], row['stars'],
                                   row['score'], row['tradingValue']])

                invest_signal.upsert_ranked(signal_state['topForeign'], row, 'foreign5d', invest_signal.INVEST_SIGNAL_TOP_N, 'desc')
                invest_signal.upsert_ranked(signal_state['topInst'], row, 'inst5d', invest_signal.INVEST_SIGNAL_TOP_N, 'desc')
                invest_signal.upsert_ranked(signal_state['topPension'], row, 'pension5d', invest_signal.INVEST_SIGNAL_TOP_N, 'desc')
                invest_signal.upsert_ranked(signal_state['improved'], row, 'shift', invest_signal.INVEST_SIGNAL_TOP_N, 'desc')
                invest_signal.upsert_ranked(signal_state['worsened'], row, 'shift', invest_signal.INVEST_SIGNAL_TOP_N, 'asc')

                invest_signal.upsert_ranked(signal_state['topFlow'], row, 'flowScore', invest_signal.INVEST_SIGNAL_TOP_N, 'desc')
                invest_signal.upsert_ranked(signal_state['topForeignInst'], row, 'foreignInstSum5d', invest_signal.INVEST_SIGNAL_TOP_N, 'desc')
                invest_signal.upsert_ranked(signal_state['topTech'], row, 'techScore', invest_signal.INVEST_SIGNAL_TOP_N, 'desc')
                invest_signal.upsert_ranked(signal_state['topShortSafe'], row, 'shortRatio', invest_signal.INVEST_SIGNAL_TOP_N, 'asc')
                invest_signal.upsert_ranked(signal_state['topFundamental'], row, 'fundamentalScore', invest_signal.INVEST_SIGNAL_TOP_N, 'desc')

            if (i + 1) % 100 == 0 or (i + 1) == len(universe):
                log('[%d/%d] 진행 중 (패턴 %d / 눌림목 %d / 투자시그널 %d 스캔됨, OHLC스킵 %d / 수급스킵 %d)'
                    % (i + 1, len(universe), pattern_scanned, pullback_scanned, signal_state['scanned'],
                       ohlc_skipped, flow_skipped))
        except Exception as e:
            log('[%d/%d] %s(%s) 실패: %s' % (i + 1, len(universe), name, code, e))
            continue

    conn.commit()
    conn.close()

    market_cap_cache.update(market_cap_run_cache)
    save_market_cap_cache(market_cap_cache)
    signal_state['swingCandidates'].sort(
        key=lambda item: item.get('swing', {}).get('internalPriorityScore', 0), reverse=True)
    signal_state['swingCandidates'] = signal_state['swingCandidates'][:100]
    pd.finalize_pattern_results(pattern_results, pullback_matches)
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
                'flow': signal_state['topFlow'],
                'foreignInst': signal_state['topForeignInst'],
                'tech': signal_state['topTech'],
                'shortSafe': signal_state['topShortSafe'],
                'fundamental': signal_state['topFundamental'],
            },
        },
        'swingScan': {
            'modelVersion': swing_model.MODEL_VERSION,
            'scanned': signal_state['swingScanned'],
            'regimeCounts': signal_state['swingRegimeCounts'],
            'eventCounts': signal_state['swingEventCounts'],
            'waveCoverage': signal_state['swingWaveCoverage'],
            'candidates': signal_state['swingCandidates'],
            'basis': '차트 국면 관문 → 모멘텀·펀더멘털 확인 → 위험 필터, 국내 전용',
        },
    }
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False)
    log('저장 완료: %s (패턴 %d / 눌림목 %d / 투자시그널 %d / 전체 %d, 오늘자 이미 있어 API 스킵: OHLC %d / 수급 %d)'
        % (OUTPUT_FILE, pattern_scanned, pullback_scanned, signal_state['scanned'], len(universe),
           ohlc_skipped, flow_skipped))


if __name__ == '__main__':
    main()
