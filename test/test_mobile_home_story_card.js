/* 모바일 경제이야기 이중 테두리·상단 패딩 회귀 검증.
 * node test/test_mobile_home_story_card.js */
'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const js = fs.readFileSync('js/home-mobile-tabs.js', 'utf8');
const css = fs.readFileSync('css/home-mobile-tabs.css', 'utf8');
const style = fs.readFileSync('style.css', 'utf8');
const shell = fs.readFileSync('js/skin-shell.js', 'utf8');
assert.match(js, /mount\.className\s*=\s*'home-story-section'/);
assert.doesNotMatch(js, /mount\.className\s*=\s*'[^']*\bhome-widget\b/);
assert.match(style, /:where\(\.home-widget, \.home-realtime-board, \.home-economic-news\)\s*\{\s*padding:\s*56px/);
assert.match(shell, /<nav class="site-footer-links site-footer-learn"/);
assert.match(css, /body\.m-tabs #homeStorySeries > nav\.site-footer-learn\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*padding:\s*var\(--ui-card-padding\);/);
assert.match(js, /mount\.appendChild\(node\)/);
assert.match(js, /footer\.insertBefore\(node, storySlot\)/);
assert.match(js, /storySlot\.remove\(\)/);
assert.match(js, /if \(modeKey === 'open'\) adoptStory\(\)/);
assert.match(js, /\['\.learn-card-grid', ''\]/);
assert.match(css, /@media \(max-width: 720px\)/);
assert.doesNotMatch(css, /!important/);
// 책 모양(2026-11-12): 표지·목차·쪽수 마크업과 부록(금융용어사전) 장 번호 제외.
assert.match(shell, /<span class="learn-volume">전 11장<\/span>/);
assert.match(shell, /<div class="learn-toc-head" aria-hidden="true">/);
assert.match(shell, /data-learn-prev[^>]*>←<\/button><span class="learn-page-count"/);
assert.equal((shell.match(/<a class="learn-card"/g) || []).length, 12);
assert.match(style, /a\.learn-card\[href\$="\/glossary\.html"\] \{ counter-increment:none!important; \}/);
assert.match(style, /content:"제" counter\(story\) "장"!important/);
console.log('모바일 경제이야기 단일 카드·공통 패딩·이동/복원 검증 통과');
