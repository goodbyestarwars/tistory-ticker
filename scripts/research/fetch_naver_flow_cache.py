# -*- coding: utf-8 -*-
"""연구용(2026-11-13): 네이버 일봉(OHLCV+외국인소진율)과 종목별 일별 투자자 순매수(외국인·기관·개인, 주식 수)를 종목별 JSON 캐시로 받는다.

- 일봉: fchart.stock.naver.com siseJson (요청 1회/종목)
- 수급: m.stock.naver.com/api/stock/<code>/trend (pageSize 최대 60, bizdate(해당일 미포함) 이전 60거래일)
- 대상: data/krx_map.js 의 6자리 보통주(코드 끝 0) 중 ETF/ETN/스팩/리츠 이름 제외. 상장폐지 종목은 없음(생존 편향, 문서에 명시).
- 수급은 flow_start(기본 2021-06-01)부터, 기간 중 20일 평균 거래대금이 한 번도 30억원 이상이 아니면 수급은 생략(분석 유니버스 밖).
- 동시 8개·요청 간 0.15초. 결과는 저장소에 올리지 않는다. 운영 코드·VM과 무관.
실행: python fetch_naver_flow_cache.py <작업 폴더> <data/krx_map.js> [시작YYYYMMDD] [종료YYYYMMDD] [수급시작YYYYMMDD]
"""
import json, os, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

ETF_PAT = re.compile(r'^(KODEX|TIGER|KBSTAR|RISE|ACE|SOL|HANARO|KOSEF|ARIRANG|PLUS|TIMEFOLIO|KIWOOM|1Q|WON|BNK|ITF|TREX|FOCUS|마이다스|에셋플러스|파워|히어로즈|UNICORN|DAISHIN343|KCGI|HK|VITA|TRUSTON|SMART|마이티|KoAct|BICK)|ETN|스팩|리츠|인프라|선물|레버리지|인버스')

def universe(map_path):
    src = open(map_path, encoding='utf-8').read()
    m = json.loads(src[src.index('{'):src.rindex('}') + 1])
    out = {}
    for name, code in m.items():
        if re.fullmatch(r'\d{5}0', code) and not ETF_PAT.search(name):
            out[code] = name
    return out

def get(url):
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            return urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'ignore')
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    return None

PAT = re.compile(r'\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*(\d+),\s*([\d.]+|null)?')

def num(s):
    s = (s or '').replace(',', '').replace('+', '').strip()
    try:
        return int(s)
    except ValueError:
        return None

def fetch(args):
    code, out, start, end, flow_start = args
    path = os.path.join(out, code + '.json')
    if os.path.exists(path):
        return 'cached'
    text = get('https://fchart.stock.naver.com/siseJson.naver?symbol=%s&requestType=1&startTime=%s&endTime=%s&timeframe=day' % (code, start, end))
    if text is None:
        return 'fail'
    px = []
    for d, o, h, l, c, v, fr in PAT.findall(text):
        px.append([d, float(o), float(h), float(l), float(c), float(v), float(fr) if fr not in ('', 'null') else None])
    time.sleep(0.15)
    flow = {}
    amt = [r[4] * r[5] for r in px]
    liquid = any(sum(amt[i - 20:i]) / 20 >= 3e9 for i in range(20, len(amt) + 1, 5)) if len(amt) >= 20 else False
    if not liquid:
        json.dump({'px': px, 'flow': None}, open(path + '.tmp', 'w'))
        os.replace(path + '.tmp', path)
        return len(px)
    biz = end
    while True:
        t = get('https://m.stock.naver.com/api/stock/%s/trend?pageSize=60&bizdate=%s' % (code, biz))
        if t is None:
            return 'fail'
        try:
            rows = json.loads(t)
        except ValueError:
            break
        if not rows:
            break
        for r in rows:
            flow[r['bizdate']] = [num(r.get('foreignerPureBuyQuant')), num(r.get('organPureBuyQuant')), num(r.get('individualPureBuyQuant'))]
        last = rows[-1]['bizdate']
        time.sleep(0.15)
        if last <= flow_start or len(rows) < 60:
            break
        # 다음 페이지: bizdate는 그날을 포함하지 않으므로(그 전날부터 반환) 마지막 날짜를 그대로 넘긴다
        biz = last
    json.dump({'px': px, 'flow': flow}, open(path + '.tmp', 'w'))
    os.replace(path + '.tmp', path)
    return len(px)

if __name__ == '__main__':
    sp, mp = sys.argv[1], sys.argv[2]
    start = sys.argv[3] if len(sys.argv) > 3 else '20201001'
    end = sys.argv[4] if len(sys.argv) > 4 else time.strftime('%Y%m%d')
    flow_start = sys.argv[5] if len(sys.argv) > 5 else '20210601'
    out = os.path.join(sp, 'cache')
    os.makedirs(out, exist_ok=True)
    uni = universe(mp)
    json.dump(uni, open(os.path.join(sp, 'universe.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    codes = sorted(uni)
    print('codes', len(codes), start, end, flush=True)
    done, fails = 0, []
    with ThreadPoolExecutor(max_workers=8) as ex:
        for code, res in zip(codes, ex.map(fetch, [(c, out, start, end, flow_start) for c in codes])):
            done += 1
            if res == 'fail':
                fails.append(code)
            if done % 100 == 0:
                print(done, 'fails', len(fails), flush=True)
    print('DONE', done, 'fails', len(fails), fails[:30], flush=True)
