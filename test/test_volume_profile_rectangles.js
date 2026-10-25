'use strict';
require('./helpers/common_runtime');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const src = fs.readFileSync('js/stock-search.js', 'utf8');
const helpers = src.slice(src.indexOf('  var VP_CORE_RATIO'), src.indexOf('  function lwcBarsForProfile'));
const primitive = src.slice(src.indexOf('  function createVolumeProfilePrimitive'), src.indexOf('  function renderLwChart'));
const api = new Function('global', 'renderVpPanel', 'var lwcLiveBars = [];\n' + helpers + primitive + '\nreturn { computeVolumeProfile, createVolumeProfilePrimitive };')({}, () => {});
// Use deterministic OHLCV spanning many price levels to exercise coarse grouping.
const bars = Array.from({ length: 120 }, (_, i) => {
  const mid = 200000 + Math.sin(i / 15) * 40000;
  return { low: mid - 3000, high: mid + 3000, close: mid, volume: 1000 + i * 100 };
});
for (const isUs of [false, true]) {
  const rows = bars.map(b => Object.fromEntries(Object.entries(b).map(([k,v]) => [k, k === 'volume' ? v : v / (isUs ? 1000 : 1)])));
  const profile = api.computeVolumeProfile(rows, 0, isUs, 12);
  assert(profile.bins.length <= 12);
  assert(profile.bins.length >= 5);
  const total = rows.reduce((n,b) => n + b.volume, 0);
  assert(Math.abs(profile.bins.reduce((n,b) => n + b.volume, 0) - total) < total * 1e-9);
  for (const [width, height, dpr] of [[1000, 600, 1], [360, 300, 2]]) {
    const p = api.createVolumeProfilePrimitive(rows, isUs, 'test');
    p._series = { coordinateToPrice: y => (250000 - y / height * 100000) / (isUs ? 1000 : 1), priceToCoordinate: price => (250000 - price * (isUs ? 1000 : 1)) / 100000 * height };
    const rects = [];
    const ctx = { save() {}, restore() {}, fillRect(x,y,w,h) { rects.push({ x,y,w,h,color: this.fillStyle }); } };
    p.paneViews()[0].renderer().drawBackground({ useBitmapCoordinateSpace(fn) { fn({ context: ctx, horizontalPixelRatio: dpr, verticalPixelRatio: dpr, bitmapSize: { width: width*dpr, height: height*dpr }, mediaSize: { width, height } }); } });
    assert(rects.length > 0 && rects.length <= 12);
    const pink = rects.filter(r => r.color === 'rgba(236,72,153,0.42)');
    assert.equal(pink.length, 1);
    assert.equal(pink[0].w, width * dpr * .5);
    assert(rects.every(r => r.x === 0 && r.w <= width * dpr * .5 && r.h > 8 * dpr));
    assert(rects.every(r => r === pink[0] || r.color === 'rgba(56,169,225,0.28)'));
  }
}
console.log('volume profile rectangles: desktop/mobile, DPR, KR/US, volume conservation ok');
