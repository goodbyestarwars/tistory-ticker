# -*- coding: utf-8 -*-
"""코스닥 모니터링 일지용 정시 스냅샷 (읽기 전용, 연구 전용, 주문 없음 - 2026-11-27).

지정한 시각마다 NAVER 시가총액 JSON(코스닥 전종목)을 한 번 읽어 종목별 (현재가, 전일대비 등락률, 누적 거래량)을 저장한다.
실행: python monitor_snapshots.py <out 폴더> [HHMM ...]   (폴더 안에 snap_HHMM.json 저장, 이미 있으면 건너뜀)
"""
import datetime as dt
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import live_angle_watch as W  # noqa: E402

DEFAULT_TIMES = ('0905', '0910', '0920', '0930', '1000', '1100', '1300', '1400', '1500', '1520', '1535')


def main():
    outdir = sys.argv[1]
    times = sys.argv[2:] or list(DEFAULT_TIMES)
    os.makedirs(outdir, exist_ok=True)
    for hhmm in times:
        path = os.path.join(outdir, 'snap_%s.json' % hhmm)
        if os.path.exists(path):
            continue
        now = dt.datetime.now(W.KST)
        if (now.hour * 60 + now.minute) - (int(hhmm[:2]) * 60 + int(hhmm[2:])) > 3:       # 이미 지난 시각은 건너뜀(늦게 시작한 날)
            continue
        while dt.datetime.now(W.KST).strftime('%H%M') < hhmm:
            time.sleep(5)
        if dt.datetime.now(W.KST).strftime('%H%M') > '1600':
            break
        try:
            rows = W.snapshot()
        except Exception as exc:  # noqa: BLE001
            print(hhmm, 'fail', str(exc)[:80], flush=True)
            continue
        out = {'t': dt.datetime.now(W.KST).strftime('%H:%M:%S'),
               'rows': {c: [r['px'], round(r['ret'], 4) if r['ret'] is not None else None, r['vol'], r['name'], r['prev']] for c, r in rows.items()}}
        json.dump(out, open(path + '.tmp', 'w'), ensure_ascii=False)
        os.replace(path + '.tmp', path)
        print(hhmm, 'saved', len(rows), flush=True)


if __name__ == '__main__':
    main()
