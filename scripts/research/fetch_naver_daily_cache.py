# -*- coding: utf-8 -*-
"""연구용: 네이버 차트 일봉(fchart.stock.naver.com siseJson, 2020-01 이후)을 종목별 JSON 캐시로 내려받는다(2026-10-17).

운영 VM의 daily_prices는 2024-06부터라 448일선이 필요한 백테스트 표본이 모자라 5년 이력을 따로 받았다. 같은 날짜의 가격·거래량을 VM(키움) 값과
삼성전자·펌텍코리아·HMM·SK하이닉스·에코프로 5종목에서 대조했고 값이 일치했다(에코프로 한 날만 2원 차이). 사용 규칙: 연구용 1회성 내려받기,
동시 4개·요청 간 0.12초, 결과는 저장소에 올리지 않는다(캐시 디렉터리는 작업 폴더). 운영 코드·VM과 무관하다.
실행: python fetch_naver_daily_cache.py <작업 폴더(excluded.json이 있는 곳)> <data/krx_map.js 경로>  -> <작업 폴더>/naver/<종목코드>.json
"""

import json, os, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
sp = sys.argv[1]
excluded = set(json.load(open(os.path.join(sp, 'excluded.json'), encoding='utf-8')))
src = open(sys.argv[2], encoding='utf-8').read()
m = json.loads(src[src.index('{'):src.rindex('}') + 1])
codes = sorted({c for c in m.values() if c not in excluded and re.fullmatch(r'\d{6}', c)})
out = os.path.join(sp, 'naver')
os.makedirs(out, exist_ok=True)
print('codes', len(codes), flush=True)
pat = re.compile(r'\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*(\d+)')

def fetch(code):
    path = os.path.join(out, code + '.json')
    if os.path.exists(path):
        return 'cached'
    url = 'https://fchart.stock.naver.com/siseJson.naver?symbol=%s&requestType=1&startTime=20200101&endTime=20261016&timeframe=day' % code
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            text = urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'ignore')
            rows = [[d[:4] + '-' + d[4:6] + '-' + d[6:], float(o), float(h), float(l), float(c), float(v)] for d, o, h, l, c, v in pat.findall(text)]
            json.dump(rows, open(path, 'w'))
            time.sleep(0.12)
            return len(rows)
        except Exception as e:
            time.sleep(1.5 * (attempt + 1))
    return 'fail'

done = 0
fails = []
with ThreadPoolExecutor(max_workers=4) as ex:
    for code, res in zip(codes, ex.map(fetch, codes)):
        done += 1
        if res == 'fail':
            fails.append(code)
        if done % 200 == 0:
            print(done, 'fails', len(fails), flush=True)
print('DONE', done, 'fails', fails[:20], len(fails), flush=True)
