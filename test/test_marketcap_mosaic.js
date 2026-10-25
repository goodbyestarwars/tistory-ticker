'use strict';
require('./helpers/common_runtime');

// 한경 마켓MAP 스타일 재배치: 실제 시총 비례·종목 누락/중복 방지·필터 계약 회귀.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function subject() {
  const window = {}, document = {readyState:'loading', addEventListener(){}};
  vm.runInNewContext(fs.readFileSync('js/marketcap-bubble.js','utf8'),{window,document,console});
  return window.MarketcapBubble;
}
const data = {
  KOSPI:[
    {code:'005930',name:'삼성전자',cap:900,changeRate:3,sectors:['코스피 3대장','반도체']},
    {code:'000660',name:'SK하이닉스',cap:100,changeRate:-2,sectors:['코스피 3대장','반도체']},
    {code:'005380',name:'현대차',cap:250,changeRate:0,sectors:['자동차']}
  ],
  KOSDAQ:[{code:'000001',name:'테스트 코스닥',cap:300,changeRate:null,sectors:['바이오']}],
  ETF:[{code:'069500',name:'KODEX200',cap:180,changeRate:1}],INVERSE:[],LEV:[]
};
test('defaults to KOSPI; sector map is not a duplicate cap count', () => {
  const v=subject().buildLayout(data);
  assert.equal(v.marketView,'KOSPI');
  assert.equal(v.nodes.length,3);
  assert.equal(v.totalCap,1250);
  assert.equal(v.clusterLabels.some(x=>x.label==='반도체'),true);
  assert.equal(v.clusterLabels.some(x=>x.label==='코스피 3대장'),false);
  assert.deepEqual(Array.from(new Set(v.nodes.map(x=>x.code))).sort(),['000660','005380','005930']);
});
test('tile surface area uses actual cap, not a compressed power', () => {
  const v=subject().buildLayout(data);
  const a=v.nodes.find(x=>x.code==='005930'),b=v.nodes.find(x=>x.code==='000660');
  const ratio=a.w*a.h/(b.w*b.h);
  assert.ok(ratio>8 && ratio<10.5, 'cap 900 : 100 must have approximately 9:1 tile area, got '+ratio);
});
test('market tabs, ETF and external code filter keep correct source membership', () => {
  const h=subject();
  assert.equal(h.buildLayout(data,'',null,'KOSDAQ').nodes.length,1);
  assert.equal(h.buildLayout(data,'',null,'ALL').nodes.length,4);
  assert.equal(h.buildLayout(data,'',null,'ETF').nodes.length,1);
  const forced=h.buildLayout(data,'',{label:'관심종목',codes:{'005930':true}},'KOSDAQ');
  assert.equal(forced.matched,1);
  assert.equal(forced.nodes[0].code,'005930');
  assert.equal(h.buildLayout(data,'바이오',null,'KOSDAQ').nodes[0].changeRate,null);
});
test('all rectangles stay within the wide viewport and preserve identity', () => {
  const v=subject().buildLayout(data,'',null,'ALL');
  for(const n of v.nodes) {
    assert.ok(n.x>=0 && n.y>=0 && n.w>0 && n.h>0);
    assert.ok(n.x+n.w<=1100.001 && n.y+n.h<=740.001);
  }
});
test('missing historical returns are not invented as other periods', () => {
  const s=fs.readFileSync('js/marketcap-bubble.js','utf8');
  assert.match(s,/1일 변동률/);
  assert.doesNotMatch(s,/<button[^>]*data-mcb-period="1w"/);
  assert.match(s,/dblclick/);
  assert.match(s,/data-mcb-market="KOSPI"/);
  assert.match(s,/data-mcb-market="KOSDAQ"/);
});
