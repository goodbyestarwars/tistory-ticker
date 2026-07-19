# -*- coding: utf-8 -*-
"""종목분석 메인 수급 표(rolling/streak/signal/amount_estimate) 계산 -
gas/ticker-proxy.gs의 frgnRollingSum/frgnAmountSum/frgnStreak/frgnSignal을 그대로 포팅.
daily는 kiwoom_market.fetch_foreign_inst_daily()가 반환하는 최신일 우선(내림차순) 배열."""


def rolling_sum(daily, field, n):
    length = min(n, len(daily))
    return sum(daily[i][field] for i in range(length))


def amount_sum(daily, field, n):
    length = min(n, len(daily))
    return sum(daily[i][field] * daily[i]['close'] for i in range(length))


def streak(daily, field):
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


def signal(daily, rolling, kind):
    """추세 전환 신호 - 최근 5일 vs 이전 15일 부호 반전 + 크기(평소 이틀치 이상) +
    연속성(5일 중 3일 이상 같은 방향) 3개 조건을 모두 만족해야 true."""
    field = kind + '_net'
    v5 = rolling['5d'][kind]
    v20 = rolling['20d'][kind]
    prior15 = v20 - v5

    n = min(20, len(daily))
    avg_daily = (sum(abs(daily[i][field]) for i in range(n)) / n) if n else 0
    magnitude_ok = abs(v5) >= avg_daily * 2

    direction = 'buy' if (v5 > 0 and prior15 < 0) else 'sell' if (v5 < 0 and prior15 > 0) else None

    m = min(5, len(daily))
    same_dir_days = 0
    for d in range(m):
        v = daily[d][field]
        if (direction == 'buy' and v > 0) or (direction == 'sell' and v < 0):
            same_dir_days += 1
    consistency_ok = same_dir_days >= 3

    shift = bool(direction) and magnitude_ok and consistency_ok

    avg_change_pct = (sum(daily[c]['change_pct'] for c in range(m)) / m) if m else 0
    price_confirmed = (avg_change_pct > 0) if direction == 'buy' else (avg_change_pct < 0) if direction == 'sell' else False

    note = ''
    if shift:
        note = ('최근 5일 ' + ('플러스' if v5 > 0 else '마이너스') + ' vs 이전 15일 '
                + ('플러스' if prior15 > 0 else '마이너스') + ' 전환'
                + (' · 주가 동반' if price_confirmed else ' · 주가 미동반'))

    return {'trend_shift': shift, 'price_confirmed': price_confirmed, 'note': note}


# 2026-07-19(3차): 수급 표를 "당일~4일전 개별행 + 5일/10일/20일/2개월/3개월 합산행"으로
# 재구성하면서 2개월(42영업일)/3개월(63영업일) 윈도우 추가 - 반복되는 4줄짜리 블록을
# 늘리는 대신 (dict키, 영업일수) 목록으로 두고 루프 조립.
ROLLING_WINDOWS = [('5d', 5), ('10d', 10), ('20d', 20), ('2m', 42), ('3m', 63)]


def build_result(code, daily):
    """gas getForeignFlow()와 동일한 응답 형태({code, as_of, daily, rolling,
    amount_estimate, streak, signal})로 조립. name은 여기서 안 채움(호출부가 이미 아는
    값을 프론트에서 덧씌움 - /investor-flow, /ohlc와 동일 패턴).
    2026-07-18: 개인(ind) 추가 - foreign/inst와 동일한 패턴으로 rolling/streak/signal에
    kind='ind'를 더함(daily 각 행의 ind_net은 kiwoom_market.fetch_foreign_inst_daily가
    ka10059에서 이미 채워서 넘겨준다)."""
    if not daily:
        return None

    rolling = {'today': {'foreign': daily[0]['foreign_net'], 'inst': daily[0]['inst_net'], 'ind': daily[0]['ind_net']}}
    amount_estimate = {
        'today_krw': amount_sum(daily, 'foreign_net', 1),
        'inst_today_krw': amount_sum(daily, 'inst_net', 1),
        'ind_today_krw': amount_sum(daily, 'ind_net', 1),
    }
    for key, n in ROLLING_WINDOWS:
        rolling[key] = {
            'foreign': rolling_sum(daily, 'foreign_net', n),
            'inst': rolling_sum(daily, 'inst_net', n),
            'ind': rolling_sum(daily, 'ind_net', n),
        }
        amount_estimate[key + '_krw'] = amount_sum(daily, 'foreign_net', n)
        amount_estimate['inst_' + key + '_krw'] = amount_sum(daily, 'inst_net', n)
        amount_estimate['ind_' + key + '_krw'] = amount_sum(daily, 'ind_net', n)

    return {
        'code': code.upper(),
        'as_of': daily[0]['date'],
        'daily': daily,
        'rolling': rolling,
        'amount_estimate': amount_estimate,
        'streak': {
            'foreign': streak(daily, 'foreign_net'),
            'inst': streak(daily, 'inst_net'),
            'ind': streak(daily, 'ind_net'),
        },
        'signal': {
            'foreign': signal(daily, rolling, 'foreign'),
            'inst': signal(daily, rolling, 'inst'),
            'ind': signal(daily, rolling, 'ind'),
        },
    }
