'use strict';
// One bounded Node worker per existing daily scan; shared browser engine, no provider calls.
// argv[2]: stock JSONL, argv[3] (optional): {KOSPI:[{date,close}], KOSDAQ:[...]} stored index closes.
// 2026-11-14: quiet-v1 표시·quietLeaderPullback 연구 태그(docs/EDGE_FACTOR_STUDY_2026-11-13.md). 이 주석 갱신 배포로 장외 모양 선정 재계산을 다시 실행한다(deploy_check.sh).
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
   note:'두 지수 대비 비율선 60일 신고가 · 지수 영향 뺀 20일 잔차 모멘텀 상위 40%'},
 // 2026-11-14 docs/EDGE_FACTOR_STUDY_2026-11-13.md: 대형 주도 + 120봉 상승 뒤 눌림 + 조용함.
 quietLeaderPullback:{group:'pullbackRebreak',label:'주도주 조용한 눌림',horizon:'최대 60거래일',
   note:'거래대금 상위 15% · 120봉 상승 뒤 눌림/반등 · 조용함 상위 30%(낮은 고유 변동성·상승일 거래량 쏠림 없음)'}
};
// Exit plan shown with the research tag (backtest 2024~2025: 10번 중 5~6번 이익, 이익 평균 +17%, 손실 평균 -9%).
const EXIT_PLAN={version:'exit-v1',stopLossPct:-10,takeProfit:'+10% 도달 뒤 종가가 20일선 아래면 다음 거래일 시가 매도',
  maxHoldDays:60,marketRest:'KOSPI 종가가 60일선 아래면 신규 매수 쉬기',observationOnly:true};
const QUIET={top:.7,noisy:.3,leader:.85};
const pctRank=values=>{const idx=values.map((v,i)=>[v,i]).filter(x=>Number.isFinite(x[0])).sort((a,b)=>a[0]-b[0]);
  const out=new Array(values.length).fill(null);idx.forEach((x,k)=>{out[x[1]]=(k+1)/idx.length;});return out;};
const RESMOM_TOP=.4;
(async()=>{
 const keys=['liveFlow','trendBreakout','bottomFormation','pullbackRebreak','longTermQuality'];
 const groups={},observed={},extended={},research={},filteredOut={};
 for(const key of keys){groups[key]=[];observed[key]=[];extended[key]=[];research[key]=[];filteredOut[key]=0;}
 let benchmarks=null;
 try{benchmarks=process.argv[3]?JSON.parse(fs.readFileSync(process.argv[3],'utf8')):null;}catch(_){benchmarks=null;}
 if(benchmarks && !Object.keys(benchmarks).length)benchmarks=null;
 let rsMissing=0,rsChecked=0;
 const edgeCounts={surgeNextDay:0,gapVolumeClose:0,rsHighResidual:0,quietLeaderPullback:0},resmoms=[],swing=[];
 // Pass 1: same-day universe mean return for the idiosyncratic-volatility input (last 61 sessions).
 const mSum={},mCnt={};
 const pass1=readline.createInterface({input:fs.createReadStream(process.argv[2]),crlfDelay:Infinity});
 for await(const line of pass1){
   if(!line.trim())continue;
   const d=JSON.parse(line).daily || [];
   for(let i=Math.max(1,d.length-61);i<d.length;i++){
     const r=d[i].close/d[i-1].close-1;
     if(Number.isFinite(r) && Math.abs(r)<.31){mSum[d[i].date]=(mSum[d[i].date]||0)+r;mCnt[d[i].date]=(mCnt[d[i].date]||0)+1;}
   }
 }
 const marketReturns={};for(const k of Object.keys(mSum))if(mCnt[k]>=20)marketReturns[k]=mSum[k]/mCnt[k];
 const quietPool=[],pullbackPool=[];
 const kospi=(benchmarks && benchmarks.KOSPI) || [];
 const kospiMa60=kospi.length>=60?kospi.slice(-60).reduce((a,r)=>a+r.close,0)/60:null;
 const marketRest=kospiMa60?kospi[kospi.length-1].close<kospiMa60:null;
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
   const quiet=AW.quietnessOf(daily,marketReturns);
   quietPool.push(Object.assign({code:stock.code},quiet));
   const shape120=daily.length>=120?AW.shapeOf(daily.slice(-120)):null;
   if(shape120 && (shape120.type==='pullback' || shape120.type==='rebound'))
     pullbackPool.push({stock:{code:stock.code,name:stock.name},daily:daily.slice(-40),shape120:shape120.type,rs:getRs()});
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
 // Cross-sectional quietness: score = (1 - ivol60 rank) + (1 - upvol20 rank), re-ranked. Display only.
 const pIvol=pctRank(quietPool.map(q=>q.ivol60)),pUp=pctRank(quietPool.map(q=>q.upvol20)),pAmt=pctRank(quietPool.map(q=>q.amt20));
 const raw=quietPool.map((q,i)=>pIvol[i]==null || pUp[i]==null?null:(1-pIvol[i])+(1-pUp[i]));
 const pScore=pctRank(raw),quietBy={};
 quietPool.forEach((q,i)=>{const sp=pScore[i];quietBy[q.code]={version:'quiet-v1',ivol60:q.ivol60,upvol20:q.upvol20,scorePct:sp,amtPct:pAmt[i],
   band:sp==null?'unknown':sp>QUIET.top?'quiet':sp<=QUIET.noisy?'noisy':'neutral',excludeAdvice:sp!=null && sp<=QUIET.noisy,observationOnly:true};});
 for(const p of pullbackPool){
   const q=quietBy[p.stock.code];
   if(!q || !(q.amtPct>QUIET.leader) || !(q.scorePct>QUIET.top))continue;
   const row=edgeRow(p.stock,p.daily,'quietLeaderPullback',p.rs);
   Object.assign(row.patternDetail,{shape120:p.shape120,exitPlan:Object.assign({},EXIT_PLAN,{marketRestActive:marketRest})});
   edgeCounts.quietLeaderPullback++;keep(research[EDGE.quietLeaderPullback.group],row);
 }
 for(const key of keys)for(const list of [groups[key],observed[key],extended[key],research[key]])
   for(const row of list)row.patternDetail.quiet=quietBy[row.code] || {version:'quiet-v1',band:'unknown',observationOnly:true};
 for(const key of keys)for(const list of [groups[key],observed[key],extended[key],research[key]])list.sort((a,b)=>b.score-a.score || a.code.localeCompare(b.code));
 const status=!benchmarks?'missing':rsMissing&&rsMissing===rsChecked?'missing':rsMissing?'partial':'ok';
 process.stdout.write(JSON.stringify({strategyVersion:'chart-first-v2',groups,observed,extended,research,relativeStrength:{version:'my-way-v1',role:'advisory',status,basis:'KOSPI+KOSDAQ',
   checked:rsChecked,missing:rsMissing,filteredOut},
   edgeSignals:{version:'edge-v1',counts:edgeCounts,resmomCut:cut,resmomChecked:resmoms.length,
     benchmarks:benchmarks?'ok':'missing'},
   quiet:{version:'quiet-v1',role:'advisory',checked:quietPool.length,ranked:raw.filter(v=>v!=null).length,
     noisyCut:QUIET.noisy,quietCut:QUIET.top,marketRest,kospiMa60}}));
})().catch(()=>{process.stderr.write('shape worker failed\n');process.exitCode=1;});
