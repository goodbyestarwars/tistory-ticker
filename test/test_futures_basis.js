// 2026-11-21 시장 베이시스(주간선물 - KOSPI200 현물) 회귀: 만기 주간·새 월물 첫날 구분, 시점 불일치 시 실시간 값 미표시,
// 장중 일봉 제외, 결측 보존. 서버는 KOSPI200 현물을 수집하되 기본 /futures 응답에는 싣지 않는다.
require('./helpers/common_runtime');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('js/kospi-futures.js', 'utf8');
const fmtStart = source.indexOf('  function fmtPrice(v) {');
const fmtEnd = source.indexOf('  function escapeHtml(s)');
const start = source.indexOf('  // ---- 시장 베이시스(주간선물 - KOSPI200 현물)');
const end = source.indexOf('  function renderAll(container, items) {');
assert.ok(fmtStart > 0 && fmtEnd > fmtStart && start > 0 && end > start);
const context = {};
vm.createContext(context);
vm.runInContext(source.slice(fmtStart, fmtEnd) + source.slice(start, end)
  + '\nthis.api={basisSeries,basisNow,basisExpiries,basisSecondThursday,buildBasisHtml,basisClosedRows};', context);
const api = context.api;

// 둘째 목요일: 2026-09 = 10일, 2026-12 = 10일, 2026-03 = 12일
assert.equal(api.basisSecondThursday(2026, 9), '20260910');
assert.equal(api.basisSecondThursday(2026, 3), '20260312');
assert.equal(api.basisSecondThursday(2025, 12), '20251211');

// 만기 보정: 둘째 목요일이 거래일이 아니면 그 이전 마지막 거래일, 자료 끝 이후 만기는 만들지 않는다.
assert.deepEqual(Array.from(api.basisExpiries(['20260907', '20260908', '20260909', '20260911', '20260914'])), ['20260909']);
assert.deepEqual(Array.from(api.basisExpiries(['20260901', '20260902'])), []);

function days() { return ['20260907', '20260908', '20260909', '20260910', '20260911', '20260914', '20260915']; }
const fut = days().map((d, i) => ({ date: d, close: 800 + i }));
const spot = days().map((d, i) => ({ date: d, close: 800 + i - 1 }));
// 휴장 등으로 한쪽에만 있는 날짜는 짝이 맞는 날만 남긴다(0·이전 값으로 채우지 않는다).
const series = api.basisSeries(fut.concat([{ date: '20260916', close: 900 }]), spot);
assert.equal(series.length, 7);
assert.deepEqual(Array.from(series, r => r.phase), ['week', 'week', 'week', 'expiry', 'roll', 'normal', 'normal']);
assert.equal(series[0].basis, 1);
assert.ok(Math.abs(series[0].pct - (1 / 799 * 100)) < 1e-9);
// 결측·0·문자 종가는 버린다.
assert.equal(api.basisSeries([{ date: '20260907', close: null }, { date: '20260908', close: 0 }, { date: '20260909', close: 'x' }], spot).length, 0);

// 현재 베이시스: 시점 차이 2분 초과, 20분 초과 오래됨, 시각·가격 결측이면 값을 만들지 않는다.
const now = Date.parse('2026-11-20T05:00:00Z');
const iso = ms => new Date(ms).toISOString();
let r = api.basisNow({ price: 755, updated_at: iso(now - 30000) }, { price: 756.5, updated_at: iso(now - 10000) }, now);
assert.equal(r.reason, undefined);
assert.ok(Math.abs(r.basis - (-1.5)) < 1e-9);
assert.equal(api.basisNow({ price: 755, updated_at: iso(now - 30 * 60000) }, { price: 756, updated_at: iso(now - 10000) }, now).reason, 'stale');
assert.equal(api.basisNow({ price: 755, updated_at: iso(now - 4 * 60000) }, { price: 756, updated_at: iso(now - 10000) }, now).reason, 'skew');
assert.equal(api.basisNow({ price: 755 }, { price: 756, updated_at: iso(now) }, now).reason, 'time');
assert.equal(api.basisNow({ price: null, updated_at: iso(now) }, { price: 756, updated_at: iso(now) }, now).reason, 'missing');
assert.equal(api.basisNow(null, null, now).reason, 'missing');

// 오늘 장중 일봉은 종가 베이시스에서 제외(15:50 KST 이후 포함). KST 15:00 = 06:00Z, 16:00 = 07:00Z
const today = [{ date: '20261120' }, { date: '20261119' }];
assert.deepEqual(Array.from(api.basisClosedRows(today, Date.parse('2026-11-20T06:00:00Z')), x => x.date), ['20261119']);
assert.deepEqual(Array.from(api.basisClosedRows(today, Date.parse('2026-11-20T07:00:00Z')), x => x.date), ['20261120', '20261119']);

// 화면 문구: 시점 불일치 때는 실시간 베이시스 대신 이유를 표시하고 일별 표를 유지한다.
const html = api.buildBasisHtml({ price: 755, updated_at: iso(now), chart: fut }, { price: 756, updated_at: iso(now - 10 * 60000), chart: spot }, Date.parse('2026-09-20T00:00:00Z'));
assert.ok(html.includes('실시간 베이시스는 표시하지 않습니다') && html.includes('kf-bs-table') && html.includes('만기 주간') && html.includes('새 월물 첫날'));
const empty = api.buildBasisHtml(null, null, now);
assert.ok(empty.includes('현물(KOSPI200) 시세가 아직 없어') && empty.includes('자료가 아직 부족'));

// 서버 계약: 현물 수집 심볼 추가 + 기본 응답에는 싣지 않고 명시 요청 때만 허용
const py = fs.readFileSync('scripts/cloud-vm/domestic_futures.py', 'utf8');
assert.ok(/'KOSPI200': \('코스피200 현물', 'KPI200'\)/.test(py) && /'KOSPI200': \('index', 'KPI200'\)/.test(py));
const main = fs.readFileSync('scripts/cloud-vm/main.py', 'utf8');
assert.ok(/_EXPLICIT_ONLY_FUTURES_SYMBOLS = \('KOSPI200',\)/.test(main));
assert.ok(/order \+ list\(_CALENDAR_MACRO_SYMBOLS\) \+ list\(_EXPLICIT_ONLY_FUTURES_SYMBOLS\)/.test(main));
const order = main.slice(main.indexOf("order = ['KOSPI', 'KOSDAQ'"), main.indexOf("'KTB3Y'", main.indexOf("order = ['KOSPI', 'KOSDAQ'")));
assert.ok(!/'KOSPI200'/.test(order), '기본 응답 순서 목록에는 KOSPI200 현물을 넣지 않는다');
assert.ok(source.includes("PANEL_ORDER.join(',') + ',KOSPI200'"));
console.log('test_futures_basis ok');
