/* 자동매매 배분 미리보기(js/auto-trader.js allocPlan/allocSize)가 PC 엔진 live_sizing.py와 같은 수량을 내는지 확인한다.
 * 벡터는 quant-autotrade/local_bot/live_sizing.py로 만든 것이다(test/autotrader_allocation_vectors.json).
 * Run: node test/test_autotrader_allocation.cjs
 */
const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const src = fs.readFileSync('js/auto-trader.js', 'utf8');
const start = src.indexOf('var ALLOC_FLOOR_PCT');
const end = src.indexOf('var ALLOC_LIMITS');
assert.ok(start > 0 && end > start, 'allocation preview block missing');
const ctx = {};
vm.runInNewContext(src.slice(start, end) + ';this.allocPlan = allocPlan; this.allocSize = allocSize;', ctx);

const vectors = JSON.parse(fs.readFileSync('test/autotrader_allocation_vectors.json', 'utf8'));
for (const [budget, reserve, slots, risk, carry, price, cash, committed, used, range, qty, limit, worst] of vectors) {
  const p = ctx.allocPlan({ budget: String(budget), reserve: String(reserve), slots: slots == null ? '' : String(slots), risk: risk == null ? '' : String(risk), carry });
  const r = ctx.allocSize(p, price, cash, committed, used, range);
  const label = JSON.stringify({ budget, reserve, slots, risk, carry, price, cash, committed, used, range });
  assert.equal(r.qty, qty, 'qty ' + label);
  if (qty) {
    assert.equal(r.limit, limit, 'limit ' + label);
    assert.equal(r.worstLoss, worst, 'worst ' + label);
  }
}
assert.equal(ctx.allocPlan({ budget: '2000000', reserve: '100000', slots: '', risk: '' }).slots, 2);
assert.equal(ctx.allocPlan({ budget: '2000000', reserve: '100000', slots: '', risk: '' }).perStock, 950000);
assert.ok(ctx.allocPlan({ budget: '100000', reserve: '100000', slots: '' }).error);
console.log('자동매매 배분 미리보기 = PC 엔진 live_sizing.py 계산 일치 (' + vectors.length + '건)');
