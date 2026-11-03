const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const shell = fs.readFileSync('js/skin-shell.js', 'utf8');
const anchor = shell.indexOf('  var KST_OFFSET_MS');
const source = shell.slice(shell.lastIndexOf('(function (global)', anchor), shell.indexOf('})(window);', anchor) + 11);
const context = {window: {}};
vm.runInNewContext(source, context);
const f = (q, t) => context.window.MarketHours.krQuoteSession(q, new Date(t + '+09:00'));
// 정규장
assert.equal(f({market_state: 'regular'}, '2026-11-04T10:00').label, '정규장');
assert.equal(f({}, '2026-11-04T10:00').label, '정규장');
// 시계만으로는 애프터마켓이라고 하지 않는다
assert.equal(f({}, '2026-11-04T16:30').label, '시세 세션 확인 중');
// 네이버 NXT 시간외 값 → NXT 단독
assert.deepEqual(JSON.parse(JSON.stringify(f({market_state: 'post', price_session: 'post'}, '2026-11-04T16:30'))),
  {label: '애프터마켓 · NXT', exchange: 'NXT', phase: 'after'});
assert.equal(f({market_state: 'pre', price_session: 'pre'}, '2026-11-04T08:10').label, '프리마켓 · NXT');
// 거래소를 모르면 거래소를 적지 않는다(통합시세로 추정 금지)
assert.equal(f({market_state: 'post'}, '2026-11-04T16:30').label, '애프터마켓');
assert.equal(f({market_state: 'post', exchange: 'UN'}, '2026-11-04T16:30').label, '애프터마켓 · 통합시세');
assert.equal(f({market_state: 'post', exchange: '??'}, '2026-11-04T16:30').label, '애프터마켓');
// 15:30~16:00 구간도 공급자 세션 기준
assert.equal(f({market_state: 'post', price_session: 'post'}, '2026-11-04T15:35').label, '애프터마켓 · NXT');
// 20:00 이후 / 미수신 / 휴장
assert.equal(f({market_state: 'closed'}, '2026-11-04T20:30').label, '장 마감');
assert.equal(f({market_state: 'closed'}, '2026-11-04T17:00').label, '시간외 시세 미수신 · 마지막 시세');
assert.equal(f({market_state: 'post'}, '2026-11-07T11:00').label, '휴장');
assert.equal(f({market_state: 'regular'}, '2026-12-25T11:00').label, '휴장');
console.log('kr quote session: 13 cases passed');
