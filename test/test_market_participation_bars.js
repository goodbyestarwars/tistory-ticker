const {extract,entry}=require('./test_market_participation');
const vm=require('node:vm'),assert=require('node:assert/strict');
function render(e=entry(),other=entry(1,.8)){
 const target={innerHTML:'',classList:{toggle(){}},hidden:false},basis={};
 const c={isFinite,latestHomeParticipation:{domestic:{byIndex:{KOSPI:e,KOSDAQ:other}}},homeMarketSession:()=>({market:'domestic'}),usRegularSessionState:()=>({open:true}),dashboardSection:{querySelector:s=>s==='[data-home-participation]'?target:basis}};
 vm.createContext(c);vm.runInContext(['escapeHomeHtml','homeParticipationModel','homeVolumeScale','renderDomesticParticipation','renderMarketParticipation'].map(n=>extract(n)).join('\n'),c);c.renderMarketParticipation();return {html:target.innerHTML,basis:basis.textContent};
}
for(const ratio of [0,.5,1]){const {html}=render(entry(ratio));assert(html.includes('width:'+(ratio*100).toFixed(2)+'%'));assert(html.includes('>'+ratio*100+'%</b>'));assert(html.includes('1.00배'));assert(html.includes('공급자 20분 지연'));assert(html.includes('합산 거래량 지수 (보조)'));assert(!html.includes('is-up'));}
assert(render(entry()).html.includes('0.80배'));
assert(render({...entry(),status:'stale'}).html.includes('갱신 지연'));
assert(render(null,null).html.includes('확인 중'));
assert(render(entry()).basis.includes('실제 관측 시각 미제공'));
console.log('PASS neutral horizontal bars, median, auxiliary aggregate, delay and missing data');
module.exports={render};
// Exercise the existing transport's rejection path; it must not retain numeric HTML.
(async()=>{
 let rendered=false; const c={latestHomeParticipation:{domestic:{old:true}},window:{NineAPI:{marketParticipation:()=>Promise.reject(new Error('offline'))}},renderMarketParticipation(){rendered=true;}};
 vm.createContext(c);vm.runInContext(extract('loadDomesticParticipation'),c);c.loadDomesticParticipation();await new Promise(resolve=>setImmediate(resolve));assert.equal(c.latestHomeParticipation.domestic,null);assert.equal(rendered,true);
 console.log('PASS API error removes cached values');
})().catch(e=>{console.error(e);process.exitCode=1;});
