'use strict';
// 연구용(2026-11-20): 운영 검색기 5개 메뉴의 모양 선정(공통 js/auto-wave.js selectShapesOf)을
// 5년 일봉 캐시의 모든 종목·거래일에 그대로 적용해 신호 TSV로 낸다. t일 판정은 t일까지 최근 224봉만 쓴다(운영 shape_scan.py와 같은 창).
// 주문·VM과 무관. 설계·판정 기준: docs/SCANNER_MENU_SCORECARD_2026-11-20.md
// 실행: node menu_replay_batch.js <작업 폴더(cache/ 포함)> <out.tsv> [shard=0] [shards=1]
const fs = require('node:fs'), path = require('node:path');
const AW = require('../../js/auto-wave.js');
const [lab, out, shardArg, shardsArg] = process.argv.slice(2);
const WIN = 224, START = Number(process.env.START) || 224, CUTOFF = process.env.CUTOFF || '20261113';
const SHARD = Number(shardArg) || 0, SHARDS = Number(shardsArg) || 1;
const fd = fs.openSync(out, 'w');
fs.writeSync(fd, ['code', 'd', 'group', 'kind', 'stage', 'score'].join('\t') + '\n');
const files = fs.readdirSync(path.join(lab, 'cache')).filter(f => f.endsWith('.json')).sort()
  .filter((_, i) => i % SHARDS === SHARD);
let n = 0, hits = 0;
for (const f of files) {
  const px = JSON.parse(fs.readFileSync(path.join(lab, 'cache', f), 'utf8')).px
    .filter(r => r[0] < CUTOFF && r[1] > 0 && r[2] > 0 && r[3] > 0 && r[4] > 0);
  const bars = px.map(r => ({ date: r[0].slice(0, 4) + '-' + r[0].slice(4, 6) + '-' + r[0].slice(6, 8),
    open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] || 0 }));
  const lines = [];
  for (let i = Math.max(START, 23); i < bars.length; i++) {
    const sel = AW.selectShapesOf(bars.slice(Math.max(0, i - WIN + 1), i + 1));
    for (const group of Object.keys(sel || {})) {
      for (const d of sel[group] || []) {
        const kind = d.stage === 'extended' ? 'extended' : 'primary';
        lines.push([f.slice(0, 6), px[i][0], group, kind, d.stage || '', Number.isFinite(d.score) ? d.score : ''].join('\t'));
      }
    }
  }
  hits += lines.length;
  if (lines.length) fs.writeSync(fd, lines.join('\n') + '\n');
  if (++n % 200 === 0) console.log(n, 'files', hits, 'signals');
}
fs.closeSync(fd);
console.log('DONE', n, hits);
