// 최근 시장 흐름(2026-10-24 삭제): '시장 한눈에' 카드 안에도, 앞쪽 그리드에도 그래프 블록이 없다. 블록이 없어도 화면 갱신(render)이 오류 없이 돈다.
const fs = require('fs'), vm = require('vm'), assert = require('node:assert/strict');
const raw = fs.readFileSync('js/market-temp.js', 'utf8');
const calls = raw.match(/buildIndicatorHistoryShell_\(\)/g) || [];
assert.equal(calls.length, 1, '정의만 남고 호출은 없다');
const summary = raw.slice(raw.indexOf('function buildSummaryCard(data)'), raw.indexOf('function indicatorNumber_'));
assert(!summary.includes('buildIndicatorHistoryShell_()') && !summary.includes('mt-indicator-history'), '시장 한눈에 카드에 최근 시장 흐름 블록 없음');
const frontLine = raw.split('\n').filter((l) => l.includes('mt-summary-trend-row mt-front-page'))[0];
assert(frontLine && !frontLine.includes('buildIndicatorHistoryShell_'), '앞쪽 그리드에도 독립 카드 없음');
assert(raw.includes("if (panel.querySelector('[data-indicator-chart]')) {"), '블록이 없으면 그래프 갱신을 건너뛴다');
console.log('flow card removed ok');
