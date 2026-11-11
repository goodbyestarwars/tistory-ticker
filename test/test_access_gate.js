// node test/test_access_gate.js  - js/access-gate.js 판정·이동·fail-closed 검증(브라우저 없이 vm)
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../js/access-gate.js', 'utf8');

function boot(path, search, policyFn, session, local) {
  const calls = { replace: [], fetches: [], events: [], scripts: [] };
  const store = Object.assign({}, session || {});
  const localStore = Object.assign({}, local || {});
  const classes = new Set();
  const win = {
    location: { pathname: path, search: search || '', origin: 'https://ghlee.tistory.com', replace: (u) => calls.replace.push(u) },
    document: {
      documentElement: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) } },
      head: { appendChild: (el) => { if (el && el.src) calls.scripts.push(el.src); } }, addEventListener() {}, getElementById: () => null, createElement: () => ({ addEventListener() {} }),
    },
    localStorage: { getItem: (k) => (k in localStore ? localStore[k] : null), setItem: (k, v) => { localStore[k] = String(v); }, removeItem: (k) => { delete localStore[k]; } },
    sessionStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    dispatchEvent: (e) => calls.events.push(e.type), CustomEvent: function (t, o) { this.type = t; this.detail = o && o.detail; },
    AbortController, URL, URLSearchParams, Promise, setTimeout, clearTimeout, console,
    fetch: (url, init) => { calls.fetches.push([url, init]); return policyFn(url, init); },
  };
  win.window = win; win.global = win;
  vm.runInNewContext(src, win);
  return { win, calls, classes, store };
}
const policy = (admin, off = [], authed = admin) => () => Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {
  isAdmin: admin, authenticated: authed,
  screens: Object.fromEntries(['guestbook','calendar','briefing','indicators','home','stocks','tools','my','market-temp','autotrader','kis'].map(k => {
    const pub = ['guestbook','calendar','briefing','news'].includes(k); const en = !off.includes(k);
    return [k, { public: pub, enabled: en, allowed: en && (pub || admin) }]; })) } }) });
const fail = () => Promise.reject(new TypeError('network'));
const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // 경로 → 화면
  const { win } = boot('/guestbook', '', policy(false));
  const s = win.NineAccess.screenOf;
  const table = [['/', '', 'home'], ['/guestbook', '', 'guestbook'], ['/page/stock-calendar', '', 'calendar'], ['/pages/stock-calendar', '', 'calendar'],
    ['/category/' + encodeURIComponent('마켓 브리핑'), '', 'briefing'], ['/category/마켓 브리핑/', '', 'briefing'], ['/pages/kospi-futures', '?x=1', 'indicators'],
    ['/pages/overnight-market', '', 'indicators'], ['/page/market-temp', '?view=stocks', 'stocks'], ['/page/market-temp', '', 'market-temp'],
    ['/page/foreign-flow', '?code=005930', 'stocks'], ['/page/pattern-scan', '', 'stocks'], ['/page/stock-search', '?tool=independent-chart', 'tools'],
    ['/page/watchlist', '', 'my'], ['/page/auto-trader', '', 'autotrader'], ['/123', '', ''], ['/page/learn-x', '', '']];
  table.forEach(([p, q, k]) => assert.strictEqual(s(p, q), k, p + q));
  assert.strictEqual(win.NineAccess.screenOfHref('https://goodbyestar.cloud/kis-tool/'), 'kis');
  assert.strictEqual(win.NineAccess.screenOfHref('#averaging-calculator'), 'tools');

  // 비로그인 '/' → /guestbook, 보호 화면 초기화 안 함, 로그인 후 복귀용 목적지 보관
  let b = boot('/', '', policy(false)); let ran = false;
  assert(b.classes.has('access-pending'));
  b.win.NineAccess.run(() => { ran = true; }); await wait();
  assert.deepStrictEqual(b.calls.replace, []); assert(!ran); assert(!b.classes.has('access-pending'));
  assert(b.classes.has('access-limited'));

  // 관리자 '/' → 홈 유지
  b = boot('/', '', policy(true)); ran = false; b.win.NineAccess.run(() => { ran = true; }); await wait();
  assert.deepStrictEqual(b.calls.replace, []); assert(ran); assert(b.classes.has('access-admin'));

  // 인증 서버 장애 → 보호 화면 차단, 공개 화면은 유지
  b = boot('/page/foreign-flow', '', fail); ran = false; b.win.NineAccess.run(() => { ran = true; }); await wait();
  assert.deepStrictEqual(b.calls.replace, ['/guestbook']); assert(!ran); assert(b.win.NineAccess.failed());
  b = boot('/page/stock-calendar', '', fail); ran = false; b.win.NineAccess.run(() => { ran = true; }); assert(ran); await wait();
  assert.deepStrictEqual(b.calls.replace, []);
  // 시장지표는 로그인 후: 비로그인·장애면 /guestbook 으로
  b = boot('/pages/kospi-futures', '', policy(false)); ran = false; b.win.NineAccess.run(() => { ran = true; }); await wait();
  assert.deepStrictEqual(b.calls.replace, ['/guestbook']); assert(!ran);

  // 비회원 전용 홈: 비회원 입장·로그인한 일반 회원의 '/'는 guest-home.js, 관리자는 전체 대시보드, 입장 전 비로그인은 대화방(시작 화면)
  b = boot('/', '', policy(false), { nine_guest: '1' }); ran = false; b.win.NineAccess.run(() => { ran = true; }); await wait();
  assert.deepStrictEqual(b.calls.replace, []); assert(!ran, 'dashboard code must not run for guests');
  assert(b.calls.scripts.some((u) => /js\/guest-home\.js(?:\?.*)?$/.test(u)), 'guest home module loads'); assert(b.win.NineAccess.isGuest());
  b = boot('/', '', policy(false, [], true)); await wait();
  assert(b.calls.scripts.some((u) => /js\/guest-home\.js(?:\?.*)?$/.test(u)), 'logged-in non-admin gets guest home'); assert.deepStrictEqual(b.calls.replace, []);
  b = boot('/', '', policy(true)); ran = false; b.win.NineAccess.run(() => { ran = true; }); await wait();
  assert(ran); assert(!b.calls.scripts.some((u) => /guest-home/.test(u)));
  // 입장 전 비로그인의 '/'도 대화방으로 보내지 않고 비회원 홈 위에 로그인 창(랜딩)을 덮는다
  b = boot('/', '', policy(false)); await wait();
  assert.deepStrictEqual(b.calls.replace, []); assert(b.calls.scripts.some((u) => /guest-home/.test(u))); assert(b.calls.scripts.some((u) => /access-landing\.js/.test(u)));
  // 비회원 입장 상태의 비공개 URL은 대화방으로(시장지표·종목·MY 등)
  // 로그아웃(로그인 이력 힌트가 있는데 지금은 비로그인): 비회원 입장으로 넘기지 않고 로그인 창(랜딩)으로 돌아간다
  b = boot('/', '', policy(false), { nine_guest: '1', nine_landing_seen: '1' }, { nine_authed: '1' }); await wait();
  assert(!b.win.NineAccess.isGuest(), 'logout clears guest entry'); assert(!('nine_landing_seen' in b.store), 'logout re-arms landing');
  assert.deepStrictEqual(b.calls.replace, [], 'logout stays on home under the landing');
  assert(b.calls.scripts.some((u) => /access-landing\.js/.test(u)), 'logout shows login landing');
  b = boot('/page/foreign-flow', '', policy(false), { nine_guest: '1' }); await wait();
  assert.deepStrictEqual(b.calls.replace, ['/guestbook']);
  // 주요 뉴스는 공개
  assert.strictEqual(s('/pages/main-news', ''), 'news');
  b = boot('/pages/main-news', '', policy(false)); ran = false; b.win.NineAccess.run(() => { ran = true; }); assert(ran); await wait();
  assert.deepStrictEqual(b.calls.replace, []);

  // 공개 화면은 판정을 기다리지 않고 시작, /guestbook은 반복 이동 없음
  b = boot('/guestbook', '', policy(false)); ran = false; b.win.NineAccess.run(() => { ran = true; }); assert(ran); await wait();
  assert.deepStrictEqual(b.calls.replace, []);

  // 관리자가 캘린더를 끄면 비로그인 접근 시 대화방으로
  b = boot('/page/stock-calendar', '', policy(false, ['calendar'])); await wait();
  assert.deepStrictEqual(b.calls.replace, ['/guestbook']);

  // 로그인 후 복귀: 대화방에서 시작하고 보관된 목적지가 허용되면 1회 이동, 보관값 소거
  b = boot('/guestbook', '', policy(true), { nine_access_from: '/page/foreign-flow?code=005930' }); await wait();
  assert.deepStrictEqual(b.calls.replace, ['/page/foreign-flow?code=005930']); assert(!('nine_access_from' in b.store));
  b = boot('/guestbook', '', policy(false), { nine_access_from: '/page/foreign-flow' }); await wait();
  assert.deepStrictEqual(b.calls.replace, []);

  // 세션 쿠키 전송: goodbyestar.cloud 요청에 credentials include 자동 부여, 명시값 보존
  b = boot('/guestbook', '', policy(false)); await wait();
  b.calls.fetches.length = 0; await b.win.fetch('https://goodbyestar.cloud/quote?code=1', {});
  assert.strictEqual(b.calls.fetches[0][1].credentials, 'include');
  await b.win.fetch('https://goodbyestar.cloud/x', { credentials: 'omit' }); assert.strictEqual(b.calls.fetches[1][1].credentials, 'omit');
  await b.win.fetch('https://example.com/x', {}); assert.strictEqual(b.calls.fetches[2][1].credentials, undefined);

  // whenAdmin: 일반 회원은 시작하지 않는다
  b = boot('/guestbook', '', policy(false)); let adminRan = false; b.win.NineAccess.whenAdmin(() => { adminRan = true; }); await wait();
  assert(!adminRan);
  console.log('access-gate: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
