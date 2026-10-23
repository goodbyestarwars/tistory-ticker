// 수급·심리·금리 카드(표시 전용): 값은 응답 그대로, 강도는 응답 이력 분포(백분위)로, 값이 없으면 '미수신'.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('js/market-temp.js','utf8').replace('global.MarketTemp = MarketTemp;','global.MarketTemp = MarketTemp; global.t={programTradingCard_,optionCard_,rateCard_,extrasBlock_,moneyKr_};');
const sb={window:{},document:{readyState:'loading',addEventListener(){}},console,setTimeout,clearTimeout,fetch:async()=>({ok:true,json:async()=>({})})};
vm.runInNewContext(src,sb);const t=sb.window.t;
const hist=Array.from({length:100},(_,i)=>({date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),arbitrage:0,nonArbitrage:(i%2?1:-1)*(i+1)*10000}));// 절댓값 10000..1000000
const pt=(v,date='2026-10-22')=>({available:true,source:'kis',date,arbitrage:5000,nonArbitrage:v,history:hist});
const now=Date.parse('2026-10-23T09:00:00Z'); // 18:00 KST
assert.equal(t.programTradingCard_(pt(-950000),now).tier,'sellBig');
assert.equal(t.programTradingCard_(pt(700000),now).tier,'buyMild');
assert.equal(t.programTradingCard_(pt(-100000),now).tier,'flat');
assert.equal(t.programTradingCard_({available:false},now),null);
assert.equal(t.programTradingCard_({...pt(-1),history:hist.slice(0,10)},now).tier,null,'이력 60건 미만이면 강도 안 정함');
assert(t.programTradingCard_(pt(-5e5,'2026-10-23'),Date.parse('2026-10-23T05:00:00Z')).time.includes('장중 집계'));
assert(t.programTradingCard_(pt(-672263,'2026-10-22'),now).lines[0][1]==='-6,723억');
assert.equal(t.optionCard_({CALL:{volume:2386,updated_at:'2026-10-23T06:13:00Z'},PUT:{volume:3402,updated_at:'2026-10-23T06:13:00Z'}}).tier,'putHigh');
assert.equal(t.optionCard_({CALL:{volume:3000,updated_at:'2026-10-23T06:13:00Z'},PUT:{volume:1000,updated_at:'2026-10-23T06:13:00Z'}}).tier,'callHigh');
assert.equal(t.optionCard_({CALL:{volume:0},PUT:{volume:5}}),null);
const series=(sym,vals)=>({symbol:sym,stale:false,price:vals[vals.length-1],chart:vals.map((v,i)=>({date:'202610'+String(10+i),close:v}))});
// ── 금리: 수준(최근 위치)·움직임(일 변동 bp)·시장 영향을 따로 본다 ──
const ymd=(d)=>d.toISOString().slice(0,10).replace(/-/g,'');
const dates=(n)=>Array.from({length:n},(_,i)=>ymd(new Date(Date.UTC(2026,9,22)-(n-1-i)*86400000)));// 2026-10-22까지 n일(달력일)
const rs=(sym,vals)=>{const d=dates(vals.length);return {symbol:sym,stale:false,chart:vals.map((v,i)=>({date:d[i],close:v}))}};
const rnow=Date.parse('2026-10-23T09:00:00Z');
const ramp=(from,to,n)=>Array.from({length:n},(_,i)=>+(from+(to-from)*i/(n-1)).toFixed(2));
// 높은 수준(구간 최고 근처)에서 변화가 거의 없음 -> '평화'가 아니라 높은 수준 유지
const noise=(base,n)=>Array.from({length:n},(_,i)=>+(base+0.04*Math.sin(i*1.3)).toFixed(2));
let v10=ramp(4.2,5.13,100).concat([5.13,5.14,5.12,5.13,5.13]);
let v30=ramp(4.6,5.42,100).concat([5.42,5.43,5.41,5.42,5.42]);
let rc=t.rateCard_({US10Y:rs('US10Y',v10),US30Y:rs('US30Y',v30),US2Y:rs('US2Y',ramp(4,4.81,105)),KTB3Y:{symbol:'KTB3Y',stale:false,price:3.84}},rnow);
assert(rc&&rc.tier==='highFlat','높은 수준·안정은 highFlat: '+(rc&&rc.tier));
assert(!/평화|조용|잠잠/.test(rc.say),'높은 금리에 평화 코멘트 금지: '+rc.say);
assert.equal(rc.rows[0].k,'미국 10년');assert.equal(rc.rows[0].v,'5.13%');assert.equal(rc.rows[0].d,'0bp');
assert.equal(rc.rows[1].k,'미국 30년');assert.equal(rc.rows[1].v,'5.42%');
assert(rc.rows[1].sub.includes('30-10년 차 +29bp')&&rc.rows[1].sub.includes('2년 4.81%')&&rc.rows[1].sub.includes('한국 3년 3.84%'),'30-10년 차(bp)·2년·한국 3년: '+rc.rows[1].sub);
assert(rc.time.includes('FRED'),'출처 표시');
// 전일 대비 bp: 10년 5.13 -> 5.21 = +8bp, 급등 판정(최근 일 변동의 상위 10% 이상)
v10=noise(5.0,100).concat([5.13,5.13,5.13,5.13,5.21]);v30=noise(5.3,100).concat([5.42,5.42,5.42,5.42,5.52]);
rc=t.rateCard_({US10Y:rs('US10Y',v10),US30Y:rs('US30Y',v30)},rnow);
assert.equal(rc.rows[0].d,'+8bp');assert.equal(rc.rows[1].d,'+10bp');assert(/Surge$/.test(rc.tier),'급등: '+rc.tier);
assert(rc.state===undefined&&rc.moveWord==='급등');
// 높은 수준에서 급락은 '안전자산 선호 가능성' 쪽, 호재로 단정하지 않는다
v10=noise(5.0,100).concat([5.13,5.13,5.13,5.13,5.01]);v30=noise(5.3,100).concat([5.42,5.42,5.42,5.42,5.28]);
rc=t.rateCard_({US10Y:rs('US10Y',v10),US30Y:rs('US30Y',v30)},rnow);
assert(/Plunge$/.test(rc.tier)&&rc.rows[0].d==='-12bp','급락: '+rc.tier+' '+rc.rows[0].d);
assert(!/호재|긍정|좋/.test(rc.say),'금리 하락을 호재로 단정 금지: '+rc.say);
// 낮은 수준(구간 하단)은 높음으로 보지 않는다(절대 수준만으로 단정하지 않음)
v10=ramp(4.0,3.2,105);v30=ramp(4.4,3.6,105);
rc=t.rateCard_({US10Y:rs('US10Y',v10),US30Y:rs('US30Y',v30)},rnow);
assert(/^low/.test(rc.tier),'낮은 수준: '+rc.tier);
// 기록 부족·묵음·stale은 판단하지 않는다
assert.equal(t.rateCard_({},rnow),null);
assert.equal(t.rateCard_({US10Y:rs('US10Y',[5,5.1,5.2])},rnow),null);
assert.equal(t.rateCard_({US10Y:{...rs('US10Y',v10),stale:true}},rnow),null);
assert.equal(t.rateCard_({US10Y:rs('US10Y',v10),US30Y:rs('US30Y',v30)},Date.parse('2026-12-30T00:00:00Z')),null,'7일 넘게 묵은 값은 미수신');
// 30년물이 없으면 10년만으로 판단하고 30년은 미수신 표시
rc=t.rateCard_({US10Y:rs('US10Y',v10)},rnow);assert(rc.rows[1].miss&&rc.rows[1].v==='미수신');
// ── 프로그램매매 20거래일 누적 ──
assert.equal(t.moneyKr_(-2420000),'-2조 4,200억');assert.equal(t.moneyKr_(-751200),'-7,512억');assert.equal(t.moneyKr_(0),'0억');assert.equal(t.moneyKr_(2000000),'+2조');
const days=(n,fn)=>Array.from({length:n},(_,i)=>{const d=new Date(Date.UTC(2026,8,1)+i*86400000);return {date:d.toISOString().slice(0,10),...fn(i)}}).filter(r=>![0,6].includes(new Date(r.date).getUTCDay()));
const hist2=days(40,(i)=>({arbitrage:i%2?100:-50,nonArbitrage:i%3===0?200000:-300000}));// 임의 일별 값
const last=hist2[hist2.length-1];
const ptc=(over={})=>({available:true,source:'kis',date:last.date,arbitrage:last.arbitrage,nonArbitrage:last.nonArbitrage,history:hist2,...over});
const after=Date.parse(last.date+'T09:00:00Z'); // 18:00 KST = 마감 후 -> 오늘 포함
let pc=t.programTradingCard_(ptc(),after);
const tot=hist2.map(r=>r.arbitrage+r.nonArbitrage).slice(-20);
assert.equal(pc.cum.n,20);assert(pc.cum.complete);
assert.equal(pc.cum.cum20,tot.reduce((a,b)=>a+b,0),'20일 누적 = 최근 20개 실제 거래일 (차익+비차익) 합');
assert.equal(pc.cum.sellDays,tot.filter(v=>v<0).length);assert.equal(pc.cum.buyDays,tot.filter(v=>v>0).length);
assert.equal(pc.cum.cum5,tot.slice(-5).reduce((a,b)=>a+b,0),'5일 누적');
assert.equal(pc.cum.sellDays+pc.cum.buyDays+pc.cum.flatDays,20);
// 0인 날은 중립으로 따로 센다
const zero=hist2.map((r,i)=>i===hist2.length-3?{date:r.date,arbitrage:0,nonArbitrage:0}:r);
pc=t.programTradingCard_(ptc({history:zero}),after);assert.equal(pc.cum.flatDays,1);
// 중복 일자는 한 번만, 20일 미만이면 집계 중
const few=hist2.slice(-12);
pc=t.programTradingCard_(ptc({history:few.concat(few.slice(-3))}),after);assert.equal(pc.cum.n,12);assert(!pc.cum.complete);
let hb=t.extrasBlock_({programTrading:ptc({history:few})},[],null,after);
assert(hb.includes('집계 중 (12/20일)')&&!hb.includes('20일 누적'),'20일 미만이면 집계 중 표시, 누적 금액 없음');
// 장중 잠정치(15:40 전 오늘 값)는 누적에서 제외
const live=Date.parse(last.date+'T03:00:00Z'); // 12:00 KST
pc=t.programTradingCard_(ptc(),live);assert(pc.live);
assert.equal(pc.cum.cum20,hist2.slice(0,-1).map(r=>r.arbitrage+r.nonArbitrage).slice(-20).reduce((a,b)=>a+b,0),'장중에는 오늘(잠정)을 뺀 확정 20일');
// 카드 문구: 누적·일수·오늘·차익/비차익
hb=t.extrasBlock_({programTrading:ptc()},[],null,after);
assert(hb.includes('20일 누적')&&hb.includes('순매도 ')&&hb.includes('오늘')&&hb.includes('차익 ')&&hb.includes('비차익 '),'카드에 누적·일수·오늘·차익·비차익');
assert(hb.includes('집계 중')===false);
const html=t.extrasBlock_({programTrading:pt(-950000)},[],{CALL:{volume:1,updated_at:'2026-10-23T06:13:00Z'},PUT:{volume:2,updated_at:'2026-10-23T06:13:00Z'}},now);
assert(html.includes('수급·심리·금리')&&html.includes('data-market-metric="x-prog"')&&html.includes('data-market-metric="x-rate"')&&html.includes('미수신'),'금리 카드는 응답 없으면 미수신');
const sel=t.extrasBlock_({programTrading:pt(-950000)},[],null,now,'x-prog');assert(sel.includes('mt-xcard is-selected')&&sel.includes('data-market-metric="x-prog"'),'프로그램매매 카드는 누르면 최근 시장 흐름으로');
console.log('extras ok');
