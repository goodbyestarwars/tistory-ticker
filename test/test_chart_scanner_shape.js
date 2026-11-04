
require('./helpers/common_runtime');
const assert=require('assert'),fs=require('fs'),vm=require('vm'),AW=require('../js/auto-wave.js');
const up=Array.from({length:20},(_,i)=>100+i),down=up.slice().reverse();
assert.strictEqual(AW.shapeOf(up).type,'up');
assert.strictEqual(AW.shapeOf(down).type,'down');
const scaled=AW.shapeOf(up.map(x=>x*10000));
assert.strictEqual(scaled.type,'up');assert.strictEqual(scaled.score,AW.shapeOf(up).score);
const spike=up.slice();spike[10]=300;
assert.ok(Math.abs(AW.shapeOf(spike).slope-1)<0.1,'single spike does not bend robust trend slope');
assert.ok(!['pullback','rebound'].includes(AW.shapeOf(spike).type),'single spike is not a preceding rally');
const pull=[100,102,105,108,111,115,119,122,125,128,126,124,122,120,119,119,119,120,121,122];
assert.strictEqual(AW.shapeOf(pull).type,'rebound');
assert.strictEqual(AW.shapeOf([100,101,null,103,104,105,106,107]).type,'unknown');
assert.strictEqual(AW.shapeOf(Array(20).fill(100)).type,'range');
assert.strictEqual(AW.shapeOf(up.map((close,i)=>({date:String(20-i).padStart(2,'0'),close}))).type,'unknown','reverse series is not quietly repaired');
const context={window:{AutoWave:AW},document:{readyState:'loading',addEventListener(){}},console};
vm.runInNewContext(fs.readFileSync('js/pattern-scan.js','utf8'),context);
const api=context.window.PatternScan,now=Date.now();
const entries=[{key:'doubleBottom',items:[
 {code:'123450',name:'모양대조A',miniChart:down,patternDetail:{status:'NECKLINE_READY'}},
 {code:'123451',name:'모양대조B',miniChart:up,patternDetail:{status:'NECKLINE_READY'}},
 {code:'123452',name:'미확인',patternDetail:{status:'NECKLINE_READY'}}]}];
const before=JSON.stringify(entries),rows=api.mergeScannerRows(entries),model=api.publicModel(rows,{},now);
assert.strictEqual(model.rows[0].code,'123451','shape ranks within identical existing observation state');
assert.strictEqual(model.counts.observation,3);assert.strictEqual(model.counts.confirmed,0);
assert.strictEqual(before,JSON.stringify(entries),'no source signal mutations');
assert.strictEqual(api.scannerShape({miniChart:up}).score,AW.shapeOf(up).score,'scanner reuses shared engine');
assert.ok(api.shapeHtml(model.rows[0]).includes('종가 모양'));
const empty=api.publicModel(api.mergeScannerRows([{key:'doubleBottom',items:[{code:'123453',miniChart:[null,null,null,null,null,null,null,null],patternDetail:{status:'NECKLINE_READY'}}]}]),{},now);
assert.strictEqual(empty.rows[0].chartShape.type,'unknown');
require('../js/chart-wave-overlay.js');const W=globalThis.NineChartWave;
globalThis.AutoWave=AW;
const bars=Array.from({length:24},(_,i)=>({date:'2025-01-'+String(i+1).padStart(2,'0'),open:100+i,close:100+i,high:102+i,low:98+i,volume:100}));
assert.strictEqual(W.trendShape(bars,0,10).useful,false,'tiny strokes remain excluded');
assert.strictEqual(W.trendShape(bars,0,12).useful,true,'clear shorter structure survives fixed 15-bar rejection');
console.log('shared shape: scale invariance, spike resistance, pullback/rebound, missing/order guards, scanner sorting/state preservation, adaptive short trends OK');
