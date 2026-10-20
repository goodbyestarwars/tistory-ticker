const assert=require('node:assert/strict'),core=require('../js/chart-core.js');
function bars(n=500){return Array.from({length:n},(_,i)=>({date:new Date(Date.UTC(2021,0,i+1)).toISOString().slice(0,10),open:100+i,high:102+i,low:99+i,close:101+i,volume:100}));}
let b=bars(),r=core.trendRegimes(b);
for(const key of ['short','medium','long'])assert.equal(r[key].at(-1).state,'up');
let down=b.map((x,i)=>({...x,close:1000-i}));
for(const key of ['short','medium','long'])assert.equal(core.trendRegimes(down)[key].at(-1).state,'down');
let flat=b.map(x=>({...x,close:100}));
for(const key of ['short','medium','long'])assert.equal(core.trendRegimes(flat)[key].at(-1).state,'neutral');
let gentle=b.map((x,i)=>({...x,close:1000+i*.001}));
for(const key of ['short','medium','long'])assert.equal(core.trendRegimes(gentle)[key].at(-1).state,'neutral');
assert.equal(r.short[22].state,'unknown');assert.equal(r.short[26].state,'up');
for(let i=0;i<b.length;i+=7){let prefix=core.trendRegimes(b.slice(0,i+1));for(const key of Object.keys(r))assert.deepEqual(prefix[key],r[key].slice(0,i+1));}
let mixed=bars();for(let i=300;i<303;i++)mixed[i].close-=5;
const m=core.trendRegimes(mixed);for(const lane of Object.values(m))for(let i=1;i<lane.length;i++)if(lane[i].state!==lane[i-1].state&&lane[i].state!=='unknown'){assert.equal(lane[i].raw,lane[i-1].raw);assert.equal(lane[i].raw,lane[i-2].raw);}
let invalid=bars();invalid[300].close=null;let inv=core.trendRegimes(invalid);assert.equal(inv.long[300].state,'unknown');assert.equal(inv.long.at(-1).state,'unknown');
const hits=[{index:30,date:b[30].date,volumeSurge:true,longMA:[{action:'돌파'}],recoveries:[{date:b[20].date}]}];
assert.equal(core.supplyDisplayEvents(b,hits,'important').length,0);
const events=core.supplyDisplayEvents(b,hits,'detail');assert.equal(events.length,1);assert.equal(events[0].type,'recovery');
assert.equal(core.supplyDisplayEvents(b,hits.concat(hits),'detail').length,1);
const marks=core.supplyDisplayMarkers(events);assert.equal(marks.length,1);assert.equal(marks[0].text,'');
let dense=Array.from({length:250},(_,i)=>({index:i,date:b[i].date,type:'volume'}));
assert.ok(core.supplyDisplayMarkers(dense,{from:0,to:250},300).length<=20);
assert.ok(core.supplyDisplayMarkers(dense,{from:20,to:40},300).length>core.supplyDisplayMarkers(dense,{from:0,to:250},300).filter(x=>x.time>=b[20].date&&x.time<=b[40].date).length);
assert.ok(core.trendRegimeLegendHtml(r,'week').includes('주봉'));
assert.equal(core.supplyDisplayMarkers(events)[0].text,'');
console.log('PASS regime order+slope+3-bar confirmation, data gaps, prefix invariance, one symbol/day, detail/important, zoom density and timeframe labels');
