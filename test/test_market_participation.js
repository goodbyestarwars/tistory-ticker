const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('js/skin-main.js','utf8');
function extract(name,s=source){const a=s.indexOf('    function '+name+'(');assert(a>=0,name);return s.slice(a,s.indexOf('\n    }',a)+6);}
function entry(ratio=.5,median=1){return {turnoverIndex:{status:'ok',basis:'same-time-cumulative-30m',source:'KIS',market:'KRX',unit:'KRW',lookbackDays:5,sampleDays:5,current:1100000000000,baseline:1000000000000,index100:110,retrievedAt:new Date().toISOString(),asOf:new Date(Date.now()-60000).toISOString()},status:'ok',total:100,retrievedAt:new Date().toISOString(),delaySeconds:1200,volumeParticipation:{status:'ok',basis:'same-time-5m',lookbackDays:10,eligible:100,total:100,increased:ratio*100,ratio,median},volumeIndex:{status:'ok',basis:'same-time-5m-volume-sum',eligible:100,total:100,baseline:10,index100:110}};}
const context={isFinite};vm.createContext(context);vm.runInContext(extract('homeParticipationModel'),context);
function model(e){return context.homeParticipationModel('domestic',{byIndex:{KOSPI:e,KOSDAQ:entry(1,1.2)}});}
for(const ratio of [0,.5,1]) for(const median of [0,.8,1,1.2]){const rows=model(entry(ratio,median));assert.equal(rows[0].participation.ratio,ratio);assert.equal(rows[0].participation.median,median);assert.equal(rows[1].participation.ratio,1);}
for(const value of [null,NaN,Infinity,-1,'0.5',true,1.1]) {const e=entry();e.volumeParticipation.ratio=value;assert.equal(model(e)[0].participation,null);}
for(const value of [null,NaN,Infinity,-1,'1',true]) {const e=entry();e.volumeParticipation.median=value;assert.equal(model(e)[0].participation,null);}
for(const change of [{eligible:94},{eligible:101},{eligible:0},{total:101},{status:'unavailable'},{increased:101},{increased:40},{basis:'daily'},{lookbackDays:5}]){const e=entry();Object.assign(e.volumeParticipation,change);assert.equal(model(e)[0].participation,null);}
const edge=entry();Object.assign(edge.volumeParticipation,{eligible:95,increased:0,ratio:0});assert(model(edge)[0].participation);
for(const change of [{status:'stale'},{retrievedAt:'invalid'},{retrievedAt:new Date(Date.now()-7200000).toISOString()}]){const e=Object.assign(entry(),change);assert.equal(model(e)[0].participation,null);}
const separate=entry();separate.volumeIndex.status='unavailable';assert(model(separate)[0].participation);assert.equal(model(separate)[0].volume.index100,110);
assert.equal(context.homeParticipationModel('domestic',null)[0].participation,null);
module.exports={extract,entry,source};
console.log('PASS domestic participation validation, independent markets and sample boundaries');
// Preserve the US aggregate model contract.
const usEntry=entry();const us=context.homeParticipationModel('us',{byIndex:{SP500:usEntry,NASDAQ:usEntry}});assert.equal(us[0].volume.index100,110);assert.equal(us[1].label,'나스닥 종합');
// During a domestic weekday session, an eight-minute-old HTTP cache is suppressed.
const fixed=Date.parse('2026-10-28T02:00:00Z');
const dated={Date:class extends Date {static now(){return fixed;}},isFinite};vm.createContext(dated);vm.runInContext(extract('homeParticipationModel'),dated);
const aged=entry();aged.retrievedAt='2026-10-28T01:52:00Z';assert.equal(dated.homeParticipationModel('domestic',{byIndex:{KOSPI:aged}})[0].participation,null);

for(const change of [{status:'unavailable'},{unit:'million_krw'},{basis:'daily'},{sampleDays:4},{current:null},{current:NaN},{baseline:0},{index100:Infinity},{index100:90},{asOf:'invalid'},{retrievedAt:new Date(Date.now()-7200000).toISOString()}]){const e=entry();Object.assign(e.turnoverIndex,change);assert.equal(model(e)[0].volume,null);}
const onlyVolume=entry();delete onlyVolume.turnoverIndex;assert.equal(model(onlyVolume)[0].volume,null);
const independent=entry();independent.status='unavailable';assert.equal(model(independent)[0].volume.index100,110);
console.log('PASS turnover contract, no volume fallback, independent source status');
