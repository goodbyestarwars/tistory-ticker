// Rendering contract: zero is a measured value, while missing data has no column fill.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('js/skin-main.js','utf8');
function extract(name){const a=source.indexOf('    function '+name+'(');return source.slice(a,source.indexOf('\n    }',a)+6);}
function render(volume,status='ok'){
 const target={innerHTML:'',hidden:false},basis={};
 const context={isFinite,latestHomeIndices:[],latestHomeParticipation:{domestic:{byIndex:{KOSPI:{status,volumeParticipation:volume}}}},
 homeMarketSession:()=>({market:'domestic'}),usRegularSessionState:()=>({open:true}),
 dashboardSection:{querySelector:selector=>selector==='[data-home-participation]'?target:basis}};
 vm.createContext(context);vm.runInContext(['escapeHomeHtml','homeParticipationModel','renderMarketParticipation'].map(extract).join('\n'),context);context.renderMarketParticipation();return target.innerHTML;
}
const volume={status:'ok',basis:'same-time-5m',eligible:100,total:100,increased:0,ratio:0};
assert.match(render(volume),/hmp-column-chart/);assert.match(render(volume),/height:0\.00%/);
assert.doesNotMatch(render(null),/class="hmp-column"/);assert.match(render(null),/확인 중/);
assert.doesNotMatch(render(volume,'stale'),/class="hmp-column"/);assert.match(render(volume,'stale'),/갱신 지연/);
assert.doesNotMatch(render({...volume,ratio:1.5}),/class="hmp-column"/);
console.log('PASS: vertical bars preserve real zero and omit missing, stale, and invalid fills.');
