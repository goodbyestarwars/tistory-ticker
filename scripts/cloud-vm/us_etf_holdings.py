"""Licensed ETF snapshots only. No issuer scraping or unlicensed persistence.

A future licensed provider writes atomic normalized snapshots to the configured
server directory. Rights are checked before reading/returning any holdings.
See docs/US_ETF_DATA.md for the contract. Disabled without an explicit config.
"""
import json
import math
import os
import re
import time
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

_CACHE = {}
# Issuer directories, not symbol-specific portfolio mappings.
ISSUERS = (
    (('ROUNDHILL',), 'Roundhill', 'https://www.roundhillinvestments.com/etf/'),
    (('SPDR', 'STATE STREET'), 'State Street', 'https://www.ssga.com/us/en/individual/etfs'),
    (('INVESCO',), 'Invesco', 'https://www.invesco.com/us/en/solutions/invesco-etfs.html'),
    (('ISHARES',), 'iShares', 'https://www.ishares.com/us/products/etf-investments'),
)


def _https(value):
    parsed = urlsplit(str(value or ''))
    return parsed.scheme == 'https' and bool(parsed.hostname) and not parsed.username and not parsed.password


def get_holdings(symbol, instrument):
    result = {'status': 'pending', 'message': '구성종목 데이터 준비 중',
              'holdings': [], 'total_count': None, 'as_of': None,
              'source': None, 'source_url': None, 'issuer_url': None,
              'notice': '재게시 이용 권한이 확인된 자료만 제공합니다. 현물 보유와 파생상품의 실질 노출은 다를 수 있습니다.'}
    name = (str(instrument.get('name') or '') + str(instrument.get('issuer_hint') or '')).upper().replace(' ', '')
    for tokens, issuer, url in ISSUERS:
        if any(token.replace(' ', '') in name for token in tokens):
            result.update(issuer=issuer, issuer_url=url)
            break
    root = os.environ.get('US_ETF_LICENSED_SNAPSHOT_DIR', '').strip()
    if not root or not re.fullmatch(r'[A-Z0-9.\-]{1,12}', symbol):
        return result
    # An independently configured license manifest must authorize public display.
    # Never read a holdings file until that manifest is validated.
    try:
        directory = Path(root).resolve()
        manifest_path = directory / 'license.json'
        if manifest_path.stat().st_size > 65536:
            return result
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        today = date.today()
        if (manifest.get('public_display_allowed') is not True or
                manifest.get('storage_allowed') is not True or
                not manifest.get('license_reference') or
                date.fromisoformat(manifest['expires_on']) < today or
                not _https(manifest.get('source_url'))):
            return result
        path = directory / (symbol + '.json')
        if path.is_symlink() or path.stat().st_size > 2_000_000:
            return result
        stamp = (manifest_path.stat().st_mtime_ns, path.stat().st_mtime_ns)
        cached = _CACHE.get(symbol)
        if cached and cached[0] == (str(directory), stamp) and time.time() - cached[1] < 3600:
            return dict(cached[2], issuer_url=result['issuer_url'])
        snapshot = json.loads(path.read_text(encoding='utf-8'))
        as_of = date.fromisoformat(snapshot['as_of'])
        if as_of > today or (today - as_of).days > int(manifest.get('max_age_days', 95)):
            return result
        rows = snapshot['holdings']
        if not isinstance(rows, list) or not rows or len(rows) > 20000 or snapshot.get('symbol') != symbol:
            return result
        normalized = []
        for row in rows:
            kind = row.get('kind')
            weight = row.get('weight_percent')
            if (not isinstance(row.get('name'), str) or not row['name'] or
                    kind not in ('equity', 'cash', 'derivative', 'other') or
                    isinstance(weight, bool) or not isinstance(weight, (int, float)) or not math.isfinite(weight) or
                    row.get('basis') not in ('holding_value', 'economic_exposure')):
                return result
            normalized.append({key: row.get(key) for key in
                               ('name', 'ticker', 'weight_percent', 'kind', 'basis', 'country')})
        # Do not normalize weights: derivatives, shorts and cash may not sum to 100%.
        normalized.sort(key=lambda row: row['weight_percent'], reverse=True)
        result.update(status='ready', message='', holdings=normalized,
                      total_count=len(normalized), as_of=as_of.isoformat(),
                      source=manifest.get('provider'), source_url=manifest['source_url'])
        if len(_CACHE) >= 4:
            _CACHE.pop(next(iter(_CACHE)))
        _CACHE[symbol] = ((str(directory), stamp), time.time(), result.copy())
    except (OSError, ValueError, KeyError, TypeError, OverflowError):
        pass
    return result
