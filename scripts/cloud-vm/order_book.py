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


def fetch_order_book(token, code):
    res = kiwoom_client.call_tr(token, 'ka10004', '/api/dostk/mrkcond', {'stk_cd': code})
    if res.get('return_code') not in (0, '0', None):
        logger.warning('ka10004(%s) 응답 오류 - return_code=%s return_msg=%s',
                        code, res.get('return_code'), res.get('return_msg'))

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
    }
