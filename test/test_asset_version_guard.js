'use strict';
// 같은 에셋을 로더마다 다른 ?v= 로 요청하면 브라우저가 서로 다른 URL로 받아 두 번 실행할 수 있다.
// js/ 안에서는 에셋 경로당 버전 문자열이 하나여야 한다. (skin.html 은 고정본이라 제외)
const fs = require('fs'), path = require('path'), assert = require('assert');
const dir = path.join(__dirname, '..', 'js');
const pat = /((?:js|css|data)\/[A-Za-z0-9_./-]+\.(?:js|css))\?v=([0-9A-Za-z._-]+)/g;
const seen = new Map();
for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js'))) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  for (const m of text.matchAll(pat)) {
    if (!seen.has(m[1])) seen.set(m[1], new Map());
    const by = seen.get(m[1]);
    if (!by.has(m[2])) by.set(m[2], new Set());
    by.get(m[2]).add(f);
  }
}
const bad = [...seen].filter(([, v]) => v.size > 1)
  .map(([k, v]) => k + ' → ' + [...v].map(([ver, fs_]) => ver + ' (' + [...fs_].join(', ') + ')').join(' | '));
assert.deepStrictEqual(bad, [], '같은 에셋에 서로 다른 ?v= 가 있습니다:\n' + bad.join('\n'));
console.log('asset version guard ok: ' + seen.size + ' pinned assets, no divergent versions');
