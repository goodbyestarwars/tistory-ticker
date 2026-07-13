# -*- coding: utf-8 -*-
"""투자시그널 점수/등급 계산 - gas/ticker-proxy.gs(및 js/foreign-flow.js와 동일 공식)의
computeFlowScoreServer_/computeForeignInstScoreServer_/computeVerdictServer_/
computePensionScoreServer_/foreignInstShiftScore_를 그대로 포팅."""

SCORE_WEIGHTS = {'flow': 0.40, 'foreignInst': 0.25, 'tech': 0.20, 'short': 0.10, 'pension': 0.05}
PENSION_TONE_SCORE = {'very_positive': 90, 'positive': 75, 'neutral_positive': 60, 'neutral': 50, 'caution': 25}

INVEST_SIGNAL_BUCKET_CAP = 100
INVEST_SIGNAL_TOP_N = 20
INVEST_SIGNAL_BUCKET_KEYS = ['적극 매수', '매수 우위', '보유', '비중축소', '매도']


def rolling_sum(daily, field, n):
    """daily는 최신일 우선(내림차순) - gas frgnRollingSum과 동일."""
    return sum(row[field] for row in daily[:n])


def streak(daily, field):
    """연속 순매수/순매도 일수 - gas frgnStreak과 동일. daily[0]가 최신일이어야 한다."""
    if not daily:
        return {'days': 0, 'direction': 'flat'}
    first = daily[0][field]
    direction = 1 if first > 0 else -1 if first < 0 else 0
    days = 0
    if direction != 0:
        for row in daily:
            v = row[field]
            d = 1 if v > 0 else -1 if v < 0 else 0
            if d != direction:
                break
            days += 1
    return {'days': days, 'direction': 'buy' if direction > 0 else 'sell' if direction < 0 else 'flat'}


def build_flow(daily):
    """kiwoom_market.fetch_institution_trend()가 반환하는 daily(내림차순)로 gas getForeignFlow()의
    rolling/streak 구조를 재구성한다 - computeFlowScoreServer_/computeForeignInstScoreServer_/
    foreignInstShiftScore_가 그대로 재사용할 수 있도록 동일한 모양을 맞춘다."""
    if not daily:
        return None
    rolling = {
        '5d': {'foreign': rolling_sum(daily, 'foreign_net', 5), 'inst': rolling_sum(daily, 'inst_net', 5)},
        '20d': {'foreign': rolling_sum(daily, 'foreign_net', 20), 'inst': rolling_sum(daily, 'inst_net', 20)},
    }
    return {
        'daily': daily,
        'rolling': rolling,
        'streak': {
            'foreign': streak(daily, 'foreign_net'),
            'inst': streak(daily, 'inst_net'),
        },
    }


def compute_flow_score(flow):
    """외국인/기관 5일·20일 순매매 방향(4개) 각 ±12.5점, 기준 50점 -> 0~100점."""
    r = flow.get('rolling') or {}
    f5 = r.get('5d', {}).get('foreign', 0)
    f20 = r.get('20d', {}).get('foreign', 0)
    i5 = r.get('5d', {}).get('inst', 0)
    i20 = r.get('20d', {}).get('inst', 0)

    def sgn(v):
        return 1 if v > 0 else -1 if v < 0 else 0

    score = 50 + 12.5 * (sgn(f5) + sgn(f20) + sgn(i5) + sgn(i20))
    return max(0, min(100, round(score)))


def compute_foreign_inst_score(streak_obj):
    """연속매매(streak) 방향·일수를 0~100 점수로 환산."""
    streak_obj = streak_obj or {}

    def dir_score(st):
        if not st or st.get('direction') == 'flat':
            return 0
        days = min(st.get('days', 0), 10)
        return (1 if st.get('direction') == 'buy' else -1) * (10 + days * 3)

    score = 50 + (dir_score(streak_obj.get('foreign')) + dir_score(streak_obj.get('inst'))) / 2
    return max(0, min(100, round(score)))


def compute_pension_score(p):
    """연기금 톤(very_positive~caution) 기준점수 + 연속매매일수 가중치 -> 0~100점."""
    if not p or not p.get('interpretation'):
        return None
    base = PENSION_TONE_SCORE.get(p['interpretation'].get('tone'))
    if base is None:
        return None
    st = p.get('streak') or {'days': 0, 'direction': 'flat'}
    days = min(st.get('days', 0) or 0, 15)
    adj = days * 0.7 if st.get('direction') == 'buy' else -days * 0.7 if st.get('direction') == 'sell' else 0
    return max(0, min(100, round(base + adj)))


def compute_verdict(flow_score, foreign_inst_score, tech_score_obj, short_score, pension_score):
    """가중치 기반 종합점수 -> 별점(0~5, 0.5단위) -> 추천 라벨. 데이터 없는 항목은 중립(50점)."""
    tech_val = tech_score_obj.get('score') if tech_score_obj else None
    vals = {
        'flow': flow_score if flow_score is not None else 50,
        'foreignInst': foreign_inst_score if foreign_inst_score is not None else 50,
        'tech': tech_val if tech_val is not None else 50,
        'short': short_score if short_score is not None else 50,
        'pension': pension_score if pension_score is not None else 50,
    }
    composite = sum(vals[k] * SCORE_WEIGHTS[k] for k in SCORE_WEIGHTS)
    stars = max(0, min(5, round(composite / 20 * 2) / 2))
    label = ('적극 매수' if stars >= 4.5 else '매수 우위' if stars >= 3.8
             else '보유' if stars >= 2.8 else '비중축소' if stars >= 1.8 else '매도')
    return {'score': composite, 'stars': stars, 'label': label}


def foreign_inst_shift_score(rolling):
    """"최근 수급 개선/악화" 랭킹용 지표: 최근 5일 일평균 - 이전 15일 일평균."""
    if not rolling or '5d' not in rolling or '20d' not in rolling:
        return 0
    v5 = rolling['5d']['foreign'] + rolling['5d']['inst']
    v20 = rolling['20d']['foreign'] + rolling['20d']['inst']
    prior15 = v20 - v5
    return (v5 / 5) - (prior15 / 15)


def upsert_ranked(lst, row, field, n, order):
    """랭킹 후보 하나를 상위/하위 N개짜리 정렬 리스트에 삽입하고 N개 넘으면 자른다."""
    if row.get(field) is None:
        return
    lst.append([row['code'], row['name'], row['price'], row['changeRate'], row[field]])
    lst.sort(key=lambda r: r[4], reverse=(order == 'desc'))
    del lst[n:]
