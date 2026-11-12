'use strict';
// node test/test_guest_news_stock_badges.js - 관련 종목 라벨만 연녹색 뱃지, 종목명 일반 텍스트(비회원 시세 요청 없음)
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
const css = fs.readFileSync('css/guest-home.css', 'utf8');
const labelStyle = css.match(/\.gnt-related-label\s*\{([^}]*)\}/);
assert.ok(labelStyle, 'related-stock label style exists');
// 신문 지면(2026-11-12): 라벨도 알약이 아닌 작은 글자(배경·테두리 없음).
assert.ok(!/(?:background|border|border-radius|padding):/.test(labelStyle[1]), 'label is plain small text');
assert.ok(/color:\s*var\(--ui-muted\)/.test(labelStyle[1]), 'label uses muted text color');
assert.ok(/\.gnt-dateline\s*\{[^}]*border-top:\s*3px solid/.test(css), 'newspaper dateline rule exists');
assert.ok(/\.gnt-item \+ \.gnt-item\s*\{\s*border-left:/.test(css), 'columns are divided by rules, not cards');
const style = css.match(/\.gnt-stock-name\s*\{([^}]*)\}/);
assert.ok(style, 'plain stock name style exists');
assert.ok(/color:\s*var\(--ui-ink\)/.test(style[1]), 'ordinary text color');
assert.ok(!/(?:background|border|border-radius|padding):/.test(style[1]), 'no badge decoration');
assert.ok(css.includes('html.dark .gnt-stock-name { color: var(--dk-text); }'), 'dark text remains readable');
const script=fs.readFileSync('js/guest-home.js', 'utf8');
assert.ok(script.includes('gnt-stock-name'));
assert.ok(script.includes('gnt-dateline') && script.includes('gnt-head'));
assert.ok(!/domestic-quotes|market-board|us-quote/.test(script));
console.log('guest-news stock badges: passed');
