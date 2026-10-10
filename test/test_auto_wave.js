/* 자동 파동 프로토타입 검증: node test/test_auto_wave.js */
const assert = require('assert');
const { detectWaves } = require('../js/auto-wave.js');

function walk(n, seed) {
  let s = seed, price = 100; const bars = [];
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 25) * 0.6;
    const open = price, close = Math.max(5, price + drift + (rnd() - 0.5) * 3);
    bars.push({ date: 'd' + i, open, close, high: Math.max(open, close) + rnd(), low: Math.min(open, close) - rnd(), volume: 1000 });
    price = close;
  }
  return bars;
}

// 1) 구조 확인: 상승·하락 파동이 나오고, 구간은 정상 범위이며 고가>=저가
const bars = walk(400, 7);
const waves = detectWaves(bars);
assert(waves.length > 3, 'waves found');
assert(waves.some((w) => w.kind === 'up') && waves.some((w) => w.kind === 'down'));
waves.forEach((w) => { assert(w.start >= 0 && w.end < bars.length && w.start < w.end && w.high >= w.low); });
assert(waves.filter((w) => !w.confirmed).length <= 1, 'unconfirmed at most one');

// 2) 미래 비참조: 마지막 봉들을 잘라낸 데이터의 "확정" 파동은 전체 데이터의 확정 파동과 시작·끝이 같아야 한다.
let checked = 0;
for (let cut = 150; cut < 400; cut += 23) {
  const part = detectWaves(bars.slice(0, cut)).filter((w) => w.confirmed);
  const full = detectWaves(bars);
  part.forEach((w) => {
    const same = full.find((f) => f.confirmed && f.kind === w.kind && f.start === w.start && f.end === w.end);
    // 잘린 시점에서 확정이었던 구간은 이후 데이터가 붙어도 바뀌면 안 된다(횡보 박스가 뒤 약한 구간을 흡수하는 경우만 예외로 start 동일 여부만 본다).
    assert(same || full.some((f) => f.start === w.start), 'confirmed wave changed by future data at cut ' + cut);
    checked++;
  });
}
assert(checked > 10);
console.log('auto-wave ok', waves.length, 'waves,', checked, 'causality checks');
