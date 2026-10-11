# -*- coding: utf-8 -*-
"""투자자별 순매수 분리형·비교형 그래프(js/investor-flow.js)의 집계 기대값을 JS와 독립적으로 계산한다(pandas).
입력: kospi_history.json·kosdaq_history.json (운영 API GET /investor-trend/history?days=300 응답 스냅샷, 2026-10-11 수집, 억원·거래일만).
출력: expected.json  — 시장·기간(1주 5/1개월 20/3개월 60/1년 250 거래일)·집계(일별·주간·월간)별 구간 합계, 5거래일 합계, 기간 합계.
주(週)는 월요일 시작, 월은 달력 월이며 합계는 실제 거래일만 더한 값(평균이 아님)이다. 실행: python build_expected.py
"""
import json
import os
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
PERIODS = {'w': 5, 'm': 20, 'q': 60, 'y': 250}
INV = ('foreign', 'institution', 'individual')


def load(market):
    d = json.load(open(os.path.join(HERE, market + '_history.json'), encoding='utf-8'))['data']
    df = pd.DataFrame(d['rows'])
    df['date'] = pd.to_datetime(df['date'])
    return df.sort_values('date').reset_index(drop=True)


def buckets(win, prev_date, mode):
    if mode == 'day':
        key = win['date'].dt.strftime('%Y-%m-%d')
    elif mode == 'week':
        key = win['date'].dt.to_period('W-SUN').astype(str)      # 월요일 시작 ~ 일요일 끝
    else:
        key = win['date'].dt.to_period('M').astype(str)
    out = []
    for k, g in win.groupby(key, sort=True):
        row = {'key': str(k), 'start': g['date'].iloc[0].strftime('%Y-%m-%d'), 'end': g['date'].iloc[-1].strftime('%Y-%m-%d'), 'days': int(len(g))}
        for inv in INV:
            row[inv] = round(float(g[inv].sum()), 1)
        out.append(row)
    if out and prev_date is not None and mode != 'day':
        first = win['date'].iloc[0]
        same = (prev_date.to_period('W-SUN') == first.to_period('W-SUN')) if mode == 'week' else (prev_date.to_period('M') == first.to_period('M'))
        out[0]['partial'] = bool(same)
    return out


expected = {}
for market in ('kospi', 'kosdaq'):
    df = load(market)
    expected[market] = {'rows': int(len(df)), 'periods': {}}
    for pk, n in PERIODS.items():
        win = df.tail(n).reset_index(drop=True)
        prev = df['date'].iloc[len(df) - n - 1] if len(df) > n else None
        e = {'days': int(len(win)), 'from': win['date'].iloc[0].strftime('%Y-%m-%d'), 'to': win['date'].iloc[-1].strftime('%Y-%m-%d'), 'agg': {}, 'summary': {}}
        for mode in ('day', 'week', 'month'):
            e['agg'][mode] = buckets(win, prev, mode)
        for inv in INV:
            last5 = win.tail(5)
            e['summary'][inv] = {'last': round(float(win[inv].iloc[-1]), 1), 'last5': round(float(last5[inv].sum()), 1), 'last5days': int(len(last5)), 'period': round(float(win[inv].sum()), 1)}
        expected[market]['periods'][pk] = e
json.dump(expected, open(os.path.join(HERE, 'expected.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(",", ":"))
print('expected.json written', {m: {p: {a: len(v) for a, v in e['agg'].items()} for p, e in expected[m]['periods'].items()} for m in expected})
