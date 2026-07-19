# -*- coding: utf-8 -*-
"""일봉 OHLC(ka10081)와 종목별 기관/외국인 일별 매매추이(ka10045) 조회.
gas/ticker-proxy.gs의 fetchDailyOhlc_/getForeignFlow(네이버 크롤링)를 대체하는
공식 키움 API 버전 - daily_scan.py(패턴/눌림목/투자시그널 배치)가 사용한다."""

import logging
import time
from datetime import datetime, timedelta

import kis_client
import kiwoom_client

logger = logging.getLogger('kiwoom_market')

OHLC_MIN_DAYS = 100   # gas의 PATTERN_PAGES(10p*10행=100영업일)와 동일 기준
OHLC_SNAPSHOT_DAYS = 500  # daily_scan.py가 SQLite(daily_prices)에 저장하는 일수 - 일목균형표 구름대/224일선 스캐너 + 장기 추세 분석 여유분(260->500, 2026-07-14). 디스크 실측 550일=290MB(daily_prices+investor_flow_daily 합산)라 30GB 기준 부담 없음. ka10081 단일 호출로 최대 ~600영업일까지 나와서 API 추가 호출 없이 커버됨.
FLOW_LOOKBACK_DAYS = 60  # 달력일 기준 - 영업일로 환산하면 40영업일(gas FRGN_PAGES=2*20행)를 넉넉히 커버
# 2026-07-19(3차): 기간 선택 최댓값을 1년(252)->3개월(63)로 축소(사용자 피드백 - 1년까지는
# 필요 없고 5일/10일/20일/2개월/3개월이 실제로 쓰는 단위). 기본치도 63으로 올려서(예전
# 30) 표의 "3개월 합산" 행이 최초 로드 때부터 항상 데이터를 갖도록 함 - 표 집계 구간은
# 기간 선택 버튼과 무관하게 항상 최신 기준으로 고정이라(foreign_flow_compute.py) 기본
# 로드 시 최소 63일치가 있어야 3개월 합산이 온전하다.
FLOW_DEFAULT_DAYS = 63
FLOW_MAX_KIS_PAGES = 5  # 최댓값 3개월(63영업일)=KIS 3회 호출이면 충분, 여유분 포함 5회 상한
KIS_PAGE_THROTTLE_SEC = 0.15


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


def _fetch_ka10059_rows(token, code, end_dt):
    """ka10059(종목별투자자기관별요청) 원본 행 목록 - dt=오늘로 호출해도 최근 ~100영업일치가
    한 번에 옴(2026-07-18 실측 확인). 개인(ind_invsr) 순매매는 ka10045에 없어서 이 TR에서만
    구할 수 있는데, 굳이 별도 호출을 또 만들지 않고 아래 두 소비 함수(오늘 실시간 행 /
    개인 순매매 날짜별 시리즈)가 이 한 번의 응답을 나눠 쓴다.
    2026-07-15 실측 확인: amt_qty_tp='1'은 "수량"이 아니라 "금액"(백만원 단위)이었음 -
    '2'(수량)로 바꿔야 진짜 주식수가 나온다. unit_tp='1'로 호출하면(이 코드처럼) 이미
    "천주" 아닌 정확한 주식수 그대로 내려온다(Toss/키움HTS 실측과 소수 오차 내로 일치
    확인됨) - 별도 *1000 배율이 필요 없다(처음엔 MCP 도구로 확인했을 때 "-19" 같은 천주
    단위 값을 봐서 *1000이 맞다고 착각했는데, 그 MCP 도구는 unit_tp를 노출 안 해서 내부
    기본값이 여기와 달랐던 것 - 실제 배포 후 -19,259,000처럼 1000배 부풀려진 걸 보고
    발견해 되돌림). 외국인은 이 수정 후에도 Toss 대비 다소 차이가 있는데, 이건 "순수
    외국인"과 "외국계 전체"(ka10063의 frgn_all 파라미터로 미루어 실존하는 구분) 집계
    기준 차이로 보이며 파라미터로 해소되지 않아 알려진 한계로 남겨둠."""
    try:
        res = kiwoom_client.call_tr(token, 'ka10059', '/api/dostk/stkinfo', {
            'stk_cd': code, 'dt': end_dt, 'amt_qty_tp': '2', 'trde_tp': '0', 'unit_tp': '1',
        })
    except Exception:
        return []
    return res.get('stk_invsr_orgn') or []


def _live_investor_row_from(rows, end_dt):
    """ka10059 응답에서 '오늘' 행만 뽑는다 - ka10045는 '일별' 확정 TR이라 당일 값이 정산
    전에는 안 채워지는데, ka10059는 장중 누적치를 실시간으로 반환하기 때문. 최신 행의
    dt가 end_dt(오늘)와 다르면(휴장일 등) None을 돌려줘 호출부가 ka10045 결과를 그대로
    쓰게 한다."""
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
        'inst_net': to_num(today.get('orgn')),
        'foreign_net': to_num(today.get('frgnr_invsr')),
        'ind_net': to_num(today.get('ind_invsr')),
    }


def _by_date_from(rows, field):
    """ka10059 응답 전체에서 날짜별 특정 필드만 뽑는다. 반환 키는 'YYYYMMDD'."""
    return {r['dt']: to_num(r.get(field)) for r in rows if r.get('dt')}


def _frgn_by_date_from_ka10008(frgn_res):
    """ka10008(외국인 보유주수/비중) 응답을 날짜별 dict로. KIS 전환 후에도 이 TR만은 그대로
    쓴다 - KIS의 종목별투자자매매동향(일별)엔 보유주수/비중 필드가 없음(2026-07-19 확인)."""
    out = {}
    for r in (frgn_res.get('stk_frgnr') or []):
        dt = r.get('dt')
        if dt:
            out[dt] = r
    return out


def _daily_rows_from_kis(kis_appkey, kis_appsecret, code, end_dt, frgn_by_date, target_days=FLOW_DEFAULT_DAYS):
    """KIS 종목별투자자매매동향(일별)(FHPTJ04160001, FID_COND_MRKT_DIV_CODE=UN)로 종가/거래량/
    개인/기관/외국인을 채운다. 2026-07-19 실측(005930): UN(KRX+NXT 통합)으로 조회하니 종가·
    거래량·개인·기관이 Toss/키움HTS와 정확히 일치했고, 외국인은 frgn_reg_ntby_qty(등록
    외국인)가 정확히 일치(frgn_ntby_qty=등록+비등록 전체는 다름 - 기존에 알려져 있던
    "외국인 순수 vs 전체" 차이의 정체가 이거였음). 키움 ka10045/ka10059는 이 TR들에
    stex_tp(거래소구분) 파라미터 자체가 없어서(실측+3rd party 래퍼 스모크테스트로 확인,
    ka10063/ka10066처럼 stex_tp를 받는 TR은 종목별 일별 히스토리가 아니라 시장 전체
    랭킹형이라 대체 불가) NXT 체결분을 뺀 축소된 값만 나왔던 것 - 그래서 이 함수가 메인
    데이터소스가 되고 ka10045는 KIS 실패 시에만 쓰는 폴백으로 격하됨(_daily_rows_from_kiwoom).
    2026-07-19(2차): 수급 기간 선택 기능 추가 - KIS는 한 번에 date1 기준 최근 30영업일만
    주고 날짜범위 파라미터가 없어서, target_days(1개월=30/3개월=63/6개월=126/1년=252)를
    채울 때까지 이미 받은 행 중 가장 오래된 날짜의 하루 전을 다음 date1로 삼아 반복
    호출한다. 종목마다 상장일이 다르니 새 행이 하나도 안 늘면(상장일 도달 등) 즉시 멈추고,
    API 남용 방지로 FLOW_MAX_KIS_PAGES(10회=최대 약 300영업일)에서 강제 종료한다."""
    kis_token = kis_client.get_token(kis_appkey, kis_appsecret)

    rows_by_date = {}
    cursor_dt = end_dt
    for page in range(FLOW_MAX_KIS_PAGES):
        _, page_rows = kis_client.fetch_investor_trade_daily(kis_token, kis_appkey, kis_appsecret, code, cursor_dt, 'UN')
        if not page_rows:
            break
        new_dates = [r.get('stck_bsop_date') for r in page_rows if r.get('stck_bsop_date') and r.get('stck_bsop_date') not in rows_by_date]
        for r in page_rows:
            dt = r.get('stck_bsop_date')
            if dt:
                rows_by_date[dt] = r
        if len(rows_by_date) >= target_days or not new_dates:
            break
        oldest = min(rows_by_date.keys())
        cursor_dt = (datetime.strptime(oldest, '%Y%m%d') - timedelta(days=1)).strftime('%Y%m%d')
        time.sleep(KIS_PAGE_THROTTLE_SEC)

    if not rows_by_date:
        raise RuntimeError('KIS investor-trade-by-stock-daily returned no rows')

    out = []
    for dt in sorted(rows_by_date.keys(), reverse=True)[:target_days]:
        r = rows_by_date[dt]
        frgn_row = frgn_by_date.get(dt)
        out.append({
            'date': '%s-%s-%s' % (dt[0:4], dt[4:6], dt[6:8]),
            'close': abs(to_num(r.get('stck_clpr'))),
            'change_pct': to_num(r.get('prdy_ctrt')),
            'volume': abs(to_num(r.get('acml_vol'))),
            'inst_net': to_num(r.get('orgn_ntby_qty')),
            'foreign_net': to_num(r.get('frgn_reg_ntby_qty')),
            'ind_net': to_num(r.get('prsn_ntby_qty')),
            'foreign_shares': abs(to_num(frgn_row.get('poss_stkcnt'))) if frgn_row else None,
            'foreign_ratio': to_num(frgn_row.get('wght')) if frgn_row else None,
        })
    return out


def _daily_rows_from_kiwoom(token, code, end_dt, ka10059_rows, frgn_by_date, target_days=FLOW_DEFAULT_DAYS):
    """KIS 키가 없거나 KIS 호출이 실패했을 때만 쓰는 폴백 - 예전 ka10045 기반 경로.
    거래량이 NXT 미포함으로 축소돼 나오는 알려진 한계가 있음(_daily_rows_from_kis 참고).
    ka10045는 날짜범위(strt_dt~end_dt)를 한 번에 받을 수 있어 KIS처럼 여러 번 나눠 부를
    필요 없이 target_days를 영업일의 1.5배 정도 여유를 둔 달력일로 환산해 strt_dt만 넓힌다."""
    lookback_days = max(FLOW_LOOKBACK_DAYS, int(target_days * 1.6) + 10)
    start = datetime.now() - timedelta(days=lookback_days)
    inst_res = kiwoom_client.call_tr(token, 'ka10045', '/api/dostk/mrkcond', {
        'stk_cd': code,
        'strt_dt': start.strftime('%Y%m%d'),
        'end_dt': end_dt,
        'orgn_prsm_unp_tp': '1',
        'for_prsm_unp_tp': '1',
    })
    ind_by_date = _by_date_from(ka10059_rows, 'ind_invsr')
    frgn_by_date_k59 = _by_date_from(ka10059_rows, 'frgnr_invsr')

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
            'foreign_net': frgn_by_date_k59.get(dt, to_num(r.get('for_daly_nettrde_qty'))),
            'ind_net': ind_by_date.get(dt, 0.0),
            'foreign_shares': abs(to_num(frgn_row.get('poss_stkcnt'))) if frgn_row else None,
            'foreign_ratio': to_num(frgn_row.get('wght')) if frgn_row else None,
        })
    # 2026-07-19: KIS 경로(_daily_rows_from_kis)는 target_days로 정확히 잘라 반환하는데
    # 이 폴백은 lookback_days 범위 전체를 그대로 돌려주고 있었음 - 기간 선택(예: 5일)에서
    # KIS가 실패해 이 폴백으로 넘어오면 5일 대신 최대 40여일치가 나오는 불일치가 실측
    # 확인됨(라이브 /foreign-flow?days=5 응답이 40행). 여기서도 최신 target_days개로 자른다.
    out.sort(key=lambda r: r['date'], reverse=True)
    return out[:target_days]


def fetch_foreign_inst_daily(token, code, kis_appkey=None, kis_appsecret=None, target_days=FLOW_DEFAULT_DAYS):
    """종목분석 메인 수급 표(개인·외국인·기관 순매매 + 외국인 보유주수/비중)용.
    {date, close, change_pct, volume, inst_net, foreign_net, ind_net, foreign_shares,
    foreign_ratio} - 최신일 우선.
    target_days: 종목분석 페이지의 "기간 선택"(1개월=30/3개월=63/6개월=126/1년=252, 2026-07-19
    도입)에 대응 - rolling(5/10/20일 합산)·streak·signal은 daily[0..N]만 보고 항상 "가장
    최근" 기준으로 계산되므로(foreign_flow_compute.py) target_days는 순수하게 표/차트에
    보여줄 과거 일수만 늘리고 이 판정들에는 영향을 주지 않는다.
    2026-07-19: 데이터 소스를 키움 ka10045/ka10059에서 KIS(한국투자증권) 종목별투자자매매
    동향(일별)로 교체(_daily_rows_from_kis 독스트링에 원인 상세) - Toss/키움HTS와 완전히
    일치하는 걸 실측 확인함. kis_appkey/kis_appsecret이 없거나 KIS 호출이 실패하면 예전
    ka10045 경로로 자동 폴백(_daily_rows_from_kiwoom, 거래량이 낮게 나오는 한계 있는 채로).
    외국인 보유주수/비중(foreign_shares/foreign_ratio)은 KIS 이 TR에 없어서 키움 ka10008을
    소스 불문 항상 그대로 쓴다.
    '오늘' 실시간 처리(2026-07-15 도입, KIS 전환 후에도 유지): ka10059(_fetch_ka10059_rows)는
    장중 누적치를 실시간으로 주는 유일한 소스라서, KIS/ka10045 둘 다 확정 일별 데이터라 당일
    행이 아직 없을 때 이 값으로 당일 행을 채우거나 덮어쓴다(개인/외국인/기관 전부 - 외국인은
    ka10059 자체 기준이라 확정치의 등록외국인 기준과 정확히는 안 맞을 수 있지만, 장중
    잠정치라는 성격상 원래도 근사치라 허용)."""
    end_dt = datetime.now().strftime('%Y%m%d')

    frgn_res = kiwoom_client.call_tr(token, 'ka10008', '/api/dostk/frgnistt', {'stk_cd': code})
    frgn_by_date = _frgn_by_date_from_ka10008(frgn_res)
    ka10059_rows = _fetch_ka10059_rows(token, code, end_dt)

    out = None
    if kis_appkey and kis_appsecret:
        try:
            out = _daily_rows_from_kis(kis_appkey, kis_appsecret, code, end_dt, frgn_by_date, target_days)
        except Exception as e:
            # 2026-07-19: 이 예외를 조용히 삼키고 키움으로 폴백하기만 해서, 폴백이 실제로
            # 언제·왜 발동됐는지(유량제한 EGW00201인지, 토큰 만료인지, 다른 오류인지) 확인할
            # 방법이 없었음(사용자가 KIS 고객센터에 문의해 원인 규명 시도 중 발견) - 최소한
            # journalctl(kiwoom-api.service)에서 원인을 볼 수 있게 로그만 남긴다.
            logger.warning('KIS 실패(%s), 키움 폴백으로 전환: %s', code, e)
            out = None
    if out is None:
        out = _daily_rows_from_kiwoom(token, code, end_dt, ka10059_rows, frgn_by_date, target_days)

    out.sort(key=lambda r: r['date'], reverse=True)  # 최신일 우선 - gas getForeignFlow와 동일

    today_str = '%s-%s-%s' % (end_dt[0:4], end_dt[4:6], end_dt[6:8])
    live_row = _live_investor_row_from(ka10059_rows, end_dt)
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
