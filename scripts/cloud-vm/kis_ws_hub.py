# -*- coding: utf-8 -*-
"""KIS 실시간 WebSocket 공유 허브 - 프로세스 전체가 KIS 세션 하나를 같이 쓴다.

2026-09-14 장애("실시간 websocket 반영이 안되고 있어, 증권 사이트 맞나 싶을 정도"):
같은 KIS 앱키로 WebSocket을 여는 곳이 프로세스 안에 넷이었다 - 야간선물(24시간 상시),
주간선물, 옵션 수급, 그리고 브라우저 `/ws/quotes` 연결마다 하나씩 여는 중계. 라이브에서
브라우저 소켓은 열리는데 25초 동안 메시지 0건이었고, VM 로그에는 KIS 연결이 약 0.5초 만에
`no close frame received or sent`로 끊기는 재접속이 5초마다 반복됐다. 중계는 PINGPONG 외의
JSON 제어 메시지를 전부 버리고 있어서 KIS가 무엇을 거절했는지도 기록되지 않았다.

이 모듈은 KIS WebSocket 연결을 **하나만** 열고, 모든 수집기·중계는 여기에 (tr_id, tr_key)를
구독만 한다.

- 같은 키는 한 번만 등록한다(여러 구독자가 원해도).
- 세션당 등록 수 상한은 KIS 문서로 확인하지 못해(미검증) `KIS_WS_MAX_REGISTRATIONS`로 둔다.
  넘치면 우선순위(선물 > 종목 체결 > 호가 > 옵션)가 낮은 키부터 빠지고 `/health/realtime`에
  드러난다. KIS가 돌려주는 거절 메시지(`rt_cd != 0`)는 이제 경고 로그와 상태에 남으므로,
  실제 상한은 배포 후 로그로 확정한다.
- 더 이상 아무도 원하지 않는 키는 자리가 남는 동안 그대로 두고(옵션 수집기가 5분마다 같은
  계약을 닫고 다시 구독한다), 새 키가 들어갈 자리가 없을 때만 해제 프레임(tr_type '2' - KIS
  공식 예제 open-trading-api `kis_auth.py` unsubscribe 기준)을 보내 자리를 비운다. 처음엔
  세션을 다시 맺어 정리했는데, 라이브에서 새 페이지의 첫 체결이 재구성 간격만큼(16초) 늦었다.
- 옵션은 등록 자리의 절반(`KIS_WS_OPTIONS_BUDGET`)까지만 쓴다. 옵션 40건이 자리를 전부
  차지해 브라우저 종목이 들어갈 때마다 옵션을 밀어내야 했다(2026-09-14 라이브).
- PINGPONG은 받은 텍스트를 그대로 되돌려 보낸다(WebSocket pong 프레임이 아니다).
- 일정 시간 아무 프레임도 없으면(워치독) 스스로 다시 연결한다.

브라우저·로그로 새지 않도록 앱키·접속키는 상태(health)에 담지 않는다.
"""

import asyncio
import json
import logging
import os
import threading
import time
from datetime import datetime, timezone

import kis_client

logger = logging.getLogger('kis_ws_hub')

PRIORITY_FUTURES = 0
PRIORITY_QUOTES = 1
PRIORITY_ORDERBOOK = 2
PRIORITY_OPTIONS = 3

# KIS 세션당 실시간 등록 상한 - 공식 문서에서 확인하지 못한 값이라 환경변수로 조정한다.
DEFAULT_MAX_REGISTRATIONS = 40
# KIS PINGPONG 주기를 확인하지 못해 넉넉히 잡는다. 틱이 없는 새벽에도 PINGPONG은 프레임으로 센다.
DEFAULT_WATCHDOG_SEC = 180
RECONNECT_MIN_SEC = 5
RECONNECT_MAX_SEC = 60
TR_TYPE_REGISTER = '1'
TR_TYPE_UNREGISTER = '2'
QUEUE_MAXSIZE = 2000
_SEND_GAP_SEC = 0.05


def _utc_iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat() if ts else None


def _env_int(name, default):
    try:
        return int(str(os.environ.get(name, '')).strip() or default)
    except ValueError:
        return default


def _default_connect(url):
    import websockets
    return websockets.connect(
        url,
        open_timeout=10,
        close_timeout=5,
        ping_interval=None,
        max_size=2 * 1024 * 1024,
    )


class Subscription:
    """허브가 받은 원본 프레임을 구독자 이벤트루프의 asyncio.Queue로 넘긴다."""

    def __init__(self, hub, sub_id, keys, loop, maxsize):
        self._hub = hub
        self.id = sub_id
        self.keys = keys
        self.tr_ids = {key[0] for key in keys}
        self.loop = loop
        self.queue = asyncio.Queue(maxsize=maxsize)
        self.closed = False
        self.dropped_frames = 0

    def _deliver(self, raw):
        if self.closed:
            return
        if self.queue.full():
            try:
                self.queue.get_nowait()
                self.dropped_frames += 1
            except asyncio.QueueEmpty:
                pass
        self.queue.put_nowait(raw)

    def close(self):
        if self.closed:
            return
        self.closed = True
        self._hub._remove(self.id)


class KisWsHub:
    def __init__(self, appkey, appsecret, url=None, approval_key_fn=None, connect_fn=None,
                 max_registrations=None, watchdog_sec=None,
                 reconnect_min_sec=RECONNECT_MIN_SEC, reconnect_max_sec=RECONNECT_MAX_SEC,
                 options_budget=None):
        self._url = url or kis_client.WS_URL
        self._approval_key_fn = approval_key_fn or (
            lambda: kis_client.get_approval_key(appkey, appsecret))
        self._connect_fn = connect_fn or _default_connect
        if max_registrations is None:
            max_registrations = _env_int('KIS_WS_MAX_REGISTRATIONS', DEFAULT_MAX_REGISTRATIONS)
        self.max_registrations = max(1, int(max_registrations))
        if watchdog_sec is None:
            watchdog_sec = _env_int('KIS_WS_WATCHDOG_SEC', DEFAULT_WATCHDOG_SEC)
        self.watchdog_sec = max(0.1, float(watchdog_sec))
        self.reconnect_min_sec = reconnect_min_sec
        self.reconnect_max_sec = reconnect_max_sec
        if options_budget is None:
            options_budget = _env_int('KIS_WS_OPTIONS_BUDGET', self.max_registrations // 2)
        self.options_budget = max(0, int(options_budget))

        self._lock = threading.Lock()
        self._subs = {}
        self._key_order = {}
        self._seq = 0
        self._registered = set()
        # 다른 스레드(브라우저 중계)가 읽는 등록 키 사본. 세트를 통째로 바꿔 끼워 읽는 쪽이
        # 허브 스레드의 변경 도중을 보지 않게 한다.
        self._registered_view = frozenset()
        self._running = False
        self._thread = None
        self._ready = None
        self._loop = None
        self._wake = None
        self._main_task = None
        self._state = {
            'connected': False, 'connectedAt': None, 'lastFrameAt': None, 'lastTickAt': None,
            'framesThisSession': 0, 'frames': 0, 'registeredCount': 0,
            'reconnects': 0, 'watchdogReconnects': 0, 'unsubscribes': 0,
            'pingpongs': 0, 'controlOk': 0, 'controlErrors': 0,
            'lastError': None, 'lastControl': None, 'lastDisconnect': None,
            'lastTickByTr': {},
        }

    # ---- 구독 API(어느 스레드에서 불러도 된다) ----

    def subscribe(self, keys, loop=None, maxsize=QUEUE_MAXSIZE):
        """keys: (tr_id, tr_key) 또는 (tr_id, tr_key, priority)의 목록."""
        loop = loop or asyncio.get_running_loop()
        normalized = {}
        for item in keys:
            tr_id, tr_key = str(item[0]), str(item[1])
            priority = int(item[2]) if len(item) > 2 else PRIORITY_QUOTES
            key = (tr_id, tr_key)
            normalized[key] = min(priority, normalized.get(key, priority))
        with self._lock:
            self._seq += 1
            sub = Subscription(self, self._seq, normalized, loop, maxsize)
            self._subs[sub.id] = sub
            for key in normalized:
                self._key_order.setdefault(key, self._seq)
        self._poke()
        return sub

    def _remove(self, sub_id):
        with self._lock:
            self._subs.pop(sub_id, None)
            alive = set()
            for sub in self._subs.values():
                alive.update(sub.keys)
            for key in list(self._key_order):
                if key not in alive:
                    del self._key_order[key]
        self._poke()

    def _poke(self):
        loop, wake = self._loop, self._wake
        if loop is None or wake is None:
            return
        try:
            loop.call_soon_threadsafe(wake.set)
        except RuntimeError:
            pass

    def _desired(self):
        with self._lock:
            priority = {}
            for sub in self._subs.values():
                for key, value in sub.keys.items():
                    if key not in priority or value < priority[key]:
                        priority[key] = value
            ordered = sorted(priority, key=lambda key: (priority[key], self._key_order.get(key, 0)))
        kept, over_budget, options = [], [], 0
        for key in ordered:
            if priority[key] >= PRIORITY_OPTIONS:
                options += 1
                if options > self.options_budget:
                    over_budget.append(key)
                    continue
            kept.append(key)
        return kept[:self.max_registrations], kept[self.max_registrations:] + over_budget

    # ---- 스레드 수명 ----

    def start(self):
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return self
            self._running = True
            self._ready = threading.Event()
            self._thread = threading.Thread(target=self._runner, name='kis-ws-hub', daemon=True)
            self._thread.start()
        self._ready.wait(5)
        return self

    def stop(self, timeout=5):
        self._running = False
        loop = self._loop
        if loop is not None:
            try:
                if self._wake is not None:
                    loop.call_soon_threadsafe(self._wake.set)
                if self._main_task is not None:
                    loop.call_soon_threadsafe(self._main_task.cancel)
            except RuntimeError:
                pass
        if self._thread is not None:
            self._thread.join(timeout)

    def _runner(self):
        try:
            asyncio.run(self._main())
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception('KIS 공유 WebSocket 허브 스레드가 예외로 종료됨')

    async def _main(self):
        self._loop = asyncio.get_running_loop()
        self._wake = asyncio.Event()
        self._main_task = asyncio.current_task()
        self._ready.set()
        failures = 0
        while self._running:
            desired, _dropped = self._desired()
            if not desired:
                self._wake.clear()
                try:
                    await asyncio.wait_for(self._wake.wait(), 30)
                except asyncio.TimeoutError:
                    pass
                continue
            clean = False
            try:
                await self._session()
                clean = True
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._set_disconnect('%s: %s' % (type(exc).__name__, exc))
                logger.warning('KIS 공유 WebSocket 끊김, 재접속 예정: %s', exc)
            if not self._running:
                break
            with self._lock:
                got_frames = self._state['framesThisSession'] > 0
                self._state['reconnects'] += 1
            failures = 0 if (clean or got_frames) else failures + 1
            if failures:
                delay = min(self.reconnect_max_sec, self.reconnect_min_sec * (2 ** (failures - 1)))
            else:
                delay = self.reconnect_min_sec
            await asyncio.sleep(delay)

    # ---- 세션 ----

    def _set_disconnect(self, reason):
        with self._lock:
            self._state['lastDisconnect'] = {'at': _utc_iso(time.time()), 'reason': str(reason)[:300]}

    async def _session(self):
        approval_key = await asyncio.to_thread(self._approval_key_fn)
        async with self._connect_fn(self._url) as ws:
            with self._lock:
                self._state.update(connected=True, connectedAt=time.time(), framesThisSession=0)
            self._registered = set()
            logger.info('KIS 공유 WebSocket 연결됨')
            recv_task = None
            wake_task = None
            try:
                await self._sync_registrations(ws, approval_key)
                recv_task = asyncio.ensure_future(ws.recv())
                wake_task = asyncio.ensure_future(self._wake.wait())
                while self._running:
                    # 워치독은 "마지막 KIS 프레임" 기준이다(구독 변경으로 깨어난 건 세지 않는다).
                    with self._lock:
                        last_seen = max(self._state.get('lastFrameAt') or 0,
                                        self._state.get('connectedAt') or 0)
                    remaining = self.watchdog_sec - (time.time() - last_seen)
                    done = set()
                    if remaining > 0:
                        done, _pending = await asyncio.wait(
                            {recv_task, wake_task}, timeout=remaining,
                            return_when=asyncio.FIRST_COMPLETED)
                    if not done:
                        with self._lock:
                            self._state['watchdogReconnects'] += 1
                        reason = 'watchdog: %s초 동안 KIS 프레임 없음' % self.watchdog_sec
                        self._set_disconnect(reason)
                        logger.warning('KIS 공유 WebSocket %s - 다시 연결한다', reason)
                        return
                    if wake_task in done:
                        self._wake.clear()
                        wake_task = asyncio.ensure_future(self._wake.wait())
                        if not self._running:
                            return
                        await self._sync_registrations(ws, approval_key)
                    if recv_task in done:
                        raw = recv_task.result()
                        recv_task = asyncio.ensure_future(ws.recv())
                        await self._handle_frame(ws, raw)
            finally:
                for task in (recv_task, wake_task):
                    if task is not None and not task.done():
                        task.cancel()
                with self._lock:
                    self._state['connected'] = False
                    self._state['registeredCount'] = 0
                    self._registered_view = frozenset()
                self._registered = set()

    async def _send_registration(self, ws, approval_key, tr_type, key):
        await ws.send(json.dumps({
            'header': {
                'approval_key': approval_key,
                'custtype': 'P',
                'tr_type': tr_type,
                'content-type': 'utf-8',
            },
            'body': {'input': {'tr_id': key[0], 'tr_key': key[1]}},
        }))
        await asyncio.sleep(_SEND_GAP_SEC)

    async def _sync_registrations(self, ws, approval_key):
        desired, _dropped = self._desired()
        desired_set = set(desired)
        missing = [key for key in desired if key not in self._registered]
        # 자리가 남는 동안 쓰지 않는 등록은 그대로 둔다(프레임은 구독자 쪽에서 코드로 거른다).
        # 새 키가 들어갈 자리가 모자랄 때만 그만큼 해제한다.
        overflow = len(self._registered) + len(missing) - self.max_registrations
        if overflow > 0:
            stale = sorted(self._registered - desired_set)
            for key in stale[:overflow]:
                await self._send_registration(ws, approval_key, TR_TYPE_UNREGISTER, key)
                self._registered.discard(key)
                with self._lock:
                    self._state['unsubscribes'] += 1
        for key in missing:
            if len(self._registered) >= self.max_registrations:
                break
            await self._send_registration(ws, approval_key, TR_TYPE_REGISTER, key)
            self._registered.add(key)
        with self._lock:
            self._state['registeredCount'] = len(self._registered)
            self._registered_view = frozenset(self._registered)

    async def _handle_frame(self, ws, raw):
        if isinstance(raw, bytes):
            raw = raw.decode('utf-8', 'ignore')
        if not isinstance(raw, str):
            return
        now = time.time()
        with self._lock:
            self._state['lastFrameAt'] = now
            self._state['framesThisSession'] += 1
            self._state['frames'] += 1
        if raw[:2] in ('0|', '1|'):
            self._dispatch(raw, now)
            return
        try:
            message = json.loads(raw)
        except (TypeError, ValueError):
            return
        header = message.get('header') or {}
        if header.get('tr_id') == 'PINGPONG':
            await ws.send(raw)
            with self._lock:
                self._state['pingpongs'] += 1
            return
        body = message.get('body') or {}
        rt_cd = str(body.get('rt_cd', '')).strip()
        info = {
            'at': _utc_iso(now),
            'trId': header.get('tr_id'),
            'trKey': header.get('tr_key'),
            'msgCd': body.get('msg_cd'),
            'msg': body.get('msg1'),
        }
        if rt_cd and rt_cd != '0':
            with self._lock:
                self._state['controlErrors'] += 1
                self._state['lastError'] = info
            logger.warning('KIS WebSocket 제어 메시지 오류: tr_id=%s tr_key=%s msg_cd=%s msg=%s',
                           info['trId'], info['trKey'], info['msgCd'], info['msg'])
        else:
            with self._lock:
                self._state['controlOk'] += 1
                self._state['lastControl'] = info

    def _dispatch(self, raw, now):
        parts = raw.split('|', 3)
        if len(parts) < 4:
            return
        tr_id = parts[1]
        with self._lock:
            self._state['lastTickAt'] = now
            self._state['lastTickByTr'][tr_id] = now
            targets = [sub for sub in self._subs.values() if tr_id in sub.tr_ids]
        for sub in targets:
            try:
                sub.loop.call_soon_threadsafe(sub._deliver, raw)
            except RuntimeError:
                pass

    # ---- 상태 ----

    def registered_keys(self):
        """지금 KIS 세션에 실제로 등록된 (tr_id, tr_key). 연결이 끊겨 있으면 비어 있다."""
        with self._lock:
            return self._registered_view

    def health(self):
        desired, dropped = self._desired()
        now = time.time()
        with self._lock:
            state = dict(self._state)
            by_tr = dict(self._state['lastTickByTr'])
            subscribers = len(self._subs)
        last_tick = state.get('lastTickAt')
        return {
            'running': bool(self._running and self._thread is not None and self._thread.is_alive()),
            'connected': bool(state['connected']),
            'connectedAt': _utc_iso(state.get('connectedAt')),
            'lastFrameAt': _utc_iso(state.get('lastFrameAt')),
            'lastTickAt': _utc_iso(last_tick),
            'lastTickAgeSec': round(now - last_tick, 1) if last_tick else None,
            'lastTickByTr': {tr_id: _utc_iso(ts) for tr_id, ts in by_tr.items()},
            'subscribers': subscribers,
            'desiredRegistrations': len(desired),
            'registered': state['registeredCount'],
            'maxRegistrations': self.max_registrations,
            'droppedCount': len(dropped),
            'droppedRegistrations': [{'trId': key[0], 'trKey': key[1]} for key in dropped[:20]],
            'reconnects': state['reconnects'],
            'watchdogReconnects': state['watchdogReconnects'],
            'unsubscribes': state['unsubscribes'],
            'optionsBudget': self.options_budget,
            'pingpongs': state['pingpongs'],
            'controlOk': state['controlOk'],
            'controlErrors': state['controlErrors'],
            'lastError': state['lastError'],
            'lastDisconnect': state['lastDisconnect'],
            'watchdogSec': self.watchdog_sec,
        }


_hub = None
_hub_lock = threading.Lock()


def start(appkey, appsecret, **kwargs):
    """프로세스 공용 허브를 시작한다(여러 번 불러도 하나만 뜬다)."""
    global _hub
    if not appkey or not appsecret:
        return None
    try:
        import websockets  # noqa: F401
    except ImportError:
        logger.warning('websockets 미설치 - KIS 공유 WebSocket 허브를 시작하지 않는다')
        return None
    with _hub_lock:
        if _hub is None:
            _hub = KisWsHub(appkey, appsecret, **kwargs)
        hub = _hub
    return hub.start()


def get_hub():
    return _hub


def health_snapshot():
    hub = _hub
    if hub is None:
        return {'running': False, 'connected': False}
    return hub.health()
