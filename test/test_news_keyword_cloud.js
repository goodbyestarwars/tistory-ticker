'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const scope = {window:{}, Set, Map}; vm.runInNewContext(fs.readFileSync('js/news-keyword-cloud.js','utf8'),scope);
const cloud = scope.window.NineKeywordCloud;
const title = row => row.title_ko || row.title;
const safe = url => /^https?:\/\//.test(url || '') ? url : '';
const row = (text,i,extra={}) => ({title:text,link:'https://example.test/'+i,...extra});
test('each repeated term counts once per deduplicated article, not word occurrences',()=>{
  const data=cloud.fromHeadlines([row('반도체 AI AI 투자',1),row('반도체 AI 실적',2),row('반도체 AI 실적!',3),row('반도체 AI 수출',1)],title,safe);
  assert.equal(data.articleCount,2);
  assert.equal(data.keywords.find(w=>w.text==='AI').count,2);
  assert.equal(data.keywords.find(w=>w.text==='반도체').articles.length,2);
});
test('translated display title is used; unsafe URLs and email/URL fragments are excluded',()=>{
  const data=cloud.fromHeadlines([row('original',1,{title_ko:'반도체 AI 정책 abc@example.com https://evil.test'}),row('반도체 AI 전망',2),row('반도체 AI',3,{link:'javascript:alert(1)'})],title,safe);
  assert.equal(data.articleCount,2);
  assert.deepEqual(Array.from(data.keywords,w=>w.text).sort(),['AI','반도체'].sort());
  assert(data.keywords.every(w=>w.articles.every(a=>a.url.startsWith('https://'))));
});
test('empty/single/boilerplate articles never create synthetic popular words',()=>{
  for(const items of [[],[row('반도체 AI 투자',1)],[row('속보 시장 전망',1),row('속보 시장 전망 변화',2)]]){
    assert.equal(cloud.fromHeadlines(items,title,safe).keywords.length,0);
  }
});
test('separate market inputs stay separate and evidence uses the original safe article',()=>{
  const kr=[row('반도체 수출',1),row('반도체 실적',2)], us=[row('금리 정책',3),row('금리 결정',4)];
  assert.equal(cloud.fromHeadlines(kr,title,safe).keywords[0].text,'반도체');
  assert.equal(cloud.fromHeadlines(us,title,safe).keywords[0].text,'금리');
});
