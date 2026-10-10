# -*- coding: utf-8 -*-
"""텔레그램 명령 처리(전부 읽기 전용). 매수·매도 지시, 규칙(손절·익절·LIVE_SELL) 변경, 감시 종목 추가·해제는 명령으로 만들지 않는다.

dispatch(text) -> [(응답 텍스트, reply_markup 또는 None), ...]
- '/status@봇이름' 같은 그룹식 표기, 하단 고정 키보드 버튼 글자, 인라인 버튼 콜백('c:명령:인자')을 같은 명령으로 처리한다.
- 인가(허용 사용자·개인 채팅)는 호출자(TelegramService.handle_update)가 먼저 확인한다. 이 모듈은 인가된 요청만 받는다.
"""
import re

import tg_format as F
from tg_views import Views

COMMANDS = tuple((c, d) for c, d in F.HELP_ITEMS) + (('start', '시작·메뉴'),)
BOT_COMMANDS = tuple((c, d) for c, d in F.HELP_ITEMS)       # setMyCommands 에 등록할 목록(start 는 텔레그램이 기본 제공)

MAIN_KEYBOARD = {'keyboard': [[{'text': '📊 상태'}, {'text': '🔎 후보'}, {'text': '🧪 모의'}],
                              [{'text': '💼 보유'}, {'text': '📜 주문'}, {'text': '🛡 위험'}],
                              [{'text': '📋 일일'}, {'text': '❔ 도움말'}]],
                 'resize_keyboard': True, 'is_persistent': True}
BUTTON_LABELS = {'📊 상태': 'status', '🔎 후보': 'candidates', '🧪 모의': 'paper', '💼 보유': 'holdings', '📜 주문': 'orders', '🛡 위험': 'risk',
                 '📋 일일': 'daily', '❔ 도움말': 'help'}
DURATION_RE = re.compile(r'^(\d+(?:\.\d+)?)\s*(m|min|h|d|분|시간|일)?$', re.I)
DEFAULT_MUTE_SEC, MAX_MUTE_SEC = 12 * 3600, 7 * 86400


def parse_command(text):
    """'/status@Bot arg' -> ('status', 'arg'). 키보드 버튼 글자도 명령으로 바꾼다. 명령이 아니면 (None, text)."""
    text = (text or '').strip()
    if text in BUTTON_LABELS:
        return BUTTON_LABELS[text], ''
    if not text.startswith('/'):
        return None, text
    head, _, arg = text[1:].partition(' ')
    return head.split('@', 1)[0].lower(), arg.strip()


def parse_duration(arg):
    """'2h', '90m', '1d', '2시간' -> 초. 비어 있으면 기본값. 해석 불가면 None. 최대 7일."""
    arg = (arg or '').strip()
    if not arg:
        return DEFAULT_MUTE_SEC
    m = DURATION_RE.match(arg)
    if not m:
        return None
    value, unit = float(m.group(1)), (m.group(2) or 'h').lower()
    mult = 60 if unit in ('m', 'min', '분') else 86400 if unit in ('d', '일') else 3600
    return int(min(max(value * mult, 60), MAX_MUTE_SEC))


class Commands:
    def __init__(self, svc):
        self.svc = svc
        self.views = Views(svc)
        self._msg_age = None
        self.table = {'start': self.start, 'help': self.help, 'menu': self.help, 'status': self.status, 'candidates': self.candidates, 'paper': self.paper,
                      'holdings': self.holdings, 'orders': self.orders, 'risk': self.risk, 'daily': self.daily, 'mute': self.mute, 'unmute': self.unmute, 'test': self.test}

    def dispatch(self, text, msg_age=None):
        self._msg_age = msg_age
        cmd, arg = parse_command(text)
        if cmd is None:
            return [('명령어를 보내 주세요. /help 에서 전체 목록을 볼 수 있습니다.', MAIN_KEYBOARD)]
        handler = self.table.get(cmd)
        if handler is None:
            return [('알 수 없는 명령입니다: /%s\n/help 에서 전체 목록을 확인하세요.' % F.esc(cmd[:30]), None)]
        out = handler(arg)
        return out if isinstance(out, list) else [out]

    def dispatch_callback(self, data):
        """인라인 버튼 'c:명령:인자'."""
        parts = (data or '').split(':', 2)
        if len(parts) < 2 or parts[0] != 'c' or parts[1] not in ('candidates', 'paper'):
            return [('만료된 버튼입니다. /help 에서 다시 선택하세요.', None)]
        return self.dispatch('/%s %s' % (parts[1], parts[2] if len(parts) > 2 else ''))

    # ---- 핸들러 ----
    def start(self, arg):
        return [(F.fmt_help(), MAIN_KEYBOARD)]

    def help(self, arg):
        return [(F.fmt_help(), MAIN_KEYBOARD)]

    def status(self, arg):
        return self.views.status()

    def candidates(self, arg):
        return self.views.candidates(arg)

    def paper(self, arg):
        return self.views.paper(arg)

    def holdings(self, arg):
        return self.views.holdings()

    def orders(self, arg):
        return self.views.orders()

    def risk(self, arg):
        return self.views.risk()

    def daily(self, arg):
        return self.views.daily()

    def mute(self, arg):
        seconds = parse_duration(arg)
        if seconds is None:
            return ('시간 형식을 이해하지 못했습니다. 예: /mute 2h · /mute 90m · /mute 1d (기본 12시간, 최대 7일)', None)
        until = self.svc.notifier.set_mute(seconds)
        return (F.fmt_mute(until, self.svc.now_dt()), None)

    def unmute(self, arg):
        suppressed = self.svc.notifier.clear_mute()
        return (F.fmt_unmute(suppressed, self.svc.now_dt()), None)

    def test(self, arg):
        svc = self.svc
        mute_until = svc.notifier.mute_until()
        age = self._msg_age
        data = {'now': svc.now_dt(), 'latency': ('%.1f' % age) if age is not None else '-', 'uid_tail': str(svc.settings.allowed_user_id)[-3:],
                'net_ok': svc.sender.health()['ok'], 'mute_until': mute_until if mute_until > svc.clock() else None}
        return (F.fmt_test(data), None)
