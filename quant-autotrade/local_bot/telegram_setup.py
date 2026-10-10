# -*- coding: utf-8 -*-
"""텔레그램 연결 설정 도구(이 PC의 콘솔에서 직접 실행). 값은 .env 에만 저장하고 화면·로그에는 가려서 보여 준다.

  python telegram_setup.py            봇 토큰 입력(화면에 보이지 않음) -> 일회용 코드 페어링 -> 허용 사용자·채팅 ID 를 .env 에 저장
  python telegram_setup.py --repair   이미 연결돼 있어도 다시 페어링(다른 계정으로 바꿀 때)
  python telegram_setup.py --test     연결 확인 메시지를 실제로 보낸다
  python telegram_setup.py --status   설정 상태 확인(값은 가림)

페어링 보안: 코드는 PC 화면에만 나온다(8자리, 10분 유효, 5회 틀리면 중단). 개인 채팅에서 온 /pair 코드만 받는다.
처음 /start 를 누른 사람을 자동 등록하는 경로는 없다. 봇이 실행 중이면(수신 충돌) 먼저 멈춰야 하므로 telegram_setup.bat 을 쓰면 편하다.
"""
import getpass
import os
import secrets
import sys
import time

import procguard
import tg_format as F
from tg_api import TelegramAPI, TelegramError
from tg_config import load_settings, mask_id, redact, update_env_file

HERE = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(HERE, '.env')
CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'      # 0/O, 1/I 처럼 헷갈리는 글자 제외
CODE_LEN, CODE_TTL_SEC, MAX_ATTEMPTS = 8, 600, 5


class PairingSession:
    """일회용 코드 검증(네트워크 없음). 성공하면 사용 불가가 된다."""

    def __init__(self, code=None, ttl=CODE_TTL_SEC, max_attempts=MAX_ATTEMPTS, clock=time.time):
        self.code = code or ''.join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LEN))
        self.clock, self.ttl, self.max_attempts = clock, ttl, max_attempts
        self.created = clock()
        self.attempts = 0
        self.done = False

    @property
    def display(self):
        return '%s-%s' % (self.code[:4], self.code[4:])

    @staticmethod
    def extract(text):
        """'/pair CODE', '/start CODE', '/pair@Bot CODE' 에서 코드를 꺼낸다. 명령 형식이 아니면 None."""
        text = (text or '').strip()
        if not text.startswith('/'):
            return None
        head, _, rest = text[1:].partition(' ')
        if head.split('@', 1)[0].lower() not in ('pair', 'start') or not rest.strip():
            return None
        return rest.strip().replace('-', '').replace(' ', '').upper()

    def check(self, user, chat, text):
        """반환: ('paired', user_id, chat_id) | ('wrong', 남은 횟수) | ('expired',) | ('locked',) | ('ignore',)."""
        if self.done or chat.get('type') != 'private' or user.get('is_bot'):
            return ('ignore',)
        given = self.extract(text)
        if given is None:
            return ('ignore',)
        if self.clock() - self.created > self.ttl:
            return ('expired',)
        if self.attempts >= self.max_attempts:
            return ('locked',)
        if secrets.compare_digest(given.encode(), self.code.encode()):
            self.done = True
            return ('paired', user['id'], chat['id'])
        self.attempts += 1
        return ('wrong', self.max_attempts - self.attempts)


def run_pairing(api, env_path, session, out=print, poll_timeout=20, stop_after=None):
    """코드가 맞는 /pair 를 받을 때까지 대기한다. 성공 시 .env 를 갱신하고 (user_id, chat_id) 를 돌려준다."""
    offset = None
    try:
        old = api.get_updates(-1, timeout=0)       # 이전에 쌓인 메시지는 버린다
        if old:
            offset = old[-1]['update_id'] + 1
    except TelegramError as exc:
        out('수신 준비 실패: %s' % redact(exc))
        return None
    deadline = session.created + session.ttl
    while session.clock() < deadline and (stop_after is None or stop_after()):
        try:
            updates = api.get_updates(offset, timeout=poll_timeout)
        except TelegramError as exc:
            out('수신 오류(재시도): %s' % redact(exc))
            time.sleep(3)
            continue
        for u in updates:
            offset = u['update_id'] + 1
            msg = u.get('message')
            if not msg:
                continue
            result = session.check(msg.get('from') or {}, msg.get('chat') or {}, msg.get('text'))
            chat_id = (msg.get('chat') or {}).get('id')
            if result[0] == 'paired':
                update_env_file(env_path, {'TELEGRAM_ALLOWED_USER_ID': result[1], 'TELEGRAM_CHAT_ID': result[2]})
                try:
                    api.send_message(result[2], F.head('✅', '연결 완료') + '\n\n이 계정이 자동매매 관제 수신자로 등록되었습니다.\n명령어는 /help 에서 확인하세요.\n'
                                     '<i>PC의 봇을 다시 시작하면 알림이 시작됩니다.</i>')
                except TelegramError:
                    pass
                out('페어링 완료 - 사용자 ID %s, 채팅 ID %s 를 .env 에 저장했습니다.' % (mask_id(result[1]), mask_id(result[2])))
                return result[1], result[2]
            if result[0] == 'wrong':
                out('틀린 코드가 입력되었습니다(남은 시도 %d회).' % result[1])
                api.send_message(chat_id, '코드가 맞지 않습니다.', parse_mode=None)
            elif result[0] == 'locked':
                out('틀린 코드가 %d회 입력되어 페어링을 중단합니다.' % session.max_attempts)
                api.send_message(chat_id, '시도 횟수를 초과했습니다. PC에서 다시 시작하세요.', parse_mode=None)
                return None
            elif result[0] == 'expired':
                api.send_message(chat_id, '코드가 만료되었습니다. PC에서 다시 시작하세요.', parse_mode=None)
                return None
    out('시간이 지나 페어링을 종료합니다. 다시 실행하세요.')
    return None


def load_env_into_os():
    from main import load_env
    load_env()


def cmd_status():
    s = load_settings()
    print('토큰: %s' % ('설정됨' if s.enabled else '없음'))
    print('허용 사용자 ID: %s' % (mask_id(s.allowed_user_id) if s.allowed_user_id else '없음(페어링 필요)'))
    print('채팅 ID: %s' % (mask_id(s.target_chat_id) if s.target_chat_id else '없음'))
    for problem in s.problems():
        print('설정 문제:', problem)
    lock = procguard.held_by_other(os.path.join(HERE, 'bot.lock'))
    print('봇 실행 중: %s' % ('예' if lock else '아니오'))
    return 0 if s.ready else 1


def cmd_test():
    s = load_settings()
    if not s.ready:
        print('토큰과 허용 사용자가 설정되어야 합니다. 먼저 python telegram_setup.py 를 실행하세요.')
        return 1
    api = TelegramAPI(s.token, s.api_base)
    try:
        api.send_message(s.target_chat_id, F.head('✅', '연결 테스트') + '\n\n이 PC에서 보낸 테스트 메시지입니다. 이 메시지가 보이면 알림 경로가 정상입니다.')
    except TelegramError as exc:
        print('전송 실패:', redact(exc))
        return 1
    print('테스트 메시지를 보냈습니다. 휴대폰 텔레그램을 확인하세요.')
    return 0


def main(argv):
    load_env_into_os()
    if '--status' in argv:
        return cmd_status()
    if '--test' in argv:
        return cmd_test()
    if procguard.held_by_other(os.path.join(HERE, 'bot.lock')) and '--force' not in argv:
        print('봇이 실행 중입니다. 같은 토큰으로 두 곳이 메시지를 받으면 충돌하므로 먼저 stop.bat 으로 멈추거나 telegram_setup.bat 을 사용하세요.')
        return 1
    settings = load_settings()
    token = settings.token
    if not token:
        print('BotFather 에서 만든 봇 토큰을 붙여 넣으세요(화면에 보이지 않습니다).')
        token = getpass.getpass('토큰: ').strip()
        if not token:
            print('토큰이 비어 있어 종료합니다.')
            return 1
    api = TelegramAPI(token, settings.api_base)
    try:
        me = api.get_me()
    except TelegramError as exc:
        print('봇 확인 실패:', redact(exc, [token]))
        return 1
    if token != settings.token:
        update_env_file(ENV_PATH, {'TELEGRAM_BOT_TOKEN': token})
        print('토큰을 .env 에 저장했습니다.')
    print('봇 확인: @%s' % me.get('username'))
    if settings.allowed_user_id and '--repair' not in argv:
        print('이미 연결되어 있습니다(사용자 %s). 계정을 바꾸려면 --repair 로 실행하세요.' % mask_id(settings.allowed_user_id))
        return 0
    session = PairingSession()
    print()
    print('휴대폰 텔레그램에서 @%s 에게 개인 메시지로 아래 명령을 보내세요(%d분 안에):' % (me.get('username'), CODE_TTL_SEC // 60))
    print()
    print('    /pair %s' % session.display)
    print()
    print('또는 이 링크를 휴대폰에서 열고 "시작"을 누르세요: https://t.me/%s?start=%s' % (me.get('username'), session.code))
    print('(코드는 이 화면에만 표시되며, 한 번 쓰면 사라집니다.)')
    result = run_pairing(api, ENV_PATH, session)
    return 0 if result else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
