'use strict';
// Regression: show US cash session status exactly once when the session is closed.
// Run: node test/test_home_us_session_single_status.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const src = fs.readFileSync('js/skin-main.js', 'utf8');
const css = fs.readFileSync('css/home-market-board.css', 'utf8');
const start = src.indexOf('    function applyHomeSummarySession(session) {');
const end = src.indexOf('    // 주요 ETF 수익률', start);
assert(start >= 0 && end > start, 'production summary-session function found');

// Evaluate the production function with lightweight DOM fakes; no server calls.
const secondary = { hidden: false };
const labels = Array.from({ length: 8 }, () => ({ textContent: '' }));
const summaryTitle = { textContent: '' };
const summaryMeta = { textContent: '' };
const night = { hidden: false };
const investor = { hidden: false };
const breadth = { hidden: false };
const etfs = { hidden: true };
const elements = {
  '[data-home-summary-field="title"]': summaryTitle,
  '[data-home-summary-field="meta"]': summaryMeta,
  '[data-home-investor-trend]': investor,
  '[data-home-night-futures]': night,
  '[data-home-breadth]': breadth,
  '[data-home-us-etfs]': etfs,
  '.hmb2-verdict .hmb2-temp': secondary
};
const dashboardSection = {
  querySelector(selector) { return elements[selector] || null; },
  querySelectorAll(selector) { return selector === '.hmb-list dt' ? labels : []; }
};
let sessionState = { open: false };
const apply = new Function('dashboardSection','usRegularSessionState','loadHomeUsEtfs',
  'var homeShowsUs = false;\n' + src.slice(start, end) + '\nreturn applyHomeSummarySession;'
)(dashboardSection, () => sessionState, () => {});

test('US premarket: large market-direction label stays; repeated small market-state line disappears', () => {
  sessionState = {open:false, label:'본장 개장 전'};
  apply({market:'us'});
  assert.equal(secondary.hidden, true);
  assert.equal(labels[0].textContent, '시장 상태');
  assert.equal(summaryTitle.textContent, '미국 시장 요약');
});
test('US closed/holiday: duplicated small status remains hidden', () => {
  for (const label of ['본장 마감', '미국장 휴장']) {
    sessionState = {open:false, label};
    apply({market:'us'});
    assert.equal(secondary.hidden,true,label);
  }
});
test('US cash market open: restore meaningful advance-decline percentage', () => {
  sessionState = {open:true,label:'장중'};
  apply({market:'us'});
  assert.equal(secondary.hidden,false);
  assert.equal(labels[0].textContent,'상승 종목 비율');
});
test('switch back to domestic: restore temperature row', () => {
  apply({market:'domestic'});
  assert.equal(secondary.hidden,false);
  assert.equal(labels[0].textContent,'증시온도');
  assert.equal(summaryTitle.textContent,'시장 핵심 지표');
});
test('CSS respects hidden despite old display:flex!important', () => {
  assert.match(css,/\.hmb2-temp\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert(src.includes('<div class="hmb2-direction">'), 'large direction header unchanged');
  assert(src.includes('data-market-field="direction"'));
});
