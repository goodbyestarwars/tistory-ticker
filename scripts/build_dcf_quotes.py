"""Offline snapshot of existing site's Naver supplier. Never call the VM.

Only explicit provider trade timestamps qualify, not HTTP retrieval timestamps.
Missing KRX trade timestamps are not fabricated from the server clock.
"""
import json
import time
import urllib.request
from datetime import datetime, timedelta
from build_dcf_data import OUT, KST, read_js, write_js


def parse_quotes(body, wanted, now):
    result = {}
    for area in body.get('result', {}).get('areas', []):
        if area.get('name') != 'SERVICE_ITEM':
            continue
        for item in area.get('datas', []):
            code = item.get('cd')
            nxt = item.get('nxtOverMarketPriceInfo') or {}
            if code not in wanted or not nxt.get('localTradedAt'):
                continue
            try:
                stamp = datetime.fromisoformat(nxt['localTradedAt'])
                price = float(str(nxt.get('overPrice', '')).replace(',', ''))
                if stamp.tzinfo is None or not 0 <= (now - stamp).total_seconds() <= 10 * 86400 or not 0 < price < 100000000:
                    continue
            except (ValueError, TypeError):
                continue
            result[code] = {'value': price, 'status': 'auto', 'source': '네이버 금융 기존 시세 공급 경로',
                            'market': 'NXT', 'asOf': stamp.isoformat(), 'observedAt': now.isoformat(),
                            'reason': '정적 최근 거래가격. KRX 종가·실시간 가격과 구별', 'sources': []}
    return result


def main():
    now = datetime.now(KST)
    path = OUT / 'quotes.js'
    old = read_js(path, 'DCF_QUOTES') if path.exists() else {}
    if old.get('generatedAt') and now - datetime.fromisoformat(old['generatedAt']) < timedelta(hours=6):
        return
    index = read_js(OUT / 'index.js', 'DCF_INDEX')
    codes = [s['code'] for s in index['stocks'] if s['sourceCode'] in index['available']]
    quotes = dict(old.get('quotes', {}))
    for offset in range(0, len(codes), 40):
        batch = codes[offset:offset + 40]
        try:
            req = urllib.request.Request('https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:' + ','.join(batch),
                                         headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=5) as response:
                body = json.loads(response.read().decode('cp949'))
            quotes.update(parse_quotes(body, batch, now))
        except Exception:
            pass  # Preserve timestamped prices; the browser rejects stale ones.
        time.sleep(.35)
    write_js(path, 'DCF_QUOTES', {'generatedAt': now.isoformat(), 'quotes': quotes})
    print('Timestamped static price snapshots:', len(quotes))


if __name__ == '__main__':
    main()
