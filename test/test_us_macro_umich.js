'use strict';
// 미시간대 소비자심리: 발표(일정)가 지났는데 FRED 기준월이 이전이면 '반영 대기' 안내, 일정이 없거나 반영됐으면 경고 없음.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = { document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, createElement() { return { setAttribute() {}, style: {} }; }, head: { appendChild() {} }, body: { appendChild() {} }, querySelector() { return null; } }, console, setTimeout, clearTimeout, Promise, encodeURIComponent, URL, AbortController, fetch() {} };
ctx.window = ctx; ctx.window.IndicatorBoard = { util: { series: () => [] } };
vm.createContext(ctx);
ctx.window.NineUI = { escapeHtml: v => String(v).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';'), number: (v, o) => Number(v).toFixed((o && o.digits) || 0) };
vm.runInContext(fs.readFileSync('js/us-macro-indicators.js', 'utf8'), ctx);
const t = ctx.window.UsMacroIndicators._test;
const item = d => ({ symbol: 'US_CONSUMER_SENTIMENT', price: 48, chart: [{ date: d, close: 48 }] });
const now = Date.parse('2026-11-22T01:00:00+09:00');
// 일정 미로드 → 경고 없음
assert.strictEqual(t.releaseStale('US_CONSUMER_SENTIMENT', item('20261001'), now), null);
ctx.window.US_ECON_CALENDAR = { events: [
  { start: '2026-10-30T23:00:00+09:00', us_date: '2026-10-30', code: 'UMICH' },
  { start: '2026-11-21T01:00:00+09:00', us_date: '2026-11-20', code: 'UMICH' },
  { start: '2026-12-12T00:00:00+09:00', us_date: '2026-12-11', code: 'UMICH' } ] };
const st = t.releaseStale('US_CONSUMER_SENTIMENT', item('20261001'), now);
assert.deepStrictEqual([st.last, st.expected, st.usDate], ['202610', '202611', '2026-11-20']);
assert(t.periodText('US_CONSUMER_SENTIMENT', item('20261001')).includes('이전 발표 기준'), '기준월 옆 표시');
assert(/11\/20.*FRED에는 아직 2026년 10월/.test(t.noteHtml('US_CONSUMER_SENTIMENT', item('20261001'))), '안내 문구');
// 발표 직후 3시간 이내·반영 완료·다른 심볼은 경고 없음
assert.strictEqual(t.releaseStale('US_CONSUMER_SENTIMENT', item('20261001'), Date.parse('2026-11-21T02:00:00+09:00')), null, '발표 직후 3시간은 경고 없음');
assert.strictEqual(t.releaseStale('US_CONSUMER_SENTIMENT', item('20261101'), now), null);
assert.strictEqual(t.releaseStale('US_RETAIL_SALES', item('20261001'), now), null);
console.log('PASS umich stale note');
