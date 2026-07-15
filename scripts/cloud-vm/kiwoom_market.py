# -*- coding: utf-8 -*-
"""일봉 OHLC(ka10081)와 종목별 기관/외국인 일별 매매추이(ka10045) 조회.
gas/ticker-proxy.gs의 fetchDailyOhlc_/getForeignFlow(네이버 크롤링)를 대체하는
공식 키움 API 버전 - daily_scan.py(패턴/눌림목/투자시그널 배치)가 사용한다."""

from datetime import datetime, timedelta

import kiwoom_client

OHLC_MIN_DAYS = 100   # gas의 PATTERN_PAGES(10p*10행=100영업일)와 동일 기준
OHLC_SNAPSHOT_DAYS = 500  # daily_scan.py가 SQLite(daily_prices)에 저장하는 일수 - 일목균형표 구름대/224일선 스캐너 + 장기 추세 분석 여유분(260->500, 2026-07-14). 디스크 실측 550일=290MB(daily_prices+investor_flow_daily 합산)라 30GB 기준 부담 없음. ka10081 단일 호출로 최대 ~600영업일까지 나와서 API 추가 호출 없이 커버됨.
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


def _fetch_live_investor_row(token, code, end_dt):
    """ka10059(종목별투자자기관별요청)의 오늘 행 - ka10045는 '일별' 확정 TR이라 당일 값이
    정산 전에는 안 채워지는데, ka10059는 장중 누적치를 실시간으로 반환한다.
    2026-07-15 실측 확인: amt_qty_tp='1'은 "수량"이 아니라 "금액"(백만원 단위)이었음 -
    Toss/키움HTS 실제 수량과 대조해 검증됨(예: -863(금액,백만원)/종가 ≈ -19,135주 ≈
    amt_qty_tp='2'의 -19(천주)*1000과 거의 일치). '2'(수량, 천주 단위)로 바꾸고 *1000
    보정. 외국인은 이 보정 후에도 Toss 대비 절반 정도로 나오는데, 이건 "순수 외국인"과
    "외국계 전체"(ka10063의 frgn_all 파라미터로 미루어 실존하는 구분) 집계 기준 차이로
    보이며 파라미터로 해소되지 않아 알려진 한계로 남겨둠. 반환된 dt가 end_dt(오늘)와
    다르면(휴장일 등) None을 돌려줘 호출부가 ka10045 결과를 그대로 쓰게 한다."""
    try:
        res = kiwoom_client.call_tr(token, 'ka10059', '/api/dostk/stkinfo', {
            'stk_cd': code, 'dt': end_dt, 'amt_qty_tp': '2', 'trde_tp': '0', 'unit_tp': '1',
        })
    except Exception:
        return None
    rows = res.get('stk_invsr_orgn') or []
    if not rows:
        return None
    today = sorted(rows, key=lambda r: r.get('dt', ''), reverse=True)[0]
    if today.get('dt') != end_dt:
        return None
    return {
        'close': abs(to_num(today.get('cur_prc'))),
        # ka10059의 flu_rt는 ka10045와 달리 소수점 없는 100배 정수 문자열("+627"=6.27%)이라 /100 필요
        'change_pct': to_num(today.get('flu_rt')) / 100,
        'volume': abs(to_num(today.get('acc_trde_qty'))),
        # amt_qty_tp='2'는 천주 단위로 내려와서 실제 주식수로 환산
        'inst_net': to_num(today.get('orgn')) * 1000,
        'foreign_net': to_num(today.get('frgnr_invsr')) * 1000,
    }


def fetch_foreign_inst_daily(token, code):
    """종목분석 메인 수급 표(외국인·기관 순매매 + 외국인 보유주수/비중)용 - ka10045(기관/
    외국인 순매매)와 ka10008(외국인 보유주수/비중)을 날짜로 합쳐 gas의 parseFrgnRows()
    (네이버 frgn.naver 파싱 결과)와 동일한 행 형식으로 반환한다: {date, close, change_pct,
    volume, inst_net, foreign_net, foreign_shares, foreign_ratio} - 최신일 우선.
    fetch_institution_trend()과 별도 함수로 둔 이유: daily_scan.py(전종목 배치)는
    foreign_shares/foreign_ratio가 필요 없어서 ka10008 추가 호출을 안 하는 가벼운 버전을
    그대로 쓰고, 이 함수는 종목분석 페이지 온디맨드 조회 전용으로만 쓴다.
    2026-07-15: ka10045의 당일 행은 정산 전까지 비거나 늦게 채워져서(토스/키움 앱 자체
    수급 화면과 시차 발생), _fetch_live_investor_row()의 ka10059 실시간 누적치로 오늘 행만
    덮어쓰거나(이미 있으면) 새로 앞에 끼워넣는다(없으면). 과거 행과 foreign_shares/
    foreign_ratio는 그대로 ka10045/ka10008 확정치를 쓴다."""
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

    today_str = '%s-%s-%s' % (end_dt[0:4], end_dt[4:6], end_dt[6:8])
    live_row = _fetch_live_investor_row(token, code, end_dt)
    if live_row:
        if out and out[0]['date'] == today_str:
            out[0].update(live_row)
        else:
            out.insert(0, dict(live_row, date=today_str, foreign_shares=None, foreign_ratio=None))

    # 오늘 행은 ka10008이 아직 당일 보유주수/비중을 안 내놨을 수 있어 None일 수 있는데,
    # 프론트 보유율 차트(js/foreign-flow.js buildRatioChart)가 null에 그대로 toFixed()를
    # 호출해 죽는다 - 직전 확정일 값을 이어붙여 방지(비중은 하루새 급변하지 않아 근사로 안전).
    last_shares = last_ratio = None
    for r in reversed(out):
        if r['foreign_shares'] is not None:
            last_shares = r['foreign_shares']
        elif last_shares is not None:
            r['foreign_shares'] = last_shares
        if r['foreign_ratio'] is not None:
            last_ratio = r['foreign_ratio']
        elif last_ratio is not None:
            r['foreign_ratio'] = last_ratio

    return out
