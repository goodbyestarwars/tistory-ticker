// Run: node test/test_indicator_board.js
// 시장지표 공용 '표 + 추이 차트' 부품(js/indicator-board.js)의 계산·서식과, 네 탭이 이 부품을 쓰도록 연결됐는지 검사한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = {};
vm.runInNewContext(fs.readFileSync('js/indicator-board.js', 'utf8'), { window, document: {}, Math, Date, Number, String, isFinite, Object, Array, JSON });
const u = window.IndicatorBoard.util;

// 날짜: 세 가지 표기를 한 모양으로, 모르는 값은 빈 문자열
assert.equal(u.isoDate('20261009'), '2026-10-09');
assert.equal(u.isoDate('2026-10-09T00:00:00'), '2026-10-09');
assert.equal(u.isoDate('202608'), '2026-08-01');
assert.equal(u.isoDate('abc'), '');
assert.equal(u.isoDate(null), '');

// 시계열: 정렬·같은 날짜는 뒤의 값·숫자가 아닌 값 제외
const pts = u.series([
  { date: '20261003', close: 3 }, { date: '20261001', close: 1 }, { date: '2026-10-02', close: 2 },
  { date: '20261001', close: 1.5 }, { date: '20261004', close: null }, { date: 'x', close: 9 }, { date: '20261005', close: 'n/a' }
], 'date', 'close');
assert.equal(JSON.stringify(pts), JSON.stringify([['2026-10-01', 1.5], ['2026-10-02', 2], ['2026-10-03', 3]]));
assert.equal(JSON.stringify(u.series(null)), '[]');

// 기간 자르기: 마지막 자료 날짜에서 거슬러 센다. 자료가 짧으면 incomplete
const daily = [];
for (let i = 0; i < 100; i++) daily.push([new Date(Date.UTC(2026, 5, 1) + i * 86400000).toISOString().slice(0, 10), i]);
let cut = u.sliceRange(daily, 31);
assert.ok(cut.points.length >= 31 && cut.points.length <= 33, 'about one month: ' + cut.points.length);
assert.equal(cut.incomplete, false);
cut = u.sliceRange(daily, 366);
assert.equal(cut.points.length, 100);
assert.equal(cut.incomplete, true, 'one year requested but only 100 days exist');
const monthly = [];
for (let m = 0; m < 14; m++) monthly.push([new Date(Date.UTC(2025, m, 1)).toISOString().slice(0, 10), m]);
cut = u.sliceRange(monthly, 366);
assert.equal(cut.incomplete, false, 'monthly gaps are not mistaken for missing history');
assert.equal(JSON.stringify(u.sliceRange([], 31)), JSON.stringify({ points: [], incomplete: false, cutoff: '' }));

// 통계
const st = u.pointStats([['2026-10-05', 1340], ['2026-10-06', 1350], ['2026-10-07', 1330], ['2026-10-08', 1338]]);
assert.equal(st.first, 1340); assert.equal(st.last, 1338); assert.equal(st.hi, 1350); assert.equal(st.lo, 1330);
assert.equal(st.hiDate, '2026-10-06'); assert.equal(st.loDate, '2026-10-07'); assert.equal(st.avg, 1339.5); assert.equal(st.change, -2);
assert.ok(Math.abs(st.rate - (-2 / 1340 * 100)) < 1e-9);

// 눈금: 범위 안, 오름차순, 평평한 범위에서도 멈추지 않는다
const ticks = u.niceTicks(1330, 1350, 3);
assert.ok(ticks.length >= 2 && ticks.length <= 9);
assert.ok(ticks.every((v, i) => i === 0 || v > ticks[i - 1]));
assert.ok(u.niceTicks(5, 5, 3).length >= 1);

// 부호: 서식이 이미 부호를 붙이면 '+'를 또 붙이지 않는다
assert.equal(u.withSign(5, (v) => String(v)), '+5');
assert.equal(u.withSign(5, (v) => '+' + v), '+5');
assert.equal(u.withSign(-5, (v) => String(v)), '-5');
assert.equal(u.withSign(0, (v) => String(v)), '0');
assert.equal(u.signed(1.234, 2), '+1.23');
assert.equal(u.signed(null, 2), '-');

// 정적 계약: 부품은 네트워크를 부르지 않고, 인증값이 없다
const src = fs.readFileSync('js/indicator-board.js', 'utf8');
assert.ok(!/fetch\(|XMLHttpRequest|WebSocket/.test(src), 'the board only draws, it never fetches');
assert.ok(!/authkey|api[_-]?key|token/i.test(src));

// 네 탭이 부품을 쓰도록 연결돼 있다(카드 격자가 기본 경로가 아니다)
const om = fs.readFileSync('js/overnight-market.js', 'utf8');
assert.ok(/IndicatorBoard\.create\(/.test(om) && /renderBoard\(items\)/.test(om), 'global tab renders through the board');
assert.ok(!/outerHTML = buildCardBody/.test(om), 'global tab no longer rewrites per-symbol cards');
const macro = fs.readFileSync('js/us-macro-indicators.js', 'utf8');
assert.ok(/IndicatorBoard\.create\(/.test(macro) && /data-umi-board/.test(macro), 'macro tab renders through the board');
assert.ok(/resultCards:\s*resultCards_/.test(macro), 'calendar still shares the macro result cards');
const crypto = fs.readFileSync('js/crypto-market.js', 'utf8');
assert.ok(/IndicatorBoard\.create\(/.test(crypto) && /data-cm-board/.test(crypto), 'crypto tab renders through the board');
const dmi = fs.readFileSync('js/domestic-market-indicators.js', 'utf8');
assert.ok(/IndicatorBoard\.create\(/.test(dmi) && /renderFundCards/.test(dmi), 'funds render through the board, old cards kept as fallback');
const main = fs.readFileSync('js/skin-main.js', 'utf8');
assert.equal((main.match(/css\/indicator-board\.css/g) || []).length, 4, 'tab loader preloads the board CSS for all four tabs');

console.log('PASS: indicator board util (dates, series, range cut, stats, ticks, sign), no network in board, four tabs wired');
