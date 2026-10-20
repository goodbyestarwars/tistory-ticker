/* 공통 차트 엔진(js/chart-core.js)·데이터 계층(js/chart-data.js) 검증(브라우저 없이).
 *  1) 옵션 동일성: 공통화 전 두 화면의 테마·생성 옵션(옛 코드 실행 결과 골든)과 같아야 한다(차트 스케일·모양 불변).
 *  2) 라이브러리·모듈 로드는 페이지당 한 번, 실패하면 다시 시도.
 *  3) 정리 범위(scope)·공용 관찰자 해제, 이동평균·일목 계산, 시리즈 호출 순서.
 *  4) 데이터 계층: 정규화·캐시·중복 요청 방지·키 구분·탭 저장소. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/chart_core/core_golden.json'), 'utf8'));
// Approved 2026-10-20 UI change: fit 1/3/5-year daily ranges on narrow screens.
// Preserve the historical fixture and compare every other option unchanged.
for (const profile of [golden.search,golden.analysis]) for (const opts of Object.values(profile)) opts.timeScale.minBarSpacing=.1;
const real = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/chart_core/flow_chart_005930.json'), 'utf8'));
const LWC = { CrosshairMode: { Normal: 0 }, LineStyle:{Solid:0}, CandlestickSeries: 'candle', LineSeries: 'line', HistogramSeries: 'hist' };

// ---- 가짜 브라우저 환경 ----
let darkMode = false, scripts = [], observers = { mo: 0, ro: 0, roDisconnect: 0, moDisconnect: 0 };
const moCallbacks = [];
globalThis.document = {
  currentScript: null,
  documentElement: { classList: { contains: (c) => c === 'dark' && darkMode } },
  head: { appendChild: (s) => { scripts.push(s); } },
  querySelector: (sel) => (/lightweight/.test(sel) ? null : null),
  createElement: () => ({ setAttribute() {}, remove() { this.removed = true; }, addEventListener() {} })
};
globalThis.MutationObserver = class { constructor(cb) { moCallbacks.push(cb); observers.mo++; } observe() {} disconnect() { observers.moDisconnect++; } };
const roTargets = new Set();
globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; observers.ro++; ResizeObserver.last = this; } observe(el) { roTargets.add(el); } unobserve(el) { roTargets.delete(el); } disconnect() { observers.roDisconnect++; } };
globalThis.window = globalThis;

const Core = require('../js/chart-core.js');
const Data = require('../js/chart-data.js');

// ---------------------------------------------------------------- 1) 옵션 동일성
function expectEqual(actual, expected, label) {
  assert.strictEqual(JSON.stringify(sortKeys(actual)), JSON.stringify(sortKeys(expected)), label);
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach((k) => { o[k] = sortKeys(v[k]); }); return o; }
  return v;
}
const FONT = 'Pretendard, "Malgun Gothic", sans-serif';
for (const dark of [false, true]) for (const tf of ['day', 'minute']) {
  const got = Core.chartOptions(LWC, 'search', { dark, timeframe: tf, fontFamily: FONT, autoSize: false, width: 712, height: 420 });
  assert.strictEqual(got.handleScale.mouseWheel, true, '마우스 휠 위·아래로 봉 크기를 조절한다');
  const expected = JSON.parse(JSON.stringify(golden.search[(dark ? 'dark' : 'light') + '-' + tf]));
  expected.layout.panes.enableResize = true; // 거래량·RSI 영역을 사용자가 직접 줄일 수 있다.
  expectEqual(got, expected, '차트검색 옵션 ' + dark + tf);
}
for (const dark of [false, true]) {
  const got = Core.chartOptions(LWC, 'analysis', { dark, autoSize: true, height: 360 });   // 글꼴 지정 없음 = 옛 옵션과 동일
  expectEqual(got, golden.analysis[dark ? 'dark' : 'light'], '종목분석 옵션 ' + dark);
  // 글꼴 통일: 종목명에 렌더링되는 글꼴을 차트 글자에도 준다(이것 하나만 다르다)
  const withFont = Core.chartOptions(LWC, 'analysis', { dark, autoSize: true, height: 360, fontFamily: FONT });
  assert.strictEqual(withFont.layout.fontFamily, FONT);
  delete withFont.layout.fontFamily;
  expectEqual(withFont, golden.analysis[dark ? 'dark' : 'light'], '종목분석 옵션(글꼴 제외) ' + dark);
}
// 라이브러리가 옵션 객체를 제자리에서 바꿔도 다음 차트 옵션이 오염되지 않는다(공유 객체를 넘기지 않는다)
const first = Core.chartOptions(LWC, 'search', { timeframe: 'day' });
first.handleScale.axisPressedMouseMove = { price: true, time: true };
first.timeScale.barSpacing = 99;
assert.strictEqual(Core.chartOptions(LWC, 'search', { timeframe: 'day' }).handleScale.axisPressedMouseMove, true);
assert.strictEqual(Core.chartOptions(LWC, 'search', { timeframe: 'day' }).timeScale.barSpacing, 7);

// ---------------------------------------------------------------- 2) 라이브러리·모듈 로드
(async () => {
  scripts = [];
  const [a, b] = [Core.loadLibrary(), Core.loadLibrary()];
  assert.strictEqual(a, b, '동시에 불러도 같은 약속');
  assert.strictEqual(scripts.length, 1, '스크립트는 한 번만 넣는다');
  assert(/lightweight-charts@5\.2\.0/.test(scripts[0].src));
  scripts[0].onerror();                       // 실패 -> 다음 호출은 다시 시도
  await a.then(() => assert.fail('실패해야 한다'), () => {});
  Core.loadLibrary().catch(() => {});
  assert.strictEqual(scripts.length, 2, '실패 뒤에는 다시 시도');
  globalThis.LightweightCharts = LWC;
  assert.strictEqual(await Core.loadLibrary(), LWC, '이미 있으면 바로 돌려준다');
  scripts = [];
  globalThis.NineChartMemo = { ok: 1 };
  assert.strictEqual(await Core.loadModule('memo'), globalThis.NineChartMemo, '이미 있는 모듈은 다시 받지 않는다');
  assert.strictEqual(scripts.length, 0);
  const wave1 = Core.loadModule('wave'), wave2 = Core.loadModule('wave');
  assert.strictEqual(wave1, wave2, '같은 모듈은 같은 약속');
  assert.throws(() => { Core.moduleUrl('nope'); });
  assert(/js\/chart-wave-overlay\.js/.test(Core.moduleUrl('wave')));

  // ------------------------------------------------------------- 3) scope · 공용 관찰자
  const log = [];
  const scope = Core.createScope('t');
  scope.add(() => log.push('a')); scope.add(() => { throw new Error('x'); }); scope.add(() => log.push('c'));
  scope.dispose(); scope.dispose();
  assert.deepStrictEqual(log, ['c', 'a'], '거꾸로 정리하고 하나가 실패해도 나머지는 정리, 두 번 불러도 한 번만');
  scope.add(() => log.push('late'));
  assert.deepStrictEqual(log, ['c', 'a', 'late'], '정리된 범위에 뒤늦게 넣은 것은 바로 정리');
  const target = { added: [], removed: [], addEventListener(t, f) { this.added.push(t); }, removeEventListener(t, f) { this.removed.push(t); } };
  const s2 = Core.createScope(); s2.on(target, 'click', () => {}); s2.on(target, 'keydown', () => {}); s2.dispose();
  assert.deepStrictEqual(target.removed.sort(), ['click', 'keydown']);

  // 공용 ResizeObserver: 구독이 여럿이어도 관찰자는 하나, 모두 해제되면 연결을 끊는다
  const elA = {}, elB = {};
  const offs = [Core.observeResize(elA, () => {}), Core.observeResize(elA, () => {}), Core.observeResize(elB, () => {})];
  assert.strictEqual(observers.ro, 1);
  assert.strictEqual(roTargets.size, 2);
  offs.forEach((off) => off());
  assert.strictEqual(roTargets.size, 0);
  assert.strictEqual(observers.roDisconnect, 1, '구독이 모두 사라지면 관찰자를 해제한다');

  // 공용 다크모드 감시자: 하나만 두고, 실제로 바뀔 때만 알리고, 구독이 없어지면 해제
  const seen = [];
  const off1 = Core.onThemeChange((d) => seen.push(['a', d])), off2 = Core.onThemeChange((d) => seen.push(['b', d]));
  assert.strictEqual(observers.mo, 1);
  moCallbacks[0]();                         // 클래스가 바뀌었지만 다크 여부는 그대로
  assert.deepStrictEqual(seen, []);
  darkMode = true; moCallbacks[0]();
  assert.deepStrictEqual(seen, [['a', true], ['b', true]]);
  off1(); darkMode = false; moCallbacks[0]();
  assert.deepStrictEqual(seen.slice(2), [['b', false]]);
  off2();
  assert.strictEqual(observers.moDisconnect, 1);

  // ------------------------------------------------------------- 이동평균·일목·거래량
  // 서버가 준 이동평균(앞쪽 부분 창 포함)과 공용 계산(꽉 찬 창만)은 겹치는 구간에서 완전히 같다(실제 삼성전자 500봉)
  for (const study of Core.maStudies(false)) {
    const mine = Core.movingAveragePoints(real.daily, 'close', study.period);
    const server = real.ma[study.key];
    mine.forEach((p, k) => {
      const i = real.daily.findIndex((d) => d.date === p.time);
      assert(server[i] != null, study.key + ' 서버 값이 있어야 한다');
      assert(Math.abs(server[i] - p.value) < 1e-6, study.key + ' ' + p.time + ' 서버와 같다');
    });
    assert(mine.length > 0);
  }
  assert.strictEqual(Core.maStudies(true)[3].color, '#f1f3f5'); assert.strictEqual(Core.maStudies(false)[3].color, '#000000');
  assert.deepStrictEqual(Core.maStudies(false).map((s) => s.width), [1, 1, 1, 3], '224일선만 굵게');

  // 일목 구름 점: 공통화 전 차트검색 구현의 결과와 완전히 같다
  for (const tf of ['day', 'week', 'month']) {
    assert.strictEqual(JSON.stringify(Core.ichimokuCloudPoints(golden.ichimoku.bars, tf)), JSON.stringify(golden.ichimoku[tf]), '일목 ' + tf);
  }
  assert.deepStrictEqual(Core.ichimokuCloudPoints([], 'day'), []);

  // 시리즈 호출: 순서·옵션·창 번호가 두 화면이 쓰던 그대로
  const calls = [];
  const series = (label) => ({ setData: (d) => calls.push(['setData', label, d.length]), priceScale: () => ({ applyOptions: (o) => calls.push(['seriesScale', label, o]) }) });
  const chart = { addSeries: (type, opts, pane) => { const label = type + '#' + (pane || 0) + '#' + calls.length; calls.push(['add', type, opts, pane]); return series(label); }, priceScale: (id) => ({ applyOptions: (o) => calls.push(['scale', id, o]) }) };
  const bars = real.daily.slice(-60);
  Core.addCandles(chart, LWC, bars, { type: 'custom', minMove: 1, formatter: (v) => v }, { top: 0.06, bottom: 0.08 });
  assert.deepStrictEqual(calls.map((c) => c[0]), ['add', 'seriesScale', 'setData'], '생성 → 가격축 여백 → 데이터 순서');
  assert.strictEqual(calls[0][2].upColor, '#d24f45'); assert.strictEqual(calls[0][2].downColor, '#1261c4');
  calls.length = 0;
  const vol = Core.addVolumePane(chart, LWC, bars, { pane: 1, scaleId: 'volume', ma5: true, scaleOptions: { drawTicks: false } });
  assert.deepStrictEqual(calls.map((c) => c[0] + ':' + (c[1] && c[1].slice ? c[1].slice(0, 4) : '')), ['add:hist', 'scale:volu', 'setData:hist', 'add:line', 'setData:line', 'add:line', 'setData:line']);
  assert.strictEqual(calls[0][2].priceScaleId, 'volume'); assert.strictEqual(calls[0][3], 1);
  assert.strictEqual(vol.ma20.points.length, 41); assert.strictEqual(vol.ma5.points.length, 56);
  calls.length = 0;
  Core.addVolumePane(chart, LWC, bars, { pane: 1 });                    // 종목분석 설정: 거래량 축 id·5일 평균 없음
  assert.strictEqual(calls.filter((c) => c[0] === 'add').length, 2); assert.strictEqual(calls[0][2].priceScaleId, undefined);
  assert.strictEqual(Core.compactVolume(2539179), '2.54M'); assert.strictEqual(Core.compactVolume(1500), '1.5K');
  assert.strictEqual(Core.priceText(263000, false), '263,000'); assert.strictEqual(Core.priceText(12.5, true), '$12.50'); assert.strictEqual(Core.priceText('x'), '');

  // ------------------------------------------------------------- 4) 데이터 계층
  // 정규화: 깨끗한 자료는 같은 배열(복사 없음), 날짜 중복은 뒤의 것, 비정상 봉은 제외, 오름차순
  assert.strictEqual(Data.normalizeBars(real.daily), real.daily, '깨끗한 자료는 그대로');
  const dirty = [{ date: '2026-01-02', open: 1, high: 3, low: 1, close: 3, volume: 2 }, { date: '2026-01-02', open: 1, high: 2, low: 1, close: 2, volume: 1 },
    { date: '2026-01-01', open: 1, high: 2, low: 1, close: 1 }, { date: '2026-01-03', open: 1, high: 1, low: 2, close: 1 }, { date: '', open: 1, high: 2, low: 1, close: 1 }, { date: '2026-01-04', open: 'x', high: 2, low: 1, close: 1 }];
  assert.deepStrictEqual(Data.normalizeBars(dirty).map((b) => b.date + ':' + b.close), ['2026-01-01:1', '2026-01-02:2']);
  // 지문: 자동 파동 엔진과 같은 식, 과거 봉 하나만 달라도 달라진다
  const AutoWave = require('../js/auto-wave.js');
  assert.strictEqual(Data.fingerprint(real.daily), AutoWave.hashBars(real.daily));
  const edited = real.daily.slice(); edited[10] = Object.assign({}, edited[10], { close: edited[10].close + 1 });
  assert.notStrictEqual(Data.fingerprint(edited), Data.fingerprint(real.daily));
  // 주봉·월봉 집계
  const wk = Data.barsForTimeframe([{ date: '2026-10-05', open: 1, high: 5, low: 1, close: 2, volume: 1 }, { date: '2026-10-06', open: 2, high: 9, low: 2, close: 8, volume: 2 }, { date: '2026-10-12', open: 8, high: 9, low: 7, close: 7, volume: 3 }], 'week');
  assert.deepStrictEqual(wk.map((b) => [b.date, b.open, b.high, b.low, b.close, b.volume]), [['2026-10-06', 1, 9, 1, 8, 3], ['2026-10-12', 8, 9, 7, 7, 3]]);
  assert.strictEqual(Data.barsForTimeframe(real.daily, 'day'), real.daily);
  assert.strictEqual(Data.barsForTimeframe(real.daily, 'month').length, new Set(real.daily.map((d) => d.date.slice(0, 7))).size);

  // 캐시: 같은 키 동시 요청은 한 번, 유효기간 안 재조회는 요청 없음, 오류 응답은 저장하지 않음, 키 구분
  let fetches = 0;
  const fetcher = async () => { fetches++; await new Promise((r) => setTimeout(r, 5)); return { daily: real.daily.slice(), ma: real.ma }; };
  const [x, y] = await Promise.all([Data.fetchFlowChart('005930', fetcher), Data.fetchFlowChart('005930', fetcher)]);
  assert.strictEqual(fetches, 1); assert.strictEqual(x, y);
  await Data.fetchFlowChart('005930', fetcher); assert.strictEqual(fetches, 1, '유효기간 안 재조회는 추가 요청 없음');
  await Data.fetchFlowChart('000660', fetcher); assert.strictEqual(fetches, 2, '다른 종목은 다른 키');
  await Data.fetchFlowChart('005930', fetcher, { adjust: 'adjusted' }); assert.strictEqual(fetches, 3, '수정주가 기준이 다르면 다른 키');
  await Data.fetchFlowChart('005930', fetcher, { force: true }); assert.strictEqual(fetches, 4, 'force 는 새로 받는다');
  let bad = 0; const badFetcher = async () => { bad++; return { error: 'NO_DATA' }; };
  assert.strictEqual((await Data.fetchFlowChart('ERR', badFetcher)).error, 'NO_DATA'); await Data.fetchFlowChart('ERR', badFetcher);
  assert.strictEqual(bad, 2, '오류 응답은 저장하지 않는다');
  assert.notStrictEqual(Data.flowChartKey('005930'), Data.flowChartKey('005930', 'adjusted'));

  // 탭 저장소(sessionStorage): 다른 화면(페이지)이 같은 종목을 요청해도 서버를 다시 부르지 않고, 5분이 지나면 버린다
  const store = {}; globalThis.sessionStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  Data._flowChartCache.clear();
  let net = 0; const netFetcher = async () => { net++; return { daily: real.daily.slice(-30), ma: {} }; };
  await Data.fetchFlowChart('SESS1', netFetcher); assert.strictEqual(net, 1);
  Data._flowChartCache.clear();             // 새 페이지(메모리 캐시 없음)
  const again = await Data.fetchFlowChart('SESS1', netFetcher);
  assert.strictEqual(net, 1, '새 페이지에서도 탭 저장소에서 읽는다'); assert.strictEqual(again.daily.length, 30);
  const key = 'nine-chart:v1:' + Data.flowChartKey('SESS1'); const rec = JSON.parse(store[key]); rec.t -= 6 * 60 * 1000; store[key] = JSON.stringify(rec);
  Data._flowChartCache.clear(); await Data.fetchFlowChart('SESS1', netFetcher); assert.strictEqual(net, 2, '5분이 지난 저장본은 쓰지 않는다');
  for (const code of ['S2', 'S3', 'S4', 'S5', 'S6']) await Data.fetchFlowChart(code, netFetcher);
  assert(Object.keys(store).filter((k) => /^nine-chart:v1:flow-chart/.test(k)).length <= 4, '탭 저장소에는 최근 4종목까지만');
  await Data.fetchFlowChart('TMP', async () => ({ daily: real.daily.slice(-5), source: 'flow-fallback' }));
  assert(!Object.keys(store).some((k) => /TMP/.test(k)), '임시 대체 자료는 저장하지 않는다');
  globalThis.sessionStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} };
  Data._flowChartCache.clear(); await Data.fetchFlowChart('BLOCKED', netFetcher);   // 저장소가 막혀도 동작
  console.log('chart core ok');
})().catch((e) => { console.error(e); process.exit(1); });
