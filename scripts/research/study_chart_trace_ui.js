/* Offline UI evidence audit. Uses cached OHLCV only; never broker/trading code. */
const fs=require('fs'),path=require('path'),core=require('../../js/chart-core.js');
const dir=process.argv[2],output=process.argv[3];
if(!dir||!output)throw Error('usage: node study_chart_trace_ui.js CACHE_DIR OUTPUT_JSON');
const groups={},freq={},cooldown=20;
function add(key,bars,i,avg){
 const date=bars[i].date,split=date<'2024-01-01'?'train':'validation';
 for(const h of [20,60]){
  if(i+ h>=bars.length||!bars[i+1]||!(bars[i+1].open>0))continue;
  if(split==='train'&&bars[i+h].date>='2024-01-01')continue; // Purge boundary-crossing outcomes.
  const start=bars[i+1].open,tail=bars.slice(i+1,i+h+1);
  if(tail.some(b=>![b.open,b.high,b.low,b.close].every(x=>Number.isFinite(x)&&x>0)))continue;
  const id=[split,key,h].join('|'),r=groups[id]||(groups[id]={returns:[],mae:[],mfe:[],amount:[],avgAmount:[],years:{}});
  r.returns.push((bars[i+h].close/start-1)*100-.5);
  r.mae.push((Math.min(...tail.map(b=>b.low))/start-1)*100);
  r.mfe.push((Math.max(...tail.map(b=>b.high))/start-1)*100);
  r.amount.push(bars[i].close*bars[i].volume/1e8);r.avgAmount.push(avg/1e8);
  r.years[date.slice(0,4)]=(r.years[date.slice(0,4)]||0)+1;
 }
}
const files=fs.readdirSync(dir).filter(f=>/^\d{6}\.json$/.test(f));let days=0,stocks=0;
for(const file of files){
 const raw=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
 const bars=raw.map(r=>Array.isArray(r)?{date:r[0],open:r[1],high:r[2],low:r[3],close:r[4],volume:r[5]}:r);
 if(bars.length<21)continue;
 const hits=core.supplyTraceBars(bars),map=new Map(hits.map(h=>[h.index,h]));
 const last={},sum=[];let value=0;
 for(let i=0;i<bars.length;i++){
  const b=bars[i],avg=i>=20?value/20:0;
  const amount=b.close*b.volume;sum.push(amount);value+=amount;if(i>=20)value-=sum[i-20];
  if(i<20||b.date<'2020-01-01'||b.date>'2026-10-16')continue;
  days++;const h=map.get(i);const liquid=avg>=3e9&&amount>=3e9;
  const keys=[];
  if(i%20===0)keys.push('baseline');
  if(liquid&&i%20===0)keys.push('liquid_baseline');
  if(h){
   if(h.volumeSurge)keys.push('raw_volume');
   if(h.longMA.some(m=>m.action==='접근'))keys.push('raw_approach');
   if(h.longMA.some(m=>m.action!=='접근'))keys.push('raw_cross');
   if(h.recoveries.length)keys.push('raw_recovery');
   if(liquid&&h.recoveries.length)keys.push('qualified_recovery');
   if(liquid&&h.volumeSurge&&h.longMA.some(m=>m.action!=='접근'))keys.push('qualified_cross');
   if(liquid&&h.volumeSurge&&(b.close/b.open-1)>=.02&&(b.high>b.low)&&(b.close-b.low)/(b.high-b.low)>=.6)keys.push('qualified_volume');
  }
  for(const key of keys){
   freq[key]=(freq[key]||0)+1;
   if(last[key]!==undefined&&i-last[key]<cooldown)continue;
   last[key]=i;add(key,bars,i,avg);
  }
 }
 stocks++;if(stocks%500===0)console.log('processed',stocks);
}
function stats(a){if(!a.length)return null;const sorted=[...a].sort((a,b)=>a-b);return {mean:a.reduce((a,b)=>a+b,0)/a.length,median:sorted[Math.floor(a.length/2)],p10:sorted[Math.floor(a.length*.1)]};}
const results={};for(const [key,r] of Object.entries(groups))results[key]={n:r.returns.length,net:stats(r.returns),mae:stats(r.mae),mfe:stats(r.mfe),win:r.returns.filter(x=>x>0).length/r.returns.length,amountEok:stats(r.amount),priorAvgAmountEok:stats(r.avgAmount),years:r.years};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({stocks,days,freq,cooldown,entry:'next open',costPct:.5,split:'2020-2023 / 2024-2026-10-16',results,limitations:['Current surviving cached universe; no historical status/cap verification','Same-stock events spaced 20 bars; 60-bar outcomes still overlap','No formal independent stock bootstrap or multiple-testing correction','Liquid baseline not exactly matched on volatility/marketcap; not causal lift']},null,2));
console.log('saved',stocks,days,output);
