/* Shared public-market crypto ticker. One Upbit socket per page; no API key,
 * backend process or private quote endpoint. Exposes UTC-00 prior-close changes. */
(function (global) {
  'use strict';
  if (global.NineCryptoLive) return;
  var MARKET = { BTC:'KRW-BTC', ETH:'KRW-ETH', USDT:'KRW-USDT' };
  var lookup = { 'KRW-BTC':'BTC', 'KRW-ETH':'ETH', 'KRW-USDT':'USDT' };
  var subscribers = [], latest = {}, socket = null, retry = null, ticker = null, generation = 0;
  var state = 'waiting', scheduled = null;
  function status(value) {
    state = value;
    notify();
  }
  function notify() {
    if (scheduled != null) return;
    scheduled = setTimeout(function () {
      scheduled = null;
      subscribers.slice().forEach(function (fn) {
        try { fn(latest, state); } catch (err) { /* subscriber failure is isolated */ }
      });
    }, 180);
  }
  function receive(packet) {
    if (!packet || packet.type !== 'ticker' || !Object.prototype.hasOwnProperty.call(lookup, packet.code)) return;
    var symbol = lookup[packet.code];
    var price = Number(packet.trade_price);
    var rate = Number(packet.signed_change_rate);
    if (!(price > 0) || !isFinite(rate)) return;
    var stamp = Number(packet.timestamp || packet.trade_timestamp) || Date.now();
    if (latest[symbol] && stamp < latest[symbol].at) return;
    latest[symbol] = {
      symbol:symbol, market:packet.code, price:price,
      change_rate:rate * 100,
      change:Number.isFinite(Number(packet.signed_change_price)) ? Number(packet.signed_change_price) : null,
      high:Number(packet.high_price) || null, low:Number(packet.low_price) || null,
      at:stamp, source:'업비트 WebSocket'
    };
    notify();
  }
  function parse(data) {
    if (typeof data === 'string') {
      try { receive(JSON.parse(data)); } catch (error) {}
    } else if (data && typeof data.text === 'function') {
      data.text().then(parse).catch(function () {});
    } else if (data instanceof ArrayBuffer && global.TextDecoder) {
      parse(new global.TextDecoder().decode(data));
    }
  }
  function close() {
    generation++;
    clearTimeout(retry); retry = null;
    clearInterval(ticker); ticker = null;
    var previous = socket; socket = null;
    if (previous) { previous.onclose = null; try { previous.close(); } catch (error) {} }
  }
  function connect() {
    if (socket || !subscribers.length || document.hidden || !global.WebSocket) return;
    var id = ++generation;
    status('connecting');
    try { socket = new WebSocket('wss://api.upbit.com/websocket/v1'); }
    catch (error) { socket = null; scheduleRetry(); return; }
    var current = socket;
    current.onopen = function () {
      if (id !== generation) return;
      current.send(JSON.stringify([
        {ticket:'ninepay-crypto-public-v1'},
        {type:'ticker', codes:Object.keys(lookup)},
        {format:'DEFAULT'}
      ]));
      clearInterval(ticker);
      ticker = setInterval(function () {
        if (current.readyState === WebSocket.OPEN) {
          try { current.send('PING'); } catch (error) {}
        }
      }, 30000);
      status('live');
    };
    current.onmessage = function (message) { if (id === generation) parse(message.data); };
    current.onerror = function () { if (current.readyState !== WebSocket.CLOSED) current.close(); };
    current.onclose = function () {
      if (id !== generation) return;
      socket = null; clearInterval(ticker); ticker = null;
      status('retry'); scheduleRetry();
    };
  }
  function scheduleRetry() {
    if (retry || !subscribers.length || document.hidden) return;
    retry = setTimeout(function () { retry = null; connect(); }, 6000);
  }
  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    subscribers.push(fn); notify(); connect();
    return function () {
      var pos = subscribers.indexOf(fn);
      if (pos >= 0) subscribers.splice(pos,1);
      if (!subscribers.length) { close(); state = 'waiting'; }
    };
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { close(); status('paused'); }
    else if (subscribers.length) connect();
  });
  global.NineCryptoLive = {subscribe:subscribe, markets:MARKET,
    latest:function (symbol) { return latest[symbol] || null; },
    connection:function () { return state; },
    isFresh:function (item) { return !!(item && item.at && Date.now()-item.at < 45000); }
  };
})(window);
