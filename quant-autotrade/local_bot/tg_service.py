# -*- coding: utf-8 -*-
"""텔레그램 관제 서비스: 봇 프로세스 안에서 도는 가벼운 스레드 3개(발송 · 롱 폴링 수신 · 감시).

- 외부에서 PC로 들어오는 포트는 없다. api.telegram.org 로 나가는 HTTPS(롱 폴링)만 쓴다.
- 인가: 허용 사용자 ID(.env TELEGRAM_ALLOWED_USER_ID)와 개인 채팅만 통과한다. 그룹·채널·다른 사용자는 응답하지 않거나(그룹) 차단 안내만 한다.
  처음 /start 를 누른 사람을 관리자로 등록하는 기능은 없다 - 페어링은 PC 콘솔에서 일회용 코드를 확인하는 telegram_setup.py 로만 한다.
- 이 서비스의 어떤 오류도 봇의 손절·익절 판단 루프를 멈추지 않는다(모든 스레드 루프가 예외를 삼키고 백오프한다).
- 실행 상태(kv run_state)로 비정상 종료·PC 재부팅 후 시작을 구분해 알린다. 계획된 재시작은 stop/restart 스크립트가 남기는 planned_stop.flag 로 구분한다.
"""
import logging
import os
import threading
import time
from collections import deque
from datetime import datetime, timedelta, timezone

import tg_format as F
from tg_api import TelegramAPI, TelegramError
from tg_commands import BOT_COMMANDS, Commands
from tg_config import mask_id, redact
from tg_monitor import Monitor
from tg_notify import Notifier, Sender, fmt_duration, plain
from tg_store import TelegramStore

KST = timezone(timedelta(hours=9))
log = logging.getLogger('autotrader.telegram')
LONGPOLL_SEC = 25
STALE_UPDATE_SEC = 600
PLANNED_FLAG = 'planned_stop.flag'
PLANNED_FRESH_SEC = 900
START_NOTICE_GAP_SEC = 300
BOOT_UPTIME_SEC = 900


def pc_uptime_sec():
    """PC가 켜진 뒤 경과 시간(초). 알 수 없으면 None."""
    try:
        if os.name == 'nt':
            import ctypes
            return ctypes.windll.kernel32.GetTickCount64() / 1000.0
        with open('/proc/uptime') as f:
            return float(f.read().split()[0])
    except (OSError, ValueError, AttributeError):
        return None


class TelegramService:
    def __init__(self, bot, store, settings, base_dir, research_dir=None, clock=None, api=None, uptime=pc_uptime_sec):
        self.bot, self.store, self.settings, self.base_dir = bot, store, settings, base_dir
        self.db_path = store.path
        self.research_dir = research_dir or os.path.join(base_dir, 'research')
        self.clock = clock or time.time
        self.uptime = uptime
        self.tstore = TelegramStore(os.path.join(base_dir, 'telegram.db'))
        self.api = api or TelegramAPI(settings.token, settings.api_base)
        self.stop_event = threading.Event()
        self.wake = threading.Event()
        self.notifier = Notifier(self.tstore, self.clock, wake=self.wake.set)
        self.sender = Sender(self.tstore, self.api, self.notifier, settings.target_chat_id, clock=self.clock)
        self.commands = Commands(self)
        self.monitor = Monitor(self)
        self.threads = []
        self.started_at = None
        self.poll_conflicts = 0
        self.commands_registered = False
        self._register_after = 0.0
        self._cmd_times = deque(maxlen=16)
        self.holdings_cache, self.holdings_fetched_at = None, 0.0
        self.running = False

    def now_dt(self):
        return datetime.fromtimestamp(self.clock(), KST)

    # ---- 시작·종료 ----
    def start(self, threads=True):
        s = self.settings
        if not s.enabled:
            log.info('텔레그램 관제 비활성: TELEGRAM_BOT_TOKEN 이 설정되지 않았습니다(.env)')
            return False
        for problem in s.problems():
            log.error('텔레그램 설정 오류: %s', problem)
            return False
        if not s.allowed_user_id:
            log.warning('텔레그램: 허용 사용자가 등록되지 않아 알림·명령을 쓰지 않습니다. telegram_setup.bat 으로 페어링하세요')
            return False
        self.started_at = self.clock()
        self.tstore.outbox_reset_sending()
        self.tstore.outbox_prune(self.started_at - 30 * 86400)
        info = self.detect_start()
        self.heartbeat()
        if self.started_at - float(self.tstore.kv_get('last_start_notice', 0) or 0) >= START_NOTICE_GAP_SEC:
            self.tstore.kv_set('last_start_notice', self.started_at)
            self.notifier.notify('start:%d' % int(self.started_at), F.fmt_startup(info, self.now_dt()), 'alert', 'warn' if info['kind'] == 'unclean' else 'info')
        self.running = True
        if not threads:
            return True
        for name, target in (('tg-sender', lambda: self.sender.run(self.stop_event, self.wake)), ('tg-poll', self.poll_loop), ('tg-monitor', lambda: self.monitor.run(self.stop_event))):
            th = threading.Thread(target=self._guard, args=(name, target), name=name, daemon=True)
            th.start()
            self.threads.append(th)
        log.info('텔레그램 관제 시작(개인 채팅 %s, 시작 유형 %s)', mask_id(s.target_chat_id), info['kind'])
        return True

    def _guard(self, name, target):
        """스레드가 예외로 죽으면 기록하고 잠시 뒤 다시 돌린다. 봇 본체에는 영향이 없다."""
        while not self.stop_event.is_set():
            try:
                target()
                return
            except Exception as exc:
                log.error('텔레그램 스레드 %s 오류(재시작): %s', name, redact(exc))
                self.stop_event.wait(10)

    def stop(self):
        self.stop_event.set()
        self.wake.set()
        for th in self.threads:
            th.join(timeout=2)
        if self.running:
            try:
                self.tstore.kv_set('run_state', {'state': 'stopped', 'heartbeat': self.clock(), 'pid': os.getpid(), 'started': self.started_at})
            except Exception:
                pass
            self.running = False

    def heartbeat(self):
        self.tstore.kv_set('run_state', {'state': 'running', 'heartbeat': self.clock(), 'pid': os.getpid(), 'started': self.started_at})

    def detect_start(self):
        """이번 시작이 처음/계획된 재시작/PC 부팅 후/비정상 종료 후 중 무엇인지 판정한다."""
        now = self.clock()
        prev = self.tstore.kv_get('run_state')
        live_prev = self.tstore.kv_get('live_sell')
        live_now = bool(self.bot.status()['live_sell'])
        self.tstore.kv_set('live_sell', live_now)
        flag = os.path.join(self.base_dir, PLANNED_FLAG)
        planned = os.path.exists(flag) and now - os.path.getmtime(flag) < PLANNED_FRESH_SEC
        if os.path.exists(flag):
            try:
                os.remove(flag)
            except OSError:
                pass
        info = {'live_sell': live_now, 'watch_count': len(self.bot.store.watch_list()), 'mode_changed': live_prev is not None and live_prev != live_now}
        if not prev:
            return dict(info, kind='first')
        beat = float(prev.get('heartbeat') or 0)
        info.update(last_heartbeat=beat, gap_text=fmt_duration(now - beat))
        if prev.get('state') == 'stopped' or planned:
            return dict(info, kind='planned')
        up = self.uptime()
        if up is not None and up < BOOT_UPTIME_SEC:
            return dict(info, kind='boot')
        return dict(info, kind='unclean')

    # ---- 수신(롱 폴링) ----
    def poll_loop(self):
        offset = self.tstore.kv_get('update_offset')
        backoff = 2
        while not self.stop_event.is_set():
            self._ensure_commands()
            try:
                updates = self.api.get_updates(offset, timeout=LONGPOLL_SEC)
            except TelegramError as exc:
                self._on_poll_error(exc)
                self.stop_event.wait(backoff)
                backoff = min(backoff * 2, 60)
                continue
            backoff = 2
            self.poll_conflicts = 0
            for update in updates or []:
                try:
                    self.handle_update(update)
                except Exception as exc:
                    log.error('텔레그램 업데이트 처리 오류: %s', redact(exc))
                offset = update['update_id'] + 1
                self.tstore.kv_set('update_offset', offset)

    def _on_poll_error(self, exc):
        if exc.code == 409:
            self.poll_conflicts += 1
            if 'webhook' in str(exc).lower():
                try:
                    self.api.delete_webhook()
                    log.warning('텔레그램: 웹훅이 설정돼 있어 해제했습니다(롱 폴링 사용)')
                    self.poll_conflicts = 0
                except TelegramError:
                    pass
        elif exc.code == 401:
            log.error('텔레그램 수신 실패: 봇 토큰이 올바르지 않습니다(.env TELEGRAM_BOT_TOKEN)')
        else:
            log.warning('텔레그램 수신 실패(재시도): %s', redact(exc))

    def _ensure_commands(self):
        if self.commands_registered or self.clock() < self._register_after:
            return
        try:
            self.api.set_my_commands(BOT_COMMANDS)
            self.api.set_menu_button_commands()
            self.commands_registered = True
            log.info('텔레그램 명령어 목록 등록 완료')
        except TelegramError as exc:
            self._register_after = self.clock() + 300
            log.warning('텔레그램 명령어 목록 등록 실패(5분 뒤 재시도): %s', redact(exc))

    # ---- 인가·처리 ----
    def authorize(self, user, chat):
        """'ok' | 'denied' | 'ignore'. 개인 채팅이 아니면 무응답(계좌 정보가 그룹에 노출되지 않게), 허용 사용자가 아니면 차단."""
        if chat.get('type') != 'private' or user.get('is_bot'):
            return 'ignore'
        s = self.settings
        if user.get('id') != s.allowed_user_id or chat.get('id') != s.target_chat_id:
            return 'denied'
        return 'ok'

    def handle_update(self, update):
        msg, cb = update.get('message'), update.get('callback_query')
        if msg:
            user, chat, text, when = msg.get('from') or {}, msg.get('chat') or {}, msg.get('text') or '', msg.get('date')
        elif cb:
            user, chat, text, when = cb.get('from') or {}, (cb.get('message') or {}).get('chat') or {}, cb.get('data') or '', (cb.get('message') or {}).get('date')
        else:
            return
        decision = self.authorize(user, chat)
        if decision == 'ignore':
            return
        if decision == 'denied':
            self._deny(user, chat)
            return
        now = self.clock()
        if msg and when and now - when > STALE_UPDATE_SEC:
            return          # 오래 꺼져 있던 동안 쌓인 명령에 뒤늦게 답하지 않는다
        self._cmd_times.append(now)
        if len(self._cmd_times) == self._cmd_times.maxlen and now - self._cmd_times[0] < 10:
            return          # 과도한 연타 무시
        if cb:
            try:
                self.api.answer_callback(cb.get('id'))
            except TelegramError:
                pass
            replies = self.commands.dispatch_callback(text)
        else:
            replies = self.commands.dispatch(text, msg_age=max(0.0, now - when) if when else None)
        log.info('텔레그램 명령 처리: %s (사용자 %s)', redact(text.split(' ', 1)[0][:20]), mask_id(user.get('id')))
        for body, markup in replies:
            self._reply(chat['id'], body, markup)

    def _reply(self, chat_id, text, markup=None):
        """명령 응답은 즉시 보낸다(알림 대기열을 거치지 않음). 실패해도 예외를 올리지 않는다."""
        from tg_notify import split_text
        parts = split_text(text)
        for i, part in enumerate(parts):
            try:
                try:
                    self.api.send_message(chat_id, part, reply_markup=markup if i == len(parts) - 1 else None)
                except TelegramError as exc:
                    if exc.code == 400 and 'parse' in str(exc).lower():
                        self.api.send_message(chat_id, plain(part), parse_mode=None, reply_markup=markup if i == len(parts) - 1 else None)
                    else:
                        raise
            except TelegramError as exc:
                log.warning('명령 응답 전송 실패: %s', redact(exc))
                return

    def _deny(self, user, chat):
        uid = user.get('id')
        now = self.clock()
        log.warning('텔레그램 비인가 접근 차단: 사용자 %s', mask_id(uid))
        try:
            may_reply = self.tstore.blocked_note(uid, now)
        except Exception:
            may_reply = False
        if may_reply:
            self._reply(chat['id'], '이 봇은 개인 전용입니다. 허용되지 않은 사용자입니다.')
        day = self.now_dt().strftime('%Y-%m-%d')
        self.notifier.notify('blocked:%s:%s' % (uid, day), F.fmt_alert('허용되지 않은 접근 시도', ['사용자 ID <code>%s</code> 가 봇에 메시지를 보냈습니다.' % mask_id(uid),
                                                                                                  '차단되었고 어떤 정보도 전달되지 않았습니다.'], 'warn', '본인이 아니라면 BotFather 에서 토큰을 재발급(/revoke)하세요', self.now_dt()),
                             'alert', 'warn')
