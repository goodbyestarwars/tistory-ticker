'use strict';
// node test/test_guest_news_stock_badges.js - 제목 직접 언급 종목만 연녹색 태그(비회원 시세 요청 없음)
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const context = {
  window: {
    document: {},
    KRX_MAP: { '삼성전자':'005930', '삼성전자우':'005935', 'SK하이닉스':'000660', '카카오':'035720', '카카오뱅크':'323410', 'TIGER 미국나스닥100':'133690' },
    KRX_ETF_NAMES: ['TIGER 미국나스닥100'],
    StockSearchPanel: { knownUsStocks: () => [
      {symbol:'NVDA', name:'엔비디아', aliases:'엔비디아 nvidia'},
      {symbol:'MSFT', name:'마이크로소프트', aliases:'마이크로소프트 microsoft microsoft corporation'},
      {symbol:'META', name:'메타', aliases:'메타 meta facebook'}
    ] }
  }
};
vm.runInNewContext(fs.readFileSync('js/guest-home.js', 'utf8'), context);
const related = (title, title_ko) => Array.from(context.window.NineGuestHome.relatedStocks({title, title_ko}), row => row.name);
assert.deepEqual(related('삼성전자·SK하이닉스, 반도체 설비 투자 확대'), ['삼성전자', 'SK하이닉스']);
assert.deepEqual(related('카카오뱅크 실적 호조'), ['카카오뱅크']);
assert.deepEqual(related('TIGER 미국나스닥100 ETF 인기'), []);
assert.deepEqual(related('한국은행 기준금리 동결…환율 안정'), []);
assert.deepEqual(related('Nvidia and Microsoft unveil AI partnership'), ['엔비디아', '마이크로소프트']);
assert.deepEqual(related('A meta analysis of stocks'), []);
assert.deepEqual(related('삼성전자우 거래량 증가'), []);
assert.ok(fs.readFileSync('css/guest-home.css', 'utf8').includes('#e8f7ed'));
const script=fs.readFileSync('js/guest-home.js', 'utf8');
assert.ok(script.includes('gnt-stock-badge'));
assert.ok(!/domestic-quotes|market-board|us-quote/.test(script));
console.log('guest-news stock badges: passed');
