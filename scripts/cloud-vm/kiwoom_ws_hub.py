# -*- coding: utf-8 -*-
"""키움 실시간 WebSocket 공유 허브 - KIS 등록 자리를 넘친 국내 종목만 키움으로 받는다.

2026-09-15 사용자 지적("40개 ????", "너무 적은거 아닌가")과 결정("적용해 1,2번"):
KIS 실시간은 앱키당 세션 하나를 모든 방문자·화면이 나눠 써서 자리(40)를 넘친 종목은 15초 REST
폴백("지연")으로만 갱신됐다. 이 모듈은 키움 WebSocket 연결을 **하나만** 열고, `/ws/quotes` 중계가
KIS에 못 들어간 종목을 여기에 구독한다. 키움도 못 받는 종목만 REST 폴백으로 남는다.

- 구독할 종목이 없으면 연결하지 않고, 구독자가 모두 떠나면 잠시 뒤 연결을 닫는다.
- 등록 목록이 바뀌면 `REG`를 `refresh: '0'`(기존 등록 유지 안 함)으로 전체 목록과 함께 다시 보낸다.
  해지(REMOVE) 메시지 형식은 확인하지 못해 쓰지 않는다.
- PING은 받은 텍스트를 그대로 되돌려 보낸다(기존 realtime_quotes._relay_once와 같은 처리).

미검증 사항 - 장중 `/health/realtime`의 `kiwoom` 항목(등록 응답·체결 수)으로 확인한다:
- 연결당 등록 가능 종목 수: `KIWOOM_WS_MAX_CODES`(기본 100).
- 통합(KRX+NXT) 체결을 받는 종목코드 표기: `KIWOOM_WS_CODE_SUFFIX`(기본 `_AL` - 키움 테마 구성종목
  응답 ka90002에서 `_AL` 접미사가 실제로 왔다). 등록이 거절되면 접미사 없이 한 번 다시 등록한다.
- 0B 체결의 누적거래량 필드 번호는 확인하지 못해 `volume`은 넘기지 않는다(가격·대비·등락률만).

앱키·토큰은 상태(health)와 로그에 담지 않는다.
"""

import asyncio
import json
import logging
import os
import re
import threading
import time
from datetime import datetime, timezone

import kiwoom_client

logger = logging.getLogger('kiwoom_ws_hub')

KIWOOM_WS_URL = 'wss://api.kiwoom.com:10000/api/dostk/websocket'
DEFAULT_MAX_CODES = 100
DEFAULT_CODE_SUFFIX = '_AL'
DEFAULT_WATCHDOG_SEC = 180
RECONNECT_MIN_SEC = 5
RECONNECT_MAX_SEC = 60
# 등록 목록이 잇달아 바뀔 때 REG를 몰아 보내지 않도록 두는 최소 간격.
REG_MIN_GAP_SEC = 1.0
# REG 응답이 오지 않더라도 이 시간 동안 거절이 없으면 등록된 것으로 본다.
REG_ACK_GRACE_SEC = 3.0
# 구독자가 모두 떠난 뒤 연결을 닫기까지 기다리는 시간.
IDLE_CLOSE_SEC = 60
REG_GROUP = '1'
QUEUE_MAXSIZE = 2000
_CODE_RE = re.compile(r'^[0-9A-Z]{6}$')


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
        ping_interval=20,
        ping_timeout=20,
        max_size=2 * 1024 * 1024,
    )


def _normalize(codes):
    result = []
    for raw in codes or []:
        code = str(raw or '').strip().upper()
        if _CODE_RE.match(code) and code not in result:
            result.append(code)
    return result


def _return_ok(message):
    return str(message.get('return_code', '0')).strip() in ('0', '')


class Subscription:
    """허브가 받은 체결 이벤트(dict)를 구독자 이벤트루프의 asyncio.Queue로 넘긴다."""

    def __init__(self, hub, sub_id, codes, loop, maxsize):
        self._hub = hub
        self.id = sub_id
        self.codes = frozenset(codes)
        self.loop = loop
        self.queue = asyncio.Queue(maxsize=maxsize)
        self.closed = False
        self.dropped_events = 0

    def _deliver(self, event):
        if self.closed:
            return
        if self.queue.full():
            try:
                self.queue.get_nowait()
                self.dropped_events += 1
            except asyncio.QueueEmpty:
                pass
        self.queue.put_nowait(event)

    def update(self, codes):
        if not self.closed:
            self._hub._update(self.id, codes)

    def close(self):
        if self.closed:
            return
        self.closed = True
        self._hub._remove(self.id)


class KiwoomWsHub:
    def __init__(self, appkey, secretkey, url=None, token_fn=None, connect_fn=None,
                 max_codes=None, code_suffix=None, watchdog_sec=None,
                 reconnect_min_sec=RECONNECT_MIN_SEC, reconnect_max_sec=RECONNECT_MAX_SEC,
                 reg_min_gap_sec=REG_MIN_GAP_SEC, reg_ack_grace_sec=REG_ACK_GRACE_SEC,
                 idle_close_sec=IDLE_CLOSE_SEC, parse_fn=None):
        self._url = url or KIWOOM_WS_URL
        self._token_fn = token_fn or (lambda: kiwoom_client.get_token(appkey, secretkey))
        # 이번 세션이 LOGIN에 쓴 토큰. 거부당하면 이 값만 캐시에서 지운다.
        self._login_token = None
        self._connect_fn = connect_fn or _default_connect
        if max_codes is None:
            max_codes = _env_int('KIWOOM_WS_MAX_CODES', DEFAULT_MAX_CODES)
        self.max_codes = max(1, int(max_codes))
        if code_suffix is None:
            code_suffix = os.environ.get('KIWOOM_WS_CODE_SUFFIX', DEFAULT_CODE_SUFFIX)
        if watchdog_sec is None:
            watchdog_sec = _env_int('KIWOOM_WS_WATCHDOG_SEC', DEFAULT_WATCHDOG_SEC)
        self.watchdog_sec = max(0.1, float(watchdog_sec))
        self.reconnect_min_sec = reconnect_min_sec
        self.reconnect_max_sec = reconnect_max_sec
        self.reg_min_gap_sec = reg_min_gap_sec
        self.reg_ack_grace_sec = reg_ack_grace_sec
        self.idle_close_sec = idle_close_sec
        self._parse_fn = parse_fn

        self._lock = threading.Lock()
        self._subs = {}
        self._code_order = {}
        self._seq = 0
        self._order_seq = 0
        self._suffix = str(code_suffix or '').strip()
        self._suffix_fallback_used = False
        self._reg_codes = frozenset()
        self._confirmed = frozenset()
        self._reg_sent_at = None
        self._reg_acked = False
        self._reg_rejected = False
        self._running = False
        self._thread = None
        self._ready = None
        self._loop = None
        self._wake = None
        self._main_task = None
        self._state = {
            'connected': False, 'loggedIn': False, 'connectedAt': None, 'lastFrameAt': None,
            'lastTickAt': None, 'framesThisSession': 0, 'frames': 0, 'ticks': 0, 'pings': 0,
            'reconnects': 0, 'watchdogReconnects': 0, 'regSent': 0, 'regOk': 0, 'regErrors': 0,
            'lastRegResponse': None, 'lastDisconnect': None,
        }

    # ---- 구독 API(어느 스레드에서 불러도 된다) ----

    def subscribe(self, codes, loop=None, maxsize=QUEUE_MAXSIZE):
        loop = loop or asyncio.get_running_loop()
        normalized = _normalize(codes)
        with self._lock:
            self._seq += 1
            sub = Subscription(self, self._seq, normalized, loop, maxsize)
            self._subs[sub.id] = sub
            self._remember_order(normalized)
        self._poke()
        return sub

    def _remember_order(self, codes):
        for code in codes:
            if code not in self._code_order:
                self._order_seq += 1
                self._code_order[code] = self._order_seq

    def _prune_order(self):
        alive = set()
        for sub in self._subs.values():
            alive.update(sub.codes)
        for code in list(self._code_order):
            if code not in alive:
                del self._code_order[code]

    def _update(self, sub_id, codes):
        normalized = _normalize(codes)
        with self._lock:
            sub = self._subs.get(sub_id)
            if sub is None:
                return
            sub.codes = frozenset(normalized)
            self._remember_order(normalized)
            self._prune_order()
        self._poke()

    def _remove(self, sub_id):
        with self._lock:
            self._subs.pop(sub_id, None)
            self._prune_order()
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
            wanted = set()
            for sub in self._subs.values():
                wanted.update(sub.codes)
            ordered = sorted(wanted, key=lambda code: (self._code_order.get(code, 0), code))
        return ordered[:self.max_codes], ordered[self.max_codes:]

    # ---- 스레드 수명 ----

    def start(self):
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return self
            self._running = True
            self._ready = threading.Event()
            self._thread = threading.Thread(target=self._runner, name='kiwoom-ws-hub', daemon=True)
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
            logger.exception('키움 공유 WebSocket 허브 스레드가 예외로 종료됨')

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
                logger.warning('키움 공유 WebSocket 끊김, 재접속 예정: %s', exc)
            if not self._running:
                break
            with self._lock:
                got_frames = self._state['framesThisSession'] > 0
                if not clean:
                    self._state['reconnects'] += 1
            failures = 0 if (clean or got_frames) else failures + 1
            if failures:
                await asyncio.sleep(min(self.reconnect_max_sec, self.reconnect_min_sec * (2 ** (failures - 1))))
            elif not clean:
                await asyncio.sleep(self.reconnect_min_sec)

    # ---- 세션 ----

    def _set_disconnect(self, reason):
        with self._lock:
            self._state['lastDisconnect'] = {'at': _utc_iso(time.time()), 'reason': str(reason)[:300]}

    def _reset_registration(self):
        self._reg_codes = frozenset()
        self._confirmed = frozenset()
        self._reg_sent_at = None
        self._reg_acked = False
        self._reg_rejected = False

    async def _session(self):
        token = await asyncio.to_thread(self._token_fn)
        self._login_token = token
        async with self._connect_fn(self._url) as ws:
            with self._lock:
                self._state.update(connected=True, loggedIn=False, connectedAt=time.time(), framesThisSession=0)
                self._reset_registration()
            logger.info('키움 공유 WebSocket 연결됨')
            await ws.send(json.dumps({'trnm': 'LOGIN', 'token': token}))
            recv_task = asyncio.ensure_future(ws.recv())
            wake_task = asyncio.ensure_future(self._wake.wait())
            need_sync = False
            last_reg_at = 0.0
            idle_since = None
            try:
                while self._running:
                    done, _pending = await asyncio.wait(
                        {recv_task, wake_task}, timeout=min(1.0, self.watchdog_sec),
                        return_when=asyncio.FIRST_COMPLETED)
                    if wake_task in done:
                        self._wake.clear()
                        wake_task = asyncio.ensure_future(self._wake.wait())
                        need_sync = True
                    if recv_task in done:
                        raw = recv_task.result()
                        recv_task = asyncio.ensure_future(ws.recv())
                        if await self._handle_frame(ws, raw):
                            need_sync = True
                    now = time.time()
                    with self._lock:
                        last_seen = max(self._state.get('lastFrameAt') or 0, self._state.get('connectedAt') or 0)
                        logged_in = self._state['loggedIn']
                    if now - last_seen > self.watchdog_sec:
                        with self._lock:
                            self._state['watchdogReconnects'] += 1
                        reason = 'watchdog: %s초 동안 키움 프레임 없음' % self.watchdog_sec
                        self._set_disconnect(reason)
                        logger.warning('키움 공유 WebSocket %s - 다시 연결한다', reason)
                        return
                    desired, _dropped = self._desired()
                    if not desired:
                        idle_since = idle_since or now
                        if now - idle_since >= self.idle_close_sec:
                            logger.info('키움 실시간 구독자가 없어 연결을 닫는다')
                            return
                        continue
                    idle_since = None
                    if need_sync and logged_in and now - last_reg_at >= self.reg_min_gap_sec:
                        need_sync = False
                        if await self._sync_registrations(ws, desired):
                            last_reg_at = time.time()
            finally:
                for task in (recv_task, wake_task):
                    if not task.done():
                        task.cancel()
                with self._lock:
                    self._state['connected'] = False
                    self._state['loggedIn'] = False
                    self._reset_registration()

    async def _sync_registrations(self, ws, desired):
        target = frozenset(desired)
        with self._lock:
            if target == self._reg_codes:
                return False
            suffix = self._suffix
        await ws.send(json.dumps({
            'trnm': 'REG',
            'grp_no': REG_GROUP,
            'refresh': '0',
            'data': [{'item': [code + suffix for code in desired], 'type': ['0B']}],
        }))
        with self._lock:
            self._confirmed = self._confirmed & target
            self._reg_codes = target
            self._reg_sent_at = time.time()
            self._reg_acked = False
            self._reg_rejected = False
            self._state['regSent'] += 1
        return True

    async def _handle_frame(self, ws, raw):
        """프레임을 처리하고, 등록을 다시 보내야 하면 True를 돌려준다."""
        if isinstance(raw, bytes):
            raw = raw.decode('utf-8', 'ignore')
        now = time.time()
        with self._lock:
            self._state['lastFrameAt'] = now
            self._state['framesThisSession'] += 1
            self._state['frames'] += 1
        try:
            message = json.loads(raw)
        except (TypeError, ValueError):
            return False
        if not isinstance(message, dict):
            return False
        trnm = str(message.get('trnm') or '').upper()
        if trnm == 'PING':
            await ws.send(raw)
            with self._lock:
                self._state['pings'] += 1
            return False
        if trnm == 'LOGIN':
            if not _return_ok(message):
                # 2026-09-17: 죽은 토큰으로 로그인하면 6초마다 영원히 같은 실패를 반복했다.
                # 거부당한 토큰을 캐시에서 지워야 다음 재접속이 새 토큰을 받는다.
                if kiwoom_client.is_token_invalid(message):
                    kiwoom_client.invalidate_token(getattr(self, '_login_token', None))
                raise RuntimeError('키움 실시간 로그인 실패: %s' % str(message.get('return_msg') or '')[:120])
            with self._lock:
                self._state['loggedIn'] = True
            logger.info('키움 실시간 로그인 성공')
            return True
        if trnm == 'REG':
            info = {'at': _utc_iso(now), 'returnCode': message.get('return_code'),
                    'msg': str(message.get('return_msg') or '')[:200]}
            if _return_ok(message):
                with self._lock:
                    self._state['regOk'] += 1
                    self._state['lastRegResponse'] = info
                    self._reg_acked = True
                return False
            with self._lock:
                self._state['regErrors'] += 1
                self._state['lastRegResponse'] = info
                retry_plain = bool(self._suffix) and not self._suffix_fallback_used
                if retry_plain:
                    self._suffix = ''
                    self._suffix_fallback_used = True
                    self._reg_codes = frozenset()
                else:
                    self._reg_rejected = True
            if retry_plain:
                logger.warning('키움 실시간 등록 거절 - 종목코드 접미사 없이 다시 등록한다: %s', info['msg'])
                return True
            logger.warning('키움 실시간 등록 거절: %s', info['msg'])
            return False
        if trnm == 'REAL':
            self._dispatch(message, now)
        return False

    def _dispatch(self, message, now):
        parse = self._parse_fn
        if parse is None:
            import realtime_quotes
            parse = realtime_quotes._quote_events
        events = parse(message)
        if not events:
            return
        with self._lock:
            self._state['lastTickAt'] = now
            self._state['ticks'] += len(events)
            subs = list(self._subs.values())
        for event in events:
            code = event.get('code')
            payload = {key: value for key, value in event.items() if key != 'volume'}
            payload['source'] = 'Kiwoom WebSocket'
            for sub in subs:
                if code in sub.codes:
                    try:
                        sub.loop.call_soon_threadsafe(sub._deliver, dict(payload))
                    except RuntimeError:
                        pass

    # ---- 상태 ----

    def live_codes(self):
        """키움 실시간으로 받고 있는 종목: 로그인된 연결에 등록했고, 응답이 왔거나 거절 없이 유예가 지난 종목."""
        with self._lock:
            if not (self._state['connected'] and self._state['loggedIn']):
                return frozenset()
            if self._reg_rejected or self._reg_sent_at is None:
                return frozenset()
            if self._reg_acked or time.time() - self._reg_sent_at >= self.reg_ack_grace_sec:
                self._confirmed = self._reg_codes
            return self._confirmed

    def health(self):
        desired, dropped = self._desired()
        live = self.live_codes()
        now = time.time()
        with self._lock:
            state = dict(self._state)
            subscribers = len(self._subs)
            registered = len(self._reg_codes)
            suffix = self._suffix
            fallback_used = self._suffix_fallback_used
            rejected = self._reg_rejected
        last_tick = state.get('lastTickAt')
        return {
            'running': bool(self._running and self._thread is not None and self._thread.is_alive()),
            'connected': bool(state['connected']),
            'loggedIn': bool(state['loggedIn']),
            'connectedAt': _utc_iso(state.get('connectedAt')),
            'lastFrameAt': _utc_iso(state.get('lastFrameAt')),
            'lastTickAt': _utc_iso(last_tick),
            'lastTickAgeSec': round(now - last_tick, 1) if last_tick else None,
            'subscribers': subscribers,
            'desiredCodes': len(desired),
            'registeredCodes': registered,
            'liveCodes': len(live),
            'maxCodes': self.max_codes,
            'droppedCount': len(dropped),
            'codeSuffix': suffix,
            'suffixFallbackUsed': fallback_used,
            'registrationRejected': rejected,
            'regSent': state['regSent'],
            'regOk': state['regOk'],
            'regErrors': state['regErrors'],
            'lastRegResponse': state['lastRegResponse'],
            'ticks': state['ticks'],
            'pings': state['pings'],
            'reconnects': state['reconnects'],
            'watchdogReconnects': state['watchdogReconnects'],
            'lastDisconnect': state['lastDisconnect'],
        }


_hub = None
_hub_lock = threading.Lock()


def start(appkey, secretkey, **kwargs):
    """프로세스 공용 키움 허브를 시작한다(여러 번 불러도 하나만 뜬다). 키가 없으면 None."""
    global _hub
    if not appkey or not secretkey:
        return None
    try:
        import websockets  # noqa: F401
    except ImportError:
        logger.warning('websockets 미설치 - 키움 공유 WebSocket 허브를 시작하지 않는다')
        return None
    with _hub_lock:
        if _hub is None:
            _hub = KiwoomWsHub(appkey, secretkey, **kwargs)
        hub = _hub
    return hub.start()


def health_snapshot():
    hub = _hub
    if hub is None:
        return {'running': False, 'connected': False}
    return hub.health()
