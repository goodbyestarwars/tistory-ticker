# -*- coding: utf-8 -*-
"""일봉 OHLC(ka10081)와 종목별 기관/외국인 일별 매매추이(ka10045) 조회.
gas/ticker-proxy.gs의 fetchDailyOhlc_/getForeignFlow(네이버 크롤링)를 대체하는
공식 키움 API 버전 - daily_scan.py(패턴/눌림목/투자시그널 배치)가 사용한다."""

from datetime import datetime, timedelta

import kiwoom_client

OHLC_MIN_DAYS = 100   # gas의 PATTERN_PAGES(10p*10행=100영업일)와 동일 기준
FLOW_LOOKBACK_DAYS = 60  # 달력일 기준 - 영업일로 환산하면 40영업일(gas FRGN_PAGES=2*20행)를 넉넉히 커버


def to_num(v):
    try:
        return float(str(v).replace(',', '').replace('+', ''))
    except (TypeError, ValueError):
        return 0.0


def fetch_daily_ohlc(token, code):
    """일봉 OHLC를 오름차순(과거->최신)으로 반환. gas의 fetchDailyOhlc_()와 동일한 행 형식
    ({date, open, high, low, close, volume})을 쓴다. 데이터가 OHLC_MIN_DAYS에 못 미치면
    (신규상장 등) 있는 만큼만 반환 - 호출부가 길이 체크로 스킵 여부를 판단한다."""
    res = kiwoom_client.call_tr(token, 'ka10081', '/api/dostk/chart', {
        'stk_cd': code,
        'base_dt': datetime.now().strftime('%Y%m%d'),
        'upd_stkpc_tp': '1',
    })
    rows = res.get('stk_dt_pole_chart_qry') or []

    out = []
    seen = set()
    for r in rows:
        dt = r.get('dt')
        if not dt or dt in seen:
            continue
        seen.add(dt)
        out.append({
            'date': '%s-%s-%s' % (dt[0:4], dt[4:6], dt[6:8]),
            'open': abs(to_num(r.get('open_pric'))),
            'high': abs(to_num(r.get('high_pric'))),
            'low': abs(to_num(r.get('low_pric'))),
            'close': abs(to_num(r.get('cur_prc'))),
            'volume': abs(to_num(r.get('trde_qty'))),
        })

    out.sort(key=lambda r: r['date'])  # 오름차순(과거->최신) - gas fetchDailyOhlc_와 동일
    if len(out) > OHLC_MIN_DAYS:
        out = out[-OHLC_MIN_DAYS:]
    return out


def fetch_institution_trend(token, code):
    """외국인/기관 일별 순매매 추이를 최신일 우선(내림차순)으로 반환. gas의
    getForeignFlow()가 반환하는 daily 배열과 같은 필드({date, close, change_pct,
    foreign_net, inst_net})를 쓴다(foreign_shares/foreign_ratio는 이 TR에 없어 생략 -
    invest_signal.py의 점수 계산은 그 두 필드를 쓰지 않아 무해)."""
    end = datetime.now()
    start = end - timedelta(days=FLOW_LOOKBACK_DAYS)
    res = kiwoom_client.call_tr(token, 'ka10045', '/api/dostk/mrkcond', {
        'stk_cd': code,
        'strt_dt': start.strftime('%Y%m%d'),
        'end_dt': end.strftime('%Y%m%d'),
        'orgn_prsm_unp_tp': '1',
        'for_prsm_unp_tp': '1',
    })
    rows = res.get('stk_orgn_trde_trnsn') or []

    out = []
    seen = set()
    for r in rows:
        dt = r.get('dt')
        if not dt or dt in seen:
            continue
        seen.add(dt)
        out.append({
            'date': '%s-%s-%s' % (dt[0:4], dt[4:6], dt[6:8]),
            'close': abs(to_num(r.get('close_pric'))),
            'change_pct': to_num(r.get('flu_rt')),
            'foreign_net': to_num(r.get('for_daly_nettrde_qty')),
            'inst_net': to_num(r.get('orgn_daly_nettrde_qty')),
        })

    out.sort(key=lambda r: r['date'], reverse=True)  # 최신일 우선 - gas getForeignFlow와 동일
    return out
