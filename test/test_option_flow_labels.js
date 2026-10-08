const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let source=fs.readFileSync('js/kospi-futures.js','utf8').replace('global.KospiFutures = KospiFutures;', 'global.KospiFutures = KospiFutures; global.optTest={tendency:optTendency,section:buildOptionSection};');
const window={addEventListener(){}};vm.runInNewContext(source,{window,document:{readyState:'loading',addEventListener(){}},localStorage:{getItem(){return null}},console,Date});
for(const side of ['CALL','PUT']){
assert.equal(window.optTest.tendency({volume:100,oi_change:3},side).label,'미결제약정 증가');
assert.equal(window.optTest.tendency({volume:0,oi_change:-4},side).label,'미결제약정 감소');
assert.equal(window.optTest.tendency({volume:100,oi_change:null},side).label,'OI 증감 미제공');
}
assert.ok(window.optTest.section().includes('전체 시장 합계가 아닙니다'));
assert.ok(!window.optTest.section().includes('야간 세션이 없어'));
console.log('OI quantity semantics, zero volume, partial coverage, session description passed');

