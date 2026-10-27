const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const s=fs.readFileSync('js/skin-main.js','utf8');function extract(name){const a=s.indexOf('    function '+name+'(');return s.slice(a,s.indexOf('\n    }',a)+6);}
const c={isFinite};vm.createContext(c);vm.runInContext(['homeParticipationModel','homeVolumeScale'].map(extract).join('\n'),c);
const volume={status:'ok',basis:'same-time-5m-volume-sum',eligible:100,total:100,baseline:1000,index100:110};
const body={byIndex:{KOSPI:{status:'ok',volumeIndex:volume},KOSDAQ:{status:'ok',volumeIndex:{...volume,index100:90}}}};
let rows=c.homeParticipationModel('domestic',body);assert.equal(rows[0].volume.index100,110);assert.equal(rows[1].volume.index100,90);assert.equal(c.homeVolumeScale(rows),20);
body.byIndex.KOSPI.status='stale';assert.equal(c.homeParticipationModel('domestic',body)[0].volume,null);
body.byIndex.KOSPI.status='ok';volume.basis='daily';assert.equal(c.homeParticipationModel('domestic',body)[0].volume,null);
assert.equal(c.homeParticipationModel('us',null)[0].volume,null);
console.log('PASS: normalized volume uses matching same-time aggregate basis and a shared scale.');
