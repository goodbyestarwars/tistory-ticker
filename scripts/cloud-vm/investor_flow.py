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


def _credit_row_change_pct(rows, idx, field):
    """rows[idx] 대비 rows[idx+1](하루 전) 증감률. 다음 행이 없으면(신규상장 등) 0."""
    if idx + 1 >= len(rows):
        return 0.0
    cur = to_num(rows[idx].get(field))
    prev = to_num(rows[idx + 1].get(field))
    return (cur - prev) / prev * 100 if prev else 0.0


def _credit_row_price_change_pct(row):
    """ka10013의 cur_prc/pred_pre는 부호가 붙은 문자열("-255000"/"-24500")이라 전일종가를
    cur_prc-pred_pre로 역산해 등락률을 구한다(실측: 2026-07-16 -24500/279500=-8.77%로
    Toss 실제 등락률과 일치 확인됨) - 이 TR엔 등락률 필드 자체가 따로 없음."""
    cur = abs(to_num(row.get('cur_prc')))
    pre = to_num(row.get('pred_pre'))
    prior = cur - pre
    return (pre / prior * 100) if prior else 0.0


def credit_pressure_signal(rows):
    """반대매매(담보부족·미수 강제청산) 압박 가능성 근사 - 개별 계좌 단위 정보라 특정
    매도가 반대매매인지 직접 확인할 방법은 없지만, "주가 급락(-5%↓) + 신용융자잔고
    급감(-3%↓, 대량 상환)"이 동시에 나타나는 건 실제 반대매매가 대량 발생했을 때
    관찰되는 패턴이라 이 조합을 정황 신호로 쓴다(확정 아님, 최근 10영업일 중 가장
    심한 날 하나를 찾아 반환)."""
    window = rows[:10]
    worst = None
    for i, row in enumerate(window):
        price_pct = _credit_row_price_change_pct(row)
        bal_pct = _credit_row_change_pct(rows, i, 'remn')
        if price_pct <= -5 and bal_pct <= -3:
            severity = price_pct + bal_pct  # 둘 다 음수 - 합이 작을수록(더 음수) 더 심함
            if worst is None or severity < worst['severity']:
                worst = {'date': row.get('dt'), 'price_change_pct': price_pct,
                          'balance_change_pct': bal_pct, 'severity': severity}
    if not worst:
        return {
            'flag': False, 'label': '특이사항 없음',
            'text': '최근 10영업일 내 주가 급락과 신용융자잔고 급감이 동시에 나타나는 반대매매 특유의 패턴은 보이지 않습니다.'
        }
    d = worst['date'] or ''
    date_label = ('%s-%s-%s' % (d[0:4], d[4:6], d[6:8])) if len(d) == 8 else d
    strong = worst['price_change_pct'] <= -8 and worst['balance_change_pct'] <= -6
    return {
        'flag': True,
        'label': '반대매매 압박 강함' if strong else '반대매매 압박 가능성',
        'date': date_label,
        'price_change_pct': worst['price_change_pct'],
        'balance_change_pct': worst['balance_change_pct'],
        'text': ('%s 주가가 %.1f%% 급락한 날 신용융자잔고도 %.1f%% 급감(대량 상환)했습니다 - '
                  '담보부족·미수 반대매매로 강제 청산된 물량이 매도 압력을 더했을 가능성이 있습니다.'
                  % (date_label, worst['price_change_pct'], worst['balance_change_pct']))
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


def fetch_stock(token, code, name):
    strt_dt, end_dt = date_range()

    short_res = kiwoom_client.call_tr(token, 'ka10014', '/api/dostk/shsa',
                                       {'stk_cd': code, 'strt_dt': strt_dt, 'end_dt': end_dt})
    time.sleep(THROTTLE_SEC)
    loan_res = kiwoom_client.call_tr(token, 'ka20068', '/api/dostk/slb', {'stk_cd': code})
    time.sleep(THROTTLE_SEC)
    invsr_res = kiwoom_client.call_tr(token, 'ka10059', '/api/dostk/stkinfo',
                                       {'stk_cd': code, 'dt': end_dt, 'amt_qty_tp': '1', 'trde_tp': '0', 'unit_tp': '1'})
    time.sleep(THROTTLE_SEC)
    # 2026-07-19: 반대매매(담보부족/미수 강제청산) 압박 근사 신호용 - qry_tp='1'이 신용융자
    # (레버리지 매수, 반대매매 대상)이고 '2'는 신용대주(공매도성 대주, 잔고가 1/2500 수준으로
    # 작아 국내 시장에서 규모가 훨씬 작음 - 실측으로 구분 확인, 문서에 설명 없음). dt는
    # 날짜 필터가 아니라 '0'을 넣으면 최근 100영업일이 그대로 옴(ka10059와 비슷한 동작,
    # 실측 확인 - "1" 등 다른 값은 빈 배열만 옴).
    credit_res = kiwoom_client.call_tr(token, 'ka10013', '/api/dostk/stkinfo',
                                        {'stk_cd': code, 'dt': '0', 'qry_tp': '1'})

    short_rows = short_res.get('shrts_trnsn') or []
    loan_rows = loan_res.get('dbrt_trde_trnsn') or []
    invsr_rows = invsr_res.get('stk_invsr_orgn') or []
    credit_rows = sorted(credit_res.get('crd_trde_trend') or [], key=lambda r: r.get('dt', ''), reverse=True)

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

    # 반대매매 압박(신용융자잔고, ka10013 qry_tp='1') - 종목에 따라 신용거래 자체가 없어
    # crd_trde_trend가 빈 배열일 수 있어 None-safe하게 처리(나머지 응답엔 영향 없음).
    credit_balance_qty = to_num(credit_rows[0].get('remn')) if credit_rows else None
    credit_balance_change_pct = _credit_row_change_pct(credit_rows, 0, 'remn') if len(credit_rows) > 1 else 0.0
    credit_signal = credit_pressure_signal(credit_rows) if credit_rows else None

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
    # 2026-07-19: 여기서 만들던 긍정/중립/부정 해석 문구(pension_interpretation, 제거됨)는
    # "연속 N일"만 반복할 뿐 실제 순매수 금액을 안 보여줘서 "왜 이 판정인지 모르겠다"는
    # 피드백을 받음 - 공매도 카드(shortInterpText)처럼 원자료(streak/net_5d 등)만 내려주고
    # 문구 조립은 js/foreign-flow.js의 pensionInterpText()가 금액까지 포함해서 하도록 이관.

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
        'credit': {
            'balance_qty': credit_balance_qty,
            'balance_change_pct': credit_balance_change_pct,
            'signal': credit_signal,
        },
        'pension': {
            'streak': streak,
            'net_5d': net_5d,
            'net_20d': net_20d,
            'net_60d': net_60d,
            'net_cumulative': net_cumulative,
            'cumulative_window_days': len(penfnd_daily),
            'current_price': current_price,
        },
    }
