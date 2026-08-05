# -*- coding: utf-8 -*-
"""저평가 종목 스캔 - 전종목(data/krx_map.js, ~2,691개)에서 "우량한데 가격이 눌려있는"
종목을 찾아 WICS 대분류 섹터(data/wics-map.js)별로 묶어 캐시한다.

2026-08 전면 개편: 기존 kisyaml 프리셋 전략 10개(scripts/cloud-vm/strategies/*.kis.yaml)는
전부 entry.logic: AND라 "매칭된 종목은 조건을 전부 충족한 것"이 구조적으로 항상 참이 되어
confidence/matched·total이 종목마다 다르게 나올 수가 없었다(늘 100%) - 게다가 단일 지표
스크리너 10개를 그대로 쓰다 보니 "그냥 코스피 목록에서 아무거나 찍는 것과 다를 게 없다"는
피드백을 받았다. 프리셋을 전부 폐기(strategies/ 디렉터리 삭제)하고 완전히 다른 데이터
모델로 다시 만들었다 - kisyaml_strategy.py 엔진(OHLC 지표 조건 평가 전용)은 이번 "저평가"
정의(펀더멘탈 + 가격 조합)를 표현할 수 없어 이 스크립트는 더 이상 그 엔진을 쓰지 않는다.
엔진 코드 자체는 재사용 가능성 때문에 저장소에 남겨뒀다(다른 곳에서 안 씀).

"저평가" 정의(잠정 - 데이터로 재현 가능한 명시적 기준이지 백테스트로 검증된 공식이 아니다):
  1. 품질 게이트: invest_signal.compute_fundamental_score(DART 연간 ROE 60% + 부채비율 40%,
     daily_scan.py의 투자시그널 펀더멘탈 점수와 동일한 이미 검증·운영 중인 공식)가
     FUNDAMENTAL_SCORE_MIN 이상. "저평가"이려면 먼저 "우량"해야 한다는 뜻 - 실적이 나쁜데
     싼 건 저평가가 아니라 밸류트랩일 수 있어서, 새 품질 공식을 만드는 대신 이미 서비스
     중인 펀더멘탈 점수를 그대로 재사용한다.
  2. 가격 게이트: 120일 이동평균 대비 이격도(disparity)가 DISPARITY_MAX 이하. "제 가격
     흐름 대비 눌려있다"를 근사한다 - 이 프로젝트엔 PER/PBR(주가 대비 밸류에이션) 데이터가
     없다(js/foreign-flow.js가 "실시간 밸류에이션은 원천 시세 응답이 없어 표시하지
     않습니다"라고 이미 밝혀둔 상태). 그래서 진짜 PER/PBR 기반 저평가가 아니라 OHLC로
     계산 가능한 "장기 추세 대비 가격 눌림" 근사치를 쓴다는 걸 화면에도 그대로 명시해야
     한다 - 미검증 지표를 확정값처럼 보여주면 안 되므로.

두 조건을 모두 만족하는 종목만 후보가 되고, WICS 대분류 섹터별로 묶어 섹터당 이격도가
가장 낮은(=가장 많이 눌린) 상위 SECTOR_TOP_N개만 남긴다 - "조건 통과자를 무제한으로 다
보여주면 변별력이 없다"는 피드백을 그대로 반영한 설계.

main.py의 /strategy-scan-batch가 이 캐시를 그대로 서빙한다(엔드포인트·파일명·systemd
타이머는 바꾸지 않았다 - VM에 이미 등록된 kiwoom-strategyscan.timer가 이 파일명을 그대로
가리키고 있어서 배포 경로를 유지해야 재등록 없이 그대로 돌아간다)."""

import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

import db_schema
import invest_signal
import pattern_detect

FULL_UNIVERSE_URL = 'https://goodbyestarwars.github.io/tistory-ticker/data/krx_map.js'
WICS_MAP_URL = 'https://goodbyestarwars.github.io/tistory-ticker/data/wics-map.js'
FUNDAMENTALS_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fundamentals_cache.json')
OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'strategy_scan_cache.json')

# 120일 이동평균 계산에 필요한 최소 거래일 수(가격 게이트) - 이보다 짧으면 판정 자체를
# 건너뛴다(상장 얼마 안 된 종목 등).
MIN_BARS = 120

# 최근 20거래일 평균 거래대금(원) 하한 - 이 미만이면 신호 조건과 무관하게 스캔에서 제외.
# 백테스트로 검증한 값이 아니라 "거래 자체가 사실상 어려운 초소형·품절주는 거른다"는
# 취지의 잠정 기준이다.
MIN_AVG_TURNOVER = 1_000_000_000  # 10억원

# 품질 게이트 - invest_signal.compute_fundamental_score()는 0~100점(ROE 60%+부채비율
# 40%). 60점은 "ROE 5%대 이상 + 부채비율 150% 이하" 근방의 조합에서 나오는 수준 -
# 백테스트로 정한 컷오프가 아니라 "썩 나쁘지 않다" 수준의 잠정 기준이다.
FUNDAMENTAL_SCORE_MIN = 60

# 가격 게이트 - 120일 이동평균 대비 종가가 90% 이하(=10% 이상 아래로 눌려있음). 역시
# 백테스트 없이 잡은 잠정 기준.
DISPARITY_MAX = 90

# 섹터당 후보를 몇 개까지 보여줄지 - "조건 통과자를 무제한으로 다 보여주면 코스피 목록
# 찍는 것과 다를 바 없다"는 피드백을 그대로 반영해 이격도가 가장 낮은(가장 많이 눌린)
# 순으로 상위 N개만 남긴다.
SECTOR_TOP_N = 5

METHODOLOGY_NOTE = (
    '펀더멘탈 점수(DART ROE·부채비율 기준) {min_score}점 이상 + 120일 이동평균 대비 '
    '{max_disp}% 이하로 가격이 눌린 종목만 후보로 삼고, 섹터별로 가장 많이 눌린 상위 '
    '{top_n}개만 보여줍니다. PER·PBR 같은 실제 밸류에이션 데이터가 없어 "장기 추세 대비 '
    '가격 눌림"으로 근사한 것이라 진짜 저평가(이익·자산 대비 싼 가격)와는 다를 수 있습니다.'
).format(min_score=FUNDAMENTAL_SCORE_MIN, max_disp=DISPARITY_MAX, top_n=SECTOR_TOP_N)


def log(msg):
    print('[strategy_scan] ' + msg, flush=True)


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
    """gas의 fetchFullUniverse_()/daily_scan.py와 동일한 정규식으로
    window.KRX_MAP={"종목명":"코드",...}를 [{name, code}] 목록으로 파싱."""
    req = urllib.request.Request(FULL_UNIVERSE_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as res:
        text = res.read().decode('utf-8')
    out = []
    for m in re.finditer(r'"([^"]+)":"([0-9A-Za-z]{6})"', text):
        out.append({'name': m.group(1), 'code': m.group(2)})
    return out


def load_wics_map():
    """data/wics-map.js(window.WICS_MAP={"코드":{"name":..,"sector":..,"industry":..},...},
    scripts/fetch_wics_map.py가 생성, js/foreign-flow.js가 프론트에서 쓰는 것과 동일 소스)를
    fetch해서 {code: {name, sector, industry}}로 파싱한다."""
    req = urllib.request.Request(WICS_MAP_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as res:
        text = res.read().decode('utf-8')
    out = {}
    for m in re.finditer(
        r'"([0-9A-Za-z]{6})":\{"name":"([^"]*)","sector":"([^"]*)","industry":"([^"]*)"\}', text
    ):
        out[m.group(1)] = {'name': m.group(2), 'sector': m.group(3), 'industry': m.group(4)}
    return out


def load_fundamentals_cache():
    """batch_scan.py(DART 재무, 전종목 2,691~2,766개, 하루 시간예산 내에서 이어달리기 순회)가
    미리 만들어둔 캐시 - daily_scan.py의 load_fundamentals_cache()와 동일 패턴(같은 VM 로컬
    파일이라 HTTP 호출 없이 그대로 읽는다)."""
    if not os.path.exists(FUNDAMENTALS_CACHE_FILE):
        return {}
    with open(FUNDAMENTALS_CACHE_FILE, 'r', encoding='utf-8') as f:
        cached = json.load(f)
    return cached.get('data') or {}


def sma_last(daily, period, field='close'):
    """daily(오름차순) 마지막 period개 평균 - kisyaml_strategy.py의 _sma와 같은 계산이지만
    시리즈 전체가 아니라 최신 값 하나만 필요해 직접 계산한다."""
    window = daily[-period:]
    if len(window) < period:
        return None
    return sum(row[field] for row in window) / period


def build_match(stock, daily, disparity, fundamental_score, annual):
    last = daily[-1]
    prev = daily[-2] if len(daily) > 1 else None
    change_rate = ((last['close'] - prev['close']) / prev['close'] * 100) if (prev and prev['close']) else None
    return {
        'code': stock['code'],
        'name': stock['name'],
        'price': last['close'],
        'changeRate': change_rate,
        'date': last.get('date'),
        # 종목마다 실제로 달라지는 값 - "다 100%"였던 이전 배지 문제의 재발 방지.
        'disparity': round(disparity, 1),
        'fundamentalScore': fundamental_score,
        'roe': annual.get('latest_roe_pct'),
        'debtRatio': annual.get('latest_debt_ratio_pct'),
    }


def scan(universe, wics_map, fundamentals_cache, conn):
    sectors = {}  # sector_name -> [match, ...] (필터 통과자 전부, 정렬/컷은 이후 일괄)
    scanned = 0
    skipped_no_data = 0
    skipped_illiquid = 0
    skipped_no_sector = 0
    skipped_no_fundamentals = 0

    for stock in universe:
        code = stock['code']
        daily = db_schema.load_daily_prices(conn, code)
        if len(daily) < MIN_BARS:
            skipped_no_data += 1
            continue

        vol_multiple = pattern_detect.compute_volume_multiple(daily)
        if vol_multiple and vol_multiple['avg20'] < MIN_AVG_TURNOVER:
            skipped_illiquid += 1
            continue

        wics = wics_map.get(code)
        if not wics or not wics.get('sector'):
            skipped_no_sector += 1
            continue

        fund_entry = fundamentals_cache.get(code)
        annual = (fund_entry or {}).get('annual')
        fundamental_score = invest_signal.compute_fundamental_score(annual)
        if fundamental_score is None:
            skipped_no_fundamentals += 1
            continue
        scanned += 1
        if fundamental_score < FUNDAMENTAL_SCORE_MIN:
            continue

        sma120 = sma_last(daily, 120)
        if not sma120:
            continue
        disparity = daily[-1]['close'] / sma120 * 100
        if disparity > DISPARITY_MAX:
            continue

        sector = wics['sector']
        sectors.setdefault(sector, []).append(build_match(stock, daily, disparity, fundamental_score, annual))

    for sector in sectors:
        sectors[sector].sort(key=lambda m: m['disparity'])  # 가장 많이 눌린(이격도 낮은) 순
        del sectors[sector][SECTOR_TOP_N:]

    return sectors, scanned, skipped_no_data, skipped_illiquid, skipped_no_sector, skipped_no_fundamentals


def main():
    load_dotenv()

    universe = load_full_universe()
    if not universe:
        log('전종목 유니버스를 못 불러왔습니다.')
        sys.exit(1)
    if '--test' in sys.argv:
        universe = universe[:50]
        log('--test 모드: %d종목만 스모크 테스트' % len(universe))
    log('대상 종목 수: %d' % len(universe))

    wics_map = load_wics_map()
    if not wics_map:
        log('WICS 섹터 맵을 못 불러왔습니다.')
        sys.exit(1)
    log('WICS 섹터 맵 종목 수: %d' % len(wics_map))

    fundamentals_cache = load_fundamentals_cache()
    log('펀더멘탈 캐시 종목 수: %d' % len(fundamentals_cache))

    conn = db_schema.get_conn()
    db_schema.create_schema(conn)

    (sectors, scanned, skipped_no_data, skipped_illiquid,
     skipped_no_sector, skipped_no_fundamentals) = scan(universe, wics_map, fundamentals_cache, conn)

    undervalued_category = {
        'name': '저평가 종목',
        'methodology': METHODOLOGY_NOTE,
        'sectors': {
            sector: {'name': sector, 'matches': matches}
            for sector, matches in sectors.items()
            if matches
        },
    }

    output = {
        'scannedAt': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
        'scanned': scanned,
        'universe': len(universe),
        'skippedNoData': skipped_no_data,
        'skippedIlliquid': skipped_illiquid,
        'skippedNoSector': skipped_no_sector,
        'skippedNoFundamentals': skipped_no_fundamentals,
        # 전략검색은 카테고리 여러 개를 탭으로 보여주는 틀이고, "저평가 종목"은 그 중 첫
        # 카테고리일 뿐이다(2026-08 사용자 피드백 - "전략검색은 냅두고 10개를 1개로
        # 줄이는 거였지, 페이지 자체를 저평가 종목으로 박아버리라는 게 아니었다. 계속
        # 추가할 것"). 그래서 sectors를 최상위에 바로 두지 않고 categories.undervalued
        # 밑에 넣는다 - 다음 카테고리를 추가할 때 이 딕셔너리에 키 하나만 더 넣으면 된다.
        'categories': {
            'undervalued': undervalued_category,
        },
    }

    tmp_path = OUTPUT_FILE + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False)
    os.replace(tmp_path, OUTPUT_FILE)  # 원자적 교체 - 쓰는 도중 /strategy-scan-batch가 읽어도 반쪽 파일을 못 봄

    total_matches = sum(len(s['matches']) for s in undervalued_category['sectors'].values())
    log('완료: 판정 %d / 유니버스 %d, 데이터부족 %d, 유동성부족 %d, 섹터미분류 %d, 펀더멘탈없음 %d'
        % (scanned, len(universe), skipped_no_data, skipped_illiquid, skipped_no_sector, skipped_no_fundamentals))
    log('  섹터 %d개, 저평가 후보 총 %d종목' % (len(undervalued_category['sectors']), total_matches))
    for sector in sorted(undervalued_category['sectors']):
        log('  %s: %d종목' % (sector, len(undervalued_category['sectors'][sector]['matches'])))


if __name__ == '__main__':
    main()
