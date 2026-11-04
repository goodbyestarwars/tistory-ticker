require('./helpers/common_runtime');
const assert=require('assert'),AW=require('../js/auto-wave.js'),fs=require('fs'),cp=require('child_process'),os=require('os'),path=require('path');
function bars(vals,vol){return vals.map((c,i)=>({date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),open:c-.1,high:c+.3,low:c-.3,close:c,volume:vol?vol[i]:1000}));}
const vals=Array.from({length:60},(_,i)=>i<30?100+i*.4:i<45?112-(i-30)*.2:109+(i%3)*.03);
const input=bars(vals,vals.map((_,i)=>i<30?2000:800));
const before=JSON.stringify(input),selected=AW.selectShapesOf(input);
assert.ok(selected.pullbackRebreak.length,'shallow correction selected by shape, below old 5% drop minimum');
assert.ok((112-input.at(-1).close)/112<.05);
assert.strictEqual(JSON.stringify(input),before);
const down=AW.selectShapesOf(bars(Array.from({length:224},(_,i)=>400-i)));
assert.ok(Object.values(down).every(v=>v.length===0),'unbroken falling lows are not a base/pullback');
const bad=input.map(b=>({...b}));bad[20].volume=null;
assert.ok(Object.values(AW.selectShapesOf(bad)).every(v=>v.length===0),'missing OHLCV not silently repaired');
const scaled=input.map(b=>({...b,open:b.open*100,high:b.high*100,low:b.low*100,close:b.close*100}));
assert.strictEqual(AW.selectShapesOf(scaled).pullbackRebreak.length,selected.pullbackRebreak.length);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'shape-select-test-')),file=path.join(temp,'input.jsonl');
try{
 fs.writeFileSync(file,JSON.stringify({code:'123450',name:'합성',daily:input,financialScreen:{passed:false}})+'\n');
 const out=JSON.parse(cp.execFileSync(process.execPath,['scripts/cloud-vm/shape_scan.js',file],{encoding:'utf8'}));
 assert.strictEqual(out.pullbackRebreak.length,1);assert.strictEqual(out.longTermQuality.length,0);
 assert.strictEqual(out.pullbackRebreak[0].patternDetail.orderAuthorized,false);
 assert.strictEqual(out.pullbackRebreak[0].patternDetail.observationOnly,true);
 assert.ok(!out.pullbackRebreak[0].signalReview && !out.pullbackRebreak[0].signalAt);
}finally{fs.rmSync(temp,{recursive:true,force:true});}
const vm=require('vm'),ctx={window:{AutoWave:AW},document:{readyState:'loading',addEventListener(){}},console};
vm.runInNewContext(fs.readFileSync('js/pattern-scan.js','utf8'),ctx);const api=ctx.window.PatternScan,now=Date.now();
const snap={scannedAt:new Date(now).toISOString(),groups:{pullbackRebreak:[{code:'123450',patternDetail:{...selected.pullbackRebreak[0]}}]}};
const rows=api.mergeScannerRows([{key:'shape:pullbackRebreak',items:api.shapeSelectionItems(snap,'pullbackRebreak')}]);
const model=api.publicModel(rows,{},now);
assert.strictEqual(model.counts.observation,1);assert.strictEqual(model.counts.confirmed,0);
console.log('shape selection: new shallow candidate, falling negative, scale/missing/immutability, bounded shared worker, financial/order separation, web observation OK');
