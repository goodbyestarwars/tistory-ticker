'use strict';
// One bounded Node worker per existing daily scan; shared browser engine, no provider calls.
const fs=require('node:fs'),readline=require('node:readline');
const AW=require('../../js/auto-wave.js');
(async()=>{
 const groups={liveFlow:[],trendBreakout:[],bottomFormation:[],pullbackRebreak:[],longTermQuality:[]};
 const input=readline.createInterface({input:fs.createReadStream(process.argv[2]),crlfDelay:Infinity});
 for await(const line of input){
   if(!line.trim())continue;
   const stock=JSON.parse(line), daily=stock.daily;
   const selected=AW.selectShapesOf(daily),last=daily[daily.length-1],previous=daily[daily.length-2];
   for(const key of Object.keys(groups))for(const detail of selected[key] || []){
     if(key==='longTermQuality' && !(stock.financialScreen && stock.financialScreen.passed===true))continue;
     groups[key].push({code:stock.code,name:stock.name,price:last.close,
       changeRate:(last.close/previous.close-1)*100,date:last.date,score:detail.score,
       reasons:detail.reasons,interpretation:detail.interpretation,patternDetail:detail,
       financialScreen:key==='longTermQuality'?stock.financialScreen:undefined,
       longTermLiquidity:key==='longTermQuality'?stock.longTermLiquidity:undefined,
       miniChart:daily.slice(-20).map(b=>({date:b.date,close:b.close}))});
     groups[key].sort((a,b)=>b.score-a.score || a.code.localeCompare(b.code));
     // Public observation list bound, never a signal/order gate.
     if(groups[key].length>60)groups[key].length=60;
   }
 }
 process.stdout.write(JSON.stringify(groups));
})().catch(()=>{process.stderr.write('shape worker failed\n');process.exitCode=1;});
