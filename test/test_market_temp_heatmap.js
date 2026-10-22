/* 증시온도 히트맵(js/market-temp.js) 색·범례·증감 검증 - 실행: node test/test_market_temp_heatmap.js
 * js/market-temp.js 는 IIFE 라 필요한 함수만 소스에서 잘라 vm 에서 실행한다(함수 본문은 그대로). */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync('js/market-temp.js', 'utf8');

function grab(startMarker) {
  const i = src.indexOf(startMarker);
  assert.ok(i >= 0, startMarker);
  let depth = 0, j = src.indexOf('{', i);
  const open = j;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    if (src[j] === '}') { depth--; if (depth === 0) break; }
  }
  let end = j + 1;
  if (src[end] === ';') end++;
  return src.slice(i, end);
}
const code = [
  'var SCORE_CUT_ = { fear: 30, greed: 70 };',
  grab('  var ZONE_COLOR_ ='),
  grab('  var MARKET_MOOD ='),
  grab('  function zoneRangeText_'),
  grab('  function marketMood_'),
  grab('  function scoreTone_'),
  grab('  function zoneColor_'),
  grab('  function shortDate_'),
  grab('  function historyDays_'),
  grab('  function escapeHtml'),
  grab('  function buildFlowChart_'),
  grab('  function buildSparklineContent')
].join('\n');
// 소스의 SCORE_CUT_ 선언이 위 값과 같은지(복붙 오류 방지)
assert.ok(src.indexOf('var SCORE_CUT_ = { fear: 30, greed: 70 };') >= 0);
const sb = {};
vm.runInNewContext(code + '\nthis.t = { scoreTone_, zoneColor_, marketMood_, zoneRangeText_, buildSparklineContent, historyDays_ };', sb);
const t = sb.t;

// 1) 경계값 색(상태)
[[0, 'fear'], [29, 'fear'], [30, 'neutral'], [37, 'neutral'], [62, 'neutral'], [68, 'neutral'], [69, 'neutral'], [70, 'greed'], [71, 'greed'], [100, 'greed']]
  .forEach(([score, tone]) => assert.strictEqual(t.scoreTone_(score), tone, score + '점'));
// 칸에 보이는 정수(반올림)와 색이 일치
assert.strictEqual(t.scoreTone_(29.4), 'fear');
assert.strictEqual(t.scoreTone_(29.6), 'neutral');
assert.strictEqual(t.scoreTone_(69.5), 'greed');
// 계기판 색도 같은 판정
assert.strictEqual(t.zoneColor_(29), '#4a90d9');
assert.strictEqual(t.zoneColor_(30), '#8b95a5');
assert.strictEqual(t.zoneColor_(70), '#d65f5f');
assert.strictEqual(t.marketMood_(37).word, '보통');
assert.strictEqual(t.marketMood_(71).word, '과열');
assert.strictEqual(t.zoneRangeText_(), '0~29점은 공포, 30~69점은 보통, 70점부터 과열');

// 2) 히트맵 HTML
function days(scores, start) {
  return scores.map((score, i) => ({ date: '2026-10-' + String(start + i).padStart(2, '0'), score }));
}
const data = { scoreMethod: 'direction-v2', recentDays: days([40, 52, 62, 68, 71, 37, 29, 30, 69, 70], 1) };
let html = t.buildSparklineContent(data, 5);
const dotTones = (html.match(/mt-fc-dot mt-rib-tone-(\w+)/g) || []).map((m) => m.split('tone-')[1]);
assert.strictEqual(dotTones.length, 5, '선택한 기간(5일)만 표시');
// 5일 = 37,29,30,69,70 -> 보통,공포,보통,보통,과열
assert.deepStrictEqual(Array.from(dotTones), ['neutral', 'fear', 'neutral', 'neutral', 'greed'], '29 공포 / 30·69 보통 / 70 과열');
assert.ok(/mt-fc-last mt-rib-tone-greed[^>]*>70점 과열/.test(html), '최신 70점 라벨');
// 날짜 순서 유지
const dates = (html.match(/mt-fc-axis" x="[0-9.]+" y="\d+" text-anchor="middle">([0-9/]+)</g) || []).map((m) => m.replace(/.*">|</g, ''));
assert.deepStrictEqual(Array.from(dates), ['10/6', '10/7', '10/8', '10/9', '10/10']);
// 최신 증감: 70 - 69 = ▲1 (기간 5일의 첫 칸이 아니라 바로 앞 거래일 기준)
assert.ok(/▲1 /.test(html), '전 거래일 대비 ▲1');
assert.ok(/선택 기간 평균 47 · 최고 70 · 최저 29/.test(html), html.match(/선택 기간[^<]*/)[0]);
// 범례도 같은 경계
assert.ok(/공포 0~29/.test(html) && /보통 30~69/.test(html) && /과열 70~100/.test(html));
assert.ok(html.indexOf('위험도') > 0 && html.indexOf('높을수록 위험') > 0, '위험도는 별도·높을수록 위험');

// 3) 기간 전환(10일) · 하락 증감 · 첫 날(이전 없음)
html = t.buildSparklineContent(data, 10);
assert.strictEqual(html.match(/mt-fc-dot /g).length, 10);
const down = { scoreMethod: 'direction-v2', recentDays: days([60, 50], 1) };
assert.ok(/▼10 /.test(t.buildSparklineContent(down, 5)));
const one = { scoreMethod: 'direction-v2', recentDays: days([55], 1) };
html = t.buildSparklineContent(one, 5);
assert.ok(html.indexOf('mt-heat-delta') < 0, '이전 거래일이 없으면 증감 표시 안 함');
// 당일 데이터가 없으면 마지막으로 계산된 거래일을 최신으로 표시한다
html = t.buildSparklineContent({ scoreMethod: 'direction-v2', recentDays: days([50, 55, 58], 12) }, 5);
assert.ok(/최신 거래일 10\/14/.test(html) && /58점 보통/.test(html));
// 예전 산식(direction-v2 아님)은 섞지 않는다
assert.strictEqual(t.historyDays_({ scoreMethod: 'old', recentDays: days([50], 1) }).length, 0);
assert.ok(/새 기준으로 다시 계산할 수 있는 기록이 없습니다/.test(t.buildSparklineContent({ scoreMethod: 'old', recentDays: days([50], 1) }, 5)));

// 4) 위험도는 방향 점수 근거와 분리, 서버 경계와 같은 값
assert.ok(src.indexOf('수급·가격 근거와 시장 위험 지표') > 0 && src.indexOf('시장 위험 · 점수와 별도') > 0);
const py = fs.readFileSync('scripts/cloud-vm/market_temp_score.py', 'utf8');
assert.ok(/\(30, \{'emoji': '🔵', 'label': '공포'/.test(py) && /\(70, \{'emoji': '⚪', 'label': '보통'/.test(py));
console.log('market-temp heatmap 검증 통과');
