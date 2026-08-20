# -*- coding: utf-8 -*-
""""각도기 테스트"(정규화 세력매집각도, accumulation_angle.py) 전종목 스캔.
rescan_patterns.py와 동일한 방식(SQLite daily_prices만 읽음, 키움 API 재호출 없음, 종목
하나씩 커서 순회)으로 전종목을 훑어 entry_signal이 뜬 최신 후보 목록을 만들고,
같은 종목별 데이터로 5일 보유 백테스트(과거 entry_signal 발생분 전체)까지 함께 돌려
daily_scan_cache.json에 patternScan.patterns.angleMomentum(후보 목록) +
angleMomentumBacktest(승률/평균수익률 요약)로 저장한다 - js/pattern-scan.js의 다른
패턴 탭과 같은 캐시 파일/서빙 경로(/daily-scan-batch, GAS getPatternScanResult())를 그대로
탄다. 수동 실행 전용(타이머는 setup_anglemomentumscan_timer.sh로 등록) - VM에 pandas/numpy가
설치돼 있어야 한다(accumulation_angle.py 모듈 docstring 참고, 이 저장소엔 requirements.txt가
없어 별도 설치가 필요할 수 있다)."""

import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

import accumulation_angle as aa
import db_schema
import pattern_detect as pd

FULL_UNIVERSE_URL = 'https://goodbyestarwars.github.io/tistory-ticker/data/krx_map.js'
OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'daily_scan_cache.json')

# 다른 패턴 탭과 같은 상한(pattern_detect.PATTERN_MAX_MATCHES) - 후보가 너무 많으면 각도값
# (score로 씀) 기준 상위만 남긴다. 각도 기반 판정이라 pattern_detect의 단계별 차트 품질
# 게이트(_quality_gate_matches)는 그대로 재사용하지 않고 단순 정렬 후 자르기만 한다.
MAX_MATCHES = pd.PATTERN_MAX_MATCHES

# 각도값(도, 이론상 -90~90)을 정렬용 참고 점수로 그대로 쓴다 - 실제 "적중률"과는 별개다.
SCORE_CAP = 89

BACKTEST_HOLD_DAYS = aa.DEFAULT_HOLD_DAYS


def log(msg):
    print('[angle_momentum_scan] ' + msg, flush=True)


def load_universe_metadata():
    """Return the code/name map and exact ETF-name list from the shared KRX map
    (rescan_patterns.py의 동일 함수와 같은 소스/파싱 - GitHub Pages 정적 파일 fetch라
    키움 재호출 아님)."""
    req = urllib.request.Request(FULL_UNIVERSE_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as res:
        text = res.read().decode('utf-8')
    names = {}
    for m in re.finditer(r'"([^"]+)":"([0-9A-Za-z]{6})"', text):
        names[m.group(2)] = m.group(1)
    etf_names = set()
    if 'window.KRX_ETF_NAMES=' in text:
        etf_text = text.split('window.KRX_ETF_NAMES=', 1)[1]
        etf_names = set(re.findall(r'"([^"]+)"', etf_text))
    return names, etf_names


def _build_match(stock, df):
    """compute_accumulation_angle()이 만든 DataFrame(마지막 행이 entry_signal=True)을
    다른 패턴 탭과 같은 모양(build_pattern_match_ 계열 - code/name/price/changeRate/date/
    miniChart/score/reasons/interpretation/patternDetail)으로 바꾼다."""
    last = df.iloc[-1]
    prev = df.iloc[-2] if len(df) > 1 else None
    change_rate = None
    if prev is not None and prev['close']:
        change_rate = float((last['close'] - prev['close']) / prev['close'] * 100)

    mini_chart = [
        {'date': row['date'].strftime('%Y-%m-%d'), 'close': float(row['close'])}
        for _, row in df.tail(20).iterrows()
    ]

    angle_short = float(last['angle_short'])
    angle_mid = float(last['angle_mid'])
    angle_long = float(last['angle_long'])
    score = max(0, min(SCORE_CAP, round(angle_short)))

    reasons = [
        '단기 각도 %.1f도' % angle_short,
        '중기 각도 상승 전환',
        '장기 각도 상승 전환',
        '단기 각도 급변(최근 20일 변화폭 표준편차의 1.5배 초과)',
    ]
    interpretation = (
        '이동평균선(단기5·장기20) 각도가 위로 꺾이며 함께 가속되는 구간입니다. '
        '거래량이 아직 크게 늘지 않은 상태에서 각도만 먼저 전환된 경우, 매집 국면 초입일 '
        '가능성이 있으나 확정된 신호는 아닙니다.'
    )
    date_str = last['date'].strftime('%Y-%m-%d')

    return {
        'code': stock['code'],
        'name': stock['name'],
        'price': float(last['close']),
        'changeRate': change_rate,
        'date': date_str,
        'miniChart': mini_chart,
        'score': score,
        'reasons': reasons,
        'interpretation': interpretation,
        'patternDetail': {
            'score': score,
            'reasons': reasons,
            'interpretation': interpretation,
            'signal': {'date': date_str, 'price': float(last['close'])},
            'angleShort': angle_short,
            'angleMid': angle_mid,
            'angleLong': angle_long,
            'scanned_at': datetime.now(timezone.utc).isoformat(),
        },
    }


def _rank_and_cap(matches):
    matches = sorted(matches, key=lambda it: (it.get('score') or 0, it.get('date') or ''), reverse=True)
    return matches[:MAX_MATCHES]


def main():
    name_map, etf_names = load_universe_metadata()
    if not name_map:
        log('전종목 이름 매핑을 못 불러왔습니다.')
        sys.exit(1)

    conn = db_schema.get_conn()
    db_schema.create_schema(conn)

    codes = [r[0] for r in conn.execute('SELECT DISTINCT code FROM daily_prices ORDER BY code').fetchall()]
    if not codes:
        log('daily_prices가 비어있습니다 - daily_scan.py가 아직 안 돌았을 수 있음.')
        sys.exit(1)
    if '--test' in sys.argv:
        codes = codes[:200]
        log('--test 모드: %d종목만 스모크 테스트' % len(codes))
    log('대상 종목 수: %d' % len(codes))

    matches = []
    net_returns = []
    scanned = 0

    for i, code in enumerate(codes):
        stock_name = name_map.get(code, code)
        stock = {'name': stock_name, 'code': code, 'is_etf': stock_name in etf_names}
        rows = db_schema.load_daily_prices(conn, code)
        if pd.is_excluded_stock(stock, rows):
            continue
        if len(rows) < aa.EMA_LONG_LEN * 2:
            # 각도 계산(20구간 shift + 20일 롤링 표준편차)이 안정되려면 최소한 이 정도는
            # 필요하다 - 데이터가 짧으면 각도/erupt_filter가 전부 NaN/False로만 나온다.
            continue
        scanned += 1

        df = aa.compute_accumulation_angle(code, conn=conn, rows=rows)
        if df.empty:
            continue

        net_returns.extend(aa.backtest_entry_signal(df, hold_days=BACKTEST_HOLD_DAYS))

        if bool(df.iloc[-1]['entry_signal']):
            matches.append(_build_match(stock, df))

        if (i + 1) % 300 == 0 or (i + 1) == len(codes):
            log('[%d/%d] 진행 중 (스캔 %d / 후보 %d)' % (i + 1, len(codes), scanned, len(matches)))

    conn.close()

    matches = _rank_and_cap(matches)
    backtest_summary = aa.summarize_backtest(net_returns)
    scan_at = datetime.now(timezone.utc).isoformat()

    existing = {}
    if os.path.exists(OUTPUT_FILE):
        with open(OUTPUT_FILE, 'r', encoding='utf-8') as f:
            existing = json.load(f)

    existing.setdefault('patternScan', {'scanned': 0, 'patterns': {}})
    existing['patternScan'].setdefault('patterns', {})
    existing['patternScan']['patterns']['angleMomentum'] = matches
    existing['angleMomentumBacktest'] = dict(backtest_summary or {}, holdDays=BACKTEST_HOLD_DAYS) if backtest_summary else None
    existing['angleMomentumScannedAt'] = scan_at
    existing.setdefault('universe', len(codes))

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(existing, f, ensure_ascii=False)
    log('저장 완료: %s (스캔 %d / 후보 %d / 백테스트 거래 %d건, 다른 패턴 섹션은 기존 값 유지)'
        % (OUTPUT_FILE, scanned, len(matches), len(net_returns)))


if __name__ == '__main__':
    main()
