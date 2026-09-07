# -*- coding: utf-8 -*-
"""증시온도 배점 로직 - gas/ticker-proxy.gs getMarketTemp()에서 이식.

`docs/BACKEND_CONSOLIDATION.md` 1단계. GAS `?marketTemp=1`이 홈에서 7.1초를 먹고 있어
VM으로 옮기는 중이며, 이 파일은 그중 **순수 배점 계층**만 담는다.

왜 배점만 먼저 떼어내나:
- 화면에 뜨는 숫자(증시온도 점수·등급)가 이식 과정에서 달라지면 안 된다.
- 배점 함수는 입력만 주면 결과가 정해지는 순수 함수라, GAS 실제 응답을 고정해 두고
  같은 입력 -> 같은 점수인지 바로 검증할 수 있다
  (`test/fixtures/gas_market_temp_20260831.json`, `test/test_market_temp_score.py`).
- 데이터 수집(시세·VIX·환율·선물·week52·KOFIA) 배선은 다음 단계에서 붙인다.

이식 원칙: 경계값과 반올림을 GAS와 **정확히** 같게 맞춘다. JS `Math.round`는 음수에서
파이썬 `round`와 다르고(JS는 -0.5 -> -0, 파이썬은 banker's rounding), 여기 값들은 모두
양수 구간이지만 그래도 헷갈리지 않게 `_round_half_up`으로 명시한다.
"""

from decimal import Decimal, ROUND_HALF_UP

# 지표별 배점(GAS MT_COMPONENT_MAX 그대로). 합계가 온도 환산의 만점 기준이 된다.
COMPONENT_MAX = {
    'vix': 20, 'flow': 20, 'tradingValue': 15, 'avgChange': 15,
    'riseRatio': 10, 'sectorStrength': 10, 'week52': 10,
    'exchange': 5, 'usFutures': 5, 'creditRisk': 10,
}


def _round_half_up(value, digits=0):
    """JS Math.round와 같은 반올림(0.5는 항상 위로). 파이썬 기본 round는 짝수로 붙는다."""
    quant = Decimal(1).scaleb(-digits)
    return float(Decimal(str(value)).quantize(quant, rounding=ROUND_HALF_UP))


def _clamp(value, low, high):
    return max(low, min(high, value))


def score_vix(vix):
    if vix is None:
        return {'score': 10, 'value': None, 'note': 'VIX 조회 실패 - 중립 처리', 'band': '조회 실패'}
    if vix < 15:
        score, band = 20, '15 미만'
    elif vix < 20:
        score, band = 16, '15~20'
    elif vix < 25:
        score, band = 10, '20~25'
    elif vix < 30:
        score, band = 5, '25~30'
    else:
        score, band = 0, '30 이상'
    return {'score': score, 'value': vix, 'band': band}


# 거래대금 밴드. 경계와 점수는 GAS 이식 이후 그대로다 - 바뀌는 건 "무엇과 비교하느냐"
# (분모)뿐이고, 비율이 정해진 뒤의 판정은 셋 다 같은 표를 쓴다.
_TRADING_VALUE_BANDS = ((1.3, 15), (1.1, 11), (0.9, 7), (0.7, 4))

_TRADING_VALUE_BAND_TEXT = {
    'sameTime': ('같은 시각 대비 130% 이상', '같은 시각 대비 110~130%', '같은 시각 대비 90~110%',
                 '같은 시각 대비 70~90%', '같은 시각 대비 70% 미만'),
    'elapsedAdjusted': ('진행률 보정 130% 이상', '진행률 보정 110~130%', '진행률 보정 90~110%',
                        '진행률 보정 70~90%', '진행률 보정 70% 미만'),
    'fullDay': ('평균대비 130% 이상', '평균대비 110~130%', '평균대비 90~110%',
                '평균대비 70~90%', '평균대비 70% 미만'),
}


def _trading_value_band(relative, mode):
    texts = _TRADING_VALUE_BAND_TEXT[mode]
    for index, (threshold, points) in enumerate(_TRADING_VALUE_BANDS):
        if relative >= threshold:
            return points, texts[index]
    return 0, texts[-1]


def score_trading_value(today, prior_totals, same_time_totals=None, elapsed_ratio=None):
    """거래대금. prior_totals는 오늘을 뺀 직전 최대 5거래일 **종일** 합계 목록.

    2026-09-07 리포트("거래대금은 계속 점수가 낮아")로 구조를 고쳤다. 원래는 장중 누적인
    `today`를 종일 총액 평균과 그냥 비교했다 - 분자는 그 시각까지, 분모는 하루치 전체라
    시간이 갈수록만 올라가는 값이었다. 실측(13:31, 정규장 69.5% 경과)에서 relative가
    0.668로 경과 비율과 거의 같게 나와 오전 내내 0점이 박혔다.

    그래서 비교 기준을 셋으로 나눈다. 위에서부터 정확한 순서다.

    1. `same_time_totals` - 직전 거래일들의 **같은 시각까지 누적** 목록. 사과 대 사과라
       09시든 15시든 같은 뜻("지금 이 시각 기준 평소보다 몰리나")의 숫자가 나온다.
    2. `elapsed_ratio` - 1번 이력이 아직 없을 때의 폴백. 종일 평균에 장중 진행률을 곱해
       분모를 깎는다. 거래대금은 개장 직후·마감 무렵에 몰리는 U자형이라 시간대별 편향이
       남지만, 하루 종일 0점이 박히는 것보다는 낫다.
    3. 둘 다 없으면(장 마감 후·휴장) 예전과 같이 종일 총액끼리 비교한다 - 이때는 분자도
       종일 값이라 원래 정확했다.

    반환의 `mode`로 어느 기준이었는지 밝힌다. 화면 문구도 그에 맞춰 달라진다.
    """
    if same_time_totals and len(same_time_totals) >= 3:
        basis = sum(same_time_totals) / len(same_time_totals)
        mode = 'sameTime'
    elif len(prior_totals) < 3:
        return {'score': 7.5, 'today': today, 'mode': 'insufficient',
                'note': '5일 평균 기준 데이터 누적 중(3영업일 미만) - 중립 처리'}
    elif elapsed_ratio is not None and 0 < elapsed_ratio < 1:
        basis = (sum(prior_totals) / len(prior_totals)) * elapsed_ratio
        mode = 'elapsedAdjusted'
    else:
        basis = sum(prior_totals) / len(prior_totals)
        mode = 'fullDay'

    relative = (today / basis) if basis > 0 else 1
    score, band = _trading_value_band(relative, mode)
    result = {'score': score, 'today': today, 'relative': relative, 'band': band,
              'mode': mode, 'basis': basis}
    # avg5는 화면·디버깅에서 "평소 하루 거래대금"으로 계속 쓰이므로 기준이 바뀌어도 싣는다.
    if prior_totals:
        result['avg5'] = sum(prior_totals) / len(prior_totals)
    if mode == 'elapsedAdjusted':
        result['elapsedRatio'] = elapsed_ratio
    if mode == 'sameTime':
        result['sameTimeDays'] = len(same_time_totals)
    return result


def score_avg_change(avg_change_rate, quote_count=1):
    if not quote_count:
        return {'score': 7.5, 'note': '데이터 없음 - 중립 처리'}
    avg = avg_change_rate
    if avg >= 2:
        score, band = 15, '+2% 이상'
    elif avg >= 1:
        score, band = 12, '+1~2%'
    elif avg >= 0:
        score, band = 8, '0~+1%'
    elif avg >= -1:
        score, band = 4, '-1~0%'
    else:
        score, band = 0, '-1% 미만'
    return {'score': score, 'avgChangeRate': avg, 'band': band}


def score_rise_ratio(up, down):
    total = up + down
    ratio = (up / total) if total else 0.5
    if ratio >= 0.7:
        score, band = 10, '70% 이상'
    elif ratio >= 0.55:
        score, band = 8, '55~70%'
    elif ratio >= 0.45:
        score, band = 5, '45~55%'
    elif ratio >= 0.3:
        score, band = 3, '30~45%'
    else:
        score, band = 0, '30% 미만'
    return {'score': score, 'ratio': ratio, 'up': up, 'down': down, 'total': total, 'band': band}


def score_sector_strength(sector_count, strong_count):
    """섹터 강세. strong_count는 섹터마다 (평균등락>0), (상승비율>=0.5) 두 포인트를 센 값."""
    if not sector_count:
        return {'score': 5, 'note': '섹터 데이터 조회 실패 - 중립 처리'}
    score = _clamp(int(_round_half_up(strong_count / (sector_count * 2) * 10)), 0, 10)
    return {'score': score, 'sectorCount': sector_count, 'strongCount': strong_count,
            'band': '강세포인트 %d/%d' % (strong_count, sector_count * 2)}


def score_week52(new_high, new_low, scanned=None):
    if new_high is None or new_low is None:
        return {'score': 5,
                'note': '52주 신고가/신저가 데이터 조회 실패(VM 배치 대기 중일 수 있음) - 중립 처리'}
    diff = new_high - new_low
    score = _clamp(int(_round_half_up(5 + diff * 0.3)), 0, 10)
    return {'score': score, 'newHigh': new_high, 'newLow': new_low, 'scanned': scanned,
            'band': '신고가-신저가 차이 %s%d' % ('+' if diff > 0 else '', diff)}


def score_exchange(change_rate, price=None):
    """원/달러. 환율이 내리면(원화 강세) 점수가 오른다."""
    if change_rate is None:
        return {'score': 2.5, 'note': '환율 조회 실패 - 중립 처리', 'band': '조회 실패'}
    score = _clamp(_round_half_up((2.5 - change_rate), 1), 0, 5)
    return {'score': score, 'changeRate': change_rate, 'price': price,
            'band': '전일대비 %s%.2f%%' % ('+' if change_rate >= 0 else '', change_rate)}


def score_us_futures(change_pct, price=None, time_weight=None):
    if change_pct is None:
        return {'score': 2.5, 'note': '미국 선물지수 조회 실패 - 중립 처리', 'band': '조회 실패'}
    if time_weight is None:
        return {'score': 2.5, 'changePct': change_pct, 'price': price,
                'note': '장 종료 후 - 중립 처리', 'band': '장 종료 후(중립)'}
    score = _clamp(_round_half_up(2.5 + change_pct * time_weight, 1), 0, 5)
    return {'score': score, 'changePct': change_pct, 'price': price, 'timeWeight': time_weight,
            'band': '%s%.2f%%(가중치%d%%)' % ('+' if change_pct >= 0 else '', change_pct,
                                              int(_round_half_up(time_weight * 100)))}


def score_flow(foreign_score100, inst_score100):
    """수급. 외국인 75% + 기관 25% 가중합산(KODEX 200 5일 합산 기준)."""
    combined100 = foreign_score100 * 0.75 + inst_score100 * 0.25
    score = _clamp(int(_round_half_up(combined100 / 100 * 20)), 0, 20)
    return {'score': score, 'combined100': combined100,
            'band': '가중 순매수강도 %d%%(중립50%%)' % int(_round_half_up(combined100))}


def total_and_temperature(component_scores, credit_available):
    """컴포넌트 점수 합계와 40℃ 정규화 온도.

    신용융자(creditRisk)가 없는 날은 만점에서도 빼기 때문에, 온도는 항상 그날의
    실제 만점(maxPossible) 기준으로 40℃에 정규화된다.
    """
    max_possible = sum(v for k, v in COMPONENT_MAX.items()
                       if not (k == 'creditRisk' and not credit_available))
    total = _clamp(sum(component_scores), 0, max_possible)
    temp = _round_half_up(total * (40.0 / max_possible), 1)
    return {'score': total, 'maxScore': max_possible, 'temp': temp}

# ---- 신용융자 위험도(GAS scoreKofiaCredit_ 이식) ----

_CREDIT_PENDING = {'available': False, 'score': None, 'max': 10,
                   'validation': 'pending', 'stateLabel': '데이터 검증 중'}

_UNIT_FACTOR = {'krw': 1, 'million_krw': 1000000, 'hundred_million_krw': 100000000}


def score_kofia_credit(kofia):
    """빚투 위험도. 절대 잔고 하나가 아니라 최근 추세·예탁금 대비 비율·반대매매 비중을
    함께 본다(GAS 주석 그대로 - 규제 기준이 아니라 시장온도용 운영 기준).

    단위 검증이 핵심이다. KIS 원자료는 `hundred_million_krw`인 경우가 많아 서로 다른
    단위를 임의 배율로 나누면 3천만% 같은 유령 수치가 나온다. 단위가 확인된 값만 원화로
    환산하고, 신용/예탁금이 **같은 관측일**인지도 먼저 본다. 하나라도 어긋나면 점수를
    내지 않고 '검증 중'으로 빠진다(그러면 총점 만점에서도 10점이 빠져 온도 정규화가 맞는다).
    """
    if not kofia or not kofia.get('available'):
        return dict(_CREDIT_PENDING)

    credit = kofia.get('credit') or {}
    funds = kofia.get('market_funds') or {}
    loan = credit.get('loan_total') if isinstance(credit.get('loan_total'), (int, float)) else None
    deposits = funds.get('investor_deposits') if isinstance(funds.get('investor_deposits'), (int, float)) else None
    forced_sale = funds.get('forced_sale_ratio_pct') if isinstance(funds.get('forced_sale_ratio_pct'), (int, float)) else None
    if loan is None and deposits is None and forced_sale is None:
        return dict(_CREDIT_PENDING)

    credit_unit = _UNIT_FACTOR.get(kofia.get('credit_unit'))
    deposit_unit = _UNIT_FACTOR.get(kofia.get('market_funds_unit'))
    credit_date = credit.get('date') or kofia.get('latest_date') or ''
    deposit_date = funds.get('date') or funds.get('latest_date') or kofia.get('latest_date') or ''

    if loan is not None and deposits is not None:
        reason = None
        if not credit_unit or not deposit_unit:
            reason = '단위 확인 필요'
        elif credit_date and deposit_date and str(credit_date) != str(deposit_date):
            reason = '기준일 불일치'
        elif loan < 0 or deposits <= 0:
            reason = '원자료 범위 확인 필요'
        if not reason:
            ratio = loan * credit_unit / (deposits * deposit_unit) * 100
            if not (0 <= ratio <= 1000):
                reason = '비정상 비율'
        if reason:
            pending = dict(_CREDIT_PENDING)
            pending['validationReason'] = reason
            return pending

    series = kofia.get('series') if isinstance(kofia.get('series'), list) else []
    loan_values = [
        item['credit']['loan_total'] for item in series
        if isinstance(item, dict) and isinstance(item.get('credit'), dict)
        and isinstance(item['credit'].get('loan_total'), (int, float))
    ]
    prior = loan_values[max(0, len(loan_values) - 21):max(0, len(loan_values) - 1)]
    prior_avg = (sum(prior) / len(prior)) if prior else None
    loan_vs_avg_pct = ((loan / prior_avg - 1) * 100) if (loan is not None and prior_avg) else None
    loan_to_deposit_pct = (
        loan * credit_unit / (deposits * deposit_unit) * 100
        if (loan is not None and deposits and deposits > 0 and credit_unit and deposit_unit) else None)

    state = {'risk': 0.0, 'max': 0.0, 'danger': False, 'caution': False}

    def add_risk(value, caution_level, danger_level, weight):
        if value is None:
            return
        state['max'] += weight
        if value >= danger_level:
            state['risk'] += weight
            state['danger'] = True
        elif value >= caution_level:
            state['risk'] += weight * 0.5
            state['caution'] = True

    add_risk(loan_vs_avg_pct, 5, 10, 4)
    add_risk(loan_to_deposit_pct, 35, 45, 4)
    add_risk(forced_sale, 10, 15, 2)

    risk_ratio = (state['risk'] / state['max']) if state['max'] else 0.5
    value = _round_half_up((10 - risk_ratio * 10), 1)
    if state['danger'] or risk_ratio >= 0.55:
        label, name = '과열', 'overheated'
    elif state['caution'] or risk_ratio >= 0.25:
        label, name = '주의', 'caution'
    else:
        label, name = '안정', 'stable'
    return {
        'available': True, 'score': value, 'max': 10,
        'state': name, 'stateLabel': label, 'band': label,
        'loan_total': loan, 'investor_deposits': deposits,
        'loan_vs_avg_pct': loan_vs_avg_pct,
        'loan_to_deposit_pct': loan_to_deposit_pct,
        'forced_sale_ratio_pct': forced_sale,
        'criteria': ('안정: 예탁금 대비 35% 미만·최근 평균 대비 +5% 미만·반대매매 비중 10% 미만'
                     ' / 과열: 45% 이상·+10% 이상·15% 이상 중 하나'),
    }
