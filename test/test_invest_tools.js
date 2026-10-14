const assert = require('assert');
const tools = require('../js/invest-tools.js');

const result = tools.calculateAverage(10, 120000, 5, 90000);
assert.equal(result.totalQuantity, 15);
assert.equal(result.totalCost, 1650000);
assert.equal(result.average, 110000);
assert.equal(result.averageChangePct.toFixed(2), '-8.33');
assert.equal(result.recoveryPct.toFixed(2), '22.22');
const repeated = tools.calculateAverage(10, 120000, [
  { quantity: 5, price: 90000 },
  { quantity: 10, price: 80000 },
  { quantity: 5, price: 70000 }
]);
assert.equal(repeated.additionCount, 3);
assert.equal(repeated.buyQuantity, 20);
assert.equal(repeated.buyCost, 1600000);
assert.equal(repeated.totalQuantity, 30);
assert.equal(repeated.totalCost, 2800000);
assert.equal(repeated.average.toFixed(2), '93333.33');
assert.equal(tools.calculateAverage(10, 120000, 0, 90000), null);
assert.equal(tools.calculateAverage(10, 120000, []), null);
assert.equal(tools.calculateAverage('x', 120000, 5, 90000), null);
const fx = tools.calculateNasdaqFx(5000000, 1350, 180, 0.25);
assert.equal(fx.effectiveRate, 1350);
assert.equal(fx.shares, 20);
assert.equal(fx.orderUsd, 3600);
assert.equal(fx.commissionUsd, 9);
assert.ok(fx.remainingKrw > 127000 && fx.remainingKrw < 128000);
assert.equal(tools.calculateNasdaqFx(0, 1350, 180, 0.25), null);
assert.equal(tools.calculateNasdaqFx(5000000, 0, 180, 0.25), null);
// 기존 자유입력 설정 이전, 증권사별 우대율, 0% 및 손상 설정.
assert.deepEqual(tools.resolveFxFee(null), { broker: 'kis', rates: {} });
assert.deepEqual(tools.resolveFxFee({ broker: '키움증권', rate: '0.07' }), { broker: 'kiwoom', rates: { kiwoom: 0.07 } });
assert.deepEqual(tools.resolveFxFee({ broker: '한국투자증권', rate: '0' }), { broker: 'kis', rates: { kis: 0 } });
assert.deepEqual(tools.resolveFxFee({ broker: 'kis', rate: 0.25, manual: false, rates: { kiwoom: 0.07 } }), { broker: 'kis', rates: { kiwoom: 0.07 } });
assert.deepEqual(tools.resolveFxFee({ broker: '기타증권', rate: 'Infinity', rates: { kis: -1 } }), { broker: 'other', rates: {} });
for (const fee of [0, 0.07, 0.25, 1]) {
  const value = tools.calculateNasdaqFx(5000000, 1350, 180, fee);
  assert.ok(value.usedKrw <= 5000000);
  assert.ok(value.usedKrw + 180 * (1 + fee / 100) * 1350 > 5000000);
  assert.ok(Math.abs(value.usedKrw + value.remainingKrw - 5000000) < 1e-7);
}
console.log('invest tools ok: formulas, budget conservation, broker settings migration');
