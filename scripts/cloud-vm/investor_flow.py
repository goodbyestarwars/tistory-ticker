# -*- coding: utf-8 -*-
"""공매도(ka10014)/대차거래(ka20068)/연기금(ka10059) 조회 + 지표 계산.
scripts/fetch_investor_flow.py의 계산 로직을 그대로 포팅(수치 조건 동일, AI 임의판단 없음)."""

import time
from datetime import datetime, timedelta

import kiwoom_client

THROTTLE_SEC = 0.25
LOOKBACK_DAYS = 100


def to_num(v):
    try:
        return float(str(v).replace(',', '').replace('+', ''))
    except (TypeError, ValueError):
        return 0.0


def date_range():
    end = datetime.now()
    start = end - timedelta(days=LOOKBACK_DAYS)
    return start.strftime('%Y%m%d'), end.strftime('%Y%m%d')


def short_pressure_score(short_ratio_pct, loan_change_pct, short_balance_change_pct, foreign_net_today, inst_net_today):
    ratio_score = 30 if short_ratio_pct >= 15 else 24 if short_ratio_pct >= 10 else 15 if short_ratio_pct >= 5 else 8 if short_ratio_pct >= 2 else 0
    # 2026-07-19: -3%까지도 5점을 주던 버킷 제거 - 대차잔고가 실제로 줄어드는(음수) 날인데도
    # "대차잔고 증가" 배지가 뜨는 라벨 버그의 원인이었음(프론트가 이 점수>0을 "증가"로 표시,
    # js/foreign-flow.js buildShortLoanCard). bal_score(공매도 잔고)처럼 0 미만이면 0점으로 통일.
    loan_score = 30 if loan_change_pct >= 5 else 22 if loan_change_pct >= 2 else 12 if loan_change_pct >= 0 else 0
    bal_score = 20 if short_balance_change_pct >= 5 else 14 if short_balance_change_pct >= 2 else 8 if short_balance_change_pct >= 0 else 0
    foreign_score = 10 if foreign_net_today < 0 else 0
    inst_score = 10 if inst_net_today < 0 else 0
    total = ratio_score + loan_score + bal_score + foreign_score + inst_score
    if total <= 20:
        grade = {'emoji': '\U0001F7E2', 'label': '매우 약함'}
    elif total <= 40:
        grade = {'emoji': '\U0001F7E2', 'label': '약함'}
    elif total <= 60:
        grade = {'emoji': '\U0001F7E1', 'label': '보통'}
    elif total <= 80:
        grade = {'emoji': '\U0001F7E0', 'label': '강함'}
    else:
        grade = {'emoji': '\U0001F534', 'label': '매우 강함'}
    return {
        'score': total,
        'grade': grade,
        'breakdown': {
            'short_ratio': ratio_score,
            'loan_increase': loan_score,
            'balance_increase': bal_score,
            'foreign_sell': foreign_score,
            'inst_sell': inst_score,
        }
    }


def pension_streak(daily_penfnd):
    if not daily_penfnd:
        return {'days': 0, 'direction': 'flat'}
    first = daily_penfnd[0]
    direction = 1 if first > 0 else -1 if first < 0 else 0
    if direction == 0:
        return {'days': 0, 'direction': 'flat'}
    days = 0
    for v in daily_penfnd:
        d = 1 if v > 0 else -1 if v < 0 else 0
        if d != direction:
            break
        days += 1
    return {'days': days, 'direction': 'buy' if direction > 0 else 'sell'}


def pension_interpretation(streak, foreign_net_5d):
    if streak['direction'] == 'buy' and streak['days'] >= 5:
        if foreign_net_5d > 0:
            return {'tone': 'very_positive', 'label': '매우 긍정',
                    'text': '연기금이 %d일 연속 순매수 중이고 외국인도 최근 5일 순매수를 동반하고 있습니다.' % streak['days']}
        return {'tone': 'positive', 'label': '긍정', 'text': '연기금이 %d일 연속 순매수 중입니다.' % streak['days']}
    if streak['direction'] == 'buy':
        return {'tone': 'neutral_positive', 'label': '중립~긍정',
                'text': '연기금이 순매수 중이나 연속성은 아직 짧습니다(%d일).' % streak['days']}
    if streak['direction'] == 'sell' and streak['days'] >= 5:
        return {'tone': 'caution', 'label': '비중 축소 가능성', 'text': '연기금이 %d일 연속 순매도 중입니다.' % streak['days']}
    return {'tone': 'neutral', 'label': '중립', 'text': '연기금 매매 방향성이 뚜렷하지 않습니다.'}


def fetch_stock(token, code, name):
    strt_dt, end_dt = date_range()

    short_res = kiwoom_client.call_tr(token, 'ka10014', '/api/dostk/shsa',
                                       {'stk_cd': code, 'strt_dt': strt_dt, 'end_dt': end_dt})
    time.sleep(THROTTLE_SEC)
    loan_res = kiwoom_client.call_tr(token, 'ka20068', '/api/dostk/slb', {'stk_cd': code})
    time.sleep(THROTTLE_SEC)
    invsr_res = kiwoom_client.call_tr(token, 'ka10059', '/api/dostk/stkinfo',
                                       {'stk_cd': code, 'dt': end_dt, 'amt_qty_tp': '1', 'trde_tp': '0', 'unit_tp': '1'})

    short_rows = short_res.get('shrts_trnsn') or []
    loan_rows = loan_res.get('dbrt_trde_trnsn') or []
    invsr_rows = invsr_res.get('stk_invsr_orgn') or []

    short_rows = sorted(short_rows, key=lambda r: r.get('dt', ''), reverse=True)
    loan_rows = sorted(loan_rows, key=lambda r: r.get('dt', ''), reverse=True)
    invsr_rows = sorted(invsr_rows, key=lambda r: r.get('dt', ''), reverse=True)

    if not short_rows or not loan_rows or not invsr_rows:
        return None

    today_short = short_rows[0]
    balance_qty = to_num(today_short.get('ovr_shrts_qty'))
    avg_price = to_num(today_short.get('shrts_avg_pric'))
    today_ratio_pct = to_num(today_short.get('trde_wght'))

    avg_n = min(20, len(short_rows))
    avg_volume_20d = sum(to_num(r.get('trde_qty')) for r in short_rows[:avg_n]) / avg_n if avg_n else 0
    days_to_cover = (balance_qty / avg_volume_20d) if avg_volume_20d > 0 else None

    prior_short_balance = to_num(short_rows[1].get('ovr_shrts_qty')) if len(short_rows) > 1 else None
    short_balance_change_pct = (
        (balance_qty - prior_short_balance) / prior_short_balance * 100
    ) if prior_short_balance else 0.0

    today_loan = loan_rows[0]
    loan_balance_qty = to_num(today_loan.get('rmnd'))
    prior_loan_balance = to_num(loan_rows[1].get('rmnd')) if len(loan_rows) > 1 else None
    loan_change_pct = (
        (loan_balance_qty - prior_loan_balance) / prior_loan_balance * 100
    ) if prior_loan_balance else 0.0

    today_invsr = invsr_rows[0]
    current_price = abs(to_num(today_invsr.get('cur_prc')))
    # amt_qty_tp='1'이라 frgnr_invsr/orgn은 수량이 아니라 금액(백만원 단위)로 내려옴(2026-07-15
    # Toss/키움HTS 실측 대조로 확인됨) - short_squeeze_index가 공매도거래량(주)과 같은 단위여야
    # 해서 종가로 나눠 대략적인 주식수로 환산. short_pressure_score의 foreign/inst_score는
    # 부호만 보므로 이 환산과 무관하게 이전부터 정확했음.
    foreign_net_today = (to_num(today_invsr.get('frgnr_invsr')) * 1_000_000 / current_price) if current_price else 0.0
    inst_net_today = (to_num(today_invsr.get('orgn')) * 1_000_000 / current_price) if current_price else 0.0

    pressure = short_pressure_score(today_ratio_pct, loan_change_pct, short_balance_change_pct,
                                     foreign_net_today, inst_net_today)

    today_short_volume = to_num(today_short.get('shrts_qty'))
    short_squeeze_index = (
        (foreign_net_today + inst_net_today) / today_short_volume * 100
    ) if today_short_volume > 0 else None

    penfnd_daily = [to_num(r.get('penfnd_etc')) for r in invsr_rows]

    def sum_n(vals, n):
        return sum(vals[:min(n, len(vals))])

    net_5d = sum_n(penfnd_daily, 5)
    net_20d = sum_n(penfnd_daily, 20)
    net_60d = sum_n(penfnd_daily, 60) if len(penfnd_daily) >= 60 else None
    net_cumulative = sum(penfnd_daily)

    streak = pension_streak(penfnd_daily)
    interpretation = pension_interpretation(streak, net_5d)

    return {
        'name': name,
        'as_of': today_short.get('dt'),
        'short': {
            'balance_qty': balance_qty,
            'avg_price': avg_price,
            'today_ratio_pct': today_ratio_pct,
            'avg_volume_20d': avg_volume_20d,
            'days_to_cover': days_to_cover,
            'balance_change_pct': short_balance_change_pct,
            'short_squeeze_index': short_squeeze_index,
            'pressure': pressure,
        },
        'loan': {
            'balance_qty': loan_balance_qty,
            'balance_change_pct': loan_change_pct,
        },
        'pension': {
            'streak': streak,
            'net_5d': net_5d,
            'net_20d': net_20d,
            'net_60d': net_60d,
            'net_cumulative': net_cumulative,
            'cumulative_window_days': len(penfnd_daily),
            'current_price': current_price,
            'interpretation': interpretation,
        },
    }
