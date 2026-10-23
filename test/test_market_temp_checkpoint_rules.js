// 체크포인트 '지금 할 것 / 하지 말아야 할 것' 규칙 시나리오(2026-10-23). 값이 없으면 항목을 빼고 지어내지 않는다.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('js/market-temp.js','utf8').replace('global.MarketTemp = MarketTemp;','global.MarketTemp = MarketTemp; global.t={checkpointFacts_};');
const sb={window:{},document:{readyState:'loading',addEventListener(){}},console,setTimeout,clearTimeout,fetch:async()=>({ok:true,json:async()=>({data:{}})}),Date:class extends Date{static now(){return Date.UTC(2026,9,23,0,0);}}};
vm.runInNewContext(src,sb);const f=sb.window.t.checkpointFacts_;
const actor=(id,v)=>({id,label:{foreign:'외국인',institution:'기관',individual:'개인'}[id],detail:'코스피·코스닥 일별 순매수',points:[{date:'2026-10-22',score:v}]});
const vol=(v,intraday=false)=>({id:'kospi-volume',label:'코스피 거래량',value:v,valueText:v+'%',date:'2026-10-22',statusText:v<80?'낮음':v>=180?'극도로 높음':'평소 수준',intraday});
const fx=d=>({id:'fx',value:1330,valueText:'1,330.0원',delta:d,changeText:d+'원',date:'2026-10-22'});
const row=(symbol,a,b)=>({symbol,chart:[{date:'20261021',close:b},{date:'20261022',close:a}]});
const macro=(vix,nq,sox)=>[row('VIX',vix[0],vix[1]),row('NASDAQ_INDEX',nq[0],nq[1]),row('SOX',sox[0],sox[1])];
const data=(up,down)=>({updatedAt:'2026-10-23 06:00:00',marketBreadth:{total:{up,down,flat:10,total:up+down+10}}});
const sell=[actor('foreign',-10e8),actor('institution',-20e8),actor('individual',30e8)];
const buy=[actor('foreign',10e8),actor('institution',20e8),actor('individual',-30e8)];
const mixed=[actor('foreign',10e8),actor('institution',-20e8),actor('individual',5e8)];
const cases=[
 ['약세',f(data(400,2100),[...sell,vol(70),fx(8)],macro([20,16],[28800,29700],[10500,11500]))],
 ['강세',f(data(2000,400),[...buy,vol(110),fx(-6)],macro([15,16],[30300,29700],[11800,11500]))],
 ['혼조',f(data(1200,1200),[...mixed,vol(100),fx(1)],macro([16,16],[29700,29650],[11500,11490]))],
 ['거래량 급증',f(data(2000,400),[...buy,vol(200)],[])],
 ['데이터 일부 없음',f(data(400,2100),[vol(70)],null)],
];
const [bear,bull,mix,surge,part]=cases.map(c=>c[1]);
assert(bear.avoid[0].includes('하락 속 거래량이 낮은 날'));assert(bear.avoid.some(s=>s.includes('환율이 크게')));assert(bear.avoid.some(s=>s.includes('공포지수')));
assert(bear.items.some(i=>i.label.includes('미국')) && bear.items.length===4 && bear.avoid.length<=4);
assert(bull.avoid.every(s=>!s.includes('공포지수')) && bull.items.length>=3);
assert(mix.avoid.length>=1 && mix.items.every(i=>i.evidence));
assert(surge.avoid.some(s=>s.includes('거래량이 급증')) && !surge.items.some(i=>i.label.includes('미국')));
assert(!part.items.some(i=>i.label.includes('환율')||i.label.includes('미국')) && part.items.length>=1 && part.avoid.length>=1);
assert.deepEqual(part.avoid, part.avoid.filter((t,i)=>part.avoid.indexOf(t)===i));
[...cases.map(c=>c[1].items.concat(c[1].avoid.map(a=>({label:a,evidence:'',check:''})))).flat()].forEach(x=>assert(!/(사세요|파세요|매수하세요|매도하세요)/.test(JSON.stringify(x)),'매매 지시 문구 금지'));
console.log('scenario | 지금 할 것(항목) | 하지 말아야 할 것');
cases.forEach(([n,r])=>console.log(n+' | '+r.items.map(i=>i.label).join(' / ')+' | '+r.avoid.join(' / ')));
