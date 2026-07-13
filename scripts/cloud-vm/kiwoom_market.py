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


def fetch_daily_ohlc(token, code, max_days=OHLC_MIN_DAYS):
    """일봉 OHLC를 오름차순(과거->최신)으로 반환. gas의 fetchDailyOhlc_()와 동일한 행 형식
    ({date, open, high, low, close, volume})을 쓴다. 데이터가 max_days에 못 미치면
    (신규상장 등) 있는 만큼만 반환 - 호출부가 길이 체크로 스킵 여부를 판단한다.
    max_days=None이면 ka10081 한 번 호출로 나오는 만큼(종목마다 다르지만 보통 600영업일 안팎,
    2년 반 정도) 전부 반환 - 종목분석 가격차트(getFlowChart)용."""
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
    if max_days and len(out) > max_days:
        out = out[-max_days:]
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


def fetch_foreign_inst_daily(token, code):
    """종목분석 메인 수급 표(외국인·기관 순매매 + 외국인 보유주수/비중)용 - ka10045(기관/
    외국인 순매매)와 ka10008(외국인 보유주수/비중)을 날짜로 합쳐 gas의 parseFrgnRows()
    (네이버 frgn.naver 파싱 결과)와 동일한 행 형식으로 반환한다: {date, close, change_pct,
    volume, inst_net, foreign_net, foreign_shares, foreign_ratio} - 최신일 우선.
    fetch_institution_trend()과 별도 함수로 둔 이유: daily_scan.py(전종목 배치)는
    foreign_shares/foreign_ratio가 필요 없어서 ka10008 추가 호출을 안 하는 가벼운 버전을
    그대로 쓰고, 이 함수는 종목분석 페이지 온디맨드 조회 전용으로만 쓴다."""
    end = datetime.now()
    start = end - timedelta(days=FLOW_LOOKBACK_DAYS)
    strt_dt, end_dt = start.strftime('%Y%m%d'), end.strftime('%Y%m%d')

    inst_res = kiwoom_client.call_tr(token, 'ka10045', '/api/dostk/mrkcond', {
        'stk_cd': code,
        'strt_dt': strt_dt,
        'end_dt': end_dt,
        'orgn_prsm_unp_tp': '1',
        'for_prsm_unp_tp': '1',
    })
    frgn_res = kiwoom_client.call_tr(token, 'ka10008', '/api/dostk/frgnistt', {'stk_cd': code})

    frgn_by_date = {}
    for r in (frgn_res.get('stk_frgnr') or []):
        dt = r.get('dt')
        if dt:
            frgn_by_date[dt] = r

    out = []
    seen = set()
    for r in (inst_res.get('stk_orgn_trde_trnsn') or []):
        dt = r.get('dt')
        if not dt or dt in seen:
            continue
        seen.add(dt)
        frgn_row = frgn_by_date.get(dt)
        out.append({
            'date': '%s-%s-%s' % (dt[0:4], dt[4:6], dt[6:8]),
            'close': abs(to_num(r.get('close_pric'))),
            'change_pct': to_num(r.get('flu_rt')),
            'volume': abs(to_num(r.get('trde_qty'))),
            'inst_net': to_num(r.get('orgn_daly_nettrde_qty')),
            'foreign_net': to_num(r.get('for_daly_nettrde_qty')),
            'foreign_shares': abs(to_num(frgn_row.get('poss_stkcnt'))) if frgn_row else None,
            'foreign_ratio': to_num(frgn_row.get('wght')) if frgn_row else None,
        })

    out.sort(key=lambda r: r['date'], reverse=True)  # 최신일 우선 - gas getForeignFlow와 동일
    return out
