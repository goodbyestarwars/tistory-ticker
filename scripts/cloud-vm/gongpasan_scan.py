# -*- coding: utf-8 -*-
""""공파산 타점"(역매공파, gongpasan_strategy.py) 전종목 스캔. angle_momentum_scan.py/
rescan_patterns.py와 동일한 방식(SQLite daily_prices만 읽음, 키움 API 재호출 없음, 종목
하나씩 커서 순회)으로 전종목을 훑어 entry_signal(눌림목 매수 타점)이 뜬 최신 후보 목록을
만들고, 같은 종목별 데이터로 백테스트(과거 entry_signal 발생분 전체)까지 함께 돌려
daily_scan_cache.json에 patternScan.patterns.gongpasan(후보 목록) + gongpasanBacktest
(승률/평균수익률 요약)로 저장한다 - 각도기 테스트와 같은 캐시 파일/서빙 경로
(/daily-scan-batch, GAS getPatternScanResult())를 그대로 탄다. 수동 실행 전용(타이머는
setup_gongpasanscan_timer.sh로 등록) - VM에 pandas/numpy가 설치돼 있어야 한다
(accumulation_angle.py 모듈 docstring 참고, 이 저장소엔 requirements.txt가 없어 별도 설치가
필요할 수 있다).

지시서 요구사항대로 angle_momentum_scan.py와는 서로 몰라도 되는 독립 모듈이다(공통 헬퍼를
뽑아 공유하지 않음 - 코드는 비슷해도 두 전략이 서로 영향을 주고받지 않는 게 우선)."""

import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

import db_schema
import gongpasan_strategy as gp
import pattern_detect as pd

FULL_UNIVERSE_URL = 'https://goodbyestarwars.github.io/tistory-ticker/data/krx_map.js'
OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'daily_scan_cache.json')

MAX_MATCHES = pd.PATTERN_MAX_MATCHES

# 스킬 문서에 "점수"라는 개념이 따로 없어서, 낙폭(retreat_pct, 음수일수록 더 바닥)을
# 정렬용 참고 점수로 쓴다 - 더 많이 빠진 뒤 돌파+눌림이 나온 종목을 우선 노출.
def _score_from_retreat(retreat_pct):
    return round(max(0.0, min(89.0, abs(retreat_pct or 0))))


def log(msg):
    print('[gongpasan_scan] ' + msg, flush=True)


def load_universe_metadata():
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
    """다른 패턴 탭과 같은 모양(code/name/price/changeRate/date/miniChart/score/reasons/
    interpretation/patternDetail)으로 바꾼다."""
    last = df.iloc[-1]
    prev = df.iloc[-2] if len(df) > 1 else None
    change_rate = None
    if prev is not None and prev['close']:
        change_rate = float((last['close'] - prev['close']) / prev['close'] * 100)

    mini_chart = [
        {'date': row['date'].strftime('%Y-%m-%d'), 'close': float(row['close'])}
        for _, row in df.tail(20).iterrows()
    ]

    retreat_pct = float(last['retreat_pct']) if last['retreat_pct'] == last['retreat_pct'] else None
    score = _score_from_retreat(retreat_pct)

    reasons = [
        '최근 160일 고점 대비 %.1f%% 낙폭' % (retreat_pct if retreat_pct is not None else 0.0),
        '최근 40일 좁은 횡보(공구리)',
        '최근 60일 내 대량거래 매집봉 확인',
        '5봉 고가·5일선 동시 돌파(오돌이) 후 20일선 눌림목 지지',
    ]
    interpretation = (
        '역배열 바닥권에서 매집봉이 나온 뒤 좁게 다져지다가(공구리), 5봉 고가를 뚫는 장대양봉으로 '
        '5일선을 돌파(오돌이)한 뒤 20일선까지 눌림받아 지지가 확인된 자리입니다. 역매공파 스킬 '
        '기준 매수 타점이며, 확정된 매수 신호는 아닙니다.'
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
            'retreatPct': retreat_pct,
            'blueLine': float(last['blue_line']) if last['blue_line'] == last['blue_line'] else None,
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

    # 낙폭(160일)+공구리(40일)+매집봉(60일) 조회가 안정되려면 최소 이 정도 데이터가 필요하다.
    min_rows_needed = gp.DECLINE_LOOKBACK + 10

    for i, code in enumerate(codes):
        stock_name = name_map.get(code, code)
        stock = {'name': stock_name, 'code': code, 'is_etf': stock_name in etf_names}
        rows = db_schema.load_daily_prices(conn, code)
        if pd.is_excluded_stock(stock, rows):
            continue
        if len(rows) < min_rows_needed:
            continue
        scanned += 1

        df = gp.calculate_gongpasan_signal(code, conn=conn, rows=rows)
        if df.empty:
            continue

        net_returns.extend(gp.backtest_gongpasan(df))

        if bool(df.iloc[-1]['entry_signal']):
            matches.append(_build_match(stock, df))

        if (i + 1) % 300 == 0 or (i + 1) == len(codes):
            log('[%d/%d] 진행 중 (스캔 %d / 후보 %d)' % (i + 1, len(codes), scanned, len(matches)))

    conn.close()

    matches = _rank_and_cap(matches)
    backtest_summary = gp.summarize_backtest(net_returns)
    scan_at = datetime.now(timezone.utc).isoformat()

    existing = {}
    if os.path.exists(OUTPUT_FILE):
        with open(OUTPUT_FILE, 'r', encoding='utf-8') as f:
            existing = json.load(f)

    existing.setdefault('patternScan', {'scanned': 0, 'patterns': {}})
    existing['patternScan'].setdefault('patterns', {})
    existing['patternScan']['patterns']['gongpasan'] = matches
    existing['gongpasanBacktest'] = dict(backtest_summary or {}, timecutDays=gp.DEFAULT_TIMECUT_DAYS) if backtest_summary else None
    existing['gongpasanScannedAt'] = scan_at
    existing.setdefault('universe', len(codes))

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(existing, f, ensure_ascii=False)
    log('저장 완료: %s (스캔 %d / 후보 %d / 백테스트 거래 %d건, 다른 패턴 섹션은 기존 값 유지)'
        % (OUTPUT_FILE, scanned, len(matches), len(net_returns)))


if __name__ == '__main__':
    main()
