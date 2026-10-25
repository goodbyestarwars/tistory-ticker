
require('./helpers/common_runtime');
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
let src=fs.readFileSync('js/market-temp.js','utf8').replace('global.MarketTemp = MarketTemp;', 'global.MarketTemp = MarketTemp; global.visualTest = {buildFlowChart_,buildBreadthVisual_,buildFlowSnapshot_};');
const sb={window:{},document:{readyState:'loading',addEventListener(){}},console,setTimeout,clearTimeout};
vm.runInNewContext(src,sb);const t=sb.window.visualTest;
for(const scores of [[25],[0,100],[100,0],[10,10,10],[9,9,8,40,10,69,69,20,54,25],[0,29,30,69,70,100,0]]){
 const days=scores.map((score,i)=>({score,date:'2026-10-'+String(i+1).padStart(2,'0')}));
 const html=t.buildFlowChart_(days);
 assert(!/NaN|Infinity/.test(html));
 const points=JSON.parse(html.match(/data-pts="([^"]+)"/)[1].replace(/&quot;/g,'"'));
 const path=html.match(/class="mt-fc-line" d="([^"]+)"/)[1];
 const coords=path.match(/-?\d+(?:\.\d+)?/g).map(Number);
 assert.equal(coords.length,2+6*(scores.length-1));
 assert.equal(coords[0],points[0].x);assert.equal(coords[1],points[0].y);
 for(let i=1;i<scores.length;i++){
  const segment=coords.slice(2+(i-1)*6,2+i*6),lo=Math.min(points[i-1].y,points[i].y),hi=Math.max(points[i-1].y,points[i].y);
  assert.equal(segment[4],points[i].x);assert.equal(segment[5],points[i].y);
  for(const y of [segment[1],segment[3]])assert(y>=lo-.02&&y<=hi+.02,'curve must not invent peaks between observations');
 }
 assert.equal((html.match(/class="mt-fc-dot /g)||[]).length,scores.length);
 assert(html.includes('linearGradient')&&html.includes('mt-fc-halo'));
}
const bar=t.buildBreadthVisual_({breadth:{up:454,down:2100,flat:98,total:2652},wholeMarket:true});
const widths=[...bar.matchAll(/style="width:([0-9.]+)%"/g)].map(m=>Number(m[1]));
assert(Math.abs(widths.reduce((a,b)=>a+b,0)-100)<.01);
assert(bar.includes('454')&&bar.includes('2,100')&&bar.includes('98'));
assert(!t.buildBreadthVisual_({breadth:null}).includes('mt-breadth-track'));
let flow=t.buildFlowSnapshot_({components:{flow:{foreign:{ratio:.1},inst:{ratio:-.1}}}});
assert(flow.includes('is-up')&&flow.includes('is-down')&&flow.includes('최근 5거래일'));
flow=t.buildFlowSnapshot_({components:{flow:{foreign:{ratio:null}}}});
assert.equal((flow.match(/확인 중/g)||[]).length,2);
assert(!flow.includes('순매수')&&!flow.includes('순매도'));
console.log('Market visual: exact points, no curve overshoot, breadth conservation, missing flow ok');
