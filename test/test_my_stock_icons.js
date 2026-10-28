'use strict';
require('./helpers/common_runtime');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = { addEventListener() {} };
const document = { readyState: 'loading', addEventListener() {} };
const context = vm.createContext({ window, document });
vm.runInContext(fs.readFileSync('js/stock-icon.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('js/my-dashboard.js', 'utf8').replace(
  '  function number(value, fallback) {',
  '  global.iconTest = { stockIconHtml, updateInputLogo };\n  function number(value, fallback) {'), context);
function image(code) {
  const attrs = { 'data-icon-code': code };
  return { src: '', style: {}, hidden: true, previousElementSibling: { hidden: false },
    getAttribute(key) { return attrs[key] || null; },
    setAttribute(key, value) { attrs[key] = value; },
    removeAttribute(key) { delete attrs[key]; } };
}
// Watchlist markup supplies only a local src; identity must survive each retry.
const watchIcon = image('');
watchIcon.src = 'https://goodbyestarwars.github.io/tistory-ticker/img/stock-icons/CBRS.svg';
for (let i = 0; i < 3; i++) window.StockIconFallback(watchIcon);
assert.equal(watchIcon.getAttribute('data-icon-code'), 'CBRS');
assert(watchIcon.src.endsWith('/CBRS.png'));
window.StockIconFallback(watchIcon);
window.StockIconFallback(watchIcon);
assert(watchIcon.src.endsWith('/cerebras.ai.ico'));
// MY uses the common chain for every symbol, including unknown symbols.
for (const code of ['US:MRNA', 'US:NEWCO', 'US:BRK.B', '005930']) {
  const img = image(code), urls = [];
  for (let i = 0; i < 10 && img.getAttribute('data-icon-stage') !== 'generated'; i++) {
    window.MyStockIconFallback(img);
    urls.push(img.src);
  }
  assert.equal(img.getAttribute('data-icon-stage'), 'generated');
  assert(img.src.startsWith('data:image/svg+xml'));
  if (code.startsWith('US:')) assert(urls.some(url => url.includes('assets.parqet.com/logos/symbol/')));
  if (code === 'US:BRK.B') assert(urls.some(url => url.includes('/BRK-B?')));
}
const html = window.iconTest.stockIconHtml({ code: 'US:MRNA', name: '모더나' });
assert(html.includes('data-icon-code="US:MRNA"'));
assert(html.includes('window.MyStockIconFallback(this)'));
const img = image('US:OLD'), initials = { hidden: false };
document.querySelector = () => ({ querySelector: selector => selector === '[data-my-input-image]' ? img : initials });
window.iconTest.updateInputLogo({ code: 'US:MRNA', name: '모더나' });
img.onerror();
assert(img.src.includes('StockMRNA.O.svg'));
img.onload();
assert.equal(img.hidden, false);
window.iconTest.updateInputLogo({ code: 'US:BRK.B', name: '버크셔' });
assert.equal(img.getAttribute('data-icon-stage'), null);
img.onerror();
assert(img.src.includes('StockBRK.B.O.svg'));
console.log('MY stock icons: common fallback, unknown/dotted symbols and input reuse passed');

