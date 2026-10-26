"""9Pay intraday research observer. No orders, credentials, network or service startup.

Feed it rows from the existing Kiwoom ka10030 rank cache and quotes from the
existing Kiwoom hub. A quote without *verified* cumulative volume is recorded
as missing; a caller may supply a KIS cumulative-volume polling observation.
"""

from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta, timezone
import math
import re
import unicodedata

CODE = re.compile(r"^[0-9]{6}$")
MAX_CANDIDATES = 30
ENTRY_END_MINUTE = 14 * 60  # 2026-10-23 user: day-trade 70% observation/entry until 14:00 KST (was 09:30)


def excluded_product(name):
    """Exclude inverse/leverage and cash-management funds, not all ETFs/ETNs."""
    normalized = re.sub(r'\s+', '', unicodedata.normalize('NFKC', str(name or '')).casefold())
    return any(word in normalized for word in (
        '인버스', '레버리지', 'inverse', 'leverag', '2x', '3x', '2배', '3배', '-1x',
        'cd금리', 'cd91', 'cd1년', 'kofr', 'sofr', '머니마켓', 'moneymarket',
        '단기채', '단기통안', '초단기', '파킹', 'mmf', '양도성예금', '금리액티브'))


def fetch_amount_top(call_tr, token, limit=30):
    """Read ka10032 through an injected existing client; no new credentials.

    The caller owns rate limiting. A failed response is an error, not an empty
    market. The official example names the result array trde_prica_upper.
    """
    data = call_tr(token, 'ka10032', '/api/dostk/rkinfo', {
        'mrkt_tp': '000', 'mang_stk_incls': '0', 'stex_tp': '3'})
    if str(data.get('return_code', 0)) != '0':
        raise ValueError('ka10032 rejected request')
    rows = data.get('trde_prica_upper')
    if not isinstance(rows, list):
        raise ValueError('ka10032 missing ranking array')
    result = []
    for raw in rows:
        code = str(raw.get('stk_cd', '')).split('_')[0]
        try:
            price = abs(float(str(raw.get('cur_prc', '')).replace(',', '')))
            volume = float(str(raw.get('now_trde_qty', '')).replace(',', ''))
            amount = float(str(raw.get('trde_prica', '')).replace(',', ''))
        except (TypeError, ValueError):
            continue
        if CODE.fullmatch(code) and price > 0 and volume > 0 and amount > 0:
            result.append({'code': code, 'name': raw.get('stk_nm'), 'price': price,
                           'trade_volume': volume, 'trade_amount': amount})
    return result[:limit]


def candidates(volume_rows, amount_rows=None, limit=30):
    """Union of ka10030 volume and ka10032 amount leaders, bounded at 30."""
    limit = min(MAX_CANDIDATES, max(1, int(limit)))
    def valid(rows):
        return [r for r in rows if CODE.fullmatch(str(r.get('code', '')))
                and not excluded_product(r.get('name'))
                and (r.get('trade_volume') or 0) > 0 and (r.get('price') or 0) > 0]
    by_volume = sorted(valid(volume_rows), key=lambda r: r['trade_volume'], reverse=True)
    by_amount = sorted(valid(amount_rows if amount_rows is not None else volume_rows),
                       key=lambda r: r.get('trade_amount') or
                       r['price'] * r['trade_volume'], reverse=True)
    selected = {}
    for row in by_volume[:(limit + 1) // 2] + by_amount[:limit // 2]:
        selected.setdefault(row['code'], row)
    return list(selected.values())[:limit]


@dataclass
class Track:
    bases: dict = field(default_factory=dict)
    last_volumes: dict = field(default_factory=dict)
    stage: str = 'watch'
    peak: float = 0.0
    trough: float = 0.0
    first70_at: float | None = None
    first80_at: float | None = None
    pullback_at: float | None = None
    signal_at: float | None = None
    signal_price: float | None = None
    branches: list = field(default_factory=list)
    last_at: float = 0.0
    last_price: float = 0.0
    open_price: float | None = None
    b_invalid: bool = False
    rebound_started: bool = False
    entry_invalid: bool = False
    gap_count: int = 0
    max_gap_sec: float = 0.0
    excluded: str | None = None
    mfe_pct: float | None = None
    mae_pct: float | None = None


KST = timezone(timedelta(hours=9))
VERSION = 'ab70-v1'


def positive(value):
    try:
        value = float(value)
        return value if math.isfinite(value) and value > 0 else None
    except (TypeError, ValueError):
        return None


class Observer:
    """A OR B after observed 70% inflow before 09:30. Never backdate evidence.

    Shared feeds can include premarket volume. Subtract the first observation
    per source after 09:00: this is a conservative lower bound, not an invented
    09:00 cumulative value. B uses the last two confirmed daily lows.
    """

    def __init__(self, codes, prev_volumes, contexts=None, pullback_pct=0.01, rebound_pct=0.003):
        self.tracks = {c: Track() for c in codes}
        self.prev_volumes = prev_volumes
        self.contexts = contexts or {}
        self.pullback_pct = pullback_pct
        self.rebound_pct = rebound_pct

    def observe(self, code, at, price, cumulative_volume=None, source='Kiwoom WebSocket',
                open_price=None, received_at=None):
        price = positive(price)
        received_at = at if received_at is None else received_at
        stamp = datetime.fromtimestamp(received_at, KST)
        sample_stamp = datetime.fromtimestamp(at, KST)
        if (code not in self.tracks or price is None or stamp.date() != sample_stamp.date()
                or not 540 <= stamp.hour * 60 + stamp.minute <= 935 or at > received_at
                or sample_stamp.hour * 60 + sample_stamp.minute < 540
                or received_at - at > 90):
            return None
        t = self.tracks[code]
        if at <= t.last_at:
            return None
        old_price = t.last_price
        if t.last_at:
            gap_sec = at - t.last_at
            t.max_gap_sec = max(t.max_gap_sec, gap_sec)
            if gap_sec > 90:
                t.gap_count += 1
        t.last_at, t.last_price = at, price
        if positive(open_price) is not None:
            t.open_price = positive(open_price)
        context = self.contexts.get(code, {})
        prev_close = positive(context.get('prevClose'))
        lows = context.get('lows') or []
        rising = (positive(lows[0]) < positive(lows[1])) if len(lows) == 2 and all(positive(x) for x in lows) else None
        gap = (t.open_price / prev_close - 1) * 100 if t.open_price and prev_close else None
        baseline = positive(self.prev_volumes.get(code))
        volume = positive(cumulative_volume)
        if cumulative_volume == 0:
            volume = 0.0
        prior_volume = t.last_volumes.get(source)
        reset = volume is not None and prior_volume is not None and volume < prior_volume
        if volume is not None:
            if source not in t.bases or reset:
                t.bases[source] = volume
            t.last_volumes[source] = volume
        inflow = max(0, volume - t.bases[source]) if volume is not None else None
        ratio = inflow / baseline if inflow is not None and baseline else None
        missing = ratio is None or reset
        before_deadline = 540 <= stamp.hour * 60 + stamp.minute < ENTRY_END_MINUTE
        just_qualified = False
        if t.first70_at is None and not t.excluded:
            if not before_deadline:
                t.excluded = '14:00 이전 70% 충족 관측 없음'
            elif not missing and ratio >= 0.7:
                t.first70_at, t.stage, t.peak = received_at, 'volume_met', price
                just_qualified = True
        if t.first70_at and before_deadline and not missing and ratio >= 0.8 and not t.first80_at:
            t.first80_at = received_at
        signal = False
        if t.signal_price:
            change = 100 * (price / t.signal_price - 1)
            t.mfe_pct = max(t.mfe_pct, change)
            t.mae_pct = min(t.mae_pct, change)
        elif t.first70_at and before_deadline and not just_qualified and not missing and not t.entry_invalid:
            if t.pullback_at is None:
                t.peak = max(t.peak, price)
                if price <= t.peak * (1 - self.pullback_pct):
                    t.pullback_at, t.trough, t.stage = received_at, price, 'pullback'
            else:
                if t.rebound_started and price < t.trough:
                    t.entry_invalid, t.stage = True, 'invalidated'
                t.trough = min(t.trough, price)
                if t.open_price and t.trough < t.open_price:
                    t.b_invalid = True
                rebound = price >= t.trough * (1 + self.rebound_pct) and price > old_price
                t.rebound_started = t.rebound_started or rebound
                a = not t.entry_invalid and price > t.peak and prior_volume is not None and volume > prior_volume
                b = (rising is True and gap is not None and gap > 0 and not t.b_invalid
                     and not t.entry_invalid
                     and t.trough >= t.open_price and price >= t.trough * (1 + self.rebound_pct)
                     and price > old_price)
                if a or b:
                    t.branches = (['A'] if a else []) + (['B'] if b else [])
                    t.signal_at, t.signal_price, t.stage = received_at, price, 'signaled'
                    t.mfe_pct = t.mae_pct = 0.0
                    signal = True
        result = {'code': code, 'at': received_at, 'sampleAt': at, 'source': source,
                  'stage': t.stage, 'price': price, 'signal': signal, 'volumeMissing': missing,
                  'volumeRatio': ratio, 'volumeRatioBasis': '관측 이후 유입 하한',
                  'cumulativeVolume': volume, 'observedInflow': inflow,
                  'first70At': t.first70_at, 'first80At': t.first80_at,
                  'priority80': t.first80_at is not None, 'excluded': t.excluded,
                  'gapPct': gap, 'risingLows': rising, 'lows': lows,
                  'changeRate': (price / prev_close - 1) * 100 if prev_close else None,
                  'lowDates': context.get('lowDates'), 'previousDay': context.get('previousDay'),
                  'openPrice': t.open_price, 'pullbackLow': t.trough or None,
                  'peak': t.peak or None, 'bSupportBroken': t.b_invalid,
                  'entryInvalid': t.entry_invalid,
                  'gapCount': t.gap_count, 'maxGapSec': t.max_gap_sec,
                  'branches': list(t.branches), 'signalAt': t.signal_at,
                  'signalPrice': t.signal_price, 'mfePct': t.mfe_pct, 'maePct': t.mae_pct,
                  'signalId': stamp.strftime('%Y-%m-%d') + ':' + code, 'ruleVersion': VERSION}
        return result

    def export_state(self, day):
        return {'version': VERSION, 'day': day,
                'tracks': {code: asdict(t) for code, t in self.tracks.items()},
                'previous': self.prev_volumes, 'contexts': self.contexts}

    def restore_state(self, data, day):
        if data.get('version') != VERSION or data.get('day') != day:
            return False
        restored = {}
        for code, values in list(data.get('tracks', {}).items())[:MAX_CANDIDATES]:
            if not CODE.fullmatch(code):
                continue
            t = Track(**values)
            if t.signal_at and not t.first70_at:
                continue
            if t.first70_at:
                at = datetime.fromtimestamp(t.first70_at, KST)
                if at.strftime('%Y-%m-%d') != day or not 540 <= at.hour * 60 + at.minute < ENTRY_END_MINUTE:
                    continue
            restored[code] = t
        self.tracks = restored
        self.prev_volumes.update(data.get('previous', {}))
        self.contexts.update(data.get('contexts', {}))
        return True
