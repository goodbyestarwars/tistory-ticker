'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const C = require('../js/dcf-core.js');
const stock = { code: '005930', sourceCode: '005930', shareClass: 'common', kind: 'unknown', name: '삼성전자' };
function payload() {
  const d = C.blank(2025);
  return { schemaVersion: 1, code: '005930', currency: 'KRW', amountUnit: '원', basis: 'CFS', generatedAt: new Date().toISOString(),
    years: d.years.map(r => ({ year: r.year, basis: 'CFS', fields: { revenue: C.cell(100, 'auto'),
      ebit: C.cell(100, 'auto'), taxRate: C.cell(.25, 'review'), da: C.cell(10, 'auto'), capex: C.cell(20, 'auto'),
      nwc: C.cell(30, 'review'), ocf: C.cell(999, 'auto'), debt: C.cell(60, 'review'), cash: C.cell(10, 'auto') } })),
    priorNwc: C.cell(25, 'review'), shareFields: { shares: C.cell(10, 'review') }, quote: C.cell(null) };
}
function manual() {
  const d = C.blank(2025);
  for (const [k, v] of Object.entries({wacc: .1, terminalGrowth: .02, growth: .05, netDebt: 10, shares: 10, baseFcff: 100})) C.setAssumption(d,k,v);
  return d;
}
test('missing, zero, negative and invalid number inputs stay distinct', () => {
  assert.equal(C.numeric(''), null); assert.equal(C.numeric('NaN'), null); assert.equal(C.numeric('0'), 0);
  assert.equal(C.numeric('-1,234'), -1234); assert.equal(C.numeric('1e99'), null);
});
test('unit conversions keep raw amount and share units independent', () => {
  for (const [u, scale] of Object.entries(C.scale)) assert.equal(100000000 / scale * scale, 100000000);
  const d=manual(); d.unit='천원'; assert.equal(C.evaluate(d,'manual').perShare,C.evaluate(manual(),'manual').perShare);
});
test('search exact code, name, similarly named and preferred are distinct', () => {
  const stocks=[stock,{...stock,code:'005935',shareClass:'preferred',name:'삼성전자우'},{...stock,code:'009150',name:'삼성전기'}];
  assert.equal(C.search(stocks,'005935')[0].shareClass,'preferred');
  assert.equal(C.search(stocks,'삼성전자')[0].code,'005930'); assert.equal(C.search(stocks,'삼성').length,3);
  assert.equal(C.search(stocks,'삼성')[2].shareClass,'preferred');
});
test('out-of-order company responses cannot replace selected company', () => {
  const s=C.state(2025), a=s.select(stock), other={...stock,code:'000660',sourceCode:'000660'};
  const b=s.select(other); assert.equal(s.resolve(a,stock,payload()),false);
  assert.equal(s.resolve(b,other,{...payload(),code:'000660'}),true); assert.equal(s.auto.company.code,'000660');
});
test('pending auto response cannot contaminate manual draft', () => {
  const s=C.state(2025), token=s.select(stock); s.switchMode('manual');
  C.setAssumption(s.manual,'baseFcff',123); assert.equal(s.resolve(token,stock,payload()),false);
  assert.equal(s.manual.assumptions.baseFcff.value,123); assert.equal(s.manual.company,null);
});
test('user edit survives repeat response and switching companies', () => {
  const s=C.state(2025), token=s.select(stock); s.resolve(token,stock,payload());
  C.edit(s.auto,2025,'revenue',77); s.resolve(token,stock,payload()); assert.equal(s.auto.years[4].fields.revenue.value,77);
  s.select({...stock,code:'000660',sourceCode:'000660'}); s.select(stock); assert.equal(s.auto.years[4].fields.revenue.value,77);
});
test('restoring original retains source status and raw amount', () => {
  const d=C.autoDraft(stock,payload(),2025); C.edit(d,2025,'revenue',0); assert.equal(d.years[4].fields.revenue.status,'user');
  C.restore(d,2025,'revenue'); assert.equal(d.years[4].fields.revenue.value,100); assert.equal(d.years[4].fields.revenue.status,'auto');
});
test('NWC increase reduces FCFF and decrease increases FCFF', () => {
  const d=C.blank(2025); for (const r of d.years) for (const [k,v] of Object.entries({ebit:100,taxRate:.25,da:10,capex:20,nwc:30})) C.edit(d,r.year,k,v);
  C.edit(d,2024,'nwc',10); assert.equal(d.years[4].fields.fcff.value,45);
  C.edit(d,2025,'nwc',0); assert.equal(d.years[4].fields.fcff.value,75);
});
test('component CAPEX outflows normalized and parent changes recalculate', () => {
  const d=C.blank(2025); C.edit(d,2025,'ppeCapex',-10); C.edit(d,2025,'intangibleCapex',0); assert.equal(d.years[4].fields.capex.value,10);
  C.edit(d,2025,'ppeCapex',-30); assert.equal(d.years[4].fields.capex.value,30);
});
test('manual override of derived field is not overwritten by component edits', () => {
  const d=C.blank(2025); C.edit(d,2025,'capex',55); C.edit(d,2025,'ppeCapex',-10); C.edit(d,2025,'intangibleCapex',3); assert.equal(d.years[4].fields.capex.value,55);
});
test('simple OCF FCF differs from FCFF and cannot satisfy missing components', () => {
  const d=C.autoDraft(stock,payload(),2025); assert.equal(d.years[4].fields.simpleFcf.value,979);
  assert.equal(d.years[4].fields.fcff.value,65); assert.equal(d.years[4].fields.fcff.status,'review');
  delete d.years[4].fields.ebit; C.recalculate(d); assert.equal(d.years[4].fields.fcff.value,null);
});
test('review candidate cannot feed valuation until explicitly accepted', () => {
  const d=C.autoDraft(stock,payload(),2025);
  for(const [k,v] of Object.entries({modelReviewed:1,wacc:.1,terminalGrowth:.02,growth:.05,netDebt:50,shares:10})) C.setAssumption(d,k,v);
  assert.equal(C.evaluate(d,'auto').ok,false); C.edit(d,2025,'taxRate',.25); C.edit(d,2025,'deltaNwc',0);
  assert.equal(C.evaluate(d,'auto').ok,true);
});
test('financial industry and preferred block generic FCFF model', () => {
  const p=payload(); for(const s of [{...stock,kind:'financial'},{...stock,kind:'spac'},{...stock,shareClass:'preferred'}]) {
    const d=C.autoDraft(s,p,2025); assert.match(C.evaluate(d,'auto').reason,/부적합/);
  }
});
test('stale archive blocks automatic valuation without substituting zeros', () => {
  const p=payload(); p.generatedAt='2020-01-01T00:00:00Z'; const d=C.autoDraft(stock,p,2025);
  assert.match(C.evaluate(d,'auto').reason,/오래된/); assert.equal(d.years[4].fields.revenue.value,100);
});
test('future or malformed timestamps are not treated as fresh', () => {
  for(const time of ['invalid','2099-01-01T00:00:00Z']) {const p=payload();p.generatedAt=time; assert.equal(C.evaluate(C.autoDraft(stock,p,2025),'auto').ok,false);}
});
test('short or mixed-basis and wrong-unit archives are rejected', () => {
  const p=payload(); p.years[0].basis='OFS'; assert.throws(()=>C.autoDraft(stock,p,2025));
  for(const update of [{years:[]},{amountUnit:'백만원'},{code:'000660'}]) assert.throws(()=>C.autoDraft(stock,{...payload(),...update},2025));
});
test('missing static file never becomes fake automatic result', () => {
  const d=C.autoDraft(stock,null,2025); assert.match(C.evaluate(d,'auto').reason,/재무자료 부족/);
});
test('manual DCF matches independent five-year discounting formula', () => {
  const d=manual(), r=C.evaluate(d,'manual');
  const f=[1,2,3,4,5].map(i=>100*1.05**i), enterprise=f.reduce((sum,v,i)=>sum+v/1.1**(i+1),0)+f[4]*1.02/.08/1.1**5;
  assert.equal(r.ok,true); assert.ok(Math.abs(r.perShare-(enterprise-10)/10)<1e-10);
});
test('negative baseline requires explicit recovery forecasts', () => {
  const d=manual();C.setAssumption(d,'baseFcff',-100);assert.equal(C.evaluate(d,'manual').ok,false);
  C.setAssumption(d,'forecastMode',1);for(let i=1;i<=5;i++) C.setAssumption(d,'forecast'+i,i===1?-10:100);
  assert.equal(C.evaluate(d,'manual').ok,true);C.setAssumption(d,'forecast5',-1);assert.equal(C.evaluate(d,'manual').ok,false);
});
test('zero shares, WACC<=growth and missing forecast rejected', () => {
  for(const [k,v] of [['shares',0],['wacc',.02],['growth',-1],['terminalGrowth',-1]]) {const d=manual();C.setAssumption(d,k,v);assert.equal(C.evaluate(d,'manual').ok,false);}
  const d=manual(); C.setAssumption(d,'forecastMode',1);assert.equal(C.evaluate(d,'manual').ok,false);
});
test('failed quote does not block DCF or create fake comparison', () => {
  const d=manual(); assert.equal(C.evaluate(d,'manual').upside,null);
  C.setAssumption(d,'price',100);assert.ok(Number.isFinite(C.evaluate(d,'manual').upside));
});
test('invalid effective tax candidates and negative CAPEX never show automatic confirmation', () => {
  const d=C.blank(2025); C.edit(d,2025,'taxExpense',-25); C.edit(d,2025,'pretax',100);
  assert.equal(d.years[4].fields.taxRate.value,null); assert.equal(d.years[4].fields.taxRate.status,'missing');
  C.edit(d,2025,'ocf',100); C.edit(d,2025,'capex',-10);
  assert.equal(d.years[4].fields.simpleFcf.status,'missing');
});
