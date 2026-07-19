# -*- coding: utf-8 -*-
"""투자시그널 점수/등급 계산 - js/foreign-flow.js와 동일 공식을 그대로 포팅(원래 GAS에
있던 computeFlowScoreServer_ 등은 2026-07-13에 이 파일로 이전되며 삭제됨 - GAS 재배포
없이 git push만으로 반영되는 이 경로가 정본).
2026-07-19(4차): 반대매매 압박(credit)·펀더멘탈(fundamental) 점수 추가(사용자 요청 -
"작게만 떼어내서 추가") - 기존 5개 가중치를 비례 축소하고 신규 2개를 작게 배분."""

SCORE_WEIGHTS = {
    'flow': 0.37, 'foreignInst': 0.23, 'tech': 0.17, 'short': 0.08, 'pension': 0.04,
    'credit': 0.03, 'fundamental': 0.08,
}
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


def compute_credit_score(credit):
    """반대매매 압박 신호(investor_flow.credit_pressure_signal)를 0~100 점수로 환산.
    다른 컴포넌트와 같은 "높을수록 좋다" 관례를 맞추려고 위험할수록 점수를 낮춘다 -
    플래그 없음(특이사항 없음)=100(안전), '가능성'=40, '강함'=10. 신용거래 자체가 없는
    종목(credit 전체가 없음)은 None -> compute_verdict가 중립(50점)으로 채운다."""
    if not credit or not credit.get('signal'):
        return None
    sig = credit['signal']
    if not sig.get('flag'):
        return 100
    return 10 if '강함' in (sig.get('label') or '') else 40


def compute_fundamental_score(annual):
    """DART 연간 재무(annual, fundamentals.fetch_stock의 'annual' 필드)로 펀더멘탈 점수
    0~100 산출 - ROE(수익성, 60%)와 부채비율(안정성, 40%) 2개만 사용(PER/PBR은 배치가
    라이브 시세를 안 불러와서 제외 - 종목분석 페이지의 펀더멘탈 탭엔 별도로 표시됨,
    점수에는 두 페이지가 똑같이 계산 가능한 이 2개 지표만 반영해 일관성을 맞춤).
    DART 미제출 등으로 annual 자체가 없으면 None -> 중립(50점)."""
    if not annual:
        return None
    roe = annual.get('latest_roe_pct')
    debt = annual.get('latest_debt_ratio_pct')
    if roe is None and debt is None:
        return None
    roe_score = (100 if roe >= 15 else 80 if roe >= 10 else 60 if roe >= 5 else 40 if roe >= 0 else 20) \
        if roe is not None else 50
    debt_score = (100 if debt <= 50 else 80 if debt <= 100 else 60 if debt <= 150 else 40 if debt <= 200 else 20) \
        if debt is not None else 50
    return round(roe_score * 0.6 + debt_score * 0.4)


def compute_verdict(flow_score, foreign_inst_score, tech_score_obj, short_score, pension_score,
                     credit_score=None, fundamental_score=None):
    """가중치 기반 종합점수 -> 별점(0~5, 0.5단위) -> 추천 라벨. 데이터 없는 항목은 중립(50점).
    credit_score/fundamental_score는 기본값 None을 둬서(2026-07-19 추가) 이 함수를 옛 5개
    인자로 호출하던 자리가 있어도 깨지지 않는다."""
    tech_val = tech_score_obj.get('score') if tech_score_obj else None
    vals = {
        'flow': flow_score if flow_score is not None else 50,
        'foreignInst': foreign_inst_score if foreign_inst_score is not None else 50,
        'tech': tech_val if tech_val is not None else 50,
        'short': short_score if short_score is not None else 50,
        'pension': pension_score if pension_score is not None else 50,
        'credit': credit_score if credit_score is not None else 50,
        'fundamental': fundamental_score if fundamental_score is not None else 50,
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
