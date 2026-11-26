'use strict';
require('./helpers/common_runtime');

// Run: node test/test_strategy_dual_flow_ui.js
// 전략검색 '외국인·기관 쌍끌이 매수' 탭: 다른 탭과 같은 표 양식 + 정렬(많이 산 순 → 연속일) + TOP3 지표.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('js/strategy-search.js', 'utf8').replace(/\r\n/g, '\n');
const marker = '  global.StrategySearch = {';
assert.ok(source.includes(marker));
const exposed = source.replace(marker,
  '  global.__dual = { strategyTableRow, dualFlowSignalHtml, topKpis, allMatches, setData: function (d) { scanData = d; } };\n' + marker);
const window = {};
vm.runInNewContext(exposed, {
  window,
  document: { readyState: 'loading', addEventListener() {} },
  console,
});
const api = window.__dual;

const item = (over) => Object.assign({
  strategy: 'dualFlowBuy', code: '005930', name: '테스트전자', sector: 'IT', price: 70000, changeRate: 1.2,
  dualBuyStreak: 3, foreignBuyStreak: 5, institutionBuyStreak: 3, totalNetEok: 120.5, foreignNetEok: 80.2,
  institutionNetEok: 40.3, foreignStreakNetEok: 150.1, institutionStreakNetEok: 40.3, turnoverSharePct: 12.34,
  flowAsOf: '2026-11-27',
}, over || {});

test('전략 지표 칸에 쌍끌이 연속과 외국인·기관 연속 일수를 나열한다', () => {
  const html = api.dualFlowSignalHtml(item());
  assert.match(html, /쌍끌이 연속 3일/);
  assert.match(html, /\+120\.5억/);
  assert.match(html, /외국인 5일 연속 \+150\.1억/);
  assert.match(html, /기관 3일 연속 \+40\.3억/);
  assert.match(html, /2026-11-27 기준/);
  assert.match(html, /12\.34%/);
});

test('1일짜리 쌍끌이도 나열된다', () => {
  const html = api.dualFlowSignalHtml(item({ dualBuyStreak: 1, foreignBuyStreak: 1, institutionBuyStreak: 1, totalNetEok: 0.8,
    foreignStreakNetEok: 0.5, institutionStreakNetEok: 0.3 }));
  assert.match(html, /쌍끌이 연속 1일/);
  assert.match(html, /외국인 1일 연속/);
  assert.match(html, /기관 1일 연속/);
});

test('다른 전략 탭과 같은 표 행(관심·순위·종목명·업종·현재가·등락률·전략 지표)을 쓴다', () => {
  const row = api.strategyTableRow(item(), 0, false, false);
  for (const label of ['관심', '순위', '종목명', '종목코드', '업종', '등락률', '전략 지표']) {
    assert.ok(row.includes('data-label="' + label + '"'), label);
  }
  assert.ok(row.includes('쌍끌이 연속 3일'));
});

test('TOP3 지표는 쌍끌이 순매수와 연속 일수', () => {
  const model = api.topKpis('dualFlowBuy', item());
  assert.equal(model.kpis[0].label, '쌍끌이 순매수');
  assert.equal(model.kpis[0].value, '+120.5억');
  assert.equal(model.kpis[1].value, '3일');
  assert.match(model.sub, /외국인 5일 연속/);
});

test('정렬: 많이 산 순, 같으면 쌍끌이 연속일이 긴 종목부터', () => {
  api.setData({ categories: { dualFlowBuy: { sectors: { IT: { matches: [
    item({ code: 'A', totalNetEok: 10, dualBuyStreak: 1 }),
    item({ code: 'B', totalNetEok: 30, dualBuyStreak: 1 }),
    item({ code: 'C', totalNetEok: 10, dualBuyStreak: 4 }),
  ] } } } } });
  assert.equal(api.allMatches('dualFlowBuy').map((m) => m.code).join(','), 'B,C,A');
});
