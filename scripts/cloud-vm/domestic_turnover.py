"""Home-only cumulative market turnover; no price, signal or order calculations."""
import math
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import kis_client
import market_clock

KST = ZoneInfo('Asia/Seoul')
LOOKBACK = 5
BASIS = 'same-time-cumulative-30m'


def _amount(value):
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(str(value).replace(',', ''))
        return number * 1000000 if math.isfinite(number) and number >= 0 and math.isfinite(number * 1000000) else None
    except (TypeError, ValueError):
        return None


def parse_turnover(rows, now):
    """Ignore the forming bar: its cumulative value cannot share a past full-bar denominator.

    Verified on live 2026-10-28 KIS: 30m bar 14:00 amount equals 1m
    bar 14:29 (16,169,246 million KRW), not 14:00 or the current 14:30 bar.
    Closing-auction 15:30 row is a separate final snapshot.
    """
    now = now.astimezone(KST)
    result = {'status': 'unavailable', 'source': 'KIS', 'market': 'KRX', 'unit': 'KRW',
              'basis': BASIS, 'lookbackDays': LOOKBACK, 'intervalMinutes': 30,
              'retrievedAt': now.isoformat(), 'index100': None, 'current': None,
              'baseline': None, 'asOf': None, 'sampleDays': 0, 'baselineDates': []}
    day = now.date()
    opening, closing = market_clock.kr_session_minutes(day)
    minute = now.hour * 60 + now.minute
    if not market_clock.is_kr_trading_day(now) or minute < opening:
        day = market_clock.prev_kr_trading_day(day)
        opening, closing = market_clock.kr_session_minutes(day)
        slot, cutoff = closing, closing
    elif minute >= closing + 2:
        slot, cutoff = closing, closing
    else:
        # Two minutes for the provider to finalize its previous bar.
        cutoff = ((minute - 2) // 30) * 30
        slot = cutoff - 30
    if slot < opening:
        result['reason'] = 'first-completed-bar-pending'
        return result
    dates = []
    previous = day
    for _ in range(LOOKBACK):
        previous = market_clock.prev_kr_trading_day(previous)
        dates.append(previous)
    # Delayed openings cannot be compared on an incompatible clock/session basis.
    if any(market_clock.kr_session_minutes(d) != (opening, closing) for d in dates):
        result['reason'] = 'session-hours-mismatch'
        return result
    wanted = {d.strftime('%Y%m%d') for d in [day] + dates}
    stamp = '%02d%02d00' % divmod(slot, 60)
    values = {}
    for row in rows if isinstance(rows, list) else []:
        key = str(row.get('stck_bsop_date') or '')
        if key not in wanted or str(row.get('stck_cntg_hour') or '') != stamp:
            continue
        amount = _amount(row.get('acml_tr_pbmn'))
        if key in values:
            result['reason'] = 'duplicate-observation'
            return result
        values[key] = amount
    current = values.get(day.strftime('%Y%m%d'))
    history = [values.get(d.strftime('%Y%m%d')) for d in dates]
    result.update(current=current, sampleDays=sum(v is not None and v > 0 for v in history),
                  asOf=datetime(day.year, day.month, day.day, cutoff // 60, cutoff % 60, tzinfo=KST).isoformat(),
                  baselineDates=[d.isoformat() for d in dates])
    if current is None or any(v is None or v <= 0 for v in history):
        result['reason'] = 'missing-comparable-observation'
        return result
    baseline = sum(history) / LOOKBACK
    index = current / baseline * 100
    if not math.isfinite(baseline) or not math.isfinite(index):
        result['reason'] = 'invalid-ratio'
        return result
    result.update(status='ok', baseline=baseline, index100=index)
    return result


def fetch_turnover(market, now):
    appkey, appsecret = os.environ.get('KIS_APPKEY'), os.environ.get('KIS_APPSECRET')
    if not appkey or not appsecret:
        return {'status': 'unavailable', 'reason': 'provider-unavailable'}
    try:
        token = kis_client.get_token(appkey, appsecret)
        rows = kis_client.fetch_index_turnover_chart(token, appkey, appsecret,
                                                    {'KOSPI': '0001', 'KOSDAQ': '1001'}[market])
        return parse_turnover(rows, datetime.fromtimestamp(now, KST))
    except Exception:
        # Never publish provider responses, credentials or sensitive exception text.
        return {'status': 'unavailable', 'reason': 'provider-error'}
