# -*- coding: utf-8 -*-
"""Google 계정별 차트 도형(직선·동그라미·연필·박스·가로선) 검증.

2026-10-10 사용자 요청("로그인 기반으로 저장"). 저장소는 새로 만들지 않고 메모(user_memos)와 같은
구글 로그인 + 사용자별 행 + revision 낙관적 동시성 패턴을 쓴다. 종목·봉 주기(day/week/month)마다 한 행.
자동 파동(실험)은 저장하지 않는다(브라우저에서 매번 계산).

용량 상한(e2-micro·SQLite 보호): 행당 JSON 64KB, 도형 종류별 개수, 연필 점 수, 사용자당 행 수.
"""
import json
import math
import re

TIMEFRAMES = ('day', 'week', 'month')
MAX_ROW_BYTES = 64 * 1024
MAX_ROWS_PER_USER = 600
MAX_PER_KIND = {'lines': 200, 'circles': 200, 'boxes': 200, 'hlines': 100, 'paths': 100}
MAX_PATH_POINTS = 400
MAX_LABEL = 20
_CODE_RE = re.compile(r'^[A-Za-z0-9._-]{1,20}$')
_POINT_KEYS = ('time', 'price', 'logical', 'anchorTime', 'logicalOffset')


class ChartDrawingsError(ValueError):
    """Raised when a drawings payload is malformed or too large."""


def normalize_code(value):
    code = str(value or '').strip().upper()
    if not _CODE_RE.match(code):
        raise ChartDrawingsError('code must be 1-20 characters of A-Z, 0-9, ., _ or -')
    return code


def normalize_timeframe(value):
    timeframe = str(value or '').strip().lower()
    if timeframe not in TIMEFRAMES:
        raise ChartDrawingsError('timeframe must be one of day, week, month')
    return timeframe


def _number(value, name):
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ChartDrawingsError(name + ' must be a number') from exc
    if not math.isfinite(number) or abs(number) > 1e12:
        raise ChartDrawingsError(name + ' is out of range')
    return number


def _point(raw):
    if not isinstance(raw, dict):
        raise ChartDrawingsError('points must be objects')
    point = {}
    if raw.get('time') is not None:
        text = str(raw['time'])
        if len(text) > 24:
            raise ChartDrawingsError('point time is too long')
        point['time'] = text
    point['price'] = _number(raw.get('price'), 'point price')
    for key in ('logical', 'logicalOffset'):
        if raw.get(key) is not None:
            point[key] = _number(raw[key], key)
    if raw.get('anchorTime') is not None:
        text = str(raw['anchorTime'])
        if len(text) > 24:
            raise ChartDrawingsError('anchorTime is too long')
        point['anchorTime'] = text
    if 'time' not in point and 'logical' not in point:
        raise ChartDrawingsError('point needs time or logical')
    return point


def _shape(raw):
    if not isinstance(raw, dict):
        raise ChartDrawingsError('shapes must be objects')
    shape = {'start': _point(raw.get('start')), 'end': _point(raw.get('end'))}
    label = raw.get('label')
    if label:
        shape['label'] = str(label)[:MAX_LABEL]
    return shape


def normalize_drawings(value):
    if value is None:
        value = {}
    if not isinstance(value, dict):
        raise ChartDrawingsError('drawings must be an object')
    out = {}
    for kind, limit in MAX_PER_KIND.items():
        items = value.get(kind, [])
        if not isinstance(items, list):
            raise ChartDrawingsError(kind + ' must be an array')
        if len(items) > limit:
            raise ChartDrawingsError('%s must have at most %d items' % (kind, limit))
        if kind in ('lines', 'circles', 'boxes'):
            out[kind] = [_shape(item) for item in items]
        elif kind == 'hlines':
            hlines = []
            for item in items:
                if not isinstance(item, dict):
                    raise ChartDrawingsError('hlines must be objects')
                price = _number(item.get('price'), 'hline price')
                if price <= 0:
                    raise ChartDrawingsError('hline price must be positive')
                hlines.append({'price': price})
            out[kind] = hlines
        else:
            paths = []
            for path in items:
                if not isinstance(path, list) or len(path) > MAX_PATH_POINTS:
                    raise ChartDrawingsError('paths must be arrays of at most %d points' % MAX_PATH_POINTS)
                paths.append([_point(point) for point in path])
            out[kind] = paths
    size = len(json.dumps(out, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
    if size > MAX_ROW_BYTES:
        raise ChartDrawingsError('drawings are too large (%d bytes, max %d)' % (size, MAX_ROW_BYTES))
    return out


def is_empty(drawings):
    return not any(drawings.get(kind) for kind in MAX_PER_KIND)
