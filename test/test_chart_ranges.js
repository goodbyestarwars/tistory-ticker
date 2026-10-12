const assert = require('assert');
const data = require('../js/chart-data.js');
const bars = [];
for (let i = 0; i < 1260; i++) {
  const day = new Date(Date.UTC(2021, 9, 1 + i));
  bars.push({ date: day.toISOString().slice(0, 10), open: 100, high: 110, low: 90, close: 105, volume: 1 });
}
const oneYear = data.rangeDates(bars, '005930');
assert.strictEqual(oneYear.to, bars[bars.length - 1].date);
assert.ok(new Date(oneYear.to) - new Date(oneYear.from) >= 365 * 86400000);
assert.strictEqual(data.barsForTimeframe(bars, 'week').length < bars.length, true);
assert.strictEqual(data.barsForTimeframe(bars, 'month').length < data.barsForTimeframe(bars, 'week').length, true);
console.log('chart ranges ok');
