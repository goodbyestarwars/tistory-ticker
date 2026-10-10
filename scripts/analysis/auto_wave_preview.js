/* 자동 파동 박스 시각 검증용 HTML 생성(검토 전용): node auto_wave_preview.js bars.json out.html */
const fs = require('fs');
const { detectWaves } = require('../../js/auto-wave.js');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const names = { '005930': '삼성전자', '000660': 'SK하이닉스', '247540': '에코프로비엠' };
const W = 1200, H = 380, PAD = { l: 8, r: 60, t: 12, b: 20 };
const COL = { up: ['rgba(227,77,75,.13)', '#e34d4b'], down: ['rgba(38,116,217,.13)', '#2674d9'], side: ['rgba(120,120,120,.14)', '#888'] };
const LABEL = { up: '상승 파동', down: '하락 파동', side: '횡보·응축' };
let html = '<!doctype html><meta charset="utf-8"><body style="font-family:MaruBuri,serif;margin:16px;background:#fff">';
Object.keys(data).forEach((code) => {
  const bars = data[code], waves = detectWaves(bars);
  const hi = Math.max(...bars.map((b) => b.high)), lo = Math.min(...bars.map((b) => b.low));
  const x = (i) => PAD.l + (i + 0.5) * (W - PAD.l - PAD.r) / bars.length;
  const y = (p) => PAD.t + (hi - p) / (hi - lo) * (H - PAD.t - PAD.b);
  const bw = Math.max(1.5, (W - PAD.l - PAD.r) / bars.length * 0.6);
  let svg = '';
  waves.forEach((w) => {
    const [fill, stroke] = COL[w.kind];
    const x1 = x(w.start) - bw / 2, x2 = x(w.end) + bw / 2, y1 = y(w.high), y2 = y(w.low);
    svg += `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" fill="${fill}" stroke="${stroke}" stroke-opacity="${w.confirmed ? .55 : .8}" ${w.confirmed ? '' : 'stroke-dasharray="5 4"'}/>`;
    svg += `<text x="${x1 + 4}" y="${y1 + 13}" font-size="11" fill="${stroke}">${LABEL[w.kind]}${w.confirmed ? '' : ' (진행 중·미확정)'}</text>`;
  });
  bars.forEach((b, i) => {
    const up = b.close >= b.open, c = up ? '#e34d4b' : '#2674d9';
    svg += `<line x1="${x(i)}" x2="${x(i)}" y1="${y(b.high)}" y2="${y(b.low)}" stroke="${c}" stroke-width="1"/>`;
    svg += `<rect x="${x(i) - bw / 2}" y="${y(Math.max(b.open, b.close))}" width="${bw}" height="${Math.max(1, Math.abs(y(b.open) - y(b.close)))}" fill="${c}"/>`;
  });
  html += `<h3 style="margin:14px 0 4px">${names[code] || code} (${code}) · 일봉 ${bars.length}개 · 박스 ${waves.length}개 (${bars[0].date} ~ ${bars[bars.length - 1].date})</h3><svg width="${W}" height="${H}" style="border:1px solid #ddd">${svg}</svg>`;
});
fs.writeFileSync(process.argv[3], html);
