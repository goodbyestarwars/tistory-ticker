'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const binance = fs.readFileSync('js/overnight-market.js', 'utf8');
const crypto = fs.readFileSync('js/crypto-market.js', 'utf8');
const board = fs.readFileSync('js/indicator-board.js', 'utf8');
const start = binance.indexOf('  function binanceSymbolItem(pair, quotesOnly) {');
const end = binance.indexOf('  var binanceListingsMemo', start);
assert(start >= 0 && end > start);
const make = new Function('BINANCE_FAPI', 'BINANCE_PRICE_TICKER', 'binanceGet', 'binanceKlines',
  binance.slice(start, end) + 'return binanceSymbolItem;');
const summaryStart = crypto.indexOf('  function tokenTradeSummary(item) {');
const summaryEnd = crypto.indexOf('  // 일봉 이력', summaryStart);
assert(summaryStart >= 0 && summaryEnd > summaryStart);
const tradeSummary = new Function(crypto.slice(summaryStart, summaryEnd) + 'return tokenTradeSummary;')();

(async function () {
  const now = Date.now();
  const stats = {symbol: 'SAMSUNGUSDT', lastPrice:'145.86', priceChangePercent:'-10.66',
    highPrice:'165.89', lowPrice:'145.76', closeTime:now, lastId:500};
  let requested = [];
  const handler = make('https://fapi.binance.com/fapi/v1',
    'https://fapi.binance.com/fapi/v2/ticker/price', function (url) {
      requested.push(url);
      return url.includes('/ticker/24hr') ? Promise.resolve(stats)
        : Promise.resolve({symbol:'SAMSUNGUSDT', price:'145.83', time:now-18000});
    }, function () { return Promise.resolve([]); });
  const fresh = await handler(['SAMSUNGUSDT','삼성전자'],true);
  assert.equal(fresh.price,145.83,'the price must match the source of the trade time');
  assert.equal(fresh.tradeTime,now-18000);
  assert.equal(fresh.statsWindowEndAt,now,'the 24-hour window end is not a trade time');
  assert.equal(fresh.high,165.89);
  assert.equal(requested.length,2,'two lightweight quote requests, no klines in compact mode');
  assert(requested.some(function(url){return url.includes('/fapi/v2/ticker/price?symbol=SAMSUNGUSDT');}));
  assert(tradeSummary(fresh).includes('초 전'));
  assert(tradeSummary({tradeTime:now-600000}).includes('거래 공백'));
  assert.equal(tradeSummary({tradeTime:now+120000}),'체결시각 미확인');
  assert.equal(tradeSummary({statsWindowEndAt:now}),'체결시각 미확인');

  const blocked = make('https://fapi.binance.com/fapi/v1',
    'https://fapi.binance.com/fapi/v2/ticker/price',function (url) {
      return url.includes('/ticker/24hr') ? Promise.resolve(stats) : Promise.reject(new Error('restricted'));
    },function(){return Promise.resolve([]);});
  const fallback = await blocked(['SAMSUNGUSDT','삼성전자'],true);
  assert.equal(fallback.price,145.86,'valid rolling quote remains visible');
  assert.equal(fallback.tradeTime,null,'failed time lookup must not be invented');
  assert.equal(tradeSummary(fallback),'체결시각 미확인');
  assert(crypto.includes("tokenSource === 'server' ? '서버 저장"));
  assert(crypto.includes("tokenFetchFailed ? '조회 지연"));
  assert(crypto.includes('마지막 조회 종료'),'request completion not transaction time');
  assert(board.includes("if (subtitle.textContent !== row.sub) subtitle.textContent = row.sub"),
    'shared board must update row timestamps without rebuilding');
  console.log('PASS: Binance trade time / receipt / unavailable / stale / fallback labels');
})().catch(function (error) { console.error(error); process.exitCode=1; });
