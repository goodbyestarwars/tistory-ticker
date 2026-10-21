'use strict';
// Regression: search table + stock detail appear in ONE bordered card.
// No automatic collapsing after selecting a stock. Run with Node.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('js/stock-search.js', 'utf8');
const css = fs.readFileSync('css/stock-search.css', 'utf8');
const hook = 'global.StockSearch = { init: init };';
assert(source.includes(hook));
const testable = source.replace(hook,
  'selectStock = function (container, item) { state.selectedCode = item.code;'
  + ' state.selectedName = item.name; container.querySelector("#ssSummary").hidden = false;'
  + ' syncOverviewSelection(container); };'
  + ' global.__test = { renderResults, renderSummary, buildShell, state }; ' + hook);
const window = { addEventListener() {} };
const document = { readyState: 'loading', currentScript: null, addEventListener() {} };
vm.runInNewContext(testable, { window, document, location: { search: '' }, URLSearchParams });
const app = window.__test;
const shell = app.buildShell();
const start = shell.indexOf('id="ssOverview"');
const resultsPos = shell.indexOf('id="ssResults"');
const summaryPos = shell.indexOf('id="ssSummary"');
const detailPos = shell.indexOf('id="ssDetail"');
assert(start >= 0 && start < resultsPos && resultsPos < summaryPos && summaryPos < detailPos);
assert(shell.slice(summaryPos, detailPos).includes('</div>')); // overview closes
assert(shell.includes('class="ss-panels"'));
let html = '';
let handlers = {};
let rows = [];
const classes = new Set();
const overview = {
  hidden: false, classList: {
    add(key) { classes.add(key); },
    toggle(key, value) {
      if (value) classes.add(key);
      else classes.delete(key);
    }
  }
};
const summary = { hidden: true, innerHTML: '' };
const result = {
  hidden: false,
  get innerHTML() { return html; },
  set innerHTML(markup) {
    html = markup; handlers = {};
    rows = [...markup.matchAll(/class="ss-result-row" data-idx="(\d+)"/g)].map(m => {
      let active = false;
      const rowHandlers = {};
      return {
        index: Number(m[1]), handlers: rowHandlers,
        getAttribute(k) { return k === 'data-idx' ? m[1] : null; },
        addEventListener(k, cb) { rowHandlers[k] = cb; },
        classList: {
          add() { active = true; }, remove() { active = false; },
          contains() { return active; }
        }
      };
    });
  },
  querySelector(selector) {
    if (selector === '.ss-results-toggle' && html.includes('ss-results-toggle'))
      return { addEventListener(type, callback) { handlers[type] = callback; } };
    if (selector === '.ss-result-row') return rows[0] || null;
    const match = /\.ss-result-row\[data-idx="(\d+)"\]/.exec(selector);
    return match ? rows.find(r => r.index === Number(match[1])) || null : null;
  },
  querySelectorAll(selector) {
    return selector === '.ss-result-row' ? rows
      : selector === '.ss-fav-btn' ? [] : [];
  }
};
const container = {
  querySelector(selector) {
    return selector === '#ssResults' ? result :
      selector === '#ssOverview' ? overview :
      selector === '#ssSummary' ? summary : null;
  }
};
const stock = {
  code: '247540', name: '에코프로비엠', price: 108100,
  changeRate: 2.76, volume: 160794, tradingValue: 17380000000,
  sectors: ['2차전지']
};
app.state.lastResults = [stock];
app.state.resultsCollapsed = false;
app.renderResults(container, [stock]);
app.renderSummary(container, stock);
assert.equal(app.state.resultsCollapsed, false);
assert(html.includes('ss-results-table')); // not collapsed
assert(html.includes('에코프로비엠'));
assert(html.includes('108,100'));
assert(html.includes('160,794'));
assert(html.includes('173.8억'));
assert(html.includes('ss-fav-btn')); // favorite preserved
assert(summary.innerHTML.includes('ssSessionCandle'));
assert(summary.innerHTML.includes('ssSummaryReason'));
assert(summary.innerHTML.includes('종목분석'));
assert(classes.has('ss-overview-active'));
assert(classes.has('ss-overview-selected')); // CSS suppresses duplicated name/price
assert(!html.includes('목록 다시 보기'));

// Selecting from multiple matches also keeps the complete search table visible.
const second = { ...stock, code: '101490', name: '에스앤에스텍', price: 43350 };
app.state.lastResults = [stock, second];
app.state.resultsCollapsed = false;
app.renderResults(container, [stock, second]);
assert.equal(rows.length, 2);
assert.equal(typeof rows[1].handlers.click, 'function');
rows[1].handlers.click();
assert.equal(app.state.selectedCode, second.code);
assert.equal(app.state.resultsCollapsed, false);
assert(html.includes('ss-results-table'));
assert(classes.has('ss-overview-selected'));

// For long lists manual collapse is still reversible, showing the selected
// identity in summary while the table is folded.
assert.equal(typeof handlers.click, 'function');
handlers.click();
assert.equal(app.state.resultsCollapsed, true);
assert(classes.has('ss-overview-selected') === false);
assert(html.includes('목록 다시 보기'));
assert.equal(typeof handlers.click, 'function');
handlers.click();
assert.equal(app.state.resultsCollapsed, false);
assert(classes.has('ss-overview-selected'));
assert(html.includes('ss-results-table'));

// Responsive layout and title padding: 12px exactly on both panels.
assert(css.includes('#stock-search .ss-overview.ss-overview-active'));
assert(css.includes('#stock-search .ss-overview .ss-summary[hidden]'));
assert(css.includes('#stock-search .ss-overview.ss-overview-selected .ss-summary-price'));
assert(css.includes('#stock-search .ss-panel-head { padding-inline: 12px; }'));
assert(css.includes('@media (max-width: 860px)'));
console.log('stock-search unified results/detail card: ok');
