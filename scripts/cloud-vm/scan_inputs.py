"""Bounded nightly acquisition; independent OHLC/flow freshness and diagnostics.

No new workers, provider endpoints or rate limits. Only current, validated rows
are written. Failed/stale reads leave the previous database rows intact.
"""
import math
import json
import time

import db_schema
import kiwoom_market


def valid_rows(rows, basis, fields, newest_first=False):
    if not rows:
        return False
    dates = [r.get('date', '') for r in rows]
    if dates != sorted(set(dates), reverse=newest_first):
        return False
    if (dates[0] if newest_first else dates[-1]) != basis:
        return False
    for row in rows:
        for key in fields:
            value = row.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                return False
        if row['close'] <= 0:
            return False
        if 'high' in row and not (row['low'] <= min(row['open'], row['close'])
                                 <= max(row['open'], row['close']) <= row['high']):
            return False
    return True


class ScanInputs:
    def __init__(self, conn, basis, token, kis_key, kis_secret, timings, save_ohlc, throttle=.25):
        self.conn, self.basis, self.token = conn, basis, token
        self.kis_key, self.kis_secret = kis_key, kis_secret
        self.timings, self.save_ohlc, self.throttle = timings, save_ohlc, throttle
        self.counts = {d: {'dbReuse': 0, 'requests': 0, 'fresh': 0, 'stale': 0, 'invalid': 0, 'failed': 0}
                       for d in ('ohlc', 'flow')}
        self.sources, self.failures = {}, []

    def measured(self, key, fn):
        started = time.perf_counter()
        try:
            return fn()
        finally:
            self.timings[key] += time.perf_counter() - started

    def read(self, code, domain):
        flow = domain == 'flow'
        fields = ('close', 'change_pct', 'ind_net', 'foreign_net', 'inst_net') if flow else (
            'open', 'high', 'low', 'close', 'volume')
        load = db_schema.load_investor_flow_daily if flow else db_schema.load_daily_prices
        evidence = {'source': 'sqlite-existing'}
        rows = []
        try:
            rows = self.measured('dbRead', lambda: load(self.conn, code))
            if valid_rows(rows, self.basis, fields, flow):
                self.counts[domain]['dbReuse'] += 1
                return rows
            self.counts[domain]['requests'] += 1
            try:
                if flow:
                    rows, evidence = self.measured('flowApi', lambda: kiwoom_market.fetch_confirmed_scan_flow(
                        self.token, code, self.basis, self.kis_key, self.kis_secret))
                else:
                    rows = self.measured('ohlcApi', lambda: kiwoom_market.fetch_daily_ohlc(
                        self.token, code, max_days=kiwoom_market.OHLC_SNAPSHOT_DAYS))
                    evidence = {'source': 'kiwoom-adjusted'}
            finally:
                # Preserve the existing 0.25s pacing, also after failed calls.
                self.measured('throttle', lambda: time.sleep(self.throttle))
            source = evidence['source']
            self.sources[source] = self.sources.get(source, 0) + 1
            if not valid_rows(rows, self.basis, fields, flow):
                latest = (rows[0] if flow else rows[-1]).get('date') if rows else None
                state = 'stale' if latest and latest < self.basis else 'invalid'
                self.record(code, domain, state, latest, source)
                return []

            def save():
                if flow:
                    db_schema.upsert_investor_flow_daily(self.conn, code, rows)
                else:
                    self.save_ohlc(self.conn, code, rows)
                self.conn.commit()
            self.measured('flowSave' if flow else 'ohlcSave', save)
            self.counts[domain]['fresh'] += 1
            return rows
        except Exception as error:
            self.conn.rollback()
            # Do not serialize provider exception text (may include credentials).
            self.record(code, domain, 'failed', None, evidence['source'], type(error).__name__)
            return []

    def record(self, code, domain, state, latest, source, error=None):
        self.counts[domain][state] += 1
        self.failures.append({'code': code, 'domain': domain, 'state': state,
                              'dataDate': latest, 'source': source, 'errorType': error})
        # One bounded journal record per failure also survives a failed full run.
        print('[scan-input] ' + json.dumps(self.failures[-1]), flush=True)

    def summary(self):
        return {'version': 1, 'dataDate': self.basis, 'domains': self.counts,
                'sources': self.sources, 'failures': self.failures,
                'timingsSec': {k: round(v, 3) for k, v in self.timings.items()}}
