/* 자동 파동(대·중·소) 검증: 실제 차트 27개의 수동 기준과 알고리즘 결과를 대조하고, 파라미터(ATR 배수) 후보를 비교하며,
 * "그 시점까지의 자료만으로 낸 결과(as-of)"와 "전체 자료로 낸 결과(hindsight)"가 얼마나 다른지 잰다. 검토 전용(운영 화면·주문과 무관).
 *
 *   node scripts/analysis/auto_wave_eval.js ref            # 기본 파라미터로 사례별 recall/extra 표
 *   node scripts/analysis/auto_wave_eval.js grid           # 대·중 ATR 배수 후보 비교
 *   node scripts/analysis/auto_wave_eval.js asof [step=20] # 봉마다(step 간격) prefix 분석과 전체 분석의 확정 파동 비교 + 지연 통계
 *   node scripts/analysis/auto_wave_eval.js miss [major|medium] # 놓친 수동 극점 목록(마지막 확정 극점 이후 구간인지 표시)
 *
 * 수동 기준(test/fixtures/wave/manual_reference.txt)은 작성자(Claude)가 차트와 독립 프랙탈 후보표를 대조해 고른 값이며 외부 전문가 검증이 아니다.
 * 일치 판정: 같은 종류(고점/저점)이고 날짜 차이가 허용 봉 수 이하(대 12봉, 중 5봉)인 가장 가까운 한 쌍(일대일). */
const fs = require('fs');
const path = require('path');
const { analyze } = require('../../js/auto-wave.js');

const FIX = path.join(__dirname, '..', '..', 'test', 'fixtures', 'wave');
const TOL = { major: 12, medium: 5 };

function loadCases() {
  const raw = JSON.parse(fs.readFileSync(path.join(FIX, 'cases_bars.json'), 'utf8'));
  const out = {};
  Object.keys(raw).forEach((id) => {
    out[id] = { id, name: raw[id].name, category: raw[id].category, bars: raw[id].bars.map((r) => ({ date: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] })) };
  });
  return out;
}

function loadRefs(cases) {
  const refs = {};
  fs.readFileSync(path.join(FIX, 'manual_reference.txt'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).forEach((line) => {
    const parts = line.split('|').map((s) => s.trim());
    const id = parts[0], c = cases[id];
    if (!c) return;
    const byDate = {};
    c.bars.forEach((b, i) => { byDate[b.date] = i; });
    refs[id] = {};
    ['major', 'medium'].forEach((lvl) => {
      const seg = parts.find((p) => p.startsWith(lvl + ':'));
      refs[id][lvl] = !seg ? [] : seg.slice(lvl.length + 1).trim().split(/\s+/).filter(Boolean).map((t) => {
        const m = /^(\d{4}-\d{2}-\d{2})([HL])$/.exec(t);
        return { idx: byDate[m[1]], type: m[2] === 'H' ? 'high' : 'low' };
      });
    });
  });
  return refs;
}

/* 확정 파동(박스 제외)의 끝점으로 극점 목록을 만든다: 첫 파동의 시작점 + 각 파동의 끝점. */
function pivotsOf(res, level) {
  const legs = res.levels[level].filter((w) => !w.isBox && w.confirmed).sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];
  const seen = {};
  function add(idx, type, confirmedIndex) { const k = idx + type; if (seen[k]) return; seen[k] = 1; out.push({ idx: idx, type: type, confirmedIndex: confirmedIndex }); }
  legs.forEach((l, i) => {
    if (i === 0 || legs[i - 1].end !== l.start) add(l.start, l.kind === 'up' ? 'low' : 'high', l.startConfirmedIndex);
    add(l.end, l.kind === 'up' ? 'high' : 'low', l.confirmedIndex);
  });
  return out.sort((a, b) => a.idx - b.idx);
}

function match(manual, eng, tol) {
  const used = {}, pairs = [];
  manual.forEach((m, mi) => {
    let best = -1, bd = Infinity;
    eng.forEach((e, ei) => { if (used[ei] || e.type !== m.type) return; const d = Math.abs(e.idx - m.idx); if (d <= tol && d < bd) { bd = d; best = ei; } });
    if (best >= 0) { used[best] = true; pairs.push({ mi: mi, ei: best, d: bd }); }
  });
  return { pairs: pairs, usedEng: used };
}

function evalCase(c, ref, options, level) {
  const res = analyze(c.bars, options);
  const eng = pivotsOf(res, level), man = ref[level];
  const tol = TOL[level];
  const mm = match(man, eng, tol);
  const lo = man.length ? man[0].idx - tol : 0, hi = man.length ? man[man.length - 1].idx + tol : 0;
  const inSpan = eng.filter((e) => e.idx >= lo && e.idx <= hi);
  const extra = inSpan.filter((e, k) => { const ei = eng.indexOf(e); return !mm.usedEng[ei]; }).length;
  const lag = mm.pairs.map((p) => eng[p.ei].confirmedIndex - eng[p.ei].idx);
  // 알고리즘이 마지막으로 확정한 극점 이후의 수동 극점은 아직 되돌림이 확인될 수 없는 '진행 중 극점'이라 따로 센다(놓친 것이 아니라 확정 전).
  const lastEng = eng.length ? eng[eng.length - 1].idx : -1;
  const tail = man.filter((p) => p.idx > lastEng + tol).length;
  const matchedCore = mm.pairs.filter((p) => man[p.mi].idx <= lastEng + tol).length;
  return { man: man.length, eng: eng.length, matched: mm.pairs.length, extra: extra, inSpan: inSpan.length, lag: lag, dist: mm.pairs.map((p) => p.d), tail: tail, matchedCore: matchedCore, pairs: mm.pairs, engPivots: eng, manPivots: man, tol: tol };
}

function summarizeLevel(cases, refs, options, level) {
  let man = 0, matched = 0, extra = 0, inSpan = 0, tail = 0, matchedCore = 0; const lags = [], dists = [];
  Object.keys(refs).forEach((id) => {
    const r = evalCase(cases[id], refs[id], options, level);
    man += r.man; matched += r.matched; extra += r.extra; inSpan += r.inSpan; tail += r.tail; matchedCore += r.matchedCore; r.lag.forEach((x) => lags.push(x)); r.dist.forEach((x) => dists.push(x));
  });
  const avg = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  const med = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const core = man - tail;
  return { man: man, matched: matched, tail: tail, core: core, recallCore: core ? matchedCore / core : 0, recall: man ? matched / man : 0, extra: extra, engInSpan: inSpan, precision: inSpan ? matched / inSpan : 0, extraPerManual: man ? extra / man : 0, lagMed: med(lags), lagAvg: avg(lags), distAvg: avg(dists) };
}

const pct = (x) => (x * 100).toFixed(1) + '%';

function modeRef() {
  const cases = loadCases(), refs = loadRefs(cases);
  console.log('사례 ' + Object.keys(refs).length + '개, 기본 파라미터 (대 8.0 / 중 3.0 / 소 1.5)');
  ['major', 'medium'].forEach((level) => {
    console.log('\n## ' + level + ' (일치 허용 ' + TOL[level] + '봉)');
    console.log('| 사례 | 분류 | 수동 | 알고리즘 | 일치 | 놓침 | 초과 | 확정 지연(봉) |');
    console.log('|---|---|---|---|---|---|---|---|');
    Object.keys(refs).forEach((id) => {
      const r = evalCase(cases[id], refs[id], undefined, level);
      const lag = r.lag.length ? Math.round(r.lag.reduce((s, x) => s + x, 0) / r.lag.length) : '-';
      console.log('| ' + id + ' | ' + cases[id].category + ' | ' + r.man + ' | ' + r.eng + ' | ' + r.matched + ' | ' + (r.man - r.matched) + ' | ' + r.extra + ' | ' + lag + ' |');
    });
    const s = summarizeLevel(cases, refs, undefined, level);
    console.log('\n합계: 수동 ' + s.man + ', 일치 ' + s.matched + ' (recall ' + pct(s.recall) + '; 확정 전 진행 중 극점 ' + s.tail + '개를 빼면 ' + pct(s.recallCore) + '), 기준 구간 안 알고리즘 극점 ' + s.engInSpan + ' 중 초과 ' + s.extra + ' (precision ' + pct(s.precision) + '), 확정 지연 중앙값 ' + s.lagMed + '봉 / 평균 ' + s.lagAvg.toFixed(1) + '봉, 일치 거리 평균 ' + s.distAvg.toFixed(1) + '봉');
  });
}

function modeGrid() {
  const cases = loadCases(), refs = loadRefs(cases);
  const grids = { major: [5, 6, 7, 8, 10, 12], medium: [2, 2.5, 3, 3.5, 4, 5] };
  ['major', 'medium'].forEach((level) => {
    console.log('\n## ' + level + ' ATR 배수 후보 (기준 ' + Object.keys(refs).length + '개 사례)');
    console.log('| ATR 배수 | recall | precision | 초과/수동 | 확정 지연 중앙값(봉) |');
    console.log('|---|---|---|---|---|');
    grids[level].forEach((k) => {
      const options = { levels: {} }; options.levels[level] = { zigzagAtr: k };
      const s = summarizeLevel(cases, refs, options, level);
      console.log('| ' + k + ' | ' + pct(s.recall) + ' | ' + pct(s.precision) + ' | ' + s.extraPerManual.toFixed(2) + ' | ' + s.lagMed + ' |');
    });
  });
}

/* as-of: 봉 t 까지만 넣어 분석한 결과의 확정 파동이, 전체 분석 결과에서도 같은 모양(구간·가격·확정 시점)으로 남는지 본다. */
function key(w) { return w.level + '|' + w.kind + '|' + w.start + '|' + w.end + '|' + w.startPrice + '|' + w.endPrice + '|' + w.startConfirmedIndex + '|' + w.confirmedIndex; }

function modeAsOf(step) {
  const cases = loadCases();
  let checked = 0, mismatched = 0, prefixes = 0;
  const lateness = { major: [], medium: [], minor: [] };
  Object.keys(cases).forEach((id) => {
    const bars = cases[id].bars, full = analyze(bars);
    const fullKeys = {};
    ['major', 'medium', 'minor'].forEach((lv) => full.levels[lv].filter((w) => !w.isBox && w.confirmed).forEach((w) => { fullKeys[key(w)] = 1; lateness[lv].push(w.confirmedIndex - w.end); }));
    for (let t = 120; t < bars.length; t += step) {
      const part = analyze(bars.slice(0, t + 1)); prefixes++;
      ['major', 'medium', 'minor'].forEach((lv) => part.levels[lv].filter((w) => !w.isBox && w.confirmed).forEach((w) => {
        checked++;
        if (!fullKeys[key(w)]) { mismatched++; }
      }));
    }
  });
  console.log('prefix ' + prefixes + '개, 확정 파동 ' + checked + '건 비교, 전체 결과와 모양이 달라진 건수 ' + mismatched);
  ['major', 'medium', 'minor'].forEach((lv) => {
    const a = lateness[lv].slice().sort((x, y) => x - y);
    if (!a.length) return;
    console.log(lv + ' 확정 지연(극점→확정 봉 수) 중앙값 ' + a[Math.floor(a.length / 2)] + ', 90% ' + a[Math.floor(a.length * 0.9)] + ', 최대 ' + a[a.length - 1] + ' (n=' + a.length + ')');
  });
}

function modeMiss(level) {
  const cases = loadCases(), refs = loadRefs(cases), tol = TOL[level];
  const rows = []; let n = 0, tailN = 0;
  Object.keys(refs).forEach((id) => {
    const r = evalCase(cases[id], refs[id], undefined, level), got = {};
    r.pairs.forEach((p) => { got[p.mi] = true; });
    const lastEng = r.engPivots.length ? r.engPivots[r.engPivots.length - 1].idx : -1;
    r.manPivots.forEach((p, i) => {
      if (got[i]) return;
      n++;
      const tail = p.idx > lastEng + tol; if (tail) tailN++;
      const near = r.engPivots.filter((e) => Math.abs(e.idx - p.idx) <= tol * 3).map((e) => cases[id].bars[e.idx].date + (e.type === 'high' ? 'H' : 'L')).join(',');
      rows.push(id + ' ' + cases[id].bars[p.idx].date + (p.type === 'high' ? 'H' : 'L') + (tail ? ' [확정 전 구간]' : '') + ' | 근처 알고리즘 극점: ' + (near || '-'));
    });
  });
  console.log(level + ' 놓친 수동 극점 ' + n + '개 (확정 전 구간 ' + tailN + '개 포함)');
  console.log(rows.join('\n'));
}

if (require.main === module) {
  const mode = process.argv[2] || 'ref';
  if (mode === 'ref') modeRef();
  else if (mode === 'grid') modeGrid();
  else if (mode === 'asof') modeAsOf(Number(process.argv[3] || 20));
  else if (mode === 'miss') modeMiss(process.argv[3] || 'major');
  else console.log('usage: auto_wave_eval.js ref|grid|asof [step]');
}
module.exports = { loadCases, loadRefs, pivotsOf, match, evalCase, summarizeLevel, key };
