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

이름이 이미 data/krx_map.js에 있는데 코드가 다르면(실제로는 0건 확인됨, 2026-07-20) 그
항목은 건너뛰고 경고만 남긴다 - 일반 종목 코드를 실수로 덮어쓰지 않기 위한 안전장치. 코드가
같으면(예전에 이 스크립트가 이미 등록해둔 ETF) 충돌이 아니라 재확인일 뿐이라 그대로 갱신
한다 - 이 기준 덕분에 재실행(신규 상장 ETF 반영 등)해도 매번 안전하게 반복 실행 가능하다.

2026-07-20(2차): ETF를 합친 직후 "삼성전자"를 검색하면 진짜 삼성전자 대신 "KODEX
삼성전자SK하이닉스채권혼합50" 같은, 이름에 "삼성전자"가 들어간 ETF들이 자동완성 상위를
차지하는 문제가 실측 발견됨(여러 위젯이 "시작 일치 -> 포함 일치" 2단계로만 정렬해서 ETF와
일반 종목을 구분 안 했음). data/krx_map.js에 window.KRX_ETF_NAMES(ETF 이름 목록)를 같이
심어서, 위젯들이 "이 이름이 ETF인지" 판별해 일반 종목을 항상 먼저 보여주도록 정렬 우선순위를
추가했다(js/foreign-flow.js, js/stock-search-panel.js, js/stock-news.js, js/watchlist.js).
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import krx_map_io  # noqa: E402

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
    """data/krx_map.js 전체(본 맵 + 과거 수동 덧붙임 줄 + ETN 배열)를 읽는다.
    2026-11-21: 예전에는 첫 KRX_MAP 객체만 읽고 파일 전체를 다시 써서, 수동으로 덧붙인
    `window.KRX_MAP["이름"]="코드";` 줄이 재실행 때 사라지는 문제가 있었다. 읽기·쓰기는
    scripts/krx_map_io.py 공통 모듈을 쓴다(sync_listings.py와 같은 형식)."""
    return krx_map_io.load(KRX_MAP_FILE)


def write_krx_map(data):
    # 압축 포맷·KRX_ETF_NAMES 의미(자동완성에서 ETF를 일반 종목 뒤로 미루는 판별 목록,
    # 2026-07-20)는 krx_map_io.render가 그대로 유지한다.
    krx_map_io.write(data, KRX_MAP_FILE)


def main():
    load_dotenv()
    service_key = os.environ.get('DATA_GO_KR_SERVICE_KEY')
    if not service_key:
        log('DATA_GO_KR_SERVICE_KEY 환경변수가 필요합니다.')
        sys.exit(1)

    items = fetch_etf_rows(service_key)
    krx_data = load_krx_map()
    stock_map = krx_data.map
    before_count = len(stock_map)

    # 충돌 판정 기준은 "이미 다른 코드로 등록된 이름인가"이다(이름만 있고 코드가 같으면
    # 예전에 이 스크립트가 등록해둔 ETF를 재확인하는 것뿐이라 안전 - 재실행해도 매번
    # "충돌"로 오인하지 않음). 진짜 종목과 겹치는 극히 드문 경우에만 그 종목의 코드를
    # 그대로 지키고 건너뛴다.
    added = 0
    skipped = []
    etf_names = []
    for it in items:
        name = it.get('itmsNm')
        code = it.get('srtnCd')
        if not name or not code:
            continue
        if name in stock_map and stock_map[name] != code:
            skipped.append(name)
            continue
        if name not in stock_map:
            added += 1
        stock_map[name] = code
        etf_names.append(name)

    if skipped:
        log('이름 충돌로 건너뜀(%d건, 기존 종목 코드 유지): %s' % (len(skipped), ', '.join(skipped[:20])))

    # 이미 등록된 ETF 이름(sync_listings.py가 추가한 신규 ETF 포함)은 API가 아직 모르더라도 유지한다.
    krx_data.etf_names = sorted(set(etf_names) | set(krx_data.etf_names))
    write_krx_map(krx_data)
    log('krx_map.js 갱신 완료: %d -> %d개(ETF %d개 추가, 전체 ETF %d개)' % (before_count, len(stock_map), added, len(etf_names)))


if __name__ == '__main__':
    main()
