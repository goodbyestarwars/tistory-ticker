# -*- coding: utf-8 -*-
"""코스피/코스닥 종목 구분표 수집 (연구 전용, 일회성 - 2026-11-27).

NAVER 모바일 시가총액 목록 JSON(KOSPI/KOSDAQ)의 종목코드·종류만 읽는다. 새 상시 프로세스 없음, 호출 간격 0.4초.
실행: python fetch_market_split.py <out.json>
"""
import json
import sys
import time
import urllib.request

URL = 'https://m.stock.naver.com/api/stocks/marketValue/%s?page=%d&pageSize=100'


def codes(market):
    out = []
    for page in range(1, 40):
        req = urllib.request.Request(URL % (market, page), headers={'User-Agent': 'Mozilla/5.0'})
        j = json.loads(urllib.request.urlopen(req, timeout=20).read().decode())
        stocks = j.get('stocks') or []
        if not stocks:
            break
        out += [s['itemCode'] for s in stocks if s.get('stockEndType') == 'stock']
        if page * 100 >= int(j.get('totalCount') or 0):
            break
        time.sleep(0.4)
    return out


def main():
    res = {'KOSPI': codes('KOSPI'), 'KOSDAQ': codes('KOSDAQ')}
    json.dump(res, open(sys.argv[1], 'w'), ensure_ascii=False)
    print({k: len(v) for k, v in res.items()})


if __name__ == '__main__':
    main()
