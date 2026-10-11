/* 자동 파동(대·중·소) 시각 검증용 HTML 생성(검토 전용, 운영 화면과 무관):
 *   node auto_wave_preview.js bars.json out.html [--codes=005930,000660] [--names=names.json] [--major=8 --medium=3 --minor=1.5]
 * bars.json 은 { 종목코드: [{date,open,high,low,close,volume}, ...] } 모양이다. 종목마다 세 장을 그린다.
 *   1) 전체 기간 + 대파동 박스   2) 최근 약 2년 + 중파동 박스(대파동 윤곽은 옅게)   3) 최근 약 1년 + 소파동 박스(중파동 윤곽은 옅게)
 * 박스: 상승 빨강, 하락 파랑, 횡보 회색, 변동성 큰 박스권 보라 회색. 점선은 진행 중(미확정). 이동평균 60(연한 주황)·224(진한 주황). */
const fs = require('fs');
const { analyze } = require('../../js/auto-wave.js');

const args = process.argv.slice(2);
const flags = {};
args.filter((a) => a.startsWith('--')).forEach((a) => { const m = /^--([^=]+)=(.*)$/.exec(a); if (m) flags[m[1]] = m[2]; });
const pos = args.filter((a) => !a.startsWith('--'));
const data = JSON.parse(fs.readFileSync(pos[0], 'utf8'));
const names = flags.names ? JSON.parse(fs.readFileSync(flags.names, 'utf8')) : {};
const codes = flags.codes ? flags.codes.split(',') : Object.keys(data);
const options = { levels: {} };
['major', 'medium', 'minor'].forEach((l) => { if (flags[l]) options.levels[l] = { zigzagAtr: Number(flags[l]) }; });

const W = 1280, PAD = { l: 8, r: 64, t: 14, b: 22 };
const COL = {
  up: ['rgba(227,77,75,.13)', '#e34d4b'], down: ['rgba(38,116,217,.13)', '#2674d9'],
  side: ['rgba(120,120,120,.14)', '#808080'], wide: ['rgba(124,111,154,.12)', '#7c6f9a'], unk: ['rgba(160,160,160,.05)', '#a0a0a0']
};

function sma(bars, p) { return bars.map((b, i) => { if (i < p - 1) return null; let s = 0; for (let k = i - p + 1; k <= i; k++) s += bars[k].close; return s / p; }); }

function panel(bars, res, level, from, height, title, parentLevel) {
  const to = bars.length - 1;
  const idxs = []; for (let i = from; i <= to; i++) idxs.push(i);
  const view = bars.slice(from);
  let hi = Math.max(...view.map((b) => b.high)), lo = Math.min(...view.map((b) => b.low));
  const pad = (hi - lo) * 0.04; hi += pad; lo -= pad;
  const x = (i) => PAD.l + (i - from + 0.5) * (W - PAD.l - PAD.r) / view.length;
  const y = (p) => PAD.t + (hi - p) / (hi - lo) * (height - PAD.t - PAD.b);
  const bw = Math.max(1.2, (W - PAD.l - PAD.r) / view.length * 0.62);
  let svg = '';
  const ma60 = sma(bars, 60), ma224 = sma(bars, 224);
  [[ma60, '#f0b27a'], [ma224, '#d35400']].forEach(([arr, color]) => {
    let d = '';
    for (let i = from; i <= to; i++) if (arr[i] != null) d += (d ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(arr[i]).toFixed(1);
    if (d) svg += `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.2" opacity=".8"/>`;
  });
  if (parentLevel) {
    res.levels[parentLevel].filter((w) => !w.suppressed).forEach((w) => {
      if (w.end < from) return;
      const x1 = x(Math.max(w.start, from)) - bw / 2, x2 = x(w.end) + bw / 2;
      svg += `<rect x="${x1}" y="${y(w.high)}" width="${x2 - x1}" height="${y(w.low) - y(w.high)}" fill="none" stroke="${COL[w.kind][1]}" stroke-opacity=".28" stroke-dasharray="2 3"/>`;
    });
  }
  res.levels[level].filter((w) => !w.suppressed).forEach((w) => {
    if (w.end < from) return;
    const [fill, stroke] = COL[w.kind];
    const x1 = x(Math.max(w.start, from)) - bw / 2, x2 = x(w.end) + bw / 2, y1 = y(w.high), y2 = y(w.low);
    svg += `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" fill="${fill}" stroke="${stroke}" stroke-opacity="${w.confirmed ? .6 : .9}" ${w.confirmed ? '' : 'stroke-dasharray="5 4"'}/>`;
    if (x2 - x1 > 22) svg += `<text x="${x1 + 3}" y="${y1 + 11}" font-size="10" fill="${stroke}">${w.label || ''}${w.confirmed ? '' : '·진행'}</text>`;
  });
  view.forEach((b, k) => {
    const i = from + k, up = b.close >= b.open, c = up ? '#e34d4b' : '#2674d9';
    svg += `<line x1="${x(i)}" x2="${x(i)}" y1="${y(b.high)}" y2="${y(b.low)}" stroke="${c}" stroke-width="1"/>`;
    svg += `<rect x="${x(i) - bw / 2}" y="${y(Math.max(b.open, b.close))}" width="${bw}" height="${Math.max(1, Math.abs(y(b.open) - y(b.close)))}" fill="${c}"/>`;
  });
  // 날짜 눈금(분기)
  let lastKey = '';
  view.forEach((b, k) => {
    const key = b.date.slice(0, 7);
    if (key !== lastKey && /-(01|04|07|10)$/.test(key)) { svg += `<text x="${x(from + k)}" y="${height - 6}" font-size="10" fill="#888">${key}</text>`; lastKey = key; }
  });
  return `<div style="font:12px sans-serif;margin:6px 0 2px;color:#444">${title}</div><svg width="${W}" height="${height}" style="border:1px solid #ddd;background:#fff">${svg}</svg>`;
}

let html = '<!doctype html><meta charset="utf-8"><body style="font-family:MaruBuri,serif;margin:14px;background:#fff">';
codes.forEach((code) => {
  const bars = data[code];
  if (!bars) return;
  const res = analyze(bars, options);
  const counts = ['major', 'medium', 'minor'].map((l) => l + ' ' + res.levels[l].length).join(' · ');
  html += `<h3 style="margin:14px 0 2px">${names[code] || code} (${code}) · 일봉 ${bars.length}개 ${bars[0].date}~${bars[bars.length - 1].date} · ${counts} · 상태: ${res.state ? res.state.summaryText : '-'}</h3>`;
  html += panel(bars, res, 'major', 0, 280, '대파동 (전체 기간)', null);
  html += panel(bars, res, 'medium', Math.max(0, bars.length - 560), 330, '중파동 (최근 약 2년) · 점선 윤곽 = 대파동', 'major');
  html += panel(bars, res, 'minor', Math.max(0, bars.length - 260), 360, '소파동 (최근 약 1년) · 점선 윤곽 = 중파동', 'medium');
});
fs.writeFileSync(pos[1], html);
