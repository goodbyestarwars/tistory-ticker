// 관심종목의 시장시간 표시 경계 회귀: Node 환경에서 실제 MarketHours와 watchlist helper 실행.
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const shell = fs.readFileSync('js/skin-shell.js', 'utf8');
const watchlist = fs.readFileSync('js/watchlist.js', 'utf8');
const shellEnd = shell.indexOf('})(window);');
assert(shellEnd !== -1, 'MarketHours module ending missing');
const helperStart = watchlist.indexOf('  // ---- 관심종목 행의 거래시장 상태');
const helperEnd = watchlist.indexOf('  // ---- 관심종목 거래시장 상태 끝 ----');
assert(helperStart !== -1 && helperEnd > helperStart, 'Watchlist session helper block missing');
const context = { Date, Intl, console, setTimeout, clearTimeout };
context.window = context;
context.global = context;
vm.runInNewContext(shell.slice(0, shellEnd + '})(window);'.length), context, { filename: 'skin-shell.js' });
vm.runInNewContext(watchlist.slice(helperStart, helperEnd), context, { filename: 'watchlist-session.js' });
assert(context.MarketHours && context.watchlistSessionLabel);
const atKst = time => new Date(time + ':00+09:00');
const cases = [
  ['005930','2026-10-26T07:59','장 마감'],
  ['005930','2026-10-26T08:00','NXT 프리마켓'],
  ['005930','2026-10-26T08:49','NXT 프리마켓'],
  ['005930','2026-10-26T08:50','KRX 동시호가'],
  ['005930','2026-10-26T09:00','KRX 정규장'],
  ['005930','2026-10-26T09:00:30','KRX·NXT 정규장'],
  ['005930','2026-10-26T15:19','KRX·NXT 정규장'],
  ['005930','2026-10-26T15:20','KRX 동시호가'],
  ['005930','2026-10-26T15:30','장 마감'],
  ['005930','2026-10-26T15:40','NXT 애프터마켓'],
  ['005930','2026-10-26T15:59','NXT 애프터마켓'],
  ['005930','2026-10-26T16:00','KRX·NXT 애프터마켓'],
  ['005930','2026-10-26T19:59','KRX·NXT 애프터마켓'],
  ['005930','2026-10-26T20:00','장 마감'],
  ['005930','2026-10-09T08:26','장 마감'], // 한글날 휴장
  ['005930','2026-10-25T08:26','장 마감'], // 일요일
  ['US:NVDA','2026-10-26T08:26','장 마감'], // NY 일요일
  ['US:NVDA','2026-09-08T16:59','장 마감'],
  ['US:NVDA','2026-09-08T17:00','프리마켓'],
  ['US:NVDA','2026-09-08T22:30','정규장'],
  ['US:NVDA','2026-09-09T05:00','애프터마켓'],
  ['US:NVDA','2026-09-09T09:00','장 마감'],
  ['US:NVDA','2026-11-02T17:59','장 마감'], // 미국 표준시
  ['US:NVDA','2026-11-02T18:00','프리마켓'],
  ['US:NVDA','2026-11-02T23:30','정규장'],
  ['US:NVDA','2026-11-03T06:00','애프터마켓'],
  ['US:NVDA','2026-12-25T23:30','장 마감'], // 미국 크리스마스 휴장
];
for (const [code, when, label] of cases) {
  const actual = context.watchlistSessionLabel(code, 'regular', atKst(when));
  assert.strictEqual(actual, label, code + ' ' + when + ': ' + actual + ' != ' + label);
}
assert.strictEqual(context.usSessionLabel('post'), '애프터마켓');
assert.strictEqual(context.usSessionLabel('closed'), '장 마감');
assert(watchlist.includes('refreshSessionLabels(container)'), 'initial/periodic refresh must be wired');
assert(watchlist.includes("card.setAttribute('data-market-state'"), 'US fallback from server must be retained');
console.log('watchlist session labels OK: ' + cases.length + ' KST/DST/holiday/boundary cases');
