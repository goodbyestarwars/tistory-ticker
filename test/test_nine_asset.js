'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'skin-shell.js'), 'utf8');
function load(src) {
  const ctx = { document: { currentScript: src ? { src } : null }, console, setTimeout, clearTimeout };
  ctx.window = ctx; vm.createContext(ctx);
  try { vm.runInContext(code, ctx, { timeout: 2000 }); } catch (e) { /* DOM 의존 구간은 무시 */ }
  return ctx.NineAsset;
}
const pages = 'https://goodbyestarwars.github.io/tistory-ticker/';
assert.strictEqual(load(pages + 'js/skin-shell.js?v=1').base, pages, '운영 주소에서 유도');
assert.strictEqual(load('http://localhost:8000/js/skin-shell.js').base, 'http://localhost:8000/', '로컬 서버 유도');
assert.strictEqual(load(null).base, pages, 'currentScript 없으면 운영 기본값');
assert.strictEqual(load(pages + 'js/skin-shell.js').url('/js/a.js'), pages + 'js/a.js');
console.log('NineAsset ok');
