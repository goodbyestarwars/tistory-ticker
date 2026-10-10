# -*- coding: utf-8 -*-
"""알림 발송: 대기열(outbox) 적재 + 별도 스레드 발송.

원칙
- 알림 적재(Notifier.notify)는 SQLite INSERT 한 번이다. 네트워크를 기다리지 않고, 실패해도 예외를 밖으로 내지 않는다
  -> 텔레그램이 느리거나 끊겨도 손절·익절 판단 루프·연구 엔진은 영향을 받지 않는다.
- 같은 사건은 dedupe_key 로 한 번만 쌓인다(재시작·재감지에도 중복 없음).
- 지속되는 장애는 알림 상태(alerts)로 관리한다: 발생 시 즉시 1회, 계속되면 renotify_sec 마다 1회, 복구되면 복구 알림 1회.
- 전송 실패는 지수 백오프로 재시도하고, 연결이 돌아오면 밀린 알림을 순서대로(심각도 우선) 보낸다. 오래 지연된 알림에는 '지연 전달'을 표시한다.
- 전송은 최소 한 번(at-least-once)이다. 요청이 텔레그램에 닿은 뒤 응답만 못 받은 경우(읽기 시간 초과)에는 재시도로 같은 메시지가 한 번 더 갈 수 있다.
- 카테고리: general(종목선정·모의매매·일일보고서, /mute 대상), alert(시스템 경고), order(실계좌 감시·주문, /mute 해도 항상 전달).
"""
import html
import logging
import re
import time
from datetime import datetime, timedelta, timezone

from tg_api import TelegramError
from tg_config import redact

KST = timezone(timedelta(hours=9))
log = logging.getLogger('autotrader.telegram')

TTL_SEC = {'general': 36 * 3600, 'alert': 12 * 3600, 'order': 48 * 3600}
DELAY_NOTE_SEC = 180
SEND_GAP_SEC = 1.1
MAX_BACKOFF_SEC = 600
BACKOFF_BASE_SEC = 30
IDLE_WAIT_SEC = 2.0
NET_RECOVER_NOTE_SEC = 300
TAG_RE = re.compile(r'<[^>]+>')


def split_text(text, limit=3800):
    """텔레그램 한 메시지(4096자) 한도에 맞춰 줄 단위로 나눈다. 포맷터는 줄마다 태그가 닫히게 만든다."""
    if len(text) <= limit:
        return [text]
    parts, cur = [], ''
    for line in text.split('\n'):
        if cur and len(cur) + len(line) + 1 > limit:
            parts.append(cur)
            cur = ''
        cur += ('\n' if cur else '') + line
        while len(cur) > limit:
            parts.append(cur[:limit])
            cur = cur[limit:]
    if cur:
        parts.append(cur)
    return parts


def plain(text):
    return html.unescape(TAG_RE.sub('', text))


def fmt_duration(sec):
    sec = int(max(0, sec))
    if sec < 90:
        return '%d초' % sec
    if sec < 5400:
        return '%d분' % round(sec / 60)
    if sec < 36 * 3600:
        return '%.1f시간' % (sec / 3600)
    return '%.1f일' % (sec / 86400)


class Notifier:
    def __init__(self, store, clock=time.time, wake=None):
        self.store = store
        self.clock = clock
        self._wake = wake

    # ---- 무음 ----
    def mute_until(self):
        return float(self.store.kv_get('mute_until', 0) or 0)

    def is_muted(self):
        return self.clock() < self.mute_until()

    def set_mute(self, seconds):
        now = self.clock()
        self.store.kv_set('mute_until', now + seconds)
        self.store.kv_set('mute_started', now)
        return now + seconds

    def clear_mute(self):
        """무음을 풀고, 무음 중 생략된 일반 알림 수를 돌려준다."""
        started = float(self.store.kv_get('mute_started', 0) or 0)
        self.store.kv_set('mute_until', 0)
        rows = self.store._run("SELECT COUNT(*) AS n FROM outbox WHERE status='MUTED' AND created>=?", (started,), 'one')
        return rows['n'] if rows else 0

    # ---- 적재 ----
    def notify(self, key, text, category='general', level='info', markup=None, ttl=None):
        """대기열에 쌓는다. 새로 쌓였으면 True. 어떤 오류도 호출자에게 전파하지 않는다."""
        try:
            added = self.store.outbox_add(key, category, level, text, self.clock(), ttl or TTL_SEC.get(category, 12 * 3600), markup)
        except Exception as exc:
            log.error('알림 적재 실패(%s): %s', key, redact(exc))
            return False
        if added and self._wake:
            self._wake()
        return added

    # ---- 지속 알림 ----
    def raise_alert(self, key, text, level='warn', renotify_sec=3600, category='alert'):
        """발생 시 즉시 1회, 계속되면 renotify_sec 마다 1회. 반환: 'raised' | 'renotified' | 'quiet'."""
        now = self.clock()
        state = self.store.alert_get(key)
        if not state or not state['active']:
            self.notify('alert:%s:%d' % (key, now), text, category, level)
            self.store.alert_put(key, True, now, now, 1)
            return 'raised'
        if now - (state['last_sent'] or 0) >= renotify_sec:
            count = state['count'] + 1
            head = '🔁 <b>계속 중</b> · %s 경과\n' % fmt_duration(now - state['since'])
            self.notify('alert:%s:%d:%d' % (key, state['since'], count), head + text, category, level)
            self.store.alert_put(key, True, state['since'], now, count)
            return 'renotified'
        return 'quiet'

    def clear_alert(self, key, text):
        """활성 상태였던 경우에만 복구 알림 1회. 반환: 복구 알림을 냈는지."""
        state = self.store.alert_get(key)
        if not state or not state['active']:
            return False
        now = self.clock()
        self.store.alert_put(key, False, state['since'], state['last_sent'], state['count'])
        head = '✅ <b>복구</b> · 장애 지속 %s\n' % fmt_duration(now - state['since'])
        self.notify('clear:%s:%d' % (key, state['since']), head + text, 'alert', 'info')
        return True

    def alert_active(self, key):
        state = self.store.alert_get(key)
        return bool(state and state['active'])


class Sender:
    """대기열을 비우는 발송기. step() 한 번이 한 라운드(테스트에서 직접 호출), run() 이 스레드 루프."""

    def __init__(self, store, api, notifier, target_chat_id, clock=time.time, sleep=None):
        self.store, self.api, self.notifier, self.chat_id = store, api, notifier, target_chat_id
        self.clock = clock
        self._sleep = sleep or (lambda sec: time.sleep(sec))
        self.net_down_since = None
        self.last_ok = None
        self.last_error = None
        self.fatal = None          # 인증 실패(토큰 오류) 등 재시도해도 소용없는 상태 설명
        self.sent_total = 0

    def step(self):
        now = self.clock()
        sent = 0
        for row in self.store.outbox_due(now, 10):
            now = self.clock()
            if row['expires'] < now:
                self.store.outbox_update(row['id'], status='EXPIRED')
                continue
            if row['category'] == 'general' and self.notifier.is_muted():
                self.store.outbox_update(row['id'], status='MUTED')
                continue
            if self._send_row(row, now):
                sent += 1
                self._sleep(SEND_GAP_SEC)
            elif self.net_down_since is not None or self.fatal:
                break           # 연결이 안 되는 동안은 나머지도 시도하지 않는다(다음 라운드에서)
        return sent

    def _send_row(self, row, now):
        text = row['text']
        if now - row['created'] > DELAY_NOTE_SEC:
            when = datetime.fromtimestamp(row['created'], KST).strftime('%m-%d %H:%M')
            text = '⏱ <i>지연 전달 (발생 %s KST)</i>\n%s' % (when, text)
        markup = None
        if row.get('markup'):
            try:
                import json
                markup = json.loads(row['markup'])
            except ValueError:
                markup = None
        attempts = row['attempts'] + 1
        self.store.outbox_update(row['id'], status='SENDING', attempts=attempts)
        try:
            self._deliver(text, markup)
        except TelegramError as exc:
            self._on_error(row, attempts, exc, text, markup)
            return False
        except Exception as exc:            # 예상 밖 오류도 대기열에 남겨 다음에 재시도한다
            self.store.outbox_update(row['id'], status='PENDING', next_try=now + 30, error=redact(exc)[:200])
            log.error('알림 전송 중 예상 밖 오류: %s', redact(exc))
            return False
        self.store.outbox_update(row['id'], status='SENT', sent=self.clock(), error=None)
        self.sent_total += 1
        self._note_ok()
        return True

    def _deliver(self, text, markup):
        parts = split_text(text)
        for i, part in enumerate(parts):
            last = i == len(parts) - 1
            try:
                self.api.send_message(self.chat_id, part, reply_markup=markup if last else None)
            except TelegramError as exc:
                if exc.code == 400 and 'parse' in str(exc).lower():     # 서식 오류는 서식 없이 한 번 더
                    self.api.send_message(self.chat_id, plain(part), parse_mode=None, reply_markup=markup if last else None)
                else:
                    raise

    def _on_error(self, row, attempts, exc, text, markup):
        now = self.clock()
        msg = redact(exc)[:200]
        self.last_error = msg
        if exc.code == 429:
            self.store.outbox_update(row['id'], status='PENDING', next_try=now + float(exc.retry_after or 5) + 1, error=msg)
            return
        if exc.code in (401, 404):      # 토큰이 틀렸거나 폐기됨
            self.fatal = '봇 토큰 인증 실패(%s) - .env 의 TELEGRAM_BOT_TOKEN 확인' % exc.code
            self.store.outbox_update(row['id'], status='PENDING', next_try=now + 600, error=msg)
            log.error('텔레그램 %s', self.fatal)
            return
        if exc.code in (400, 403):      # 차단됐거나 채팅이 없음 - 재시도해도 같은 결과일 가능성이 높다
            self.store.outbox_update(row['id'], status='FAILED' if attempts >= 3 else 'PENDING', next_try=now + 300, error=msg)
            log.error('텔레그램 전송 거부(%s): %s', exc.code, msg)
            return
        if self.net_down_since is None:
            self.net_down_since = now
            log.warning('텔레그램 연결 실패 - 알림은 대기열에 보관하고 재시도합니다: %s', msg)
        delay = min(BACKOFF_BASE_SEC * (2 ** min(attempts - 1, 5)), MAX_BACKOFF_SEC)
        self.store.outbox_update(row['id'], status='PENDING', next_try=now + delay, error=msg)

    def _note_ok(self):
        now = self.clock()
        self.fatal = None
        self.last_ok = now
        if self.net_down_since is not None:
            down = now - self.net_down_since
            since, self.net_down_since = self.net_down_since, None
            log.info('텔레그램 연결 복구(중단 %s)', fmt_duration(down))
            if down >= NET_RECOVER_NOTE_SEC:
                pending = self.store.outbox_stats().get('PENDING', 0)
                self.notifier.notify('netrecover:%d' % since, '🌐 <b>텔레그램 연결 복구</b>\n약 %s 동안 알림 전달이 지연됐습니다. 밀린 알림 %d건을 순서대로 보냅니다.'
                                     % (fmt_duration(down), pending), 'alert', 'info')

    def health(self):
        return {'ok': self.net_down_since is None and not self.fatal, 'down_since': self.net_down_since, 'last_ok': self.last_ok, 'last_error': self.last_error,
                'fatal': self.fatal, 'sent_total': self.sent_total}

    def run(self, stop_event, wake_event):
        while not stop_event.is_set():
            try:
                self.step()
            except Exception as exc:       # 스레드가 죽지 않게 한다
                log.error('발송 루프 오류: %s', redact(exc))
                stop_event.wait(5)
            wake_event.wait(IDLE_WAIT_SEC)
            wake_event.clear()
