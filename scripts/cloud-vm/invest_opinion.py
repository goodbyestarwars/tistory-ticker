# -*- coding: utf-8 -*-
"""종목분석 "평균 투자의견" 카드 - 토스증권의 "최근 3개월(해외 6개월) 애널리스트 평균
투자의견" 카드를 참고해(사용자 요청) 국내 종목에 한해 만든다. 토스는 FnGuide/Refinitiv
(유료 데이터 제공업체)를 쓰지만 우리는 그 계약이 없어서, KIS의 국내주식 종목투자의견
(FHKST663300C0, kis_client.fetch_invest_opinion)로 대체한다 - 이 TR은 "이미 집계된
평균"이 아니라 그 기간에 나온 증권사 리포트를 건별로 주므로, 최근 3개월치를 모아
평균 목표가·의견 분포를 여기서 직접 계산한다. 해외 종목은 KIS 해외주식 카테고리
API 50개를 뒤져봐도 이 용도의 API가 없어(사용자 확인 후) 국내 종목만 지원한다.

**미검증**: kis-code-assistant-mcp는 코드 검색 전용이라 실계좌로 직접 테스트 못 했다 -
필드명(invt_opnn/hts_goal_prc 등)은 KIS 공식 예제 그대로지만, 실제 응답에서 종목별로
리포트가 몇 건이나 나오는지(소형주는 0건일 수 있음)는 라이브 확인 전까지 모른다."""

from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
LOOKBACK_MONTHS = 3

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
    """kis_client.fetch_invest_opinion()이 돌려주는 개별 리포트 목록을 평균 목표가·의견
    분포로 요약한다. 리포트가 하나도 없으면 available=False를 돌려주고(소형주 등 커버리지
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
        })

    if not reports:
        return {'available': False, 'reportCount': 0}

    reports.sort(key=lambda r: str(r.get('date') or ''))
    counts = {'buy': 0, 'hold': 0, 'sell': 0, 'other': 0}
    for r in reports:
        counts[r['bucket']] += 1

    target_prices = [r['targetPrice'] for r in reports if r['targetPrice']]
    avg_target_price = round(sum(target_prices) / len(target_prices)) if target_prices else None

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
    }


def fetch_recent_opinion_summary(kis_client, token, appkey, appsecret, code, months=LOOKBACK_MONTHS):
    """VM 엔드포인트가 호출하는 진입점 - kis_client 모듈을 인자로 받아 테스트에서
    쉽게 목(mock)으로 바꿀 수 있게 한다(다른 fetch_* 함수들과 동일한 관례)."""
    date1, date2 = recent_date_range(months)
    rows = kis_client.fetch_invest_opinion(token, appkey, appsecret, code, date1, date2)
    return summarize_opinions(rows)
