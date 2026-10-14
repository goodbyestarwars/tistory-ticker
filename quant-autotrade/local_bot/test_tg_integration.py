# -*- coding: utf-8 -*-
"""텔레그램 통합 테스트 - 실제 HTTP 경로(urllib → 가짜 Bot API 서버). 토큰·인터넷 불필요: python -m unittest test_tg_integration -v

검증: 롱 폴링 수신·응답, 명령어 등록, 비인가·그룹 차단, 오프셋 보존(재시작 중복 방지), 네트워크 단절·복구, 429/409/웹훅, 로그의 토큰 비노출,
페어링(일회용 코드), 그리고 main.py 를 실제 프로세스로 띄워 강제 종료 후 재시작하는 복구 시나리오.
가짜 서버는 텔레그램을 완전히 대신하지 않는다 - 실제 텔레그램 서버와의 통신은 사용자 PC 에서 따로 확인한다(docs/TELEGRAM.md).
"""
import json
import logging
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import warnings

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bot as bot_mod  # noqa: E402
import fake_telegram  # noqa: E402
import telegram_setup  # noqa: E402
import tg_config  # noqa: E402
import tg_monitor  # noqa: E402
import tg_notify  # noqa: E402
from tg_api import TelegramAPI  # noqa: E402
from tg_service import TelegramService  # noqa: E402
from test_autotrader import FakeClient, holding  # noqa: E402

warnings.simplefilter('ignore', ResourceWarning)
USER = 424242001


class LogCapture(logging.Handler):
    def __init__(self):
        super().__init__(logging.DEBUG)
        self.lines = []

    def emit(self, record):
        self.lines.append(record.getMessage())


class HTTPCase(unittest.TestCase):
    def setUp(self):
        self.fake = fake_telegram.FakeTelegram()
        self.dir = tempfile.mkdtemp()
        self.saved = (tg_notify.IDLE_WAIT_SEC, tg_notify.BACKOFF_BASE_SEC, tg_monitor.TICK_SEC, tg_notify.SEND_GAP_SEC)
        tg_notify.IDLE_WAIT_SEC, tg_notify.BACKOFF_BASE_SEC, tg_monitor.TICK_SEC, tg_notify.SEND_GAP_SEC = 0.1, 0.3, 0.2, 0.0
        self.log = LogCapture()
        logging.getLogger('autotrader').addHandler(self.log)
        logging.getLogger('autotrader').setLevel(logging.DEBUG)
        self.store = bot_mod.Store(os.path.join(self.dir, 'autotrader.db'))
        self.client = FakeClient()
        self.client.holdings = [holding('005930', avg=70000.0, price=72000.0)]
        self.bot = bot_mod.Bot(self.client, self.store, dict(bot_mod.DEFAULT_CONFIG))
        self.store.watch_add('005930', '삼성전자', confirmed=True)
        self.settings = tg_config.Settings(token=self.fake.token, allowed_user_id=USER, api_base=self.fake.base)
        self.services = []

    def tearDown(self):
        for svc in self.services:
            svc.stop()
        logging.getLogger('autotrader').removeHandler(self.log)
        self.fake.close()
        tg_notify.IDLE_WAIT_SEC, tg_notify.BACKOFF_BASE_SEC, tg_monitor.TICK_SEC, tg_notify.SEND_GAP_SEC = self.saved
        shutil.rmtree(self.dir, ignore_errors=True)

    def service(self, start=True):
        svc = TelegramService(self.bot, self.store, self.settings, self.dir)
        self.services.append(svc)
        if start:
            self.assertTrue(svc.start())
        return svc

    def wait_text(self, needle, timeout=8.0, chat_id=USER):
        ok = self.fake.wait_for(lambda: any(needle in t for t in self.fake.texts(chat_id)), timeout)
        self.assertTrue(ok, 'not received: %s\n got: %s' % (needle, [t[:60] for t in self.fake.texts(chat_id)]))


class ServiceHTTPTests(HTTPCase):
    def test_start_registers_commands_and_sends_startup_notice(self):
        self.service()
        self.wait_text('자동매매 봇 시작')
        self.assertTrue(self.fake.wait_for(lambda: self.fake.commands is not None))
        names = [c['command'] for c in self.fake.commands]
        for required in ('status', 'candidates', 'paper', 'holdings', 'orders', 'risk', 'daily', 'mute', 'unmute', 'test', 'help'):
            self.assertIn(required, names)
        self.assertEqual(self.fake.menu_button, {'type': 'commands'})

    def test_owner_commands_over_long_polling(self):
        self.service()
        self.wait_text('자동매매 봇 시작')
        self.fake.push_message(USER, '/status')
        self.wait_text('시스템 상태')
        self.fake.push_message(USER, '/test')
        self.wait_text('연결이 정상')
        self.fake.push_message(USER, '/holdings')
        self.wait_text('실시간 조회')
        text = [t for t in self.fake.texts(USER) if '보유 종목' in t][-1]
        self.assertIn('테스트', text)
        self.fake.push_message(USER, '/start')
        self.assertTrue(self.fake.wait_for(lambda: any(s.get('reply_markup') and 'keyboard' in s['reply_markup'] for s in self.fake.sent)))
        self.fake.push_callback(USER, 'c:paper:trail_atr')
        self.assertTrue(self.fake.wait_for(lambda: len(self.fake.callbacks) == 1))

    def test_stranger_and_group_are_blocked(self):
        self.service()
        self.wait_text('자동매매 봇 시작')
        before = len(self.fake.sent)
        stranger = 99001
        self.fake.push_message(stranger, '/holdings')
        self.fake.push_message(stranger, '/status')
        self.fake.push_message(USER, '/holdings', chat_id=-100777, chat_type='supergroup')       # 그룹에서는 주인도 무응답
        self.fake.push_message(stranger, '/holdings', chat_id=-100777, chat_type='supergroup')
        self.assertTrue(self.fake.wait_for(lambda: any('개인 전용' in t for t in self.fake.texts(stranger))))
        self.wait_text('허용되지 않은 접근 시도')                                              # 주인에게 경고
        time.sleep(0.6)
        self.assertEqual(len(self.fake.texts(stranger)), 1)                                  # 차단 안내는 한 번만
        self.assertEqual(self.fake.texts(-100777), [])
        everything = ' '.join(self.fake.texts(stranger))
        self.assertNotIn('삼성전자', everything)
        self.assertNotIn('테스트', everything)
        self.assertEqual(len(self.fake.sent) - before, 2)                                    # 안내 1 + 주인 경고 1

    def test_offset_persisted_so_restart_does_not_reprocess(self):
        svc = self.service()
        self.wait_text('자동매매 봇 시작')
        self.fake.push_message(USER, '/risk')
        self.wait_text('자금·위험관리')
        svc.stop()
        n = len([t for t in self.fake.texts(USER) if '자금·위험관리' in t])
        self.fake.push_message(USER, '/orders')
        svc2 = self.service()
        self.wait_text('최근 주문·처리 상태')
        time.sleep(0.6)
        self.assertEqual(len([t for t in self.fake.texts(USER) if '자금·위험관리' in t]), n)
        self.assertEqual(len([t for t in self.fake.texts(USER) if '최근 주문·처리 상태' in t]), 1)
        self.assertIsNotNone(svc2.tstore.kv_get('update_offset'))

    def test_network_drop_queues_alerts_and_delivers_once_after_recovery(self):
        svc = self.service()
        self.wait_text('자동매매 봇 시작')
        self.fake.fail_mode = 'drop'
        svc.notifier.notify('t1', '🚨 끊김 중 알림 1', 'alert', 'warn')
        svc.notifier.notify('t2', '🚨 끊김 중 알림 2', 'alert', 'critical')
        time.sleep(1.2)
        self.assertEqual([t for t in self.fake.texts(USER) if '끊김 중' in t], [])
        self.assertFalse(svc.sender.health()['ok'])
        self.fake.fail_mode = None
        self.wait_text('끊김 중 알림 2')
        self.wait_text('끊김 중 알림 1')
        time.sleep(0.8)
        self.assertEqual(len([t for t in self.fake.texts(USER) if '끊김 중 알림 1' in t]), 1)       # 중복 없음
        self.assertEqual(len([t for t in self.fake.texts(USER) if '끊김 중 알림 2' in t]), 1)
        self.assertTrue(svc.sender.health()['ok'])
        self.fake.push_message(USER, '/test')                                                # 수신도 복구됨
        self.wait_text('연결이 정상')

    def test_server_errors_and_rate_limit_are_retried(self):
        svc = self.service()
        self.wait_text('자동매매 봇 시작')
        self.fake.fail_mode = '500'
        svc.notifier.notify('e1', '서버오류 중 알림', 'alert', 'warn')
        time.sleep(0.8)
        self.fake.fail_mode = '429'
        time.sleep(1.5)
        self.fake.fail_mode = None
        self.wait_text('서버오류 중 알림')
        self.assertEqual(len([t for t in self.fake.texts(USER) if '서버오류 중 알림' in t]), 1)

    def test_conflict_raises_alert_and_webhook_is_cleared(self):
        svc = self.service()
        self.wait_text('자동매매 봇 시작')
        self.fake.conflict = True
        self.assertTrue(self.fake.wait_for(lambda: svc.poll_conflicts >= 3, 20))
        self.wait_text('텔레그램 수신 충돌', 8)
        self.fake.conflict = False
        self.wait_text('수신 충돌이 해소', 12)
        self.fake.webhook_active = True
        self.assertTrue(self.fake.wait_for(lambda: not self.fake.webhook_active, 10))      # 웹훅이 있으면 해제하고 폴링을 이어간다
        self.fake.push_message(USER, '/risk')
        self.wait_text('자금·위험관리', 10)

    def test_token_never_logged_or_sent(self):
        svc = self.service()
        self.wait_text('자동매매 봇 시작')
        self.fake.fail_mode = '500'
        self.fake.push_message(USER, '/status')
        svc.notifier.notify('x', '알림', 'alert', 'warn')
        time.sleep(1.0)
        self.fake.fail_mode = None
        wrong = TelegramAPI('111:WRONGTOKENWRONGTOKENWRONGTOKENWRONG', self.fake.base)
        try:
            wrong.get_me()
        except Exception as exc:
            self.log.lines.append(str(exc))
        self.fake.push_message(USER, '/status')
        self.wait_text('시스템 상태')
        blob = '\n'.join(self.log.lines) + '\n'.join(self.fake.texts(USER))
        self.assertNotIn(self.fake.token, blob)
        self.assertNotIn(self.fake.token.split(':', 1)[1], blob)
        self.assertNotIn('WRONGTOKEN', blob)


class PairingTests(HTTPCase):
    def later(self, delay, *pushes):
        """페어링이 시작되어 이전 메시지를 비운 '뒤에' 메시지를 보낸다(사용자가 코드를 보는 순서와 같다)."""
        import threading

        def run():
            time.sleep(delay)
            for fn, args, kwargs in pushes:
                fn(*args, **kwargs)
        threading.Thread(target=run, daemon=True).start()

    def run_pairing(self, session):
        env = os.path.join(self.dir, '.env')
        open(env, 'w', encoding='utf-8').write('KIWOOM_APPKEY=abc\nTELEGRAM_BOT_TOKEN=%s\n' % self.fake.token)
        api = TelegramAPI(self.fake.token, self.fake.base)
        out = []
        result = telegram_setup.run_pairing(api, env, session, out=out.append, poll_timeout=1)
        return result, out, env

    def test_session_rules(self):
        s = telegram_setup.PairingSession(code='ABCD2345')
        u, c = {'id': 5, 'is_bot': False}, {'id': 5, 'type': 'private'}
        self.assertEqual(s.check(u, {'id': -9, 'type': 'group'}, '/pair ABCD2345'), ('ignore',))          # 그룹에서는 무시
        self.assertEqual(s.check(u, c, '아무 말'), ('ignore',))
        self.assertEqual(s.check(u, c, '/pair WRONG123'), ('wrong', 4))
        self.assertEqual(s.check(u, c, '/pair abcd-2345'), ('paired', 5, 5))                               # 대소문자·하이픈 허용
        self.assertEqual(s.check(u, c, '/pair ABCD2345'), ('ignore',))                                     # 일회용
        t = telegram_setup.PairingSession(code='ABCD2345', max_attempts=2)
        t.check(u, c, '/pair AAAAAAAA')
        t.check(u, c, '/pair BBBBBBBB')
        self.assertEqual(t.check(u, c, '/pair ABCD2345'), ('locked',))                                     # 횟수 초과 후에는 맞는 코드도 거부
        clock = [1000.0]
        e = telegram_setup.PairingSession(code='ABCD2345', ttl=600, clock=lambda: clock[0])
        clock[0] += 601
        self.assertEqual(e.check(u, c, '/pair ABCD2345'), ('expired',))
        self.assertEqual(telegram_setup.PairingSession.extract('/start ABCD2345'), 'ABCD2345')            # 딥링크
        self.assertEqual(telegram_setup.PairingSession.extract('/pair@my_bot ABCD2345'), 'ABCD2345')
        self.assertEqual(len(set(telegram_setup.PairingSession().code for _ in range(50))), 50)

    def test_pairing_end_to_end_writes_env_only_for_correct_private_code(self):
        session = telegram_setup.PairingSession(code='K7M2QX9P', ttl=15)
        push = self.fake.push_message
        self.later(0.5, (push, (555, '/start'), {}),                                    # 처음 /start 를 눌러도 등록되지 않는다
                   (push, (555, '/pair AAAAAAAA'), {}),
                   (push, (555, '/pair K7M2QX9P'), {'chat_id': -1005, 'chat_type': 'group'}))     # 그룹에서 맞는 코드를 보내도 무시
        self.later(1.6, (push, (USER, '/pair K7M2-QX9P'), {}))
        result, out, env = self.run_pairing(session)
        self.assertEqual(result, (USER, USER))
        text = open(env, encoding='utf-8').read()
        self.assertIn('TELEGRAM_ALLOWED_USER_ID=%d' % USER, text)
        self.assertIn('TELEGRAM_CHAT_ID=%d' % USER, text)
        self.assertNotIn('=555', text)
        self.assertIn('KIWOOM_APPKEY=abc', text)
        self.assertTrue(any('연결 완료' in t for t in self.fake.texts(USER)))
        self.assertFalse(any(str(USER) in line for line in out))                       # 콘솔에도 전체 ID 비노출(끝 3자리만)

    def test_setup_main_full_flow_token_then_pairing(self):
        """telegram_setup.main 전체: 토큰 입력(메모장 단계는 대체) -> 형식 검사 -> getMe 확인 -> .env 저장 -> 코드 페어링."""
        env = os.path.join(self.dir, '.env')
        open(env, 'w', encoding='utf-8-sig').write('KIWOOM_APPKEY=abc\nTELEGRAM_BOT_TOKEN=\n')
        saved = (telegram_setup.ENV_PATH, telegram_setup.ask_token, telegram_setup.load_env_into_os, telegram_setup.PairingSession.__init__)
        for key in ('TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_USER_ID', 'TELEGRAM_CHAT_ID'):
            os.environ.pop(key, None)
        os.environ['TELEGRAM_API_BASE'] = self.fake.base
        telegram_setup.ENV_PATH = env
        telegram_setup.load_env_into_os = lambda: None
        telegram_setup.ask_token = lambda path, typed=False, out=print: telegram_setup.clean_token(' "%s" ' % self.fake.token)
        orig_init = telegram_setup.PairingSession.__init__
        telegram_setup.PairingSession.__init__ = lambda self_, code=None, **kw: orig_init(self_, code='Q2W3E4R5', ttl=15, **kw)
        self.later(1.0, (self.fake.push_message, (USER, '/start Q2W3E4R5'), {}))          # 딥링크 형태
        try:
            rc = telegram_setup.main([])
        finally:
            telegram_setup.ENV_PATH, telegram_setup.ask_token, telegram_setup.load_env_into_os = saved[:3]
            telegram_setup.PairingSession.__init__ = saved[3]
            os.environ.pop('TELEGRAM_API_BASE', None)
        self.assertEqual(rc, 0)
        text = open(env, encoding='utf-8').read()
        self.assertIn('TELEGRAM_BOT_TOKEN=%s' % self.fake.token, text)
        self.assertIn('TELEGRAM_ALLOWED_USER_ID=%d' % USER, text)
        self.assertIn('KIWOOM_APPKEY=abc', text)
        self.assertFalse(open(env, 'rb').read().startswith(b'\xef\xbb\xbf'))
        loaded = tg_config.load_settings({'TELEGRAM_BOT_TOKEN': self.fake.token, 'TELEGRAM_ALLOWED_USER_ID': str(USER)})
        self.assertTrue(loaded.ready)

    def test_pairing_aborts_after_too_many_wrong_codes(self):
        session = telegram_setup.PairingSession(code='K7M2QX9P', max_attempts=2, ttl=15)
        push = self.fake.push_message
        self.later(0.5, (push, (555, '/pair BADBADBA'), {}), (push, (555, '/pair BADBADB2'), {}), (push, (555, '/pair K7M2QX9P'), {}))
        result, out, env = self.run_pairing(session)
        self.assertIsNone(result)
        self.assertNotIn('TELEGRAM_ALLOWED_USER_ID', open(env, encoding='utf-8').read())


@unittest.skipUnless(os.environ.get('SKIP_E2E') != '1', 'e2e skipped')
class ProcessRecoveryTests(HTTPCase):
    """main.py 를 실제 프로세스로 띄워 강제 종료 -> 재시작(= 작업 스케줄러 감시 작업이 하는 일)을 검증한다. 키움은 연결 거부 주소로 막아 둔다."""

    def spawn(self, port, extra=()):
        env = dict(os.environ, AUTOTRADER_PORT=str(port), PYTHONIOENCODING='utf-8', PYTHONUTF8='1')
        for k in ('KIWOOM_APPKEY', 'KIWOOM_SECRETKEY', 'LIVE_SELL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_USER_ID', 'TELEGRAM_CHAT_ID', 'KIWOOM_BASE_URL', 'TELEGRAM_API_BASE'):
            env.pop(k, None)
        return subprocess.Popen([sys.executable, os.path.join(self.app, 'main.py')] + list(extra), cwd=self.app, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def setUp(self):
        super().setUp()
        self.app = os.path.join(self.dir, 'app')
        os.makedirs(self.app)
        for name in os.listdir(HERE):
            if name.endswith('.py') and not name.startswith(('test_', 'fake_')):
                shutil.copy(os.path.join(HERE, name), self.app)
        with open(os.path.join(self.app, '.env'), 'w', encoding='utf-8') as f:
            f.write('KIWOOM_APPKEY=dummyapp\nKIWOOM_SECRETKEY=dummysecret\nKIWOOM_BASE_URL=http://127.0.0.1:1\nTELEGRAM_BOT_TOKEN=%s\nTELEGRAM_ALLOWED_USER_ID=%d\nTELEGRAM_API_BASE=%s\n'
                    % (self.fake.token, USER, self.fake.base))
        self.port = 18700 + os.getpid() % 200
        self.procs = []

    def tearDown(self):
        for p in self.procs:
            if p.poll() is None:
                p.kill()
        for p in self.procs:
            p.wait(timeout=10)
        super().tearDown()

    def start(self, extra=()):
        p = self.spawn(self.port, extra)
        self.procs.append(p)
        return p

    def test_start_command_kill_restart_recovers_and_reports(self):
        p1 = self.start()
        self.wait_text('자동매매 봇 시작', 20)
        self.fake.push_message(USER, '/status')
        self.wait_text('시스템 상태', 15)
        self.assertTrue(os.path.exists(os.path.join(self.app, 'bot.lock')))
        # 두 번째 인스턴스(감시 작업의 주기적 시도에 해당)는 조용히 끝나야 한다
        dup = self.start(['--watchdog'])
        dup.wait(timeout=20)
        self.assertEqual(dup.returncode, 0)
        self.assertIsNone(p1.poll())
        # 강제 종료(전원 차단/작업 종료에 해당)
        p1.kill()
        p1.wait(timeout=10)
        db = sqlite3.connect(os.path.join(self.app, 'telegram.db'))
        db.execute("UPDATE kv SET value=? WHERE key='last_start_notice'", (json.dumps(0),))
        db.commit()
        db.close()
        time.sleep(1.0)
        p2 = self.start(['--watchdog'])           # 락 파일은 남아 있지만 프로세스가 죽었으므로 인계해야 한다
        self.assertTrue(self.fake.wait_for(lambda: any('비정상 종료 후 복구' in t or 'PC 부팅 후 자동 시작' in t for t in self.fake.texts(USER)), 20),
                        [t[:50] for t in self.fake.texts(USER)])
        self.fake.push_message(USER, '/test')
        self.wait_text('연결이 정상', 15)
        self.assertIsNone(p2.poll())

    def test_stop_marker_prevents_watchdog_restart_but_manual_start_clears_it(self):
        open(os.path.join(self.app, 'NO_AUTOSTART'), 'w').write('x')
        p = self.start(['--watchdog'])
        p.wait(timeout=20)
        self.assertEqual(p.returncode, 0)
        self.assertEqual(self.fake.texts(USER), [])                      # 켜지지 않았다
        p2 = self.start()                                                # 수동 시작은 표식을 지우고 켜진다
        self.wait_text('자동매매 봇 시작', 20)
        self.assertFalse(os.path.exists(os.path.join(self.app, 'NO_AUTOSTART')))
        self.assertIsNone(p2.poll())

    def test_bot_runs_without_telegram_settings(self):
        with open(os.path.join(self.app, '.env'), 'w', encoding='utf-8') as f:
            f.write('KIWOOM_APPKEY=dummyapp\nKIWOOM_SECRETKEY=dummysecret\nKIWOOM_BASE_URL=http://127.0.0.1:1\n')
        p = self.start()
        time.sleep(4)
        self.assertIsNone(p.poll())                                      # 텔레그램 설정이 없어도 봇은 정상 기동·유지
        self.assertEqual(self.fake.texts(USER), [])
        logs = ''.join(open(os.path.join(self.app, 'logs', f), encoding='utf-8').read() for f in os.listdir(os.path.join(self.app, 'logs')))
        self.assertIn('텔레그램 관제 비활성', logs)                          # 설정 없음은 오류가 아니라 정상적인 '비활성'
        self.assertNotIn('시작하지 못했습니다', logs)


if __name__ == '__main__':
    unittest.main()
