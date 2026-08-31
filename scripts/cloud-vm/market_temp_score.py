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


def score_trading_value(today, prior_totals):
    """거래대금. prior_totals는 오늘을 뺀 직전 최대 5거래일 합계 목록.

    GAS는 이 이력을 PropertiesService에 넣어뒀다. VM으로 옮기면 SQLite로 가는데,
    옮긴 직후엔 이력이 비어 3영업일이 쌓일 때까지 중립(7.5)이 나온다 - 배선 단계에서
    GAS 이력을 한 번 이관하거나 며칠 중립을 감수할지 정해야 한다.
    """
    if len(prior_totals) < 3:
        return {'score': 7.5, 'today': today,
                'note': '5일 평균 기준 데이터 누적 중(3영업일 미만) - 중립 처리'}
    avg5 = sum(prior_totals) / len(prior_totals)
    relative = (today / avg5) if avg5 > 0 else 1
    if relative >= 1.3:
        score, band = 15, '평균대비 130% 이상'
    elif relative >= 1.1:
        score, band = 11, '평균대비 110~130%'
    elif relative >= 0.9:
        score, band = 7, '평균대비 90~110%'
    elif relative >= 0.7:
        score, band = 4, '평균대비 70~90%'
    else:
        score, band = 0, '평균대비 70% 미만'
    return {'score': score, 'today': today, 'avg5': avg5, 'relative': relative, 'band': band}


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
