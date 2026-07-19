#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FnGuide WISE(wiseindex.com)의 WICS(Wise Industry Classification Standard, GICS를 국내
실정에 맞게 재구성한 업종분류 - 네이버/다음 증권이 쓰는 것과 같은 체계) 지수 구성종목
API에서 전 종목의 업종(대분류)/세부업종(중분류)을 받아 data/wics-map.js로 저장한다.

배경(2026-07-20): 키움 공식 업종분류(ka10100의 upName, ka10101 업종코드 리스트로 실측
확인함)는 KOSPI 기준 31개 대분류뿐이라 "전기/전자" 하나에 반도체/2차전지/가전이 다
뭉뚱그려짐 - js/foreign-flow.js의 업종 배지로 쓰기엔 너무 거칠어서 보류했었다. 사용자가
WICS의 GetIndexComponets 엔드포인트(인증 불필요, 공개)를 제안 - 실측해보니 G4530
("WICS 반도체와반도체장비")처럼 GICS 수준의 세밀한 중분류를 제공하고 전 종목(~2,800개)을
커버해서, data/sectors-v3.js(수작업 큐레이션, ~266종목)의 "업종" 부분을 대체할 수 있는
품질과 커버리지를 갖췄다.

엔드포인트: https://www.wiseindex.com/Index/GetIndexComponets?ceil_yn=0&dt=YYYYMMDD&sec_cd=코드
- 대분류 10개(G10~G55, GICS 섹터와 동일한 5단위 코드) + 그 아래 중분류(예: G45 IT 아래
  G4510/4520/4530/4535/4540) - 이 스크립트 실행 전 직접 하나씩 확인해 아래 SECTION_CODES에
  하드코딩해둠(2026-07-20 기준, 총 36개: 대분류 10 + 중분류 26). 코드 체계가 거의 안 바뀌는
  GICS 기반이라 하드코딩이 매번 전수 탐색(대분류 10 x 후보 오프셋 19 = 190회 호출)보다 훨씬
  가볍다 - 향후 WICS에 새 중분류가 생기면 이 리스트만 갱신하면 됨.
- 응답의 list[].SEC_CD/SEC_NM_KOR는 "조회한 코드가 속한 대분류"를 가리키고(예: G4530을
  조회해도 SEC_CD는 G45), list[].IDX_CD/IDX_NM_KOR가 "실제로 조회한 코드 자신의 이름"이다 -
  그래서 대분류 코드 10개를 먼저 돌려 종목별 sector(대분류)를 채우고, 그 다음 중분류 26개를
  돌려 있으면 industry(중분류)로 덮어쓴다(중분류가 없는 종목은 sector와 동일한 이름으로
  남는다 - 예: 에너지는 대분류=중분류가 사실상 같음, count 확인됨).

사용법: python scripts/fetch_wics_map.py (인증키 불필요 - 공개 엔드포인트)
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_FILE = os.path.join(REPO_ROOT, 'data', 'wics-map.js')

API_URL = 'https://www.wiseindex.com/Index/GetIndexComponets'
MAX_LOOKBACK_DAYS = 10
THROTTLE_SEC = 0.3

# 2026-07-20 실측 확인된 전체 코드(대분류 10 + 중분류 26). WICS 공식 방법론(GICS 기반)
# 문서는 https://www.wiseindex.com/About/WICS 참고.
SECTOR_CODES = ['G10', 'G15', 'G20', 'G25', 'G30', 'G35', 'G40', 'G45', 'G50', 'G55']
INDUSTRY_CODES = [
    'G1010', 'G1510', 'G2010', 'G2020', 'G2030', 'G2510', 'G2520', 'G2530', 'G2550', 'G2560',
    'G3010', 'G3020', 'G3030', 'G3510', 'G3520', 'G4010', 'G4020', 'G4030', 'G4040', 'G4050',
    'G4510', 'G4520', 'G4530', 'G4535', 'G4540', 'G5010', 'G5020', 'G5510',
]


def log(msg):
    print('[fetch_wics_map] ' + msg, flush=True)


def strip_wics_prefix(name):
    return re.sub(r'^WICS\s+', '', name or '').strip()


def fetch_components(code, dt):
    url = API_URL + '?ceil_yn=0&dt=' + dt + '&sec_cd=' + code
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode('utf-8'))


def find_valid_date():
    """WICS 지수는 휴장일에 빈 리스트를 준다 - 최근 영업일을 찾을 때까지 하루씩 물러난다."""
    cursor = datetime.now()
    for _ in range(MAX_LOOKBACK_DAYS):
        dt = cursor.strftime('%Y%m%d')
        data = fetch_components('G10', dt)
        if data.get('list'):
            return dt
        cursor -= timedelta(days=1)
    raise RuntimeError('최근 %d일 내 WICS 데이터를 못 찾았습니다.' % MAX_LOOKBACK_DAYS)


def main():
    dt = find_valid_date()
    log('기준일자: %s' % dt)

    wics_map = {}  # code -> {sector, industry, name}

    for sec_cd in SECTOR_CODES:
        data = fetch_components(sec_cd, dt)
        items = data.get('list') or []
        sector_name = strip_wics_prefix(items[0]['IDX_NM_KOR']) if items else None
        for it in items:
            code = it.get('CMP_CD')
            if not code:
                continue
            wics_map[code] = {'name': it.get('CMP_KOR'), 'sector': sector_name, 'industry': sector_name}
        log('%s(%s): %d종목' % (sec_cd, sector_name, len(items)))
        time.sleep(THROTTLE_SEC)

    for ind_cd in INDUSTRY_CODES:
        data = fetch_components(ind_cd, dt)
        items = data.get('list') or []
        industry_name = strip_wics_prefix(items[0]['IDX_NM_KOR']) if items else None
        for it in items:
            code = it.get('CMP_CD')
            if not code or code not in wics_map:
                continue
            wics_map[code]['industry'] = industry_name
        log('%s(%s): %d종목' % (ind_cd, industry_name, len(items)))
        time.sleep(THROTTLE_SEC)

    # {code: {name, sector, industry}} - 프론트에서 code로 바로 조회
    out = {code: v for code, v in wics_map.items()}
    body = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
    with open(OUTPUT_FILE, 'w', encoding='utf-8', newline='\n') as f:
        f.write('window.WICS_MAP=' + body + ';')

    log('wics-map.js 작성 완료: %d종목' % len(out))


if __name__ == '__main__':
    main()
