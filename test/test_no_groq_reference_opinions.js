'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = path => fs.readFileSync(path, 'utf8');
test('major news hover uses white in light and dark card in dark', () => {
  const css = read('css/main-news.css');
  assert.match(css, /#main-news a\.mn-row:hover,[\s\S]*?background:\s*#fff\s*;/);
  assert.match(css, /html\.dark #main-news a\.mn-row:focus-visible\s*\{\s*background:\s*var\(--dk-card\)\s*;/);
});
test('stock news and stock-search no longer render Groq opinions', () => {
  assert.doesNotMatch(read('js/stock-news.js'), /sn-ai-summary|SN_AI_ICON|aiSummary/);
  assert.doesNotMatch(read('js/stock-search.js'), /ssSummaryReason|loadPriceReason|action=priceReason/);
});
test('global market and flow do not call Groq opinions', () => {
  assert.doesNotMatch(read('js/overnight-market.js'), /id="omAi"|renderAiSummary|action=subIndexAnalysis/);
  assert.doesNotMatch(read('js/foreign-flow.js'), /id="ffAiSummary"|loadPanelOpinion|loadAiSummary|action=flowAiSummary/);
});
test('GAS and VM never start a Groq opinion generation', () => {
  const gas = read('gas/ticker-proxy.gs');
  assert.doesNotMatch(gas, /https:\/\/api\.groq\.com/);
  assert.match(gas, /function callGroq\(prompt, temperature\)\s*\{\s*return null;\s*\}/);
  assert.match(gas, /function callGroqJson_\(system, user, maxTokens\)\s*\{\s*return null;\s*\}/);
  assert.doesNotMatch(read('scripts/cloud-vm/main.py'), /\bai_comments\.start_background\s*\(/);
  assert.match(read('js/market-temp.js'), /var AI_CARD_COMMENTS_ = false;/);
});
