
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

const shortBars=sample(60,i=>100+i);
assert.strictEqual(W.trendLinesOf(shortBars,[{kind:'up',start:0,end:10,confirmed:true}],[]).lines.length,0,'short trends excluded regardless of zoom');
function current(n=50) {return {kind:'up',start:0,end:n-1,confirmed:false};}
const ongoing=sample(50,i=>100+i);
const active=W.trendLinesOf(ongoing,[current()],[]).lines;
assert.strictEqual(active.length,2);
active.forEach(t=>{assert.strictEqual(t.active,true);assert.strictEqual(t.projectionEnd,54);assert.strictEqual(t.fitEnd,47);});
const exited=ongoing.map(b=>({...b}));
[48,49].forEach(i=>Object.assign(exited[i],{open:100,high:102,low:98,close:100}));
const broken=W.trendLinesOf(exited,[current()],[]).lines;
assert.ok(broken.length===2 && broken.every(t=>!t.active&&t.breakIndex===49&&!t.projectionEnd),'two-close break disables both projected rails');
assert.ok(W.trendLinesOf(shortBars,[{kind:'up',start:0,end:39,confirmed:true}],[]).lines.every(t=>!t.active&&!t.projectionEnd),'completed history never projects');
const strokes=[];let currentPath=[],dash=[];
const ctx=new Proxy({measureText:s=>({width:s.length*5}),setLineDash:d=>{dash=d;},
 beginPath:()=>{currentPath=[];},moveTo:(x,y)=>currentPath.push([x,y]),
 lineTo:(x,y)=>currentPath.push([x,y]),stroke(){strokes.push({color:this.strokeStyle,dash:dash.slice(),path:currentPath.slice()});}},
 {get:(o,k)=>k in o?o[k]:()=>{}});
function renderTrend(input,kind) {
 const w={kind,start:0,end:input.length-1,confirmed:false};
 W.drawWaves(ctx,{bars:input,width:800,height:600,coord:({time,price})=>({x:Number(time.slice(1))*10,y:500-price}),
 chart:{timeScale:()=>({logicalToCoordinate:i=>i*10})}},{waves:[],trendWaves:[w],lower:[],trend:true},'sans-serif');
}
renderTrend(ongoing,'up');
assert.ok(strokes.some(s=>s.color==='#d62524'&&s.dash.join(',')==='5,4'&&s.path[1][0]===540),'red extension reaches exactly five future logical bars');
renderTrend(sample(50,i=>200-i),'down');
assert.ok(strokes.some(s=>s.color==='#1558c9'&&s.dash.join(',')==='5,4'&&s.path[1][0]===540),'blue falling extension');
assert.strictEqual(ongoing.length,50,'projection adds no synthetic candles');
console.log('short exclusion, active five-bar projection, red/blue rendering, frozen fit and two-close exit OK');
