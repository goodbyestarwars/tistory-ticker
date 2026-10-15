# -*- coding: utf-8 -*-
"""투자자별 누적 순매수 선 그래프·툴팁(js/investor-flow.js)의 기대값을 JS와 독립적으로 계산한다(pandas).
입력: kospi_history.json·kosdaq_history.json (운영 API GET /investor-trend/history?days=300 응답 스냅샷, 2026-10-11 수집, 억원·거래일만).
출력: expected.json - 시장·기간(1주 5/1개월 20/3개월 60/1년 250 거래일)별
  dates     : 기준점(기간 직전 거래일 또는 '기간 시작') + 기간 거래일
  daily     : 투자자별 당일 순매수(기준점은 null)
  cum       : 투자자별 기간 누적 순매수(기준점 0에서 시작, cumsum)
  index     : 지수 종가(기준점은 직전 거래일 종가)
  last / period / streak : 하단 요약표(최근 1일·기간 누적·연속 일수와 방향)
2026-10-16: 일별 막대 그래프를 없애면서 예전 집계(일별·주간·월간 합계) 기대값은 지웠다. 실행: python build_expected.py
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


def streak(series):
    last = float(series.iloc[-1])
    if last == 0:
        return {'sign': 0, 'days': 0}
    sign = 1 if last > 0 else -1
    days = 0
    for v in reversed(series.tolist()):
        if (v > 0) == (sign > 0) and v != 0:
            days += 1
        else:
            break
    return {'sign': sign, 'days': days}


expected = {}
for market in ('kospi', 'kosdaq'):
    df = load(market)
    expected[market] = {'rows': int(len(df)), 'periods': {}}
    for pk, n in PERIODS.items():
        win = df.tail(n).reset_index(drop=True)
        has_before = len(df) > n
        before = df.iloc[len(df) - n - 1] if has_before else None
        dates = ([before['date'].strftime('%Y-%m-%d')] if has_before else ['기간 시작']) + [d.strftime('%Y-%m-%d') for d in win['date']]
        idx = ([float(before['indexClose'])] if has_before and pd.notna(before['indexClose']) else [None]) + [None if pd.isna(v) else float(v) for v in win['indexClose']]
        e = {'days': int(len(win)), 'hasBefore': bool(has_before), 'dates': dates, 'index': idx, 'daily': {}, 'cum': {}, 'last': {}, 'period': {}, 'streak': {}}
        for inv in INV:
            vals = [float(v) for v in win[inv]]
            e['daily'][inv] = [None] + vals
            e['cum'][inv] = [0.0] + [round(float(v), 1) for v in win[inv].cumsum()]
            e['last'][inv] = round(vals[-1], 1)
            e['period'][inv] = round(float(win[inv].sum()), 1)
            e['streak'][inv] = streak(df[inv])
        expected[market]['periods'][pk] = e
json.dump(expected, open(os.path.join(HERE, 'expected.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(",", ":"))
print('expected.json written', {m: {p: e['days'] for p, e in expected[m]['periods'].items()} for m in expected})
