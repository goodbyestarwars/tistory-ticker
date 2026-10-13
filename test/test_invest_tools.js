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
const fx = tools.calculateNasdaqFx(5000000, 1350, 1, 180, 0.25);
assert.equal(fx.effectiveRate, 1363.5);
assert.equal(fx.shares, 20);
assert.equal(fx.orderUsd, 3600);
assert.equal(fx.commissionUsd, 9);
assert.ok(fx.remainingKrw > 79000 && fx.remainingKrw < 80000);
assert.equal(tools.calculateNasdaqFx(0, 1350, 1, 180, 0.25), null);
assert.equal(tools.calculateNasdaqFx(5000000, 0, 1, 180, 0.25), null);
console.log('invest tools ok');
