# -*- coding: utf-8 -*-
"""program_trading_history.json에 과거 영업일 프로그램매매(차익/비차익거래) 값을
미리 채워 넣는 1회성 스크립트.

domestic_market_indicators.fetch_program_trading()은 조회할 때마다 "오늘" 하루치만
기록해서, 그냥 두면 1년 평균·추이 그래프가 실제로 1년치가 될 때까지 하루하루
자연스럽게 쌓일 때까지 기다려야 한다(2026-08-14 요청). 이 스크립트는 ka90007에
과거 날짜를 하나씩 넣어 호출해서 그 대기 시간을 없앤다 - 이미 기록된 날짜는
건너뛰므로 여러 번 실행해도 안전하고(재시작 가능), 중간에 실패해도 다음 실행이
이어서 채운다.

토·일요일은 건너뛰고, 그 외 날짜 중 공휴일이라 데이터가 없는 날은 API가 빈 배열을
주는 그대로 건너뛴다(별도 공휴일 캘린더 없이 실측 응답으로만 판단).

사용법 (VM에서):
  cd /home/goodbyestarwars/kiwoom-api
  python3 backfill_program_trading_history.py            # 최근 380일(약 1년+여유)
  python3 backfill_program_trading_history.py 60          # 최근 60일만
"""

import os
import sys
import time
from datetime import datetime, timedelta, timezone

import kiwoom_client
import program_trading_history

KST = timezone(timedelta(hours=9))
THROTTLE_SEC = 0.3
DEFAULT_DAYS = 380


def load_dotenv():
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if not os.path.exists(env_path):
        return
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, value = line.partition('=')
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def log(msg):
    print('[backfill_program_trading_history] ' + msg, flush=True)


def fetch_one_day(token, date_str):
    res = kiwoom_client.call_tr(token, 'ka90007', '/api/dostk/mrkcond', {
        'amt_qty_tp': '1', 'mrkt_tp': '0', 'stex_tp': '3', 'date': date_str,
    })
    rows = res.get('prm_trde_acc_trnsn') or []
    if not rows:
        return None
    latest = rows[-1]

    def num(value):
        text = str(value or '').replace(',', '').replace('+', '')
        if text.startswith('--'):
            text = '-' + text.lstrip('-')
        try:
            return float(text)
        except ValueError:
            return None

    arbitrage = num(latest.get('dfrt_trde_tdy'))
    non_arbitrage = num(latest.get('ndiffpro_trde_tdy'))
    total = num(latest.get('all_tdy'))
    if arbitrage is None and non_arbitrage is None:
        return None
    return arbitrage, non_arbitrage, total


def main():
    load_dotenv()
    appkey = os.environ.get('KIWOOM_APPKEY')
    secretkey = os.environ.get('KIWOOM_SECRETKEY')
    if not appkey or not secretkey:
        log('KIWOOM_APPKEY/KIWOOM_SECRETKEY 환경변수가 없습니다.')
        sys.exit(1)

    days = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DAYS
    token = kiwoom_client.get_token(appkey, secretkey)
    history = program_trading_history.load()

    today = datetime.now(KST).date()
    filled = 0
    skipped_existing = 0
    skipped_empty = 0
    for offset in range(days):
        day = today - timedelta(days=offset)
        if day.weekday() >= 5:  # 5=토, 6=일
            continue
        iso_date = day.strftime('%Y-%m-%d')
        if iso_date in history:
            skipped_existing += 1
            continue
        date_str = day.strftime('%Y%m%d')
        try:
            result = fetch_one_day(token, date_str)
        except Exception as e:
            log('%s 조회 실패: %s' % (iso_date, e))
            time.sleep(THROTTLE_SEC)
            continue
        if not result:
            skipped_empty += 1
            time.sleep(THROTTLE_SEC)
            continue
        arbitrage, non_arbitrage, total = result
        program_trading_history.record(iso_date, arbitrage, non_arbitrage, total)
        history[iso_date] = None  # 이번 실행 안에서 같은 날짜를 다시 조회하지만 않으면 됨
        filled += 1
        if filled % 20 == 0:
            log('%d일 채움... (최근: %s)' % (filled, iso_date))
        time.sleep(THROTTLE_SEC)

    log('완료: 신규 %d일, 이미 있던 %d일, 데이터 없음(휴장 추정) %d일'
        % (filled, skipped_existing, skipped_empty))


if __name__ == '__main__':
    main()
