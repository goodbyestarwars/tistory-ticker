#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
data/sectors-v3.js 종목 풀(전 섹터 중복 제거) 기준으로 키움증권 REST API에서
공매도추이(ka10014)/대차거래추이 종목별(ka20068)/투자자별 매매동향(ka10059)을 받아
data/investor-flow-cache.js 로 저장하고 git commit까지 수행한다.

사용법:
  KIWOOM_APPKEY=xxx KIWOOM_SECRETKEY=yyy python scripts/fetch_investor_flow.py
  (Windows PowerShell) $env:KIWOOM_APPKEY="xxx"; $env:KIWOOM_SECRETKEY="yyy"; python scripts/fetch_investor_flow.py

주의:
- 앱키/시크릿은 반드시 환경변수로 전달할 것. 이 스크립트 어디에도 하드코딩하지 말 것
  (이 리포는 GitHub Pages로 서빙되는 공개 저장소).
- 이 스크립트는 키움 REST API 실계정으로 직접 검증되지 않았다. MCP 도구(mcp__kiwoom__*)로
  확인한 실제 응답 필드(shrts_trnsn/dbrt_trde_trnsn/stk_invsr_orgn 등)를 기준으로 작성했지만,
  REST 엔드포인트의 정확한 요청 바디 필드는 kiwoom_api.md 문서 기준이라 실제 계정으로
  소량 테스트(TEST_CODES) 먼저 해보고 전체 실행할 것.
- 호출 제한 안전마진: 초당 4회로 쓰로틀링(THROTTLE_SEC).
"""

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SECTORS_FILE = os.path.join(REPO_ROOT, 'data', 'sectors-v3.js')
OUTPUT_FILE = os.path.join(REPO_ROOT, 'data', 'investor-flow-cache.js')

BASE_URL = 'https://api.kiwoom.com'
THROTTLE_SEC = 0.25  # 초당 4회
LOOKBACK_DAYS = 100  # 60영업일 확보용 여유(주말/휴장 감안)

# 소량 테스트용 - 이 리스트가 비어있지 않으면 이 종목들만 돈다 (--all 옵션으로 전체 실행)
TEST_CODES = ['005930']


def log(msg):
    print('[fetch_investor_flow] ' + msg, flush=True)


def load_stock_codes():
    """data/sectors-v3.js에서 { name, code, market } 객체를 정규식으로 추출, 코드 기준 중복 제거."""
    with open(SECTORS_FILE, 'r', encoding='utf-8') as f:
        src = f.read()
    pattern = re.compile(r'\{\s*name:\s*"([^"]+)",\s*code:\s*"([0-9A-Za-z]{6})"\s*,\s*market:\s*"([^"]+)"\s*\}')
    seen = {}
    for m in pattern.finditer(src):
        name, code, market = m.group(1), m.group(2), m.group(3)
        seen[code] = name  # 마지막 표기 우선(동일 종목 중복 섹터는 이름 동일해야 정상)
    return seen  # {code: name}


def get_token(appkey, secretkey):
    body = json.dumps({
        'grant_type': 'client_credentials',
        'appkey': appkey,
        'secretkey': secretkey,
    }).encode('utf-8')
    req = urllib.request.Request(
        BASE_URL + '/oauth2/token',
        data=body,
        headers={'Content-Type': 'application/json;charset=UTF-8'},
        method='POST'
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        data = json.loads(res.read().decode('utf-8'))
    token = data.get('token') or data.get('access_token')
    if not token:
        raise RuntimeError('토큰 발급 실패: ' + json.dumps(data, ensure_ascii=False))
    return token


def call_tr(token, api_id, path, body):
    req = urllib.request.Request(
        BASE_URL + path,
        data=json.dumps(body).encode('utf-8'),
        headers={
            'Content-Type': 'application/json;charset=UTF-8',
            'authorization': 'Bearer ' + token,
            'api-id': api_id,
        },
        method='POST'
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return json.loads(res.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raise RuntimeError('%s HTTP %s: %s' % (api_id, e.code, e.read().decode('utf-8', 'ignore')))


def to_num(v):
    try:
        return float(str(v).replace(',', '').replace('+', ''))
    except (TypeError, ValueError):
        return 0.0


def date_range():
    end = datetime.now()
    start = end - timedelta(days=LOOKBACK_DAYS)
    return start.strftime('%Y%m%d'), end.strftime('%Y%m%d')


# ---------------------------------------------------------------------------
# 지표 계산 - gas/ticker-proxy.gs의 computeShortPressureScore_/pensionInterpretation_와
# 같은 수치 조건을 그대로 포팅(원래 지시서 스펙: 거래비중30/대차잔고증가율30/
# 공매도잔고증가20/외국인순매도10/기관순매도10 = 100점). AI가 임의 판단하지 않는다.
# ---------------------------------------------------------------------------

def short_pressure_score(short_ratio_pct, loan_change_pct, short_balance_change_pct, foreign_net_today, inst_net_today):
    ratio_score = 30 if short_ratio_pct >= 15 else 24 if short_ratio_pct >= 10 else 15 if short_ratio_pct >= 5 else 8 if short_ratio_pct >= 2 else 0
    loan_score = 30 if loan_change_pct >= 5 else 22 if loan_change_pct >= 2 else 12 if loan_change_pct >= 0 else 5 if loan_change_pct >= -3 else 0
    bal_score = 20 if short_balance_change_pct >= 5 else 14 if short_balance_change_pct >= 2 else 8 if short_balance_change_pct >= 0 else 0
    foreign_score = 10 if foreign_net_today < 0 else 0
    inst_score = 10 if inst_net_today < 0 else 0
    total = ratio_score + loan_score + bal_score + foreign_score + inst_score
    if total <= 20:
        grade = {'emoji': '\U0001F7E2', 'label': '매우 약함'}
    elif total <= 40:
        grade = {'emoji': '\U0001F7E2', 'label': '약함'}
    elif total <= 60:
        grade = {'emoji': '\U0001F7E1', 'label': '보통'}
    elif total <= 80:
        grade = {'emoji': '\U0001F7E0', 'label': '강함'}
    else:
        grade = {'emoji': '\U0001F534', 'label': '매우 강함'}
    return {
        'score': total,
        'grade': grade,
        'breakdown': {
            'short_ratio': ratio_score,
            'loan_increase': loan_score,
            'balance_increase': bal_score,
            'foreign_sell': foreign_score,
            'inst_sell': inst_score,
        }
    }


def pension_streak(daily_penfnd):
    """daily_penfnd: 최신일 우선 리스트 (일별 연기금 순매매값)."""
    if not daily_penfnd:
        return {'days': 0, 'direction': 'flat'}
    first = daily_penfnd[0]
    direction = 1 if first > 0 else -1 if first < 0 else 0
    if direction == 0:
        return {'days': 0, 'direction': 'flat'}
    days = 0
    for v in daily_penfnd:
        d = 1 if v > 0 else -1 if v < 0 else 0
        if d != direction:
            break
        days += 1
    return {'days': days, 'direction': 'buy' if direction > 0 else 'sell'}


def pension_interpretation(streak, foreign_net_5d):
    if streak['direction'] == 'buy' and streak['days'] >= 5:
        if foreign_net_5d > 0:
            return {'tone': 'very_positive', 'label': '매우 긍정',
                    'text': '연기금이 %d일 연속 순매수 중이고 외국인도 최근 5일 순매수를 동반하고 있습니다.' % streak['days']}
        return {'tone': 'positive', 'label': '긍정', 'text': '연기금이 %d일 연속 순매수 중입니다.' % streak['days']}
    if streak['direction'] == 'buy':
        return {'tone': 'neutral_positive', 'label': '중립~긍정',
                'text': '연기금이 순매수 중이나 연속성은 아직 짧습니다(%d일).' % streak['days']}
    if streak['direction'] == 'sell' and streak['days'] >= 5:
        return {'tone': 'caution', 'label': '비중 축소 가능성', 'text': '연기금이 %d일 연속 순매도 중입니다.' % streak['days']}
    return {'tone': 'neutral', 'label': '중립', 'text': '연기금 매매 방향성이 뚜렷하지 않습니다.'}


def fetch_stock(token, code, name, strt_dt, end_dt):
    short_res = call_tr(token, 'ka10014', '/api/dostk/shsa',
                         {'stk_cd': code, 'strt_dt': strt_dt, 'end_dt': end_dt})
    time.sleep(THROTTLE_SEC)
    loan_res = call_tr(token, 'ka20068', '/api/dostk/slb', {'stk_cd': code})
    time.sleep(THROTTLE_SEC)
    invsr_res = call_tr(token, 'ka10059', '/api/dostk/stkinfo',
                         {'stk_cd': code, 'dt': end_dt, 'amt_qty_tp': '1', 'trde_tp': '0', 'unit_tp': '1'})
    time.sleep(THROTTLE_SEC)

    short_rows = short_res.get('shrts_trnsn') or []
    loan_rows = loan_res.get('dbrt_trde_trnsn') or []
    invsr_rows = invsr_res.get('stk_invsr_orgn') or []

    # 최신일 우선 정렬 보장 (원본 정렬을 신뢰하지 않음)
    short_rows = sorted(short_rows, key=lambda r: r.get('dt', ''), reverse=True)
    loan_rows = sorted(loan_rows, key=lambda r: r.get('dt', ''), reverse=True)
    invsr_rows = sorted(invsr_rows, key=lambda r: r.get('dt', ''), reverse=True)

    if not short_rows or not loan_rows or not invsr_rows:
        return None

    today_short = short_rows[0]
    balance_qty = to_num(today_short.get('ovr_shrts_qty'))
    avg_price = to_num(today_short.get('shrts_avg_pric'))
    today_ratio_pct = to_num(today_short.get('trde_wght'))

    avg_n = min(20, len(short_rows))
    avg_volume_20d = sum(to_num(r.get('trde_qty')) for r in short_rows[:avg_n]) / avg_n if avg_n else 0
    days_to_cover = (balance_qty / avg_volume_20d) if avg_volume_20d > 0 else None

    prior_short_balance = to_num(short_rows[1].get('ovr_shrts_qty')) if len(short_rows) > 1 else None
    short_balance_change_pct = (
        (balance_qty - prior_short_balance) / prior_short_balance * 100
    ) if prior_short_balance else 0.0

    today_loan = loan_rows[0]
    loan_balance_qty = to_num(today_loan.get('rmnd'))
    prior_loan_balance = to_num(loan_rows[1].get('rmnd')) if len(loan_rows) > 1 else None
    loan_change_pct = (
        (loan_balance_qty - prior_loan_balance) / prior_loan_balance * 100
    ) if prior_loan_balance else 0.0

    today_invsr = invsr_rows[0]
    foreign_net_today = to_num(today_invsr.get('frgnr_invsr'))
    inst_net_today = to_num(today_invsr.get('orgn'))

    pressure = short_pressure_score(today_ratio_pct, loan_change_pct, short_balance_change_pct,
                                     foreign_net_today, inst_net_today)

    today_short_volume = to_num(today_short.get('shrts_qty'))
    short_squeeze_index = (
        (foreign_net_today + inst_net_today) / today_short_volume * 100
    ) if today_short_volume > 0 else None

    penfnd_daily = [to_num(r.get('penfnd_etc')) for r in invsr_rows]

    def sum_n(vals, n):
        return sum(vals[:min(n, len(vals))])

    net_5d = sum_n(penfnd_daily, 5)
    net_20d = sum_n(penfnd_daily, 20)
    net_60d = sum_n(penfnd_daily, 60) if len(penfnd_daily) >= 60 else None
    net_cumulative = sum(penfnd_daily)

    # 평균매수가(추정): 순매수금액 누적 / 순매수수량 누적 - amt_qty_tp=1(금액) 응답이라
    # penfnd_daily는 금액(원 추정). 수량 기준 평균매수가를 원하면 amt_qty_tp=2로 별도 호출 필요.
    # 여기서는 pension-fund.js 기존 방식대로 종가 근사를 그대로 쓴다.
    current_price = abs(to_num(today_invsr.get('cur_prc')))  # cur_prc는 등락표시 +/-가 붙어있을 뿐 가격 자체는 항상 양수
    streak = pension_streak(penfnd_daily)
    interpretation = pension_interpretation(streak, net_5d)

    return {
        'name': name,
        'as_of': today_short.get('dt'),
        'short': {
            'balance_qty': balance_qty,
            'avg_price': avg_price,
            'today_ratio_pct': today_ratio_pct,
            'avg_volume_20d': avg_volume_20d,
            'days_to_cover': days_to_cover,
            'balance_change_pct': short_balance_change_pct,
            'short_squeeze_index': short_squeeze_index,
            'pressure': pressure,
        },
        'loan': {
            'balance_qty': loan_balance_qty,
            'balance_change_pct': loan_change_pct,
        },
        'pension': {
            'streak': streak,
            'net_5d': net_5d,
            'net_20d': net_20d,
            'net_60d': net_60d,
            'net_cumulative': net_cumulative,
            'cumulative_window_days': len(penfnd_daily),
            'current_price': current_price,
            'interpretation': interpretation,
        },
    }


def write_output(cache):
    lines = []
    lines.append('/**')
    lines.append(' * 공매도/대차거래/연기금 캐시 - 키움증권 REST API 기반, PC 로컬에서 하루 1회')
    lines.append(' * scripts/fetch_investor_flow.py 실행 -> git push로 갱신 (서버 실시간 크롤링 아님)')
    lines.append(' * 커버리지: data/sectors-v3.js 종목 풀만 포함(전체 종목 아님) - js/foreign-flow.js가')
    lines.append(' * 이 캐시에 없는 종목은 공매도/대차/연기금 섹션을 생략하고 안내 문구만 표시한다.')
    lines.append(' * 생성: ' + datetime.now().strftime('%Y-%m-%d %H:%M'))
    lines.append(' */')
    lines.append('window.INVESTOR_FLOW_CACHE = ' + json.dumps(cache, ensure_ascii=False, indent=2) + ';')
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    log('저장 완료: %s (%d종목)' % (OUTPUT_FILE, len(cache)))


def git_commit_push():
    subprocess.run(['git', 'add', 'data/investor-flow-cache.js'], cwd=REPO_ROOT, check=True)
    msg = '투자자 동향 데이터 자동 갱신 (%s)' % datetime.now().strftime('%Y-%m-%d')
    result = subprocess.run(['git', 'commit', '-m', msg], cwd=REPO_ROOT)
    if result.returncode != 0:
        log('커밋할 변경사항 없음(데이터 동일) - push 생략')
        return
    subprocess.run(['git', 'push'], cwd=REPO_ROOT, check=True)
    log('git push 완료')


def main():
    appkey = os.environ.get('KIWOOM_APPKEY')
    secretkey = os.environ.get('KIWOOM_SECRETKEY')
    if not appkey or not secretkey:
        log('KIWOOM_APPKEY / KIWOOM_SECRETKEY 환경변수가 필요합니다.')
        sys.exit(1)

    run_all = '--all' in sys.argv
    codes_map = load_stock_codes()
    codes = list(codes_map.keys()) if run_all else [c for c in TEST_CODES if c in codes_map]
    if not codes:
        log('대상 종목이 없습니다.')
        sys.exit(1)
    log('대상 종목 수: %d (%s)' % (len(codes), '전체' if run_all else '테스트'))

    token = get_token(appkey, secretkey)
    strt_dt, end_dt = date_range()

    cache = {}
    for i, code in enumerate(codes):
        name = codes_map[code]
        try:
            result = fetch_stock(token, code, name, strt_dt, end_dt)
            if result:
                cache[code] = result
                log('[%d/%d] %s(%s) OK' % (i + 1, len(codes), name, code))
            else:
                log('[%d/%d] %s(%s) 데이터 없음 - 스킵' % (i + 1, len(codes), name, code))
        except Exception as e:
            log('[%d/%d] %s(%s) 실패: %s' % (i + 1, len(codes), name, code, e))
            continue

    if not cache:
        log('수집된 데이터가 없어 저장을 건너뜁니다.')
        sys.exit(1)

    write_output(cache)
    git_commit_push()


if __name__ == '__main__':
    main()
