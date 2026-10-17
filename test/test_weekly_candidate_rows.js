const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'home-weekly-report.js'), 'utf8');
const rowsSource = source.slice(source.indexOf('  function candidateRows('), source.indexOf('  // 2026-10-18 사용자 지적', source.indexOf('  function candidateRows(')));
const candidateRows = new Function('escapeHtml', 'signClass', 'signed', 'formatStockPrice', rowsSource + '\nreturn candidateRows;')(
  value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
  () => 'is-up',
  value => String(value ?? ''),
  () => '1,000원'
);

const stock = {
  code: '005930', name: '삼성전자', changeRate: 1,
  waves: { mid: '상승 추세', small: '상승 추세' },
  momentum: '강화', fundamental: '지지', risk: '없음'
};
const html = candidateRows(Array(6).fill(stock));
assert.equal((html.match(/<li>/g) || []).length, 5);
assert.match(html, /선정 근거 · 중기 상승 · 단기 상승 · 수급 강화 · 펀더멘털 지지 · 위험 없음/);
assert.doesNotMatch(candidateRows([{ ...stock, momentum: '약화', fundamental: '부담', risk: '주의' }]), /수급 강화|펀더멘털 지지|위험 없음/);
assert.doesNotMatch(candidateRows([{ ...stock, waves: {}, momentum: null, fundamental: null, risk: null }]), /선정 근거/);
assert.match(candidateRows([]), /현재 조건 충족 후보 없음/);
console.log('weekly candidate rows: passed');
