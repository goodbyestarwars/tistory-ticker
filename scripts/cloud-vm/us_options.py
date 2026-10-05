"""미국 종목 당일 만기(0DTE) 옵션 감마 요약.

Cboe 지연 시세 공개 JSON(옵션 체인 전체, 종목에 따라 1.5~6MB)을 받아 가장 가까운 만기의
행사가별 감마 노출(GEX) 추정치만 뽑아 낸다. 서버 부담을 줄이기 위한 규칙:
- 결과(작은 요약)만 캐시한다. 장중 5분, 장외 30분, 옵션 없음·너무 큰 응답은 1시간.
- 같은 종목 동시 요청은 한 번만 받는다(락). 서로 다른 종목도 한 번에 하나씩만 받는다(세마포어).
- 응답이 MAX_BODY_BYTES를 넘으면(SPY 같은 큰 체인) 받다가 중단하고 '지원 안 함'을 캐시한다.
- 캐시 항목 수 상한, 받은 체인은 계산 직후 버린다(1GB 메모리 VM).
감마 노출은 "시장조성자가 콜을 팔고 풋을 샀다"는 가정의 추정치이며 실제 포지션이 아니다.
미결제약정은 전일 기준이라 장중에는 갱신되지 않는다.
"""
import gzip
import json
import re
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

import us_stocks

CBOE_URL = 'https://cdn-api.cboe.com/api/global/delayed_quotes/options/%s.json'
MAX_BODY_BYTES = 4 * 1024 * 1024
TTL_OPEN = 300
TTL_CLOSED = 1800
TTL_NEGATIVE = 3600
CACHE_MAX = 40
STRIKE_BAND = 0.06
_NY = ZoneInfo('America/New_York')
_OPTION_RE = re.compile(r'^([A-Z.]+)(\d{6})([CP])(\d{8})$')

_cache = {}                       # symbol -> (expires_at, payload)
_locks = {}                       # symbol -> Lock
_locks_guard = threading.Lock()
_download = threading.Semaphore(1)


def _ny_now():
    return datetime.now(_NY)


def _market_open(now):
    if now.weekday() >= 5:
        return False
    minutes = now.hour * 60 + now.minute
    return 9 * 60 + 30 <= minutes < 16 * 60


def _lock_for(symbol):
    with _locks_guard:
        return _locks.setdefault(symbol, threading.Lock())


def _fetch_chain(symbol):
    """체인 JSON을 받아 dict로. 너무 크면 None, 옵션 없음은 ValueError."""
    request = urllib.request.Request(CBOE_URL % symbol, headers={
        'User-Agent': 'Mozilla/5.0', 'Accept-Encoding': 'gzip',
    })
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            length = response.headers.get('Content-Length')
            raw = response.read(MAX_BODY_BYTES + 1)
            encoding = response.headers.get('Content-Encoding', '')
    except urllib.error.HTTPError as exc:
        if exc.code in (403, 404):
            raise ValueError('옵션 체인이 없는 종목입니다.')
        raise us_stocks.UsStockUnavailable('옵션 체인을 불러오지 못했습니다.')
    except (urllib.error.URLError, TimeoutError, OSError):
        raise us_stocks.UsStockUnavailable('옵션 체인을 불러오지 못했습니다.')
    if 'gzip' in encoding:
        try:
            raw = gzip.decompress(raw)
        except OSError:
            raise us_stocks.UsStockUnavailable('옵션 체인을 불러오지 못했습니다.')
    # 압축 전송이어도 풀린 크기를 기준으로 상한을 둔다(파싱 때 메모리를 쓰는 건 풀린 쪽).
    if len(raw) > MAX_BODY_BYTES or (length and not encoding and int(length) > MAX_BODY_BYTES):
        return None
    try:
        return json.loads(raw)
    except ValueError:
        raise us_stocks.UsStockUnavailable('옵션 체인 형식이 올바르지 않습니다.')


def summarize(chain, today):
    """체인에서 가장 가까운 만기의 행사가별 감마 노출(백만 달러/주가 1%)을 요약한다."""
    data = (chain or {}).get('data') or {}
    options = data.get('options') or []
    price = data.get('current_price')
    if not options or not isinstance(price, (int, float)) or price <= 0:
        return None
    parsed = []
    nearest = None
    for item in options:
        match = _OPTION_RE.match(item.get('option') or '')
        if not match:
            continue
        expiry = match.group(2)
        if nearest is None or expiry < nearest:
            nearest = expiry
        parsed.append((expiry, match.group(3), int(match.group(4)) / 1000.0, item))
    if nearest is None:
        return None
    rows = {}
    for expiry, side, strike, item in parsed:
        if expiry != nearest:
            continue
        gamma = item.get('gamma') or 0
        interest = item.get('open_interest') or 0
        exposure = gamma * interest * 100 * price * price * 0.01 / 1e6
        row = rows.setdefault(strike, {'call': 0.0, 'put': 0.0})
        row['call' if side == 'C' else 'put'] += exposure
    if not rows:
        return None
    expiry_date = '20%s-%s-%s' % (nearest[0:2], nearest[2:4], nearest[4:6])
    near = sorted(k for k in rows if abs(k / price - 1) <= STRIKE_BAND)
    call_wall = max(rows, key=lambda k: rows[k]['call'])
    put_wall = max(rows, key=lambda k: rows[k]['put'])
    return {
        'price': price,
        'expiry': expiry_date,
        'is_0dte': expiry_date == today.strftime('%Y-%m-%d'),
        'strikes': [{'strike': k, 'call': round(rows[k]['call'], 2), 'put': round(rows[k]['put'], 2)} for k in near],
        'call_wall': call_wall,
        'put_wall': put_wall,
        'net': round(sum(r['call'] - r['put'] for r in rows.values()), 1),
        'source': 'Cboe 지연 시세',
        'basis': '미결제약정 전일 기준 · 시장조성자 포지션 가정 추정',
    }


def _trim_cache():
    if len(_cache) <= CACHE_MAX:
        return
    for key in sorted(_cache, key=lambda k: _cache[k][0])[:len(_cache) - CACHE_MAX]:
        _cache.pop(key, None)


def get_summary(symbol):
    symbol = us_stocks.normalize_symbol(symbol)
    now = time.time()
    hit = _cache.get(symbol)
    if hit and hit[0] > now:
        return hit[1]
    with _lock_for(symbol):
        hit = _cache.get(symbol)            # 기다리는 사이 다른 요청이 채웠을 수 있다
        if hit and hit[0] > time.time():
            return hit[1]
        ny = _ny_now()
        ttl = TTL_OPEN if _market_open(ny) else TTL_CLOSED
        with _download:
            try:
                chain = _fetch_chain(symbol)
            except ValueError:
                payload = {'available': False, 'reason': 'no_options', 'symbol': symbol}
                _cache[symbol] = (time.time() + TTL_NEGATIVE, payload)
                _trim_cache()
                return payload
            if chain is None:
                payload = {'available': False, 'reason': 'too_large', 'symbol': symbol}
                _cache[symbol] = (time.time() + TTL_NEGATIVE, payload)
                _trim_cache()
                return payload
            summary = summarize(chain, ny.date())
            del chain
        if summary is None:
            payload = {'available': False, 'reason': 'no_options', 'symbol': symbol}
            _cache[symbol] = (time.time() + TTL_NEGATIVE, payload)
        else:
            payload = dict(summary, available=True, symbol=symbol, updated_at=int(time.time()))
            _cache[symbol] = (time.time() + ttl, payload)
        _trim_cache()
        return payload
