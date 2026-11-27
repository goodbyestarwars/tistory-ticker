# -*- coding: utf-8 -*-
"""코스닥 장중 호가창 모니터링 (읽기 전용, 연구 전용, 주문 없음 - 2026-11-27).

주기(기본 45초)마다 NAVER 스냅샷으로 상승률 상위·규칙 신호 종목을 뽑고, 그 종목들의 10호가(KIS FHKST01010200)를 읽어
총매수/총매도 잔량, 5호가 잔량, 1호가 스프레드를 JSONL로 쌓는다. 15:20에 종료한다.
실행(운영 KIS 키 환경 필요): python live_orderbook_watch.py <live_0.jsonl 경로> <out.jsonl> [TOP_N=30] [CAP=120]
"""
import datetime as dt
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import live_angle_watch as W  # noqa: E402
import daytrade_support_breakout_minute_study as D  # noqa: E402

PATH = '/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn'
TR = 'FHKST01010200'


def fnum(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def make_book_call():
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'cloud-vm'))
    import kis_client
    appkey, appsecret = os.environ['KIS_APPKEY'], os.environ['KIS_APPSECRET']
    token = None
    for attempt in range(3):
        try:
            token = kis_client.get_token(appkey, appsecret)
            break
        except RuntimeError as exc:
            if 'EGW00133' not in str(exc) or attempt == 2:
                raise
            time.sleep(65)

    def call(code):
        time.sleep(D.SPACING_SEC)
        return kis_client._get_domestic_quote(token, appkey, appsecret, PATH, TR,
                                              {'FID_COND_MRKT_DIV_CODE': 'J', 'FID_INPUT_ISCD': code})
    return call


def book_row(data):
    o1 = data.get('output1') or {}
    asks = [fnum(o1.get('askp_rsqn%d' % i)) or 0 for i in range(1, 11)]
    bids = [fnum(o1.get('bidp_rsqn%d' % i)) or 0 for i in range(1, 11)]
    a1, b1 = fnum(o1.get('askp1')), fnum(o1.get('bidp1'))
    ta, tb = fnum(o1.get('total_askp_rsqn')), fnum(o1.get('total_bidp_rsqn'))
    if not a1 or not b1 or ta is None or tb is None:
        return None
    mid = (a1 + b1) / 2
    return {'ask1': a1, 'bid1': b1, 'spreadPct': round((a1 - b1) / mid, 5), 'askTot': ta, 'bidTot': tb,
            'ratio': round(tb / ta, 3) if ta else None, 'ask5': sum(asks[:5]), 'bid5': sum(bids[:5]),
            'ratio5': round(sum(bids[:5]) / sum(asks[:5]), 3) if sum(asks[:5]) else None, 'ask1q': asks[0], 'bid1q': bids[0]}


def flagged_codes(path):
    prim, other = [], []
    try:
        for line in open(path, encoding='utf-8'):
            r = json.loads(line)
            if r.get('ev') == 'flag':
                (prim if r.get('primary') else other).append(r['code'])
    except OSError:
        pass
    return prim, other[::-1]                      # 탐색 신호는 최근 것부터


def main():
    live, outp = sys.argv[1], sys.argv[2]
    top_n = int(sys.argv[3]) if len(sys.argv) > 3 else 30
    cap = int(sys.argv[4]) if len(sys.argv) > 4 else 120
    call = make_book_call()
    out = open(outp, 'a', encoding='utf-8')
    while dt.datetime.now(W.KST).strftime('%H%M') < '1520':
        t0 = dt.datetime.now(W.KST)
        try:
            rows = W.snapshot()
        except Exception as exc:  # noqa: BLE001
            print('snapshot fail', str(exc)[:80], flush=True)
            time.sleep(20)
            continue
        top = [c for _, c in sorted(((r['ret'], c) for c, r in rows.items() if r['ret'] is not None and r['open']), reverse=True)[:top_n]]
        prim, other = flagged_codes(live)
        targets, seen = [], set()
        for c in prim + top + other:
            if c in rows and c not in seen:
                seen.add(c)
                targets.append(c)
        ok = 0
        for c in targets[:cap]:
            try:
                b = book_row(call(c))
            except Exception as exc:  # noqa: BLE001
                print(c, 'book fail', str(exc)[:60], flush=True)
                continue
            if not b:
                continue
            ok += 1
            r = rows[c]
            rec = {'t': dt.datetime.now(W.KST).strftime('%H:%M:%S'), 'code': c, 'name': r['name'], 'px': r['px'],
                   'ret': round(r['ret'], 4), 'vol': r['vol'], 'top': c in top, 'flag': c in prim or c in other, **b}
            out.write(json.dumps(rec, ensure_ascii=False) + '\n')
        out.flush()
        print(t0.strftime('%H:%M:%S'), 'targets', len(targets), 'books', ok, flush=True)
        time.sleep(max(1, 45 - (dt.datetime.now(W.KST) - t0).total_seconds()))


if __name__ == '__main__':
    main()
