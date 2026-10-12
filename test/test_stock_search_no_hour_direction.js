'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('js/stock-search.js', 'utf8');
const style = fs.readFileSync('css/stock-search.css', 'utf8');
const server = fs.readFileSync('scripts/cloud-vm/main.py', 'utf8');

test('stock search no longer renders or calls the one-hour direction feature', () => {
  for (const token of [
    '/hour-direction', 'hourCandidatesShell', 'checkHourCandidates',
    'renderHourCandidates', 'ssHourCandidates', 'data-hour-check', 'ss-hour-'
  ]) {
    assert.equal(source.includes(token), false, token);
  }
  assert.equal(style.includes('ss-hour-'), false);
});

test('server route is preserved while other consumers are reviewed separately', () => {
  assert.equal(server.includes('/hour-direction'), true);
});
