# -*- coding: utf-8 -*-
"""한국투자증권 공개 종목 마스터(kospi_code.mst / kosdaq_code.mst) 행 파서. 키·인증 없음.

build_dcf_data.refresh_markets, build_scanner_security_data.parse_master와 같은 공급자·
같은 고정폭 레이아웃(꼬리 길이 KOSPI 228 / KOSDAQ 222, 앞 21자 = 단축코드 9 + 표준코드 12)을 쓴다.
두 스크립트는 각자의 출력(시장 구분, 스팩 플래그)에 맞춰 인라인으로 파싱하므로 건드리지 않고,
이 모듈은 '코드·이름·종목군' 목록이 필요한 종목 등록 동기화 전용이다.

종목군(꼬리 앞 2자): ST 주권, EF ETF, RT 리츠, IF 인프라, MF 투자회사, DR 예탁증서,
FS 외국주권, PF 우선주 등. ETN은 이 파일에 없다(종목군 0개, 2026-11-21 실측).
"""
import io
import re
import urllib.request
import zipfile

BASE_URL = 'https://new.real.download.dws.co.kr/common/master/'
TAIL = {'KOSPI': 228, 'KOSDAQ': 222}
CODE = re.compile(r'[0-9A-Z]{6}')


def parse_rows(text, market):
    """[{code, name, group, market}] — 코드 형식이 아닌 행은 건너뛰고 중복 코드는 오류로 본다."""
    tail = TAIL[market]
    rows, seen = [], set()
    for row in text.replace('\r\n', '\n').splitlines(keepends=True):
        code = row[:9].strip()
        if not CODE.fullmatch(code):
            continue
        if len(row) < 21 + tail:
            raise ValueError('truncated KIS master row: ' + code)
        if code in seen:
            raise ValueError('duplicate KIS master code: ' + code)
        seen.add(code)
        name = row[21:-tail].strip()
        if not name:
            raise ValueError('empty name in KIS master: ' + code)
        rows.append({'code': code, 'name': name, 'group': row[-tail:][:2], 'market': market})
    return rows


def fetch_market(market, timeout=40):
    name = market.lower() + '_code.mst'
    req = urllib.request.Request(BASE_URL + name + '.zip', headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        raw = response.read()
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        return parse_rows(archive.read(name).decode('cp949'), market)


def fetch_all():
    rows = []
    for market in ('KOSPI', 'KOSDAQ'):
        rows.extend(fetch_market(market))
    return rows
