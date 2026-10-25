'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('js/skin-main.js','utf8'),fields={};
const scope={document:{getElementById:()=>null},window:{NineTime:{updated:()=>''}},
  setField:(name,value)=>{fields[name]=value;}};
vm.createContext(scope);
const start=source.indexOf('    function resolveMarketDirection(');
const end=source.indexOf('    var MARKET_TEMP_VM_URL',start);
vm.runInContext(source.slice(start,end),scope);
scope.market={score100:23,grade3:{label:'공포'},temp:17,components:{
  riseRatio:{ratio:.094},avgChange:{avgChangeRate:-2.36},exchange:{price:1326.9,changeRate:.03}}};
vm.runInContext('renderMarketTemperature(market)',scope);
assert.equal(fields.temperature,'23점 공포');
assert.equal(fields.direction,'급락');
assert.match(fields.exchange,/1,326.9원/);
delete fields.temperature;
vm.runInContext('setHomeVmScore({score100:null}); renderMarketTemperature({temp:17,grade:{label:"중립"}})',scope);
assert.equal(fields.temperature,undefined,'missing score and legacy Celsius must not become a valid VM score');
assert(!source.includes("fetchHomeJson(GAS_TICKER_URL + '?marketTemp=1"));
assert(source.includes("home_market_temp_vm_v3"),'old Celsius cache cannot populate the canonical model');
console.log('PASS home uses VM score, breadth and exchange; null/legacy score stays missing');
