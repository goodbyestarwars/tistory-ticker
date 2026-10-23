// 증시온도 '그래서 오늘은?' 야간선물 신호(nightSignal_) 단위 시험 - 날짜 기준·미완성 세션 처리
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'market-temp.js'), 'utf8');
const start = source.indexOf('function nightSignal_(');
const end = source.indexOf('// 조간신문 기준', start);
assert.ok(start > 0 && end > start, 'nightSignal_ 를 찾지 못함');
const nightSignal_ = new Function(source.slice(start, end) + '; return nightSignal_;')();

const dayRow = { chart: [
  { date: '20261021', close: 893.05 }, { date: '20261022', close: 857.0 }, { date: '20261023', close: 860.0 }
] };
const nightRow = { chart: [
  { date: '20261021', close: 888.3 }, { date: '20261022', close: 834.6 }
] };
const kst = (y, m, d, h, mi) => Date.UTC(y, m - 1, d, h, mi) - 9 * 3600000;

test('다음 거래일(10/23) 신호는 야간 10/22 종가 / 주간 10/22 종가', () => {
  // target=오늘(장중)이라 당일 주간 봉(20261023)은 제외, D=20261022
  const s = nightSignal_(dayRow, nightRow, '20261023', kst(2026, 10, 23, 12, 0));
  assert.equal(s.date, '20261022');
  assert.ok(Math.abs(s.gap - (834.6 / 857.0 - 1) * 100) < 1e-9);
  assert.equal(s.pending, false);
});

test('야간 세션이 끝나기 전(다음 날 05:05 KST 전)은 pending', () => {
  const s = nightSignal_(dayRow, nightRow, '20261023', kst(2026, 10, 23, 4, 0));
  assert.equal(s.pending, true);
  assert.equal(nightSignal_(dayRow, nightRow, '20261023', kst(2026, 10, 23, 5, 6)).pending, false);
});

test('날짜가 맞는 야간 봉이 없거나 stale이면 null', () => {
  assert.equal(nightSignal_(dayRow, { chart: [{ date: '20261021', close: 888.3 }] }, '20261023', kst(2026, 10, 23, 12, 0)), null);
  assert.equal(nightSignal_(dayRow, { stale: true, chart: nightRow.chart }, '20261023', kst(2026, 10, 23, 12, 0)), null);
  assert.equal(nightSignal_({ chart: [] }, nightRow, '20261023'), null);
});
