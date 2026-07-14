# -*- coding: utf-8 -*-
"""코스피200 야간선물 종목코드 마스터파일(fo_cme_code.mst) 다운로드+파싱.
KIS 공식 파서(examples_user/stocks_info/domestic_cme_future_code.py)와 동일한 고정폭 필드 규격.
근월물(가장 가까운 미도래 만기)을 자동 선택 - 분기별 만기 롤오버를 하드코딩하지 않기 위함."""

import io
import re
import urllib.request
import zipfile
from datetime import datetime

MST_URL = 'https://new.real.download.dws.co.kr/common/master/fo_cme_code.mst.zip'


def _download_mst_text():
    req = urllib.request.Request(MST_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as res:
        zip_bytes = res.read()
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        name = zf.namelist()[0]
        return zf.read(name).decode('cp949')


def parse_outright_contracts(mst_text):
    """상품종류='1'(단순 선물, 스프레드 제외)만 {code, expiry_yyyymm} 리스트로 반환.
    고정폭 필드: 상품종류 row[0:1], 단축코드 row[1:10], 한글종목명 row[22:63]에 'F YYYYMM' 형태로
    만기월이 들어있다(실측 확인)."""
    contracts = []
    for line in mst_text.splitlines():
        if not line or line[0] != '1':
            continue
        code = line[1:10].strip()
        label = line[22:63].strip()
        m = re.search(r'(20\d{4})', label)
        if not code or not m:
            continue
        contracts.append({'code': code, 'expiry_yyyymm': int(m.group(1))})
    return contracts


def get_front_month_code():
    """가장 가까운 미도래 만기의 단축코드를 반환. 오늘이 만기월이면 그 계약도 아직 유효한 것으로 취급
    (만기일 당일 이전까지는 여전히 거래되므로 월 단위 비교로 충분)."""
    text = _download_mst_text()
    contracts = parse_outright_contracts(text)
    if not contracts:
        raise RuntimeError('fo_cme_code.mst에서 야간선물 종목을 찾지 못함')
    this_yyyymm = int(datetime.now().strftime('%Y%m'))
    upcoming = [c for c in contracts if c['expiry_yyyymm'] >= this_yyyymm]
    pool = upcoming or contracts  # 전부 과거월이면(마스터파일 갱신 지연 등) 그냥 가장 가까운 것
    pool.sort(key=lambda c: c['expiry_yyyymm'])
    return pool[0]['code']


if __name__ == '__main__':
    print(get_front_month_code())
