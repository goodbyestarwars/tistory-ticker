
require('./helpers/common_runtime');
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const window = {}, document = { readyState: 'loading', addEventListener() {} };
vm.runInNewContext(fs.readFileSync('js/fx-rates.js', 'utf8'), { window, document, Intl, Number, Date, Math, String, isFinite, isNaN, clearTimeout, setTimeout });
const u = window.FxRates._util;

// 환율 표기: 기본 소수 둘째 자리, 더 자세한 값이 있으면 넷째 자리까지, 값이 없으면 '-'
assert.equal(u.rate(1339.2), '1,339.20');
assert.equal(u.rate(847.46), '847.46');
assert.equal(u.rate(7.49), '7.49');
assert.equal(u.rate(0.04817), '0.0482');
assert.equal(u.rate(1500.0412), '1,500.0412');
assert.equal(u.rate(null), '-');
assert.equal(u.rate(NaN), '-');

// 기준 단위: JPY(100)·IDR(100)은 100단위 그대로, 나머지는 1단위. 1단위로 환산하지 않는다.
assert.equal(u.unitText({ unit: 100, code: 'JPY' }), '100 JPY당');
assert.equal(u.unitText({ unit: 1, code: 'USD' }), '1 USD당');
assert.equal(u.unitText({ unit: 0, code: 'USD' }), '1 USD당');

// 통화명: 한글 이름을 먼저, 어색한 API 표기만 일반 표기로(코드·값은 그대로)
assert.equal(u.displayName({ code: 'USD', name: '미국 달러' }), '미국 달러');
assert.equal(u.displayName({ code: 'JPY', name: '일본 옌' }), '일본 엔');
assert.equal(u.displayName({ code: 'CNH', name: '위안화' }), '중국 위안');
assert.equal(u.displayName({ code: 'EUR', name: '유로' }), '유로');
assert.equal(u.displayName({ code: 'XXX', name: '' }), 'XXX');

// 상승 빨강 / 하락 파랑 구분
assert.equal(u.tone(4.2), 'up');
assert.equal(u.tone(-4.2), 'down');
assert.equal(u.tone(0), 'flat');
assert.equal(u.tone(null), 'flat');

// 날짜·시각 표기: 서버가 준 KST 문자열을 그대로 자른다(시간대를 다시 계산하지 않는다)
assert.equal(u.dayLabel('2026-10-08'), '2026-10-08(목)');
assert.equal(u.dayLabel('2026-10-11'), '2026-10-11(일)');
assert.equal(u.dayLabel(null), '-');
assert.equal(u.kstStamp('2026-10-11T11:46:02+09:00'), '2026-10-11 11:46 KST');
assert.equal(u.kstStamp(null), '-');

// 기간 통계
const st = u.pointStats([['2026-10-05', 1340], ['2026-10-06', 1350], ['2026-10-07', 1330], ['2026-10-08', 1338]]);
assert.equal(st.first, 1340); assert.equal(st.last, 1338); assert.equal(st.hi, 1350); assert.equal(st.lo, 1330);
assert.equal(st.hiDate, '2026-10-06'); assert.equal(st.loDate, '2026-10-07'); assert.equal(st.avg, 1339.5); assert.equal(st.change, -2);
assert.ok(Math.abs(st.rate - (-2 / 1340 * 100)) < 1e-9);

// 눈금: 범위 안에서 오름차순, 4~8개 안팎
const ticks = u.niceTicks(1330, 1350, 4);
assert.ok(ticks.length >= 3 && ticks.length <= 9, 'tick count ' + ticks.length);
assert.ok(ticks.every((v, i) => i === 0 || v > ticks[i - 1]));
assert.ok(ticks[0] >= 1330 - 1e-9 && ticks[ticks.length - 1] <= 1350 + 1e-9);
assert.ok(u.niceTicks(5, 5, 4).length >= 1, 'flat range does not throw or loop');

// 인증키·서버 비밀값이 공개 JS에 없다
const src = fs.readFileSync('js/fx-rates.js', 'utf8');
assert.ok(!/authkey|KOREAEXIM_API_KEY|searchdate/i.test(src), 'no API key plumbing in public JS');
assert.ok(/goodbyestar\.cloud/.test(src) && !/oapi\.koreaexim/.test(src), 'browser only talks to our VM, never the Eximbank API directly');
console.log('PASS: fx-rates formatting, base units, tones, dates, stats, ticks, no key in public JS');
