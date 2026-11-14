'use strict';
// 연구용(2026-11-13): 사이트 공통 js/auto-wave.js 의 shapeOf(사람이 보는 일봉 모양)를
// edge_factor_study 캐시의 모든 종목·거래일에 그대로 적용해 TSV로 낸다. 주문·VM과 무관.
// 창 길이 40/80/120봉(약 2/4/6개월), t일 종가까지만 사용(미래 비참조).
// 실행: node shape_edge_batch.js <작업 폴더(cache/ 포함)> <out.tsv> [step=1]
const fs = require('node:fs'), path = require('node:path');
const AW = require('../../js/auto-wave.js');
const [lab, out, stepArg] = process.argv.slice(2);
const STEP = Number(stepArg) || 1, WINS = [40, 80, 120], START = 250, CUTOFF = '20261113';
const fd = fs.openSync(out, 'w');
fs.writeSync(fd, ['code', 'd'].concat(...WINS.map(w => ['t' + w, 's' + w, 'c' + w, 'h' + w])).join('\t') + '\n');
const files = fs.readdirSync(path.join(lab, 'cache')).filter(f => f.endsWith('.json')).sort();
let n = 0;
for (const f of files) {
  const px = JSON.parse(fs.readFileSync(path.join(lab, 'cache', f), 'utf8')).px
    .filter(r => r[0] < CUTOFF && r[1] > 0 && r[2] > 0 && r[3] > 0 && r[4] > 0);
  const closes = px.map(r => ({ date: r[0], close: r[4] }));
  const lines = [];
  for (let i = START; i < closes.length; i += STEP) {
    const row = [f.slice(0, 6), closes[i].date];
    for (const w of WINS) {
      const s = AW.shapeOf(closes.slice(i - w + 1, i + 1));
      row.push(s.type, s.score, s.coherence == null ? '' : s.coherence.toFixed(3), s.higherLows == null ? '' : s.higherLows);
    }
    lines.push(row.join('\t'));
  }
  if (lines.length) fs.writeSync(fd, lines.join('\n') + '\n');
  if (++n % 300 === 0) console.log(n, 'files');
}
fs.closeSync(fd);
console.log('DONE', n);
