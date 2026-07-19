#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
data.go.kr "금융위원회_증권상품시세정보"(데이터ID 15094806, getETFPriceInfo 오퍼레이션)에서
국내 상장 ETF 전체 이름/코드를 받아 data/krx_map.js(window.KRX_MAP, 종목검색·툴팁·수급위젯이
공용으로 쓰는 이름->코드 매핑)에 합친다.

이 파일은 원래 KRX KIND의 "상장법인목록"(코스피/코스닥) 다운로드로만 만들어져 있어서 ETF가
전혀 없었다(2026-07-20 사용자 제보: "종목검색에서 ETF는 검색이 안되나?") - KIND는 ETF를
아예 취급하지 않고(marketType=etfMkt로 조회해보면 "등록된 데이터가 없습니다"), data.krx.co.kr는
CLAUDE.md에 이미 기록된 대로 완전 차단 상태라 이 data.go.kr 공공데이터 API로 우회한다.
공매도/대차거래(scripts/fetch_investor_flow.py)와 달리 이 API는 계좌 연동이 아닌 일반
오픈API 키라 IP 등록이 필요 없다 - 그래도 하드코딩은 하지 않는다(공개 저장소).

사용법 (택1):
  1) 저장소 루트에 .env 파일 만들고(.gitignore 대상) 아래처럼 채운 뒤 실행:
       DATA_GO_KR_SERVICE_KEY=xxx
     python scripts/fetch_etf_list.py
  2) 환경변수로 직접 전달:
     DATA_GO_KR_SERVICE_KEY=xxx python scripts/fetch_etf_list.py

이름이 이미 data/krx_map.js에 있는 종목명과 겹치면(실제로는 0건 확인됨, 2026-07-20) 그
항목은 건너뛰고 경고만 남긴다 - 일반 종목 코드를 실수로 덮어쓰지 않기 위한 안전장치.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KRX_MAP_FILE = os.path.join(REPO_ROOT, 'data', 'krx_map.js')

API_URL = 'https://apis.data.go.kr/1160100/service/GetSecuritiesProductInfoService/getETFPriceInfo'
MAX_LOOKBACK_DAYS = 10  # 최근 영업일을 못 찾을 걱정은 거의 없지만 연휴 대비 여유


def log(msg):
    print('[fetch_etf_list] ' + msg, flush=True)


def load_dotenv():
    env_path = os.path.join(REPO_ROOT, '.env')
    if not os.path.exists(env_path):
        return
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, value = line.partition('=')
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def fetch_etf_rows(service_key):
    """가장 최근 데이터가 있는 영업일을 찾아 ETF 전체 행을 반환. data.go.kr은 기준일자로부터
    영업일 하루 뒤 오후 1시 이후 갱신이라 오늘/어제는 비어있을 수 있음 - totalCount가 0이면
    하루씩 과거로 물러나며 재시도한다."""
    cursor = datetime.now()
    for _ in range(MAX_LOOKBACK_DAYS):
        bas_dd = cursor.strftime('%Y%m%d')
        url = (API_URL + '?serviceKey=' + service_key + '&numOfRows=2000&pageNo=1'
               + '&resultType=json&basDt=' + bas_dd)
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        try:
            with urllib.request.urlopen(req, timeout=20) as res:
                data = json.loads(res.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            raise RuntimeError('data.go.kr 호출 실패(HTTP %d): %s' % (e.code, e.read().decode('utf-8', 'ignore')))
        body = data.get('response', {}).get('body', {})
        result_code = data.get('response', {}).get('header', {}).get('resultCode')
        if result_code != '00':
            raise RuntimeError('data.go.kr 응답 오류: ' + json.dumps(data.get('response', {}).get('header', {}), ensure_ascii=False))
        total = body.get('totalCount', 0)
        if total:
            items = body.get('items', {}).get('item') or []
            log('기준일자 %s: ETF %d종목 확인' % (bas_dd, len(items)))
            return items
        cursor -= timedelta(days=1)
    raise RuntimeError('최근 %d일 내 ETF 데이터를 못 찾았습니다.' % MAX_LOOKBACK_DAYS)


def load_krx_map():
    with open(KRX_MAP_FILE, 'r', encoding='utf-8') as f:
        text = f.read().strip()
    text = re.sub(r'^window\.KRX_MAP\s*=\s*', '', text)
    text = re.sub(r';\s*$', '', text)
    return json.loads(text)


def write_krx_map(stock_map):
    # 기존 파일과 동일하게 압축(공백 없음) 한 줄 포맷 유지 - 전 종목 매핑이라 들여쓰기하면
    # 파일 크기가 크게 늘어나고(모든 페이지가 매번 fetch), 기존 파일도 이 포맷이었음.
    body = json.dumps(stock_map, ensure_ascii=False, separators=(',', ':'))
    with open(KRX_MAP_FILE, 'w', encoding='utf-8', newline='\n') as f:
        f.write('window.KRX_MAP=' + body + ';')


def main():
    load_dotenv()
    service_key = os.environ.get('DATA_GO_KR_SERVICE_KEY')
    if not service_key:
        log('DATA_GO_KR_SERVICE_KEY 환경변수가 필요합니다.')
        sys.exit(1)

    items = fetch_etf_rows(service_key)
    stock_map = load_krx_map()
    before_count = len(stock_map)

    added = 0
    skipped = []
    for it in items:
        name = it.get('itmsNm')
        code = it.get('srtnCd')
        if not name or not code:
            continue
        if name in stock_map:
            skipped.append(name)
            continue
        stock_map[name] = code
        added += 1

    if skipped:
        log('이름 충돌로 건너뜀(%d건, 기존 종목 코드 유지): %s' % (len(skipped), ', '.join(skipped[:20])))

    write_krx_map(stock_map)
    log('krx_map.js 갱신 완료: %d -> %d개(ETF %d개 추가)' % (before_count, len(stock_map), added))


if __name__ == '__main__':
    main()
