const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('js/skin-main.js','utf8');function extract(name){const a=source.indexOf('    function '+name+'(');return source.slice(a,source.indexOf('\n    }',a)+6);}
function render(a,b,status='ok'){
 const target={innerHTML:'',hidden:false},basis={};const volume=value=>value===null?null:{status:'ok',basis:'same-time-5m-volume-sum',eligible:100,total:100,baseline:1000,index100:value};
 const c={isFinite,latestHomeParticipation:{domestic:{byIndex:{KOSPI:{status,volumeIndex:volume(a)},KOSDAQ:{status,volumeIndex:volume(b)}}}},homeMarketSession:()=>({market:'domestic'}),usRegularSessionState:()=>({open:true}),dashboardSection:{querySelector:s=>s==='[data-home-participation]'?target:basis}};
 vm.createContext(c);vm.runInContext(['escapeHomeHtml','homeParticipationModel','homeVolumeScale','renderMarketParticipation'].map(extract).join('\n'),c);c.renderMarketParticipation();return target.innerHTML;
}
const equal=render(110,90);assert.match(equal,/is-up" style="height:25\.00%/);assert.match(equal,/is-down" style="height:25\.00%/);assert.match(equal,/>110<\/b> \/ 100/);assert.match(equal,/>90<\/b> \/ 100/);
assert.doesNotMatch(render(100,100),/class="hmp-column /);assert.match(render(0,100),/>0<\/b> \/ 100/);assert.match(render(0,100),/is-down" style="height:50\.00%/);
assert.doesNotMatch(render(null,null),/class="hmp-column /);assert.match(render(null,null),/확인 중/);assert.match(render(110,90,'stale'),/갱신 지연/);assert.doesNotMatch(render(-1,NaN),/class="hmp-column /);
assert.doesNotMatch(equal.replace(/title="[^"]*"/g,""),/증가 종목|30\.1%|\/100종목/);
console.log('PASS: 110 and 90 have equal red/blue deviation heights; 100 is neutral; unavailable is not zero.');
