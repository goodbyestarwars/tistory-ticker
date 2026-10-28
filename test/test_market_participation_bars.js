const {extract,entry}=require('./test_market_participation');
const vm=require('node:vm'),assert=require('node:assert/strict');
function render(e=entry(),other=entry(1,.8)){
 const target={innerHTML:'',hidden:false},basis={};
 const c={isFinite,latestHomeParticipation:{domestic:{byIndex:{KOSPI:e,KOSDAQ:other}}},homeMarketSession:()=>({market:'domestic'}),usRegularSessionState:()=>({open:true}),dashboardSection:{querySelector:s=>s==='[data-home-participation]'?target:basis}};
 vm.createContext(c);vm.runInContext(['escapeHomeHtml','homeParticipationModel','homeVolumeScale','renderDomesticParticipation','renderMarketParticipation'].map(n=>extract(n)).join('\n'),c);c.renderMarketParticipation();return {html:target.innerHTML,basis:basis.innerHTML||basis.textContent};
}
for(const ratio of [0,.5,1]){const {html,basis}=render(entry(ratio));assert(basis.includes('거래량 증가 종목 '+ratio*100+'%'));assert(basis.includes('1.00배'));assert(basis.includes('공급자 20분 지연'));assert(html.includes('>110</b> / 100'));assert(!html.includes('hmp-ratio-track'));}
const a=entry(),b=entry();a.volumeIndex.index100=110;b.volumeIndex.index100=90;
const equal=render(a,b).html;assert.match(equal,/is-up" style="height:25\.00%/);assert.match(equal,/is-down" style="height:25\.00%/);
a.volumeIndex.index100=100;b.volumeIndex.index100=100;assert.doesNotMatch(render(a,b).html,/class="hmp-column /);
a.volumeIndex.index100=0;assert.match(render(a,b).html,/>0<\/b> \/ 100/);
// Participation never changes chart values, geometry or scale.
const low=entry(0,.2),high=entry(1,10000);assert.equal(render(low).html,render(high).html);
low.volumeParticipation.eligible=94;assert(render(low).basis.includes('확인 중'));assert.equal(render(low).html,render(high).html);
assert(render({...entry(),status:'stale'}).basis.includes('갱신 지연'));
assert(render(null,null).basis.includes('확인 중'));
assert(render(entry()).basis.includes('실제 관측 시각 미제공'));
assert(render(entry()).html.includes('동시간대<br>5분 거래량'));
assert(render(entry()).html.includes('코스피 동시간대 5분 거래량'));
assert(render(entry()).basis.includes('당일 누적 거래량이 아님'));
console.log('PASS original aggregate bars and independent supplementary participation text');
module.exports={render};
(async()=>{
 let rendered=false; const c={latestHomeParticipation:{domestic:{old:true}},window:{NineAPI:{marketParticipation:()=>Promise.reject(new Error('offline'))}},renderMarketParticipation(){rendered=true;}};
 vm.createContext(c);vm.runInContext(extract('loadDomesticParticipation'),c);c.loadDomesticParticipation();await new Promise(resolve=>setImmediate(resolve));assert.equal(c.latestHomeParticipation.domestic,null);assert.equal(rendered,true);
 console.log('PASS API error removes cached values');
})().catch(e=>{console.error(e);process.exitCode=1;});
