# -*- coding: utf-8 -*-
"""종목분석 "평균 투자의견" 카드 - 토스증권의 "최근 3개월(해외 6개월) 애널리스트 평균
투자의견" 카드를 참고해(사용자 요청) 국내 종목에 한해 만든다. 토스는 FnGuide/Refinitiv
(유료 데이터 제공업체)를 쓰지만 우리는 그 계약이 없어서, KIS의 국내주식 종목투자의견
(FHKST663300C0, kis_client.fetch_invest_opinion)로 대체한다. 공식 응답에는 날짜별 투자의견·
목표가만 있고 증권사명·제목·원문 URL이 없으므로 "개별 증권사 리포트"라고 단정하지 않고
KIS 관측치로 표시한다. 최근 3개월 관측치의 목표가 중앙값·의견 분포는 여기서 직접 계산한다.
해외 종목은 KIS 해외주식 카테고리
API 50개를 뒤져봐도 이 용도의 API가 없어(사용자 확인 후) 국내 종목만 지원한다.

**미검증**: kis-code-assistant-mcp는 코드 검색 전용이라 실계좌로 직접 테스트 못 했다 -
필드명(invt_opnn/hts_goal_prc 등)은 KIS 공식 예제 그대로지만, 실제 응답에서 종목별로
리포트가 몇 건이나 나오는지(소형주는 0건일 수 있음)는 라이브 확인 전까지 모른다."""

import statistics
import time
from datetime import datetime, timedelta, timezone

import db_schema
import kis_client

KST = timezone(timedelta(hours=9))
LOOKBACK_MONTHS = 3
# 2026-08-23: 차트검색/전략검색(daily_scan.py/strategy_scan.py)은 한 번에 수십 종목을
# 나열해서, 행마다 종목분석 페이지처럼 라이브로 KIS를 부르면 배치가 너무 느려진다(사용자
# 확인 - "db에 저장할까? 일단 차트검색, 전략검색에만 넣어"). db_schema.invest_opinions에
# 하루 1회만 갱신해 저장하고 그 사이 재실행되는 배치는 캐시를 그대로 재사용한다.
THROTTLE_SEC = 0.25
FRESH_HOURS = 20  # 배치 주기(하루 1회)보다 살짝 짧게 - 같은 날 여러 번 재실행돼도 재조회 안 함

# KIS invt_opnn 텍스트를 매수/중립/매도 3버킷으로 묶는다(정확한 표기를 몰라 넓게 매칭 -
# 알 수 없는 문구는 '기타'로 남겨 조용히 매수/매도로 오분류하지 않는다).
_BUY_TOKENS = ('매수', 'BUY', 'Buy', '강력매수', 'STRONG BUY', 'Strong Buy', 'Outperform', '비중확대')
_SELL_TOKENS = ('매도', 'SELL', 'Sell', 'Underperform', '비중축소')
_HOLD_TOKENS = ('중립', '보유', 'HOLD', 'Hold', 'Neutral')


def _classify_opinion(text):
    text = str(text or '').strip()
    if not text:
        return None
    upper = text.upper()
    if any(token.upper() in upper for token in _SELL_TOKENS):
        return 'sell'
    if any(token.upper() in upper for token in _HOLD_TOKENS):
        return 'hold'
    if any(token.upper() in upper for token in _BUY_TOKENS):
        return 'buy'
    return 'other'


def _to_number(value):
    if value in (None, '', '0', 0):
        return None
    try:
        number = float(str(value).replace(',', ''))
    except (TypeError, ValueError):
        return None
    return number if number else None


def recent_date_range(months=LOOKBACK_MONTHS, today=None):
    """(date1, date2) - KIS FID_INPUT_DATE_1/2 형식(YYYYMMDD), 오늘 기준 최근 N개월."""
    now = today or datetime.now(KST)
    start = now - timedelta(days=months * 30)
    return start.strftime('%Y%m%d'), now.strftime('%Y%m%d')


def summarize_opinions(rows):
    """kis_client.fetch_invest_opinion()이 돌려주는 날짜별 관측치를 목표가·의견
    분포로 요약한다. 관측치가 하나도 없으면 available=False를 돌려주고(소형주 등 커버리지
    없는 종목에서 흔함), 목표가는 0/공란을 유효하지 않은 값으로 보고 평균에서 제외한다."""
    reports = []
    for row in rows or []:
        opinion_text = row.get('invt_opnn')
        target_price = _to_number(row.get('hts_goal_prc'))
        date = row.get('stck_bsop_date')
        bucket = _classify_opinion(opinion_text)
        if bucket is None:
            continue
        reports.append({
            'date': date,
            'opinion': opinion_text,
            'bucket': bucket,
            'targetPrice': target_price,
            'previousClose': _to_number(row.get('stck_prdy_clpr')),
            'previousOpinion': row.get('rgbf_invt_opnn') or None,
            'gapRatePct': _to_number(row.get('nday_dprt')) or _to_number(row.get('dprt')),
        })

    if not reports:
        return {'available': False, 'reportCount': 0}

    reports.sort(key=lambda r: str(r.get('date') or ''))
    counts = {'buy': 0, 'hold': 0, 'sell': 0, 'other': 0}
    for r in reports:
        counts[r['bucket']] += 1

    # 2026-08-23: strategy_scan.py의 섹터 평균 PER/PBR 버그(산술평균이 이상치 리포트 하나에
    # 끌려간 사건) 이후 "여러 값을 평균 내는" 다른 계산도 같은 위험이 있는지 점검하다가
    # 발견 - 이 목표가 평균도 3개월 사이 액면분할·무상증자 등으로 리포트 하나가 스케일이
    # 다른 목표가를 갖고 있으면(예: 분할 전 리포트가 안 갱신된 옛 목표가를 그대로 유지)
    # 산술평균이 왜곡될 수 있다. 같은 이유로 중앙값을 쓴다(리포트 수가 적을 때도 동작은
    # 산술평균과 동일하거나 더 안전함).
    target_prices = [r['targetPrice'] for r in reports if r['targetPrice']]
    avg_target_price = round(statistics.median(target_prices)) if target_prices else None

    latest = reports[-1]
    return {
        'available': True,
        'reportCount': len(reports),
        'buyCount': counts['buy'],
        'holdCount': counts['hold'],
        'sellCount': counts['sell'],
        'otherCount': counts['other'],
        'avgTargetPrice': avg_target_price,
        'targetPriceSamples': len(target_prices),
        'latestOpinion': latest['opinion'],
        'latestDate': latest['date'],
        'source': 'KIS(한국투자증권) 국내주식 종목투자의견',
        'sourceTrId': 'FHKST663300C0',
        'sourceEndpoint': '/uapi/domestic-stock/v1/quotations/invest-opinion',
        'sourceDocumentationUrl': ('https://github.com/koreainvestment/open-trading-api/tree/main/'
                                   'examples_llm/domestic_stock/invest_opinion'),
        'originalReportLinksAvailable': False,
        'basisNote': ('KIS가 제공한 날짜별 투자의견·목표가 관측치를 자체 집계합니다. '
                      'KIS 응답에는 증권사명·보고서 제목·원문 URL이 없습니다.'),
        'reports': list(reversed(reports)),
    }


def fetch_recent_opinion_summary(kis_client_module, token, appkey, appsecret, code, months=LOOKBACK_MONTHS):
    """VM 엔드포인트가 호출하는 진입점 - kis_client 모듈을 인자로 받아 테스트에서
    쉽게 목(mock)으로 바꿀 수 있게 한다(다른 fetch_* 함수들과 동일한 관례)."""
    date1, date2 = recent_date_range(months)
    rows = kis_client_module.fetch_invest_opinion(token, appkey, appsecret, code, date1, date2)
    return summarize_opinions(rows)


def _is_fresh(summary, now):
    if not summary or not summary.get('_updatedAt'):
        return False
    try:
        updated_at = datetime.fromisoformat(summary['_updatedAt'])
    except ValueError:
        return False
    return (now - updated_at).total_seconds() < FRESH_HOURS * 3600


def enrich_matches_with_target_price(matches, kis_appkey, kis_appsecret, conn):
    """차트검색/전략검색 배치(daily_scan.py/strategy_scan.py)가 스캔을 다 끝낸 뒤, 화면에
    실제로 나갈 최종 후보 목록(matches, code/price 필드를 가진 dict 리스트)에만 평균
    투자의견을 붙인다 - 전체 유니버스가 아니라 이미 필터를 통과한 소수 종목만 조회해서
    배치 시간 부담을 최소화한다. 각 match에 analystTargetPrice/analystTargetGapPct/
    analystReportCount 필드를 in-place로 추가한다(기존 targetPrice/targetGapPct 필드는
    전략검색의 "목표주가 괴리 저평가주" 카테고리가 이미 쓰고 있어 이름이 겹치지 않게
    분리했다). KIS 미설정이면 아무 것도 하지 않고 조용히 반환한다."""
    if not matches or not kis_appkey or not kis_appsecret:
        return
    codes = []
    for m in matches:
        code = m.get('code')
        if code and code not in codes:
            codes.append(code)
    if not codes:
        return

    cached = db_schema.load_invest_opinions(conn, codes)
    now = datetime.now(timezone.utc)
    token = None
    for code in codes:
        if _is_fresh(cached.get(code), now):
            continue
        if token is None:
            token = kis_client.get_token(kis_appkey, kis_appsecret)
        try:
            summary = fetch_recent_opinion_summary(kis_client, token, kis_appkey, kis_appsecret, code)
        except Exception:
            summary = {'available': False, 'reportCount': 0}
        time.sleep(THROTTLE_SEC)
        summary['_updatedAt'] = now.isoformat()
        db_schema.upsert_invest_opinion(conn, code, summary, now.isoformat())
        cached[code] = summary

    for m in matches:
        summary = cached.get(m.get('code'))
        if not summary or not summary.get('available'):
            continue
        target_price = summary.get('avgTargetPrice')
        m['analystReportCount'] = summary.get('reportCount')
        if target_price:
            m['analystTargetPrice'] = target_price
            price = m.get('price')
            if price:
                m['analystTargetGapPct'] = round((target_price - price) / price * 100, 1)
