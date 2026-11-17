'use strict';
// node test/test_news_market_relevance.js
// Same public company/alias matcher used by main news, weekly home and economic timeline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const w = {
  KRX_MAP: { '삼성전자': '005930', 'SK하이닉스': '000660', '카카오뱅크': '323410' },
  StockSearchPanel: { knownUsStocks: () => [
    { symbol: 'NVDA', name: 'Nvidia', aliases: 'NVIDIA 엔비디아' },
    { symbol: 'AAPL', name: 'Apple', aliases: '애플' },
    { symbol: 'MSFT', name: 'Microsoft', aliases: '마이크로소프트' }
  ] }
};
vm.runInNewContext(fs.readFileSync('js/news-stock-matcher.js', 'utf8'), {window:w, document:{}, Map, Set});
const relevant = w.NineNewsStocks.isMarketRelevant;
const yes = [
  'Jensen Huang says he would return as Nvidia CEO',
  '젠슨 황 CEO 복귀 의향 밝혀',
  'SK하이닉스, HBM 증설 결정',
  'Federal Reserve holds interest rates steady',
  '미국 CPI 물가 둔화에 국채금리 하락',
  'AI data center spending to double as chip supply tightens',
  '대만 반도체 업체, 미국 수출 규제 영향 분석',
  'Apple earnings surpass Wall Street forecasts'
];
const no = [
  'How to use the latest camera app',
  'Apple iPhone 18 hands-on review',
  'Best smartphones of the year: buying guide',
  'AI art app tutorial for beginners',
  '오늘의 영화와 스포츠 소식',
  'New video game review: top ten tips'
];
yes.forEach(title => assert.equal(relevant({title}), true, 'should display: '+title));
no.forEach(title => assert.equal(relevant({title}), false, 'should hide: '+title));
assert.equal(relevant({title:'중앙은행 발표', kind:'disclosure'}), true);
assert.equal(relevant({title:'중앙은행 발표', official:true}), true);
assert.equal(relevant({title:'SEC filing', provider:'SEC EDGAR'}), true);
const item = {title:'Best smartphones of the year: buying guide', source:'WSJ Technology', link:'https://example.com/p'};
const original = JSON.stringify(item);
assert.equal(relevant(item), false);
assert.equal(JSON.stringify(item), original, 'display filter must not mutate raw metadata');
assert.deepEqual(Array.from(w.NineNewsStocks.relatedStocks({title:'Jensen Huang speaks'}), x => x.code), ['NVDA']);
console.log('financial news relevance: PASS');
