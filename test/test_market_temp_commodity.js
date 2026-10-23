// 시장 한눈에 원자재·가상자산 블록 + 공용 코멘트 모듈: 값은 /futures 응답 그대로, 없거나 stale이면 '미수신'(대체 금지).
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('js/market-temp.js','utf8').replace('global.MarketTemp = MarketTemp;','global.MarketTemp = MarketTemp; global.t={setAiCards:function(v){AI_CARD_COMMENTS_=v;},commodityStrip_,AI_STATE_,aiSayHtml_};');
const sb={window:{},document:{readyState:'loading',addEventListener(){}},console,setTimeout,clearTimeout,fetch:async()=>({ok:true,json:async()=>({})})};
vm.runInNewContext(src,sb);sb.window.t.setAiCards(true);const {commodityStrip_:f,AI_STATE_:ai,aiSayHtml_:say}=sb.window.t;
// 코멘트는 서버가 실제 데이터로 생성·검증한 AI 문장이다. 고정 문구 풀(COMMENT_POOLS_)과 날짜 해시 선택은 없다.
assert(!/COMMENT_POOLS_|commentHash_|marketComment_/.test(src),'고정 문구 풀 제거');
assert.equal(say('oil','mt-xsay'),'<span class="mt-xsay is-empty" data-ai-slot="oil"></span>','코멘트가 없으면 빈 자리만(높이 예약, 고정 문장 없음)');
ai.comments={oil:{text:'기름값은 잠잠한 편이네',generatedAt:'2026-10-23 11:00:00',dataAsOf:'2026-10-23',tradeDate:'2099-01-01',model:'m'}};
assert(say('oil','mt-xsay').includes('기름값은 잠잠한 편이네')&&!say('oil','mt-xsay').includes('is-empty')&&say('oil','mt-xsay').includes('title="AI 코멘트 · 생성 2026-10-23 11:00:00 · 데이터 기준 2026-10-23 · m"'));
ai.comments={};
const now=Date.parse('2026-10-23T05:00:00Z');
const row=(symbol,price,rate,extra={})=>({symbol,price,change_rate:rate,updated_at:'2026-10-23T04:07:00Z',stale:false,...extra});
assert.equal(f([],now),'');
let html=f([row('WTI',99.99,0.52),row('BRENT',113.77,-0.75),row('GOLD',4030.9,-0.73),row('BTC',109358000,0.42)],now);
assert.equal((html.match(/mt-xcard/g)||[]).length,4,'원유·금·비트코인·이더리움 4카드');
assert(html.includes('$99.99')&&html.includes('$113.77')&&html.includes('$4,030.9')&&html.includes('1억 936만원'));
assert(html.includes('10.23 13:07 수신(53분 전)')&&html.includes('mt-glance-row'),'한눈에 칸과 같은 카드 + 수신 시각·경과');
assert(html.includes('업비트 공개시세'),'BTC 출처 표기');
{ // 출처·지연 여부는 응답이 준 만큼만 쓴다: 미확인이면 '지연 여부 미확인', 실시간이라고 단정하지 않는다
  const h2=f([row('WTI',99.99,0.52,{source:'Naver 비공식 선물 시세',source_delay:'미확인'}),row('BRENT',113.77,-0.75,{source:'KIS 공식 해외선물 시세',source_delay:'미확인'}),row('GOLD',4030.9,-0.73),row('BTC',109358000,0.42)],now);
  assert(h2.includes('Naver 비공식 선물 시세 · 지연 여부 미확인')&&h2.includes('KIS 공식 해외선물 시세'),'원유 출처·지연 여부 표기');
  assert(!/실시간/.test(h2),'지연 여부를 모르면 실시간이라고 쓰지 않는다');
}
assert(html.indexOf('mt-xsay')>html.indexOf('mt-glance-line'),'값 줄 아래에 코멘트 줄');
assert((html.match(/mt-xsay is-empty/g)||[]).length>=3&&html.includes('data-ai-slot="oil"')&&html.includes('data-ai-slot="gold"')&&html.includes('data-ai-slot="btc"'),'카드마다 코멘트 자리');
ai.comments={gold:{text:'금값은 그대로 제자리네',generatedAt:'2026-10-23 11:00:00',dataAsOf:'2026-10-23',tradeDate:'2099-01-01',model:'m'}};
assert(f([row('WTI',99.99,0.52),row('BRENT',113.77,-0.75),row('GOLD',4030.9,-0.73),row('BTC',109358000,0.42)],now).includes('금값은 그대로 제자리네'),'AI 코멘트가 있으면 해당 카드에 표시');
ai.comments={};
assert(!html.includes('mt-xpanel')&&!html.includes('data-mt-flow-chart'),'카드 안에 정적 그래프 없음(누르면 오른쪽 최근 시장 흐름에 표시)');
assert(html.includes('data-market-metric="x-oil"')&&html.includes('mt-xicon'),'누르면 최근 시장 흐름에 보이는 카드 + 아이콘');
const chart=Array.from({length:30},(_,i)=>({date:'202610'+String(i%28+1).padStart(2,'0'),close:100+(i%7)}));
const rowsC=[row('WTI',99.99,0.52,{chart}),row('BRENT',113.77,-0.75),row('GOLD',4030.9,-0.73,{chart}),row('BTC',109358000,0.42,{chart})];
const sel=f(rowsC,now,'x-oil');assert(sel.includes('mt-xcard is-selected')&&sel.includes('aria-pressed="true"'),'선택된 카드 표시');
html=f([row('WTI',99.99,0.52),row('BRENT',113.77,0.7,{stale:true}),row('GOLD',4030.9,0.1,{updated_at:'2026-10-20T00:00:00Z'}),row('BTC',null,0.4)],now);
assert(!html.includes('113.77'),'stale 브렌트 값 비표시');
assert(((html.match(/미수신/g)||[]).length)>=3,'브렌트·금·BTC 미수신 표시');
console.log('commodity cards + AI comment slots ok');
// 이더리움 카드 + 카드 안 수신 시각·출처 줄 없음(블록 아래 한 줄로 묶음)
{ const n=Date.parse('2026-10-23T05:00:00Z');const iso='2026-10-23T04:57:00Z';
  const h=f([{symbol:'WTI',price:100.28,change_rate:0.81,updated_at:iso,stale:false},{symbol:'BTC',price:108628000,change_rate:-0.25,updated_at:iso,stale:false},{symbol:'ETH',price:3202000,change_rate:0.19,updated_at:iso,stale:false}],n);
  assert(h.includes('이더리움')&&h.includes('320만원')&&h.includes('+0.19%'),'이더리움 현재가·등락률');
  assert(!h.includes('mt-xmeta'),'카드 안 기준 시각 줄 없음');
  assert((h.match(/class="mt-xnote"/g)||[]).length===1&&h.includes('업비트 공개시세')&&(h.match(/수신\(/g)||[]).length===1,'수신 시각·출처는 블록 아래 한 줄'); }
console.log('eth + note ok');
