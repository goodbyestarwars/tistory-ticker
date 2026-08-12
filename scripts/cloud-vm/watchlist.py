# -*- coding: utf-8 -*-
"""Google account-owned watchlist configuration validation."""

import re
import math


DOMESTIC_CODE_RE = re.compile(r'^[0-9A-Za-z]{6}$')
US_CODE_RE = re.compile(r'^US:[A-Z][A-Z0-9.\-^=]{0,11}$')
DEFAULT_GROUP_ID = 'default'
DEFAULT_GROUP_NAME = '기본'
MAX_ITEMS = 50
MAX_GROUPS = 50
MAX_HOLDING_VALUE = 10 ** 15


class WatchlistConfigError(ValueError):
    """Raised when a watchlist payload is malformed."""


def empty_config():
    return {
        'items': [],
        'groups': [{'id': DEFAULT_GROUP_ID, 'name': DEFAULT_GROUP_NAME, 'collapsed': False}],
    }


def normalize_config(value):
    if not isinstance(value, dict):
        raise WatchlistConfigError('watchlist must be an object')

    raw_groups = value.get('groups', [])
    if not isinstance(raw_groups, list) or len(raw_groups) > MAX_GROUPS:
        raise WatchlistConfigError('groups must be an array of at most 50 items')

    groups = []
    seen_group_ids = set()
    for raw_group in raw_groups:
        if not isinstance(raw_group, dict):
            raise WatchlistConfigError('group entries must be objects')
        group_id = str(raw_group.get('id', '')).strip()
        name = str(raw_group.get('name', '')).strip()
        if not group_id or len(group_id) > 64:
            raise WatchlistConfigError('group id must be 1-64 characters')
        if not name or len(name) > 40:
            raise WatchlistConfigError('group name must be 1-40 characters')
        if group_id in seen_group_ids:
            raise WatchlistConfigError('duplicate group id: ' + group_id)
        seen_group_ids.add(group_id)
        groups.append({
            'id': group_id,
            'name': name,
            'collapsed': bool(raw_group.get('collapsed', False)),
        })

    if DEFAULT_GROUP_ID not in seen_group_ids:
        groups.insert(0, {'id': DEFAULT_GROUP_ID, 'name': DEFAULT_GROUP_NAME, 'collapsed': False})
        seen_group_ids.add(DEFAULT_GROUP_ID)

    raw_items = value.get('items', [])
    if not isinstance(raw_items, list) or len(raw_items) > MAX_ITEMS:
        raise WatchlistConfigError('items must be an array of at most 50 items')

    items = []
    seen_codes = set()
    for raw_item in raw_items:
        if not isinstance(raw_item, dict):
            raise WatchlistConfigError('watchlist items must be objects')
        code = str(raw_item.get('code', '')).strip().upper()
        name = str(raw_item.get('name', '')).strip()
        group_id = str(raw_item.get('groupId', DEFAULT_GROUP_ID)).strip() or DEFAULT_GROUP_ID
        if not (DOMESTIC_CODE_RE.fullmatch(code) or US_CODE_RE.fullmatch(code)):
            raise WatchlistConfigError('stock code must be a 6-character domestic code or US:ticker')
        if not name or len(name) > 100:
            raise WatchlistConfigError('stock name must be 1-100 characters')
        if code in seen_codes:
            raise WatchlistConfigError('duplicate stock code: ' + code)
        if group_id not in seen_group_ids:
            raise WatchlistConfigError('unknown group id: ' + group_id)
        seen_codes.add(code)
        holding = raw_item.get('holding') or {}
        if not isinstance(holding, dict):
            raise WatchlistConfigError('holding must be an object')
        quantity = holding.get('quantity', 0)
        average_price = holding.get('averagePrice', 0)
        try:
            quantity = float(quantity or 0)
            average_price = float(average_price or 0)
        except (TypeError, ValueError) as exc:
            raise WatchlistConfigError('holding values must be numbers') from exc
        if not (math.isfinite(quantity) and math.isfinite(average_price)):
            raise WatchlistConfigError('holding values must be finite')
        if quantity < 0 or average_price < 0:
            raise WatchlistConfigError('holding values must be non-negative')
        if quantity > MAX_HOLDING_VALUE or average_price > MAX_HOLDING_VALUE:
            raise WatchlistConfigError('holding values are too large')
        items.append({
            'code': code,
            'name': name,
            'groupId': group_id,
            'holding': {
                'quantity': quantity,
                'averagePrice': average_price,
            },
        })

    return {'items': items, 'groups': groups}
