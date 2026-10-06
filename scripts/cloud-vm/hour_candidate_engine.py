# -*- coding: utf-8 -*-
"""수동 확인 시점의 1시간 +3% 후보를 거르는 순수 계산 모듈.

이 규칙은 학습·검증된 확률 모델이 아니다. 매수 주문이나 자동 알림을 만들지
않으며, 입력 스냅샷 이후 자료는 사용하지 않는다. 저점 상승, 거래량, 체결,
호가 조건을 함께 통과한 경우에만 실험용 후보로 표시한다.
"""

import math
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_CEILING


KST = timezone(timedelta(hours=9))
TARGET_PCT = 3.0
STOP_PCT = 3.0
MAX_LIVE_AGE_SEC = 10
MAX_TRADE_ASK_GAP_PCT = 0.5

DEFAULT_SETTINGS = {
    'maxOpenRisePct': 5.0,
    'maxMinuteJumpPct': 1.5,
    'minStrength': 110.0,
    'maxSpreadPct': 0.3,
    'minVolumeAcceleration': 1.3,
    'minRecentPrevVolumePct': 1.0,
    'maxVisibleResistanceToRecentVolume': 1.0,
}
SETTINGS_BOUNDS = {
    'maxOpenRisePct': (1.0, 10.0),
    'maxMinuteJumpPct': (0.2, 5.0),
    'minStrength': (100.0, 300.0),
    'maxSpreadPct': (0.01, 1.0),
    'minVolumeAcceleration': (1.0, 5.0),
    'minRecentPrevVolumePct': (0.1, 10.0),
    'maxVisibleResistanceToRecentVolume': (0.05, 3.0),
}


def validate_settings(settings=None):
    """알 수 없는 설정·문자열·비유한수는 조용히 보정하지 않고 거절한다."""
    result = dict(DEFAULT_SETTINGS)
    if settings is None:
        return result
    if not isinstance(settings, dict):
        raise ValueError('설정은 이름과 숫자의 객체여야 합니다.')
    for key, value in settings.items():
        if key not in SETTINGS_BOUNDS:
            raise ValueError('지원하지 않는 설정입니다: ' + str(key))
        number = _num(value) if isinstance(value, (int, float)) else None
        if isinstance(value, bool) or number is None:
            raise ValueError('설정에는 유한한 숫자를 입력해야 합니다: ' + key)
        lower, upper = SETTINGS_BOUNDS[key]
        if not lower <= number <= upper:
            raise ValueError('설정이 허용 범위를 벗어났습니다: ' + key)
        result[key] = number
    return result


def _num(value, minimum=0, strict=False):
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    if not math.isfinite(number) or number < minimum or (strict and number == minimum):
        return None
    return number


def _iso(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return None
    return parsed.astimezone(KST)


def _date(value):
    try:
        return datetime.strptime(str(value).replace('-', ''), '%Y%m%d').date()
    except (ValueError, TypeError):
        return None


def _bar_time(row):
    date = _date(row.get('date'))
    raw = str(row.get('time', '')).replace(':', '')
    if date is None or len(raw) not in (4, 6) or not raw.isdigit():
        return None
    if len(raw) == 4:
        raw += '00'
    try:
        clock = datetime.strptime(raw, '%H%M%S').time()
    except ValueError:
        return None
    if clock.second:
        return None
    return datetime.combine(date, clock, KST)


def tick_size(price):
    """KRX 보통주 호가단위(2023-01-25 이후 가격 구간)."""
    price = Decimal(str(price))
    for ceiling, unit in ((2000, 1), (5000, 5), (20000, 10), (50000, 50),
                          (200000, 100), (500000, 500)):
        if price < ceiling:
            return unit
    return 1000


def ceil_tick(price):
    """최종 가격 구간의 호가단위로 올림한다(구간 경계도 재검사)."""
    price = Decimal(str(price))
    unit = tick_size(price)
    while True:
        rounded = int((price / unit).to_integral_value(rounding=ROUND_CEILING)) * unit
        next_unit = tick_size(rounded)
        if next_unit == unit:
            return rounded
        unit = next_unit


def _on_tick(price):
    return price.is_integer() and int(price) % tick_size(price) == 0


def _book_levels(raw):
    if not isinstance(raw, list):
        return None
    levels = []
    seen = set()
    for row in raw:
        if not isinstance(row, dict):
            return None
        qty = _num(row.get('qty'))
        # KIS에는 호가가 없는 나머지 차수가 0원·0주 또는 빈 필드로 온다.
        if qty == 0 or (row.get('price') is None and row.get('qty') is None):
            continue
        price = _num(row.get('price'), strict=True)
        if price is None or qty is None or not _on_tick(price):
            return None
        if price in seen:
            return None
        seen.add(price)
        levels.append({'price': int(price), 'qty': qty})
    return levels or None


def _closed_bars(raw, checked, lookback_minutes=None):
    """같은 날 연속 완결 봉. 기본은 개장부터, 선택 방향은 최근 구간."""
    if not isinstance(raw, list):
        return None, '완결된 1분봉 자료가 없습니다.'
    minute = checked.replace(second=0, microsecond=0)
    start = minute.replace(hour=9, minute=0)
    if lookback_minutes is not None:
        if isinstance(lookback_minutes, bool) or not isinstance(lookback_minutes, int) or not 4 <= lookback_minutes <= 60:
            return None, '분봉 확인 범위가 올바르지 않습니다.'
        start = max(start, minute - timedelta(minutes=lookback_minutes))
    missing_reason = ('최근 확인 구간의 1분봉이 빠져 있습니다.' if lookback_minutes is not None
                      else '09:00부터 확인 직전 분까지의 1분봉이 빠져 있습니다.')
    mapped = {}
    for item in raw:
        if not isinstance(item, dict):
            return None, '1분봉 자료 형식을 확인할 수 없습니다.'
        stamp = _bar_time(item)
        if stamp is None:
            return None, '1분봉 시각을 확인할 수 없습니다.'
        if stamp.date() < checked.date():
            continue
        if stamp.date() > checked.date():
            return None, '확인일 이후의 1분봉 날짜가 섞여 있습니다.'
        # 현재 분과 이후 분의 가격·거래량을 읽지 않는다.
        if stamp >= minute or stamp < start:
            continue
        values = {key: _num(item.get(key), strict=(key != 'volume'))
                  for key in ('open', 'high', 'low', 'close', 'volume')}
        if any(value is None for value in values.values()):
            return None, '1분봉 가격 또는 거래량에 누락·잘못된 값이 있습니다.'
        if (values['low'] > min(values['open'], values['close']) or
                values['high'] < max(values['open'], values['close']) or
                values['high'] < values['low']):
            return None, '1분봉의 고가·저가 관계가 맞지 않습니다.'
        if stamp in mapped:
            return None, '같은 시각의 1분봉이 중복되어 있습니다.'
        mapped[stamp] = dict(values, stamp=stamp)
    if (minute - start).total_seconds() < 4 * 60:
        return None, '개장 후 완결된 1분봉이 4개 이상 필요합니다.'
    expected = int((minute - start).total_seconds() // 60)
    if expected < 4 or len(mapped) != expected:
        return None, missing_reason
    bars = []
    for index in range(expected):
        stamp = start + timedelta(minutes=index)
        if stamp not in mapped:
            return None, missing_reason
        bars.append(mapped[stamp])
    return bars, None


def _pattern(bars):
    rising = bars[-3]['low'] < bars[-2]['low'] < bars[-1]['low']
    # 양옆 완결 봉보다 낮은 저점만 확정한다. 맨 끝 봉은 피벗이 될 수 없다.
    pivots = [index for index in range(1, len(bars) - 1)
              if bars[index]['low'] < bars[index - 1]['low']
              and bars[index]['low'] < bars[index + 1]['low']]
    pivot_rise = len(pivots) >= 2 and bars[pivots[-2]]['low'] < bars[pivots[-1]]['low']
    return rising, pivot_rise, [{'time': bars[index]['stamp'].isoformat(),
                               'price': bars[index]['low']} for index in pivots]


def evaluate(snapshot, settings=None, lookback_minutes=None):
    """한 종목을 판정한다. 시간/출처 오류는 수익률 확률로 대체하지 않는다."""
    settings = validate_settings(settings)
    if not isinstance(snapshot, dict):
        snapshot = {}
    checked = _iso(snapshot.get('checkedAt'))
    result = {
        'code': snapshot.get('code'), 'name': snapshot.get('name'),
        'status': 'insufficient_data', 'reasons': [], 'metrics': {},
        'entryPrice': None, 'targetPrice': None, 'stopPrice': None,
        'targetPct': None, 'stopPct': None,
        'checkedAt': checked.isoformat() if checked else None,
        'expiresAt': (checked + timedelta(hours=1)).isoformat() if checked else None,
        'probability': None,
    }
    issues, rejected = [], []
    result['inputIssues'] = issues
    result['commonBlockers'] = []

    def block(reason):
        rejected.append(reason)
        result['commonBlockers'].append(reason)
    metrics = result['metrics']
    if checked is None:
        issues.append('확인 시각과 시간대를 확인할 수 없습니다.')
        result['reasons'] = list(issues)
        return result
    if snapshot.get('market') != 'KRX' or snapshot.get('source') != 'KIS':
        issues.append('KRX의 같은 출처로 맞춘 자료가 필요합니다.')
        result['reasons'] = list(issues)
        return result
    if checked.weekday() >= 5:
        issues.append('정규장 거래일의 자료가 필요합니다.')
        result['reasons'] = list(issues)
        return result

    data_asof = _iso(snapshot.get('dataAsOf'))
    if data_asof is None or not 0 <= (checked - data_asof).total_seconds() <= MAX_LIVE_AGE_SEC:
        issues.append('자료의 최신 시각을 확인할 수 없거나 확인 시점과 맞지 않습니다.')
    else:
        metrics['dataAsOf'] = data_asof.isoformat()

    quote = snapshot.get('quote') if isinstance(snapshot.get('quote'), dict) else {}
    opening = _num(quote.get('open'), strict=True)
    observed_high = _num(quote.get('high'), strict=True)
    upper_limit = _num(quote.get('upperLimit'), strict=True)
    if opening is None or observed_high is None or observed_high < opening:
        issues.append('시가와 확인 시점까지의 고가를 확인할 수 없습니다.')
    if upper_limit is None:
        issues.append('상한가를 확인할 수 없어 목표가 도달 가능 범위를 계산하지 못합니다.')
    temp_stop = quote.get('tempStop')
    if temp_stop is True or temp_stop == 'Y':
        block('거래가 일시 정지된 종목입니다.')
    elif temp_stop is not False and temp_stop != 'N':
        issues.append('거래 일시 정지 여부를 확인할 수 없습니다.')

    book = snapshot.get('book') if isinstance(snapshot.get('book'), dict) else {}
    trade = snapshot.get('trade') if isinstance(snapshot.get('trade'), dict) else {}
    live_stamps = []
    for obj, label in ((book, '호가'), (trade, '체결')):
        stamp = _iso(obj.get('time'))
        if stamp is None or stamp.date() != checked.date() or not 0 <= (checked - stamp).total_seconds() <= MAX_LIVE_AGE_SEC:
            issues.append(label + ' 자료가 없거나 10초를 넘게 오래되었거나 미래 시각입니다.')
        else:
            live_stamps.append(stamp)
            metrics['bookAgeSec' if label == '호가' else 'tradeAgeSec'] = (checked - stamp).total_seconds()
    if data_asof is not None and live_stamps and data_asof < max(live_stamps):
        issues.append('자료 최신 시각이 실제 호가·체결 시각보다 앞서 있습니다.')
    asks, bids = _book_levels(book.get('asks')), _book_levels(book.get('bids'))
    if asks is None or bids is None:
        issues.append('유효한 매수·매도 호가와 잔량을 확인할 수 없습니다.')
    entry = min((row['price'] for row in asks), default=None) if asks else None
    bid = max((row['price'] for row in bids), default=None) if bids else None
    if entry is not None:
        target = ceil_tick(Decimal(entry) * Decimal('1.03'))
        stop = ceil_tick(Decimal(entry) * Decimal('0.97'))
        result.update(entryPrice=entry, targetPrice=target, stopPrice=stop)
        metrics['actualTargetPct'] = (target / entry - 1) * 100
        metrics['actualStopPct'] = (stop / entry - 1) * 100
        result.update(targetPct=metrics['actualTargetPct'], stopPct=metrics['actualStopPct'])
        metrics['entryBasis'] = '확인 시점 매도 1호가의 1주 가격(체결 미보장)'
        if upper_limit is not None and target > upper_limit:
            block('매수가 대비 +3% 목표가가 당일 상한가를 넘습니다.')
        if bid is not None:
            if bid >= entry:
                issues.append('매수·매도 호가 순서가 맞지 않습니다.')
            else:
                spread = (entry - bid) / entry * 100
                metrics['spreadPct'] = spread
                if spread > settings['maxSpreadPct']:
                    block('매수·매도 호가 간격이 설정한 한도보다 넓습니다.')
        support = [row for row in (bids or []) if entry * 0.99 <= row['price'] < entry]
        resistance = [row for row in asks if entry <= row['price'] < target]
        metrics.update(
            visibleBidQtyWithin1Pct=sum(row['qty'] for row in support),
            strongestBidWall=max(support, key=lambda row: row['qty'], default=None),
            visibleAskQtyBelowTarget=sum(row['qty'] for row in resistance),
            strongestAskWall=max(resistance, key=lambda row: row['qty'], default=None),
            visibleAskMaxPrice=max(row['price'] for row in asks),
            visibleResistanceOnly=True,
        )

    trade_price = _num(trade.get('price'), strict=True)
    trade_qty = _num(trade.get('qty'), strict=True)
    strength = _num(trade.get('strength'), strict=True)
    if trade_price is None or trade_qty is None or not _on_tick(trade_price):
        issues.append('최근 체결 가격 또는 체결량을 확인할 수 없습니다.')
        trade_price = None
    if strength is None:
        issues.append('실제 체결강도 자료가 없습니다.')
    else:
        metrics['strength'] = strength
        if strength < settings['minStrength']:
            rejected.append('체결강도가 설정한 매수 우위 기준에 못 미칩니다.')
    if trade_price is not None and entry is not None:
        metrics['tradeAskGapPct'] = abs(entry / trade_price - 1) * 100
        if metrics['tradeAskGapPct'] >= MAX_TRADE_ASK_GAP_PCT:
            issues.append('최근 체결가와 매도 1호가의 차이가 0.5% 이상입니다.')

    bars, bar_error = _closed_bars(snapshot.get('bars'), checked, lookback_minutes)
    if bar_error:
        issues.append(bar_error)
    if opening is not None and observed_high is not None and observed_high >= opening:
        maximum = max([observed_high] + ([entry] if entry is not None else [])
                      + ([row['high'] for row in bars] if bars else []))
        open_rise = (maximum / opening - 1) * 100
        metrics['maxOpenRisePct'] = open_rise
        if open_rise >= settings['maxOpenRisePct'] - 1e-9:
            block('개장 후 이미 설정한 상승폭 이상 오른 종목입니다.')

    previous = snapshot.get('previousVolume') if isinstance(snapshot.get('previousVolume'), dict) else {}
    prev_volume = _num(previous.get('value'), strict=True)
    prev_date = _date(previous.get('date'))
    if (prev_volume is None or prev_date is None or prev_date >= checked.date()
            or previous.get('source') != 'KIS' or previous.get('market') != 'KRX'):
        issues.append('같은 출처·시장의 직전 거래일 거래량을 확인할 수 없습니다.')
        prev_volume = None
    else:
        metrics['previousVolumeDate'] = prev_date.isoformat()
        metrics['previousVolume'] = prev_volume

    if bars:
        metrics['closedBarCount'] = len(bars)
        metrics['barStartAt'] = bars[0]['stamp'].isoformat()
        metrics['barLookbackMinutes'] = lookback_minutes
        metrics['lastClosedBarAt'] = bars[-1]['stamp'].isoformat()
        # 직전 최대 5개 완결 봉 고점 돌파는 추가 관찰값이며 후보의 필수 조건은 아니다.
        metrics['priorHigh'] = max(row['high'] for row in bars[-6:-1])
        metrics['breakoutConfirmed'] = bars[-1]['close'] > metrics['priorHigh']
        jumps = [(row['high'] / row['open'] - 1) * 100 for row in bars]
        jumps += [(bars[index]['open'] / bars[index - 1]['close'] - 1) * 100
                  for index in range(1, len(bars))]
        metrics['maxMinuteJumpPct'] = max(jumps)
        if metrics['maxMinuteJumpPct'] >= settings['maxMinuteJumpPct'] - 1e-9:
            block('완결된 1분봉에서 한 번에 크게 오른 구간이 있습니다.')
        rising, pivot_rise, pivots = _pattern(bars)
        metrics.update(risingRecentLows=rising, risingConfirmedPivotLows=pivot_rise,
                       confirmedPivotLows=pivots)
        if not rising and not pivot_rise:
            rejected.append('최근 저점 또는 확인된 두 피벗의 저점이 높아지는 패턴이 없습니다.')
        recent_volume = sum(row['volume'] for row in bars[-2:])
        baseline_volume = sum(row['volume'] for row in bars[-4:-2])
        total_volume = sum(row['volume'] for row in bars)
        metrics['recent2MinuteVolume'] = recent_volume
        if baseline_volume <= 0 or total_volume <= 0:
            issues.append('거래량 가속과 VWAP 근사치를 계산할 거래가 부족합니다.')
        else:
            acceleration = recent_volume / baseline_volume
            metrics['volumeAcceleration'] = acceleration
            if acceleration < settings['minVolumeAcceleration']:
                block('최근 2분 거래량이 앞선 2분보다 충분히 늘지 않았습니다.')
            vwap = sum((row['high'] + row['low'] + row['close']) / 3 * row['volume']
                       for row in bars) / total_volume
            metrics['barTypicalPriceVwap'] = vwap
            if bars[-1]['close'] < vwap or bars[-1]['close'] <= bars[0]['open']:
                rejected.append('최근 종가가 개장 가격과 거래량 가중 평균 가격을 지지하지 못합니다.')
        if trade_price is not None and trade_price < bars[-1]['close'] * 0.998:
            rejected.append('현재 체결가가 직전 완결 봉의 종가보다 밀렸습니다.')
        if prev_volume is not None:
            ratio = recent_volume / prev_volume * 100
            metrics['recentPrevVolumePct'] = ratio
            if ratio < settings['minRecentPrevVolumePct']:
                block('최근 2분 거래량이 전일 거래량 대비 기준에 못 미칩니다.')
        if entry is not None:
            if recent_volume <= 0:
                issues.append('최근 거래량이 없어 매도 잔량 부담을 비교하지 못합니다.')
            else:
                burden = metrics['visibleAskQtyBelowTarget'] / recent_volume
                metrics['visibleResistanceToRecentVolume'] = burden
                if burden > settings['maxVisibleResistanceToRecentVolume']:
                    rejected.append('보이는 목표가 아래 매도 잔량이 최근 거래량보다 부담스럽습니다.')

    # 자료 누락과 별개로 확인된 제외 조건이 있으면 제외를 우선한다.
    if rejected:
        result['status'] = 'rejected'
        result['reasons'] = rejected + issues
    elif issues:
        result['status'] = 'insufficient_data'
        result['reasons'] = issues
    else:
        result['status'] = 'candidate'
        result['reasons'] = ['저점 상승·가격 흐름·거래량·체결·호가 조건을 함께 통과한 실험용 후보입니다.']
    return result
