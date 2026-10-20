"""Require the completed same-session daily source before downstream scans."""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import market_clock

KST = timezone(timedelta(hours=9))


def assess(now, generated_at, is_trading_day):
    now = now.astimezone(KST)
    basis = now if now.hour >= 20 else now - timedelta(days=1)
    basis_date = basis.date()
    if not is_trading_day(basis):
        return 'holiday', basis_date.isoformat()
    try:
        generated = datetime.fromisoformat(str(generated_at).replace('Z', '+00:00'))
        if generated.tzinfo is None:
            generated = generated.replace(tzinfo=timezone.utc)
        actual = generated.astimezone(KST).date()
    except (ValueError, TypeError):
        return 'missing', basis_date.isoformat()
    return ('ready' if actual == basis_date else 'stale'), basis_date.isoformat()


def main():
    path = os.path.join(os.path.dirname(__file__), 'daily_scan_cache.json')
    try:
        with open(path, encoding='utf-8') as stream:
            generated_at = json.load(stream).get('generatedAt')
    except (OSError, ValueError):
        generated_at = None
    outcome, basis = assess(datetime.now(KST), generated_at, market_clock.is_kr_trading_day)
    print('[scan-prereq] state=%s dataDate=%s generatedAt=%s' % (outcome, basis, generated_at), flush=True)
    return 0 if outcome == 'ready' else 3 if outcome == 'holiday' else 75


if __name__ == '__main__':
    raise SystemExit(main())
