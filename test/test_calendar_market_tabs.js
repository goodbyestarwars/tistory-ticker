'use strict';
// Calendar market selector regression: all / domestic / US share the same events and fetching.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function mountCalendar() {
  const handlers = {};
  const calendar = {innerHTML: '', querySelector() { return null; }};
  const scope = {textContent: ''};
  const input = {value:'',addEventListener() {}};
  const searchForm = {addEventListener() {}};
  const tabs = ['all','domestic','us'].map(value => ({
    getAttribute(key) { return key === 'data-calendar-market' ? value : null; },
    setAttribute(key, value) { this[key] = value; },
    classList: {toggle() {}}
  }));
  const page = {
    innerHTML: '',
    querySelector(selector) {
      if (selector === 'form') return searchForm;
      if (selector === '[data-calendar-content]') return calendar;
      if (selector === '#scDisclosureScope') return scope;
      if (selector === '[data-disclosure-search]') return input;
      return null;
    },
    querySelectorAll(selector) { return selector === '[data-calendar-market]' ? tabs : []; },
    addEventListener(event, callback) { handlers[event] = callback; }
  };
  const document = {readyState:'loading',addEventListener() {},
    querySelector(selector) { return selector === '#stock-calendar' ? page : null; }};
  const window = {};
  vm.runInNewContext(fs.readFileSync('js/stock-calendar.js','utf8'),
    {window, document, setInterval() { return 1; }});
  const today = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});
  const events = [
    {source:'dart',market:'domestic',status:'reported',start:today,
      title:'삼성전자 실적 발표',stock_code:'005930',corp_name:'삼성전자'},
    {source:'finnhub',market:'us',status:'reported',start:today,
      title:'미국 Apple 실적',symbol:'AAPL',corp_name:'Apple'}
  ];
  let fetchCount=0;
  window.StockCalendar.fetchEvents = (year,month,onPartial) => {
    fetchCount++; onPartial(events);
    return Promise.resolve(events);
  };
  window.StockCalendar.init();
  return {
    get html() { return calendar.innerHTML; },
    get shell() { return page.innerHTML; },
    get fetchCount() { return fetchCount; },
    tabs,
    click(value) {
      handlers.click({target:{
        getAttribute(key) { return key === 'data-calendar-market' ? value : null; },
        parentNode:page
      }});
    }
  };
}

test('defaults to all, renders domestic and US together, not stacked sections', () => {
  const page=mountCalendar();
  assert.match(page.html,/data-calendar-market="all" aria-pressed="true"/);
  assert.match(page.html,/>전체보기<\/button>/);
  assert.match(page.html,/삼성전자/);
  assert.match(page.html,/Apple/);
  assert.doesNotMatch(page.html,/sc-completed-group/);
  assert.equal((page.html.match(/class="sc-completed-card"/g)||[]).length,2);
  assert.equal(page.fetchCount,1);
});

test('country tabs filter selected day and completed disclosures without API refetch', () => {
  const page=mountCalendar();
  page.click('domestic');
  assert.match(page.html,/삼성전자/);
  assert.doesNotMatch(page.html,/Apple/);
  assert.match(page.html,/data-calendar-market="domestic" aria-pressed="true"/);
  assert.equal((page.html.match(/class="sc-completed-card"/g)||[]).length,1);

  page.click('us');
  assert.doesNotMatch(page.html,/삼성전자/);
  assert.match(page.html,/Apple/);
  assert.match(page.html,/data-calendar-market="us" aria-pressed="true"/);
  assert.equal((page.html.match(/class="sc-completed-card"/g)||[]).length,1);

  page.click('all');
  assert.match(page.html,/삼성전자/);
  assert.match(page.html,/Apple/);
  assert.equal((page.html.match(/class="sc-completed-card"/g)||[]).length,2);
  assert.equal(page.fetchCount,1,'tab switch must not refetch market data');
});

test('country tab styles include keyboard focus, dark mode and compact mobile', () => {
  const css=fs.readFileSync('css/stock-calendar.css','utf8');
  assert.match(css,/#stock-calendar \.sc-market-btn:focus-visible/);
  assert.match(css,/html\.dark #stock-calendar \.sc-market-btn/);
  assert.match(css,/@media \(max-width: 480px\)/);
  assert.match(css,/#stock-calendar \.sc-market-btn\.is-active/);
});

test('market filter is beside the completed disclosure heading', () => {
  const page=mountCalendar();
  assert.doesNotMatch(page.shell,/sc-market-switch/);
  assert.match(page.html,/<div class="sc-completed-head"><div><h2>공시 완료[\s\S]*?<\/p><\/div><nav class="sc-market-switch"/);
  assert.doesNotMatch(page.html,/<aside[\s\S]*?sc-market-switch[\s\S]*?<\/aside>/);
  page.click('us');
  assert.match(page.html,/data-calendar-market="all" aria-pressed="false"/);
});
