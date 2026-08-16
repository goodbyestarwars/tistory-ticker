# -*- coding: utf-8 -*-
"""주말용 한 주 시장 리포트 조립기.

외부 API를 직접 호출하지 않고, main.py가 이미 확보한 지수·뉴스·순위
데이터를 한 화면용 계약으로 정리한다. 순수 함수 중심으로 둬서 데이터가
없는 휴일에도 빈 배열로 안전하게 렌더링할 수 있다.
"""

from datetime import date, datetime, timedelta, timezone


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
    """Build the four requested index cards from /futures daily charts."""
    wanted = {
        'KOSPI': '코스피',
        'KOSDAQ': '코스닥',
        'NASDAQ_INDEX': '나스닥 종합',
        'SP500_INDEX': 'S&P500',
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
            'name': wanted[symbol],
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
        'tags': [tag],
    }


def hot_stocks(board_data, limit=10):
    """Merge last-session rise/fall/volume-power rankings without duplicates."""
    merged = {}
    sections = (board_data or {}).get('sections') or {}
    for section, tag in (
        ('rising', '상승 상위'), ('falling', '하락 상위'),
        ('volumePower', '매수체결강도'), ('volumeSurge', '거래량 급증'),
    ):
        for raw in (sections.get(section) or [])[:limit]:
            item = _hot_row(raw, tag)
            if not item:
                continue
            current = merged.get(item['code'])
            if current:
                current['tags'] = list(dict.fromkeys(current['tags'] + item['tags']))
            else:
                merged[item['code']] = item
    rows = list(merged.values())
    rows.sort(key=lambda item: (len(item['tags']), abs(item.get('changeRate') or 0)), reverse=True)
    return rows[:limit]


def _within_week(item, start, end):
    day = _date_value(item.get('pubDate') or item.get('publishedAt') or item.get('date'))
    return day is None or start <= day <= end


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
    for event in events or []:
        day = _date_value(event.get('start') or event.get('date')) if isinstance(event, dict) else None
        if day and next_start <= day <= next_end:
            result.append({
                'date': day.isoformat(),
                'title': event.get('title') or event.get('name') or '일정',
                'symbol': event.get('symbol') or event.get('ticker') or '',
                'source': event.get('source') or event.get('provider') or '',
            })
    return sorted(result, key=lambda item: (item['date'], item['title']))


def build_report(start, end, futures_rows=None, domestic_news_items=None,
                 foreign_news_items=None, domestic_board=None, us_board=None,
                 schedule_events=None, generated_at=None):
    return {
        'week': {'start': start.isoformat(), 'end': end.isoformat(), 'label': '%s ~ %s' % (start.isoformat(), end.isoformat())},
        'indices': index_summary(futures_rows, start, end),
        'fx': next((row for row in futures_rows or [] if row.get('symbol') == 'USDKRW'), None),
        'hotStocks': {
            'domestic': hot_stocks(domestic_board),
            'us': hot_stocks(us_board),
            'basis': '주말 마지막 거래일의 KIS 순위(상승·하락·거래량급증·매수체결강도) 기준',
        },
        'news': {
            'domestic': _news(domestic_news_items, start, end, 8),
            'us': _news(foreign_news_items, start, end, 8),
        },
        'schedule': next_week_schedule(schedule_events, start, end),
        'generatedAt': generated_at or datetime.now(timezone.utc).isoformat(),
        'sources': {
            'domesticIndex': 'KRX/KIS 수집 데이터',
            'usIndex': '네이버·KIS 수집 데이터',
            'fx': '네이버·수집 DB',
            'news': 'Naver/DART + Finnhub/Alpha Vantage(설정 공급자만)',
        },
    }
