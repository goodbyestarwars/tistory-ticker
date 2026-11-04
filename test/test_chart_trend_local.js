
const assert=require('node:assert');
const W=require('../js/chart-wave-overlay.js');
function sample(n, fn) {return Array.from({length:n},(_,i)=>{const c=fn(i);return {date:'d'+i,open:c,high:c+2,low:c-2,close:c,volume:100};});}
const bars=sample(160,i=>i<40?100+i:i<80?140-(i-40):i<120?100:100+(i-120));
const waves=[{kind:'up',start:0,end:39,confirmed:true},{kind:'down',start:40,end:79,confirmed:true},{kind:'side',start:80,end:119,confirmed:true},{kind:'up',start:120,end:159,confirmed:false}];
const r=W.trendLinesOf(bars,waves,[]);
for(const w of waves) {
 const rails=r.lines.filter(t=>t.start===w.start&&t.end===w.end&&t.edge);
 assert.strictEqual(rails.length,2,'both rails for '+w.kind+' '+w.start);
 assert.strictEqual(rails[0].m,rails[1].m,'parallel');
 assert.ok(rails[0].b<rails[1].b);
 rails.forEach(t=>{assert.ok(t.touches.length>=2);if(w.confirmed===false)assert.strictEqual(t.solid,false);});
}
const changed=bars.map(b=>({...b})); changed[150].close=1000;
const earlier=W.trendLinesOf(changed,waves,[]).lines.filter(t=>t.end<120);
assert.deepStrictEqual(earlier,r.lines.filter(t=>t.end<120),'later bars never move completed local lines');
assert.deepStrictEqual(W.trendLinesOf([],[],[]).lines,[]);
const bad=bars.map(b=>({...b}));bad[10].close=NaN;
assert.ok(!W.trendLinesOf(bad,[waves[0]],[]).lines.length,'invalid region is skipped');

const real=JSON.parse(require('fs').readFileSync(__dirname+'/fixtures/chart_core/flow_chart_005930.json')).daily;
const region={kind:'side',start:0,end:real.length-1,confirmed:true};
W.trendLinesOf(real,[region],[]).lines.forEach(t=>assert.ok(Number.isFinite(t.m)&&Number.isFinite(t.b)&&t.end<real.length));
console.log('local multi-wave, parallel channels, sideways, provisional, prefix stability, invalid input, daily fixture OK');
