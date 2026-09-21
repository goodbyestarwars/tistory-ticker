# -*- coding: utf-8 -*-
"""미국주식 검색·시세 어댑터.

시세 우선순위는 키움 REST API -> 한국투자증권 Open API다.
분봉은 키움 우선, 2년 일봉은 Yahoo 공개 차트 우선으로 조회한다.
"""

import logging
import os
import re
import threading
import time
import urllib.parse
import urllib.request
import json
from datetime import datetime, timedelta, time as datetime_time
from zoneinfo import ZoneInfo

import kiwoom_client
import kis_client


logger = logging.getLogger('us_stocks')

SYMBOL_RE = re.compile(r'^[A-Z][A-Z0-9.\-^=]{0,11}$')
US_SEARCH_ALIASES = {
    '일라이릴리': 'lilly',
    '일라이 릴리': 'lilly',
    '릴리': 'lilly',
}
SEARCH_TTL_SEC = 600
# 종목 목록은 19,222행(원시 응답 11.2MB)이라 10분마다 다시 받을 이유가 없다 - 상장·폐지는
# 하루 단위다. 검색 결과 캐시(SEARCH_TTL_SEC)와 수명을 따로 둔다.
SYMBOL_LIST_TTL_SEC = 6 * 3600
QUOTE_TTL_SEC = 10
CHART_TTL_SEC = {'minute': 30, 'daily': 5 * 60}
MAX_CACHE_ENTRIES = 100
NY_TZ = ZoneInfo('America/New_York')
US_DAILY_LOOKBACK_CALENDAR_DAYS = 730
US_DAILY_MIN_POINTS_FOR_LONG_MA = 224
US_MINUTE_SCOPES = ('1', '3', '5', '30', '60')
YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/'

_cache_lock = threading.Lock()
_search_cache = {}
_quote_cache = {}
_chart_cache = {}
_symbol_cache = {'saved_at': 0, 'rows': [], 'loading': False}
_symbol_cache_lock = threading.Lock()
_symbol_exchange = {}


class UsStockUnavailable(RuntimeError):
    """증권사 API에서 미국주식 데이터를 받을 수 없는 경우."""


def _cache_get(cache, key, ttl):
    with _cache_lock:
        entry = cache.get(key)
        if entry and time.time() - entry[0] < ttl:
            return entry[1]
        if entry:
            cache.pop(key, None)
    return None


def _cache_put(cache, key, value):
    with _cache_lock:
        cache[key] = (time.time(), value)
        while len(cache) > MAX_CACHE_ENTRIES:
            cache.pop(next(iter(cache)))


def normalize_symbol(symbol):
    value = str(symbol or '').strip().upper()
    if value.startswith('US:'):
        value = value[3:]
    if not SYMBOL_RE.fullmatch(value):
        raise ValueError('유효하지 않은 미국주식 티커입니다.')
    return value


def _number(value):
    if value is None or value == '':
        return None
    try:
        return float(str(value).replace(',', '').replace('%', '').strip())
    except (TypeError, ValueError):
        return None


def _first(row, *names):
    if not isinstance(row, dict):
        return None
    lowered = {str(key).lower(): value for key, value in row.items()}
    for name in names:
        value = lowered.get(name.lower())
        if value not in (None, ''):
            return value
    return None


def _records(payload):
    """키움 응답의 output/data/list 포장 차이를 흡수한다."""
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ('output', 'output1', 'result_list', 'data', 'items', 'rows', 'result', 'list'):
        if key in payload:
            rows = _records(payload[key])
            if rows:
                return rows
    if any(key in payload for key in ('stk_cd', 'stk_nm', 'cur_prc', 'last', 'symbol')):
        return [payload]
    return []


def _has_kiwoom():
    return bool(os.environ.get('KIWOOM_APPKEY') and os.environ.get('KIWOOM_SECRETKEY'))


def _has_kis():
    return bool(os.environ.get('KIS_APPKEY') and os.environ.get('KIS_APPSECRET'))


# 거래소 코드는 증권사마다 다르다(키움 ND/NY/NA, KIS NAS/NYS/AMS). `_symbol_exchange`에는
# 먼저 알아낸 쪽의 코드가 들어가므로, 꺼내 쓸 때 각자의 코드로 옮겨야 한다. 안 그러면
# 키움 종목목록이 채운 'ND'를 KIS에 그대로 넘겨 종목마다 한 번씩 헛물을 켠다.
_EXCHANGE_ALIASES = {
    'ND': ('ND', 'NAS'), 'NAS': ('ND', 'NAS'), 'NMS': ('ND', 'NAS'), 'NASDAQ': ('ND', 'NAS'),
    'NY': ('NY', 'NYS'), 'NYS': ('NY', 'NYS'), 'NYQ': ('NY', 'NYS'), 'NYSE': ('NY', 'NYS'),
    'NA': ('NA', 'AMS'), 'AMS': ('NA', 'AMS'), 'ASE': ('NA', 'AMS'), 'AMEX': ('NA', 'AMS'),
}


def _exchange_hint(symbol, broker):
    """저장된 거래소 힌트를 해당 증권사의 코드로 옮긴다. 힌트가 없거나 모르는 값이면 None."""
    pair = _EXCHANGE_ALIASES.get(str(_symbol_exchange.get(symbol) or '').strip().upper())
    if not pair:
        return None
    return pair[0] if broker == 'kiwoom' else pair[1]


def _exchange_code(exchange, broker):
    text = str(exchange or '').upper()
    if broker == 'kiwoom':
        return {'NASDAQ': 'ND', 'NMS': 'ND', 'NYSE': 'NY', 'NYQ': 'NY', 'AMEX': 'NA', 'ASE': 'NA'}.get(text)
    return {'NASDAQ': 'NAS', 'NMS': 'NAS', 'NYSE': 'NYS', 'NYQ': 'NYS', 'AMEX': 'AMS', 'ASE': 'AMS'}.get(text)


def _fold(text):
    """검색 비교용으로 문자열을 접는다 - 공백을 없애고 대소문자를 지운다.

    키움 목록의 한글명은 띄어쓰기가 제각각이다("일라이 릴리"). 사용자가 "일라이릴리"라고 붙여
    쳐도 찾아야 한다. `|`는 검색 문자열의 구분자로 쓰므로 이름에 들어 있으면 지운다.
    """
    return ''.join(str(text or '').replace('|', ' ').split()).casefold()


def _search_entry(symbol, name, exchange, is_etf, english=''):
    """검색 목록 한 줄을 만든다. 마지막 자리는 `심볼|한글명|영문명`을 접어 이어 붙인 것이다.

    영문명 원문은 따로 들고 있지 않는다. 화면에 내보내는 이름은 `name`이고, 영문명은 검색에만
    쓰이므로 접힌 사본 하나면 충분하다. 19,161행 기준 원문까지 들면 8.1MB, 접힌 것만 들면
    6.7MB다(같은 크기의 합성 데이터로 실측). 한글명과 같은 문자열이면 아예 비운다.
    """
    folded_name = _fold(name)
    folded_english = _fold(english)
    if folded_english == folded_name:
        folded_english = ''
    return (symbol, name, exchange, is_etf,
            symbol.casefold() + '|' + folded_name + '|' + folded_english)


def _load_symbol_list():
    """키움에서 종목 목록을 받아 캐시에 채운다. 백그라운드 스레드에서만 부른다.

    VM 실측으로 토큰 1.7초 + 전송·파싱 10.3초 + 정규화 2.5초 = 약 13초가 든다(11.2MB).
    이걸 사용자 요청 안에서 하면 6시간마다 누군가 한 명이 검색 한 번에 15초를 기다린다
    (실측 21.5초). 그래서 적재는 스레드에서 하고, 요청은 있는 것만 쓰거나 폴백으로 내려간다.
    """
    rows = _records_from_kiwoom_symbol_list()
    _symbol_cache.update(saved_at=time.time(), rows=rows)
    return rows


def _start_symbol_list_refresh():
    """이미 받는 중이 아니면 백그라운드 적재를 시작한다. 요청을 막지 않는다."""
    if not _has_kiwoom():
        return False
    with _symbol_cache_lock:
        if _symbol_cache['loading']:
            return False
        _symbol_cache['loading'] = True

    def run():
        try:
            rows = _load_symbol_list()
            logger.info('미국 종목 목록 %d행 적재 완료', len(rows))
        except Exception as exc:
            logger.warning('미국 종목 목록 적재 실패: %s', exc)
        finally:
            with _symbol_cache_lock:
                _symbol_cache['loading'] = False

    threading.Thread(target=run, name='us-symbol-list', daemon=True).start()
    return True


def warm_symbol_list():
    """서버가 뜰 때 한 번 불러 첫 검색이 13초를 물지 않게 한다."""
    return _start_symbol_list_refresh()


def symbol_list_for_search():
    """검색이 쓸 목록. **절대 기다리지 않는다.**

    - 신선하면 그대로 준다.
    - 오래됐으면 지금 것을 주고 뒤에서 새로 받는다(상장·폐지는 하루 단위라 몇 분 낡아도 된다).
    - 아예 없으면 적재를 시작하고 예외를 낸다 -> search()가 야후·티커 폴백으로 내려간다.
      13초쯤 뒤 두 번째 검색부터는 제대로 나온다.
    """
    rows = _symbol_cache['rows']
    if rows and time.time() - _symbol_cache['saved_at'] < SYMBOL_LIST_TTL_SEC:
        return rows
    _start_symbol_list_refresh()
    if rows:
        return rows
    raise UsStockUnavailable('미국 종목 목록을 아직 받지 못했습니다.')


def _records_from_kiwoom_symbol_list():
    """키움 미국주식 종목 목록을 (symbol, name, exchange) 튜플로 돌려준다.

    2026-09-18: 이 호출은 그동안 한 번도 성공한 적이 없다. `usa10099`를 `/api/us/mrkcond`로
    보내고 있었는데 그 URI는 이 API ID를 받지 않는다(`1504: 해당 URI에서는 지원하는 API ID가
    아닙니다`). 그래서 미국 검색은 늘 야후로 폴백했고 한글 종목명과 거래소 코드가 없었다.
    올바른 경로는 `/api/us/stkinfo`이고 응답은 `list`에 담겨 온다(실측 19,222행).

    dict 대신 튜플로 들고 있는 이유: VM이 e2-micro(1GB)다. 같은 목록을 dict로 쌓으면 7.1MB,
    튜플이면 1.4MB다(VM 실측). 검색이 실제로 돌려주는 건 최대 20행이라 그때만 dict로 만든다.

    네 번째 자리의 ETF 여부(`isEtf`)는 순위 때문에 같이 들고 온다. "엔비디아"로 찾으면 원종목
    NVDA 하나에 레버리지·인버스 ETF가 12개 딸려 나온다(NVDL, NVDU, NVDQ, ...). 전부 이름에
    "엔비디아"가 들어가서, 이 신호가 없으면 심볼 알파벳순에 밀려 NVDA가 뒤로 간다.

    다섯 번째 자리는 영문명(`stk_enm`)이다. 이게 없으면 "apple"·"tesla"로는 아무것도 못 찾는다.
    한글명만 들고 있었더니 야후로 폴백하던 시절보다 오히려 못해졌다(실측). 한글명과 같은
    문자열이면 빈 값으로 둬서 같은 문자열을 두 번 들고 있지 않는다.

    여섯 번째 자리는 세 문자열을 접어 이어 붙인 검색용 문자열이다. 자동완성이 타이핑마다
    질의를 날리는데, 그때마다 19,000행을 접으면 검색 한 번이 3.5배 비싸진다(실측 2.6ms ->
    9.2ms). 한 번 접어서 들고 있으면 행마다 `in` 한 번으로 끝난다. 구분자 `|`는 이름 경계를
    넘어가는 엉뚱한 일치를 막는다.

    같은 종목이 응답에 두 번 들어 있는 경우가 있어(실측) 심볼 기준으로 한 번만 담는다.
    """
    if not _has_kiwoom():
        raise UsStockUnavailable('키움증권 인증정보가 없습니다.')
    token = kiwoom_client.get_token(os.environ['KIWOOM_APPKEY'], os.environ['KIWOOM_SECRETKEY'])
    response = kiwoom_client.call_tr(token, 'usa10099', '/api/us/stkinfo', {'stex_tp': '%'})
    rows = _records(response)
    if not rows:
        raise UsStockUnavailable('키움 미국주식 종목 목록이 비어 있습니다.')
    normalized = []
    seen = set()
    for row in rows:
        symbol = str(_first(row, 'stk_cd', 'symbol', 'code') or '').upper()
        if not SYMBOL_RE.fullmatch(symbol) or symbol in seen:
            continue
        seen.add(symbol)
        name = _first(row, 'stk_nm', 'stk_enm', 'name', 'short_name') or symbol
        english = str(_first(row, 'stk_enm', 'english_name') or '')
        exchange = str(_first(row, 'stex_tp', 'exchange') or '')
        is_etf = str(_first(row, 'isEtf', 'is_etf') or '').strip().upper() == 'Y'
        normalized.append(_search_entry(symbol, name, exchange, is_etf, english))
        broker_exchange = _exchange_code(exchange, 'kiwoom') or exchange.strip().upper()
        if broker_exchange in ('ND', 'NY', 'NA'):
            _symbol_exchange[symbol] = broker_exchange
    return normalized


def _symbol_row(entry):
    """검색이 돌려줄 행 하나를 만든다. 목록 전체를 이 모양으로 들고 있지는 않는다."""
    symbol, name, exchange, is_etf, _haystack = entry
    return {
        'market': 'us',
        'symbol': symbol,
        'code': 'US:' + symbol,
        'name': name,
        'exchange': exchange,
        'quote_type': 'ETF' if is_etf else 'EQUITY',
    }


def _search_rank(entry, needle):
    """찾는 말에 가까운 순서. 앞자리일수록 세게 당긴다.

    ETF 여부가 세 번째로 들어가는 게 핵심이다. "엔비디아"를 치면 원종목 NVDA와 그것을 2배·인버스로
    따라가는 ETF 12개가 똑같이 이름에 "엔비디아"를 달고 나온다. 이 자리가 없으면 알파벳순에 밀려
    NVC(코기 엔비디아 2X)가 NVDA보다 먼저 뜬다.

    접기는 목록을 만들 때 이미 끝냈다. 여기서는 그 문자열을 다시 쪼개 쓴다.
    """
    symbol, name, _exchange, is_etf, haystack = entry
    folded_symbol, folded_name, folded_english = haystack.split('|')
    names = (folded_name, folded_english) if folded_english else (folded_name,)
    return (
        0 if folded_symbol == needle else 1,
        0 if needle in names else 1,
        1 if is_etf else 0,
        0 if folded_symbol.startswith(needle) else 1,
        0 if any(text.startswith(needle) for text in names) else 1,
        len(name),
        symbol,
    )


def search(query, limit=8):
    text = str(query or '').strip()
    if not text:
        return []
    limit = max(1, min(int(limit or 8), 20))
    key = text.lower() + ':' + str(limit)
    cached = _cache_get(_search_cache, key, SEARCH_TTL_SEC)
    if cached is not None:
        return cached
    try:
        rows = symbol_list_for_search()
        # 별칭은 한글 질의를 영문 회사명으로 옮겨 주는 표다. 키움 목록은 한글명을 주므로
        # 별칭만 쓰면 오히려 못 찾는다("일라이릴리" -> "lilly" -> 한글명에 없음).
        # 원문과 별칭을 둘 다 찾아보고, 더 잘 맞는 쪽으로 순위를 매긴다.
        needles = [_fold(text)]
        alias = US_SEARCH_ALIASES.get(text.casefold())
        if alias and _fold(alias) not in needles:
            needles.append(_fold(alias))
        matched = [entry for entry in rows
                   if any(needle in entry[4] for needle in needles)]
        matched.sort(key=lambda entry: min(_search_rank(entry, needle) for needle in needles))
        result = [_symbol_row(entry) for entry in matched[:limit]]
    except Exception as exc:
        logger.warning('Kiwoom 미국주식 검색 실패: %s', exc)
        # 인증 전에도 티커 직접 입력은 페이지에서 조회할 수 있도록 최소 행을 만든다.
        symbol = text.upper()
        result = ([{
            'market': 'us', 'symbol': symbol, 'code': 'US:' + symbol,
            'name': symbol, 'exchange': '', 'quote_type': 'EQUITY',
        }] if SYMBOL_RE.fullmatch(symbol) else [])
    _cache_put(_search_cache, key, result)
    return result


def _market_state(now=None):
    now = now or datetime.now(NY_TZ)
    if now.weekday() >= 5:
        return 'closed'
    current = now.time()
    if datetime_time(4, 0) <= current < datetime_time(9, 30):
        return 'pre'
    if datetime_time(9, 30) <= current < datetime_time(16, 0):
        return 'regular'
    if datetime_time(16, 0) <= current < datetime_time(20, 0):
        return 'post'
    return 'closed'


def _session_date(now=None):
    """이 시세가 어느 날 장을 기준으로 한 값인지(뉴욕 날짜, YYYY-MM-DD).

    2026-09-17 사용자 지적: "미국장 인텔 기준으로 아직도 4%대 상승인데? 이거 어제 기준 같은데?"
    맞는 지적이었다. 한국 낮 12:40은 뉴욕 수요일 밤 23:40이라 정규장이 7시간 전에 끝나 있다.
    그런데 화면은 조회 시각(`updated_at`)을 한국시간으로 보여줘서 방금 시세처럼 읽혔다.

    KIS 해외주식 현재가상세(HHDFS76200200) 응답에는 **체결 날짜 필드가 없다**
    (kis_client.fetch_overseas_price 주석의 필드 목록 참고). 그래서 뉴욕 시각으로 유추한다.
    **미국 공휴일은 반영하지 못한다** - `_market_state()`가 이미 같은 한계를 갖고 있고,
    여기서 더 정확한 척하지 않는다. 휴장일에는 직전 거래일 날짜가 아니라 그날 날짜가 나온다.

    - 장이 열려 있거나(프리/정규/애프터) 애프터마켓이 끝난 뒤(20:00 ET~자정)는 오늘
    - 자정~04:00 ET와 주말은 **직전 평일**(그 장이 마지막으로 끝난 날)
    """
    now = now or datetime.now(NY_TZ)
    day = now.date()
    if now.weekday() < 5 and now.time() >= datetime_time(4, 0):
        return day.isoformat()
    # 아직 프리마켓 전(새벽)이거나 주말 - 마지막으로 열렸던 평일로 되돌아간다.
    while True:
        day = day - timedelta(days=1)
        if day.weekday() < 5:
            return day.isoformat()


def _normalize_quote(row, symbol, provider, exchange):
    # 키움 해외주식 응답의 cur_prc와 KIS의 ovrs_prpr는 하락 종목에
    # 부호가 붙을 수 있다. 가격 자체는 양수로 노출하고, change/change_rate에만
    # 방향을 보존한다.
    raw_price = _number(_first(
        row,
        'cur_prc', 'ovrs_prpr', 'ovrs_nmix_prpr',
        'last', 'last_pric', 'last_price', 'price',
    ))
    price = abs(raw_price) if raw_price is not None else None
    if price is None:
        raise UsStockUnavailable(provider + ' 미국주식 현재가가 비어 있습니다.')
    previous_close = _number(_first(row, 'base_close_pric', 'base', 'base_pric', 'previous_close', 'prev_close'))
    # KIS 해외주식 응답의 diff/prdy_vrss는 하락 종목에서도 절댓값으로
    # 내려오는 경우가 있다. 전일 종가가 있으면 가격 차이를 기준값으로
    # 삼아 change와 change_rate의 부호가 항상 일치하도록 정규화한다.
    raw_change = _number(_first(row, 'diff', 'change', 'pred_pre', 'prdy_vrss'))
    change_rate = _number(_first(row, 'rate', 'flu_rt', 'change_rate', 'prdy_ctrt'))
    change = raw_change
    if previous_close is not None:
        change = price - previous_close
    elif change is not None and change_rate not in (None, 0):
        # 전일 종가가 없는 브로커 응답은 등락률의 부호를 우선한다.
        change = abs(change) if change_rate > 0 else -abs(change)
    if previous_close is None and change is not None:
        previous_close = price - change
    if change_rate is None and previous_close:
        change_rate = change / previous_close * 100 if change is not None else None
    # KIS 해외주식 현재체결가 응답은 high_pric/low_pric가 아니라
    # ovrs_hgpr/ovrs_lwpr를 사용한다. 이 별칭을 놓치면 현재가·등락은
    # 보이는데 오늘 고가·저가만 '-'로 남는다.
    day_high = _number(_first(
        row, 'ovrs_hgpr', 'high_pric', 'high', 'day_high', 'high_price', 'highPrice',
    ))
    day_low = _number(_first(
        row, 'ovrs_lwpr', 'low_pric', 'low', 'day_low', 'low_price', 'lowPrice',
    ))
    open_price = _number(_first(
        row, 'ovrs_oprc', 'open_pric', 'open', 'open_price', 'openPrice',
    ))
    market_cap = _number(_first(
        row, 'market_cap', 'marketCap', 'mcap', 'tomv', 'total_market_value',
    ))
    # 'h52p'/'l52p'는 KIS 해외주식 현재가상세(HHDFS76200200)의 52주 최고/최저 필드다.
    week52_high = _number(_first(
        row, 'h52p', '52wk_hgst_pric', 'fifty_two_week_high', 'h52hgpr', 'w52_hgpr',
    ))
    week52_low = _number(_first(
        row, 'l52p', '52wk_lwst_pric', 'fifty_two_week_low', 'h52lwpr', 'w52_lwpr',
    ))
    # 상장주수(발행주식 수). 현재가상세의 'shar'로 들어온다 - 유통주식 수 표시에 쓴다.
    shares = _number(_first(
        row, 'shar', 'lstg_stcn', 'listed_shares', 'shares_outstanding',
    ))
    return {
        'market': 'us',
        'symbol': symbol,
        'code': 'US:' + symbol,
        'name': _first(row, 'stk_nm', 'stk_enm', 'name', 'prdt_name', 'ovrs_item_name') or symbol,
        'exchange': exchange or _first(row, 'stex_tp', 'excd', 'exchange') or '',
        'currency': 'USD',
        'price': price,
        'previous_close': previous_close,
        'change': change,
        'change_rate': change_rate,
        'day_high': abs(day_high) if day_high is not None else None,
        'day_low': abs(day_low) if day_low is not None else None,
        'open': abs(open_price) if open_price is not None else None,
        'market_cap': abs(market_cap) if market_cap is not None else None,
        'volume': _number(_first(row, 'ovrs_vol', 'acc_trde_qty', 'tvol', 'volume', 'acml_vol')),
        'week52_high': abs(week52_high) if week52_high is not None else None,
        'week52_low': abs(week52_low) if week52_low is not None else None,
        'shares_outstanding': abs(shares) if shares is not None else None,
        'market_state': _market_state(),
        # 2026-09-17: 조회 시각(updated_at)만으로는 "언제 기준 시세인지"를 알 수 없었다.
        # 시세가 속한 장의 날짜를 같이 준다(_session_date 주석 참고 - 공휴일 미반영).
        'session_date': _session_date(),
        'updated_at': int(time.time()),
        'source': provider,
        'provider': 'kiwoom' if provider.startswith('키움') else ('kis' if provider.startswith('한국투자') else 'yahoo'),
    }


def _kiwoom_quote(symbol):
    if not _has_kiwoom():
        raise UsStockUnavailable('키움증권 인증정보가 없습니다.')
    token = kiwoom_client.get_token(os.environ['KIWOOM_APPKEY'], os.environ['KIWOOM_SECRETKEY'])
    hint = _exchange_hint(symbol, 'kiwoom')
    candidates = [hint] if hint else []
    candidates.extend(code for code in ('ND', 'NY', 'NA') if code not in candidates)
    last_error = None
    for exchange in candidates:
        try:
            response = kiwoom_client.call_tr(token, 'usa20100', '/api/us/mrkcond', {
                'stex_tp': exchange,
                'stk_cd': symbol,
            })
            rows = _records(response)
            if rows:
                return _normalize_quote(rows[0], symbol, '키움증권 REST API', exchange)
        except Exception as exc:
            last_error = exc
    raise UsStockUnavailable('키움 미국주식 현재가 조회 실패') from last_error


def _kiwoom_exchange_candidates(symbol):
    known = _exchange_hint(symbol, 'kiwoom')
    candidates = [known] if known else []
    candidates.extend(code for code in ('ND', 'NY', 'NA') if code not in candidates)
    return candidates


def _kiwoom_orderbook(symbol):
    if not _has_kiwoom():
        raise UsStockUnavailable('키움증권 인증정보가 없습니다.')
    token = kiwoom_client.get_token(os.environ['KIWOOM_APPKEY'], os.environ['KIWOOM_SECRETKEY'])
    last_error = None
    for exchange in _kiwoom_exchange_candidates(symbol):
        try:
            response = kiwoom_client.call_tr(token, 'usa20101', '/api/us/mrkcond', {
                'stex_tp': exchange,
                'stk_cd': symbol,
            })
            rows = _records(response)
            if not rows:
                continue
            row = rows[0]
            asks = []
            bids = []
            for level in range(1, 11):
                ask_price = _number(_first(row, 'sel_%dbid' % level))
                ask_size = _number(_first(row, 'sel_%dbid_req' % level))
                bid_price = _number(_first(row, 'buy_%dbid' % level))
                bid_size = _number(_first(row, 'buy_%dbid_req' % level))
                if ask_price is not None:
                    asks.append({'level': level, 'price': ask_price, 'size': ask_size})
                if bid_price is not None:
                    bids.append({'level': level, 'price': bid_price, 'size': bid_size})
            return {
                'market': 'us', 'symbol': symbol, 'code': 'US:' + symbol,
                'exchange': exchange, 'asks': asks, 'bids': bids,
                'updated_at': int(time.time()), 'source': '키움증권 REST API',
            }
        except Exception as exc:
            last_error = exc
    raise UsStockUnavailable('키움 미국주식 호가 조회 실패') from last_error


def _chart_time(row, daily):
    date_text = str(_first(row, 'bus_dt', 'dt', 'date') or '')
    time_text = str(_first(row, 'cntr_tm', 'time') or '')
    if daily:
        return date_text[:4] + '-' + date_text[4:6] + '-' + date_text[6:8] if len(date_text) == 8 else date_text
    if len(time_text) == 14:
        date_text, time_text = time_text[:8], time_text[8:]
    if len(date_text) != 8 or len(time_text) < 4:
        return None
    try:
        local = datetime.strptime(date_text + time_text[:6], '%Y%m%d%H%M%S').replace(tzinfo=NY_TZ)
        return int(local.timestamp())
    except ValueError:
        return None


def chart(symbol, timeframe='minute', tic_scope='1'):
    """키움 미국주식 분봉 또는 일봉을 공통 포맷으로 반환한다."""
    symbol = normalize_symbol(symbol)
    if timeframe not in ('minute', 'daily'):
        raise ValueError('timeframe은 minute 또는 daily여야 합니다.')
    tic_scope = str(tic_scope or '1')
    if tic_scope not in US_MINUTE_SCOPES:
        raise ValueError('tic_scope는 1/3/5/30/60 중 하나여야 합니다.')
    cache_key = (symbol, timeframe, tic_scope)
    cached = _cache_get(_chart_cache, cache_key, CHART_TTL_SEC[timeframe])
    if cached is not None:
        return cached

    # 키움 usa06012는 2년을 요청해도 약 100개로 잘린 일봉을 주는 경우가 많아,
    # 결국 Yahoo 2년 보완 호출까지 직렬로 거쳤다. 첫 차트가 6초 이상 걸리던
    # 주된 원인이므로, 장기 이동평균에 필요한 일봉은 바로 Yahoo에서 가져온다.
    if timeframe == 'daily':
        try:
            data = _yahoo_chart(symbol, timeframe, tic_scope=tic_scope)
            _cache_put(_chart_cache, cache_key, data)
            return data
        except Exception as exc:
            raise UsStockUnavailable('미국주식 일봉 차트 조회 실패') from exc

    last_error = None
    if _has_kiwoom():
        try:
            token = kiwoom_client.get_token(os.environ['KIWOOM_APPKEY'], os.environ['KIWOOM_SECRETKEY'])
            api_id = 'usa06011' if timeframe == 'minute' else 'usa06012'
            today = datetime.now(NY_TZ).date()
            # 미국 분봉 API는 장기간을 한 번에 요청하면 정상 코드(0)여도
            # result_list가 비어 올 수 있습니다. 분봉은 오늘 데이터만, 일봉은 2년 범위를 요청합니다.
            start_date = today.strftime('%Y%m%d') if timeframe == 'minute' else (
                today - timedelta(days=US_DAILY_LOOKBACK_CALENDAR_DAYS)
            ).strftime('%Y%m%d')
            for exchange in _kiwoom_exchange_candidates(symbol):
                body = {
                    'stex_tp': exchange, 'stk_cd': symbol, 'strt_dt': start_date,
                    'upd_stkpc_tp': '1', 'exrt_appl_tp': '0',
                }
                if timeframe == 'minute':
                    body['tic_scope'] = tic_scope
                response = kiwoom_client.call_tr(token, api_id, '/api/us/chart', body)
                rows = _records(response)
                points = []
                for row in rows:
                    stamp = _chart_time(row, timeframe == 'daily')
                    price = _number(_first(row, 'cur_prc', 'price'))
                    if stamp is None or price is None:
                        continue
                    open_price = _number(_first(row, 'open_pric', 'open', 'open_price')) or price
                    high_price = _number(_first(row, 'high_pric', 'high', 'high_price')) or max(open_price, price)
                    low_price = _number(_first(row, 'low_pric', 'low', 'low_price')) or min(open_price, price)
                    points.append({
                        'time': stamp,
                        'open': open_price,
                        'high': high_price,
                        'low': low_price,
                        'close': price,
                        'price': price,
                        'volume': _number(_first(row, 'trde_qty', 'acc_trde_qty')) or 0,
                    })
                # usa06012 can return a successful response with only its capped
                # page (currently about 100 rows), even when a two-year start date
                # was requested. That is not enough to calculate the 224-day MA.
                # Keep Kiwoom for short/intraday charts, but use the two-year Yahoo
                # fallback for daily charts whenever the long lookback is incomplete.
                has_long_daily_history = (
                    timeframe != 'daily' or len(points) >= US_DAILY_MIN_POINTS_FOR_LONG_MA
                )
                if points and has_long_daily_history:
                    points.sort(key=lambda point: point['time'])
                    data = {
                        'market': 'us', 'symbol': symbol, 'code': 'US:' + symbol,
                        'timeframe': timeframe, 'exchange': exchange,
                        'points': points, 'updated_at': int(time.time()),
                        'source': '키움증권 REST API',
                    }
                    _cache_put(_chart_cache, cache_key, data)
                    return data
                if timeframe == 'daily' and points:
                    logger.warning(
                        'Kiwoom daily chart returned only %s points for %s; using Yahoo two-year fallback',
                        len(points), symbol,
                    )
        except Exception as exc:
            last_error = exc
    try:
        data = _yahoo_chart(symbol, timeframe, tic_scope=tic_scope)
        _cache_put(_chart_cache, cache_key, data)
        return data
    except Exception as exc:
        if last_error is None:
            last_error = exc
    raise UsStockUnavailable('미국주식 차트 조회 실패') from last_error


def _aggregate_intraday_points(points, minutes):
    """Yahoo 1분 데이터를 요청 간격으로 합친다(미국 거래소 현지시간 기준)."""
    groups = {}
    for point in points:
        stamp = point.get('time')
        if not isinstance(stamp, (int, float)):
            continue
        local = datetime.fromtimestamp(stamp, tz=NY_TZ)
        bucket_minute = (local.hour * 60 + local.minute) // minutes * minutes
        key = (local.date().isoformat(), bucket_minute)
        group = groups.get(key)
        if group is None:
            group = {
                'time': int(local.replace(hour=bucket_minute // 60, minute=bucket_minute % 60,
                                          second=0, microsecond=0).timestamp()),
                'open': point['open'], 'high': point['high'], 'low': point['low'],
                'close': point['close'], 'price': point['close'], 'volume': point['volume'],
            }
            groups[key] = group
        else:
            group['high'] = max(group['high'], point['high'])
            group['low'] = min(group['low'], point['low'])
            group['close'] = point['close']
            group['price'] = point['close']
            group['volume'] += point['volume']
    return sorted(groups.values(), key=lambda point: point['time'])


def _yahoo_chart(symbol, timeframe, tic_scope='1'):
    if timeframe == 'minute':
        # Yahoo는 3분봉을 직접 제공하지 않으므로 1분봉을 받아 아래에서 합친다.
        interval = {'1': '1m', '3': '1m', '5': '5m', '30': '30m', '60': '60m'}[str(tic_scope)]
        range_value = '7d' if interval == '1m' else ('60d' if interval in ('5m', '30m') else '730d')
    else:
        range_value, interval = '2y', '1d'
    query = urllib.parse.urlencode({'range': range_value, 'interval': interval, 'events': 'history'})
    payload = _get_yahoo_json(YAHOO_CHART_URL + urllib.parse.quote(symbol, safe='') + '?' + query)
    result = ((payload.get('chart') or {}).get('result') or [None])[0]
    if not result:
        raise RuntimeError('Yahoo chart result is empty')
    timestamps = result.get('timestamp') or []
    quotes = (((result.get('indicators') or {}).get('quote') or [{}])[0])
    points = []
    for index, timestamp in enumerate(timestamps):
        close = _number(_series_value(quotes.get('close'), index))
        if close is None:
            continue
        open_price = _number(_series_value(quotes.get('open'), index)) or close
        high_price = _number(_series_value(quotes.get('high'), index)) or max(open_price, close)
        low_price = _number(_series_value(quotes.get('low'), index)) or min(open_price, close)
        stamp = int(timestamp)
        chart_time = stamp if timeframe == 'minute' else datetime.fromtimestamp(stamp, tz=NY_TZ).date().isoformat()
        points.append({
            'time': chart_time,
            'open': open_price,
            'high': high_price,
            'low': low_price,
            'close': close,
            'price': close,
            'volume': _number(_series_value(quotes.get('volume'), index)) or 0,
        })
    if not points:
        raise RuntimeError('Yahoo chart points are empty')
    if timeframe == 'minute' and str(tic_scope) == '3':
        points = _aggregate_intraday_points(points, 3)
    return {
        'market': 'us', 'symbol': symbol, 'code': 'US:' + symbol,
        'timeframe': timeframe, 'exchange': ((result.get('meta') or {}).get('exchangeName') or 'US'),
        'points': points, 'updated_at': int(time.time()),
        'source': 'Yahoo Finance chart fallback',
    }


def _yahoo_quote(symbol):
    """Yahoo 차트 메타데이터를 이용한 현재가 최종 폴백.

    키움·한국투자 API가 일시적으로 실패하면 기존에는 관심종목 전체가
    ``조회 실패``로 남았다. Yahoo의 공개 차트 응답에는 장중 현재가와
    직전 종가가 함께 있어, 증권사 API 장애 시에도 화면을 채울 수 있다.
    지연될 수 있는 보조 경로이므로 실시간 스트림의 대체가 아니라 REST
    조회 실패 시에만 사용한다.

    2026-09-21: `includePrePost=true`로 요청만 해놓고 정작 `regularMarketPrice`만
    읽어서, 프리장(04:00~09:30 ET)·애프터장(16:00~20:00 ET)에는 정규장 마감가가
    그대로 굳어 있었다(정규장 시간 외에는 `regularMarketPrice`가 갱신되지 않는 필드다).
    Yahoo 응답의 `preMarketPrice`/`postMarketPrice`(및 각각의 change/changePercent)는
    수년째 안정적으로 쓰이는 공개 필드라 장 상태에 맞춰 그쪽을 우선한다.
    """
    query = urllib.parse.urlencode({
        'range': '1d',
        'interval': '5m',
        'includePrePost': 'true',
        'events': 'history',
    })
    payload = _get_yahoo_json(YAHOO_CHART_URL + urllib.parse.quote(symbol, safe='') + '?' + query)
    result = ((payload.get('chart') or {}).get('result') or [None])[0]
    if not result:
        raise UsStockUnavailable('Yahoo 현재가 응답이 비어 있습니다.')
    meta = result.get('meta') or {}
    state = _market_state()
    price = None
    change = None
    change_rate = None
    if state == 'pre':
        price = _number(meta.get('preMarketPrice'))
        change = _number(meta.get('preMarketChange'))
        change_rate = _number(meta.get('preMarketChangePercent'))
    elif state == 'post':
        price = _number(meta.get('postMarketPrice'))
        change = _number(meta.get('postMarketChange'))
        change_rate = _number(meta.get('postMarketChangePercent'))
    if price is None:
        price = _number(meta.get('regularMarketPrice'))
        change = None
        change_rate = None
    if price is None:
        timestamps = result.get('timestamp') or []
        quotes = (((result.get('indicators') or {}).get('quote') or [{}])[0])
        closes = quotes.get('close') or []
        for index in range(len(timestamps) - 1, -1, -1):
            price = _number(_series_value(closes, index))
            if price is not None:
                break
    previous_close = _number(meta.get('previousClose') or meta.get('chartPreviousClose'))
    if price is None:
        raise UsStockUnavailable('Yahoo 현재가가 비어 있습니다.')
    if change is None:
        change = price - previous_close if previous_close is not None else None
    if change_rate is None:
        change_rate = change / previous_close * 100 if change is not None and previous_close else None
    return _normalize_quote({
        'price': price,
        'previous_close': previous_close,
        'change': change,
        'change_rate': change_rate,
        'name': meta.get('longName') or meta.get('shortName') or symbol,
    }, symbol, 'Yahoo Finance 현재가 폴백', meta.get('exchangeName') or 'US')


def _series_value(values, index):
    if not isinstance(values, list) or index >= len(values):
        return None
    return values[index]


def _get_yahoo_json(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'tistory-ticker/1.0'})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode('utf-8'))


def _kis_quote(symbol):
    if not _has_kis():
        raise UsStockUnavailable('한국투자증권 인증정보가 없습니다.')
    token = kis_client.get_token(os.environ['KIS_APPKEY'], os.environ['KIS_APPSECRET'])
    hint = _exchange_hint(symbol, 'kis')
    candidates = [hint] if hint else []
    candidates.extend(code for code in ('NAS', 'NYS', 'AMS') if code not in candidates)
    last_error = None
    for exchange in candidates:
        try:
            row = kis_client.fetch_overseas_price(token, os.environ['KIS_APPKEY'], os.environ['KIS_APPSECRET'], exchange, symbol)
            if isinstance(row, list):
                row = row[0] if row else {}
            if row:
                # 미국 실시간 WebSocket 등록키(DNAS/DNYS/DAMS)를 한 종목당 하나만
                # 만들 수 있도록 REST에서 확인한 거래소를 같은 프로세스에 기억한다.
                _symbol_exchange[symbol] = exchange
                return _normalize_quote(row, symbol, '한국투자증권 Open API', exchange)
        except Exception as exc:
            last_error = exc
    raise UsStockUnavailable('한국투자증권 미국주식 현재가 조회 실패') from last_error


def quote(symbol):
    symbol = normalize_symbol(symbol)
    cached = _cache_get(_quote_cache, symbol, QUOTE_TTL_SEC)
    if cached is not None:
        return cached
    errors = []
    # 실시간 종목판의 기본 공급자 정책과 동일하게 KIS를 1차로 사용하고,
    # KIS 장애·미설정일 때만 키움으로 내려간다. 마지막으로 Yahoo는 지연
    # 데이터 보조 경로다.
    for fetcher in (_kis_quote, _kiwoom_quote):
        try:
            data = fetcher(symbol)
            _cache_put(_quote_cache, symbol, data)
            return data
        except Exception as exc:
            errors.append(str(exc))
            logger.warning('%s quote failed for %s: %s', getattr(fetcher, '__name__', 'broker'), symbol, exc)
    try:
        data = _yahoo_quote(symbol)
        _cache_put(_quote_cache, symbol, data)
        return data
    except Exception as exc:
        errors.append(str(exc))
        logger.warning('Yahoo quote fallback failed for %s: %s', symbol, exc)
    raise UsStockUnavailable('한국투자증권·키움 미국주식 시세를 모두 조회하지 못했습니다.')
