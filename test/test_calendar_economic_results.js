const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function main() {
  let calls = 0, fail = false;
  const rows = [
    { symbol: 'US_NONFARM_PAYROLLS', price: 159044, change: 29,
      updated_at: '2026-10-07T12:11:24Z', chart: [{ date: '20260901', close: 159044 }] },
    { symbol: 'US_REAL_GDP_GROWTH', price: 2.2, change: -.3,
      chart: [{ date: '20260401', close: 2.2 }] },
    { symbol: 'US_UNEMPLOYMENT', price: null, change: null, chart: [] }
  ];
  const context = { window: {}, document: { readyState: 'loading', addEventListener() {} },
    Date, Promise, setTimeout, clearTimeout, setInterval, clearInterval, AbortController,
    fetch: async url => {
      calls++; assert.ok(url.includes('days=500'));
      if (fail) throw Error('provider failed');
      return { ok: true, json: async () => ({ data: rows }) };
    } };
  vm.runInNewContext(fs.readFileSync('js/us-macro-indicators.js', 'utf8'), context);
  const api = context.window.UsMacroIndicators;
  const [first, second] = await Promise.all([api.fetchResults(), api.fetchResults()]);
  assert.equal(calls, 1, 'simultaneous calendar/tab requests must share a fetch');
  assert.equal(first, second);
  await api.fetchResults(); assert.equal(calls, 1, 'repeat requests use the 30 minute cache');
  await api.fetchResults(true); assert.equal(calls, 2, 'manual refresh must bypass the warm cache');
  const html = api.resultCards(first);
  assert.equal((html.match(/<article /g) || []).length, 10);
  assert.ok(html.includes('전월 +29천 명'));
  assert.ok(html.includes('통계 기준 2026년 9월'));
  assert.ok(html.includes('통계 기준 2026년 2분기'));
  assert.ok(html.includes('자료 수집'));
  const unemployment = html.slice(html.indexOf('실업률'), html.indexOf('실업률') + 100);
  assert.ok(unemployment.includes('확인값 없음'), 'missing price must not appear as zero');
  const context2 = { ...context, window: {} };
  vm.runInNewContext(fs.readFileSync('js/us-macro-indicators.js', 'utf8'), context2);
  fail = true;
  await assert.rejects(context2.window.UsMacroIndicators.fetchResults());
  fail = false;
  const recovered = await context2.window.UsMacroIndicators.fetchResults();
  assert.equal(recovered.length, 3, 'a failed request must release the inflight slot');
  console.log('PASS: concurrent fetch, cache, 10 cards, monthly/quarterly periods, missing result, failure retry');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
