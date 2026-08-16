# -*- coding: utf-8 -*-
"""주말용 한 주 시장 리포트 조립기.

외부 API를 직접 호출하지 않고, main.py가 이미 확보한 지수·뉴스·순위
데이터를 한 화면용 계약으로 정리한다. 순수 함수 중심으로 둬서 데이터가
없는 휴일에도 빈 배열로 안전하게 렌더링할 수 있다.
"""

from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from math import log1p


def completed_week(now=None):
    """Return the most recently completed Monday-Friday week in KST."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    kst = now.astimezone(timezone(timedelta(hours=9))).date()
    # Monday-Friday resolve to the previous Friday; Saturday/Sunday resolve to
    # the Friday that just ended.
    if kst.weekday() >= 5:
        end = kst - timedelta(days=kst.weekday() - 4)
    else:
        end = kst - timedelta(days=kst.weekday() + 3)
    return end - timedelta(days=4), end


def _date_value(value):
    text = str(value or '').strip()
    if not text:
        return None
    for candidate in (text[:10], text[:8]):
        for fmt in ('%Y-%m-%d', '%Y%m%d'):
            try:
                return datetime.strptime(candidate, fmt).date()
            except ValueError:
                pass
    try:
        return parsedate_to_datetime(text).date()
    except (TypeError, ValueError, IndexError):
        pass
    return None


def _number(value):
    try:
        return float(str(value).replace(',', '').replace('%', '').strip())
    except (TypeError, ValueError):
        return None


def _week_points(chart, start, end):
    rows = []
    for row in chart or []:
        day = _date_value(row.get('date')) if isinstance(row, dict) else None
        close = _number(row.get('close')) if isinstance(row, dict) else None
        if day and close is not None and start <= day <= end:
            rows.append({'date': day.isoformat(), 'close': close})
    return rows


def index_summary(futures_rows, start, end):
    """Build index, rates and major asset cards from /futures daily charts."""
    wanted = {
        'KOSPI': ('코스피', 'index', None),
        'KOSDAQ': ('코스닥', 'index', None),
        'NASDAQ_INDEX': ('나스닥 종합', 'index', None),
        'SP500_INDEX': ('S&P500', 'index', None),
        'US10Y': ('미국 10년 국채', 'macro', 'yield'),
        'WTI': ('WTI 원유', 'asset', 'usd'),
        'GOLD': ('금 선물', 'asset', 'usd'),
        'BTC': ('비트코인', 'asset', 'krw'),
    }
    result = []
    for row in futures_rows or []:
        symbol = row.get('symbol') if isinstance(row, dict) else None
        if symbol not in wanted:
            continue
        points = _week_points(row.get('chart'), start, end)
        # On a partial/holiday-filled week, use the latest five stored sessions,
        # but expose the actual data dates so the UI never implies a fabricated value.
        if len(points) < 2:
            fallback = []
            for point in row.get('chart') or []:
                day = _date_value(point.get('date')) if isinstance(point, dict) else None
                close = _number(point.get('close')) if isinstance(point, dict) else None
                if day and close is not None:
                    fallback.append({'date': day.isoformat(), 'close': close})
            points = fallback[-5:]
        first = points[0]['close'] if points else None
        last = points[-1]['close'] if points else None
        change_rate = ((last - first) / first * 100) if first and last is not None else None
        result.append({
            'symbol': symbol,
            'name': wanted[symbol][0],
            'group': wanted[symbol][1],
            'valueType': wanted[symbol][2],
            'start': first,
            'end': last,
            'changeRate': change_rate,
            'series': points,
            'available': bool(points),
        })
    return result


def _hot_row(row, tag):
    if not isinstance(row, dict):
        return None
    code = row.get('code') or row.get('symbol') or row.get('stk_cd')
    name = row.get('name') or row.get('stock_name') or row.get('stk_nm') or code
    if not code:
        return None
    change = row.get('change_rate', row.get('changeRate', row.get('prdy_ctrt')))
    return {
        'code': str(code),
        'name': str(name),
        'price': _number(row.get('price', row.get('stck_prpr'))),
        'changeRate': _number(change),
        'tradeVolume': _number(row.get('trade_volume', row.get('volume', row.get('acml_vol')))),
        'tradeAmount': _number(row.get('trade_amount', row.get('tradeAmount', row.get('acml_tr_pbmn')))),
        'marketCap': _number(row.get('market_cap', row.get('marketCap', row.get('stck_avls')))),
        'tags': [tag],
    }


def _stock_reason(item, cold=False):
    """Return one short, data-backed reason for the stock card."""
    tags = item.get('tags') or []
    change = item.get('changeRate')
    if cold and '하락 상위' in tags:
        return '하락률 상위 · 약세 지속'
    if cold and change is not None and change < 0:
        return '등락률 하락 · 유동성 상위'
    priorities = (
        ('매수체결강도', '매수 체결강도 우위'),
        ('거래량 급증', '거래량 급증'),
        ('거래량 증가', '거래량 증가'),
        ('상승 상위', '상승률 상위'),
        ('하락 상위', '하락률 상위'),
        ('거래대금 상위', '거래대금 집중'),
        ('거래회전율', '거래회전율 상위'),
        ('거래대금 회전율', '거래대금 회전율 상위'),
        ('시가총액 상위', '시가총액 상위 대형주'),
        ('거래량 상위', '거래량 상위'),
    )
    for tag, reason in priorities:
        if tag in tags:
            if tag == '상승 상위' and change is not None:
                return '상승률 상위 · %+0.2f%%' % change
            if tag == '하락 상위' and change is not None:
                return '하락률 상위 · %+0.2f%%' % change
            return reason
    if change is not None and change > 0:
        return '등락률 상승 · %+0.2f%%' % change
    if change is not None and change < 0:
        return '등락률 하락 · %+0.2f%%' % change
    return '거래·시가총액 순위 기반'


def hot_stocks(board_data, limit=10):
    """Merge several last-session rankings and select a diversified list.

    The board's default rows are 거래대금 중심이라 그대로 쓰면 같은 종류의
    대형주만 반복된다. 각 순위 바구니에서 한 종목씩 번갈아 고르되, 같은
    종목이 여러 바구니에 있으면 태그를 합쳐 신호의 겹침도 보여준다.
    """
    merged = {}
    sections = (board_data or {}).get('sections') or {}
    specs = (
        ('rising', '상승 상위'),
        ('volumeGrowth', '거래량 증가'), ('volumeSurge', '거래량 급증'),
        ('tradeVolume', '거래량 상위'), ('marketCap', '시가총액 상위'),
        ('turnover', '거래회전율'), ('amountTurnover', '거래대금 회전율'),
        ('volumePower', '매수체결강도'), ('tradeAmount', '거래대금 상위'),
    )
    for section, tag in specs:
        for raw in (sections.get(section) or [])[:limit]:
            item = _hot_row(raw, tag)
            if not item or (item.get('changeRate') is not None and item['changeRate'] < 0):
                continue
            current = merged.get(item['code'])
            if current:
                current['tags'] = list(dict.fromkeys(current['tags'] + item['tags']))
            else:
                merged[item['code']] = item

    # Some providers expose the primary ranking only as rows, not as a named
    # section. Keep it as the final diversification bucket.
    for raw in ((board_data or {}).get('rows') or [])[:limit]:
        item = _hot_row(raw, '거래대금 상위')
        if not item or (item.get('changeRate') is not None and item['changeRate'] < 0):
            continue
        current = merged.get(item['code'])
        if current:
            current['tags'] = list(dict.fromkeys(current['tags'] + item['tags']))
        else:
            merged[item['code']] = item

    buckets = []
    for section, _tag in specs:
        codes = []
        for raw in (sections.get(section) or [])[:limit]:
            item = _hot_row(raw, _tag)
            if not item or (item.get('changeRate') is not None and item['changeRate'] < 0):
                continue
            if item['code'] not in codes and item['code'] in merged:
                codes.append(item['code'])
        if codes:
            buckets.append(codes)
    row_codes = [item['code'] for item in ((board_data or {}).get('rows') or [])
                 if _hot_row(item, '거래대금 상위')
                 and (_hot_row(item, '거래대금 상위').get('changeRate') is None
                      or _hot_row(item, '거래대금 상위').get('changeRate') >= 0)
                 and _hot_row(item, '거래대금 상위')['code'] in merged]
    if row_codes:
        buckets.append(list(dict.fromkeys(row_codes)))

    rows = []
    selected = set()
    cursor = [0] * len(buckets)
    while len(rows) < limit and any(cursor[index] < len(bucket) for index, bucket in enumerate(buckets)):
        for index, bucket in enumerate(buckets):
            while cursor[index] < len(bucket) and bucket[cursor[index]] in selected:
                cursor[index] += 1
            if cursor[index] >= len(bucket):
                continue
            code = bucket[cursor[index]]
            cursor[index] += 1
            selected.add(code)
            rows.append(merged[code])
            if len(rows) >= limit:
                break
    for item in rows:
        item['reason'] = _stock_reason(item)
    return rows


def cold_stocks(board_data, limit=5):
    """Select liquid, negative performers instead of obscure decliners only."""
    sections = (board_data or {}).get('sections') or {}
    specs = (
        ('falling', '하락 상위'), ('tradeAmount', '거래대금 상위'),
        ('marketCap', '시가총액 상위'), ('tradeVolume', '거래량 상위'),
    )
    merged = {}
    for section, tag in specs:
        for raw in (sections.get(section) or [])[:max(limit * 3, 15)]:
            item = _hot_row(raw, tag)
            if not item or item.get('changeRate') is None or item['changeRate'] >= 0:
                continue
            current = merged.get(item['code'])
            if current:
                current['tags'] = list(dict.fromkeys(current['tags'] + item['tags']))
                for key in ('price', 'tradeVolume', 'tradeAmount', 'marketCap'):
                    if current.get(key) in (None, 0) and item.get(key) not in (None, 0):
                        current[key] = item[key]
            else:
                merged[item['code']] = item
    rows = list(merged.values())
    # Market-cap/trade-amount visibility keeps the list focused on liquid names.
    # The rank APIs already limit the candidate universe; this only changes order.
    rows.sort(key=lambda item: (
        log1p(max(item.get('marketCap') or 0, 0))
        + log1p(max(item.get('tradeAmount') or 0, 0)),
        abs(item.get('changeRate') or 0),
    ), reverse=True)
    rows = rows[:limit]
    for item in rows:
        item['reason'] = _stock_reason(item, cold=True)
    return rows


def fx_analysis(row):
    """Summarize the current FX level against its one-year observed range."""
    row = dict(row or {})
    points = []
    for point in row.get('chart') or []:
        day = _date_value(point.get('date')) if isinstance(point, dict) else None
        close = _number(point.get('close')) if isinstance(point, dict) else None
        if day and close is not None:
            points.append({'date': day.isoformat(), 'close': close})
    points = points[-365:]
    closes = [point['close'] for point in points]
    current = closes[-1] if closes else _number(row.get('price'))
    if not closes or current is None:
        row['analysis'] = {'status': 'unknown', 'label': '데이터 확인 중', 'message': '1년 환율 데이터가 부족합니다.'}
        return row
    ordered = sorted(closes)
    average = sum(closes) / len(closes)
    low = ordered[0]
    high = ordered[-1]
    p25 = ordered[int((len(ordered) - 1) * .25)]
    p75 = ordered[int((len(ordered) - 1) * .75)]
    if current >= p75:
        status, label, message = 'caution', '고환율 주의', '1년 관측 범위 상단이라 추격 매수는 주의'
    elif current <= p25:
        status, label, message = 'interest', '관심 구간', '1년 관측 범위 하단이라 분할 접근을 검토'
    else:
        status, label, message = 'neutral', '중립·관망', '1년 평균 범위 안에서 방향을 확인'
    row['chart'] = points
    row['analysis'] = {
        'status': status, 'label': label, 'message': message,
        'current': current, 'average': average, 'low': low, 'high': high,
        'p25': p25, 'p75': p75,
    }
    return row


def _within_week(item, start, end):
    day = _date_value(item.get('pubDate') or item.get('publishedAt') or item.get('date'))
    # 주간 리포트는 현재 시점에 들어온 최신 뉴스가 섞이지 않도록
    # 발행일이 확인되는 항목만 완료된 월~금 범위에 포함한다.
    return day is not None and start <= day <= end


def _news(items, start, end, limit):
    result = []
    seen = set()
    for item in items or []:
        if not isinstance(item, dict) or not item.get('title') or not _within_week(item, start, end):
            continue
        key = str(item.get('link') or item.get('title')).strip()
        if key in seen:
            continue
        seen.add(key)
        result.append({
            'title': item.get('title'), 'link': item.get('link'),
            'source': item.get('source') or item.get('provider'),
            'pubDate': item.get('pubDate') or item.get('publishedAt') or item.get('date'),
        })
        if len(result) >= limit:
            break
    return result


def next_week_schedule(events, start, end):
    next_start = end + timedelta(days=3)
    next_end = next_start + timedelta(days=6)
    result = []
    m7 = {'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'GOOG', 'META', 'TSLA'}
    major_domestic = ('삼성전자', 'SK하이닉스', '현대차', '기아', 'NAVER', '카카오', 'LG에너지', '삼성SDI')
    macro_terms = ('금리', 'FOMC', 'CPI', 'PCE', '고용', 'GDP', '물가', '연준', '한국은행')
    for event in events or []:
        day = _date_value(event.get('start') or event.get('date')) if isinstance(event, dict) else None
        if day and next_start <= day <= next_end:
            title = str(event.get('title') or event.get('name') or '일정')
            symbol = str(event.get('symbol') or event.get('ticker') or '').upper()
            is_m7 = symbol in m7
            is_major_domestic = any(name in title for name in major_domestic)
            is_macro = any(term.lower() in title.lower() for term in macro_terms)
            # 일정 공급자가 많은 개별 실적을 반환해도 핵심 일정만 남긴다.
            # 확인된 이벤트만 표시하고, 없는 금리/CPI 일정은 만들지 않는다.
            if not (is_m7 or is_major_domestic or is_macro):
                continue
            result.append({
                'date': day.isoformat(),
                'title': title,
                'symbol': symbol,
                'source': event.get('source') or event.get('provider') or '',
                'market': event.get('market') or ('us' if symbol else 'domestic'),
                'priority': 3 if is_m7 or is_macro else 2 if is_major_domestic else 1,
            })
    return sorted(result, key=lambda item: (item['date'], -item['priority'], item['title']))[:24]


def news_timeline(domestic, us, start, end, limit=20):
    """Merge Korean and US weekly headlines into one chronological timeline."""
    def diversified(items, item_limit):
        candidates = _news(items, start, end, item_limit * 4)
        buckets = {}
        for item in candidates:
            day = _date_value(item.get('pubDate'))
            key = day.isoformat() if day else ''
            buckets.setdefault(key, []).append(item)
        dates = sorted(buckets.keys(), reverse=True)
        result = []
        while dates and len(result) < item_limit:
            next_dates = []
            for key in dates:
                bucket = buckets[key]
                if bucket:
                    result.append(bucket.pop(0))
                    if len(result) >= item_limit:
                        break
                if bucket:
                    next_dates.append(key)
            dates = next_dates
        return result

    per_market = max(1, limit // 2)
    rows = []
    for market, items in (('한국', domestic), ('미국', us)):
        for item in diversified(items, per_market):
            item = dict(item)
            item['market'] = market
            rows.append(item)
    rows.sort(key=lambda item: str(item.get('pubDate') or ''), reverse=True)
    return rows[:limit]


def build_report(start, end, futures_rows=None, domestic_news_items=None,
                 foreign_news_items=None, domestic_board=None, us_board=None,
                 schedule_events=None, generated_at=None):
    # 주간 리포트는 최신 하루치가 전체를 덮지 않도록 완료된 월~금만 사용한다.
    # 주말에 새로 들어온 뉴스는 다음 리포트의 수집분으로 남긴다.
    news_end = end
    news_basis = '%s~%s(KST) 발행 뉴스 기준' % (start.isoformat(), news_end.isoformat())
    return {
        'week': {'start': start.isoformat(), 'end': end.isoformat(), 'label': '%s ~ %s' % (start.isoformat(), end.isoformat())},
        'indices': index_summary(futures_rows, start, end),
        'fx': fx_analysis(next((row for row in futures_rows or [] if row.get('symbol') == 'USDKRW'), None)),
        'hotStocks': {
            'domestic': hot_stocks(domestic_board),
            'us': hot_stocks(us_board),
            'basis': '주말 마지막 거래일의 KIS 순위(상승·하락·거래량급증·매수체결강도) 기준',
        },
        'coldStocks': {
            'domestic': cold_stocks(domestic_board),
            'us': cold_stocks(us_board),
            'basis': '하락률 상위 중 시가총액·거래대금이 확인되는 유동성 종목 우선',
        },
        'news': {
            'domestic': _news(domestic_news_items, start, news_end, 8),
            'us': _news(foreign_news_items, start, news_end, 8),
            'timeline': news_timeline(domestic_news_items, foreign_news_items, start, news_end, 20),
            'basis': news_basis,
        },
        'schedule': next_week_schedule(schedule_events, start, end),
        'scheduleBasis': '확인된 다음 주 실적·주요 기업·거시 이벤트 중 핵심 일정만 표시',
        'generatedAt': generated_at or datetime.now(timezone.utc).isoformat(),
        'sources': {
            'domesticIndex': 'KRX/KIS 수집 데이터',
            'usIndex': '네이버·KIS 수집 데이터',
            'fx': '네이버·수집 DB',
            'news': 'Naver/DART + Finnhub/Alpha Vantage(설정 공급자만)',
        },
    }
