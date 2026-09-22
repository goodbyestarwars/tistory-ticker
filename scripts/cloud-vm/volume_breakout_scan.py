# -*- coding: utf-8 -*-
"""갭상승으로 출발해 개장 5분 만에 전일 거래량의 절반을 넘어선 종목을 찾는 장중 1회
스냅샷 스캔.

2026-09-04 요청: "차트검색에 전일 거래량이 오늘 10분 만에 돌파한거 추가".
2026-09-21 요청("갭상승으로 시작되는거"): 갭상승 조건을 추가.
2026-09-22 요청("일단 시초가 갭상승 + 거래량 50%는 09:05분에 검출 가능하겠지?" ->
"거래량 돌파 탭을 내가 말한거로 수정해"): 09:10·"전일 하루치 이상"이던 조건을
09:05·"전일의 50% 이상"으로 앞당기고 낮췄다. 근거는 2026-09-17에 남겨 둔 09:05 관측
로그(log_probe_comparison의 0.5배 문턱) - 그 관측·비교 역할은 이제 이 스캔 자체가
대신하므로 별도 --probe 패스는 걷어냈다.

판정 방식이 다른 스캐너와 다르다. 차트검색의 기존 탭은 전부 daily_scan.py가 장 마감 뒤
하루 1회 돌리는 일봉 패턴이지만, 이 조건은 "개장 후 5분"이라는 시각이 조건의 일부라
그 순간에 한 번 찍어야만 알 수 있다. 그래서 09:05 KST에 한 번 실행하는 별도 타이머로 둔다
(setup_volumebreakout_timer.sh). 장중 계속 감시할 이유는 없다 - "5분 안에 넘었는가"는
09:05에 확정되고 그 뒤로는 바뀌지 않는다.

대상 종목:
    전 종목의 장중 누적 거래량을 09:05에 훑으려면 종목당 API 호출이 필요해 현실적이지
    않다. 대신 KIS 순위 API가 주는 당일 거래량·거래대금·거래증가율 상위 목록을 후보로
    쓴다. 전일 거래량의 절반을 5분 만에 넘긴 종목은 그 시각 당일 거래량 최상위권에
    있을 수밖에 없으므로 이 후보군으로 대부분 잡힌다. 다만 순위 API가 돌려주는 개수
    상한(섹션당 40) 밖으로 밀린 종목은 놓칠 수 있다 - 완전 탐색이 아니라는 뜻이다.

비교 대상:
    오늘 누적 거래량은 순위 응답의 trade_volume, 전일 거래량은 daily_prices 테이블의
    가장 최근 영업일 volume이다. 둘 다 의미가 분명한 값만 쓴다 - KIS 순위 API의
    거래증가율(vol_inrt)은 무엇 대비 증가율인지 이 저장소에서 확인된 바가 없어
    판정에 쓰지 않는다(CLAUDE.md: 미검증 API 필드를 확정값처럼 쓰지 않는다).

갭상승 판정:
    시가는 순위 응답에 없어 후보별로 KIS 현재가 시세(FHKST01010100)를 한 번 더 불러
    stck_oprc(시가)·stck_prdy_clpr(전일종가)를 쓴다. 이 값은 daily_prices의 일봉으로는
    대신할 수 없다 - daily_prices의 "오늘" 행은 장 마감 뒤(daily_scan.py, 20:10 KST)에야
    채워지므로 09:05 시점엔 존재하지 않는다(detect_opening_gap이 쓰는 값은 "어제"
    기준이라 이 조건과 다르다). 이미 거래량 조건을 통과한 소수(보통 수십 종목 이하)에만
    호출하므로 전 종목 조회와 달리 비용이 크지 않다. KIS 인증정보가 없으면(키움만 설정된
    환경) 갭 여부를 확인할 수 없으므로 필터를 걸지 않고 경고만 남긴다.
"""
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import daily_scan_cache
import db_schema
import kis_client
import market_board
import market_clock

KST = timezone(timedelta(hours=9))

# 순위 API 한 섹션이 돌려주는 최대 개수(market_board가 40으로 상한을 건다).
RANK_LIMIT = 40
# 후보를 모을 순위 섹션. 당일 거래가 몰린 종목을 서로 다른 각도로 담고 있어 합치면
# 한 섹션만 볼 때보다 놓치는 종목이 줄어든다.
CANDIDATE_SECTIONS = ('tradeVolume', 'tradeAmount', 'volumeGrowth')
# 화면에 싣는 최대 종목 수. 배수가 높은 순으로 자른다.
MAX_MATCHES = 40

# 2026-09-04 실측(운영 /market-board)에서 드러난 문제를 거르는 하한이다. 거래증가율 순위
# 상위가 전부 껍데기였다: 티와이홀딩스우 4,755주, "하나 인버스 2X 콩 선물 ETN(H)" 402주,
# "KB 코스닥 150 TR ETN" 5,021주 - 전일 거래량이 거의 0이라 증가율이 상한값(9999.99)에
# 박힌 종목들이다. 이런 건 "전일 거래량 돌파"를 항상 통과해서 목록을 덮어버린다.
# 전일에 어느 정도 거래가 있었어야 "많이 넘었다"가 의미를 갖는다.
# 두 값 모두 첫 실사 뒤 조정할 수 있는 출발점이다.
MIN_PREV_VOLUME = 50000
MIN_TODAY_VOLUME = 50000

# 2026-09-22 사용자 지시("시초가 갭상승 + 거래량 50%는 09:05분에 검출 가능하겠지?" ->
# "그걸로 수정해"): 09:10·"전일 하루치(1.0배) 이상"이던 문턱을 09:05·"전일의 50%(0.5배)
# 이상"으로 낮췄다. 시각을 5분 앞당기면 문턱도 같이 낮춰야 한다는 건 2026-09-17에 이미
# 확인했고(아래 OVERHEATED_CHANGE_PCT 주석), 그 확인 근거였던 09:05 관측 로그의 0.5배
# 문턱을 그대로 실제 스캔 조건으로 승격한 것이다.
VOLUME_RATIO_THRESHOLD = 0.5

# 2026-09-17 사용자 지적("10분에 잡으니까 너무 떠서 가는데"). 그날 09:10 실측 16종목의
# 등락률은 최소 +0.57 / 중앙 +9.34 / 최대 +17.14%였고, 절반 이상이 +5%를 넘은 상태였다.
# 같은 표본에서 거래량 배수와 등락률은 관계가 없었다(26.6배가 +4.7%, 2.0배가 +17.1%).
# 그래서 "배수 큰 것만 남기면 덜 뜬 걸 잡는다"는 성립하지 않는다. 목록에서 빼지는 않고
# (단타에서는 그것도 정보다) 배수 정렬 안에서 뒤로 보낸다. 기준선은 그날 중앙값이다.
OVERHEATED_CHANGE_PCT = 10.0

# 종목 목록 원본. daily_scan.load_full_universe와 같은 파일·같은 정규식을 쓴다.
FULL_UNIVERSE_URL = 'https://goodbyestarwars.github.io/tistory-ticker/data/krx_map.js'


def log(msg):
    print('[volume_breakout_scan] ' + msg, flush=True)


def load_dotenv():
    """같은 폴더 .env를 환경변수로 올린다(daily_scan.load_dotenv와 같은 형식).

    2026-09-15 운영 로그로 확인: systemd 유닛에는 키가 없어서, 이걸 안 부르면 KIS 키가
    비어 순위 조회를 건너뛰고 키움 폴백까지 실패해 9/4 추가 이후 한 번도 저장되지 않았다.
    이미 설정된 환경변수는 덮어쓰지 않는다.
    """
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


def today_kst():
    return datetime.now(KST).strftime('%Y-%m-%d')


def load_etf_codes():
    """ETF·ETN 종목코드 집합. 실패하면 빈 집합(=제외 안 함)으로 넘어간다.

    거래량 상위는 KODEX 인버스 같은 지수 ETF가 상시 차지한다. 차트검색은 종목을 찾는
    화면이라 이들을 빼야 목록이 쓸모 있다. daily_scan.load_full_universe와 같은 파일·
    정규식을 쓰지만, daily_scan을 import하면 스캔 모듈 전체가 딸려 와서 여기서는
    필요한 부분만 읽는다.
    """
    try:
        req = urllib.request.Request(FULL_UNIVERSE_URL, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=20) as res:
            text = res.read().decode('utf-8')
    except Exception as exc:
        log('종목목록 조회 실패(%s) - ETF 제외 없이 진행' % type(exc).__name__)
        return set()
    if 'window.KRX_ETF_NAMES=' not in text:
        return set()
    etf_names = set(re.findall(r'"([^"]+)"', text.split('window.KRX_ETF_NAMES=', 1)[1]))
    return {m.group(2) for m in re.finditer(r'"([^"]+)":"([0-9A-Za-z]{6})"', text)
            if m.group(1) in etf_names}


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


def is_overheated(change_rate):
    """이미 크게 올라 있어 추격이 위험한 자리인지."""
    return isinstance(change_rate, (int, float)) and change_rate >= OVERHEATED_CHANGE_PCT


def fetch_gap(token, appkey, appsecret, code):
    """오늘 시가(stck_oprc)와 전일종가(stck_prdy_clpr)로 갭상승 여부를 계산한다.

    KIS 현재가 시세(FHKST01010100)의 필드다. 2026-09-22 재확인: 이전 주석은 두 필드가
    "이 저장소에서 이미 확정값으로 쓰였다"고 했지만 실제로는 stck_oprc는
    domestic_market_indicators.py의 다른 TR(지수·분봉) 응답에서, stck_prdy_clpr는
    invest_opinion.py의 다른 TR(FHKST663300C0)에서 온 값이었다 - 이 TR 자체에서 검증된
    적은 없다. 다만 KIS 문서에서 이 두 필드명은 "주식현재가 시세" 계열 TR 전반에 걸쳐
    일관되게 쓰이는 표준 필드라 그대로 둔다. 값이 비어 있으면(필드가 실제로 다르거나
    휴장·오류) None을 돌려주고 호출부가 그 종목을 건너뛴다.
    """
    output = kis_client.fetch_domestic_quote(token, appkey, appsecret, code)
    open_price = output.get('stck_oprc')
    prev_close = output.get('stck_prdy_clpr')
    if not open_price or not prev_close:
        return None
    open_price = float(open_price)
    prev_close = float(prev_close)
    if prev_close <= 0:
        return None
    return open_price, prev_close, (open_price - prev_close) / prev_close * 100


def build_match(code, row, today_volume, prev_volume, prev_date, scanned_at, gap_pct):
    ratio = today_volume / prev_volume
    score = min(100, int(round(ratio / VOLUME_RATIO_THRESHOLD * 50)))
    change_rate = row.get('change_rate')
    overheated = is_overheated(change_rate)
    rate_text = ('%+.2f%%' % change_rate) if isinstance(change_rate, (int, float)) else '알 수 없음'
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
        'score': score,
        'reasons': [
            '개장 5분 시점 누적 거래량 %s주' % format(int(today_volume), ','),
            '전일(%s) 거래량 %s주' % (prev_date, format(int(prev_volume), ',')),
            '전일 대비 %.2f배' % ratio,
            '스캔 시점 등락률 %s%s' % (rate_text, ' - 이미 크게 오른 자리' if overheated else ''),
            '갭상승 시작 +%.2f%%' % gap_pct,
        ],
        'interpretation': (
            ('갭상승으로 출발해 개장 5분 만에 전일 거래량의 %.0f%%를 넘어섰습니다(%.2f배). 다만 '
             '그 시점에 이미 %s 올라 있어, 여기서 따라 사면 비싼 값에 들어가는 자리입니다.'
             % (VOLUME_RATIO_THRESHOLD * 100, ratio, rate_text))
            if overheated else
            ('갭상승으로 출발해 개장 5분 만에 전일 거래량의 %.0f%%를 넘어섰습니다(%.2f배). 거래가 '
             '갑자기 몰린 자리라는 뜻이며, 방향(상승·하락)은 이 조건만으로 판단하지 않습니다.'
             % (VOLUME_RATIO_THRESHOLD * 100, ratio))
        ),
        'patternDetail': {
            'score': score,
            'todayVolume': int(today_volume),
            'prevVolume': int(prev_volume),
            'prevDate': prev_date,
            'volumeRatio': round(ratio, 4),
            'changeRate': change_rate,
            'overheated': overheated,
            'gapPct': round(gap_pct, 4) if gap_pct is not None else None,
            'scanned_at': scanned_at,
        },
    }


def _kis_token_for_gap():
    """갭상승 확인용 KIS 토큰. 인증정보가 없으면(키움만 설정된 환경) None."""
    appkey = os.environ.get('KIS_APPKEY', '').strip()
    appsecret = os.environ.get('KIS_APPSECRET', '').strip()
    if not appkey or not appsecret:
        return None, None, None
    try:
        return kis_client.get_token(appkey, appsecret), appkey, appsecret
    except Exception as exc:
        log('KIS 토큰 발급 실패(%s) - 갭상승 필터 생략' % type(exc).__name__)
        return None, None, None


def scan(board, conn, scanned_at, etf_codes=None):
    """후보 중 ①오늘 누적 거래량 >= 전일 거래량의 VOLUME_RATIO_THRESHOLD(0.5)배
    ②갭상승(시가 > 전일종가)을 둘 다 만족하는 종목을 배수 내림차순으로 돌려준다.

    2026-09-21 사용자 요청("갭상승으로 시작되는거"): 거래량 돌파만으로는 하락 갭에서도
    거래가 몰린 종목까지 섞여 나와 ②를 추가했다.
    2026-09-22 사용자 지시("거래량 돌파 탭을 내가 말한거로 수정해" - 시초 갭상승 + 거래량
    50%를 09:05에): 이제 갭상승은 이 탭의 이름값 자체라 KIS 인증정보가 없어 확인 못 하면
    (예전처럼 ①만으로 완화하지 않고) 그 종목은 그냥 뺀다 - "갭상승"이라는 탭 설명과 실제
    동작이 어긋나면 안 되기 때문이다.
    """
    etf_codes = etf_codes or set()
    candidates = collect_candidates(board)
    today = today_kst()
    token, appkey, appsecret = _kis_token_for_gap()
    gap_checked = 0
    gap_skipped = 0
    matches = []
    if not token:
        log('KIS 인증정보 없음 - 갭상승을 확인할 수 없어 이번 스캔은 빈 목록으로 저장')
        return matches, len(candidates)
    for code, row in candidates.items():
        if code in etf_codes:
            continue
        today_volume = row.get('trade_volume')
        if not today_volume or float(today_volume) < MIN_TODAY_VOLUME:
            continue
        prev_volume, prev_date = previous_volume(conn, code, today)
        if not prev_volume or prev_volume < MIN_PREV_VOLUME:
            continue
        if float(today_volume) < prev_volume * VOLUME_RATIO_THRESHOLD:
            continue
        try:
            gap = fetch_gap(token, appkey, appsecret, code)
        except Exception as exc:
            log('갭 조회 실패 %s(%s) - 이 종목은 갭 미확인으로 건너뜀' % (code, type(exc).__name__))
            continue
        gap_checked += 1
        if not gap or gap[2] <= 0:
            gap_skipped += 1
            continue
        matches.append(build_match(code, row, float(today_volume), prev_volume, prev_date, scanned_at, gap[2]))
    if token:
        log('갭상승 확인 %d종목 중 %d종목 갭상승 아님으로 제외' % (gap_checked, gap_skipped))
    # 2026-09-17: 이미 크게 오른 종목을 목록에서 빼지는 않는다(단타에서는 그것도 정보다).
    # 대신 같은 배수 정렬 안에서 뒤로 보내, 위쪽이 "아직 덜 간 자리"가 되게 한다.
    matches.sort(key=lambda item: (item['patternDetail']['overheated'],
                                   -item['patternDetail']['volumeRatio']))
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
    kiwoom_appkey = os.environ.get('KIWOOM_APPKEY', '').strip()
    kiwoom_secretkey = os.environ.get('KIWOOM_SECRETKEY', '').strip()
    if not kiwoom_appkey or not kiwoom_secretkey:
        raise RuntimeError('KIS_APPKEY/KIS_APPSECRET, KIWOOM_APPKEY/KIWOOM_SECRETKEY 모두 없음 - .env 확인')
    token = kiwoom_client.get_token(kiwoom_appkey, kiwoom_secretkey)
    return market_board.fetch_domestic(token, limit=RANK_LIMIT, wics_map=wics_map)


def main():
    # 2026-09-16 사용자 지시("휴장은 쉬게 하자"): 휴장일에는 아무것도 저장하지 않고 끝낸다 -
    # 스캔이 끝나면 자기 몫의 결과를 통째로 덮어쓰기 때문에, 그냥 두면 직전 거래일 목록이 사라진다.
    skip_today, scan_day = market_clock.skip_scan_today()
    if skip_today:
        log('휴장일(%s) - 스캔을 건너뜁니다(직전 거래일 결과 유지).' % scan_day)
        return
    load_dotenv()
    scanned_at = datetime.now(timezone.utc).isoformat()
    board = load_board()
    etf_codes = load_etf_codes()
    conn = db_schema.get_conn()
    try:
        matches, candidate_count = scan(board, conn, scanned_at, etf_codes)
    finally:
        conn.close()

    def _apply(existing):
        existing.setdefault('patternScan', {'scanned': 0, 'patterns': {}})
        existing['patternScan'].setdefault('patterns', {})
        existing['patternScan']['patterns']['volumeBreakout'] = matches
        existing['volumeBreakoutScannedAt'] = scanned_at

    daily_scan_cache.update(_apply)
    overheated = sum(1 for item in matches if item['patternDetail']['overheated'])
    log('저장 완료: 후보 %d종목 중 %d종목 돌파(갭상승 + 전일 %.0f%% 이상, 이미 +%.0f%% 이상 오른 '
        '종목 %d개는 뒤로, ETF 제외 %d, 전일/당일 거래량 하한 %s/%s주, 다른 패턴 섹션은 기존 값 유지)'
        % (candidate_count, len(matches), VOLUME_RATIO_THRESHOLD * 100, OVERHEATED_CHANGE_PCT,
           overheated, len(etf_codes), format(MIN_PREV_VOLUME, ','), format(MIN_TODAY_VOLUME, ',')))


if __name__ == '__main__':
    main()
