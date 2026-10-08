"""검색·호가의 네이버 시세를 GAS 경유 없이 조회한다. 타이머 없이 요청 시에만 실행."""
from concurrent.futures import ThreadPoolExecutor
from collections import OrderedDict
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import math
import re
import threading
import time
import urllib.parse

import market_temp_data as data

_cache = OrderedDict()
_lock = threading.Lock()
MAX_CODES = 30
MAX_CACHE = 300
KST = timezone(timedelta(hours=9))


def normalize_codes(raw, max_codes=MAX_CODES):
    codes = list(dict.fromkeys(str(raw).upper().split(',')))
    if not codes or len(codes) > max_codes or any(not re.fullmatch(r'[0-9A-Z]{6}', c) for c in codes):
        raise ValueError('종목코드는 6자리, 최대 %d개입니다.' % max_codes)
    return codes


def _number(value):
    try:
        result = float(str(value).replace(',', ''))
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None


def parse(body, now):
    rows = data._parse_naver_batch(body)
    areas = ((body or {}).get('result') or {}).get('areas') or []
    raw = next((a for a in areas if a.get('name') == 'SERVICE_ITEM'), {})
    by_code = {d.get('cd'): d for d in raw.get('datas', [])}
    regular = now.weekday() < 5 and 900 <= now.hour * 100 + now.minute <= 1540
    for row in rows:
        item = by_code.get(row['code'], {})
        row['market'] = {'1': 'KOSPI', '2': 'KOSDAQ'}.get(str(item.get('mt')), '')
        row['time'] = now.strftime('%H:%M:%S')
        # 기존 GAS와 같은 장외 NXT 가격 우선 규칙을 유지한다.
        over = item.get('nxtOverMarketPriceInfo') or {}
        price = _number(over.get('overPrice'))
        if not regular and price and price > 0:
            sign = -1 if str((over.get('compareToPreviousPrice') or {}).get('code')) in ('4', '5') else 1
            row.update(price=price,
                       change=abs(_number(over.get('compareToPreviousClosePrice')) or 0) * sign,
                       changeRate=abs(_number(over.get('fluctuationsRatio')) or 0) * sign)
    return [r for r in rows if r['price'] > 0 and math.isfinite(r['price'])]


@contextmanager
def _download_slot():
    # 느린 외부 응답에 요청 스레드들이 길게 줄 서지 않게 한다.
    if not _lock.acquire(timeout=1):
        raise RuntimeError('현재가 조회가 밀려 있습니다. 다음 갱신에 재시도합니다.')
    try:
        yield
    finally:
        _lock.release()


def fetch_quotes(codes):
    # 전역 잠금으로 동시 요청을 합치고 외부 다운로드도 한 건으로 제한한다.
    # 기다리는 요청은 첫 다운로드가 채운 종목별 캐시를 다시 읽는다.
    with _download_slot():
        now = time.monotonic()
        missing = [c for c in codes if c not in _cache or now - _cache[c]['t'] >= 5]
        for code in codes:
            if code in _cache and code not in missing:
                _cache.move_to_end(code)
        if missing:
            def load_batch(batch):
                url = data.NAVER_POLLING_URL + urllib.parse.quote(','.join(batch), safe=',')
                return parse(data._get_json(url, timeout=6, encoding='euc-kr'), datetime.now(KST))
            batches = [missing[i:i + 60] for i in range(0, len(missing), 60)]
            if len(batches) == 1:
                rows = load_batch(batches[0])
            else:
                with ThreadPoolExecutor(max_workers=4) as pool:
                    rows = [row for batch in pool.map(load_batch, batches) for row in batch]
            if not rows:
                raise RuntimeError('현재가 공급자 응답이 비어 있습니다.')
            requested = set(missing)
            for row in rows:
                if row['code'] not in requested:
                    continue
                _cache[row['code']] = {'t': time.monotonic(), 'data': row}
                _cache.move_to_end(row['code'])
            while len(_cache) > MAX_CACHE:
                _cache.popitem(last=False)
        return [_cache[c]['data'].copy() for c in codes if c in _cache and time.monotonic() - _cache[c]['t'] < 5]
