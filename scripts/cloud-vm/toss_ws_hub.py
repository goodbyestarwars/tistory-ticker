# -*- coding: utf-8 -*-
"""Read-only Toss Invest domestic trade WebSocket hub.

The two sockets (100 topics each) are shared by all browser clients. Do not
reuse these lossy trade ticks for cumulative volume or order signals.
Credentials never leave this process and only market-data channels are used.
Official: https://developers.tossinvest.com/docs/connection
"""
import asyncio
import json
import logging
import os
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

logger = logging.getLogger('toss_ws_hub')
WS_URL = 'wss://openapi-ws.tossinvest.com/ws/v1'
TOKEN_URL = 'https://openapi.tossinvest.com/oauth2/token'
MAX_PER_SOCKET = 100
SOCKETS = 2
MAX_CODES = MAX_PER_SOCKET * SOCKETS
QUEUE_MAXSIZE = 1000


def _quote(frame):
    """Toss trade:kr is lossy: no cumulative volume, direction, or change rate."""
    if not isinstance(frame, dict) or frame.get('type') != 'message':
        return None
    topic = str(frame.get('topic') or '')
    bits = topic.split(':')
    if len(bits) != 3 or bits[:2] != ['trade', 'kr']:
        return None
    code = bits[2]
    if len(code) != 6 or not code.isdigit():
        return None
    data = frame.get('data')
    if not isinstance(data, dict):
        return None
    try:
        price = float(data['price'])
        qty = float(data.get('volume') or 0)
        if not 0 < price < float('inf') or not 0 <= qty < float('inf'):
            return None
    except (TypeError, ValueError, KeyError):
        return None
    stamp = str(data.get('timestamp') or '')
    try:
        instant = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
        if instant.tzinfo is None:
            return None
        local = instant.astimezone(timezone(timedelta(hours=9)))
    except ValueError:
        return None
    return {
        'type': 'quote', 'code': code, 'price': price, 'source': 'Toss WebSocket',
        'delayed': False, 'sourceTimestamp': stamp, 'trade': {
            'time': local.strftime('%H%M%S'), 'date': local.strftime('%Y%m%d'),
            'price': price, 'qty': qty, 'market': 'UN',
            'direction': 'unknown', 'directionSource': 'unknown',
        },
    }


class Subscription:
    def __init__(self, hub, sid, codes, loop, maxsize):
        self.hub = hub
        self.sid = sid
        self.codes = frozenset(codes)
        self.loop = loop
        self.queue = asyncio.Queue(maxsize=maxsize)
        self.dropped_events = 0
        self.closed = False

    def _deliver(self, event):
        if self.closed:
            return
        if self.queue.full():
            self.queue.get_nowait()
            self.dropped_events += 1
        self.queue.put_nowait(event)

    def update(self, codes):
        if not self.closed:
            self.hub._change(self.sid, codes)

    def close(self):
        if not self.closed:
            self.closed = True
            self.hub._change(self.sid, None)


class TossWsHub:
    def __init__(self, client_id, client_secret, connect_fn=None, token_fn=None):
        self._client_id = client_id
        self._client_secret = client_secret
        self._connect_fn = connect_fn or self._connect
        self._token_fn = token_fn or self._fetch_token
        self._lock = threading.RLock()
        self._token_lock = threading.Lock()
        self._token_value = None
        self._token_expires = 0
        self._subscribers = {}
        self._next_id = 0
        self._next_order = 0
        self._order = {}
        self._threads = []
        self._connected = [False] * SOCKETS
        self._confirmed = [frozenset() for _ in range(SOCKETS)]
        self._errors = [None] * SOCKETS
        self._rejects = [0] * SOCKETS
        self._reconnects = [0] * SOCKETS
        self._ticks = 0
        self._last_tick_at = None

    def _fetch_token(self):
        data = urllib.parse.urlencode({
            'grant_type': 'client_credentials',
            'client_id': self._client_id,
            'client_secret': self._client_secret,
        }).encode('utf-8')
        request = urllib.request.Request(TOKEN_URL, data=data,
                                         headers={'Content-Type': 'application/x-www-form-urlencoded'})
        with urllib.request.urlopen(request, timeout=10) as response:
            payload = json.loads(response.read())
        token = payload['access_token']
        return token, max(60, int(payload.get('expires_in', 3600)))

    def _token(self):
        # Same client has ONE valid access token. Never issue one per WS socket.
        with self._token_lock:
            if self._token_value and time.monotonic() < self._token_expires:
                return self._token_value
            token, ttl = self._token_fn()
            self._token_value = token
            self._token_expires = time.monotonic() + max(30, ttl - 120)
            return token

    @staticmethod
    def _connect(token):
        import websockets
        params = {
            'open_timeout': 10, 'close_timeout': 5,
            'ping_interval': 20, 'ping_timeout': 20,
            'max_size': 2 * 1024 * 1024,
        }
        # Compatible with websockets' newer asyncio API and older legacy API.
        try:
            from websockets.asyncio.client import connect
            return connect(WS_URL, additional_headers={'Authorization': 'Bearer ' + token}, **params)
        except ImportError:
            return websockets.connect(WS_URL, extra_headers={'Authorization': 'Bearer ' + token}, **params)

    def subscribe(self, codes, loop=None, maxsize=QUEUE_MAXSIZE):
        normalized = {str(code) for code in codes if len(str(code)) == 6 and str(code).isdigit()}
        if loop is None:
            loop = asyncio.get_running_loop()
        with self._lock:
            self._next_id += 1
            sub = Subscription(self, self._next_id, normalized, loop, maxsize)
            self._subscribers[sub.sid] = sub
            self._track_order(normalized)
        self.start()
        return sub

    def _track_order(self, codes):
        for code in codes:
            if code not in self._order:
                self._next_order += 1
                self._order[code] = self._next_order

    def _change(self, sid, codes):
        with self._lock:
            if codes is None:
                self._subscribers.pop(sid, None)
            elif sid in self._subscribers:
                normalized = {str(code) for code in codes if len(str(code)) == 6 and str(code).isdigit()}
                self._subscribers[sid].codes = frozenset(normalized)
                self._track_order(normalized)
            # Retain ordering only for actively requested codes.
            active = set().union(*(sub.codes for sub in self._subscribers.values()))
            self._order = {code: order for code, order in self._order.items() if code in active}

    def _desired(self, index):
        with self._lock:
            active = set().union(*(sub.codes for sub in self._subscribers.values()))
            ordered = sorted(active, key=lambda code: (self._order.get(code, 0), code))
        return tuple(ordered[index * MAX_PER_SOCKET:(index + 1) * MAX_PER_SOCKET])

    def live_codes(self):
        with self._lock:
            return frozenset().union(*(self._confirmed[i] for i in range(SOCKETS) if self._connected[i]))

    def _dispatch(self, event):
        now = time.time()
        with self._lock:
            self._last_tick_at = now
            self._ticks += 1
            targets = [sub for sub in self._subscribers.values() if event['code'] in sub.codes]
        for sub in targets:
            try:
                sub.loop.call_soon_threadsafe(sub._deliver, event)
            except RuntimeError:
                pass

    def start(self):
        with self._lock:
            if self._threads:
                return self
            for i in range(SOCKETS):
                thread = threading.Thread(target=self._runner, args=(i,), daemon=True,
                                          name='toss-ws-%d' % i)
                self._threads.append(thread)
                thread.start()
        return self

    def _runner(self, index):
        asyncio.run(self._run(index))

    async def _run(self, index):
        failures = 0
        while True:
            if not self._desired(index):
                await asyncio.sleep(2)
                continue
            try:
                token = await asyncio.to_thread(self._token)
                async with self._connect_fn(token) as ws:
                    with self._lock:
                        self._connected[index] = True
                        self._errors[index] = None
                    failures = 0
                    await self._session(index, ws)
            except Exception as exc:
                failures += 1
                with self._lock:
                    self._errors[index] = type(exc).__name__
                    self._reconnects[index] += 1
                logger.warning('Toss market-data WebSocket slot %d disconnected: %s',
                               index, type(exc).__name__)
                await asyncio.sleep(min(60, 2 ** min(failures, 6)))
            finally:
                with self._lock:
                    self._connected[index] = False
                    self._confirmed[index] = frozenset()

    async def _session(self, index, ws):
        prior = None
        ping_at = 0
        last_send = 0
        while True:
            desired = self._desired(index)
            if not desired:
                return
            now = time.monotonic()
            if desired != prior and now - last_send >= 0.5:
                await ws.send(json.dumps([{'type': 'trade:kr', 'codes': list(desired)}]))
                prior, last_send = desired, now
                with self._lock:
                    self._confirmed[index] = frozenset()
            if now - ping_at >= 60:
                await ws.send('PING')
                ping_at = now
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
            except asyncio.TimeoutError:
                continue
            try:
                frame = json.loads(raw)
            except (TypeError, ValueError):
                continue
            kind = frame.get('type') if isinstance(frame, dict) else None
            if kind == 'subscriptions':
                subscribed = frame.get('subscribed') or []
                confirmed = {s.split(':')[-1] for s in subscribed
                             if s.startswith('trade:kr:')}
                with self._lock:
                    self._confirmed[index] = frozenset(confirmed)
                    self._rejects[index] += len(frame.get('rejected') or [])
            elif kind == 'message':
                event = _quote(frame)
                if event is not None:
                    self._dispatch(event)
            elif kind == 'error':
                err = frame.get('error') or {}
                code = str(err.get('code') or 'unknown')
                with self._lock:
                    self._errors[index] = code[:80]
                if code == 'server-shutdown':
                    return

    def health(self):
        with self._lock:
            active = set().union(*(s.codes for s in self._subscribers.values()))
            return {
                'running': bool(self._threads),
                'connected': sum(self._connected),
                'subscribers': len(self._subscribers),
                'desiredCodes': len(active),
                'maxCodes': MAX_CODES,
                'registeredCodes': sum(map(len, self._confirmed)),
                'liveCodes': len(self.live_codes()),
                'excessCodes': max(0, len(active) - MAX_CODES),
                'ticks': self._ticks,
                'lastTickAgeSec': round(time.time() - self._last_tick_at, 1)
                                  if self._last_tick_at else None,
                'droppedEvents': sum(s.dropped_events for s in self._subscribers.values()),
                'reconnects': sum(self._reconnects),
                'rejectedCount': sum(self._rejects),
                'lastErrors': list(self._errors),
            }


_singleton = None
_singleton_lock = threading.Lock()


def start(client_id=None, client_secret=None):
    global _singleton
    client_id = client_id or os.environ.get('TOSS_CLIENT_ID')
    client_secret = client_secret or os.environ.get('TOSS_CLIENT_SECRET')
    if not client_id or not client_secret:
        return None
    with _singleton_lock:
        if _singleton is None:
            _singleton = TossWsHub(client_id, client_secret)
        return _singleton


def health_snapshot():
    return _singleton.health() if _singleton else {'running': False, 'connected': 0}
