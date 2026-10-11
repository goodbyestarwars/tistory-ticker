/* 이전 자동 파동(v1, scripts/analysis/legacy/auto-wave-v1.js: 단일 규모 + 약한 구간 병합)과 새 대·중·소 엔진을 같은 실제 차트 27개에서 비교한다.
 *   node scripts/analysis/auto_wave_old_vs_new.js
 * 항목: (1) 확정 파동이 뒤 자료로 바뀌는 비율(미래 참조·리페인트), (2) 약한 구간으로 버려지거나 박스로 합쳐진 스윙 수, (3) 수동 기준 대비 일치율. */
const path = require('path');
const { loadCases, loadRefs, match } = require('./auto_wave_eval.js');
const V1 = require('./legacy/auto-wave-v1.js');
const V2 = require('../../js/auto-wave.js');

const cases = loadCases(), refs = loadRefs(cases);
const ids = Object.keys(cases);

function v1Key(w) { return w.kind + '|' + w.start + '|' + w.end; }
function legKey(w) { return w.level + '|' + w.kind + '|' + w.start + '|' + w.end + '|' + w.startPrice + '|' + w.endPrice; }

let v1Checked = 0, v1Changed = 0, v2Checked = 0, v2Changed = 0;
let v1Weak = 0, v1Boxes = 0, v1Legs = 0, v1Total = 0;
let v2MinorLegs = 0, v2MediumLegs = 0, v2MajorLegs = 0, v2SuppressedMedium = 0;
ids.forEach((id) => {
  const bars = cases[id].bars;
  const full1 = V1.detectWaves(bars), set1 = {};
  full1.filter((w) => w.confirmed).forEach((w) => { set1[v1Key(w)] = 1; });
  const full2 = V2.analyze(bars), set2 = {};
  ['major', 'medium', 'minor'].forEach((lv) => full2.levels[lv].filter((w) => !w.isBox && w.confirmed).forEach((w) => { set2[legKey(w)] = 1; }));
  for (let t = 130; t < bars.length; t += 29) {
    V1.detectWaves(bars.slice(0, t + 1)).filter((w) => w.confirmed).forEach((w) => { v1Checked++; if (!set1[v1Key(w)]) v1Changed++; });
    const part = V2.analyze(bars.slice(0, t + 1));
    ['major', 'medium', 'minor'].forEach((lv) => part.levels[lv].filter((w) => !w.isBox && w.confirmed).forEach((w) => { v2Checked++; if (!set2[legKey(w)]) v2Changed++; }));
  }
  full1.forEach((w) => { v1Total++; if (w.kind === 'side' || w.kind === 'wide') v1Boxes++; else if (w.weak) v1Weak++; else v1Legs++; });
  v2MinorLegs += full2.levels.minor.filter((w) => !w.isBox).length;
  v2MediumLegs += full2.levels.medium.filter((w) => !w.isBox).length;
  v2MajorLegs += full2.levels.major.filter((w) => !w.isBox).length;
  v2SuppressedMedium += full2.levels.medium.filter((w) => w.suppressed).length;
});
console.log('## (1) 확정 파동이 뒤 자료로 바뀌는 비율 (실제 27개 차트, prefix 29봉 간격)');
console.log('이전(v1): 확정 파동 ' + v1Checked + '건 중 전체 분석에서 달라진 것 ' + v1Changed + '건 (' + (v1Changed / v1Checked * 100).toFixed(1) + '%)');
console.log('새 엔진 : 확정 파동 ' + v2Checked + '건 중 달라진 것 ' + v2Changed + '건 (' + (v2Changed / v2Checked * 100).toFixed(1) + '%)');
console.log('\n## (2) 파동 수와 구성');
console.log('이전(v1): 전체 ' + v1Total + '개 = 추세 파동 ' + v1Legs + ' + 약한 구간 ' + v1Weak + ' + 박스 ' + v1Boxes + ' (한 규모뿐)');
console.log('새 엔진 : 대 ' + v2MajorLegs + ' / 중 ' + v2MediumLegs + ' / 소 ' + v2MinorLegs + '개(박스 제외), 박스에 가려진 중파동 ' + v2SuppressedMedium + '개(소파동으로는 그대로 보임)');
console.log('\n## (3) 수동 기준 일치율 (중파동 허용 5봉 / 대파동 12봉)');
function recallV1(level, tol) {
  let man = 0, got = 0;
  ids.forEach((id) => {
    if (!refs[id]) return;
    const w = V1.detectWaves(cases[id].bars).filter((x) => !x.weak && (x.kind === 'up' || x.kind === 'down') && x.confirmed);
    const eng = []; w.forEach((x, i) => { if (i === 0) eng.push({ idx: x.start, type: x.kind === 'up' ? 'low' : 'high' }); eng.push({ idx: x.end, type: x.kind === 'up' ? 'high' : 'low' }); });
    const m = match(refs[id][level], eng, tol); man += refs[id][level].length; got += m.pairs.length;
  });
  return got + '/' + man + ' (' + (got / man * 100).toFixed(1) + '%)';
}
console.log('이전(v1) 중파동 기준 recall: ' + recallV1('medium', 5) + ' · 대파동 기준 recall: ' + recallV1('major', 12) + ' (v1 은 규모 구분이 없어 같은 파동 목록으로 비교)');
