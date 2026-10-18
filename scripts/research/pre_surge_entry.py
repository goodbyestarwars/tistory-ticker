"""Offline, read-only first-crossing study. No broker or order integration.

Input minute CSV: code,ts,open,high,low,close,volume (KST ISO timestamps).
Input daily JSON directory: <code>.json, rows [date,open,high,low,close,volume].
Only complete chronological minute bars are eligible; next minute open is the
earliest modelled fill. This is a bar approximation, never a claimed fill.
"""
import argparse
import csv
import json
from collections import defaultdict
from datetime import datetime, time, timedelta
from pathlib import Path

THRESHOLDS = (0.3, 0.5, 1.0, 1.5)
CUTOFFS = (time(9, 5), time(9, 10), time(9, 15), time(9, 20), time(9, 30))
ROUND_TRIP_COST = 0.007


def read_minutes(path):
    groups = defaultdict(list)
    with open(path, newline='', encoding='utf-8-sig') as handle:
        for row in csv.DictReader(handle):
            ts = datetime.fromisoformat(row['ts'])
            if not time(9, 0) <= ts.time() <= time(15, 30):
                continue
            bar = {'ts': ts, **{k: float(row[k]) for k in ('open', 'high', 'low', 'close', 'volume')}}
            if bar['volume'] < 0 or min(bar[k] for k in ('open', 'high', 'low', 'close')) <= 0:
                raise ValueError('Invalid OHLCV')
            groups[(row['code'], ts.date().isoformat())].append(bar)
    for key, bars in groups.items():
        bars.sort(key=lambda b: b['ts'])
        if len({b['ts'] for b in bars}) != len(bars):
            raise ValueError(f'Duplicate minute: {key}')
    return groups


def previous_daily_volume(daily_dir, code, date):
    path = Path(daily_dir) / f'{code}.json'
    if not path.exists():
        return None
    rows = json.loads(path.read_text(encoding='utf-8'))
    prior = [r for r in rows if r[0] < date and len(r) >= 6 and float(r[5]) > 0]
    return float(max(prior, key=lambda r: r[0])[5]) if prior else None


def first_crossings(bars, previous_volume, cost=ROUND_TRIP_COST):
    """Crossing known at a completed bar; enter at following contiguous bar open."""
    if not previous_volume or not bars or bars[0]['ts'].time() != time(9, 0):
        return []
    cumulative = 0.0
    emitted = set()
    results = []
    for i, bar in enumerate(bars):
        if i and (bar['ts'] - bars[i - 1]['ts']).total_seconds() != 60:
            break  # Unknown volume in a missing minute; never infer a first crossing.
        known_at = bar['ts'] + timedelta(minutes=1)
        cumulative += bar['volume']
        if known_at.time() > CUTOFFS[-1]:
            break
        for threshold in THRESHOLDS:
            if threshold in emitted or cumulative < threshold * previous_volume:
                continue
            emitted.add(threshold)
            cutoff = next(c for c in CUTOFFS if known_at.time() <= c)
            entry = bars[i + 1] if i + 1 < len(bars) else None
            contiguous = entry and (entry['ts'] - bar['ts']).total_seconds() == 60
            fill = entry['open'] if contiguous else None
            later = bars[i + 1:] if contiguous else []
            result = {
                'threshold': threshold, 'detected_at': known_at.isoformat(),
                'cutoff': cutoff.isoformat(), 'detected_price': bar['close'],
                'cumulative_volume': cumulative, 'volume_ratio': cumulative / previous_volume,
                'entry_at': entry['ts'].isoformat() if contiguous else None,
                'entry_price': fill, 'entry_status': 'next_minute_open_model' if fill else 'unavailable',
                'price_from_open_pct': 100 * (bar['close'] / bars[0]['open'] - 1),
                'previous_low': min((b['low'] for b in bars[:i]), default=None),
                'mfe_pct': 100 * (max(b['high'] for b in later) / fill - 1) if later else None,
                'mae_pct': 100 * (min(b['low'] for b in later) / fill - 1) if later else None,
            }
            for minutes in (5, 15, 30, 60):
                target = next((b for b in later if (b['ts'] - entry['ts']).total_seconds() == minutes * 60), None) if contiguous else None
                result[f'return_{minutes}m_net_pct'] = 100 * (target['close'] / fill - 1 - cost) if target else None
            results.append(result)
    return results


def run(daily_dir, minute_csv, output):
    rows = []
    for (code, day), bars in sorted(read_minutes(minute_csv).items()):
        previous = previous_daily_volume(daily_dir, code, day)
        for event in first_crossings(bars, previous):
            rows.append({'code': code, 'date': day, **event})
    Path(output).write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding='utf-8')
    return len(rows)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('daily_dir')
    parser.add_argument('minute_csv')
    parser.add_argument('output')
    args = parser.parse_args()
    print(run(args.daily_dir, args.minute_csv, args.output))
