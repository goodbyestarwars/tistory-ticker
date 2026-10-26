const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ctx={};vm.runInNewContext(fs.readFileSync('js/scanner-dashboard.js','utf8'),ctx);
const model=ctx.ScannerDashboard.model,day=ctx.ScannerDashboard.kstDay;
const now=Date.parse('2026-10-26T12:00:00Z'),source='pattern:volumeBreakout';
const hit=(code,scanDate,scanner=source)=>({code,name:code,scanDate,scanner});
const row=(code,at,stage='new')=>({code,name:code,at,stage,reason:'stored reason',badge:stage});
function run(extra={},days=7){return model({source,label:'거래량',currentLoaded:true,historyLoaded:true,historyLimit:1500,hits:[],current:[],...extra},days,now)}
assert.deepEqual(Array.from(run({currentLoaded:false,historyLoaded:false}).counts),[null,null,null,null]);
assert.deepEqual(Array.from(run({stats:{success:0,failed:0}}).counts),[0,0,0,0]);
const input={hits:[hit('005930','2026-10-26'),hit('005930','2026-10-26'),hit('000660','2026-10-26'),hit('035420','2026-10-23'),hit('111111','2026-10-26','other')],
 current:[row('005930','2026-10-26T10:00:00Z','ready'),row('005930','2026-10-26T11:00:00Z','ready')],stats:{success:3,failed:1}};
const original=JSON.stringify(input),value=run(input);
assert.deepEqual(Array.from(value.counts),[2,1,3,1]);assert.equal(value.delta,1);assert.equal(value.deltaPct,100);
assert.equal(JSON.stringify(input),original);assert.equal(value.recent[0].code,'005930');assert.equal(value.recent.length,3);
assert.equal(value.recent[0].reason,'stored reason');assert.equal(value.points.find(p=>p.time==='2026-10-26').value,2);
assert.equal(run({...input,current:[row('999999','2026-10-26T11:00:00Z')]}).delta,null,'live and saved sample mismatch is not comparable');
assert.equal(day('2026-10-25T15:01:00Z'),'2026-10-26');assert.equal(day(null),'');
assert.equal(run({current:[row('123456',null),row('234567','2026-10-27T00:00:00Z')]}).recent.length,0,'unknown and future timestamps excluded');
const hist=[hit('1','2026-10-25'),hit('2','2026-10-15'),hit('3','2026-08-15'),hit('4','2026-07-01')];
assert.equal(run({hits:hist},7).points.length,1);assert.equal(run({hits:hist},30).points.length,2);assert.equal(run({hits:hist},90).points.length,3);
const limited=run({hits:[hit('1','2026-10-24'),hit('2','2026-10-25'),hit('3','2026-10-25')],historyLimit:3});
assert.equal(limited.truncated,true);assert.equal(limited.points.length,1);assert.equal(limited.points[0].value,2);
assert.equal(run({hits:[hit('1','2026-10-26')],historyLimit:1}).counts[0],null,'partial latest day cannot claim exact count');
assert.equal(run({current:Array.from({length:8},(_,i)=>row(String(i),'2026-10-26T'+String(i+1).padStart(2,'0')+':00:00Z'))}).recent.length,5);
const sourceText=fs.readFileSync('js/pattern-scan.js','utf8');
assert.ok(sourceText.includes('var SCAN_PERF_WINDOW_DAYS = 35;'),'existing performance window unchanged');
console.log('PASS dashboard deduplication, missing/zero data, mixed sources, latest five, KST, ranges, deltas and truncation');
