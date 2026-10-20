const fs=require('fs'),path=require('path'),vm=require('vm'),cp=require('child_process'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../..'),AW=require(path.join(root,'js/auto-wave.js')),core=require(path.join(root,'js/chart-core.js'));
const baseline={};vm.runInNewContext(cp.execFileSync('git',['show','50c3e301:js/auto-wave.js'],{encoding:'utf8',cwd:root}),baseline);
const cache=process.argv[2],output=process.argv[3];
if(!cache || !output)throw new Error('Usage: node scripts/analysis/eval_major_wave_context.js <naver-cache> <output.json>');
let rows=[],prefixes=0;
for(const code of ['005930','000660','035420','005380','051910','068270','035720','086790','011200']){
 const all=JSON.parse(fs.readFileSync(path.join(cache,code+'.json'),'utf8')).map(([date,open,high,low,close,volume])=>({date,open,high,low,close,volume}));
 for(const years of [1,3,5]){
  const end=new Date(all.at(-1).date),from=new Date(end);from.setUTCFullYear(from.getUTCFullYear()-years);
  const bars=all.filter(b=>new Date(b.date)>=from),current=AW.analyze(bars),old=baseline.AutoWave.analyze(bars),before=JSON.stringify(current);
  assert.equal(JSON.stringify(current),JSON.stringify(old));
  const lanes=core.trendRegimes(bars),waves=current.levels.major,delays=waves.filter(w=>w.confirmed).map(w=>w.confirmedIndex-w.end).sort((a,b)=>a-b);
  let disagreement=0,pending=0,long=0;
  for(const w of waves){const c=core.majorWaveContext(lanes,w,w.confirmed?w.confirmedIndex:bars.length-1);if(c.opposed.length)disagreement++;if(c.pending)pending++;if(c.againstLong)long++;}
  for(let i=60;i<bars.length;i+=47){const prefix=bars.slice(0,i+1),p=AW.analyze(prefix),l=core.trendRegimes(prefix);for(const w of p.levels.major){assert.deepEqual(core.majorWaveContext(l,w,i),core.majorWaveContext(lanes,w,i));}prefixes++;}
  assert.equal(JSON.stringify(current),before);
  let overlaps=0;const displayed=waves.filter(w=>!w.suppressed);
  const tuples=displayed.map(w=>JSON.stringify([w.start,w.end,w.high,w.low,w.kind]));assert.equal(new Set(tuples).size,tuples.length,'중복 영역 없음');for(let i=0;i<displayed.length;i++)for(let j=i+1;j<displayed.length;j++)if(Math.min(displayed[i].end,displayed[j].end)>Math.max(displayed[i].start,displayed[j].start))overlaps++;
  rows.push({code,years,bars:bars.length,from:bars[0].date,to:bars.at(-1).date,major:waves.length,displayed:displayed.length,confirmed:delays.length,medianDelay:delays.length?delays[Math.floor(delays.length/2)]:null,existingOverlaps:overlaps,addedOverlaps:0,geometryChanges:0,delayChanges:0,disagreement,pending,againstLong:long});
 }
}
const out={baseline:'50c3e301',combinations:rows.length,prefixes,algorithmChanged:false,rows};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(out,null,2));console.log(JSON.stringify({combinations:rows.length,prefixes,geometryChanges:0,delayChanges:0,addedOverlaps:0,existingOverlaps:rows.reduce((s,r)=>s+r.existingOverlaps,0)}));
