# -*- coding: utf-8 -*-
"""시뮬레이터 재현 검증(연구용, 읽기 전용): 실계좌 장부(live_orders.db)·체결 기록(order_fills.json)의 실제 매수·매도를
2026-10-16 이전 엔진 규칙(A_old)으로 분봉에서 다시 돌려 청산 시각·가격이 얼마나 맞는지 본다. 계좌 정보는 읽지 않는다(장부의 종목·시각·수량·가격만).
실제 주문·잔고·계좌 API 는 부르지 않으며 분봉 TR(ka10080)만 쓴다. 사용: python exit_strategy_calibrate.py <autotrader 폴더> <분봉 폴더> <out.json>
"""
import json
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import exit_strategy_study as xs  # noqa: E402
import exit_strategy_collect as xc  # noqa: E402


def real_trades(folder):
    db = sqlite3.connect('file:%s?mode=ro' % os.path.join(folder, 'live_orders.db'), uri=True)
    rows = db.execute('SELECT id, ts, code, side, qty, price FROM intents ORDER BY id').fetchall()
    db.close()
    try:
        fills = json.load(open(os.path.join(folder, 'order_fills.json'), encoding='utf-8')).get('fills') or []
    except (OSError, ValueError):
        fills = []
    fill = {(f['date'], f['code'], f['side']): f['price'] for f in fills}
    trades = []
    for rid, ts, code, side, qty, price in rows:
        if side != 'BUY':
            continue
        sell = next((r for r in rows if r[0] > rid and r[2] == code and r[3] == 'SELL'), None)
        buy_day = ts[:10]
        trades.append({'code': code, 'buy_ts': ts, 'buy_price': fill.get((buy_day, code, 'BUY')) or price, 'buy_fill_known': (buy_day, code, 'BUY') in fill,
                       'sell_ts': sell[1] if sell else None, 'sell_fill': fill.get((sell[1][:10], code, 'SELL')) if sell else None,
                       'sell_decision_price': sell[5] if sell else None})
    return trades


def days_between(a, b, calendar):
    return [d for d in calendar if a <= d <= b]


def ensure_bars(client, out_dir, code, day):
    path = os.path.join(out_dir, '%s_%s.json' % (code, day))
    if os.path.exists(path):
        return
    res = client.call('ka10080', '/api/dostk/chart', {'stk_cd': code, 'tic_scope': '1', 'upd_stkpc_tp': '1', 'base_dt': day.replace('-', '')})
    json.dump({'code': code, 'day': day, 'bars': xc.parse_bars(res.get('stk_min_pole_chart_qry'), day), 'rc': res.get('return_code')}, open(path, 'w', encoding='utf-8'))


def replay(trade, out_dir, calendar):
    last_day = trade['sell_ts'][:10] if trade['sell_ts'] else calendar[-1]
    days = days_between(trade['buy_ts'][:10], last_day, calendar)
    path = []
    for d in days:
        path.extend((d,) + tuple(b) for b in xs.load_day(out_dir, trade['code'], d))
    hhmm = trade['buy_ts'][11:13] + trade['buy_ts'][14:16]
    idx = next((i for i, p in enumerate(path) if p[0] == trade['buy_ts'][:10] and p[1] >= hhmm), None)
    if idx is None:
        return None
    rule = xs.RuleAOld(trade['buy_price'], {})
    rule.avg = trade['buy_price']
    exit_i, reason = None, None
    for i in range(idx + 1, len(path)):
        day, t, o, h, l, c, v = path[i]
        if not ('0901' <= t <= xs.EVAL_LAST):
            continue
        reason = rule.step(c, path[i], {})
        if reason and i + 1 < len(path):
            exit_i = i + 1
            break
    if exit_i is None:
        return {'sim_reason': None}
    return {'sim_reason': reason, 'sim_exit_day': path[exit_i][0], 'sim_exit_hhmm': path[exit_i][1], 'sim_exit_price': path[exit_i][2]}


def main(folder, out_dir, out_path):
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'quant-autotrade', 'local_bot'))
    from kiwoom import KiwoomClient
    trades = real_trades(folder)
    cache = os.path.join(os.path.dirname(os.path.abspath(out_dir)), 'naver')
    calendar = sorted({r[0] for r in json.load(open(os.path.join(cache, '005930.json'), encoding='utf-8'))})
    keys = xc.read_env_keys(os.path.join(folder, '.env'))
    client = KiwoomClient(keys.get('KIWOOM_APPKEY'), keys.get('KIWOOM_SECRETKEY'))
    for t in trades:
        end = t['sell_ts'][:10] if t['sell_ts'] else calendar[-1]
        for d in days_between(t['buy_ts'][:10], end, calendar):
            ensure_bars(client, out_dir, t['code'], d)
    out = []
    for t in trades:
        r = replay(t, out_dir, calendar)
        out.append(dict(t, **(r or {'sim_reason': 'NO_BARS'})))
    json.dump(out, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for o in out:
        print(o['code'], o['buy_ts'][5:16], o['buy_price'], '| actual sell', (o['sell_ts'] or '-')[5:16], o.get('sell_fill'), '| sim', o.get('sim_reason'), o.get('sim_exit_day'), o.get('sim_exit_hhmm'), o.get('sim_exit_price'))


if __name__ == '__main__':
    main(*sys.argv[1:4])
