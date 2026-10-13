const assert = require('assert');
const tools = require('../js/invest-tools.js');

const result = tools.calculateAverage(10, 120000, 5, 90000);
assert.equal(result.totalQuantity, 15);
assert.equal(result.totalCost, 1650000);
assert.equal(result.average, 110000);
assert.equal(result.averageChangePct.toFixed(2), '-8.33');
assert.equal(result.recoveryPct.toFixed(2), '22.22');
assert.equal(tools.calculateAverage(10, 120000, 0, 90000), null);
assert.equal(tools.calculateAverage('x', 120000, 5, 90000), null);
console.log('invest tools ok');
