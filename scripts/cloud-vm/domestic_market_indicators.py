# -*- coding: utf-8 -*-
"""Domestic market dashboard data providers.

The public endpoint deliberately keeps provider selection in one place:
Kiwoom index candles first, KIS index candles second, and Naver as the last
resort.  Investor flow uses the existing background collector because it
already maintains the three participant buckets.  Market funds prefer the
KIS market-funds API and fall back to the public KOFIA/Naver-compatible feed.
"""

import logging
import math
from datetime import datetime, timedelta, timezone

import domestic_futures
import investor_trend
import kis_client
import kiwoom_client
import public_data

logger = logging.getLogger('domestic_market_indicators')
KST = timezone(timedelta(hours=9))

MARKETS = {
    'KOSPI': {'name': '코스피', 'kiwoom_code': '001', 'kis_code': '0001'},
    'KOSDAQ': {'name': '코스닥', 'kiwoom_code': '101', 'kis_code': '1001'},
}
INTERVALS = ('minute', 'day', 'week')


def _number(value):
    if value is None or value == '':
        return None
    try:
        value = float(str(value).replace(',', '').replace('+', ''))
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def _first(row, *keys):
    for key in keys:
        if row.get(key) not in (None, ''):
            return row.get(key)
    return None


def _date(value):
    text = str(value or '').strip().replace('-', '').replace('.', '')
    if len(text) >= 8 and text[:8].isdigit():
        return '%s-%s-%s' % (text[:4], text[4:6], text[6:8])
    return None


def _timestamp(value):
    text = str(value or '').strip().replace('-', '').replace(':', '').replace(' ', '')
    if len(text) < 12 or not text[:12].isdigit():
        return None
    try:
        return int(datetime.strptime(text[:14], '%Y%m%d%H%M%S').replace(tzinfo=KST).timestamp())
    except ValueError:
        return None


def _candle(row, minute=False):
    date_value = _first(row, 'dt', 'stck_bsop_date', 'date', 'localDate')
    time_value = _first(row, 'cntr_tm', 'stck_cntg_hour', 'time', 'localDateTime')
    point = {
        'open': _number(_first(row, 'open_pric', 'stck_oprc', 'bstp_nmix_oprc', 'openPrice')),
        'high': _number(_first(row, 'high_pric', 'stck_hgpr', 'bstp_nmix_hgpr', 'highPrice')),
        'low': _number(_first(row, 'low_pric', 'stck_lwpr', 'bstp_nmix_lwpr', 'lowPrice')),
        'close': _number(_first(row, 'cur_prc', 'stck_clpr', 'bstp_nmix_prpr', 'closePrice', 'currentPrice')),
        'volume': _number(_first(row, 'trde_qty', 'acml_vol', 'acc_trde_qty', 'volume')) or 0,
    }
    if any(point[key] is None for key in ('open', 'high', 'low', 'close')):
        return None
    if minute:
        point['ts'] = _number(row.get('ts')) or _timestamp(time_value or date_value)
        if point['ts'] is None:
            return None
    else:
        point['date'] = _date(date_value or time_value)
        if not point['date']:
            return None
    return point


def _sort_rows(rows, minute=False, limit=600):
    unique = {}
    for row in rows or []:
        point = _candle(row, minute=minute)
        if not point:
            continue
        key = point['ts'] if minute else point['date']
        unique[key] = point
    result = [unique[key] for key in sorted(unique)]
    return result[-limit:]


def _fetch_kiwoom(token, market, interval):
    cfg = MARKETS[market]
    if interval == 'minute':
        api_id = 'ka20005'
        body = {
            'inds_cd': cfg['kiwoom_code'],
            'tic_scope': '1',
            'base_dt': datetime.now(KST).strftime('%Y%m%d'),
        }
        rows_key = 'inds_min_pole_qry'
        minute = True
    elif interval == 'day':
        api_id = 'ka20006'
        body = {'inds_cd': cfg['kiwoom_code'], 'base_dt': datetime.now(KST).strftime('%Y%m%d')}
        rows_key = 'inds_dt_pole_qry'
        minute = False
    else:
        api_id = 'ka20007'
        body = {'inds_cd': cfg['kiwoom_code'], 'base_dt': datetime.now(KST).strftime('%Y%m%d')}
        rows_key = 'inds_stk_pole_qry'
        minute = False
    response = kiwoom_client.call_tr(token, api_id, '/api/dostk/chart', body)
    rows = response.get(rows_key) or []
    points = _sort_rows(rows, minute=minute, limit=900 if minute else 600)
    if len(points) < 2:
        raise RuntimeError('%s returned too few %s candles' % (api_id, market))
    return points


def _fetch_kis(token, appkey, appsecret, market, interval):
    code = MARKETS[market]['kis_code']
    if interval == 'minute':
        _, rows = kis_client.fetch_index_time_chart(token, appkey, appsecret, code, '60')
        return _sort_rows(rows, minute=True, limit=900)
    start = (datetime.now(KST) - timedelta(days=900)).strftime('%Y%m%d')
    end = datetime.now(KST).strftime('%Y%m%d')
    _, rows = kis_client.fetch_index_period_chart(
        token, appkey, appsecret, code, start, end, 'W' if interval == 'week' else 'D')
    return _sort_rows(rows, minute=False, limit=600)


def _fetch_naver(market, interval):
    symbol = market
    if interval == 'minute':
        rows = domestic_futures.fetch_domestic_index_chart_minute('index', symbol, days=3)
        return _sort_rows(rows, minute=True, limit=900)
    rows = domestic_futures.fetch_domestic_index_chart('index', symbol, days=900)
    points = _sort_rows(rows, minute=False, limit=600)
    if interval == 'week':
        # Naver's index endpoint is daily; aggregate it into the same weekly
        # candle shape used by the provider APIs.
        buckets = {}
        for item in points:
            d = datetime.strptime(item['date'], '%Y-%m-%d')
            monday = (d - timedelta(days=d.weekday())).strftime('%Y-%m-%d')
            bucket = buckets.setdefault(monday, {'date': monday, 'open': item['open'], 'high': item['high'], 'low': item['low'], 'close': item['close'], 'volume': 0})
            bucket['high'] = max(bucket['high'], item['high'])
            bucket['low'] = min(bucket['low'], item['low'])
            bucket['close'] = item['close']
            bucket['volume'] += item.get('volume') or 0
        points = list(buckets.values())[-600:]
    return points


def fetch_chart(token, kis_appkey, kis_appsecret, market, interval):
    errors = []
    if token:
        try:
            return {'source': 'kiwoom', 'rows': _fetch_kiwoom(token, market, interval), 'errors': []}
        except Exception as exc:
            errors.append('kiwoom: %s' % exc)
    if kis_appkey and kis_appsecret:
        try:
            kis_token = kis_client.get_token(kis_appkey, kis_appsecret)
            return {'source': 'kis', 'rows': _fetch_kis(kis_token, kis_appkey, kis_appsecret, market, interval), 'errors': errors}
        except Exception as exc:
            errors.append('kis: %s' % exc)
    try:
        return {'source': 'naver', 'rows': _fetch_naver(market, interval), 'errors': errors}
    except Exception as exc:
        errors.append('naver: %s' % exc)
        return {'source': None, 'rows': [], 'errors': errors}


def _normalise_investor(result):
    rows = []
    for row in (result or {}).get('rows') or []:
        rows.append({
            'label': row.get('label'),
            'individual': _number(row.get('ind')),
            'foreign': _number(row.get('frgn')),
            'institution': _number(row.get('orgn')),
        })
    return rows


def fetch_investor():
    data = {}
    for market in MARKETS:
        try:
            result = investor_trend.get_result('day', market.lower())
        except Exception as exc:
            logger.warning('investor trend unavailable for %s: %s', market, exc)
            result = {'asOf': None, 'rows': []}
        data[market] = {
            'source': 'kiwoom/kis/naver background collector',
            'asOf': result.get('asOf'),
            'rows': _normalise_investor(result),
        }
    return data


def _number_from_candidates(row, keys):
    for key in keys:
        value = _number(row.get(key))
        if value is not None:
            return value
    return None


def _normalise_kis_funds(rows):
    result = []
    for row in rows or []:
        date_value = _date(_first(row, 'stck_bsop_date', 'bas_dt', 'date', 'data_dt'))
        credit = _number_from_candidates(row, ('crd_tr_fing_whl', 'crdtr_fing_whl', 'crd_tr_fing', 'loan_total', 'crdt_fing_amt'))
        deposits = _number_from_candidates(row, ('invr_dpsg_amt', 'invr_dpsg', 'customer_deposit', 'cus_dpsg_amt'))
        if date_value and (credit is not None or deposits is not None):
            result.append({'date': date_value, 'credit': credit, 'market_funds': {'date': date_value, 'investor_deposits': deposits}})
    return result


def _fetch_kis_funds(kis_appkey, kis_appsecret):
    if not kis_appkey or not kis_appsecret:
        return None
    token = kis_client.get_token(kis_appkey, kis_appsecret)
    rows = kis_client.fetch_market_funds(token, kis_appkey, kis_appsecret)
    normalised = _normalise_kis_funds(rows)
    if not normalised:
        return None
    latest = normalised[-1]
    return {
        'available': True,
        'source': 'kis',
        'credit_unit': 'hundred_million_krw',
        'market_funds_unit': 'hundred_million_krw',
        'latest_date': latest['date'],
        'credit': {'date': latest['date'], 'loan_total': latest.get('credit')},
        'market_funds': latest.get('market_funds'),
        'series': normalised[-90:],
    }


def fetch_funds(kis_appkey, kis_appsecret, days=60):
    try:
        data = _fetch_kis_funds(kis_appkey, kis_appsecret)
        if data:
            return data
    except Exception:
        logger.exception('KIS market funds failed; using public fallback')
    try:
        data = public_data.fetch_kofia_market(days)
        data['source'] = 'naver fallback (KOFIA public market-funds feed)'
        return data
    except Exception as exc:
        logger.warning('public market funds fallback unavailable: %s', exc)
        return {
            'available': False,
            'source': 'naver fallback',
            'message': '증시자금 데이터를 잠시 불러오지 못했습니다.',
            'series': [],
        }


def build_dashboard(kiwoom_token=None, kis_appkey=None, kis_appsecret=None):
    indices = {}
    for market, cfg in MARKETS.items():
        intervals = {}
        for interval in INTERVALS:
            intervals[interval] = fetch_chart(kiwoom_token, kis_appkey, kis_appsecret, market, interval)
        indices[market] = {'name': cfg['name'], 'intervals': intervals}
    return {
        'sourcePriority': ['kiwoom', 'kis', 'naver'],
        'indices': indices,
        'investor': fetch_investor(),
        'funds': fetch_funds(kis_appkey, kis_appsecret),
    }
