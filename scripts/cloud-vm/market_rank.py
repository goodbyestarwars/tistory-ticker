# -*- coding: utf-8 -*-
"""사이드바 실시간 랭킹(거래대금 TOP/상한가/하한가) - 키움 REST 랭킹정보 TR 직접 호출.
전종목을 우리가 스캔해서 순위를 계산하는 대신, 키움이 이미 계산해둔 랭킹 TR을 그대로
재사용한다(작업지시서: 9bolt 우측 사이드바 리디자인, 2026-07-20 - 인기글/해시태그를
실시간 시장데이터로 교체).

거래대금상위요청(ka10032)/상하한가요청(ka10017) 둘 다 공식 레퍼런스 문서엔 응답의 개별
행 필드만 나오고, 배열 전체를 감싸는 최상위 키 이름은 안 나와 있다(이 저장소의 다른 TR도
ka10059->stk_invsr_orgn, ka10045->stk_orgn_trde_trnsn처럼 TR마다 제각각이라 짐작이
위험함 - kiwoom_market.py 참고). 그래서 이름을 짐작하는 대신, 응답에서 "리스트 타입인
필드"를 그대로 찾아 쓴다(return_code/return_msg 등 메타 필드는 스칼라라 자동으로 걸러짐) -
행 하나가 잘못된 스키마면 _normalize_*가 조용히 빈 딕셔너리로 처리해 죽지 않는다."""

import logging

import kiwoom_client

logger = logging.getLogger('market_rank')

_META_KEYS = {'return_code', 'return_msg'}


def _first_list_field(res, tr_id):
    for key, val in res.items():
        if key in _META_KEYS:
            continue
        if isinstance(val, list):
            return val, key
    logger.warning('%s 응답에서 리스트 필드를 못 찾음 - raw keys: %s', tr_id, list(res.keys()))
    return [], None


def fetch_amount_top(token, limit=5):
    """거래대금상위요청(ka10032)."""
    res = kiwoom_client.call_tr(token, 'ka10032', '/api/dostk/rkinfo', {
        'mang_stk_incls': '0',  # 관리종목 제외
        'stex_tp': '3',         # 통합(KRX+NXT) - 다른 TR과 일관성(kis_client.py 등)
    })
    rows, key = _first_list_field(res, 'ka10032')
    if key:
        logger.info('ka10032 array key=%s (첫 확인이면 이 값으로 코드 주석 정리할 것)', key)
    out = []
    for r in rows:
        try:
            out.append({
                'code': r.get('stk_cd'),
                'name': r.get('stk_nm'),
                'price': float(r.get('cur_prc') or 0),
                'change_rate': float(r.get('flu_rt') or 0),
                'trade_amount': float(r.get('trde_prica') or 0),
            })
        except (TypeError, ValueError):
            continue
    return out[:limit]


def fetch_updown(token, updown_tp, limit=5):
    """상하한가요청(ka10017). updown_tp: '1'=상한가, '2'=하한가로 추정(공식 문서에 코드값
    설명이 없어 실측 필요) - 응답이 오면 flu_rt 부호(상한가는 양수, 하한가는 음수)로
    한 번 더 교차검증해서 뒤바뀌어 있으면 여기서 바로잡는다(kis_client.fetch_option_board의
    delta_val 교차검증과 동일 패턴)."""
    res = kiwoom_client.call_tr(token, 'ka10017', '/api/dostk/stkinfo', {
        'updown_tp': updown_tp,
        'sort_tp': '1',
        'stk_cnd': '0',
        'trde_qty_tp': '0',
        'crd_cnd': '0',
        'trde_gold_tp': '0',
        'stex_tp': '3',
    })
    rows, key = _first_list_field(res, 'ka10017(updown_tp=%s)' % updown_tp)
    if key:
        logger.info('ka10017(updown_tp=%s) array key=%s', updown_tp, key)
    out = []
    for r in rows:
        try:
            out.append({
                'code': r.get('stk_cd'),
                'name': r.get('stk_nm'),
                'price': float(r.get('cur_prc') or 0),
                'change_rate': float(r.get('flu_rt') or 0),
            })
        except (TypeError, ValueError):
            continue
    return out[:limit]


def fetch_sidebar_rank(token, limit=5):
    amount = fetch_amount_top(token, limit)
    upper = fetch_updown(token, '1', limit)
    lower = fetch_updown(token, '2', limit)
    # 방어적 교차검증: 상한가로 요청한 결과에 음수 등락률이 섞여 있으면(=코드값이 반대)
    # 두 리스트를 통째로 맞바꾼다.
    if upper and all(r['change_rate'] < 0 for r in upper) and lower and all(r['change_rate'] > 0 for r in lower):
        logger.warning('ka10017 updown_tp 1/2가 예상과 반대로 응답됨 - swap')
        upper, lower = lower, upper
    return {'tradeAmount': amount, 'upperLimit': upper, 'lowerLimit': lower}
