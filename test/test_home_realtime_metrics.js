const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/home-realtime-table.js'), 'utf8');
const columns = source.slice(source.indexOf('  function columnsForActive()'), source.indexOf('  function tableColspan()'));
const rows = source.slice(source.indexOf('  function metricPct('), source.indexOf('  function industryRowHtml('));
const state = { market: 'domestic', active: 'volumeGrowth', delayedCodes: {} };
const baseColumns = [['stock', '종목'], ['price', '현재가'], ['amount', '거래대금']];
const context = {
  state,
  global: {},
  columnsForMarket: () => baseColumns,
  TABLE_COLUMNS: baseColumns,
  number: value => Number.isFinite(Number(value)) ? Number(value) : null,
  localizedUsName: item => item.name,
  industryFor: () => '',
  escapeHtml: value => String(value),
  stockIconHtml: () => '',
  priceCellInner: () => '1,000원',
  fmtAmount: () => '1억',
  fmtCount: () => '100',
  rateCell: () => '-',
  fmtMarketCap: () => '-',
  fmtPrice: () => '-'
};
vm.createContext(context);
vm.runInContext(columns + rows, context);
const item = { code: '005930', symbol: '005930', name: '삼성전자', price: 1000,
  volume_growth_rate: 123.45, turnover_rate: 4.56, amount_turnover_rate: 7.89 };
for (const [tab, field, value] of [
  ['volumeGrowth', 'volumeGrowth', '123.45%'],
  ['turnover', 'turnover', '4.56%'],
  ['amountTurnover', 'amountTurnover', '7.89%']
]) {
  state.active = tab;
  assert.equal(context.columnsForActive()[2][0], field);
  assert.match(context.rowHtml(item, 1), new RegExp(`data-field="${field}">${value.replace('.', '\\.')}<`));
}
state.active = 'volumeGrowth';
item.volume_growth_rate = null;
assert.match(context.rowHtml(item, 1), /data-field="volumeGrowth"><span class="hrt-muted">-<\/span>/);
state.active = 'volumePower';
item.execution_strength = 999.99;
assert.match(context.rowHtml(item, 1), /data-field="volumePower"[^>]*>-<\/td>/);
console.log('PASS domestic ranking metrics and capped strength display');
