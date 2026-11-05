'use strict';
require('./helpers/common_runtime');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const shared = fs.readFileSync('css/foreign-flow.css', 'utf8');
const my = fs.readFileSync('css/my-dashboard.css', 'utf8');
const render = fs.readFileSync('js/foreign-flow.js', 'utf8');
const view = fs.readFileSync('js/my-dashboard.js', 'utf8');

const from = shared.indexOf('/* 미니 매물대(2026-10-04)');
const to = shared.indexOf('#foreign-flow .ff-swing-fact b', from);
assert(from >= 0 && to > from, 'mini profile CSS section located');
const mini = shared.slice(from, to);
const scope = ':is(#foreign-flow, .ff-vp-host) ';
[
  '.ff-apt-split', '.ff-apt-mini', '.ff-apt-mini-title', '.ff-apt-mini-svg',
  '.ff-mini-bar.above', '.ff-mini-bar.below', '.ff-mini-bar.flat',
  '.ff-mini-cur', '.ff-mini-avg', '.ff-mini-cur-label', '.ff-apt-mini-note'
].forEach(name => {
  assert(mini.includes(scope + name), name + ': shared CSS needs MY host scope');
});
assert(!/(^|\n)\s*#foreign-flow\s+\.ff-(?:apt-split|apt-mini|mini-bar|mini-cur|mini-avg)/.test(mini),
  'mini CSS must not be restricted to foreign-flow only');
assert(mini.includes('fill: rgba(18, 97, 196') && mini.includes('fill: rgba(210, 79, 69'),
  'bar colors are explicitly defined so SVG does not default to black');
assert(mini.includes('grid-template-columns: minmax(0, 1fr) 150px'),
  'full width foreign-flow keeps its two-column mini chart');
assert(mini.includes('@media (max-width: 720px)') &&
  mini.includes('max-height: 220px'), 'mobile mini chart remains bounded');

assert(my.includes('#my-dashboard .ff-vp-host .ff-apt-split { grid-template-columns: minmax(0, 1fr)'),
  'MY two-column cards stack the mini under the price list');
assert(my.includes('width: 120px;') && my.includes('width: 96px;') &&
  my.includes('max-width: 100%;'), 'MY thumbnail is bounded on desktop and mobile');
assert(my.includes('html.dark #my-dashboard .ff-vp-host .ff-mini-cur'),
  'dark theme current price line stays legible');
assert(render.includes('<svg class="ff-apt-mini-svg" viewBox="0 0 ') &&
  render.includes('<rect class="ff-mini-bar '), 'shared SVG renderer unchanged');
assert(view.includes("api.renderVolumeProfileHtml(daily,") &&
  view.includes('class="ff-vp-host"'), 'MY still reuses shared volume profile renderer');
console.log('MY mini volume profile CSS: shared SVG fill + size + responsive + dark contract OK');
