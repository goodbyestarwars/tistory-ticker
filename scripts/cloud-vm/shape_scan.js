'use strict';
// One bounded Node worker per existing daily scan; shared browser engine, no provider calls.
// argv[2]: stock JSONL, argv[3] (optional): {KOSPI:[{date,close}], KOSDAQ:[...]} stored index closes.
const fs=require('node:fs'),readline=require('node:readline');
const AW=require('../../js/auto-wave.js');
const LIMIT=60;
(async()=>{
 const keys=['liveFlow','trendBreakout','bottomFormation','pullbackRebreak','longTermQuality'];
 const groups={},observed={},filteredOut={};
 for(const key of keys){groups[key]=[];observed[key]=[];filteredOut[key]=0;}
 let benchmarks=null;
 try{benchmarks=process.argv[3]?JSON.parse(fs.readFileSync(process.argv[3],'utf8')):null;}catch(_){benchmarks=null;}
 let rsMissing=0,rsChecked=0;
 // Public observation list bound, never a signal/order gate.
 const keep=(list,row)=>{list.push(row);list.sort((a,b)=>b.score-a.score || a.code.localeCompare(b.code));if(list.length>LIMIT)list.length=LIMIT;};
 const input=readline.createInterface({input:fs.createReadStream(process.argv[2]),crlfDelay:Infinity});
 for await(const line of input){
   if(!line.trim())continue;
   const stock=JSON.parse(line), daily=stock.daily;
   const selected=AW.selectShapesOf(daily),last=daily[daily.length-1],previous=daily[daily.length-2];
   let rs=null;
   for(const key of keys)for(const detail of selected[key] || []){
     if(key==='longTermQuality' && !(stock.financialScreen && stock.financialScreen.passed===true))continue;
     if(!rs){rs=benchmarks?AW.relativeStrengthOf(daily,benchmarks):{status:'missing',vs:{}};rsChecked++;if(rs.status!=='ok')rsMissing++;}
     const myWay=AW.myWayOf(rs,key);
     const row={code:stock.code,name:stock.name,price:last.close,
       changeRate:(last.close/previous.close-1)*100,date:last.date,score:detail.score,
       reasons:detail.reasons.concat(myWay.reasons || []),interpretation:detail.interpretation,
       patternDetail:Object.assign({},detail,{relativeStrength:rs,myWay:myWay}),
       financialScreen:key==='longTermQuality'?stock.financialScreen:undefined,
       longTermLiquidity:key==='longTermQuality'?stock.longTermLiquidity:undefined,
       miniChart:daily.slice(-20).map(b=>({date:b.date,close:b.close}))};
     keep(observed[key],row);
     // Unknown relative strength is shown unfiltered (flagged), never treated as a pass or fail.
     if(myWay.pass===false){filteredOut[key]++;continue;}
     keep(groups[key],row);
   }
 }
 const status=!benchmarks?'missing':rsMissing&&rsMissing===rsChecked?'missing':rsMissing?'partial':'ok';
 process.stdout.write(JSON.stringify({groups,observed,relativeStrength:{version:'my-way-v1',status,basis:'KOSPI+KOSDAQ',
   checked:rsChecked,missing:rsMissing,filteredOut}}));
})().catch(()=>{process.stderr.write('shape worker failed\n');process.exitCode=1;});
