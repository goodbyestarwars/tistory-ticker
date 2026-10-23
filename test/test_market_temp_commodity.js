// 시장 한눈에 원자재·가상자산 블록 + 공용 코멘트 모듈: 값은 /futures 응답 그대로, 없거나 stale이면 '미수신'(대체 금지).
// 코멘트 풀에는 매수·매도를 직접 권유·지시하는 표현이 없어야 한다(의문·감탄 혼잣말은 허용).
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('js/market-temp.js','utf8').replace('global.MarketTemp = MarketTemp;','global.MarketTemp = MarketTemp; global.t={commodityStrip_,marketComment_,COMMENT_POOLS_};');
const sb={window:{},document:{readyState:'loading',addEventListener(){}},console,setTimeout,clearTimeout,fetch:async()=>({ok:true,json:async()=>({})})};
vm.runInNewContext(src,sb);const {commodityStrip_:f,marketComment_:mc,COMMENT_POOLS_:pools}=sb.window.t;
// 금지: 권유·지시형 어미/동사 (독자 혼잣말 '사야 하나?' 는 허용)
const BANNED=/(사라|팔아|팔자|사자|매수해|매도해|해야 ?돼|사세요|파세요|매수하세요|매도하세요|매수하라|매도하라|지금 사)/;
let total=0;
Object.entries(pools).forEach(([kind,tiers])=>Object.entries(tiers).forEach(([tier,list])=>{assert(list.length>=3,kind+tier+' 변형 3개 이상');list.forEach(t=>{total++;assert(!BANNED.test(t),'권유형 금지: '+t)})}));
assert(total>=45,'문구 풀 규모');
// 변형은 날짜+종류로 고정되고, 날짜가 바뀌면 바뀔 수 있다
assert.equal(mc('oil',2.5,'2026-10-23'),mc('oil',2.5,'2026-10-23'));
const seen=new Set();for(let d=1;d<=28;d++)seen.add(mc('gold',-0.9,'2026-10-'+String(d).padStart(2,'0')));assert(seen.size>=2,'날짜에 따라 변형이 달라짐');
assert.equal(mc('oil',null,'2026-10-23'),'미수신');assert.equal(mc('xx',1,'2026-10-23'),'미수신');
assert(pools.oil.flat.includes(mc('oil',0.1,'2026-10-23'))&&pools.btc.upBig.includes(mc('btc',3,'2026-10-23'))&&pools.gold.downMild.includes(mc('gold',-0.8,'2026-10-23')));
const now=Date.parse('2026-10-23T05:00:00Z');
const row=(symbol,price,rate,extra={})=>({symbol,price,change_rate:rate,updated_at:'2026-10-23T04:07:00Z',stale:false,...extra});
assert.equal(f([],now),'');
let html=f([row('WTI',99.99,0.52),row('BRENT',113.77,-0.75),row('GOLD',4030.9,-0.73),row('BTC',109358000,0.42)],now);
assert.equal((html.match(/mt-xcard/g)||[]).length,3,'원유·금·비트코인 3카드');
assert(html.includes('$99.99')&&html.includes('$113.77')&&html.includes('$4,030.9')&&html.includes('1억 936만원'));
assert(html.includes('10.23 13:07 수신(53분 전)')&&html.includes('mt-glance-row'),'한눈에 칸과 같은 카드 + 수신 시각·경과');
assert(html.includes('업비트 공개시세'),'BTC 출처 표기');
{ // 출처·지연 여부는 응답이 준 만큼만 쓴다: 미확인이면 '지연 여부 미확인', 실시간이라고 단정하지 않는다
  const h2=f([row('WTI',99.99,0.52,{source:'Naver 비공식 선물 시세',source_delay:'미확인'}),row('BRENT',113.77,-0.75,{source:'KIS 공식 해외선물 시세',source_delay:'미확인'}),row('GOLD',4030.9,-0.73),row('BTC',109358000,0.42)],now);
  assert(h2.includes('Naver 비공식 선물 시세 · 지연 여부 미확인')&&h2.includes('KIS 공식 해외선물 시세'),'원유 출처·지연 여부 표기');
  assert(!/실시간/.test(h2),'지연 여부를 모르면 실시간이라고 쓰지 않는다');
}
assert(html.indexOf('mt-xsay')>html.indexOf('mt-glance-line'),'값 줄 아래에 코멘트 줄');
assert(!html.includes('mt-xpanel')&&!html.includes('data-mt-flow-chart'),'카드 안에 정적 그래프 없음(누르면 오른쪽 최근 시장 흐름에 표시)');
assert(html.includes('data-market-metric="x-oil"')&&html.includes('mt-xicon'),'누르면 최근 시장 흐름에 보이는 카드 + 아이콘');
const chart=Array.from({length:30},(_,i)=>({date:'202610'+String(i%28+1).padStart(2,'0'),close:100+(i%7)}));
const rowsC=[row('WTI',99.99,0.52,{chart}),row('BRENT',113.77,-0.75),row('GOLD',4030.9,-0.73,{chart}),row('BTC',109358000,0.42,{chart})];
const sel=f(rowsC,now,'x-oil');assert(sel.includes('mt-xcard is-selected')&&sel.includes('aria-pressed="true"'),'선택된 카드 표시');
html=f([row('WTI',99.99,0.52),row('BRENT',113.77,0.7,{stale:true}),row('GOLD',4030.9,0.1,{updated_at:'2026-10-20T00:00:00Z'}),row('BTC',null,0.4)],now);
assert(!html.includes('113.77'),'stale 브렌트 값 비표시');
assert(((html.match(/미수신/g)||[]).length)>=4,'브렌트·금·BTC 미수신 표시');
console.log('commodity cards + comment pools ok');
