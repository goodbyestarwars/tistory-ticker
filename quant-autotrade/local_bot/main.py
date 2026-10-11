# -*- coding: utf-8 -*-
"""실행: python main.py  (또는 run.bat). 점검: python main.py --check (읽기 전용).
매수 기능은 없다. 매도는 .env 의 LIVE_SELL=true 일 때만 실제로 나간다(기본 꺼짐).
텔레그램 관제(알림·읽기 전용 명령)는 .env 에 TELEGRAM_* 가 설정돼 있을 때만 켜지며, 실패해도 봇 동작에는 영향이 없다.
--watchdog: 작업 스케줄러 감시 작업이 쓰는 옵션. NO_AUTOSTART 파일(stop.bat 이 만듦)이 있으면 켜지 않고, 이미 실행 중이면 조용히 끝난다."""
import logging
import os
import sys
import threading
from datetime import datetime

import procguard

import server as server_mod
from bot import HERE, Bot, Store, live_sell_enabled, load_config, now_kst
from kiwoom import KiwoomClient


def load_env():
    """.env 의 KEY=VALUE 를 환경변수로 읽는다(이미 있는 값은 덮어쓰지 않는다). 키는 로그에 찍지 않는다."""
    path = os.path.join(HERE, '.env')
    if not os.path.exists(path):
        return
    with open(path, encoding='utf-8-sig') as f:      # 메모장이 BOM 을 붙여 저장해도 첫 줄 키가 깨지지 않게
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


def start_telegram(bot, store):
    """텔레그램 관제를 켠다. 설정이 없거나 어떤 오류가 나도 봇은 그대로 동작한다."""
    try:
        from tg_config import load_settings
        from tg_service import TelegramService
        settings = load_settings()
        if not settings.enabled:
            logging.getLogger('autotrader').info('텔레그램 관제 비활성: .env 에 TELEGRAM_BOT_TOKEN 이 없습니다(설정은 telegram_setup.bat)')
            return None
        service = TelegramService(bot, store, settings, HERE)
        service.start()
        return service
    except Exception as exc:
        logging.getLogger('autotrader').error('텔레그램 관제를 시작하지 못했습니다(봇은 계속 동작): %s', type(exc).__name__)
        return None


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
    check_only = '--check' in sys.argv
    no_autostart = os.path.join(HERE, 'NO_AUTOSTART')
    if not check_only:
        if '--watchdog' in sys.argv:
            if os.path.exists(no_autostart):
                sys.exit(0)     # stop.bat 으로 일부러 멈춘 상태 - 다시 시작(restart.bat/run.bat)하기 전까지 감시 작업이 켜지 않는다
        elif os.path.exists(no_autostart):
            os.remove(no_autostart)
        lock = procguard.InstanceLock(os.path.join(HERE, 'bot.lock'))
        if not lock.acquire():
            sys.exit(0)         # 이미 실행 중(감시 작업의 주기적 시도 포함) - 조용히 끝낸다
    setup_logging()
    config = load_config()
    client = KiwoomClient(os.environ.get('KIWOOM_APPKEY', ''), os.environ.get('KIWOOM_SECRETKEY', ''))
    if check_only:
        sys.exit(run_check(client))
    store = Store()
    bot = Bot(client, store, config)
    token = server_mod.load_or_create_token()
    httpd = server_mod.start_server(bot, store, token)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    logging.getLogger('autotrader').info('로컬 화면 서버: http://127.0.0.1:%d (이 PC에서만 접속 가능). 토큰은 .token 파일 참고', server_mod.PORT)
    telegram = start_telegram(bot, store)
    try:
        bot.run_forever()
    except KeyboardInterrupt:
        bot.stop_event.set()
        store.event('STOP', None, None, '프로그램 종료(Ctrl+C)')
    finally:
        if telegram:
            telegram.stop()
        lock.release()


if __name__ == '__main__':
    main()
