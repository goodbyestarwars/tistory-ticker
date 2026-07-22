# -*- coding: utf-8 -*-
"""사이드바 실시간 랭킹(거래량 TOP/상한가/하한가) - 키움 REST 랭킹정보 TR 직접 호출.
전종목을 우리가 스캔해서 순위를 계산하는 대신, 키움이 이미 계산해둔 랭킹 TR을 그대로
재사용한다(작업지시서: 9bolt 우측 사이드바 리디자인, 2026-07-20 - 인기글/해시태그를
실시간 시장데이터로 교체).

상하한가요청(ka10017)의 정확한 파라미터·응답 배열 키(updown_pric)는 키움 공식 GitHub
(Kiwoom-Securities/Kiwoom-REST-API의 get_domestic_upper_lower_limit_stocks.py)로 확정함
(2026-07-20, 최초 배포 때 mrkt_tp 누락으로 return_code=2 에러가 나서 재조사함 - 이 저장소
안에 있던 레퍼런스 문서(kiwoom_api.md)엔 필수 파라미터 목록이 불완전했음, 그 문서만 믿지
말 것). `_first_list_field`는 이름을 하드코딩하지 않고 "리스트 타입인 필드"를 그대로 찾는
방어적 파싱이라 위 키 이름이 바뀌어도 안 죽는다(return_code/return_msg 등 메타 필드는
스칼라라 자동으로 걸러짐).

**2026-07-22: 거래대금상위요청(ka10032) → 당일거래량상위요청(ka10030)으로 교체**(사용자
피드백: 거래대금 TOP로 하니 SK하이닉스처럼 단가가 비싼 종목만 걸림 - 거래량 기준이 더
의도에 맞음). ka10030 파라미터는 kiwoom_api.md 문서의 필수 파라미터 목록만 근거로 채웠고
(sort_tp/mang_stk_incls/crd_tp/trde_qty_tp/pric_tp/trde_prica_tp/mrkt_open_tp/stex_tp),
ka10032 때와 같은 전철을 밟지 않으려 mrkt_tp도 방어적으로 같이 보냄 - **미검증**: 이
저장소엔 kiwoom MCP가 없어(로컬 PC 전용) 실호출로 확인 못 함, 배포 후 VM 로그
(`_first_list_field`의 return_code/return_msg 경고, `ka10030 array key=` info 로그)로
정상 동작 확인할 것. 특히 sort_tp='1'은 "거래량 기준"일 거라는 추정치라 순위가 이상하면
가장 먼저 의심할 파라미터."""

import logging

import kiwoom_client

logger = logging.getLogger('market_rank')

_META_KEYS = {'return_code', 'return_msg'}


def _clean_code(stk_cd):
    """stk_cd가 "005930_AL"처럼 시장 구분 접미사(stex_tp=3 통합 조회 시 항상 붙음, 실측
    확인)가 붙어서 옴 - 순수 6자리 종목코드만 남긴다(KRX_MAP 등 다른 코드 전부 6자리 기준)."""
    return (stk_cd or '').split('_')[0]


def _clean_price(cur_prc):
    """cur_prc는 하락 종목일 때 부호가 마이너스로 옴(가격 자체가 아니라 전일대비 방향을
    나타내는 관례 - 키움 여러 TR 공통, 실측 확인) - 표시용 가격은 항상 절댓값."""
    try:
        return abs(float(cur_prc or 0))
    except (TypeError, ValueError):
        return 0.0


def _first_list_field(res, tr_id):
    for key, val in res.items():
        if key in _META_KEYS:
            continue
        if isinstance(val, list):
            return val, key
    # TEMP DEBUG(2026-07-20): return_code!=0(TR 자체 에러 거부)인 경우를 구분하기 위해
    # 메타 필드 값도 같이 찍는다 - 원인 파악 후(코드 정리 시) 이 필드값 로그는 지워도 됨.
    logger.warning('%s 응답에서 리스트 필드를 못 찾음 - return_code=%s return_msg=%s raw keys=%s',
                    tr_id, res.get('return_code'), res.get('return_msg'), list(res.keys()))
    return [], None


def fetch_volume_top(token, limit=5):
    """당일거래량상위요청(ka10030). kiwoom_api.md 문서의 필수 파라미터 목록 기준 - 미검증
    (2026-07-22, 위 모듈 docstring 참고). '전체/제외 안 함' 계열 값은 이 파일의 ka10017
    호출 관례(0/0000='전체')를 그대로 따름."""
    res = kiwoom_client.call_tr(token, 'ka10030', '/api/dostk/rkinfo', {
        'mrkt_tp': '000',        # 000:전체 (ka10032 사례처럼 문서에 없어도 방어적으로 포함)
        'sort_tp': '1',          # 추정: 1=거래량순 (미검증 - 순위가 이상하면 최우선 의심)
        'mang_stk_incls': '0',   # 관리종목 제외
        'crd_tp': '0',           # 신용구분 전체
        'trde_qty_tp': '0000',   # 거래량구분 전체
        'pric_tp': '0',          # 가격구분 전체
        'trde_prica_tp': '0',    # 거래대금구분 전체
        'mrkt_open_tp': '0',     # 장운영구분 전체
        'stex_tp': '3',          # 통합(KRX+NXT) - 다른 TR과 일관성(kis_client.py 등)
    })
    rows, key = _first_list_field(res, 'ka10030')
    if key:
        logger.info('ka10030 array key=%s (첫 확인이면 이 값으로 코드 주석 정리할 것)', key)
    out = []
    for r in rows:
        try:
            out.append({
                'code': _clean_code(r.get('stk_cd')),
                'name': r.get('stk_nm'),
                'price': _clean_price(r.get('cur_prc')),
                'change_rate': float(r.get('flu_rt') or 0),
                'trade_volume': float(r.get('trde_qty') or 0),  # 주 단위(원시값, 환산 없음)
            })
        except (TypeError, ValueError):
            continue
    return out[:limit]


def fetch_updown(token, updown_tp, limit=5):
    """상하한가요청(ka10017). updown_tp 공식 코드값(키움 공식 예제 기준, 2026-07-20 확인):
    1=상한, 2=상승, 3=보합, 4=하한, 5=하락, 6=전일상한, 7=전일하한 - 처음엔 '2'를 하한가로
    잘못 짐작해서 실제로는 "상승" 종목을 하한가로 표시하는 버그가 있었음(실측 전 추정치였음).
    응답이 오면 flu_rt 부호(상한가는 양수, 하한가는 음수)로 한 번 더 교차검증해서 뒤바뀌어
    있으면 fetch_sidebar_rank에서 바로잡는다(kis_client.fetch_option_board의 delta_val
    교차검증과 동일 패턴 - 이중 방어)."""
    res = kiwoom_client.call_tr(token, 'ka10017', '/api/dostk/stkinfo', {
        'mrkt_tp': '000',       # 000:전체
        'updown_tp': updown_tp,
        'sort_tp': '3',         # 3:등락률순
        'stk_cnd': '0',         # 0:전체조회
        'trde_qty_tp': '0000',  # 0000:전체조회(키움 예제의 실제 호출값 그대로)
        'crd_cnd': '0',         # 0:전체조회
        'trde_gold_tp': '0',    # 0:전체조회
        'stex_tp': '3',
    })
    rows, key = _first_list_field(res, 'ka10017(updown_tp=%s)' % updown_tp)
    if key:
        logger.info('ka10017(updown_tp=%s) array key=%s', updown_tp, key)
    out = []
    for r in rows:
        try:
            out.append({
                'code': _clean_code(r.get('stk_cd')),
                'name': r.get('stk_nm'),
                'price': _clean_price(r.get('cur_prc')),
                'change_rate': float(r.get('flu_rt') or 0),
            })
        except (TypeError, ValueError):
            continue
    return out[:limit]


def fetch_sidebar_rank(token, limit=5):
    volume = fetch_volume_top(token, limit)
    upper = fetch_updown(token, '1', limit)  # 1=상한
    lower = fetch_updown(token, '4', limit)  # 4=하한
    # 방어적 교차검증: 상한가로 요청한 결과에 음수 등락률이 섞여 있으면(=코드값이 반대)
    # 두 리스트를 통째로 맞바꾼다.
    if upper and all(r['change_rate'] < 0 for r in upper) and lower and all(r['change_rate'] > 0 for r in lower):
        logger.warning('ka10017 updown_tp 1/2가 예상과 반대로 응답됨 - swap')
        upper, lower = lower, upper
    return {'tradeVolume': volume, 'upperLimit': upper, 'lowerLimit': lower}
