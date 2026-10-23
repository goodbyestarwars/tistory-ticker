// 차트 메모 핀 끌어 옮기기(js/chart-memo.js) - 공용 모듈 한 곳에만 있고, 새 메모와 같은 좌표 해석을 쓰는지 고정한다.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js', 'chart-memo.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'chart-memo.css'), 'utf8');

test('핀 끌기는 공용 좌표 해석(resolveAt)과 저장 경로(chartMemoMutate)를 쓴다', () => {
  assert.match(source, /function enablePinDrag\(pin, item\)/);
  assert.match(source, /function resolveAt\(px, py\)/);
  assert.match(source, /var at = resolveAt\(px, py\);/, '새 메모도 같은 해석을 쓴다');
  assert.match(source, /var at = cancelled \? null : resolveAt\(parseFloat\(pin\.style\.left\), parseFloat\(pin\.style\.top\)\);/);
  assert.match(source, /moved\.date = at\.date;/);
  assert.match(source, /moved\.price = at\.price;/);
  assert.match(source, /moved\.updatedAt = /);
  assert.match(source, /chartMemoMutate\(function \(items\) \{\s*return items\.map/);
});

test('4px 미만 움직임은 클릭, 끌고 난 뒤 클릭은 내용 보기를 열지 않는다', () => {
  assert.match(source, /Math\.abs\(dx\) < 4 && Math\.abs\(dy\) < 4/);
  assert.match(source, /if \(wasDragged\(\)\) return;/);
  assert.match(source, /setPointerCapture/);
});

test('끌기 중 스타일과 터치 동작 차단', () => {
  assert.match(css, /\.ss-memo-pin\.is-dragging/);
  assert.match(css, /touch-action: none;/);
  assert.match(css, /cursor: grab;/);
});

test('같은 모듈을 차트검색·종목분석·검색기가 쓰므로 중복 구현이 없다', () => {
  for (const f of ['stock-search.js', 'foreign-flow.js', 'pattern-scan.js']) {
    const text = fs.readFileSync(path.join(root, 'js', f), 'utf8');
    assert.ok(!/function enablePinDrag|ss-memo-pin/.test(text.replace(/\/\/.*$/gm, '')), f + '에 핀 구현이 따로 있으면 안 된다');
  }
});
