const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/auto-trader.js', 'utf8');
const helpers = source.slice(source.indexOf('  function normalizeTargetSymbol('), source.indexOf('  var targetDraft'));
const context = {global:{KRX_MAP:{'삼성전자우':'005935','삼성전자':'005930','SK하이닉스':'000660','LS ELECTRIC':'010120','미지원':'0013Y0'}}};
vm.runInNewContext(helpers, context);
assert.equal(context.targetSymbolMatches('삼성')[0].name, '삼성전자우');
assert.equal(context.targetSymbolMatches('0059').length, 2);
assert.equal(context.targetSymbolMatches('삼성전자')[0].code, '005930');
assert.equal(context.resolveTargetSymbol('삼성전자').code, '005930');
assert.equal(context.resolveTargetSymbol('005930').name, '삼성전자');
assert.equal(context.resolveTargetSymbol('SK하이닉스 · 000660').code, '000660');
assert.equal(context.resolveTargetSymbol('ls electric').code, '010120');
assert.equal(context.resolveTargetSymbol('삼성'), undefined);
assert.equal(context.resolveTargetSymbol('삼성전자 · 005935'), undefined);
assert.equal(context.resolveTargetSymbol('미지원'), undefined);
assert.equal(context.resolveTargetSymbol('999999'), undefined);
assert.match(source, /code: stock\.code, price: price, qty: qty/);

// 금액 기준: 투자금액 / 목표가 내림, 남는 금액 표시, 잘못된 입력은 null
assert.deepEqual({...context.targetQtyFromAmount(58500, 1000000)}, {qty: 17, cost: 994500, rest: 5500});
assert.equal(context.targetQtyFromAmount(58500, 50000).qty, 0);
assert.equal(context.targetQtyFromAmount(0, 1000000), null);
assert.equal(context.targetQtyFromAmount(58500, ''), null);
assert.match(source, /qty = plan\.qty;/);
