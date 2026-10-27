const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'js/pattern-scan.js'),'utf8');
const start = script.indexOf('  function phaseTwoEvents() {');
const end = script.indexOf('  function unifiedItems() {', start);
assert(start >= 0 && end > start);
const now = Date.parse('2026-10-27T01:10:00Z');
class FakeDate extends Date { static now(){ return now; } }
const context = {Date:FakeDate, Number, Array, Object, ninepayError:'', ninepayData:null};
vm.createContext(context);
vm.runInContext(script.slice(start,end),context);
const event = {code:'005930',signalId:'2026-10-27:005930',ruleVersion:'ab70-v1',at:now/1000-3,first70At:now/1000-30,volumeRatio:0.8,volumeMissing:false,excluded:null,branches:['A'],price:1000,source:'Kiwoom WebSocket'};
context.ninepayData={ruleVersion:'ab70-v1',signals:[event],running:true,active:true,rankAt:'2026-10-27T01:09:50Z'};
assert.equal(context.phaseTwoEvents().length,1);
for (const bad of [{branches:[]},{volumeMissing:true},{volumeRatio:0.5},{excluded:'제외'},{signalId:'2026-10-26:005930'},{first70At:0},{ruleVersion:'old'}]) {
  context.ninepayData.signals=[Object.assign({},event,bad)];
  assert.equal(context.phaseTwoEvents().length,0,JSON.stringify(bad));
}
context.ninepayData.rankError='failed'; assert.equal(context.phaseTwoEvents(),null); context.ninepayData.rankError=null; context.ninepayError='timeout'; assert.equal(context.phaseTwoEvents(),null);
const d={Date:FakeDate,Number,Set,Object,Array,globalThis:null};d.globalThis=d;vm.createContext(d);vm.runInContext(fs.readFileSync(path.join(root, 'js/scanner-dashboard.js'),'utf8'),d);
const model=d.ScannerDashboard.model({mode:'first-stage',source:'pattern:ninepayLive',currentLoaded:true,secondCount:1,current:[{code:'005930',at:(now-30000)/1000},{code:'005930',at:(now-20000)/1000}],hits:[{scanner:'pattern:ninepayLive',code:'000660',scanDate:'2026-10-27'}]},7,now);
assert.equal(model.counts[0],1);assert.equal(model.counts[1],1);assert.equal(model.points.length,0);
const progress={Date:FakeDate,Number,globalThis:null};progress.globalThis=progress;vm.createContext(progress);vm.runInContext(fs.readFileSync(path.join(root, 'js/scanner-progress.js'),'utf8'),progress);
for(const [state,want] of [['run_timeout','스캔 시간 초과'],['wait_timeout','스캔 대기 시간 초과']]) assert(progress.ScannerProgress.model([{id:'dailyscan',lastExecution:{state}}],false,now).title.includes(want));
const running=progress.ScannerProgress.model([{id:'dailyscan',lastExecution:{state:'running',startedAt:'2026-10-27T01:00:00Z'},progress:{processed:25,total:100,updatedAt:'2026-10-27T01:10:00Z'}}],false,now);
assert.equal(running.percent,25);
console.log('PASS: A/B evidence, invalid/missing data, first-stage deduplication, progress and timeout mapping');
