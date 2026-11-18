# -*- coding: utf-8 -*-
"""스프링 지수 연구용 캐시 변환기 (읽기 전용, 연구 전용 - 2026-11-19).

사이트 백엔드 ohlc_snapshot.db(daily_prices·investor_flow_daily)를 SQLite 읽기 전용(mode=ro)으로 열어
spring_index_study.py가 읽는 <out>/cache/<code>.json 형식으로 종목별로 쓴다.
  {"px": [[YYYYMMDD, open, high, low, close, volume], ...], "flow": {YYYYMMDD: [foreign_net, inst_net]}}
종목 단위로 읽고 쓰므로 메모리를 거의 쓰지 않는다(1GB급 VM 원칙). DB에는 쓰지 않는다.

사용:
  python3 spring_export_cache.py <ohlc_snapshot.db> --stats          # 범위·종목 수·봉 수만 출력
  python3 spring_export_cache.py <ohlc_snapshot.db> <out 폴더> [최소봉수=400]
"""
import json
import os
import sqlite3
import sys


def connect(path):
    return sqlite3.connect('file:%s?mode=ro' % os.path.abspath(path), uri=True)


def norm(d):
    return str(d).replace('-', '')[:8]


def stats(conn):
    one = lambda q: conn.execute(q).fetchone()
    print('daily_prices 종목·행·기간:', one('SELECT COUNT(DISTINCT code), COUNT(*), MIN(date), MAX(date) FROM daily_prices'))
    rows = sorted(r[0] for r in conn.execute('SELECT COUNT(*) FROM daily_prices GROUP BY code'))
    if rows:
        print('종목당 봉 수 최소/중앙/최대:', rows[0], rows[len(rows) // 2], rows[-1], '· 400봉 이상 종목:', sum(1 for x in rows if x >= 400))
    try:
        print('investor_flow_daily 종목·행·기간:', one('SELECT COUNT(DISTINCT code), COUNT(*), MIN(date), MAX(date) FROM investor_flow_daily'))
    except sqlite3.Error as e:
        print('investor_flow_daily 없음:', e)


def export(conn, out, min_bars):
    os.makedirs(os.path.join(out, 'cache'), exist_ok=True)
    codes = [r[0] for r in conn.execute('SELECT DISTINCT code FROM daily_prices ORDER BY code')]
    try:
        conn.execute('SELECT 1 FROM investor_flow_daily LIMIT 1')
        has_flow = True
    except sqlite3.Error:
        has_flow = False
    written = 0
    for code in codes:
        px = [[norm(d), o, h, l, c, v] for d, o, h, l, c, v in conn.execute(
            'SELECT date, open, high, low, close, volume FROM daily_prices WHERE code=? ORDER BY date', (code,))
              if None not in (o, h, l, c, v)]
        if len(px) < min_bars:
            continue
        flow = {}
        if has_flow:
            for d, f, i in conn.execute('SELECT date, foreign_net, inst_net FROM investor_flow_daily WHERE code=?', (code,)):
                flow[norm(d)] = [f, i]
        with open(os.path.join(out, 'cache', code + '.json'), 'w', encoding='utf-8') as fh:
            json.dump({'px': px, 'flow': flow}, fh, separators=(',', ':'))
        written += 1
    print('종목 %d개 중 %d개 저장 (최소 %d봉) -> %s' % (len(codes), written, min_bars, os.path.join(out, 'cache')))


if __name__ == '__main__':
    db = sys.argv[1]
    conn = connect(db)
    if len(sys.argv) > 2 and sys.argv[2] == '--stats':
        stats(conn)
    else:
        export(conn, sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 400)
