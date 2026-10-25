'use strict';
require('./helpers/common_runtime');

// Run: node test/test_etf_kiwoom_provider.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('js/strategy-search.js', 'utf8');
const exposed = source.replace('  global.StrategySearch = { init: init, fetchJson: fetchJson };',
  '  global.__testEtfProvider = { providerFromName, normalizeEtfItem, etfTableRow, renderEtfComponentsBody };'
  + ' global.StrategySearch = { init: init, fetchJson: fetchJson };');
assert.notEqual(source, exposed);
const window = {};
vm.runInNewContext(exposed, { window, document: { readyState: 'loading', addEventListener() {} } });
const api = window.__testEtfProvider;
const kiwoom = '키움투자자산운용';
test('KIWOOM current and former branded ETF names resolve to the manager', () => {
  for (const name of [
    'KIWOOM 미국S&P500', 'KIWOOM 엔비디아미국30년국채혼합액티브(H)',
    'KOSEF 국고채', 'HEROES 글로벌리츠', '히어로즈 글로벌리츠'
  ]) {
    assert.equal(api.providerFromName(name), kiwoom, name);
    assert.equal(api.normalizeEtfItem({name,code:'012345',sectors:[]}, 'etfReturn').provider,kiwoom,name);
  }
});
test('literal missing-value placeholders recover the correct provider', () => {
  for (const provider of ['-', '—', '–', '', 'N/A', 'unknown', '미확인', ' 정보없음 ']) {
    const item = api.normalizeEtfItem({ name:'KIWOOM 미국S&P500', provider }, 'etfReturn');
    assert.equal(item.provider,kiwoom,provider);
  }
  const item = api.normalizeEtfItem({
    name:'KIWOOM 미국S&P500',provider:'-',issuer:'키움투자자산운용'
  }, 'etfReturn');
  assert.equal(item.provider,kiwoom);
});
test('confirmed provider data wins, and other brands stay correct', () => {
  assert.equal(api.normalizeEtfItem({name:'KIWOOM ABC',provider:'검증된 운용사'}).provider,'검증된 운용사');
  for (const [prefix,manager] of [
    ['KODEX','삼성자산운용'], ['TIGER','미래에셋자산운용'],
    ['ACE','한국투자신탁운용'], ['RISE','KB자산운용'],
    ['SOL','신한자산운용']
  ]) assert.equal(api.providerFromName(prefix+' ETF'),manager);
  assert.equal(api.providerFromName('Unknown ETF'),'—');
});
test('ETF list and ETF detail both use the normalized provider', () => {
  const item=api.normalizeEtfItem({
    name:'KIWOOM 미국S&P500',code:'449170',provider:'-',price:10000
  });
  const row=api.etfTableRow({...item,sectors:[],changeRate:0},0);
  assert(row.includes('data-label="운용사">'+kiwoom));
  const body={innerHTML:''};
  api.renderEtfComponentsBody(body,{
    components:[{code:'005930',name:'삼성전자',weightPct:20,price:10000}],
    componentCount:1
  },item);
  assert(body.innerHTML.includes('<dt>운용사</dt><dd>'+kiwoom+'</dd>'));
});
