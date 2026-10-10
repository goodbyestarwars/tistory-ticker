# -*- coding: utf-8 -*-
"""실행: python main.py  (또는 run.bat). 점검: python main.py --check (읽기 전용).
매수 기능은 없다. 매도는 .env 의 LIVE_SELL=true 일 때만 실제로 나간다(기본 꺼짐)."""
import logging
import os
import sys
import threading
from datetime import datetime

import server as server_mod
from bot import HERE, Bot, Store, live_sell_enabled, load_config, now_kst
from kiwoom import KiwoomClient


def load_env():
    """.env 의 KEY=VALUE 를 환경변수로 읽는다(이미 있는 값은 덮어쓰지 않는다). 키는 로그에 찍지 않는다."""
    path = os.path.join(HERE, '.env')
    if not os.path.exists(path):
        return
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def setup_logging():
    os.makedirs(os.path.join(HERE, 'logs'), exist_ok=True)
    path = os.path.join(HERE, 'logs', 'autotrader-%s.log' % now_kst().strftime('%Y%m%d'))
    handler = logging.FileHandler(path, encoding='utf-8')
    handler.setFormatter(logging.Formatter('%(asctime)s %(message)s'))
    logger = logging.getLogger('autotrader')
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    if sys.stdout is not None:  # pythonw(창 없이 실행)에서는 콘솔이 없다
        console = logging.StreamHandler(sys.stdout)
        console.setFormatter(logging.Formatter('%(asctime)s %(message)s'))
        logger.addHandler(console)


def run_check(client):
    """읽기 전용 점검(주문 없음): 토큰 발급과 잔고 조회가 되는지, 응답 형식이 맞는지 확인한다."""
    print('1) 토큰 발급 + 잔고 조회(kt00018) 시도 - 주문은 보내지 않습니다')
    try:
        holdings = client.balance()
    except Exception as exc:
        print('실패:', exc)
        print('-> 위 메시지의 응답 키를 알려 주시면 필드명을 맞춥니다. (키·계좌번호는 붙여 넣지 마세요)')
        return 1
    print('성공. 보유 종목 %d개' % len(holdings))
    for h in holdings:
        print('  %s %s  수량 %d(매도가능 %d)  매입단가 %.0f  현재가 %.0f' % (h['code'], h['name'], h['qty'], h['sellable'], h['avg'], h['price']))
    print('2) LIVE_SELL = %s (켜짐일 때만 실제 매도 주문이 나갑니다)' % ('켜짐' if live_sell_enabled() else '꺼짐(기록 전용)'))
    return 0


def main():
    load_env()
    setup_logging()
    config = load_config()
    client = KiwoomClient(os.environ.get('KIWOOM_APPKEY', ''), os.environ.get('KIWOOM_SECRETKEY', ''))
    if '--check' in sys.argv:
        sys.exit(run_check(client))
    store = Store()
    bot = Bot(client, store, config)
    token = server_mod.load_or_create_token()
    httpd = server_mod.start_server(bot, store, token)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    logging.getLogger('autotrader').info('로컬 화면 서버: http://127.0.0.1:%d (이 PC에서만 접속 가능). 토큰은 .token 파일 참고', server_mod.PORT)
    try:
        bot.run_forever()
    except KeyboardInterrupt:
        bot.stop_event.set()
        store.event('STOP', None, None, '프로그램 종료(Ctrl+C)')


if __name__ == '__main__':
    main()
