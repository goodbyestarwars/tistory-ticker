require('./helpers/common_runtime');
const assert=require('assert'),AW=require('../js/auto-wave.js'),fs=require('fs'),cp=require('child_process'),os=require('os'),path=require('path');
function bars(vals,vol){return vals.map((c,i)=>({date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),open:c-.1,high:c+.8,low:c-.8,close:c,volume:vol?vol[i]:1000}));}
const anchors=[[0,100],[90,110],[130,145],[150,130],[160,135],[170,131],[180,132]],vals=[];
for(let j=1;j<anchors.length;j++)for(let i=0;i<anchors[j][0]-anchors[j-1][0];i++)vals.push(anchors[j-1][1]+(anchors[j][1]-anchors[j-1][1])*i/(anchors[j][0]-anchors[j-1][0]));
vals.push(anchors.at(-1)[1]);
const input=bars(vals,vals.map((_,i)=>i<30?2000:800));
const before=JSON.stringify(input),selected=AW.selectShapesOf(input);
assert.ok(selected.pullbackRebreak.length,'a real confirmed rise followed by a supported correction is selected');
assert.strictEqual(selected.pullbackRebreak[0].stage,'prepare');
assert.ok(selected.pullbackRebreak[0].setup.pending);
assert.ok(selected.pullbackRebreak[0].volumeContext);
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
 const out=JSON.parse(cp.execFileSync(process.execPath,['scripts/cloud-vm/shape_scan.js',file],{encoding:'utf8'})).groups;
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
// my-way relative strength: beat both indices, missing index is "missing" (never pass/fail)
{
  const days=Array.from({length:input.length+10},(_,i)=>new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10));
  const mk=(f)=>days.map((d,i)=>({date:d,open:f(i),high:f(i)*1.01,low:f(i)*.99,close:f(i),volume:1000}));
  const falling=days.map((d,i)=>({date:d,close:1000-i*3}));
  const flat=days.map((d)=>({date:d,close:500}));
  const strong=mk(i=>100+i*.5), weak=mk(i=>300-i*.8);
  const rs=AW.relativeStrengthOf(strong,{KOSPI:falling,KOSDAQ:flat});
  assert.strictEqual(rs.status,'ok');assert.ok(rs.rs20>0 && rs.rs60>0);
  assert.strictEqual(rs.rs20,Math.min(rs.vs.KOSPI.rs20,rs.vs.KOSDAQ.rs20),'weakest comparison summarizes');
  assert.ok(rs.rsPosition20>.9);
  for(const g of ['liveFlow','trendBreakout','pullbackRebreak','bottomFormation'])assert.strictEqual(AW.myWayOf(rs,g).pass,true,g);
  const lag=AW.relativeStrengthOf(weak,{KOSPI:falling,KOSDAQ:flat});
  assert.ok(lag.rs20<0);assert.strictEqual(AW.myWayOf(lag,'liveFlow').pass,false);assert.strictEqual(AW.myWayOf(lag,'bottomFormation').pass,false);
  assert.strictEqual(AW.myWayOf(lag,'longTermQuality').pass,true,'long-term keeps its own gate');
  const stale=AW.relativeStrengthOf(strong,{KOSPI:falling.slice(0,-1),KOSDAQ:flat});
  assert.strictEqual(stale.status,'missing');assert.strictEqual(AW.myWayOf(stale,'liveFlow').pass,null);
  // worker: filtered menu, pre-filter observed list, flagged unfiltered output when index is missing
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'shape-rs-test-')),f=path.join(tmp,'in.jsonl'),b=path.join(tmp,'b.json');
  try{
    const base=input.map((r,i)=>({...r,date:days[i]}));
    fs.writeFileSync(f,JSON.stringify({code:'123450',name:'합성',daily:base,financialScreen:{passed:false}})+'\n');
    const up=days.map((d,i)=>({date:d,close:500+i*20}));
    fs.writeFileSync(b,JSON.stringify({KOSPI:up,KOSDAQ:up}));
    let out=JSON.parse(cp.execFileSync(process.execPath,['scripts/cloud-vm/shape_scan.js',f,b],{encoding:'utf8'}));
    assert.strictEqual(out.observed.pullbackRebreak.length,1);assert.strictEqual(out.groups.pullbackRebreak.length,1,'relative strength cannot reject a valid geometric setup');
    assert.strictEqual(out.relativeStrength.filteredOut.pullbackRebreak,0);assert.strictEqual(out.relativeStrength.role,'advisory');assert.strictEqual(out.relativeStrength.status,'ok');
    out=JSON.parse(cp.execFileSync(process.execPath,['scripts/cloud-vm/shape_scan.js',f],{encoding:'utf8'}));
    assert.strictEqual(out.groups.pullbackRebreak.length,1);assert.strictEqual(out.relativeStrength.status,'missing');
    assert.strictEqual(out.groups.pullbackRebreak[0].patternDetail.myWay.pass,null);
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
  console.log('my-way relative strength: both indices, weakest summary, missing index, menu rules, worker filter OK');
}
{
  // falling less than a crashing market is not "my way"
  const days=Array.from({length:input.length+10},(_,i)=>new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10));
  const crash=days.map((d,i)=>({date:d,close:3000-i*8}));
  const sagging=days.map((d,i)=>({date:d,open:100-i*.2,high:100-i*.2+1,low:100-i*.2-1,close:100-i*.2,volume:1}));
  const rs=AW.relativeStrengthOf(sagging,{KOSPI:crash,KOSDAQ:crash});
  assert.ok(rs.rs20>0 && rs.own20<0);
  for(const g of ['liveFlow','trendBreakout','pullbackRebreak','bottomFormation'])assert.strictEqual(AW.myWayOf(rs,g).pass,false,g);
  console.log('my-way: beating a crash while falling is excluded OK');
}
// edge-v1 research tags (2026-11-08): high-basis observation tags, shown inside existing menus
{
  const day=i=>new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10);
  const n=170,rise=i=>100*Math.pow(1.004,i);
  const mk=(f,extra)=>Array.from({length:n},(_,i)=>{const c=f(i);return Object.assign({date:day(i),open:c*.995,high:c*1.01,low:c*.99,close:c,volume:1000},extra?extra(i,c):{});});
  // surge: last bar +25%
  const surge=mk(rise);const p=surge[n-2].close;surge[n-1]=Object.assign({},surge[n-1],{open:p*1.01,high:p*1.26,low:p*1.0,close:p*1.25});
  let e=AW.edgeSignalsOf(surge,{});
  assert.strictEqual(e.surgeNextDay,true);assert.strictEqual(e.gapVolumeClose,false,'no gap/volume');
  assert.strictEqual(e.rsHigh60,null,'no index = unknown, not pass/fail');
  // gap above prior high, 6x volume, +15% close in an uptrend
  const gap=mk(rise);const q=gap[n-2];gap[n-1]=Object.assign({},gap[n-1],{open:q.high*1.03,high:q.close*1.18,low:q.high*1.02,close:q.close*1.15,volume:q.volume*6});
  e=AW.edgeSignalsOf(gap,{});assert.strictEqual(e.gapVolumeClose,true);
  const weak=gap.map(b=>({...b}));weak[n-1].volume=q.volume*3;assert.strictEqual(AW.edgeSignalsOf(weak,{}).gapVolumeClose,false,'volume under 5x');
  const limit=gap.map(b=>({...b}));limit[n-1]=Object.assign({},limit[n-1],{high:q.close*1.3,close:q.close*1.3});
  assert.strictEqual(AW.edgeSignalsOf(limit,{}).gapVolumeClose,false,'limit-up close is not fillable');
  const down=mk(i=>300-i);const r=down[n-2];down[n-1]=Object.assign({},down[n-1],{open:r.high*1.03,high:r.close*1.18,low:r.high*1.02,close:r.close*1.15,volume:r.volume*6});
  assert.strictEqual(AW.edgeSignalsOf(down,{}).gapVolumeClose,false,'needs a prior uptrend');
  // ratio-line 60-day high vs both indices + residual momentum
  const wig=i=>1+.01*Math.sin(i*1.7);
  const idx=Array.from({length:n},(_,i)=>({date:day(i),close:1000*wig(i)}));
  const lead=mk(i=>100*wig(i)*Math.pow(1.003,i));
  e=AW.edgeSignalsOf(lead,{KOSPI:idx,KOSDAQ:idx});
  assert.strictEqual(e.rsHigh60,true);assert.ok(Number.isFinite(e.resmom20) && e.resmom20>0);
  const lag=mk(i=>100*wig(i)*Math.pow(.998,i));
  assert.strictEqual(AW.edgeSignalsOf(lag,{KOSPI:idx,KOSDAQ:idx}).rsHigh60,false);
  assert.strictEqual(AW.edgeSignalsOf(lead,{KOSPI:idx.slice(0,-1),KOSDAQ:idx}).rsHigh60,null,'stale index is unknown');
  const before=JSON.stringify(lead);AW.edgeSignalsOf(lead,{KOSPI:idx,KOSDAQ:idx});assert.strictEqual(JSON.stringify(lead),before);
  // worker: tag-only row appears in the menu (edge first), counts reported, observation only
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'shape-edge-test-')),f=path.join(tmp,'in.jsonl');
  try{
    fs.writeFileSync(f,JSON.stringify({code:'777770',name:'급등',daily:surge,financialScreen:{passed:false}})+'\n'+
      JSON.stringify({code:'888880',name:'갭',daily:gap,financialScreen:{passed:false}})+'\n');
    const out=JSON.parse(cp.execFileSync(process.execPath,['scripts/cloud-vm/shape_scan.js',f],{encoding:'utf8'}));
    const tb=out.research.trendBreakout.find(x=>x.code==='777770'),lf=out.research.liveFlow.find(x=>x.code==='888880');
    assert.ok(tb && tb.patternDetail.edgeSignals.some(t=>t.key==='surgeNextDay'));
    assert.ok(lf && lf.patternDetail.edgeSignals.some(t=>t.key==='gapVolumeClose'));
    assert.ok(!out.groups.trendBreakout.some(x=>x.code==='777770'),'research tag cannot create a primary candidate');
    assert.strictEqual(tb.patternDetail.listKind,'research');
    assert.strictEqual(tb.patternDetail.orderAuthorized,false);assert.strictEqual(tb.patternDetail.observationOnly,true);
    assert.strictEqual(out.edgeSignals.counts.surgeNextDay,1);assert.strictEqual(out.edgeSignals.resmomCut,null,'too few stocks for a cross-sectional cut');
    // web: tag rendered, label/history key mapped
    const html=api.shapeHtml(Object.assign({},tb,{chartShape:tb.patternDetail.shape}));
    assert.ok(html.indexOf('ps-edge-tag')>0 && html.indexOf('주문 신호 아님')>0);
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
  console.log('edge-v1: surge/gap-volume/limit-up/uptrend rules, ratio-line high + residual momentum, missing index unknown, worker tagging/sorting, web tag OK');
}

// First cross vs extension; a larger candle cannot earn entry to the basic list.
{
 const fs=require('fs'),os=require('os'),cp=require('child_process'),path=require('path');
 const f=path.join(os.tmpdir(),'shape-position-'+process.pid+'.jsonl');
 const ext=input.map(b=>({...b}));ext.at(-1).close=150;ext.at(-1).high=151;
 fs.writeFileSync(f,JSON.stringify({code:'123450',name:'확장',daily:ext,financialScreen:{passed:false}})+'\n');
 try{const o=JSON.parse(cp.execFileSync(process.execPath,['scripts/cloud-vm/shape_scan.js',f]));
  assert.ok(o.extended.pullbackRebreak.length,'a distant first cross is retained separately');
  assert.strictEqual(o.groups.pullbackRebreak.length,0,'extended setup is absent from primary');
 }finally{fs.unlinkSync(f);}
 const old=input.map(b=>({...b}));old[old.length-3].close=150;old[old.length-3].high=151;
 assert.ok(AW.selectShapesOf(old).pullbackRebreak.every(d=>d.stage!=='trigger'),'a completed recovery followed by a retreat is not a new first recovery');
 const details=selected.pullbackRebreak[0];
 const contextual=AW.relativeContextOf(input,{KOSPI:input.map(b=>({date:b.date,close:100})),KOSDAQ:input.map(b=>({date:b.date,close:100}))},details);
 assert.strictEqual(contextual.status,'ok');
 assert.strictEqual(contextual.from,input[details.origin.riseEnd].date);
 const current={...selected.pullbackRebreak[0],listKind:'primary'};
 const research={...current,listKind:'research',edgeOnly:true,status:'EDGE_OBSERVE'};
 const extended={...current,listKind:'extended',stage:'extended',status:'SHAPE_EXTENDED'};
 const merged=api.mergeScannerRows([{key:'shape:pullbackRebreak',items:[current,research,extended].map(patternDetail=>({code:'123450',patternDetail}))}]);
 const model=api.publicModel(merged,{},Date.now());
 assert.strictEqual(model.counts.observation,1);assert.strictEqual(model.counts.research,1);assert.strictEqual(model.counts.extended,1);
 assert.ok(api.shapeHtml({patternDetail:current}).includes('미확인:'));
 assert.ok(api.shapeHtml({patternDetail:current}).includes('거래량'));
}
console.log('chart-first-v2: preparation, first-cross exclusion, extension separation, advisory RS, research separation and explanations OK');
{
 const anchors=[[0,150],[80,130],[100,100],[120,120],[145,102],[160,118],[175,108],[185,117]],values=[];
 for(let j=1;j<anchors.length;j++)for(let i=0;i<anchors[j][0]-anchors[j-1][0];i++)values.push(anchors[j-1][1]+(anchors[j][1]-anchors[j-1][1])*i/(anchors[j][0]-anchors[j-1][0]));
 values.push(117);const base=bars(values);
 assert.strictEqual(AW.selectShapesOf(base).trendBreakout[0].stage,'prepare');
 const crossing=base.map(b=>({...b}));Object.assign(crossing.at(-1),{open:117.8,close:118,high:118.8});
 assert.strictEqual(AW.selectShapesOf(crossing).trendBreakout[0].stage,'trigger');
 const neckline=base.map(b=>({...b}));Object.assign(neckline.at(-1),{open:119.8,close:120,high:120.8});
 assert.strictEqual(AW.selectShapesOf(neckline).bottomFormation[0].stage,'trigger','a higher repeated low requires neckline recovery in a broad decline');
}
