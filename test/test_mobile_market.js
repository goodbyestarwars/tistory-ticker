/* 시장 모바일 카드 UI(js/mobile-market.js, css/mobile-market.css) 검증 - 실행: node test/test_mobile_market.js
 * 핵심은 'PC 화면 불변': CSS는 미디어쿼리 밖에 .mm-only 숨김 규칙뿐이고, 스크립트는 767px 이하에서만 로드된다. */
const fs = require('fs'), vm = require('vm'), assert = require('assert');

const js = fs.readFileSync('js/mobile-market.js', 'utf8');
const css = fs.readFileSync('css/mobile-market.css', 'utf8');
const skin = fs.readFileSync('js/skin-main.js', 'utf8');

// 1) 순수 계산
const win = { matchMedia: () => ({ matches: false }), addEventListener() {}, setTimeout, requestAnimationFrame: (f) => setTimeout(f, 0) };
const sb = { window: win, document: { readyState: 'complete', addEventListener() {}, querySelector: () => null }, Event: function () {}, setTimeout, Math, String, Array, Number, Object };
vm.runInNewContext(js, sb);
const c = win.MobileMarket._calc;
assert.strictEqual(c.nearestIndex(0, [0, 343, 686]), 0);
assert.strictEqual(c.nearestIndex(180, [0, 343, 686]), 1);
assert.strictEqual(c.nearestIndex(600, [0, 343, 686]), 2);
assert.strictEqual(c.nearestIndex(50, []), 0);
assert.strictEqual(JSON.stringify(c.pageState(12, 5)), JSON.stringify({ visible: 5, remaining: 7, canMore: true }));
assert.strictEqual(JSON.stringify(c.pageState(12, 15)), JSON.stringify({ visible: 12, remaining: 0, canMore: false }));
assert.strictEqual(JSON.stringify(c.pageState(3, 5)), JSON.stringify({ visible: 3, remaining: 0, canMore: false }));
assert.strictEqual(c.PAGE_SIZE, 5);
assert.strictEqual(c.toneOf('▲ 20.16'), 'mm-up');
assert.strictEqual(c.toneOf('+0.08%'), 'mm-up');
assert.strictEqual(c.toneOf('▼ 454.59'), 'mm-down');
assert.strictEqual(c.toneOf('-0.12%'), 'mm-down');
assert.strictEqual(c.toneOf('-'), '');
assert.strictEqual(c.toneOf('0.00'), '');
// 모바일이 아니면(PC) run()은 아무것도 하지 않는다
let touched = 0;
sb.document.querySelector = () => { touched++; return null; };
win.MobileMarket.run();
assert.strictEqual(touched, 0, 'PC(767px 초과)에서는 DOM을 건드리지 않는다');

// 2) CSS: 미디어쿼리 밖 규칙은 .mm-only 숨김 하나뿐(PC 불변)
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
const topLevelRules = [];
{
  let d = 0, start = 0;
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] === '{') d++;
    if (stripped[i] === '}') { d--; if (d === 0) { topLevelRules.push(stripped.slice(start, i + 1).trim()); start = i + 1; } }
  }
}
const plain = topLevelRules.filter((r) => !/^@media/.test(r));
assert.strictEqual(plain.length, 1, '미디어쿼리 밖 규칙은 하나뿐: ' + plain.join(' | '));
assert.ok(/^\.mm-only\s*\{\s*display:\s*none;\s*\}$/.test(plain[0]), '그 하나는 .mm-only 숨김');
const medias = topLevelRules.filter((r) => /^@media/.test(r));
assert.ok(medias.length >= 2 && medias.every((m) => /^@media \(max-width: 767px\)/.test(m)), '모든 @media는 767px 이하');
// 안쪽 규칙의 선택자는 모두 이 UI의 요소여야 한다(기존 요소는 .mm-* 상태 클래스나 모바일 전용 요소 아래에서만 바뀐다)
const inner = medias.slice(0, 2).map((m) => m.replace(/^@media[^{]*\{/, '').replace(/\}$/, '').replace(/@layer np\s*\{/, '').replace(/\}\s*$/, '')).join(String.fromCharCode(10));
const selectors = [];
{
  let d = 0, start = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '{') { if (d === 0) selectors.push(inner.slice(start, i).trim()); d++; }
    if (inner[i] === '}') { d--; if (d === 0) start = i + 1; }
  }
}
selectors.forEach((sel) => {
  sel.split(',').forEach((one) => {
    one = one.trim();
    if (/^:root$|^html\.dark$/.test(one)) return; // 색 변수 선언뿐
    assert.ok(/^html body \.mi-wrap|^html body #market-temp|^html body #fx-rates|^html body #kospi-futures|^html body #us-macro-indicators|\.mm-|\.dmi-spot-quotes\.mm-has-cards|\[data-if-cumtable\]|\.dmi-rank-(card|table)|\.ifl \.ibd-leg-btn|\.mt-kpi-strip\.mm-deck/.test(one), '이 UI와 무관한 선택자: ' + one);
  });
});
// 기존 요소를 바꾸는 선택자는 모두 모바일 상태에서만: 표→카드 변환은 data-if-cumtable·dmi-rank-* 로만 한정
['dmi-rank-table', 'data-if-cumtable'].forEach((k) => assert.ok(inner.indexOf(k) > 0));

// 3) 로더: 767px 이하·시장 페이지에서만
assert.ok(/loadMobileMarket/.test(skin));
assert.ok(/market-temp\|kospi-futures\|overnight-market/.test(skin));
assert.ok(/matchMedia\('\(max-width: 767px\)'\)\.matches\) return;/.test(skin), '767px 이하에서만 로드');
assert.ok(/mobile-market\.js\?v=/.test(skin) && /mobile-market\.css\?v=/.test(skin));

// 4) 새 API 호출 없음, 자동 슬라이드·3D 없음
assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|EventSource/.test(js), '새 네트워크 호출 금지');
assert.ok(!/setInterval/.test(js), '자동 슬라이드 금지');
assert.ok(!/perspective|rotateY|translate3d/.test(css), '3D 효과 금지');
assert.ok(/prefers-reduced-motion/.test(css) && /reduceMotion\(\)/.test(js), '움직임 줄이기 설정 존중');
assert.ok(/min-height: 44px/.test(css) && /width: 44px/.test(css), '터치 영역 44px');
assert.ok(/touch-action:\s*pan-x pan-y/.test(css), '차트 위에서도 네이티브 가로 카드 스와이프 허용');
assert.ok(/Math\.round\(host\.scrollLeft \/ Math\.max\(1, host\.clientWidth\)\)/.test(js), 'scroll 중 매 프레임 DOM offset 측정 금지');
assert.ok(/tistory-chart-resize/.test(js), '덱 레이아웃 변경 후 DMI 차트 리사이즈 알림');
assert.ok(/removeEventListener\('keydown', d\.onHostKeydown\)/.test(js), '덱 교체 시 이전 키보드 리스너 해제');

// 5) 누적 표 칸 이름(모바일 카드용 data-label)이 원본 열 그대로 있다
const flow = fs.readFileSync('js/investor-flow.js', 'utf8');
['기간 누적 순매수', '최근 1일', '연속 일수'].forEach((l) => assert.ok(flow.indexOf('data-label="' + l + '"') > 0 || flow.indexOf("'" + l + "'") > 0, l));

console.log('mobile-market 검증 통과');
