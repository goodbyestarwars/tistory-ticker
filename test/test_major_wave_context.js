// 대파동 보조 설명은 확정/진행 중 파동과 독립이며 분할·극점·확정 지연을 바꾸지 않는다.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const core=require('../js/chart-core.js'),AW=require('../js/auto-wave.js');
require('../js/chart-data.js');const Wave=require('../js/chart-wave-overlay.js');
const row=(state,raw=state,pending=0)=>({state,raw,pending,change:10});
const lanes=Object.fromEntries(core.REGIME.lanes.map(c=>[c.key,[row('up')]]));
assert.equal(core.majorWaveContext(lanes,{kind:'up'},0).text,'방향 일치');
assert.equal(core.majorWaveContext(lanes,{kind:'side'},0).text,'방향 비교 보류');
lanes.year1=[row('down')];
let c=core.majorWaveContext(lanes,{kind:'up'},0);assert.equal(c.text,'전환 확인 중');assert.equal(c.againstLong,true);
lanes.year1=[row('up','down',2)];c=core.majorWaveContext(lanes,{kind:'up'},0);assert.equal(c.text,'전환 확인 중');assert.equal(c.pending,true);assert.equal(c.againstLong,false);
for(const key in lanes)lanes[key]=[row('unknown','unknown')];
assert.equal(core.majorWaveContext(lanes,{kind:'up'},0).text,'보조 자료 부족');
assert.equal(core.majorWaveContext(lanes,null,0).direction,null);
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/wave/cases_bars.json'),'utf8'));
let checked=0,snapshots=0;
for(const testCase of Object.values(fixture)){
  const bars=testCase.bars.map(([date,open,high,low,close,volume])=>({date,open,high,low,close,volume}));
  const result=AW.analyze(bars),before=JSON.stringify(result),lanes=core.trendRegimes(bars);
  for(const wave of result.levels.major){
    const index=wave.confirmed?wave.confirmedIndex:result.asOf;
    core.majorWaveContext(lanes,wave,index);checked++;
    if(wave.confirmed){
      const prefix=bars.slice(0,index+1),prefixLanes=core.trendRegimes(prefix);
      assert.deepEqual(core.majorWaveContext(lanes,wave,index),core.majorWaveContext(prefixLanes,wave,index));snapshots++;
    }
  }
  for(let i=50;i<bars.length;i+=71){
    const prefix=bars.slice(0,i+1),historical=AW.analyze(prefix),active=Wave.activeMajor(historical);
    assert.deepEqual(core.majorWaveContext(lanes,active,i),core.majorWaveContext(core.trendRegimes(prefix),active,i));
    const html=Wave.majorTooltipHtml(bars,historical,lanes,i,core,result);
    assert.ok(html.includes(bars[i].date+' 당시 자료 기준'));
  }
  assert.equal(JSON.stringify(result),before,'보조 판정/툴팁이 엔진 결과를 변경하면 안 됨');
}
for(const file of ['stock-search.js','foreign-flow.js']){
  const source=fs.readFileSync(path.join(__dirname,'../js',file),'utf8');
  assert.ok(!source.includes('TrendToggle'));assert.ok(!source.includes('setTrendMarkers('));
  assert.ok(source.includes('data-chart-wave-toggle'));assert.ok(source.includes('AccumulationToggle'));
}
console.log(`PASS major context, disagreement, pending, missing data, immutable ${checked} waves, ${snapshots} confirmation snapshots and historical prefixes`);
