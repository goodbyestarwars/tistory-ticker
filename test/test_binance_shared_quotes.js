'use strict';
require('./helpers/common_runtime');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
function marketFixture(){
  let now=0, listed=true, malformed=false;
  const calls=[];
  const window={},document={readyState:'loading',addEventListener(){},documentElement:{classList:{contains:()=>false}}};
  const context={window,document,URL,AbortController,setTimeout,clearTimeout,Date:class extends Date{static now(){return now;}},
    fetch:async url=>{
      calls.push(url);const symbol=new URL(url).searchParams.get('symbol');
      let data;
      if(url.endsWith('/exchangeInfo')) data=malformed?{}:{symbols:[
        {symbol:'SAMSUNGUSDT',status:listed?'TRADING':'SETTLING',quoteAsset:'USDT',contractType:'TRADIFI_PERPETUAL'},
        {symbol:'KODEX200USDT',status:'TRADING',quoteAsset:'USDT',contractType:'PERPETUAL'},
        {symbol:'SKHYNIXUSDT',status:'SETTLING',quoteAsset:'USDT',contractType:'TRADIFI_PERPETUAL'},
        {symbol:'NAVERUSDT',status:'TRADING',quoteAsset:'USDC',contractType:'TRADIFI_PERPETUAL'},
        {symbol:'OTHERUSDT',status:'TRADING',quoteAsset:'USDT',contractType:'PERPETUAL'}]};
      else if(url.includes('/klines'))data=[[1,0,0,0,100],[2,0,0,0,101]];
      else if(url.includes('/premiumIndex'))data={markPrice:'164',lastFundingRate:'.0001'};
      else data={symbol,lastPrice:'164.125',priceChangePercent:'1.25',highPrice:'170',lowPrice:'160',closeTime:123456};
      return{ok:true,json:async()=>data};
    }};
  vm.runInNewContext(fs.readFileSync('js/overnight-market.js','utf8'),context);
  return {api:window.OvernightMarket.cryptoTools,calls,time:n=>{now=n;},delist:()=>{listed=false;},malformed:b=>{malformed=b;}};
}
test('compact shared client validates listings/units, dedupes and fetches only current quotes',async()=>{
  const f=marketFixture(),a=f.api.fetchTokens({quotesOnly:true}),b=f.api.fetchTokens({quotesOnly:true});
  assert.equal(a,b);const result=await a;
  assert.deepEqual(Array.from(result.symbols,p=>p[0]),['SAMSUNGUSDT','KODEX200USDT']);
  assert.equal(result.items[0].quoteAsset,'USDT');assert.equal(result.items[0].price,164.125);
  assert.equal(f.calls.length,3);assert.ok(f.calls.every(u=>!/premiumIndex|klines/.test(u)));
  await f.api.fetchTokens({quotesOnly:true});assert.equal(f.calls.length,3);
  f.time(25000);await f.api.fetchTokens({quotesOnly:true});assert.equal(f.calls.length,5);
  assert.equal(f.calls.filter(u=>u.endsWith('/exchangeInfo')).length,1);
  f.time(3600000);f.delist();const changed=await f.api.fetchTokens({quotesOnly:true});
  assert.deepEqual(Array.from(changed.symbols,p=>p[0]),['KODEX200USDT']);
});
test('failed listing validation recovers without assuming that an old symbol is still trading',async()=>{
  const f=marketFixture();f.malformed(true);await assert.rejects(f.api.fetchTokens({quotesOnly:true}),/listings/);
  assert.equal(f.calls.length,1);f.malformed(false);assert.equal((await f.api.fetchTokens({quotesOnly:true})).items.length,2);
});
test('default existing consumer keeps premium/history contract',async()=>{
  const f=marketFixture(),result=await f.api.fetchTokens();
  assert.equal(result.items.length,8);assert.equal(result.items[0].klines.length,2);
  assert.equal(f.calls.filter(u=>u.includes('/premiumIndex')).length,8);
  assert.equal(f.calls.filter(u=>u.includes('/klines')).length,8);
});
