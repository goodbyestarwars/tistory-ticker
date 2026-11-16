'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const assets = [
  ['js/skin-main.js', ['한국증시', '미국증시', '시간별 매매']],
  ['js/investor-flow.js', ['외국인', '기관', '개인', '전체 거래량', '미집계']],
  ['css/home-market-board.css', []],
  ['scripts/cloud-vm/investor_trend.py', []],
  ['scripts/cloud-vm/db_schema.py', []]
];
for (const [file, expected] of assets) {
  const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert(!text.includes('\uFFFD'), file + ': damaged Unicode replacement character');
  for (const label of expected) assert(text.includes(label), file + ': missing Korean label ' + label);
  if (file.endsWith('.js')) new Function(text);
}
console.log('PASS UTF-8 assets and Korean labels');
