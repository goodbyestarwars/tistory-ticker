'use strict';
// One bounded Node worker per existing daily scan; shared browser engine, no provider calls.
// argv[2]: stock JSONL, argv[3] (optional): {KOSPI:[{date,close}], KOSDAQ:[...]} stored index closes.
const fs=require('node:fs'),readline=require('node:readline');
const AW=require('../../js/auto-wave.js');
const LIMIT=60;
// High-basis research tags (2026-11-08). Kept in a separate research bucket; observation only.
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
 const groups={},observed={},extended={},research={},filteredOut={};
 for(const key of keys){groups[key]=[];observed[key]=[];extended[key]=[];research[key]=[];filteredOut[key]=0;}
 let benchmarks=null;
 try{benchmarks=process.argv[3]?JSON.parse(fs.readFileSync(process.argv[3],'utf8')):null;}catch(_){benchmarks=null;}
 if(benchmarks && !Object.keys(benchmarks).length)benchmarks=null;
 let rsMissing=0,rsChecked=0;
 const edgeCounts={surgeNextDay:0,gapVolumeClose:0,rsHighResidual:0},resmoms=[],swing=[];
 // Bound each display bucket independently. Geometry ranks first; research never promotes it.
 const keep=(list,row)=>{list.push(row);list.sort((a,b)=>b.score-a.score || a.code.localeCompare(b.code));if(list.length>LIMIT)list.length=LIMIT;};
 const tag=key=>Object.assign({key},EDGE[key]);
 const edgeRow=(stock,daily,key,rs)=>{
   const last=daily[daily.length-1],previous=daily[daily.length-2],shape=AW.shapeOf(daily.slice(-40)),info=EDGE[key];
   const detail={status:'EDGE_OBSERVE',shapeLabel:info.label,shape,observationOnly:true,orderAuthorized:false,
     selectionVersion:'shape-selection-v1',strategyVersion:'chart-first-v2',listKind:'research',windowBars:40,edgeOnly:true,edgeSignals:[tag(key)],
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
       const row={code:stock.code,name:stock.name,price:last.close,
         changeRate:(last.close/previous.close-1)*100,date:last.date,score:detail.score,edgeRank:0,
         reasons:detail.reasons.concat(['상대강도는 보조 확인'].concat(myWay.reasons || [])),interpretation:detail.interpretation,
         patternDetail:Object.assign({},detail,{relativeStrength:rs,relativeContext:AW.relativeContextOf(daily,benchmarks,detail),myWay:Object.assign({},myWay,{applied:false,advisory:true}),listKind:detail.stage==='extended'?'extended':'primary'}),
         financialScreen:key==='longTermQuality'?stock.financialScreen:undefined,
         longTermLiquidity:key==='longTermQuality'?stock.longTermLiquidity:undefined,
         miniChart:daily.slice(-20).map(b=>({date:b.date,close:b.close}))};
       if(detail.stage==='extended'){keep(extended[key],row);continue;}
       keep(observed[key],row);
       // Relative strength explains the setup; it cannot create or reject a shape.
       keep(groups[key],row);
     }
   }
   for(const key of Object.keys(want)){
     const row=edgeRow(stock,daily,want[key],getRs());
     edgeCounts[want[key]]++;keep(research[key],row);
   }
   if(edge.rsHigh60===true && Number.isFinite(edge.resmom20))swing.push({stock,daily,value:edge.resmom20,rs:getRs()});
 }
 // Cross-sectional cut: residual momentum in the top 40% of every checked stock today.
 const sorted=resmoms.slice().sort((a,b)=>a-b);
 const cut=sorted.length>=50?sorted[Math.floor(sorted.length*(1-RESMOM_TOP))]:null;
 if(cut!=null)for(const s of swing){
   if(s.value<cut)continue;
   const key=EDGE.rsHighResidual.group;
   edgeCounts.rsHighResidual++;
   const row=edgeRow(s.stock,s.daily,'rsHighResidual',s.rs);
   row.patternDetail.residualMomentum20=s.value;
   keep(research[key],row);
 }
 for(const key of keys)for(const list of [groups[key],observed[key],extended[key],research[key]])list.sort((a,b)=>b.score-a.score || a.code.localeCompare(b.code));
 const status=!benchmarks?'missing':rsMissing&&rsMissing===rsChecked?'missing':rsMissing?'partial':'ok';
 process.stdout.write(JSON.stringify({strategyVersion:'chart-first-v2',groups,observed,extended,research,relativeStrength:{version:'my-way-v1',role:'advisory',status,basis:'KOSPI+KOSDAQ',
   checked:rsChecked,missing:rsMissing,filteredOut},
   edgeSignals:{version:'edge-v1',counts:edgeCounts,resmomCut:cut,resmomChecked:resmoms.length,
     benchmarks:benchmarks?'ok':'missing'}}));
})().catch(()=>{process.stderr.write('shape worker failed\n');process.exitCode=1;});
