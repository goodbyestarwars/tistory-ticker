'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/skin-main.js','utf8');
const window={NineUI:{escapeHtml:String}};
vm.runInNewContext(fs.readFileSync('js/investor-flow.js','utf8'),{window});
const data={historyDate:'2026-11-17',observations:[0,2,5].map(slot=>({ts:Date.parse('2026-11-17T08:45:00+09:00')/1000+slot*1800,foreign:slot+1,institution:-slot,individual:0}))};
let updates=0;
const navigation=source.slice(source.indexOf('    function selectHomeFuturesIndex'),source.indexOf("    dashboardSection.addEventListener('click',function(e){var step="));
// Keep the same lexical state as the home renderer.
const nav=new Function('window','homeFuturesDisplayData','syncHomeFuturesSelection','var homeFuturesSelectedSlot=null;'+navigation+';return {selectHomeFuturesIndex,stepHomeFutures,get:()=>homeFuturesSelectedSlot};')(window,()=>data,()=>updates++);
nav.selectHomeFuturesIndex(Infinity);assert.equal(nav.get(),5);
nav.stepHomeFutures(-1);assert.equal(nav.get(),2);nav.stepHomeFutures(-1);assert.equal(nav.get(),0);
nav.stepHomeFutures(-1);assert.equal(nav.get(),0);assert.equal(updates,3);
nav.stepHomeFutures(1);assert.equal(nav.get(),2);
const us=fs.readFileSync('js/us-stocks.js','utf8');
assert.doesNotMatch(us,/usStocksOptions|\/us-options\//);
console.log('PASS actual observation navigation, clamped ends and removal of US chart options panel');
