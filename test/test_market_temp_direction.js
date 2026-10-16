/* 증시온도 방향 문구(js/market-temp.js directionMood_) - 종합점수가 보통일 때 가격·수급 축을 따로 읽는다.
 * 실행: node test/test_market_temp_direction.js. IIFE 라 필요한 선언만 소스에서 잘라 vm 에서 실행한다. */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync('js/market-temp.js', 'utf8');
function grab(startMarker) {
  const i = src.indexOf(startMarker);
  assert.ok(i >= 0, startMarker);
  let depth = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    if (src[j] === '}') { depth--; if (depth === 0) break; }
  }
  let end = j + 1;
  if (src[end] === ';') end++;
  return src.slice(i, end);
}
const code = ['  var AXIS_HIGH = 65, AXIS_LOW = 35;', grab('  var DIRECTION_MOODS ='), grab('  function directionMood_')].join('\n');
assert.ok(src.indexOf('var AXIS_HIGH = 65, AXIS_LOW = 35;') >= 0);
const sb = {};
vm.runInNewContext(code + '\nthis.t = { directionMood_, DIRECTION_MOODS };', sb);
const { directionMood_: d, DIRECTION_MOODS: M } = sb.t;

// 2026-10-17 화면: 수급 40(혼조) · 가격 97(오름 우세) · 종합 69(보통) -> "방향 없음"이 아니라 가격은 오르고 수급은 약한 날
assert.strictEqual(d(97, 40, 'neutral'), M.upWeakMoney);
assert.ok(M.upWeakMoney.mood.indexOf('방향이 없는') < 0);
assert.strictEqual(d(97, 70, 'neutral'), M.upStrong);
assert.strictEqual(d(20, 70, 'neutral'), M.downWithMoney);
assert.strictEqual(d(20, 50, 'neutral'), M.downWeak);
assert.strictEqual(d(50, 70, 'neutral'), M.moneyOnly);
assert.strictEqual(d(50, 20, 'neutral'), M.moneyOut);
assert.strictEqual(d(50, 50, 'neutral'), null, '두 축이 모두 중간이면 기존 문구를 쓴다');
// 경계: 65 이상 우세, 35 미만 열세(축 옆 단어와 같은 기준)
assert.strictEqual(d(65, 50, 'neutral'), M.upWeakMoney);
assert.strictEqual(d(64, 50, 'neutral'), null);
assert.strictEqual(d(35, 50, 'neutral'), null);
assert.strictEqual(d(34, 50, 'neutral'), M.downWeak);
assert.strictEqual(d(50, 65, 'neutral'), M.moneyOnly);
assert.strictEqual(d(50, 34, 'neutral'), M.moneyOut);
// 공포·과열 등급이거나 값이 없으면 쓰지 않는다
assert.strictEqual(d(97, 40, 'fear'), null);
assert.strictEqual(d(97, 40, 'greed'), null);
assert.strictEqual(d(NaN, 40, 'neutral'), null);
assert.strictEqual(d(97, undefined, 'neutral'), null);
// 모든 문구가 비어 있지 않다
Object.keys(M).forEach((k) => ['mood', 'title', 'short', 'todo', 'avoid'].forEach((f) => assert.ok(M[k][f] && M[k][f].length > 4, k + '.' + f)));
console.log('market-temp 방향 문구 검증 통과');
