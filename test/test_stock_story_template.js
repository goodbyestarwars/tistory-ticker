'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('node:assert/strict');
const win = {};
vm.runInNewContext(fs.readFileSync('js/stock-story-template.js', 'utf8'), {window:win});
const {build, merge} = win.StockStoryTemplate;
const rows = n => Array.from({length:n}, (_,i) => ({date:new Date(Date.UTC(2025,9,1+i)).toISOString().slice(0,10),close:100+i,high:110+i,low:90+i,foreign_net:10,inst_net:-1}));
const input = {
 foreignFlow:{daily:rows(30).reverse()},
 fundamentals:{fundamentals:{latest_quarter:{amount_basis:'standalone_3m',rcept_dt:'20261027',year:2026,label:'3분기',operating_income:200,operating_income_yoy_pct:100,ytd:{amount_basis:'dart_ytd_reported',operating_income:600,operating_income_yoy_pct:20}}}},
 chartData:{daily:rows(400)},
 investorFlow:{short:{daily:rows(25).map((r,i)=>({...r,ratio_pct:i<20?10:20}))}},
 opinion:{available:true,asOf:'2026-11-02',reports:[{date:'20261101',targetPrice:100},{date:'20261010',targetPrice:200},{date:'20261001',targetPrice:900},{date:'20261103',targetPrice:9999},{date:'20261101',targetPrice:0}]}
};
const before=JSON.stringify(input), cards=build(input);
assert.equal(cards.length,5);
assert.equal(JSON.stringify(input),before,'does not mutate existing responses');
assert.equal(cards.find(c=>c.topic==='target').pair[0].v,'150원');
assert(!cards.find(c=>c.topic==='target').pair.some(p=>p.k.includes('건수')));
assert.equal(cards.find(c=>c.topic==='position').pair.length,3);
assert.equal(cards.find(c=>c.topic==='flow').pair[0].v,'+200주');
assert.equal(build({}).length,0);
assert.equal(build({foreignFlow:{daily:rows(19)}}).length,0);
assert.equal(build({foreignFlow:{daily:rows(20).map((r,i)=>({...r,foreign_net:i===0?null:10}))}}).length,0);
assert.equal(build({foreignFlow:{daily:rows(20).map(r=>({...r,foreign_net:null,inst_net:null}))}}).length,0);
assert.equal(build({chartData:{source:'flow-fallback',daily:rows(400)}}).length,0);
assert.equal(build({chartData:{daily:rows(223)}}).length,0);
assert.equal(build({chartData:{daily:rows(224)}})[0].pair.length,1,'does not invent 52-week range from short history');
assert.equal(build({investorFlow:{short:{today_ratio_pct:30,avg_volume_20d:100},credit:{balance_qty:10}}}).length,0);
assert.equal(build({investorFlow:{short:{daily:rows(24).map(r=>({...r,ratio_pct:30}))}}}).length,0);
const low=structuredClone(input);low.fundamentals.fundamentals.latest_quarter.operating_income_yoy_pct=19;low.fundamentals.fundamentals.latest_quarter.ytd=null;
assert(!build(low).some(c=>c.topic==='earnings'));
const primary=[{topic:'earnings'},{topics:['position','short-credit']}];
assert.equal(merge(primary,cards).length,4);
assert.equal(merge(primary,cards).filter(c=>c.topic==='earnings').length,1);
assert(cards.every(c=>c.asOf && c.src.includes('기준')));
console.log('Stock story template: missing values, periods, deduplication, thresholds and no transport passed');
