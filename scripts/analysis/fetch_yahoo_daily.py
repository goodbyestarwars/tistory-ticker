# -*- coding: utf-8 -*-
"""오프라인 백테스트용 일봉 수집(운영 VM을 건드리지 않는다): data/sectors-v3.js의 종목을 Yahoo Finance 일봉으로 받아
signal_backtest.py가 읽는 sqlite(daily_prices)로 저장한다. 수정주가가 아닌 원 OHLCV(auto_adjust=false)를 쓴다.
사용: python scripts/analysis/fetch_yahoo_daily.py --out bt.db [--range 5y]
"""
import argparse
import json
import os
import re
import sqlite3
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SECTORS = os.path.join(HERE, '..', '..', 'data', 'sectors-v3.js')


def universe():
    text = open(SECTORS, encoding='utf-8').read()
    pairs = {}
    for m in re.finditer(r"code:\s*['\"](\d{6})['\"]\s*,\s*market:\s*['\"](KOSPI|KOSDAQ)['\"]", text):
        pairs[m.group(1)] = m.group(2)
    for m in re.finditer(r"market:\s*['\"](KOSPI|KOSDAQ)['\"]\s*,\s*code:\s*['\"](\d{6})['\"]", text):
        pairs[m.group(2)] = m.group(1)
    return pairs


def fetch(code, market, rng):
    for suffix in (('.KS', '.KQ') if market == 'KOSPI' else ('.KQ', '.KS')):
        url = 'https://query1.finance.yahoo.com/v8/finance/chart/%s%s?range=%s&interval=1d&events=div' % (code, suffix, rng)
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            data = json.load(urllib.request.urlopen(req, timeout=20))
            res = data['chart']['result'][0]
            q = res['indicators']['quote'][0]
            rows = []
            for i, ts in enumerate(res['timestamp']):
                o, h, l, c, v = (q[k][i] for k in ('open', 'high', 'low', 'close', 'volume'))
                if None in (o, h, l, c):
                    continue
                day = time.strftime('%Y-%m-%d', time.gmtime(ts + 9 * 3600))
                rows.append((code, day, o, h, l, c, v or 0))
            if len(rows) > 200:
                return rows
        except Exception:
            continue
    return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--range', default='5y')
    args = ap.parse_args()
    conn = sqlite3.connect(args.out)
    conn.execute('CREATE TABLE IF NOT EXISTS daily_prices (code TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL, PRIMARY KEY(code,date))')
    pairs = universe()
    done = 0
    for code, market in sorted(pairs.items()):
        rows = fetch(code, market, args.range)
        if rows:
            conn.executemany('INSERT OR REPLACE INTO daily_prices VALUES (?,?,?,?,?,?,?)', rows)
            conn.commit()
            done += 1
        time.sleep(0.4)
    print('stocks', done, '/', len(pairs))


if __name__ == '__main__':
    main()
