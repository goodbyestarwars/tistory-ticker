/* 브리핑 검색: 종목코드, 과거사명, 복합 검색, 본문 검색 순위 회귀 */
'use strict';
const assert = require('assert');
global.window = global;
require('../js/briefing-archive.js');
const score = global.NineBriefingArchive.score;
const q = s => s.split(/\s+/).map(raw => ({raw:raw.toLowerCase(),canonical:({"현대상선":"hmm","대우조선해양":"한화오션"}[raw]||raw).toLowerCase()}));
const post = {
 title: '방산·해운 분야 한화오션 잠수함 수주',
 summary: '국내 조선사의 해외 수주 전망',
 topics: ['산업 동향'],
 industries:['방산','해운','조선'],
 stocks:[{name:'한화오션',code:'042660',role:'primary',aliases:['대우조선해양']}],
 terms:['우선협상대상자','잠수함','기자재','해운업황']
};
assert(score(post,q('042660')) >= 14);
assert(score(post,q('한화오션')) >= 12);
assert(score(post,q('해운 방산')) >= 14);
assert(score(post,q('원자력')) === 0);
assert(score(post,q('기자재')) === 2);
const old = {...post,title:'기업 전망',stocks:[{name:'HMM',code:'011200',role:'mentioned',aliases:['현대상선']}]};
assert(score(old,q('현대상선')) > 0);
assert(score(old,q('011200')) > 0);
console.log('briefing search score tests passed');

// Compact archive search UI: one masthead, accessible filters, responsive query width.
const fs = require('fs');
const path = require('path');
const archiveSrc = fs.readFileSync(path.join(__dirname, '../js/briefing-archive.js'), 'utf8');
const archiveCss = fs.readFileSync(path.join(__dirname, '../css/briefing-archive.css'), 'utf8');
const template = archiveSrc.slice(archiveSrc.indexOf('    panel.innerHTML = '), archiveSrc.indexOf('    feed.insertBefore(panel, shelf);'));
assert(!template.includes('MARKET BRIEFING LIBRARY') && !template.includes('<h2>전체 브리핑 검색</h2>'));
assert(template.includes('ba-search-row') && template.includes('aria-label="전체 브리핑 검색"'));
assert(template.includes('ba-month-control" hidden>'));
assert(template.includes('ba-index-state') && template.includes('role="status"'));
assert(archiveSrc.includes("var month = panel.querySelector('.ba-month')"));
assert(archiveSrc.includes("month.addEventListener('change', update)"));
assert(archiveCss.includes('max-width: 720px') && archiveCss.includes('.ba-query { width: 100%; max-width: none; }'));
assert(archiveCss.includes('.ba-month-control[hidden] { display: none !important; }'));
