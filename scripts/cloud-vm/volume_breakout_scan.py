# -*- coding: utf-8 -*-
"""전일 거래량을 개장 10분 만에 넘어선 종목을 찾는 장중 1회 스냅샷 스캔.

2026-09-04 요청: "차트검색에 전일 거래량이 오늘 10분 만에 돌파한거 추가".

판정 방식이 다른 스캐너와 다르다. 차트검색의 기존 탭은 전부 daily_scan.py가 장 마감 뒤
하루 1회 돌리는 일봉 패턴이지만, 이 조건은 "개장 후 10분"이라는 시각이 조건의 일부라
그 순간에 한 번 찍어야만 알 수 있다. 그래서 09:10 KST에 한 번 실행하는 별도 타이머로 둔다
(setup_volumebreakout_timer.sh). 장중 계속 감시할 이유는 없다 - "10분 안에 넘었는가"는
09:10에 확정되고 그 뒤로는 바뀌지 않는다.

대상 종목:
    전 종목의 장중 누적 거래량을 09:10에 훑으려면 종목당 API 호출이 필요해 현실적이지
    않다. 대신 KIS 순위 API가 주는 당일 거래량·거래대금·거래증가율 상위 목록을 후보로
    쓴다. 전일 하루치 거래량을 10분 만에 넘긴 종목은 그 시각 당일 거래량 최상위권에
    있을 수밖에 없으므로 이 후보군으로 대부분 잡힌다. 다만 순위 API가 돌려주는 개수
    상한(섹션당 40) 밖으로 밀린 종목은 놓칠 수 있다 - 완전 탐색이 아니라는 뜻이다.

비교 대상:
    오늘 누적 거래량은 순위 응답의 trade_volume, 전일 거래량은 daily_prices 테이블의
    가장 최근 영업일 volume이다. 둘 다 의미가 분명한 값만 쓴다 - KIS 순위 API의
    거래증가율(vol_inrt)은 무엇 대비 증가율인지 이 저장소에서 확인된 바가 없어
    판정에 쓰지 않는다(CLAUDE.md: 미검증 API 필드를 확정값처럼 쓰지 않는다).
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import daily_scan_cache
import db_schema
import market_board

KST = timezone(timedelta(hours=9))

# 순위 API 한 섹션이 돌려주는 최대 개수(market_board가 40으로 상한을 건다).
RANK_LIMIT = 40
# 후보를 모을 순위 섹션. 당일 거래가 몰린 종목을 서로 다른 각도로 담고 있어 합치면
# 한 섹션만 볼 때보다 놓치는 종목이 줄어든다.
CANDIDATE_SECTIONS = ('tradeVolume', 'tradeAmount', 'volumeGrowth')
# 화면에 싣는 최대 종목 수. 배수가 높은 순으로 자른다.
MAX_MATCHES = 40


def log(msg):
    print('[volume_breakout_scan] ' + msg, flush=True)


def today_kst():
    return datetime.now(KST).strftime('%Y-%m-%d')


def collect_candidates(board):
    """순위 섹션들을 합쳐 code -> row로 정리한다. 같은 종목이 여러 섹션에 나오면 한 번만."""
    sections = (board or {}).get('sections') or {}
    candidates = {}
    for name in CANDIDATE_SECTIONS:
        for row in (sections.get(name) or []):
            code = (row.get('code') or '').strip()
            if not code or code in candidates:
                continue
            candidates[code] = row
    return candidates


def previous_volume(conn, code, today):
    """daily_prices에서 오늘 이전 가장 최근 영업일의 거래량.

    오늘 날짜 행이 이미 들어와 있을 수 있으므로(장중 갱신 등) 오늘은 건너뛴다.
    그러지 않으면 오늘 거래량을 오늘 거래량과 비교하게 된다.
    """
    rows = db_schema.load_daily_prices(conn, code) or []
    for row in reversed(rows):
        if row.get('date') and row['date'] < today and row.get('volume'):
            return float(row['volume']), row['date']
    return None, None


def build_match(code, row, today_volume, prev_volume, prev_date, scanned_at):
    ratio = today_volume / prev_volume
    return {
        'code': code,
        'name': row.get('name') or code,
        'price': row.get('price'),
        'changeRate': row.get('change_rate'),
        'date': today_kst(),
        # 다른 패턴 탭과 같은 모양을 유지한다(js/pattern-scan.js가 공통 렌더를 쓴다).
        # 이 스캔은 일봉 20개를 들고 있지 않으므로 miniChart는 비운다 - 프론트가
        # "상세 가격 흐름 데이터 없음"으로 처리한다.
        'miniChart': [],
        'score': min(100, int(round(ratio * 50))),
        'reasons': [
            '개장 10분 시점 누적 거래량 %s주' % format(int(today_volume), ','),
            '전일(%s) 거래량 %s주' % (prev_date, format(int(prev_volume), ',')),
            '전일 대비 %.2f배' % ratio,
        ],
        'interpretation': (
            '개장 10분 만에 전일 하루치 거래량을 넘어섰습니다(%.2f배). 거래가 갑자기 몰린 '
            '자리라는 뜻이며, 방향(상승·하락)은 이 조건만으로 판단하지 않습니다.' % ratio
        ),
        'patternDetail': {
            'score': min(100, int(round(ratio * 50))),
            'todayVolume': int(today_volume),
            'prevVolume': int(prev_volume),
            'prevDate': prev_date,
            'volumeRatio': round(ratio, 4),
            'scanned_at': scanned_at,
        },
    }


def scan(board, conn, scanned_at):
    """후보 중 오늘 누적 거래량 >= 전일 거래량인 종목을 배수 내림차순으로 돌려준다."""
    candidates = collect_candidates(board)
    today = today_kst()
    matches = []
    for code, row in candidates.items():
        today_volume = row.get('trade_volume')
        if not today_volume:
            continue
        prev_volume, prev_date = previous_volume(conn, code, today)
        if not prev_volume:
            continue
        if float(today_volume) < prev_volume:
            continue
        matches.append(build_match(code, row, float(today_volume), prev_volume, prev_date, scanned_at))
    matches.sort(key=lambda item: item['patternDetail']['volumeRatio'], reverse=True)
    return matches[:MAX_MATCHES], len(candidates)


def load_board():
    wics_map = market_board.load_wics_map()
    appkey = os.environ.get('KIS_APPKEY', '').strip()
    appsecret = os.environ.get('KIS_APPSECRET', '').strip()
    if appkey and appsecret:
        try:
            return market_board.fetch_domestic_kis(appkey, appsecret, limit=RANK_LIMIT, wics_map=wics_map)
        except Exception as exc:
            log('KIS 순위 실패(%s) - 키움으로 폴백' % type(exc).__name__)
    # main.py의 종목판과 같은 폴백 순서를 따른다.
    import kiwoom_client
    token = kiwoom_client.get_token()
    return market_board.fetch_domestic(token, limit=RANK_LIMIT, wics_map=wics_map)


def main():
    scanned_at = datetime.now(timezone.utc).isoformat()
    board = load_board()
    conn = db_schema.get_conn()
    try:
        matches, candidate_count = scan(board, conn, scanned_at)
    finally:
        conn.close()

    def _apply(existing):
        existing.setdefault('patternScan', {'scanned': 0, 'patterns': {}})
        existing['patternScan'].setdefault('patterns', {})
        existing['patternScan']['patterns']['volumeBreakout'] = matches
        existing['volumeBreakoutScannedAt'] = scanned_at

    daily_scan_cache.update(_apply)
    log('저장 완료: 후보 %d종목 중 %d종목 돌파 (다른 패턴 섹션은 기존 값 유지)'
        % (candidate_count, len(matches)))


if __name__ == '__main__':
    main()
