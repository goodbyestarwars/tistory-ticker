'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const C=require('../js/dcf-core.js');
const now=Date.parse('2026-10-09T20:00:00+09:00');
function read(file){const text=fs.readFileSync(file,'utf8');return JSON.parse(text.slice(text.indexOf('=')+1).replace(/;\s*$/,''));}
function draft(code='005930'){
  const index=read('dcf-data/index.js'),stock=index.stocks.find(s=>s.code===code),payload=read('dcf-data/companies/'+code+'.js')[code];
  payload.generatedAt=new Date(now).toISOString();
  const d=C.autoDraft({...stock,hasOtherShares:index.stocks.some(s=>s.sourceCode===code&&s.shareClass==='preferred')},payload,2025);
  if(['005930','000660'].includes(code))d.supplement=read('dcf-data/supplements/'+code+'.js');return d;
}
test('Samsung generates three valuations with no numeric input and leaves original facts untouched',()=>{
  const d=draft(),before=JSON.stringify(d),a=C.analyze(d,now);
  assert.equal(a.ok,true);assert.equal(a.classification,'추정 포함 계산');assert.equal(a.scenarios.length,3);
  assert.equal(JSON.stringify(d),before);assert.equal(a.completeness,1);assert.equal(a.upside,null);
  assert.ok(a.scenarios[0].perShare<a.perShare);assert.ok(a.scenarios[2].perShare>a.perShare);
});
test('Samsung FCFF includes lease reinvestment, all share classes and minority book adjustment',()=>{
  const d=draft(),a=C.analyze(d,now),f=d.years[4].fields;
  const expected=43601051000000*.85+(43605740+3320852)*1e6-(47522179000000+4630970000000+1296319*1e6)-7717329000000;
  assert.ok(Math.abs(a.history[4].value-expected)<.1);
  assert.equal(a.model.assumptions.shares.value,5827808935+802371203);
  assert.equal(a.model.assumptions.netDebt.value,(17574980+1177508+6479517+7134+12007082)*1e6-f.cash.value);
});
test('automatic valuation agrees with independent discounted cash flow sum',()=>{
  const a=C.analyze(draft(),now),w=a.model.assumptions.wacc.value,g=a.model.assumptions.terminalGrowth.value;
  let reference=0;for(let i=0;i<5;i++)reference+=a.forecast[i]/((1+w)**(i+1));
  reference+=a.forecast[4]*(1+g)/(w-g)/((1+w)**5);
  reference=(reference-a.model.assumptions.netDebt.value)/a.model.assumptions.shares.value;
  assert.ok(Math.abs(a.perShare-reference)<1e-7);
});
test('discount and growth edits immediately recalculate automatic forecasts and ranges',()=>{
  const d=draft(),a=C.analyze(d,now);C.setAssumption(d,'wacc',.12);const b=C.analyze(d,now);
  assert.ok(b.perShare<a.perShare);C.setAssumption(d,'growth',.07);const c=C.analyze(d,now);
  assert.ok(c.forecast[4]>b.forecast[4]);assert.ok(c.perShare>b.perShare);
});
test('terminal growth at discount rate cannot produce a number',()=>{const d=draft();C.setAssumption(d,'terminalGrowth',.1);assert.equal(C.analyze(d,now).ok,false);});
test('report mismatch invalidates supplementary data',()=>{const d=draft();d.supplement.receipt='20260310009999';assert.equal(C.analyze(d,now).ok,false);});
test('wrong units or revenue fingerprint cannot silently authorize supplements',()=>{const d=draft();d.supplement.revenue/=1e6;assert.equal(C.analyze(d,now).ok,false);});
test('missing D&A never becomes OCF minus capex FCFF',()=>{const d=draft('000660');d.supplement=null;assert.equal(C.analyze(d,now).ok,false);assert.match(C.analyze(d,now).reason,/감가상각/);});
test('Hyundai and NAVER expose actual missing-account reason without numeric inputs',()=>{for(const c of ['005380','035420']){const a=C.analyze(draft(c),now);assert.equal(a.ok,false);assert.match(a.reason,/자료|구성값/);}});
test('negative actual FCFF is not converted into invented recovery forecasts',()=>{const a=C.analyze(draft('000020'),now);assert.equal(a.ok,false);assert.match(a.reason,/음수/);});
test('financial firms remain outside the FCFF model despite numeric overrides',()=>{const d=draft('105560');C.setAssumption(d,'modelReviewed',1);assert.match(C.analyze(d,now).reason,/금융업/);});
test('stale or future archives cannot be made usable with a review checkbox',()=>{for(const date of ['2026-01-01','2027-01-01']){const d=draft();d.generatedAt=date;C.setAssumption(d,'modelReviewed',1);assert.equal(C.analyze(d,now).ok,false);}});
test('unvalidated review account does not enter automatic FCFF',()=>{const d=draft();for(const r of d.years.slice(-3)){r.fields.ebit.status='review';r.fields.ebit.sources[0].account_nm='출처 불명';}assert.equal(C.analyze(d,now).ok,false);});
test('preferred and holding-company models stay blocked',()=>{for(const kind of ['holding','spac']){const d=draft();d.company.kind=kind;assert.equal(C.analyze(d,now).ok,false);}const d=draft();d.company.shareClass='preferred';assert.equal(C.analyze(d,now).ok,false);});

test('SK hynix official note supplement also generates three scenarios without inputs',()=>{const d=draft('000660'),a=C.analyze(d,now);assert.equal(a.ok,true);assert.equal(a.scenarios.length,3);assert.equal(a.completeness,1);assert.equal(a.model.assumptions.netDebt.value,(24757848+150573)*1e6-14923766000000);});
