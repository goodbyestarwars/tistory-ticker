# -*- coding: utf-8 -*-
"""User-managed sector card configuration helpers.

The public shape intentionally stays compatible with ``window.SECTOR_MAP``:
{category_name: [{name, code, market}, ...]}.
"""

import os
import re


CODE_RE = re.compile(r'^[0-9A-Za-z]{6}$')
SECTOR_RE = re.compile(r'"([^"]+)"\s*:\s*\[([\s\S]*?)\]')
STOCK_RE = re.compile(
    r'name:\s*"([^"]+)"\s*,\s*'
    r'code:\s*"([0-9A-Za-z]{6})"\s*,\s*'
    r'market:\s*"([^"]+)"'
)


class SectorConfigError(ValueError):
    """Raised when a sector configuration is malformed."""


def normalize_sector_map(value):
    """Validate and normalize a client-provided sector map."""
    if isinstance(value, dict) and 'sectors' in value:
        value = value['sectors']
    if not isinstance(value, dict) or not value:
        raise SectorConfigError('sectors must be a non-empty object')

    result = {}
    if len(value) > 100:
        raise SectorConfigError('too many categories')

    for raw_category, raw_stocks in value.items():
        category = str(raw_category).strip()
        if not category or len(category) > 100:
            raise SectorConfigError('category name must be 1-100 characters')
        if not isinstance(raw_stocks, list) or len(raw_stocks) > 200:
            raise SectorConfigError('category stocks must be an array of at most 200 items')

        stocks = []
        seen_codes = set()
        for raw_stock in raw_stocks:
            if not isinstance(raw_stock, dict):
                raise SectorConfigError('stock entries must be objects')
            name = str(raw_stock.get('name', '')).strip()
            code = str(raw_stock.get('code', '')).strip().upper()
            market = str(raw_stock.get('market', '')).strip().upper()
            if not name or len(name) > 100:
                raise SectorConfigError('stock name must be 1-100 characters')
            if not CODE_RE.fullmatch(code):
                raise SectorConfigError('stock code must be 6 alphanumeric characters')
            if market not in ('KOSPI', 'KOSDAQ'):
                raise SectorConfigError('market must be KOSPI or KOSDAQ')
            if code in seen_codes:
                raise SectorConfigError('duplicate stock code in category: ' + code)
            seen_codes.add(code)
            stocks.append({'name': name, 'code': code, 'market': market})
        result[category] = stocks

    return result


def _static_sector_file_candidates():
    here = os.path.dirname(os.path.abspath(__file__))
    return [
        os.path.join(here, '..', '..', 'data', 'sectors-v3.js'),
        os.path.join(here, 'data', 'sectors-v3.js'),
    ]


def load_static_sector_map():
    """Load the current checked-in map for the first DB migration only."""
    path = next((p for p in _static_sector_file_candidates() if os.path.exists(p)), None)
    if not path:
        raise SectorConfigError('static sectors-v3.js is not available for DB seeding')

    with open(path, 'r', encoding='utf-8') as source:
        text = source.read()

    parsed = {}
    for category_match in SECTOR_RE.finditer(text):
        category = category_match.group(1)
        block = category_match.group(2)
        stocks = [
            {'name': match.group(1), 'code': match.group(2), 'market': match.group(3)}
            for match in STOCK_RE.finditer(block)
        ]
        parsed[category] = stocks

    return normalize_sector_map(parsed)
