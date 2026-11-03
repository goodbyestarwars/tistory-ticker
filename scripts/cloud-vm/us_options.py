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
import math
import os
import re
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import us_stocks
from snapshot_io import atomic_json

CBOE_URL = 'https://cdn-api.cboe.com/api/global/delayed_quotes/options/%s.json'
MAX_BODY_BYTES = 4 * 1024 * 1024
TTL_OPEN = 300
TTL_CLOSED = 1800
TTL_NEGATIVE = 3600
CACHE_MAX = 40
STRIKE_BAND = 0.06
_NY = ZoneInfo('America/New_York')
# 전체 만기 종합 지표(맥스 페인·풋/콜·감마 플립). 감마 플립은 주가 격자에서 BS 감마를 다시 계산한다.
FLIP_SPAN = 0.15
FLIP_STEP = 0.005
VOLUME_HISTORY_FILE = os.environ.get(
    'US_OPTIONS_VOLUME_HISTORY_FILE',
    os.path.join(os.path.dirname(os.path.abspath(__file__)), 'us_options_volume_history.json'))
VOLUME_HISTORY_DAYS = 40
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


def _as_of(chain):
    """Cboe 응답 timestamp(UTC, 실측: 마지막 체결 시각보다 약 15분 뒤)를 epoch초로. 형식이 다르면 None."""
    try:
        parsed = datetime.strptime(str((chain or {}).get('timestamp')), '%Y-%m-%d %H:%M:%S')
        return int(parsed.replace(tzinfo=timezone.utc).timestamp())
    except ValueError:
        return None


def _mid_price(item):
    bid, ask = item.get('bid') or 0, item.get('ask') or 0
    if bid > 0 and ask > 0:
        return (bid + ask) / 2.0
    return item.get('last_trade_price') or 0


def _bs_gamma(spot, strike, iv, years):
    if spot <= 0 or strike <= 0 or iv <= 0 or years <= 0:
        return 0.0
    vol = iv * math.sqrt(years)
    d1 = (math.log(spot / strike) + 0.5 * iv * iv * years) / vol
    return math.exp(-0.5 * d1 * d1) / (math.sqrt(2 * math.pi) * spot * vol)


def _years_to_expiry(expiry, now):
    """만기 yymmdd의 미국 장 마감(16:00 ET)까지 남은 연 단위 시간. 0DTE 폭주를 막으려 하한을 둔다."""
    close = datetime(2000 + int(expiry[0:2]), int(expiry[2:4]), int(expiry[4:6]), 16, 0, tzinfo=_NY)
    return max((close - now).total_seconds() / (365 * 86400.0), 0.5 / 365)


def _max_pain(strikes):
    """strike -> [call_oi, put_oi]. 만기 때 옵션 매수자 총 가치가 가장 작은 행사가."""
    best, best_loss = None, None
    for candidate in strikes:
        loss = 0.0
        for strike, (call_oi, put_oi) in strikes.items():
            loss += call_oi * max(candidate - strike, 0) + put_oi * max(strike - candidate, 0)
        if best_loss is None or loss < best_loss:
            best, best_loss = candidate, loss
    return best


def _gamma_flip(contracts, price):
    """주가가 FLIP_SPAN 안에서 움직일 때 전체 순감마 노출이 0이 되는 현재가에 가장 가까운 지점(없으면 None)."""
    steps = int(FLIP_SPAN / FLIP_STEP)
    spots = [price * (1 + FLIP_STEP * i) for i in range(-steps, steps + 1)]
    totals = [0.0] * len(spots)
    for sign, strike, iv, years, interest in contracts:
        if abs(strike / price - 1) > FLIP_SPAN * 2:
            continue
        weight = sign * interest * 100 * 0.01 / 1e6
        for index, spot in enumerate(spots):
            totals[index] += weight * _bs_gamma(spot, strike, iv, years) * spot * spot
    crossings = []
    for index in range(len(spots) - 1):
        a, b = totals[index], totals[index + 1]
        if a != 0 and (a < 0) != (b < 0):
            crossings.append(spots[index] + a / (a - b) * (spots[index + 1] - spots[index]))
    if not crossings:
        return None
    return round(min(crossings, key=lambda x: abs(x - price)), 2)


def _volume_baseline(symbol, today, total_volume):
    """매일 전체 거래량을 저장해 3/7/30일 평균 대비 비율을 만든다(기록이 쌓인 만큼만)."""
    key = today.strftime('%Y-%m-%d')
    try:
        with open(VOLUME_HISTORY_FILE, encoding='utf-8') as handle:
            history = json.load(handle)
    except (OSError, ValueError):
        history = {}
    days = history.get(symbol) or {}
    prior = [days[d] for d in sorted(days) if d < key]
    if total_volume and days.get(key) != total_volume:
        days[key] = total_volume
        for old in sorted(days)[:-VOLUME_HISTORY_DAYS]:
            days.pop(old, None)
        history[symbol] = days
        try:
            atomic_json(VOLUME_HISTORY_FILE, history)
        except OSError:
            pass
    baseline = {}
    for window in (3, 7, 30):
        sample = prior[-window:]
        if len(sample) == window and sum(sample) > 0:
            baseline[str(window)] = round(total_volume / (sum(sample) / window) * 100, 1)
    return baseline, len(prior)


def _wall(gex, side, price, above):
    pool = [k for k in gex if (k >= price if above else k <= price)] or list(gex)
    return max(pool, key=lambda k: gex[k][side]) if pool else None


def _share(call, put):
    return round(call * 100.0 / (call + put), 1) if call + put > 0 else None


def _overview(parsed, price, nearest, now, symbol, today):
    """전체 만기 종합: 풋/콜 비율, 비중, 맥스 페인(가장 가까운 만기), 월·감마 플립, 평소 대비 거래량."""
    totals = {'call_vol': 0, 'put_vol': 0, 'call_oi': 0, 'put_oi': 0, 'call_prem': 0.0, 'put_prem': 0.0}
    gex = {}
    pain = {}
    contracts = []
    for expiry, side, strike, item in parsed:
        interest = item.get('open_interest') or 0
        volume = int(item.get('volume') or 0)
        key = 'call' if side == 'C' else 'put'
        totals[key + '_vol'] += volume
        totals[key + '_oi'] += int(interest)
        totals[key + '_prem'] += volume * _mid_price(item) * 100
        exposure = (item.get('gamma') or 0) * interest * 100 * price * price * 0.01 / 1e6
        gex.setdefault(strike, {'call': 0.0, 'put': 0.0})[key] += exposure
        if expiry == nearest:
            pain.setdefault(strike, [0, 0])[0 if side == 'C' else 1] += int(interest)
        iv = item.get('iv') or 0
        if interest > 0 and iv > 0:
            contracts.append((1 if side == 'C' else -1, strike, iv, _years_to_expiry(expiry, now), interest))
    total_volume = totals['call_vol'] + totals['put_vol']
    baseline, history_days = _volume_baseline(symbol, today, total_volume)
    return {
        'max_pain': _max_pain(pain) if pain else None,
        'pc_volume': round(totals['put_vol'] / totals['call_vol'], 2) if totals['call_vol'] else None,
        'pc_oi': round(totals['put_oi'] / totals['call_oi'], 2) if totals['call_oi'] else None,
        'call_share': {'volume': _share(totals['call_vol'], totals['put_vol']),
                       'oi': _share(totals['call_oi'], totals['put_oi']),
                       'premium': _share(totals['call_prem'], totals['put_prem'])},
        'total_volume': total_volume,
        'volume_vs_avg': baseline,
        'volume_history_days': history_days,
        # 저항(콜 월)은 현재가 위, 지지(풋 월)는 아래에서 감마가 가장 큰 행사가. 없으면 전체에서 고른다.
        'call_wall': _wall(gex, 'call', price, above=True),
        'put_wall': _wall(gex, 'put', price, above=False),
        'gamma_flip': _gamma_flip(contracts, price) if contracts else None,
        'net_gex': round(sum(r['call'] - r['put'] for r in gex.values()), 1),
    }


def summarize(chain, today, symbol='', now=None):
    """체인에서 가장 가까운 만기의 행사가별 감마 노출(백만 달러/주가 1%)을 요약한다."""
    data = (chain or {}).get('data') or {}
    options = data.get('options') or []
    price = data.get('current_price')
    if not options or not isinstance(price, (int, float)) or price <= 0:
        return None
    parsed = []
    nearest = None
    today_code = today.strftime('%y%m%d')
    for item in options:
        match = _OPTION_RE.match(item.get('option') or '')
        if not match:
            continue
        expiry = match.group(2)
        # 뉴욕 새벽·프리마켓에는 Cboe 지연 체인에 전 거래일 만기분이 남아 있다. 이미 지난 만기는 쓰지 않는다.
        if expiry < today_code:
            continue
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
        row = rows.setdefault(strike, {'call': 0.0, 'put': 0.0, 'call_oi': 0, 'put_oi': 0, 'call_vol': 0, 'put_vol': 0})
        key = 'call' if side == 'C' else 'put'
        row[key] += exposure
        row[key + '_oi'] += int(interest)
        row[key + '_vol'] += int(item.get('volume') or 0)
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
        'strikes': [{
            'strike': k,
            'call': round(rows[k]['call'], 2), 'put': round(rows[k]['put'], 2),
            'call_oi': rows[k]['call_oi'], 'put_oi': rows[k]['put_oi'],
            'call_vol': rows[k]['call_vol'], 'put_vol': rows[k]['put_vol'],
        } for k in near],
        'as_of': _as_of(chain),
        'call_wall': call_wall,
        'put_wall': put_wall,
        'net': round(sum(r['call'] - r['put'] for r in rows.values()), 1),
        'overview': _overview(parsed, price, nearest, now or _ny_now(), symbol, today),
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
            summary = summarize(chain, ny.date(), symbol, ny)
            del chain
        if summary is None:
            payload = {'available': False, 'reason': 'no_options', 'symbol': symbol}
            _cache[symbol] = (time.time() + TTL_NEGATIVE, payload)
        else:
            payload = dict(summary, available=True, symbol=symbol, updated_at=int(time.time()))
            _cache[symbol] = (time.time() + ttl, payload)
        _trim_cache()
        return payload
