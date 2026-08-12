# -*- coding: utf-8 -*-
"""Shared Finnhub US stock WebSocket stream for browser watchlists.

Finnhub limits one WebSocket connection per API key, so this module keeps one
upstream connection per API process and broadcasts only subscribed symbols to
the connected browser clients.
"""

import asyncio
import json
import logging
import os
import urllib.parse

import us_stocks


logger = logging.getLogger('finnhub_realtime')
FINNHUB_WS_URL = 'wss://ws.finnhub.io'
RECONNECT_DELAY_SEC = 5

_clients = {}
_state_lock = asyncio.Lock()
_wake_event = asyncio.Event()
_manager_task = None
_baseline = {}
_last_price = {}


def _number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


async def _snapshot_symbols():
    async with _state_lock:
        return set(symbol for symbols in _clients.values() for symbol in symbols)


async def _ensure_baselines(symbols):
    missing = [symbol for symbol in symbols if symbol not in _baseline]
    if not missing:
        return

    async def load(symbol):
        try:
            quote = await asyncio.to_thread(us_stocks.quote, symbol)
            previous_close = _number(quote.get('previous_close'))
            if previous_close is None:
                price = _number(quote.get('price'))
                change = _number(quote.get('change'))
                if price is not None and change is not None:
                    previous_close = price - change
            return symbol, previous_close
        except Exception as exc:
            logger.warning('Finnhub baseline quote failed for %s: %s', symbol, exc)
            return symbol, None

    results = await asyncio.gather(*(load(symbol) for symbol in missing))
    for symbol, previous_close in results:
        _baseline[symbol] = previous_close


async def _broadcast_trade(row):
    symbol = str(row.get('s') or '').strip().upper()
    price = _number(row.get('p'))
    if not symbol or price is None or _last_price.get(symbol) == price:
        return
    _last_price[symbol] = price

    previous_close = _baseline.get(symbol)
    change = price - previous_close if previous_close is not None else None
    change_rate = change / previous_close * 100 if previous_close else None
    event = {
        'type': 'quote',
        'code': 'US:' + symbol,
        'symbol': symbol,
        'price': price,
        'change': change,
        'changeRate': change_rate,
        'timestamp': row.get('t'),
        'source': 'Finnhub WebSocket',
    }

    async with _state_lock:
        targets = [client for client, symbols in _clients.items() if symbol in symbols]
    for client in targets:
        try:
            await client.send_json(event)
        except Exception:
            await unregister(client)


async def _run_manager():
    global _manager_task
    try:
        while True:
            symbols = await _snapshot_symbols()
            if not symbols:
                await _wake_event.wait()
                _wake_event.clear()
                continue

            api_key = os.environ.get('FINNHUB_API_KEY', '').strip()
            if not api_key:
                logger.warning('FINNHUB_API_KEY is not configured; US WebSocket is disabled')
                await asyncio.sleep(RECONNECT_DELAY_SEC)
                continue

            try:
                import websockets

                url = FINNHUB_WS_URL + '?token=' + urllib.parse.quote(api_key, safe='')
                async with websockets.connect(
                    url,
                    open_timeout=10,
                    close_timeout=5,
                    ping_interval=20,
                    ping_timeout=20,
                    max_size=2 * 1024 * 1024,
                ) as upstream:
                    subscribed = set()
                    while True:
                        desired = await _snapshot_symbols()
                        if not desired:
                            return
                        await _ensure_baselines(desired)
                        for symbol in sorted(desired - subscribed):
                            await upstream.send(json.dumps({'type': 'subscribe', 'symbol': symbol}))
                        for symbol in sorted(subscribed - desired):
                            await upstream.send(json.dumps({'type': 'unsubscribe', 'symbol': symbol}))
                        subscribed = desired

                        receive_task = asyncio.create_task(upstream.recv())
                        wake_task = asyncio.create_task(_wake_event.wait())
                        done, pending = await asyncio.wait(
                            {receive_task, wake_task},
                            return_when=asyncio.FIRST_COMPLETED,
                        )
                        for task in pending:
                            task.cancel()
                        if wake_task in done:
                            _wake_event.clear()
                            continue
                        message = json.loads(await receive_task)
                        if message.get('type') == 'trade':
                            for row in message.get('data') or []:
                                if isinstance(row, dict):
                                    await _broadcast_trade(row)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning('Finnhub WebSocket disconnected: %s', exc)
                await asyncio.sleep(RECONNECT_DELAY_SEC)
    finally:
        current = asyncio.current_task()
        if _manager_task is current:
            _manager_task = None


async def register(client, symbols):
    global _manager_task
    clean = {str(symbol or '').strip().upper() for symbol in symbols if symbol}
    if not clean:
        return
    async with _state_lock:
        _clients[client] = clean
        if _manager_task is None or _manager_task.done():
            _manager_task = asyncio.create_task(_run_manager())
    _wake_event.set()


async def unregister(client):
    async with _state_lock:
        _clients.pop(client, None)
    _wake_event.set()


async def stream_quotes(client, symbols):
    """Keep a browser subscription alive until the browser WebSocket closes."""
    if not symbols:
        return
    await register(client, symbols)
    try:
        await asyncio.Future()
    finally:
        await unregister(client)
