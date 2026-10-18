"""9Pay intraday research observer. No orders, credentials, network or service startup.

Feed it rows from the existing Kiwoom ka10030 rank cache and quotes from the
existing Kiwoom hub. A quote without *verified* cumulative volume is recorded
as missing; a caller may supply a KIS cumulative-volume polling observation.
"""

from collections import deque
from dataclasses import dataclass, field
import re

CODE = re.compile(r"^[0-9]{6}$")
MAX_CANDIDATES = 30


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
    samples: deque = field(default_factory=lambda: deque(maxlen=120))
    stage: str = 'watch'
    peak: float = 0.0
    trough: float = 0.0
    peak_volume: float = 0.0
    signal_at: float | None = None
    signal_price: float | None = None
    mfe_pct: float | None = None
    mae_pct: float | None = None


class Observer:
    """First surge -> first pullback -> rebreak, sampled price path only."""

    def __init__(self, codes, prev_volumes, surge_ratio=0.03, pullback_pct=0.01):
        self.tracks = {c: Track() for c in codes}
        self.prev_volumes = prev_volumes
        self.surge_ratio = surge_ratio
        self.pullback_pct = pullback_pct

    def observe(self, code, at, price, cumulative_volume=None, source='Kiwoom WebSocket'):
        if code not in self.tracks or not price or price <= 0:
            return None
        t = self.tracks[code]
        if t.samples and at <= t.samples[-1][0]:
            return None
        missing = cumulative_volume is None or self.prev_volumes.get(code) is None
        t.samples.append((at, price, cumulative_volume))
        if t.signal_price:
            change = 100 * (price / t.signal_price - 1)
            t.mfe_pct = max(t.mfe_pct, change)
            t.mae_pct = min(t.mae_pct, change)
        result = {'code': code, 'at': at, 'source': source, 'stage': t.stage,
                  'volumeMissing': missing, 'signal': False,
                  'mfePct': t.mfe_pct, 'maePct': t.mae_pct}
        if missing or len(t.samples) < 2 or t.stage == 'signaled':
            return result
        previous = t.samples[-2][2]
        if previous is None or cumulative_volume < previous:
            t.stage = 'watch'  # reset, day rollover or bad cumulative field
            return result
        baseline = self.prev_volumes[code]
        if baseline <= 0:
            return result
        if t.stage == 'watch':
            window = next((s for s in t.samples if at - s[0] <= 180 and s[2] is not None), None)
            if window and at > window[0] and cumulative_volume - window[2] >= baseline * self.surge_ratio:
                t.stage, t.peak, t.peak_volume = 'surge', price, cumulative_volume
        elif t.stage == 'surge':
            t.peak = max(t.peak, price)
            if price <= t.peak * (1 - self.pullback_pct):
                t.stage, t.trough = 'pullback', price
        elif t.stage == 'pullback':
            t.trough = min(t.trough, price)
            if price > t.peak and cumulative_volume > t.peak_volume:
                t.stage, t.signal_at, t.signal_price = 'signaled', at, price
                t.mfe_pct = t.mae_pct = 0.0
                result['signal'] = True
        result['stage'] = t.stage
        result['mfePct'], result['maePct'] = t.mfe_pct, t.mae_pct
        return result
