'use strict';
// One bounded Node worker per existing daily scan; shared browser engine, no provider calls.
// argv[2]: stock JSONL, argv[3] (optional): {KOSPI:[{date,close}], KOSDAQ:[...]} stored index closes.
const fs=require('node:fs'),readline=require('node:readline');
const AW=require('../../js/auto-wave.js');
const LIMIT=60;
// High-basis research tags (2026-11-08). Shown inside existing menus; observation only.
const EDGE={
 surgeNextDay:{group:'trendBreakout',label:'급등 다음날 시가 관찰',horizon:'1~5거래일',
   note:'당일 +20% 이상 마감 · 다음 거래일 시가 기준 고점 관찰'},
 gapVolumeClose:{group:'liveFlow',label:'갭·거래량 5배·강마감',horizon:'1~5거래일',
   note:'전일 고가 위 갭(+2%+) · 우상향 · 거래량 전일 5배 이상 · +10~29% 마감'},
 rsHighResidual:{group:'pullbackRebreak',label:'2~3주 내 갈 길',horizon:'10~15거래일',
   note:'두 지수 대비 비율선 60일 신고가 · 지수 영향 뺀 20일 잔차 모멘텀 상위 40%'}
};
const RESMOM_TOP=.4;
(async()=>{
 const keys=['liveFlow','trendBreakout','bottomFormation','pullbackRebreak','longTermQuality'];
 const groups={},observed={},filteredOut={};
 for(const key of keys){groups[key]=[];observed[key]=[];filteredOut[key]=0;}
 let benchmarks=null;
 try{benchmarks=process.argv[3]?JSON.parse(fs.readFileSync(process.argv[3],'utf8')):null;}catch(_){benchmarks=null;}
 if(benchmarks && !Object.keys(benchmarks).length)benchmarks=null;
 let rsMissing=0,rsChecked=0;
 const edgeCounts={surgeNextDay:0,gapVolumeClose:0,rsHighResidual:0},resmoms=[],swing=[];
 // Public observation list bound, never a signal/order gate. Research tags sort first.
 const keep=(list,row)=>{list.push(row);list.sort((a,b)=>(b.edgeRank||0)-(a.edgeRank||0) || b.score-a.score || a.code.localeCompare(b.code));if(list.length>LIMIT)list.length=LIMIT;};
 const tag=key=>Object.assign({key},EDGE[key]);
 const edgeRow=(stock,daily,key,rs)=>{
   const last=daily[daily.length-1],previous=daily[daily.length-2],shape=AW.shapeOf(daily.slice(-40)),info=EDGE[key];
   const detail={status:'EDGE_OBSERVE',shapeLabel:info.label,shape,observationOnly:true,orderAuthorized:false,
     selectionVersion:'shape-selection-v1',windowBars:40,edgeOnly:true,edgeSignals:[tag(key)],
     signal:{date:last.date,price:last.close},score:shape.score,reasons:[info.note],
     interpretation:info.label+' · 고점 기준 연구 관찰(주문 신호 아님)',relativeStrength:rs};
   return {code:stock.code,name:stock.name,price:last.close,changeRate:(last.close/previous.close-1)*100,date:last.date,
     score:shape.score,edgeRank:1,reasons:[info.note],interpretation:detail.interpretation,patternDetail:detail,
     miniChart:daily.slice(-20).map(b=>({date:b.date,close:b.close}))};
 };
 const input=readline.createInterface({input:fs.createReadStream(process.argv[2]),crlfDelay:Infinity});
 for await(const line of input){
   if(!line.trim())continue;
   const stock=JSON.parse(line), daily=stock.daily;
   const selected=AW.selectShapesOf(daily),last=daily[daily.length-1],previous=daily[daily.length-2];
   const edge=AW.edgeSignalsOf(daily,benchmarks || {});
   const want={};
   if(edge.surgeNextDay)want.trendBreakout='surgeNextDay';
   if(edge.gapVolumeClose)want.liveFlow='gapVolumeClose';
   if(Number.isFinite(edge.resmom20))resmoms.push(edge.resmom20);
   let rs=null;
   const getRs=()=>{if(!rs){rs=benchmarks?AW.relativeStrengthOf(daily,benchmarks):{status:'missing',vs:{}};rsChecked++;if(rs.status!=='ok')rsMissing++;}return rs;};
   for(const key of keys){
     for(const detail of selected[key] || []){
       if(key==='longTermQuality' && !(stock.financialScreen && stock.financialScreen.passed===true))continue;
       const myWay=AW.myWayOf(getRs(),key);
       const edgeKey=want[key];
       const row={code:stock.code,name:stock.name,price:last.close,
         changeRate:(last.close/previous.close-1)*100,date:last.date,score:detail.score,edgeRank:edgeKey?1:0,
         reasons:detail.reasons.concat(myWay.reasons || []),interpretation:detail.interpretation,
         patternDetail:Object.assign({},detail,{relativeStrength:rs,myWay:myWay},edgeKey?{edgeSignals:[tag(edgeKey)]}:{}),
         financialScreen:key==='longTermQuality'?stock.financialScreen:undefined,
         longTermLiquidity:key==='longTermQuality'?stock.longTermLiquidity:undefined,
         miniChart:daily.slice(-20).map(b=>({date:b.date,close:b.close}))};
       if(edgeKey){edgeCounts[edgeKey]++;delete want[key];}
       keep(observed[key],row);
       // Unknown relative strength is shown unfiltered (flagged), never treated as a pass or fail.
       // A research-tagged row stays visible: the tag was measured without the my-way filter.
       if(myWay.pass===false && !edgeKey){filteredOut[key]++;continue;}
       keep(groups[key],row);
     }
   }
   for(const key of Object.keys(want)){
     const row=edgeRow(stock,daily,want[key],getRs());
     edgeCounts[want[key]]++;keep(observed[key],row);keep(groups[key],row);
   }
   if(edge.rsHigh60===true && Number.isFinite(edge.resmom20))swing.push({stock,daily,value:edge.resmom20,rs:getRs()});
 }
 // Cross-sectional cut: residual momentum in the top 40% of every checked stock today.
 const sorted=resmoms.slice().sort((a,b)=>a-b);
 const cut=sorted.length>=50?sorted[Math.floor(sorted.length*(1-RESMOM_TOP))]:null;
 if(cut!=null)for(const s of swing){
   if(s.value<cut)continue;
   const key=EDGE.rsHighResidual.group;
   const existing=groups[key].concat(observed[key]).filter(r=>r.code===s.stock.code);
   edgeCounts.rsHighResidual++;
   if(existing.length){
     existing.forEach(r=>{if(!(r.patternDetail.edgeSignals || []).some(t=>t.key==='rsHighResidual')){
       r.patternDetail.edgeSignals=(r.patternDetail.edgeSignals || []).concat(tag('rsHighResidual'));r.edgeRank=(r.edgeRank||0)+1;}});
     if(!groups[key].some(r=>r.code===s.stock.code))keep(groups[key],existing[0]);
     continue;
   }
   const row=edgeRow(s.stock,s.daily,'rsHighResidual',s.rs);
   row.patternDetail.residualMomentum20=s.value;
   keep(observed[key],row);keep(groups[key],row);
 }
 for(const key of keys)for(const list of [groups[key],observed[key]])list.sort((a,b)=>(b.edgeRank||0)-(a.edgeRank||0) || b.score-a.score || a.code.localeCompare(b.code));
 const status=!benchmarks?'missing':rsMissing&&rsMissing===rsChecked?'missing':rsMissing?'partial':'ok';
 process.stdout.write(JSON.stringify({groups,observed,relativeStrength:{version:'my-way-v1',status,basis:'KOSPI+KOSDAQ',
   checked:rsChecked,missing:rsMissing,filteredOut},
   edgeSignals:{version:'edge-v1',counts:edgeCounts,resmomCut:cut,resmomChecked:resmoms.length,
     benchmarks:benchmarks?'ok':'missing'}}));
})().catch(()=>{process.stderr.write('shape worker failed\n');process.exitCode=1;});
