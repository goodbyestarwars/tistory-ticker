# -*- coding: utf-8 -*-
"""증권사(키움) 테마 기준 "오늘 돈이 몰린 섹터".

2026-09-14 사용자 지적: "오늘은 광통신 쪽이 상한가 가고 그랬는데 하나도 없네? 섹터를 보면
내가 만들어 놓은 섹터인데? 증권사에서 제공해주는 섹터로 하면 좋을 것 같아. 일일이 내가
섹터를 다 만들 순 없잖아". 그때까지 국내 주요종목 상단 카드는 `/industry-flow`, 즉 우리가
손으로 관리하는 `data/sectors-v3.js`(37개 테마·238종목)를 묶어 계산했다. 거기 없는 테마는
아무리 올라도 나올 수 없었다.

여기서는 키움 REST 테마 TR을 그대로 쓴다(필드는 키움 REST API 문서 346~350쪽 기준).
- ka90001 테마그룹별요청: qry_tp=0(전체), date_tp=1, flu_pl_amt_tp=3(상위등락률), stex_tp=3(통합)
  → `thema_grp[]`: thema_grp_cd, thema_nm, stk_num, flu_rt, rising_stk_num, fall_stk_num
- ka90002 테마구성종목요청: date_tp=1, thema_grp_cd, stex_tp=3
  → `thema_comp_stk[]`: stk_cd, stk_nm, cur_prc, flu_sig(1=상한가), flu_rt, acc_trde_qty

등락률 상위 테마 CANDIDATE_THEMES개를 후보로 잡고, 구성종목의 거래대금(현재가×누적거래량 -
TR이 거래대금을 주지 않아 추정값)이 큰 순서로 정렬한다. "많이 오른 테마 중 돈이 실제로 몰린
곳"이다. 방문자 요청 경로에서는 부르지 않고 백그라운드가 3분마다 받아 둔 결과만 읽는다.
"""

import json
import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone

import kiwoom_client

logger = logging.getLogger('theme_flow')

KST = timezone(timedelta(hours=9))
THEME_PATH = '/api/dostk/thme'
CANDIDATE_THEMES = 20
STOCKS_PER_THEME = 8
MIN_THEME_STOCKS = 2
REFRESH_SEC = 180
OFF_HOURS_REFRESH_SEC = 6 * 3600
_CALL_GAP_SEC = 0.3
CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'theme_flow_cache.json')

_lock = threading.Lock()
_state = {'result': None, 'error': None, 'fetchedAt': 0.0}
_thread = None
_creds = {'appkey': '', 'secretkey': ''}
THEME_STOCKS_TTL_SEC = 180
_stocks_cache = {}   # theme_code -> (fetched_at, stocks)


def _number(value):
    if value is None:
        return None
    text = str(value).replace(',', '').strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _stock_code(value):
    """키움 통합 조회(stex_tp=3)의 종목코드는 `069540_AL`처럼 거래소 접미사가 붙어 온다
    (2026-09-14 라이브 확인). 화면 링크·실시간 구독은 6자리 코드를 쓰므로 떼어낸다."""
    text = str(value or '').strip().upper()
    if not text:
        return ''
    return text.split('_', 1)[0]


def build_theme_rows(groups, constituents_by_code, top_n=CANDIDATE_THEMES, stocks_per=STOCKS_PER_THEME):
    """ka90001 목록과 ka90002 구성종목(테마코드별)으로 화면용 행을 만든다(순수 함수)."""
    rows = []
    for group in (groups or [])[:max(1, int(top_n))]:
        theme_code = str(group.get('thema_grp_cd') or '').strip()
        name = str(group.get('thema_nm') or '').strip()
        if not theme_code or not name:
            continue
        stocks = []
        upper_limit = 0
        for item in constituents_by_code.get(theme_code) or []:
            code = _stock_code(item.get('stk_cd'))
            if not code:
                continue
            price = abs(_number(item.get('cur_prc')) or 0)
            volume = abs(_number(item.get('acc_trde_qty')) or 0)
            if str(item.get('flu_sig') or '').strip() == '1':
                upper_limit += 1
            stocks.append({
                'code': code,
                'name': str(item.get('stk_nm') or code).strip(),
                'price': price or None,
                'change_rate': _number(item.get('flu_rt')),
                'trade_amount': price * volume,
            })
        if len(stocks) < MIN_THEME_STOCKS:
            continue
        stocks.sort(key=lambda s: -(s['trade_amount'] or 0))
        trade_amount = sum(s['trade_amount'] or 0 for s in stocks)
        if trade_amount <= 0:
            continue
        rows.append({
            'industry': name,
            'theme_code': theme_code,
            'avg_change_rate': _number(group.get('flu_rt')),
            'trade_amount': trade_amount,
            'stock_count': len(stocks),
            'rising_count': int(_number(group.get('rising_stk_num')) or 0),
            'falling_count': int(_number(group.get('fall_stk_num')) or 0),
            'upper_limit_count': upper_limit,
            'stocks': stocks[:max(1, int(stocks_per))],
            # 화면의 "함께 볼 섹터"(구성종목이 겹치는 다른 테마)를 계산할 전체 코드.
            'codes': [s['code'] for s in stocks],
        })
    rows.sort(key=lambda r: -(r['trade_amount'] or 0))
    return rows


def build_theme_list(groups):
    """ka90001 전체 테마를 선택 목록용으로 줄인다(순수 함수). 이름·코드가 없는 행은 버린다."""
    out = []
    seen = set()
    for group in groups or []:
        code = str(group.get('thema_grp_cd') or '').strip()
        name = str(group.get('thema_nm') or '').strip()
        if not code or not name or code in seen:
            continue
        seen.add(code)
        count = _number(group.get('stk_num'))
        out.append({
            'code': code,
            'name': name,
            'stock_count': int(count) if count is not None else None,
            'change_rate': _number(group.get('flu_rt')),
        })
    return out


def normalize_theme_stocks(items):
    """ka90002 구성종목을 화면용으로 정리한다(순수 함수)."""
    out = []
    seen = set()
    for item in items or []:
        code = _stock_code(item.get('stk_cd'))
        if not code or code in seen:
            continue
        seen.add(code)
        price = abs(_number(item.get('cur_prc')) or 0)
        out.append({
            'code': code,
            'name': str(item.get('stk_nm') or code).strip(),
            'price': price or None,
            'change_rate': _number(item.get('flu_rt')),
        })
    return out


def fetch_theme_flow(token, call_tr=None, sleep=time.sleep):
    call_tr = call_tr or kiwoom_client.call_tr
    listing = call_tr(token, 'ka90001', THEME_PATH, {
        'qry_tp': '0', 'stk_cd': '', 'date_tp': '1', 'thema_nm': '',
        'flu_pl_amt_tp': '3', 'stex_tp': '3',
    })
    all_groups = [g for g in (listing.get('thema_grp') or []) if isinstance(g, dict)]
    groups = all_groups[:CANDIDATE_THEMES]
    constituents = {}
    for group in groups:
        theme_code = str(group.get('thema_grp_cd') or '').strip()
        if not theme_code:
            continue
        sleep(_CALL_GAP_SEC)
        try:
            res = call_tr(token, 'ka90002', THEME_PATH, {
                'date_tp': '1', 'thema_grp_cd': theme_code, 'stex_tp': '3',
            })
        except Exception:
            logger.warning('키움 테마 구성종목 조회 실패: %s', theme_code, exc_info=True)
            continue
        constituents[theme_code] = [s for s in (res.get('thema_comp_stk') or []) if isinstance(s, dict)]
    return {
        'rows': build_theme_rows(groups, constituents),
        # 2026-10-02: 카테고리를 직접 만들 때 고르는 전체 테마 목록(ka90001이 준 전부). 필드는 문서
        # 기준 thema_grp_cd/thema_nm/stk_num/flu_rt뿐이다.
        'themes': build_theme_list(all_groups),
        'candidateCount': len(groups),
        'updatedAt': datetime.now(KST).strftime('%Y-%m-%d %H:%M:%S'),
        'source': 'kiwoom-theme',
    }


def _is_active_window(now_kst):
    if now_kst.weekday() >= 5:
        return False
    minutes = now_kst.hour * 60 + now_kst.minute
    # NXT 프리마켓(08:00)부터 KRX 애프터마켓·NXT 마감(20:00) 직후까지.
    return 7 * 60 + 50 <= minutes <= 20 * 60 + 10


def _load_cache_file():
    try:
        with open(CACHE_FILE, encoding='utf-8') as handle:
            data = json.load(handle)
        if isinstance(data, dict) and isinstance(data.get('rows'), list):
            return data
    except (OSError, ValueError):
        pass
    return None


def _save_cache_file(result):
    tmp = CACHE_FILE + '.tmp'
    try:
        with open(tmp, 'w', encoding='utf-8') as handle:
            json.dump(result, handle, ensure_ascii=False)
        os.replace(tmp, CACHE_FILE)
    except OSError:
        logger.warning('테마 흐름 캐시 파일 저장 실패', exc_info=True)


def refresh_once(appkey, secretkey):
    token = kiwoom_client.get_token(appkey, secretkey)
    result = fetch_theme_flow(token)
    with _lock:
        if result['rows'] or _state['result'] is None:
            _state['result'] = result
        _state['error'] = None if result['rows'] else '키움 테마 응답에 표시할 행이 없습니다.'
        _state['fetchedAt'] = time.time()
    if result['rows']:
        _save_cache_file(result)
        _record_money_picks(result['rows'])
    return result


def _record_money_picks(rows):
    """15:35 이후 첫 갱신에서 오늘의 대표 종목을 기록한다. 기록 실패가 화면 갱신을 막지 않게 삼킨다."""
    try:
        import db_schema
        import market_temp
        import money_picks
        now_kst = datetime.now(KST)
        conn = db_schema.get_conn()
        try:
            money_picks.record_today(conn, rows, now_kst, market_temp.is_kr_trading_day(now_kst))
        finally:
            conn.close()
    except Exception:
        logger.warning('대표 종목 기록 실패', exc_info=True)


def _loop(appkey, secretkey):
    while True:
        now_kst = datetime.now(KST)
        with _lock:
            age = time.time() - _state['fetchedAt']
            has_result = _state['result'] is not None
        due = REFRESH_SEC if _is_active_window(now_kst) else OFF_HOURS_REFRESH_SEC
        with _lock:
            catalog_age = time.time() - _catalog['fetchedAt']
        if catalog_age >= CATALOG_REFRESH_SEC:
            try:
                refresh_catalog(appkey, secretkey)
            except Exception as exc:
                logger.warning('키움 테마 카탈로그 갱신 실패: %s', exc)
                with _lock:
                    _catalog['fetchedAt'] = time.time() - CATALOG_REFRESH_SEC + 300  # 5분 뒤 재시도
        if not has_result or age >= due:
            try:
                refresh_once(appkey, secretkey)
            except Exception as exc:
                logger.warning('키움 테마 흐름 갱신 실패: %s', exc)
                with _lock:
                    _state['error'] = str(exc)[:200]
                    _state['fetchedAt'] = time.time() - due + 60  # 1분 뒤 재시도
        time.sleep(20)


CATALOG_REFRESH_SEC = 3600
CATALOG_MAX_PAGES = 8
CATALOG_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'theme_catalog_cache.json')
_catalog = {'themes': None, 'fetchedAt': 0.0}


def fetch_theme_catalog(token, call_pages=None, sleep=time.sleep):
    """ka90001을 연속조회로 끝까지 받아 전체 테마 목록을 만든다. 한 번의 응답은 100개까지라(2026-10-02
    라이브 확인: 정확히 100개) 그날 등락률 상위만 보였다 - 화장품·호텔처럼 안 오른 테마도 고를 수 있어야 한다."""
    call_pages = call_pages or kiwoom_client.call_tr_pages
    pages = call_pages(token, 'ka90001', THEME_PATH, {
        'qry_tp': '0', 'stk_cd': '', 'date_tp': '1', 'thema_nm': '',
        'flu_pl_amt_tp': '3', 'stex_tp': '3',
    }, max_pages=CATALOG_MAX_PAGES)
    groups = []
    for page in pages or []:
        groups.extend(g for g in (page.get('thema_grp') or []) if isinstance(g, dict))
    return build_theme_list(groups)


def refresh_catalog(appkey, secretkey):
    token = kiwoom_client.get_token(appkey, secretkey)
    themes = fetch_theme_catalog(token)
    if themes:
        with _lock:
            _catalog['themes'] = themes
            _catalog['fetchedAt'] = time.time()
        tmp = CATALOG_CACHE_FILE + '.tmp'
        try:
            with open(tmp, 'w', encoding='utf-8') as handle:
                json.dump({'themes': themes}, handle, ensure_ascii=False)
            os.replace(tmp, CATALOG_CACHE_FILE)
        except OSError:
            logger.warning('테마 카탈로그 캐시 파일 저장 실패', exc_info=True)
    return themes


def _load_catalog_file():
    try:
        with open(CATALOG_CACHE_FILE, encoding='utf-8') as handle:
            data = json.load(handle)
        themes = data.get('themes') if isinstance(data, dict) else None
        return themes if isinstance(themes, list) and themes else None
    except (OSError, ValueError):
        return None


def get_theme_list():
    """전체 테마 목록. 연속조회로 받은 카탈로그를 우선하고, 아직 없으면 3분 흐름 응답의 목록으로 물러난다."""
    with _lock:
        themes = _catalog['themes']
        result = _state['result']
    if themes:
        return themes
    fallback = result.get('themes') if isinstance(result, dict) else None
    return fallback if isinstance(fallback, list) and fallback else None


def get_theme_stocks(theme_code, call_tr=None, now=time.time):
    """한 테마의 구성종목(방문자가 카테고리로 만들 때만 부른다). 알려진 테마코드만 받고 3분 캐시한다.
    알 수 없는 코드면 None, 키움 호출 실패면 예외를 그대로 올린다."""
    code = str(theme_code or '').strip()
    themes = get_theme_list() or []
    if not any(t['code'] == code for t in themes):
        return None
    with _lock:
        hit = _stocks_cache.get(code)
    if hit and now() - hit[0] < THEME_STOCKS_TTL_SEC:
        return hit[1]
    call_tr = call_tr or kiwoom_client.call_tr
    token = kiwoom_client.get_token(_creds['appkey'], _creds['secretkey'])
    res = call_tr(token, 'ka90002', THEME_PATH, {'date_tp': '1', 'thema_grp_cd': code, 'stex_tp': '3'})
    stocks = normalize_theme_stocks([s for s in (res.get('thema_comp_stk') or []) if isinstance(s, dict)])
    with _lock:
        _stocks_cache[code] = (now(), stocks)
        if len(_stocks_cache) > 200:
            _stocks_cache.pop(next(iter(_stocks_cache)))
    return stocks


def start_background(appkey, secretkey):
    global _thread
    _creds['appkey'], _creds['secretkey'] = appkey or '', secretkey or ''
    if not appkey or not secretkey:
        logger.warning('KIWOOM_APPKEY/KIWOOM_SECRETKEY 미설정 - 테마 흐름 수집 건너뜀')
        return None
    with _lock:
        if _catalog['themes'] is None:
            _catalog['themes'] = _load_catalog_file()
        if _state['result'] is None:
            _state['result'] = _load_cache_file()
        if _thread is not None and _thread.is_alive():
            return _thread
        _thread = threading.Thread(target=_loop, args=(appkey, secretkey), name='theme-flow', daemon=True)
        _thread.start()
    return _thread


def get_cached():
    with _lock:
        return {'result': _state['result'], 'error': _state['error']}
