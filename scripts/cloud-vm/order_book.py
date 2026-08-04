# -*- coding: utf-8 -*-
"""실시간 호가창(매도/매수 각 10단계) - 주식호가요청(ka10004) 직접 호출.

**필드명 미검증**: kiwoom_api.md의 "응답 주요 필드" 요약이 매도6~10차선까지만 나열하고
있어(생성기가 필드 목록을 자르는 문서 특성 - market_rank.py 사례와 동일), 매도1~5차선과
매수 전체는 같은 명명 규칙(sel_{N}th_pre_bid/req/req_pre, buy_{N}th_pre_bid/req/req_pre)을
그대로 확장한 추정치다. 배포 후 응답에서 asks/bids가 계속 비면 아래 경고 로그(raw keys)로
실제 필드명을 확인하고 바로잡을 것 - market_rank.py의 _first_list_field와 같은 검증 절차.

현재가/등락률은 이미 검증된 GAS 시세 프록시를 프론트에서 그대로 재사용하므로(js/order-book.js
참고) 여기서는 매도/매수 잔량 사다리만 반환한다."""

import logging

import kiwoom_client

logger = logging.getLogger('order_book')

_LEVELS = range(1, 11)


def _num(v):
    try:
        return abs(float(v or 0))
    except (TypeError, ValueError):
        return 0.0


def _al_code(code):
    """KRX+NXT 통합 조회용 종목코드 접미사(2026-08-05, 사용자 제공 안내 - 문서상 100%
    확정은 아님). 이 접미사가 해당 TR에서 안 먹히면(빈 응답) 호출부가 원래 code로
    재시도하므로, 여기서 실패해도 기존 동작(KRX 단독)이 깨지지 않는다."""
    return code + '_AL'


def _parse_levels(res):
    asks = []
    bids = []
    for n in _LEVELS:
        ask_price = res.get('sel_%dth_pre_bid' % n)
        ask_qty = res.get('sel_%dth_pre_req' % n)
        if ask_price is not None or ask_qty is not None:
            asks.append({'price': _num(ask_price), 'qty': _num(ask_qty)})
        bid_price = res.get('buy_%dth_pre_bid' % n)
        bid_qty = res.get('buy_%dth_pre_req' % n)
        if bid_price is not None or bid_qty is not None:
            bids.append({'price': _num(bid_price), 'qty': _num(bid_qty)})
    return asks, bids


def fetch_order_book(token, code):
    """2026-08-05: KRX+NXT 통합 호가를 시도하려고 stk_cd에 '_AL' 접미사를 먼저 붙여
    호출하고, 응답이 비어있으면(TR이 이 접미사를 모르거나 오류) 원래 code로 한 번 더
    조회해 기존 동작으로 폴백한다 - 통합 시도가 실패해도 라이브 기능은 안 깨짐."""
    res = kiwoom_client.call_tr(token, 'ka10004', '/api/dostk/mrkcond', {'stk_cd': _al_code(code)})
    asks, bids = _parse_levels(res)
    if not asks and not bids:
        logger.warning('ka10004(%s_AL) 빈 응답 - 일반 코드로 재시도', code)
        res = kiwoom_client.call_tr(token, 'ka10004', '/api/dostk/mrkcond', {'stk_cd': code})
        if res.get('return_code') not in (0, '0', None):
            logger.warning('ka10004(%s) 응답 오류 - return_code=%s return_msg=%s',
                            code, res.get('return_code'), res.get('return_msg'))
        asks, bids = _parse_levels(res)
        if not asks and not bids:
            logger.warning('ka10004(%s) 응답에서 호가 필드를 하나도 못 찾음 - raw keys=%s', code, list(res.keys()))

    # 매도는 화면에 높은 가격이 위로(현재가에 가까운 1차선이 아래) 가야 하는 HTS 관례 -
    # 응답 파싱 순서와 무관하게 항상 가격 내림차순으로 재정렬한다.
    asks.sort(key=lambda x: x['price'], reverse=True)
    # 매수는 현재가에 가까운 1차선(최고 매수호가)이 위로 오도록 동일하게 내림차순.
    bids.sort(key=lambda x: x['price'], reverse=True)

    return {
        'code': code,
        'asks': asks,
        'bids': bids,
        'totalAskQty': sum(a['qty'] for a in asks),
        'totalBidQty': sum(b['qty'] for b in bids),
        'stexTp': res.get('stex_tp'),  # 거래소구분 - _AL 접미사가 실제로 통합됐는지 확인용
    }


def fetch_trade(token, code):
    """체결정보요청(ka10003) - 조회 시점 마지막 체결 1건(시간/체결가/체결량/체결강도) 스냅샷.
    문서상 리스트를 감싸는 배열 키가 없어(ka10004와 동일하게 최상위 필드로 바로 옴) 매
    호출마다 "그 순간의 마지막 체결" 하나만 돌려주는 TR로 보인다 - 그래서 프론트가 2초
    폴링마다 이 스냅샷을 누적해 '최근 체결' 리스트를 client-side로 구성한다. 실제 체결
    스트림(0B 웹소켓)만큼 촘촘하진 않아서 폴링 간격보다 빨리 일어난 체결은 놓칠 수 있는
    근사치다 - js/order-book.js의 dedupe 로직 참고. 필드명은 kiwoom_api.md 문서 기준으로
    미검증(order_book.py 파일 상단 ka10004 사례와 동일 주의).
    2026-08-05: fetch_order_book과 동일하게 '_AL' 통합 코드를 먼저 시도하고, 시각(tm)이
    없으면(빈 응답) 원래 code로 재시도한다."""
    res = kiwoom_client.call_tr(token, 'ka10003', '/api/dostk/stkinfo', {'stk_cd': _al_code(code)})
    if not res.get('tm'):
        res = kiwoom_client.call_tr(token, 'ka10003', '/api/dostk/stkinfo', {'stk_cd': code})
    if res.get('return_code') not in (0, '0', None):
        logger.warning('ka10003(%s) 응답 오류 - return_code=%s return_msg=%s',
                        code, res.get('return_code'), res.get('return_msg'))
    try:
        pred_pre = float(res.get('pred_pre') or 0)
    except (TypeError, ValueError):
        pred_pre = 0.0
    return {
        'time': res.get('tm'),
        'price': _num(res.get('cur_prc')),
        'qty': _num(res.get('cntr_trde_qty')),
        'up': pred_pre > 0,
        'down': pred_pre < 0,
    }


def fetch_execution_strength(token, code):
    """체결강도추이시간별요청(ka10046) - 진짜 체결강도(틱 기준, 키움이 직접 계산해서 줌).
    2026-08-05 공식 문서로 요청/응답 확정: body는 stk_cd 하나뿐이고, 응답
    cntr_str_tm(리스트, 최신이 맨 앞으로 추정 - 예시 응답의 시각이 163713 -> 163500 ->
    163016 순으로 내림차순)의 각 원소에 cntr_str(현재)/cntr_str_5min/cntr_str_20min/
    cntr_str_60min(전부 %, 문자열)이 들어있다. 장 시간 외에는 최근 틱이 없어 빈 리스트가
    정상 응답으로 옴(에러 아님) - 그럴 땐 None을 반환해 호출부가 기존 근사치로 폴백하게 한다.
    '_AL' 통합 코드가 빈 리스트를 주면 원래 code로 한 번 더 시도(장 시간 외 빈 응답과
    _AL 접미사 미지원을 구분 못 하지만, 둘 다 결국 None 처리라 결과는 동일하게 안전)."""
    res = kiwoom_client.call_tr(token, 'ka10046', '/api/dostk/mrkcond', {'stk_cd': _al_code(code)})
    rows = res.get('cntr_str_tm') or []
    if not rows:
        res = kiwoom_client.call_tr(token, 'ka10046', '/api/dostk/mrkcond', {'stk_cd': code})
        rows = res.get('cntr_str_tm') or []
    if res.get('return_code') not in (0, '0', None):
        logger.warning('ka10046(%s) 응답 오류 - return_code=%s return_msg=%s',
                        code, res.get('return_code'), res.get('return_msg'))
        return None
    if not rows:
        return None
    latest = rows[0]
    return {
        'value': _num(latest.get('cntr_str')),
        'value5min': _num(latest.get('cntr_str_5min')),
        'value20min': _num(latest.get('cntr_str_20min')),
        'value60min': _num(latest.get('cntr_str_60min')),
        'stexTp': latest.get('stex_tp'),  # 거래소구분 - _AL 접미사 통합 여부 확인용
    }


def fetch_order_book_full(token, code):
    """호가 사다리(ka10004) + 최근 체결 스냅샷(ka10003) + 체결강도(ka10046)를 한 응답으로
    합친다 - 프론트가 2초 폴링 한 번으로 다 받도록. 각 조회가 실패해도 나머지는 그대로
    표시돼야 하므로 독립적으로 실패를 흡수한다. strength는 장 시간 외엔 정상적으로 None
    (js/order-book.js가 그럴 땐 기존 근사치로 폴백)."""
    data = fetch_order_book(token, code)
    try:
        data['trade'] = fetch_trade(token, code)
    except Exception as e:
        logger.warning('ka10003(%s) 체결 조회 실패: %s', code, e)
        data['trade'] = None
    try:
        data['strength'] = fetch_execution_strength(token, code)
    except Exception as e:
        logger.warning('ka10046(%s) 체결강도 조회 실패: %s', code, e)
        data['strength'] = None
    return data
