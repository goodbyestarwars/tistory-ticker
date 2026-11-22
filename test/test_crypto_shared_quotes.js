'use strict';
require('./helpers/common_runtime');

const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('indicator and weekend consumers share pending requests and 30s cache; errors permit recovery',async()=>{
  let now=0,calls=0,resolve,reject;
  const window={NineAccess:{isAdmin:()=>true}},document={readyState:'complete',getElementById:()=>null};
  const FakeDate=class extends Date{static now(){return now;}};
  const context={window,document,Date:FakeDate,AbortController,setTimeout,clearTimeout,
    fetch:url=>{assert.match(url,/\/futures\?days=365&symbols=BTC,ETH,USDT$/);calls++;return new Promise((a,b)=>{resolve=a;reject=b;});}};
  vm.runInNewContext(fs.readFileSync('js/crypto-market.js','utf8'),context);
  const api=window.CryptoMarket,a=api.fetchCoinQuotes(),b=api.fetchCoinQuotes();
  assert.equal(a,b);await Promise.resolve();assert.equal(calls,1);
  resolve({ok:true,json:async()=>({data:[{symbol:'BTC',price:123,change_rate:-1,updated_at:'2026-10-24T12:00:00+09:00'}]})});
  assert.equal((await a)[0].price,123);assert.equal(api.fetchCoinQuotes(),a);
  now=30001;const fail=api.fetchCoinQuotes();await Promise.resolve();assert.equal(calls,2);reject(Error('offline'));await assert.rejects(fail,/offline/);
  const recovered=api.fetchCoinQuotes();await Promise.resolve();assert.equal(calls,3);resolve({ok:true,json:async()=>({data:[{symbol:'BTC',price:125}]})});assert.equal((await recovered)[0].price,125);
  now=60002;const malformed=api.fetchCoinQuotes();await Promise.resolve();resolve({ok:true,json:async()=>({error:'unavailable'})});await assert.rejects(malformed,/payload/);
});
test('guest quotes use public Upbit ticker and share its pending request', async () => {
  let calls = 0;
  const window = { NineAccess: { isAdmin: () => false }, NineHttp: { json: async url => {
    assert.equal(url, 'https://api.upbit.com/v1/ticker?markets=KRW-BTC,KRW-ETH,KRW-USDT');
    calls++;
    return [{market:'KRW-BTC',trade_price:100,signed_change_rate:0.025,signed_change_price:2.5,high_price:105,low_price:94,timestamp:1795392000000}];
  } } };
  vm.runInNewContext(fs.readFileSync('js/crypto-market.js','utf8'), {window,document:{readyState:'complete',getElementById:()=>null}});
  const first = window.CryptoMarket.fetchCoinQuotes();
  assert.equal(window.CryptoMarket.fetchCoinQuotes(), first);
  const [btc] = await first;
  assert.equal(calls, 1);
  assert.equal(btc.symbol, 'BTC');
  assert.equal(btc.price, 100);
  assert.equal(btc.change_rate, 2.5);
});
