# -*- coding: utf-8 -*-
"""DART(금융감독원 전자공시) OpenAPI 클라이언트 - 종목코드<->corp_code 매핑 + 재무제표 조회.
kiwoom_client.py와 동일하게 외부 의존성 없이 urllib만 사용."""

import io
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

BASE_URL = 'https://opendart.fss.or.kr/api'
CORP_CODE_MAP_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dart_corp_code_map.json')
CORP_CODE_MAP_TTL_SEC = 7 * 24 * 3600  # 7일 - corp_code는 거의 안 바뀌는 정적 데이터


def _fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError('DART HTTP %s: %s' % (e.code, e.read().decode('utf-8', 'ignore')))


def _download_corp_code_map(api_key):
    """corpCode.xml(zip) 전체(상장+비상장 118000여개)를 받아 stock_code가 있는
    상장사만 {6자리 종목코드: 8자리 corp_code}로 걸러낸다."""
    url = BASE_URL + '/corpCode.xml?' + urllib.parse.urlencode({'crtfc_key': api_key})
    raw = _fetch(url)
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        xml_bytes = z.read(z.namelist()[0])
    root = ET.fromstring(xml_bytes)
    mapping = {}
    for item in root.findall('list'):
        stock_code = (item.findtext('stock_code') or '').strip()
        corp_code = (item.findtext('corp_code') or '').strip()
        if stock_code and corp_code:
            mapping[stock_code] = corp_code
    return mapping


def get_corp_code_map(api_key):
    """로컬 캐시(dart_corp_code_map.json)가 7일 이내면 그대로 쓰고, 아니면 재다운로드."""
    if os.path.exists(CORP_CODE_MAP_FILE):
        age = time.time() - os.path.getmtime(CORP_CODE_MAP_FILE)
        if age < CORP_CODE_MAP_TTL_SEC:
            with open(CORP_CODE_MAP_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
    mapping = _download_corp_code_map(api_key)
    with open(CORP_CODE_MAP_FILE, 'w', encoding='utf-8') as f:
        json.dump(mapping, f, ensure_ascii=False)
    return mapping


def call_fnltt(api_key, corp_code, bsns_year, reprt_code, fs_div='CFS'):
    """전체 재무제표 조회(fnlttSinglAcntAll). 데이터 없음(status 013)은 빈 리스트로
    정상 처리(사업보고서 미제출 소형주 등) - 그 외 에러 status는 예외를 던진다."""
    params = {
        'crtfc_key': api_key,
        'corp_code': corp_code,
        'bsns_year': str(bsns_year),
        'reprt_code': reprt_code,
        'fs_div': fs_div,
    }
    url = BASE_URL + '/fnlttSinglAcntAll.json?' + urllib.parse.urlencode(params)
    data = json.loads(_fetch(url).decode('utf-8'))
    status = data.get('status')
    if status == '013':  # 조회된 데이터가 없습니다
        return []
    if status != '000':
        raise RuntimeError('DART fnlttSinglAcntAll status %s: %s' % (status, data.get('message')))
    return data.get('list') or []
