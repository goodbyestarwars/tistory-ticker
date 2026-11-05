'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const skin=fs.readFileSync('skin.html','utf8');
const main=fs.readFileSync('js/skin-main.js','utf8');
const enhancements=fs.readFileSync('js/dashboard-enhancements.js','utf8');
const css=fs.readFileSync('css/home-market-board.css','utf8');
const pending=fs.readFileSync('docs/SKIN_HTML_PENDING.md','utf8');
// 이미 운영에 있던 HTML URL 쿼리 문자열은 JS/CSS 기능 배포의 선행 조건이 아니다.
assert(skin.includes('css/home-market-board.css?v=20261027-open-block-columns'));
assert(skin.includes('js/skin-main.js?v=20261025-countdown-module6'));
// 기존 경로를 유지하면서 JS/CSS 원본에 새 기능이 있어야 한다.
assert(main.includes('data-home-day-futures'));
assert(main.includes('USDKRW%2CKOSPI200_DAY&days=30&stored_only=true'));
assert(main.includes('dashboard-enhancements.js?v=20261105-chart-expand-segment'));
assert(enhancements.includes("expandSegment.className = 'nine-chart-expand-segment'"));
assert(css.includes('grid-template-columns: repeat(2, minmax(0, 1fr));'));
assert(!pending.includes('스킨 정적 자산 버전 갱신 필요'));
console.log('PASS: HTML URL unchanged, features deployed through JS/CSS, no forced Tistory manual change');
