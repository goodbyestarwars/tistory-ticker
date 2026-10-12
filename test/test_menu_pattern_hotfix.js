'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const menu = fs.readFileSync('js/skin-menu.js', 'utf8');
const siteCss = fs.readFileSync('style.css', 'utf8');
const pattern = fs.readFileSync('js/pattern-scan.js', 'utf8');
const patternCss = fs.readFileSync('css/pattern-scan.css', 'utf8');
const fullscreen = fs.readFileSync('js/dashboard-enhancements.js', 'utf8');

test('desktop dropdown visibility has one JS-owned state', () => {
  assert.match(menu, /function openDropdown\(mount, group\)/);
  assert.match(menu, /pointerover/);
  assert.match(menu, /focusin/);
  assert.match(menu, /event\.key === 'Escape'/);
  assert.doesNotMatch(siteCss, /nav-group:hover[^\n]*> \.nav-dropdown/);
  assert.doesNotMatch(siteCss, /nav-group:focus-within[^\n]*> \.nav-dropdown/);
  assert.match(siteCss, /nav-group\.is-open > \.nav-dropdown/);
});

test('pattern detail switches stocks and rejects stale responses', () => {
  for (const token of ['data-ps-chart-prev', 'data-ps-chart-select', 'data-ps-chart-next', 'detailRequestSeq', 'requestSeq !== detailRequestSeq']) {
    assert.ok(pattern.includes(token), token);
  }
  assert.match(pattern, /destroyPsChart\(\);[\s\S]*차트를 불러오는 중/);
  assert.match(patternCss, /\.ps-chart-switcher/);
});

test('shared fullscreen module owns psChart without a second engine', () => {
  assert.match(fullscreen, /#pattern-scan #psChart/);
  assert.match(fullscreen, /target\.closest\('#psDetail'\)/);
  assert.match(fullscreen, /patternRoot\.id = 'pattern-scan-original'/);
  assert.match(fullscreen, /patternRoot\.id = 'pattern-scan'/);
});
