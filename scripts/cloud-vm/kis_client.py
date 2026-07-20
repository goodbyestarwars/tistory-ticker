# -*- coding: utf-8 -*-
"""한국투자증권(KIS) Open API 클라이언트 - 토큰/웹소켓 접속키 발급+캐싱 + REST 조회.
kiwoom_client.py와 동일한 캐싱 패턴. 코스피200 야간선물(FID_COND_MRKT_DIV_CODE=CM) 전용으로
필요한 만큼만 구현 - 계좌/주문 관련 API는 다루지 않는다(시세 조회만 필요)."""

import json
import logging
import threading
import time
import urllib.error
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
    # TEMP DEBUG(2026-07-20 2차): 풋 거래량이 100건 전부 0으로 잡히는 원인 조사용 - 1차
    # 디버그(2026-07-18)로 FID_MTRT_CNT 파라미터는 KIS 공식 예제와 동일함을 확인해 배제됨.
    # 2차 디버그로 콜/풋이 정확히 같은 행사가 100개(1350.00~1597.50)를 조회하는데 콜은
    # 실거래가 분포하고 풋은 전부 0임을 확인 - "100건 윈도우가 ATM을 놓친다"는 가설도 배제됨.
    # 원인 파악 후 제거할 것.
    logger.info('option board raw: output1_len=%d output2_len=%d', len(output1), len(output2))
    if output1:
        logger.info('option board output1[0] raw: %s', json.dumps(output1[0], ensure_ascii=False))
        logger.info('option board output1 (acpr, acml_vol) pairs: %s',
                     [(r.get('acpr'), r.get('acml_vol')) for r in output1])
    if output2:
        logger.info('option board output2[0] raw: %s', json.dumps(output2[0], ensure_ascii=False))
        logger.info('option board output2 (acpr, acml_vol) pairs: %s',
                     [(r.get('acpr'), r.get('acml_vol')) for r in output2])
        # TEMP DEBUG 3차: 이 전광판(FHPIF05030100)의 풋 슬롯만 죽어있는 건지, 아니면 개별
        # 종목 조회(FHMIF10000000)로 같은 풋을 찍어도 거래량이 0인지 교차검증 - 전자면 이
        # TR 자체의 한계, 후자면 계정/데이터 권한 문제로 원인이 갈린다.
        try:
            put_iscd = output2[0].get('optn_shrn_iscd')
            if put_iscd:
                quote = fetch_option_quote(token, appkey, appsecret, put_iscd)
                logger.info('option board cross-check via inquire-price(%s): %s',
                             put_iscd, json.dumps(quote, ensure_ascii=False))
        except Exception:
            logger.exception('option board cross-check via inquire-price failed')
    # 콜 델타는 0~+1, 풋 델타는 -1~0(금융공식상 항상 성립) - 요청 파라미터 순서만 믿지 않고
    # 실측 delta_val 부호로 한 번 더 교차검증한다. 순서가 뒤집혀 있으면 여기서 바로잡는다.
    if _avg_delta(output1) < 0 and _avg_delta(output2) > 0:
        logger.warning('option board output1/output2 reversed vs expected call/put order - swapping')
        output1, output2 = output2, output1
    return output1, output2


# TEMP DEBUG(2026-07-20 3차): 옵션 전광판(fetch_option_board)의 풋 거래량 0 버그 교차검증 전용.
# 개별 종목 시세 조회, TR FHMIF10000000(선물옵션 시세, KIS 공식 예제 기준). 원인 파악 후
# fetch_option_board의 호출부와 함께 제거할 것.
def fetch_option_quote(token, appkey, appsecret, iscd):
    """선물옵션 시세(개별 종목), TR FHMIF10000000. iscd: 옵션 단축 종목코드(전광판 API의
    optn_shrn_iscd를 그대로 재사용 - 두 TR이 같은 단축코드 체계를 쓰는지는 미확인이라
    이 호출 자체가 그 가정을 검증하는 목적도 겸함)."""
    path = ('/uapi/domestic-futureoption/v1/quotations/inquire-price'
            '?FID_COND_MRKT_DIV_CODE=O&FID_INPUT_ISCD=%s' % iscd)
    req = urllib.request.Request(
        BASE_URL + path,
        headers={
            'Content-Type': 'application/json; charset=utf-8',
            'authorization': 'Bearer ' + token,
            'appkey': appkey,
            'appsecret': appsecret,
            'tr_id': 'FHMIF10000000',
            'custtype': 'P',
        },
        method='GET',
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        data = json.loads(res.read().decode('utf-8'))
    return data


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


def fetch_market_investor_daily(token, appkey, appsecret, date1, date2, market_iscd='KSP'):
    """시장별 투자자매매동향(일별), TR FHPTJ04040000 [국내주식-075] - 한국투자 HTS(eFriend Plus)
    [0404] 시장별 일별동향 화면과 1:1 대응. 2026-07-20 kis-code-assistant-mcp로 공식 예제를
    확인해 추가(코드 검색 전용 MCP라 실호출 검증은 못 함, 아래 단위 가정은 배포 후 실측 필요).
    공식 예제는 FID_INPUT_DATE_1=FID_INPUT_DATE_2(동일 날짜)만 검증된 사용법이라 이 함수도
    그 방식만 지원 - date1/date2에 다른 날짜를 넣으면 범위 조회가 될지는 미검증(향후 최적화
    여지, investor_trend.py가 현재 날짜별로 반복 호출하는 이유).
    market_iscd: 'KSP'=코스피, 'KSQ'=코스닥. 응답 output은 날짜 1건짜리 리스트(dict 1개).
    금액 필드(*_ntby_tr_pbmn)는 원 단위로 추정 - investor_trend.py에서 억원으로 환산 시
    네이버 확정치와 대조 검증 필요."""
    path = ('/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market'
            '?FID_COND_MRKT_DIV_CODE=U&FID_INPUT_ISCD=0001&FID_INPUT_DATE_1=%s&FID_INPUT_ISCD_1=%s'
            '&FID_INPUT_DATE_2=%s&FID_INPUT_ISCD_2=0001' % (date1, market_iscd, date2))
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


def fetch_market_investor_time(token, appkey, appsecret, market_iscd='999', sector_iscd='S001'):
    """시장별 투자자매매동향(시세), TR FHPTJ04030000 [v1_국내주식-074] - 한국투자 HTS(eFriend
    Plus) [0403] 시장별 시간동향 상단 표. FHPTJ04040000(일별, [0404])이 실측 결과 토스/
    키움HTS의 "투자자별 매매종합" 화면과 값이 안 맞아서(2026-07-20, 사용자가 직접 대조)
    대안으로 추가 - [0403]은 "시세성"(실시간/당일 스냅샷) 화면이라 HTS가 보여주는 실시간
    종합 수치와 더 가까울 가능성.
    market_iscd/sector_iscd: 공식 예제가 "999"/"S001" 조합만 검증돼 있고 각 값의 정확한
    의미(999=전체 시장? S001=주식 업종?)는 kis-code-assistant-mcp 문서에도 없어 미확인 -
    실측으로 코스피 단독 값인지 확인 필요. 날짜 파라미터가 없어 "오늘"만 제공(히스토리 불가,
    ka10051과 동일한 제약)."""
    path = ('/uapi/domestic-stock/v1/quotations/inquire-investor-time-by-market'
            '?FID_INPUT_ISCD=%s&FID_INPUT_ISCD_2=%s' % (market_iscd, sector_iscd))
    req = urllib.request.Request(
        BASE_URL + path,
        headers={
            'Content-Type': 'application/json; charset=utf-8',
            'authorization': 'Bearer ' + token,
            'appkey': appkey,
            'appsecret': appsecret,
            'tr_id': 'FHPTJ04030000',
            'custtype': 'P',
        },
        method='GET',
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            data = json.loads(res.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raise RuntimeError('FHPTJ04030000 HTTP %s: %s' % (e.code, e.read().decode('utf-8', 'ignore')))
    if data.get('rt_cd') != '0':
        raise RuntimeError('FHPTJ04030000 실패: ' + json.dumps(data, ensure_ascii=False))
    return data.get('output') or []


def _avg_delta(rows):
    vals = []
    for r in rows:
        try:
            vals.append(float(r.get('delta_val') or 0))
        except (TypeError, ValueError):
            continue
    return sum(vals) / len(vals) if vals else 0.0
