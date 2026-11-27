# -*- coding: utf-8 -*-
"""코스닥 장중 관찰: 수급 들어오기 전 + 강력한 각도 규칙 (읽기 전용, 연구 전용, 주문 없음 - 2026-11-27).

NAVER 모바일 시가총액 JSON(코스닥 19쪽, 쪽당 0.4초)을 30초마다 읽어 스냅샷을 쌓고, 사전 고정한 규칙
(등락률 >= 2%, 누적 거래량/20일 평균 일거래량 < 0.2, 최근 5분 상승률 >= 2%)을 만족하는 종목을 기록한다.
검증된 평가 시각은 09:10이며 그 외 시각은 탐색용으로 따로 표시한다. 15:20에 종료한다.

실행: python live_angle_watch.py <일봉 cache> <market_split.json> <out.jsonl>
"""
import datetime as dt
import json
import os
import sys
import time
import urllib.request

URL = 'https://m.stock.naver.com/api/stocks/marketValue/KOSDAQ?page=%d&pageSize=100'
KST = dt.timezone(dt.timedelta(hours=9))


def avg20(cache, codes):
    out = {}
    for c in codes:
        try:
            px = json.load(open(os.path.join(cache, c + '.json'), encoding='utf-8'))['px']
        except (OSError, ValueError, KeyError):
            continue
        v = [r[5] for r in px[-20:] if r[5]]
        if len(v) >= 15:
            out[c] = sum(v) / len(v)
    return out


def snapshot():
    rows = {}
    for page in range(1, 25):
        req = urllib.request.Request(URL % page, headers={'User-Agent': 'Mozilla/5.0'})
        j = json.loads(urllib.request.urlopen(req, timeout=20).read().decode())
        stocks = j.get('stocks') or []
        for s in stocks:
            if s.get('stockEndType') != 'stock':
                continue
            try:
                px = float(s['closePriceRaw'])
                diff = abs(float(s['compareToPreviousClosePriceRaw']))      # NAVER 는 하락도 음수로 줌(2026-11-27 부호 오류 수정)
                name = (s.get('compareToPreviousPrice') or {}).get('name', '')
                prev = px - diff if name in ('RISING', 'UPPER_LIMIT') else (px + diff if name in ('FALLING', 'LOWER_LIMIT') else px)
                rows[s['itemCode']] = {'name': s['stockName'], 'px': px, 'prev': prev, 'ret': px / prev - 1 if prev else None,
                                       'vol': float(s['accumulatedTradingVolumeRaw']), 'open': s.get('marketStatus') == 'OPEN'}
            except (KeyError, TypeError, ValueError):
                continue
        if page * 100 >= int(j.get('totalCount') or 0):
            break
        time.sleep(0.4)
    return rows


def main():
    cache, split, outp = sys.argv[1:4]
    codes = set(json.load(open(split))['KOSDAQ'])
    base = avg20(cache, codes)
    hist = []                                   # (시각, rows)
    flagged = {}
    out = open(outp, 'a', encoding='utf-8')
    while True:
        now = dt.datetime.now(KST)
        if now.strftime('%H%M') >= '1520':
            break
        try:
            rows = snapshot()
        except Exception as exc:  # noqa: BLE001 - 일시 실패는 다음 주기에 재시도
            print(now.strftime('%H:%M:%S'), 'snapshot fail', str(exc)[:80], flush=True)
            time.sleep(30)
            continue
        hist.append((now, rows))
        hist = [h for h in hist if (now - h[0]).total_seconds() <= 900]
        past = [h for h in hist if 270 <= (now - h[0]).total_seconds() <= 360]     # 약 5분 전 스냅샷
        ref = past[-1][1] if past else None
        primary = now.strftime('%H%M') in ('0910', '0911')
        for code, r in rows.items():
            if code not in base or not r['open'] or r['ret'] is None:
                continue
            cv = r['vol'] / base[code]
            a5 = (r['px'] / ref[code]['px'] - 1) if ref and code in ref and ref[code]['px'] else None
            hit = a5 is not None and a5 >= 0.02 and cv < 0.2 and 0.02 <= r['ret'] < 0.27
            if code in flagged:
                flagged[code]['path'].append((now.strftime('%H:%M:%S'), r['px']))
                out.write(json.dumps({'t': now.strftime('%H:%M:%S'), 'code': code, 'px': r['px'], 'cv': round(cv, 3), 'ev': 'track'}, ensure_ascii=False) + '\n')
            elif hit:
                flagged[code] = {'path': [(now.strftime('%H:%M:%S'), r['px'])]}
                rec = {'t': now.strftime('%H:%M:%S'), 'code': code, 'name': r['name'], 'px': r['px'], 'ret': round(r['ret'], 4),
                       'a5': round(a5, 4), 'cv': round(cv, 3), 'primary': primary, 'ev': 'flag'}
                out.write(json.dumps(rec, ensure_ascii=False) + '\n')
                print('FLAG', json.dumps(rec, ensure_ascii=False), flush=True)
        out.flush()
        print(now.strftime('%H:%M:%S'), 'cycle ok stocks', len(rows), 'flagged', len(flagged), flush=True)
        time.sleep(max(1, 30 - (dt.datetime.now(KST) - now).total_seconds()))


if __name__ == '__main__':
    main()
