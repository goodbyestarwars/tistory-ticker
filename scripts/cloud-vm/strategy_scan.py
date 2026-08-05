# -*- coding: utf-8 -*-
"""kisyaml_strategy.py의 프리셋 전략(strategies/*.kis.yaml, 현재 10개)을 전종목
(data/krx_map.js, ~2,691개)에 대해 스캔해 결과를 캐시한다.

daily_scan.py와 달리 키움/KIS API를 전혀 호출하지 않는다 - daily_scan.py가 이미
daily_prices(SQLite)에 채워둔 오름차순 OHLC를 그대로 읽어 kisyaml_strategy.evaluate()에
넣을 뿐이다. 그래서 daily_scan.py가 끝난 뒤에 실행해야 그날 최신 데이터를 본다
(systemd 타이머는 setup_strategyscan_timer.sh로 daily_scan보다 20분 늦게 등록한다).

breakout_fail(돌파 실패)은 카테고리가 "손절"이라 다른 9개(매수 신호)와 의미가 다르다 -
evaluate()는 이 프리셋에서도 entry 조건(전고점을 다시 하회)이 충족되면 그대로
action='BUY'를 돌려주는데(엔진은 프리셋 카테고리를 모른다), 여기서는 이것도 동일하게
"조건 충족 = 매칭"으로 취급해 그대로 캐시에 담는다 - "매수 신호"가 아니라 "이탈 경보"
라는 의미 차이는 화면(프론트)에서 프리셋 category로 구분해 라벨을 다르게 보여줘야 한다.
main.py의 /strategy-scan-batch가 이 캐시를 그대로 서빙한다."""

import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

import db_schema
import kisyaml_strategy

FULL_UNIVERSE_URL = 'https://goodbyestarwars.github.io/tistory-ticker/data/krx_map.js'
OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'strategy_scan_cache.json')


def _resolve_strategies_dir():
    """deploy_check.sh는 scripts/cloud-vm/*.py만 VM의 평평한 $APP_DIR 루트로 복사하고
    strategies/(.kis.yaml, *.py가 아님) 같은 하위 디렉터리는 그대로 두기 때문에, 이 파일이
    실행되는 위치에 따라 실제 전략 파일이 있는 곳이 다르다.
    1) 이 파일과 같은 디렉터리의 strategies/ (저장소를 그대로 쓸 때 - scripts/cloud-vm/에서 실행)
    2) $APP_DIR/scripts/cloud-vm/strategies/ (VM 배포 후 평평하게 복사된 위치에서 실행할 때 -
       $APP_DIR 자체가 git clone이라 이 하위 경로는 git pull로 항상 최신 상태)
    어느 쪽도 없으면 배포/체크아웃이 잘못된 것이므로 명확한 에러를 낸다."""
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(here, 'strategies'),
        os.path.join(here, 'scripts', 'cloud-vm', 'strategies'),
    ]
    for path in candidates:
        if os.path.isdir(path):
            return path
    raise FileNotFoundError('strategies/ 디렉터리를 찾을 수 없습니다. 확인한 경로: %s' % candidates)


# sma60(추세 필터)처럼 최소 60거래일이 있어야 웬만한 프리셋이 의미 있는 값을 낸다.
# week52_high(253일 필요)처럼 더 긴 지표는 데이터가 모자라면 evaluate()가 에러 없이
# 그냥 HOLD를 돌려주므로(조건 값이 None -> False) 별도 처리가 필요 없다.
MIN_BARS = 60


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


def load_presets():
    """strategies/*.kis.yaml 전부를 로드해 {strategy id: 파싱된 전략 dict}로 반환.
    이 디렉터리에 파일을 추가/삭제하기만 하면 스캔 대상이 자동으로 늘고 준다."""
    strategies_dir = _resolve_strategies_dir()
    presets = {}
    for fname in sorted(os.listdir(strategies_dir)):
        if not fname.endswith('.kis.yaml'):
            continue
        strategy = kisyaml_strategy.load_strategy_file(os.path.join(strategies_dir, fname))
        presets[strategy['strategy']['id']] = strategy
    return presets


def build_match(stock, daily, result):
    last = daily[-1]
    prev = daily[-2] if len(daily) > 1 else None
    change_rate = ((last['close'] - prev['close']) / prev['close'] * 100) if (prev and prev['close']) else None
    entry = result.get('entry') or {}
    return {
        'code': stock['code'],
        'name': stock['name'],
        'price': last['close'],
        'changeRate': change_rate,
        'date': result['date'],
        'confidence': result['confidence'],
        # 화면 배지("2/2 충족")용 - kisyaml_strategy.evaluate()의 entry 조건 충족 개수/전체.
        'matched': entry.get('matched'),
        'total': entry.get('total'),
    }


def scan(universe, presets, conn):
    matches = {preset_id: [] for preset_id in presets}
    scanned = 0
    skipped_no_data = 0

    for stock in universe:
        daily = db_schema.load_daily_prices(conn, stock['code'])
        if len(daily) < MIN_BARS:
            skipped_no_data += 1
            continue
        scanned += 1
        for preset_id, strategy in presets.items():
            result = kisyaml_strategy.evaluate(strategy, daily)
            if result['action'] == 'BUY':
                matches[preset_id].append(build_match(stock, daily, result))

    for preset_id in matches:
        matches[preset_id].sort(key=lambda m: m['confidence'], reverse=True)

    return matches, scanned, skipped_no_data


def main():
    load_dotenv()
    presets = load_presets()
    if not presets:
        log('strategies/*.kis.yaml을 못 찾았습니다.')
        sys.exit(1)
    log('대상 프리셋(%d개): %s' % (len(presets), ', '.join(sorted(presets))))

    universe = load_full_universe()
    if not universe:
        log('전종목 유니버스를 못 불러왔습니다.')
        sys.exit(1)
    if '--test' in sys.argv:
        universe = universe[:50]
        log('--test 모드: %d종목만 스모크 테스트' % len(universe))
    log('대상 종목 수: %d' % len(universe))

    conn = db_schema.get_conn()
    db_schema.create_schema(conn)

    matches, scanned, skipped_no_data = scan(universe, presets, conn)

    output = {
        'scannedAt': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
        'scanned': scanned,
        'universe': len(universe),
        'skippedNoData': skipped_no_data,
        'strategies': {
            preset_id: {
                'name': strategy['metadata'].get('name'),
                'category': strategy['strategy'].get('category'),
                'description': strategy['metadata'].get('description'),
                'matches': matches[preset_id],
            }
            for preset_id, strategy in presets.items()
        },
    }

    tmp_path = OUTPUT_FILE + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False)
    os.replace(tmp_path, OUTPUT_FILE)  # 원자적 교체 - 쓰는 도중 /strategy-scan-batch가 읽어도 반쪽 파일을 못 봄

    log('완료: 스캔 %d / 유니버스 %d, 데이터부족 제외 %d' % (scanned, len(universe), skipped_no_data))
    for preset_id in sorted(matches):
        log('  %s: %d종목 매칭' % (preset_id, len(matches[preset_id])))


if __name__ == '__main__':
    main()
