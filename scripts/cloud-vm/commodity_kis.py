# -*- coding: utf-8 -*-
"""검증된 ICE 브렌트유 시세. KIS 상품 마스터로 근월물을 확인한다."""

import io
import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timedelta, timezone

import kis_client

log = logging.getLogger(__name__)
MASTER_URL = 'https://new.real.download.dws.co.kr/common/master/ffcode.mst.zip'
KST = timezone(timedelta(hours=9))
_master = {'code': None, 'checked': 0}


def front_brent_code():
    """공식 ffcode.mst의 ICE BRN 최근월물 플래그를 따른다."""
    if _master['code'] and time.time() - _master['checked'] < 12 * 3600:
        return _master['code']
    request = urllib.request.Request(MASTER_URL, headers={'User-Agent': '9Pay-market-indicators/1.0'})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            archive = response.read(3_000_000)
        with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
            lines = zipped.read('ffcode.mst').decode('cp949').splitlines()
        candidates = []
        for line in lines:
            code = line[:32].strip()
            exchange = line[-92:-82].strip()
            name = line[82:107].strip()
            recent = line[-6:-5]
            if exchange == 'ICE' and code.startswith('BRN') and not code.startswith('BRNT') and recent == '1' and name.startswith('Brent Crude-'):
                candidates.append(code)
        if len(candidates) != 1:
            raise ValueError('ICE Brent recent-month contract count: %s' % len(candidates))
        _master.update(code=candidates[0], checked=time.time())
        return candidates[0]
    except Exception:
        log.exception('KIS Brent master unavailable')
        return _master['code']


def _request(path, tr_id, params):
    key = os.environ.get('KIS_APPKEY', '').strip()
    secret = os.environ.get('KIS_APPSECRET', '').strip()
    if not key or not secret:
        return None

    def call(token):
        url = kis_client.BASE_URL + path + '?' + urllib.parse.urlencode(params)
        request = urllib.request.Request(url, headers={
            'authorization': 'Bearer ' + token, 'appkey': key, 'appsecret': secret,
            'tr_id': tr_id, 'content-type': 'application/json; charset=utf-8',
        })
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                data = json.load(response)
        except urllib.error.HTTPError as error:
            # KIS 권한 실패 응답이 JSON이 아닌 형태로 올 수 있다. 비밀값은 로그에 남기지 않는다.
            raise RuntimeError('KIS Brent HTTP %s' % error.code) from None
        if data.get('rt_cd') != '0':
            raise RuntimeError('KIS Brent API %s' % data.get('msg_cd'))
        return data

    token = kis_client.get_token(key, secret)
    return kis_client._with_token_retry(call, token, key, secret)


def fetch_price(code):
    data = _request('/uapi/overseas-futureoption/v1/quotations/inquire-price',
                    'HHDFC55010000', {'SRS_CD': code})
    row = (data or {}).get('output1') or {}
    if isinstance(row, list):
        row = row[0] if row else {}
    try:
        observed = datetime.strptime(str(row['proc_date']) + str(row['proc_time']), '%Y%m%d%H%M%S').replace(tzinfo=KST)
        if not 0 <= (datetime.now(KST) - observed).total_seconds() <= 20 * 60:
            return None
        price = float(row['last_price'])
        change_rate = float(row['prev_diff_rate'])
        change = price - float(row['prev_price'])
        high = float(row['high_price'])
        low = float(row['low_price'])
        if price <= 0 or high < low or row.get('exch_cd') != 'ICE':
            return None
    except (KeyError, TypeError, ValueError):
        return None
    return {'price': price, 'change': change, 'change_rate': change_rate,
            'high': high, 'low': low, 'observed_at': observed.astimezone(timezone.utc).isoformat()}


def fetch_daily(code, count=40):
    data = _request('/uapi/overseas-futureoption/v1/quotations/daily-ccnl',
                    'HHDFC55020100', {'SRS_CD': code, 'EXCH_CD': 'ICE',
                    'START_DATE_TIME': '', 'CLOSE_DATE_TIME': datetime.now(KST).strftime('%Y%m%d'),
                    'QRY_TP': 'Q', 'QRY_CNT': str(min(count, 40)), 'QRY_GAP': '', 'INDEX_KEY': ''})
    rows = []
    for row in (data or {}).get('output2') or []:
        try:
            item = {'date': row['data_date'], 'open': float(row['open_price']),
                    'high': float(row['high_price']), 'low': float(row['low_price']),
                    'close': float(row['last_price'])}
            if len(item['date']) == 8 and item['close'] > 0 and item['high'] >= item['low']:
                rows.append(item)
        except (KeyError, TypeError, ValueError):
            continue
    return rows
