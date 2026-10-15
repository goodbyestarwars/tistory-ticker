# -*- coding: utf-8 -*-
"""코스피200 옵션 ATM 창(window) 수집 - 순수 로직 (2026-10-16).

문제: KIS 옵션 전광판(FHPIF05030100)은 콜·풋 각각 **행사가가 높은 쪽부터 100행**만 준다(공식 문서의 100건 제한, 연속조회 없음 실측).
KOSPI200이 오르면서 그 100행이 전부 현물보다 훨씬 위(2026-10-16 실측 1,347.5~1,595 vs 현물 약 960)라, 실제 거래가 몰린 중앙 행사가가
통째로 빠졌다. 합계는 먼 외가격 콜(0.03원짜리)과 거래 없는 깊은 내가격 풋뿐이라 "늘 콜 우세·풋 0"이었다.

해결: 현물 기준 ±N% 행사가의 옵션 코드를 만들어 개별 시세(선물옵션 시세 FHMIF10000000)로 조회해 합산한다.
코드 규칙(2026-10-16 실측, 같은 만기):
  - 접두 6자리(콜 B01·풋 C01 + 연도1자리 + 월2자리, 예 B01611)는 전광판 행의 optn_shrn_iscd에서 그대로 따온다(연·월 규칙을 추정하지 않는다).
  - 행사가 1,000 미만: 접미 3자리 = 행사가의 정수부(992.5 → 992, 960 → 960).
  - 행사가 1,000 이상: 접미 = 영문 1자리 + 숫자 2자리 순번(A01 = 1,000.0, 2.5씩 증가, 숫자는 01~99 후 다음 문자). 1,090~1,100 구간에서 이 순번이
    어긋나는 것이 확인돼(실측) **응답의 행사가(acpr)가 요청 행사가와 같을 때만 쓴다** - 틀린 코드는 조용히 건너뛴다.
"""
import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

STEP = 2.5
DEFAULT_WINDOW_PCT = 7.0
DEFAULT_WORKERS = 4
MIN_VALID_ROWS = 10               # 창에서 유효 행이 이보다 적으면 전광판 상위 100행 폴백(경고 표시)
MAX_ERROR_RATIO = 0.25            # 조회 오류가 이 비율을 넘으면 창 집계를 믿지 않는다
SCOPE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'option_flow_scope.json')
_scope_lock = threading.Lock()


def window_pct():
    try:
        return max(2.0, min(15.0, float(os.environ.get('OPTION_ATM_WINDOW_PCT', DEFAULT_WINDOW_PCT))))
    except ValueError:
        return DEFAULT_WINDOW_PCT


def strike_suffix(strike):
    """행사가 → 접미 코드. 규칙을 모르는 값이면 None."""
    grid = round(float(strike) / STEP) * STEP
    if grid <= 0:
        return None
    if grid >= 1000:
        n = int(round((grid - 1000) / STEP)) + 1
        if n < 1:
            return None
        return '%s%02d' % (chr(ord('A') + (n - 1) // 99), (n - 1) % 99 + 1)
    return '%03d' % int(grid)


def window_strikes(spot, pct=None):
    """현물 ±pct% 안의 2.5 간격 행사가 목록(오름차순)."""
    pct = window_pct() if pct is None else pct
    low = int((spot * (1 - pct / 100.0)) // STEP) * STEP
    high = int((spot * (1 + pct / 100.0)) // STEP + 1) * STEP
    out, s = [], low
    while s <= high + 1e-9:
        out.append(round(s, 1))
        s += STEP
    return out


def prefix_of(rows):
    """전광판 행에서 옵션 코드 접두 6자리를 따온다(없으면 None)."""
    for row in rows or []:
        code = str((row or {}).get('optn_shrn_iscd') or '').strip()
        if len(code) == 9:
            return code[:6]
    return None


def spot_from_parity(calls, puts):
    """전광판 행으로 현물(선물 내재가)을 추정한다: S ≈ K + C - P. 같은 행사가 쌍의 중앙값. 못 구하면 None."""
    by_put = {}
    for row in puts or []:
        try:
            by_put[round(float(row.get('acpr')), 1)] = float(row.get('optn_prpr'))
        except (TypeError, ValueError):
            continue
    ests = []
    for row in calls or []:
        try:
            k = round(float(row.get('acpr')), 1)
            if k in by_put:
                ests.append(k + float(row.get('optn_prpr')) - by_put[k])
        except (TypeError, ValueError):
            continue
    if not ests:
        return None
    ests.sort()
    return ests[len(ests) // 2]


def fetch_window(quote_fn, call_prefix, put_prefix, strikes, workers=DEFAULT_WORKERS):
    """quote_fn(code) → output1 dict. 반환: (calls, puts, stats). 행사가가 요청과 다르거나 acpr가 0이면 건너뛴다(stats.skipped)."""
    jobs = []
    for strike in strikes:
        suffix = strike_suffix(strike)
        if suffix is None:
            continue
        jobs.append(('CALL', call_prefix + suffix, strike))
        jobs.append(('PUT', put_prefix + suffix, strike))

    def one(job):
        side, code, strike = job
        try:
            row = quote_fn(code)
        except Exception as exc:  # noqa: BLE001 - 한 건 실패가 전체를 막지 않게 센다
            return side, strike, None, exc
        return side, strike, row, None

    with ThreadPoolExecutor(max_workers=max(1, int(workers))) as pool:
        results = list(pool.map(one, jobs))
    calls, puts, errors, skipped = [], [], 0, 0
    for side, strike, row, exc in results:
        if exc is not None:
            errors += 1
            continue
        try:
            acpr = float((row or {}).get('acpr') or 0)
        except (TypeError, ValueError):
            acpr = 0.0
        if acpr <= 0 or abs(acpr - strike) > 0.01:
            skipped += 1
            continue
        (calls if side == 'CALL' else puts).append(row)
    stats = {'requested': len(jobs), 'errors': errors, 'skipped': skipped, 'calls': len(calls), 'puts': len(puts)}
    return calls, puts, stats


def window_ok(stats):
    """창 집계를 믿어도 되는지: 오류 비율이 낮고 콜·풋 양쪽에 유효 행이 충분해야 한다."""
    if not stats or not stats.get('requested'):
        return False
    if stats['errors'] / float(stats['requested']) > MAX_ERROR_RATIO:
        return False
    return stats['calls'] >= MIN_VALID_ROWS and stats['puts'] >= MIN_VALID_ROWS


def write_scope(scope):
    """화면용 집계 범위 안내를 파일로 남긴다(uvicorn 워커가 여러 개여도 같은 값을 읽도록)."""
    data = dict(scope, updated_at=datetime.now(timezone.utc).isoformat())
    tmp = SCOPE_FILE + '.tmp'
    with _scope_lock:
        try:
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False)
            os.replace(tmp, SCOPE_FILE)
        except OSError:
            pass


def read_scope():
    try:
        with open(SCOPE_FILE, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return None
