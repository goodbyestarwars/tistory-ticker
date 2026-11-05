const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('js/skin-main.js','utf8').replace(/\r\n/g,'\n');
function extract(name){const a=source.indexOf('    function '+name+'(');assert(a>=0,name);return source.slice(a,source.indexOf('\n    }',a)+6);}
const entry=()=>({status:'ok',total:100,retrievedAt:new Date().toISOString(),delaySeconds:900,volumeIndex:{status:'ok',basis:'same-time-5m-volume-sum',lookbackDays:10,eligible:100,total:100,current:140,baseline:100,index100:140}});
let market='us';const target={innerHTML:'',parentElement:{classList:{toggle(){}}}},basis={innerHTML:''};
const ctx={isFinite,escapeHomeHtml:x=>String(x),latestHomeParticipation:{},homeMarketSession:()=>({market}),usRegularSessionState:()=>({open:true}),dashboardSection:{querySelector:s=>s==='[data-home-participation]'?target:basis}};
vm.createContext(ctx);vm.runInContext(['homeParticipationModel','homeVolumeScale','renderParticipationBasis','renderUsParticipation','renderDomesticParticipation','renderMarketParticipation'].map(extract).join('\n'),ctx);
const model=(e,m)=>ctx.homeParticipationModel(m,{byIndex:{KOSPI:e,KOSDAQ:e,SP500:e,NASDAQ:e,SOX:e}})[0];
for(const m of ['domestic','us']){
 assert.equal(model(entry(),m).volume.index100,140);
 for(const patch of [{eligible:94},{eligible:101},{eligible:0},{total:101},{lookbackDays:5},{basis:'daily'},{baseline:0},{current:null},{index100:400},{current:-1},{index100:-2},{index100:'140'},{status:'unavailable'}]){
  const e=entry();Object.assign(e.volumeIndex,patch);assert.equal(model(e,m).volume,null,m+JSON.stringify(patch));
 }
 for(const patch of [{status:'stale'},{retrievedAt:'invalid'},{retrievedAt:new Date(Date.now()-7200000).toISOString()}])assert.equal(model(Object.assign(entry(),patch),m).volume,null);
 const e=entry();delete e.volumeIndex;e.turnoverIndex={status:'ok',index100:120};assert.equal(model(e,m).volume,null);
 const zero=entry();zero.volumeIndex.current=0;zero.volumeIndex.index100=0;assert.equal(model(zero,m).volume.index100,0);
 market=m;ctx.latestHomeParticipation[m]={byIndex:{KOSPI:entry(),KOSDAQ:entry(),SP500:entry(),NASDAQ:entry(),SOX:entry()}};ctx.renderMarketParticipation();
 assert(target.innerHTML.includes('>140</b> / 100'));assert(target.innerHTML.includes('거래량<br>'));assert(target.innerHTML.includes('hmp-column is-up'));
 assert(!target.innerHTML.includes('거래대금'));assert(!target.innerHTML.includes('미연동'));assert(!target.innerHTML.includes('거래량 보조'));
 assert(basis.innerHTML.includes('10일 동시간대 5분봉 거래량 평균 100'));assert(basis.innerHTML.includes('원본 관측 날짜·시각 미제공'));
}
for(const [m,file] of [['domestic','../participation-domestic.json'],['us','../participation-us.json']]){
 const path=require('path').resolve(process.cwd(),file);if(!fs.existsSync(path))continue;
 market=m;ctx.latestHomeParticipation[m]=JSON.parse(fs.readFileSync(path,'utf8').replace(/^\uFEFF/,'')).data;ctx.renderMarketParticipation();
 assert(!target.innerHTML.includes('NaN'));assert(target.innerHTML.includes('hmp-column is-'),'live response draws volume bars');
}
console.log('PASS same KR/US volume, ratios, sample coverage, stale/missing/zero, no turnover mixing, shared UI and live API');
