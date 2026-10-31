#!/usr/bin/env node
/* 이야기 시리즈(learn/*.html) 전체 검색 색인을 만든다 -> data/learn-search.js
   사용: node scripts/build_learn_search.js         (파일 갱신)
         node scripts/build_learn_search.js --check  (색인이 최신인지만 확인, 다르면 종료코드 1)
   learn/ 본문이나 data/glossary.js를 고친 뒤에는 반드시 다시 실행한다(test_learn_search.py가 최신 여부를 검사한다).
   색인은 단락(h2 구간) 단위다: { u: 페이지, t: 페이지 제목, h: 단락 제목, i: 단락 id, x: 본문 }.
   금융용어사전의 용어는 별도 배열(g)로 넣어 learn/glossary.html#gl-용어 로 바로 연결한다. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const LEARN = path.join(ROOT, 'learn');
const OUT = path.join(ROOT, 'data', 'learn-search.js');

function decode(s) {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function plain(html) {
  // 그림(svg)은 라벨이 흩어져 있어 설명문(aria-label)만 본문 대신 쓴다.
  html = html.replace(/<svg[^>]*aria-label="([^"]*)"[\s\S]*?<\/svg>/g, ' $1 ');
  html = html.replace(/<svg[\s\S]*?<\/svg>/g, ' ');
  html = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ');
  html = html.replace(/<\/(p|li|tr|h[1-6]|div|figcaption|section|td|th)>/g, ' ');
  return decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function pageEntries(file) {
  const html = fs.readFileSync(path.join(LEARN, file), 'utf8');
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  const title = h1 ? plain(h1[1]) : file;
  const start = html.indexOf('<div class="legal-wrap">');
  let body = html.slice(start < 0 ? 0 : start);
  const end = body.search(/<div class="learn-nav">|<div class="legal-contact">|<script/);
  if (end > 0) body = body.slice(0, end);
  body = body.replace(/<a class="legal-back"[\s\S]*?<\/a>/g, '').replace(/<h1[\s\S]*?<\/h1>/, '');
  const re = /<h2([^>]*)>([\s\S]*?)<\/h2>/g;
  const marks = [];
  let m;
  while ((m = re.exec(body))) {
    const id = /id="([^"]+)"/.exec(m[1]);
    marks.push({ at: m.index, after: re.lastIndex, id: id ? id[1] : '', h: plain(m[2]) });
  }
  const out = [];
  const intro = plain(body.slice(0, marks.length ? marks[0].at : body.length));
  if (intro) out.push({ u: file, t: title, h: '', i: '', x: intro });
  marks.forEach((k, n) => {
    const text = plain(body.slice(k.after, n + 1 < marks.length ? marks[n + 1].at : body.length));
    out.push({ u: file, t: title, h: k.h, i: k.id, x: text });
  });
  return out;
}

function glossaryEntries() {
  const src = fs.readFileSync(path.join(ROOT, 'data', 'glossary.js'), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox);
  const g = sandbox.window.NINE_GLOSSARY || { terms: [] };
  return g.terms.map(x => ({ n: x.t, e: x.en || '', c: x.cat || '', x: [x.d, x.ex, x.use].filter(Boolean).join(' ') }));
}

function build() {
  const files = fs.readdirSync(LEARN).filter(f => f.endsWith('.html')).sort();
  const s = [];
  files.forEach(f => {
    // 용어사전 본문은 스크립트가 그리므로 용어는 아래 g 배열로 따로 담는다.
    pageEntries(f).forEach(e => s.push(e));
  });
  const data = { s, g: glossaryEntries() };
  return '/* 이야기 시리즈 전체 검색 색인 - scripts/build_learn_search.js가 만든다. 직접 고치지 않는다. */\n' +
    'window.NINE_LEARN_SEARCH = ' + JSON.stringify(data) + ';\n';
}

const next = build();
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur !== next) { console.error('data/learn-search.js가 최신이 아니다. node scripts/build_learn_search.js 를 실행한다.'); process.exit(1); }
  console.log('learn-search 색인 최신');
} else {
  fs.writeFileSync(OUT, next);
  console.log('wrote ' + path.relative(ROOT, OUT) + ' (' + Buffer.byteLength(next) + ' bytes)');
}
