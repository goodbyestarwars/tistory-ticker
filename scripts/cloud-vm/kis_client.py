# -*- coding: utf-8 -*-
"""한국투자증권(KIS) Open API 클라이언트 - 토큰/웹소켓 접속키 발급+캐싱 + REST 조회.
kiwoom_client.py와 동일한 캐싱 패턴. 코스피200 야간선물(FID_COND_MRKT_DIV_CODE=CM) 전용으로
필요한 만큼만 구현 - 계좌/주문 관련 API는 다루지 않는다(시세 조회만 필요)."""

import json
import logging
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

logger = logging.getLogger(__name__)

BASE_URL = 'https://openapi.koreainvestment.com:9443'
WS_URL = 'ws://ops.koreainvestment.com:21000'

_token_lock = threading.Lock()
_token_cache = {'token': None, 'expires_at': 0}

_approval_lock = threading.Lock()
_approval_cache = {'key': None, 'issued_at': 0}
_APPROVAL_TTL = 12 * 3600  # 접속키 자체 유효기간은 24h - 여유있게 12h마다 갱신


def _post_json(path, body):
    req = urllib.request.Request(
        BASE_URL + path,
        data=json.dumps(body).encode('utf-8'),
        headers={'Content-Type': 'application/json; charset=UTF-8'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return json.loads(res.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raise RuntimeError('%s HTTP %s: %s' % (path, e.code, e.read().decode('utf-8', 'ignore')))


def get_token(appkey, appsecret):
    """접근토큰(access_token) 캐시. 유효 24h, 만료 10분 전이면 재발급.
    KIS는 짧은 간격 재호출 시 직전 토큰을 그대로 돌려주므로 캐시가 없어도 안전하지만,
    불필요한 API 호출을 줄이기 위해 캐싱한다."""
    with _token_lock:
        now = time.time()
        if _token_cache['token'] and now < _token_cache['expires_at'] - 600:
            return _token_cache['token']
        data = _post_json('/oauth2/tokenP', {
            'grant_type': 'client_credentials',
            'appkey': appkey,
            'appsecret': appsecret,
        })
        token = data.get('access_token')
        if not token:
            raise RuntimeError('KIS 토큰 발급 실패: ' + json.dumps(data, ensure_ascii=False))
        expires_in = int(data.get('expires_in') or 86400)
        _token_cache['token'] = token
        _token_cache['expires_at'] = now + expires_in
        return token


def get_approval_key(appkey, appsecret):
    """웹소켓 접속키 캐시. 세션 연결 시 최초 1회만 필요하지만, 서비스 재시작 시마다
    새로 발급받아야 하므로 여기서 캐싱해 재사용."""
    with _approval_lock:
        now = time.time()
        if _approval_cache['key'] and now < _approval_cache['issued_at'] + _APPROVAL_TTL:
            return _approval_cache['key']
        data = _post_json('/oauth2/Approval', {
            'grant_type': 'client_credentials',
            'appkey': appkey,
            'secretkey': appsecret,  # 필드명이 appsecret이 아니라 secretkey(값은 동일) - KIS 문서 표기 그대로
        })
        key = data.get('approval_key')
        if not key:
            raise RuntimeError('KIS 웹소켓 접속키 발급 실패: ' + json.dumps(data, ensure_ascii=False))
        _approval_cache['key'] = key
        _approval_cache['issued_at'] = now
        return key


def fetch_period_chart(token, appkey, appsecret, mrkt_div_code, iscd, date1, date2, period_div_code='D'):
    """선물옵션기간별시세(일/주/월/년), TR FHKIF03020100. 최대 100건.
    mrkt_div_code: CM=야간선물, F=지수선물 등. date1/date2: YYYYMMDD.
    week/month는 date1/date2를 HHMMSS까지 붙인 YYYYMMDDHHMMSS가 아니라 이 API는 day만
    YYYYMMDD로 충분함(실측 확인됨, 네이버 API와는 다른 규격)."""
    path = ('/uapi/domestic-futureoption/v1/quotations/inquire-daily-fuopchartprice'
            '?FID_COND_MRKT_DIV_CODE=%s&FID_INPUT_ISCD=%s&FID_INPUT_DATE_1=%s&FID_INPUT_DATE_2=%s&FID_PERIOD_DIV_CODE=%s'
            % (mrkt_div_code, iscd, date1, date2, period_div_code))
    req = urllib.request.Request(
        BASE_URL + path,
        headers={
            'Content-Type': 'application/json; charset=utf-8',
            'authorization': 'Bearer ' + token,
            'appkey': appkey,
            'appsecret': appsecret,
            'tr_id': 'FHKIF03020100',
            'custtype': 'P',
        },
        method='GET',
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            data = json.loads(res.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raise RuntimeError('FHKIF03020100 HTTP %s: %s' % (e.code, e.read().decode('utf-8', 'ignore')))
    if data.get('rt_cd') != '0':
        raise RuntimeError('FHKIF03020100 실패: ' + json.dumps(data, ensure_ascii=False))
    return data.get('output1') or {}, data.get('output2') or []


def fetch_time_chart(token, appkey, appsecret, mrkt_div_code, iscd, date1, hour1, hour_cls_code='60'):
    """선물옵션 분봉조회, TR FHKIF03020200 (2026-07-16 실측 확인).
    date1: 조회 기준일 YYYYMMDD, hour1: 조회 기준시각 HHMMSS(보통 현재 시각) - 이 시각
    "이전" 최근 분봉들을 내려준다. 야간선물은 자정을 넘어가는 시각을 24:00~29:xx처럼
    30시간제로 표기해서 온다(stck_bsop_date는 그대로, stck_cntg_hour만 24 이상)."""
    path = ('/uapi/domestic-futureoption/v1/quotations/inquire-time-fuopchartprice'
            '?FID_COND_MRKT_DIV_CODE=%s&FID_INPUT_ISCD=%s&FID_HOUR_CLS_CODE=%s'
            '&FID_PW_DATA_INCU_YN=Y&FID_FAKE_TICK_INCU_YN=N&FID_INPUT_DATE_1=%s&FID_INPUT_HOUR_1=%s'
            % (mrkt_div_code, iscd, hour_cls_code, date1, hour1))
    req = urllib.request.Request(
        BASE_URL + path,
        headers={
            'Content-Type': 'application/json; charset=utf-8',
            'authorization': 'Bearer ' + token,
            'appkey': appkey,
            'appsecret': appsecret,
            'tr_id': 'FHKIF03020200',
            'custtype': 'P',
        },
        method='GET',
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            data = json.loads(res.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raise RuntimeError('FHKIF03020200 HTTP %s: %s' % (e.code, e.read().decode('utf-8', 'ignore')))
    if data.get('rt_cd') != '0':
        raise RuntimeError('FHKIF03020200 실패: ' + json.dumps(data, ensure_ascii=False))
    return data.get('output1') or {}, data.get('output2') or []


def fetch_option_board(token, appkey, appsecret, mtrt_yyyymm):
    """옵션 시세판(콜+풋), TR FHPIF05030100 (2026-07-16 실측 확인). mtrt_yyyymm: 만기 YYYYMM.
    output1=콜옵션, output2=풋옵션으로 추정(요청 파라미터 순서 FID_MRKT_CLS_CODE=CO/
    FID_MRKT_CLS_CODE1=PO와 일치). 필드에 명시적인 콜/풋 구분자가 없어 100% 문서화된 사실은
    아니라서, 매 호출마다 delta_val 부호(콜은 0~+1, 풋은 -1~0)로 실제 순서를 교차검증하고
    뒤집혀 있으면 함수 끝에서 바로잡는다(풋옵션 거래량이 비정상적으로 낮게 잡히던 원인 -
    2026-07-16 발견)."""
    path = ('/uapi/domestic-futureoption/v1/quotations/display-board-callput'
            '?FID_COND_MRKT_DIV_CODE=O&FID_COND_SCR_DIV_CODE=20503&FID_MRKT_CLS_CODE=CO'
            '&FID_MTRT_CNT=%s&FID_MRKT_CLS_CODE1=PO&FID_COND_MRKT_CLS_CODE=' % mtrt_yyyymm)
    req = urllib.request.Request(
        BASE_URL + path,
        headers={
            'Content-Type': 'application/json; charset=utf-8',
            'authorization': 'Bearer ' + token,
            'appkey': appkey,
            'appsecret': appsecret,
            'tr_id': 'FHPIF05030100',
            'custtype': 'P',
        },
        method='GET',
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            data = json.loads(res.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raise RuntimeError('FHPIF05030100 HTTP %s: %s' % (e.code, e.read().decode('utf-8', 'ignore')))
    if data.get('rt_cd') != '0':
        raise RuntimeError('FHPIF05030100 실패: ' + json.dumps(data, ensure_ascii=False))
    output1 = data.get('output1') or []
    output2 = data.get('output2') or []
    # 2026-08-03: 풋 거래량 0 버그 조사용 TEMP DEBUG 블록(2026-07-20, 매 5분 옵션수급 폴링마다
    # 원본 응답 전체를 로깅 + fetch_option_quote로 개별 종목 교차검증 API를 추가 호출)을
    # 제거했다. 원인 조사는 이미 아래 delta_val 부호 기반 자동 교정 로직으로 마무리됐고
    # (콜/풋이 뒤집혀 있으면 여기서 바로잡음), 디버그 블록만 상시 실행 상태로 남아있었다
    # (불필요한 KIS API 호출 + 매 폴링 응답 원문 로깅, 2026-08-03 리뷰에서 발견).
    # 콜 델타는 0~+1, 풋 델타는 -1~0(금융공식상 항상 성립) - 요청 파라미터 순서만 믿지 않고
    # 실측 delta_val 부호로 한 번 더 교차검증한다. 순서가 뒤집혀 있으면 여기서 바로잡는다.
    if _avg_delta(output1) < 0 and _avg_delta(output2) > 0:
        logger.warning('option board output1/output2 reversed vs expected call/put order - swapping')
        output1, output2 = output2, output1
    return output1, output2


def fetch_investor_trade_daily(token, appkey, appsecret, code, date1, mrkt_div_code='UN'):
    """종목별 투자자매매동향(일별), TR FHPTJ04160001 - 종목분석 메인 수급 표
    (kiwoom_market.fetch_foreign_inst_daily)의 1차 데이터소스(2026-07-19부터).
    mrkt_div_code: J=KRX, NX=NXT, UN=통합(KRX+NXT). 키움 ka10045/ka10059는 이 두 TR에
    거래소구분 파라미터 자체가 없어서 NXT 체결분이 빠진 축소된 거래량/수급만 나왔는데
    (005930 2026-07-16 실측: 키움 27,001,478주 vs 실제 44,712,225주, stex_tp 파라미터를
    넣어봐도 무시됨 확인됨), KIS는 UN으로 명시 조회하면 종가·거래량·개인·기관이 Toss/
    키움HTS와 정확히 일치함(실측 확인). 외국인은 frgn_reg_ntby_qty(등록 외국인)를 써야
    Toss와 일치 - frgn_ntby_qty(등록+비등록 전체)는 다른 값이니 혼동 주의.
    한 번 호출로 date1 기준 최근 30영업일치가 output2에 옴(output1은 당일 시세 요약 1건)."""
    path = ('/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily'
            '?FID_COND_MRKT_DIV_CODE=%s&FID_INPUT_ISCD=%s&FID_INPUT_DATE_1=%s&FID_ORG_ADJ_PRC=&FID_ETC_CLS_CODE='
            % (mrkt_div_code, code, date1))
    req = urllib.request.Request(
        BASE_URL + path,
        headers={
            'Content-Type': 'application/json; charset=utf-8',
            'authorization': 'Bearer ' + token,
            'appkey': appkey,
            'appsecret': appsecret,
            'tr_id': 'FHPTJ04160001',
            'custtype': 'P',
        },
        method='GET',
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            data = json.loads(res.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raise RuntimeError('FHPTJ04160001 HTTP %s: %s' % (e.code, e.read().decode('utf-8', 'ignore')))
    if data.get('rt_cd') != '0':
        raise RuntimeError('FHPTJ04160001 실패: ' + json.dumps(data, ensure_ascii=False))
    return data.get('output1') or {}, data.get('output2') or []


def fetch_market_investor_daily(token, appkey, appsecret, date1, date2, market_iscd='KSP', inds_cd='0001'):
    """시장별 투자자매매동향(일별), TR FHPTJ04040000 [국내주식-075] - 한국투자 HTS(eFriend Plus)
    [0404] 시장별 일별동향 화면과 1:1 대응. 2026-07-20 kis-code-assistant-mcp로 공식 예제를
    확인해 추가(코드 검색 전용 MCP라 실호출 검증은 못 함, 아래 단위 가정은 배포 후 실측 필요).
    공식 예제는 FID_INPUT_DATE_1=FID_INPUT_DATE_2(동일 날짜)만 검증된 사용법이라 이 함수도
    그 방식만 지원 - date1/date2에 다른 날짜를 넣으면 범위 조회가 될지는 미검증(향후 최적화
    여지, investor_trend.py가 현재 날짜별로 반복 호출하는 이유).
    market_iscd: 'KSP'=코스피, 'KSQ'=코스닥.
    inds_cd(FID_INPUT_ISCD/FID_INPUT_ISCD_2, 업종코드): 2026-07-21 발견 - 처음엔 '0001'(코스피
    종합)로 시장 무관하게 고정했었는데, 코스닥 조회 시 이 값이 여전히 '0001'로 남아있어
    "KSQ 시장 + 0001(코스피 종합) 업종" 조합이 유효하지 않은 채 200 OK/rt_cd=0으로 응답만
    비어있게(모든 금액 필드 0) 돌아오는 문제를 실측으로 확인(investor_trend.py가 4개월치를
    전부 0으로 백필함). KRX 업종코드 관례(코스피 0으로 시작/코스닥 1로 시작, 예: 지수 조회
    TR들의 0001/1001 패턴)를 따라 코스닥은 '1001'으로 호출하도록 investor_trend.py에서
    분기 - 배포 후 실측으로 값이 정상 출력됨을 확인(2026-07-21).
    응답 output은 날짜 1건짜리 리스트(dict 1개). 금액 필드(*_ntby_tr_pbmn)는 백만원 단위
    (2026-07-20 실측 확정, investor_trend.py 참고)."""
    path = ('/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market'
            '?FID_COND_MRKT_DIV_CODE=U&FID_INPUT_ISCD=%s&FID_INPUT_DATE_1=%s&FID_INPUT_ISCD_1=%s'
            '&FID_INPUT_DATE_2=%s&FID_INPUT_ISCD_2=%s' % (inds_cd, date1, market_iscd, date2, inds_cd))
    req = urllib.request.Request(
        BASE_URL + path,
        headers={
            'Content-Type': 'application/json; charset=utf-8',
            'authorization': 'Bearer ' + token,
            'appkey': appkey,
            'appsecret': appsecret,
            'tr_id': 'FHPTJ04040000',
            'custtype': 'P',
        },
        method='GET',
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            data = json.loads(res.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raise RuntimeError('FHPTJ04040000 HTTP %s: %s' % (e.code, e.read().decode('utf-8', 'ignore')))
    if data.get('rt_cd') != '0':
        raise RuntimeError('FHPTJ04040000 실패: ' + json.dumps(data, ensure_ascii=False))
    return data.get('output') or []


def fetch_pbar_tratio(token, appkey, appsecret, code, hour1=''):
    """국내주식 매물대/거래비중, TR FHPST01130000 [국내주식-196] - 한국투자 HTS(eFriend Plus)
    [0113] 당일가격대별 매물대 화면과 1:1 대응. 2026-08-04 공식 GitHub 예제
    (koreainvestment/open-trading-api, examples_llm/domestic_stock/pbar_tratio/pbar_tratio.py)로
    요청 파라미터와 응답 컬럼명을 확인해 추가했고, 실호출로 정상 응답(005930)까지 검증 완료.
    **주의: 이건 "당일"(오늘 하루) 가격대별 체결거래량이지, js/foreign-flow.js의
    computeVolumeProfile(최근 120거래일 근사치)처럼 여러 날에 걸친 매물대가 아니다.**
    output1(dict, 요약 1건): 종목명/현재가/전일대비/누적거래량 등.
    output2(list, 가격대별): data_rank(순위), stck_prpr(그 가격대의 실제 체결가),
    cntg_vol(그 가격 체결거래량), acml_vol_rlim(누적거래량 대비 비중%).
    hour1(FID_INPUT_HOUR_1)은 조회 기준 시각 - 비워두면(기본) 현재 시각 기준."""
    path = ('/uapi/domestic-stock/v1/quotations/pbar-tratio'
            '?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=%s&FID_COND_SCR_DIV_CODE=20113&FID_INPUT_HOUR_1=%s'
            % (code, hour1))
    req = urllib.request.Request(
        BASE_URL + path,
        headers={
            'Content-Type': 'application/json; charset=utf-8',
            'authorization': 'Bearer ' + token,
            'appkey': appkey,
            'appsecret': appsecret,
            'tr_id': 'FHPST01130000',
            'custtype': 'P',
        },
        method='GET',
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            data = json.loads(res.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raise RuntimeError('FHPST01130000 HTTP %s: %s' % (e.code, e.read().decode('utf-8', 'ignore')))
    if data.get('rt_cd') != '0':
        raise RuntimeError('FHPST01130000 실패: ' + json.dumps(data, ensure_ascii=False))
    return data.get('output1') or {}, data.get('output2') or []


def fetch_overseas_price(token, appkey, appsecret, excd, symb):
    """해외주식 현재체결가(v1_해외주식-009)를 조회한다.

    미국주식은 KIS 무료시세 정책상 지연체결가일 수 있으나, 공개 중계 소스가
    아니라 KIS 계정에 연결된 공식 Open API 응답을 사용한다.
    """
    path = ('/uapi/overseas-price/v1/quotations/price'
            '?AUTH=&EXCD=%s&SYMB=%s' % (excd, symb))
    req = urllib.request.Request(
        BASE_URL + path,
        headers={
            'Content-Type': 'application/json; charset=utf-8',
            'authorization': 'Bearer ' + token,
            'appkey': appkey,
            'appsecret': appsecret,
            'tr_id': 'HHDFS00000300',
            'custtype': 'P',
        },
        method='GET',
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            data = json.loads(res.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raise RuntimeError('HHDFS00000300 HTTP %s: %s' % (e.code, e.read().decode('utf-8', 'ignore')))
    if data.get('rt_cd') not in (None, '0', 0):
        raise RuntimeError('HHDFS00000300 실패: ' + json.dumps(data, ensure_ascii=False))
    return data.get('output') or data.get('output1') or {}


def _get_domestic_quote(token, appkey, appsecret, path, tr_id, params):
    query = urllib.parse.urlencode(params)
    req = urllib.request.Request(
        BASE_URL + path + '?' + query,
        headers={
            'Content-Type': 'application/json; charset=utf-8',
            'authorization': 'Bearer ' + token,
            'appkey': appkey,
            'appsecret': appsecret,
            'tr_id': tr_id,
            'custtype': 'P',
        },
        method='GET',
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            data = json.loads(res.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raise RuntimeError('%s HTTP %s: %s' % (tr_id, e.code, e.read().decode('utf-8', 'ignore')))
    if data.get('rt_cd') != '0':
        raise RuntimeError('%s 실패: %s' % (tr_id, json.dumps(data, ensure_ascii=False)))
    return data


def fetch_index_period_chart(token, appkey, appsecret, iscd, date1, date2, period='D'):
    """KIS domestic index daily/weekly candles (FHKUP03500100)."""
    data = _get_domestic_quote(
        token, appkey, appsecret,
        '/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice',
        'FHKUP03500100',
        {
            'FID_COND_MRKT_DIV_CODE': 'U',
            'FID_INPUT_ISCD': iscd,
            'FID_INPUT_DATE_1': date1,
            'FID_INPUT_DATE_2': date2,
            'FID_PERIOD_DIV_CODE': period,
        },
    )
    return data.get('output1') or {}, data.get('output2') or []


def fetch_index_time_chart(token, appkey, appsecret, iscd, interval='60'):
    """KIS domestic index minute candles (FHPUP02110200)."""
    data = _get_domestic_quote(
        token, appkey, appsecret,
        '/uapi/domestic-stock/v1/quotations/inquire-index-timeprice',
        'FHPUP02110200',
        {
            'FID_INPUT_HOUR_1': interval,
            'FID_INPUT_ISCD': iscd,
            'FID_COND_MRKT_DIV_CODE': 'U',
        },
    )
    return {}, data.get('output') or []


def fetch_market_funds(token, appkey, appsecret, date=''):
    """KIS market funds aggregate (FHKST649100C0, values in 100m KRW).

    This endpoint uses the uppercase FID query-key convention, unlike several
    other KIS quote endpoints.
    """
    data = _get_domestic_quote(
        token, appkey, appsecret,
        '/uapi/domestic-stock/v1/quotations/mktfunds',
        'FHKST649100C0',
        {'FID_INPUT_DATE_1': date},
    )
    output = data.get('output') or []
    return output if isinstance(output, list) else [output]


def _avg_delta(rows):
    vals = []
    for r in rows:
        try:
            vals.append(float(r.get('delta_val') or 0))
        except (TypeError, ValueError):
            continue
    return sum(vals) / len(vals) if vals else 0.0


# ---------------------------------------------------------------------------
# 실시간 종목판용 순위 조회
# ---------------------------------------------------------------------------

def _get_overseas_rank(token, appkey, appsecret, path, tr_id, params):
    """KIS 해외주식 순위 REST 공통 호출기."""
    query = urllib.parse.urlencode(params)
    req = urllib.request.Request(
        BASE_URL + path + '?' + query,
        headers={
            'Content-Type': 'application/json; charset=utf-8',
            'authorization': 'Bearer ' + token,
            'appkey': appkey,
            'appsecret': appsecret,
            'tr_id': tr_id,
            'custtype': 'P',
        },
        method='GET',
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            data = json.loads(res.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raise RuntimeError('%s HTTP %s: %s' % (tr_id, e.code, e.read().decode('utf-8', 'ignore')))
    if data.get('rt_cd') not in (None, '0', 0):
        raise RuntimeError('%s 실패: %s' % (tr_id, json.dumps(data, ensure_ascii=False)))
    return data


def fetch_domestic_quote(token, appkey, appsecret, code, market='UN'):
    """국내주식 현재가 시세(v1_국내주식-008), TR FHKST01010100."""
    data = _get_domestic_quote(
        token, appkey, appsecret,
        '/uapi/domestic-stock/v1/quotations/inquire-price',
        'FHKST01010100',
        {
            'FID_COND_MRKT_DIV_CODE': market,
            'FID_INPUT_ISCD': code,
        },
    )
    return data.get('output') or {}


def fetch_domestic_order_book(token, appkey, appsecret, code, market='UN'):
    """국내주식 호가/예상체결(v1_국내주식-011), TR FHKST01010200.

    output1은 10단계 호가, output2는 예상체결 정보다. 화면의 초기 호가와
    마지막 체결 스냅샷을 함께 채울 수 있도록 두 응답을 그대로 반환한다.
    """
    data = _get_domestic_quote(
        token, appkey, appsecret,
        '/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn',
        'FHKST01010200',
        {
            'FID_COND_MRKT_DIV_CODE': market,
            'FID_INPUT_ISCD': code,
        },
    )
    return data.get('output1') or {}, data.get('output2') or {}


def fetch_domestic_trade(token, appkey, appsecret, code, market='UN'):
    """국내주식 현재가 체결(v1_국내주식-009), TR FHKST01010300."""
    data = _get_domestic_quote(
        token, appkey, appsecret,
        '/uapi/domestic-stock/v1/quotations/inquire-ccnl',
        'FHKST01010300',
        {
            'FID_COND_MRKT_DIV_CODE': market,
            'FID_INPUT_ISCD': code,
        },
    )
    rows = data.get('output') or []
    if isinstance(rows, dict):
        return [rows]
    return rows if isinstance(rows, list) else []


def fetch_domestic_volume_rank(token, appkey, appsecret, sort_code='3', limit=20):
    """국내주식 순위분석[v1_국내주식-047].

    sort_code: 0 평균거래량, 1 거래증가율, 2 평균거래회전율,
               3 거래금액순, 4 평균거래금액회전율.
    """
    data = _get_domestic_quote(
        token, appkey, appsecret,
        '/uapi/domestic-stock/v1/quotations/volume-rank',
        'FHPST01710000',
        {
            # 순위분석 TR은 통합(UN)도 문서상 지원하지만, 거래증가율·
            # 회전율 계열은 KRX(J)로 요청해야 응답하는 경우가 있다.
            'FID_COND_MRKT_DIV_CODE': 'J',
            'FID_COND_SCR_DIV_CODE': '20171',
            'FID_INPUT_ISCD': '0000',
            'FID_DIV_CLS_CODE': '0',
            'FID_BLNG_CLS_CODE': sort_code,
            # 9자리 대상/10자리 제외 마스크를 명시한다. 0 하나만 넣으면
            # 거래대금순은 오더라도 거래증가율·회전율 순위가 빈 응답이 된다.
            'FID_TRGT_CLS_CODE': '111111111',
            'FID_TRGT_EXLS_CLS_CODE': '0000000000',
            'FID_INPUT_PRICE_1': '',
            'FID_INPUT_PRICE_2': '',
            'FID_VOL_CNT': '',
            'FID_INPUT_DATE_1': '',
        },
    )
    rows = data.get('output') or []
    if not isinstance(rows, list):
        rows = [rows] if isinstance(rows, dict) else []
    return rows[:max(1, min(int(limit), 100))]


def fetch_domestic_fluctuation_rank(token, appkey, appsecret, limit=20):
    """국내주식 등락률 순위[v1_국내주식-088]."""
    data = _get_domestic_quote(
        token, appkey, appsecret,
        '/uapi/domestic-stock/v1/ranking/fluctuation',
        'FHPST01700000',
        {
            'FID_RSFL_RATE2': '',
            'FID_COND_MRKT_DIV_CODE': 'J',
            'FID_COND_SCR_DIV_CODE': '20170',
            'FID_INPUT_ISCD': '0000',
            'FID_RANK_SORT_CLS_CODE': '0',
            'FID_INPUT_CNT_1': str(max(1, min(int(limit), 100))),
            'FID_PRC_CLS_CODE': '0',
            'FID_INPUT_PRICE_1': '',
            'FID_INPUT_PRICE_2': '',
            'FID_VOL_CNT': '',
            'FID_TRGT_CLS_CODE': '0',
            'FID_TRGT_EXLS_CLS_CODE': '0',
            'FID_DIV_CLS_CODE': '0',
            'FID_RSFL_RATE1': '',
        },
    )
    rows = data.get('output') or []
    if not isinstance(rows, list):
        rows = [rows] if isinstance(rows, dict) else []
    return rows[:max(1, min(int(limit), 100))]


def fetch_domestic_market_cap_rank(token, appkey, appsecret, limit=20):
    """국내주식 시가총액 상위[v1_국내주식-091]."""
    data = _get_domestic_quote(
        token, appkey, appsecret,
        '/uapi/domestic-stock/v1/ranking/market-cap',
        'FHPST01740000',
        {
            'FID_INPUT_PRICE_2': '',
            'FID_COND_MRKT_DIV_CODE': 'J',
            'FID_COND_SCR_DIV_CODE': '20174',
            'FID_DIV_CLS_CODE': '0',
            'FID_INPUT_ISCD': '0000',
            'FID_TRGT_CLS_CODE': '0',
            'FID_TRGT_EXLS_CLS_CODE': '0',
            'FID_INPUT_PRICE_1': '',
            'FID_VOL_CNT': '',
        },
    )
    rows = data.get('output') or []
    if not isinstance(rows, list):
        rows = [rows] if isinstance(rows, dict) else []
    return rows[:max(1, min(int(limit), 100))]


def fetch_us_trade_amount_rank(token, appkey, appsecret, exchange, limit=20):
    """해외주식 거래대금순위[해외주식-044]의 거래소별 결과."""
    data = _get_overseas_rank(
        token, appkey, appsecret,
        '/uapi/overseas-stock/v1/ranking/trade-pbmn',
        'HHDFS76320010',
        {
            'EXCD': exchange,
            'NDAY': '0',
            'VOL_RANG': '0',
            'AUTH': '',
            'KEYB': '',
            'PRC1': '',
            'PRC2': '',
        },
    )
    rows = data.get('output2') or data.get('output') or []
    if not isinstance(rows, list):
        rows = [rows] if isinstance(rows, dict) else []
    return rows[:max(1, min(int(limit), 100))]


def _fetch_us_rank_rows(token, appkey, appsecret, exchange, path, tr_id, params, limit=20):
    """해외주식 순위 API의 output2를 공통으로 꺼낸다."""
    data = _get_overseas_rank(token, appkey, appsecret, path, tr_id, dict(params, EXCD=exchange))
    rows = data.get('output2') or data.get('output') or []
    if not isinstance(rows, list):
        rows = [rows] if isinstance(rows, dict) else []
    return rows[:max(1, min(int(limit), 100))]


def fetch_us_trade_volume_rank(token, appkey, appsecret, exchange, limit=20):
    """해외주식 거래량순위[해외주식-043], TR HHDFS76310010."""
    return _fetch_us_rank_rows(
        token, appkey, appsecret, exchange,
        '/uapi/overseas-stock/v1/ranking/trade-vol', 'HHDFS76310010',
        {'NDAY': '0', 'PRC1': '', 'PRC2': '', 'VOL_RANG': ''}, limit,
    )


def fetch_us_market_cap_rank(token, appkey, appsecret, exchange, limit=20):
    """해외주식 시가총액순위[해외주식-047], TR HHDFS76350100."""
    return _fetch_us_rank_rows(
        token, appkey, appsecret, exchange,
        '/uapi/overseas-stock/v1/ranking/market-cap', 'HHDFS76350100',
        {'VOL_RANG': ''}, limit,
    )


def fetch_us_updown_rank(token, appkey, appsecret, exchange, gubn='1', limit=20):
    """해외주식 상승율/하락율[해외주식-041], TR HHDFS76290000."""
    return _fetch_us_rank_rows(
        token, appkey, appsecret, exchange,
        '/uapi/overseas-stock/v1/ranking/updown-rate', 'HHDFS76290000',
        {'GUBN': gubn, 'NDAY': '0', 'VOL_RANG': ''}, limit,
    )


def fetch_us_volume_surge_rank(token, appkey, appsecret, exchange, limit=20):
    """해외주식 거래량급증[해외주식-039], TR HHDFS76270000."""
    return _fetch_us_rank_rows(
        token, appkey, appsecret, exchange,
        '/uapi/overseas-stock/v1/ranking/volume-surge', 'HHDFS76270000',
        {'MIXN': '0', 'VOL_RANG': ''}, limit,
    )


def fetch_us_volume_power_rank(token, appkey, appsecret, exchange, limit=20):
    """해외주식 매수체결강도상위[해외주식-040], TR HHDFS76280000."""
    return _fetch_us_rank_rows(
        token, appkey, appsecret, exchange,
        '/uapi/overseas-stock/v1/ranking/volume-power', 'HHDFS76280000',
        {'NDAY': '0', 'VOL_RANG': ''}, limit,
    )


def fetch_us_new_highlow_rank(token, appkey, appsecret, exchange, gubn='1', limit=20):
    """해외주식 신고/신저가[해외주식-042], TR HHDFS76300000."""
    return _fetch_us_rank_rows(
        token, appkey, appsecret, exchange,
        '/uapi/overseas-stock/v1/ranking/new-highlow', 'HHDFS76300000',
        {'GUBN': gubn, 'GUBN2': '1', 'NDAY': '6', 'VOL_RANG': ''}, limit,
    )
