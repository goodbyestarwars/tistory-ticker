/* 라이브 페이지의 체감 로딩 속도 측정. .github/workflows/page-speed.yml에서 실행한다.
 *
 * 재는 것:
 *  - FCP: 브라우저가 처음 무언가를 그린 시각(흰 화면이 끝난 시점)
 *  - LCP: 가장 큰 요소가 그려진 시각(보통 "화면이 다 떴다"고 느끼는 시점)
 *  - ready: 페이지마다 지정한 "이게 보이면 쓸 수 있다" 요소가 나타난 시각.
 *           목록이 한 줄이라도 실제로 채워졌는지까지 확인한다 - 빈 표나 스피너가
 *           떠 있는 상태를 "떴다"고 세면 체감과 어긋난다.
 *
 * 각 페이지를 매번 새 컨텍스트(=빈 캐시)로 연다. 재방문 캐시 효과를 빼고
 * "처음 들어온 사용자"를 기준으로 재기 위해서다.
 */
const { chromium, devices } = require('playwright');

const BASE = 'https://ghlee.tistory.com';
const RUNS = Math.max(1, Math.min(parseInt(process.env.RUNS || '3', 10) || 3, 7));
const MOBILE = (process.env.DEVICE || 'mobile') === 'mobile';
const NAV_TIMEOUT = 60000;
const READY_TIMEOUT = 45000;

// ready 기준은 "데이터가 실제로 들어찬 요소"여야 한다. 컨테이너만 보면 껍데기가
// 먼저 그려지는 페이지에서 실제보다 빠르게 측정된다.
const PAGES = [
  { name: '홈',       url: '/',                    ready: '.hrt-table-wrap tbody tr td' },
  { name: '증시온도', url: '/page/market-temp',    ready: '#market-temp .mt-hero-current' },
  { name: '차트검색', url: '/page/pattern-scan',   ready: '#pattern-scan .ps-item[data-code]' },
  { name: '전략검색', url: '/page/strategy-search',ready: '#strategy-search .ss-row[data-code], #strategy-search .ss-table-row[data-code]' },
  { name: '종목분석', url: '/page/foreign-flow',   ready: '#foreign-flow #ffSigList .ff-flow-card, #foreign-flow #ffSigList .ff-flow-empty' },
  { name: '종목분석(종목조회)', url: '/page/foreign-flow?code=005930&name=%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90', ready: '#foreign-flow #ffResult .ff-header' },
  { name: '캘린더',   url: '/page/stock-calendar', ready: '#stock-calendar .sc-day' },
];

function median(values) {
  const ok = values.filter((v) => typeof v === 'number' && isFinite(v)).sort((a, b) => a - b);
  if (!ok.length) return null;
  const mid = Math.floor(ok.length / 2);
  return ok.length % 2 ? ok[mid] : Math.round((ok[mid - 1] + ok[mid]) / 2);
}

function fmt(ms) {
  if (ms == null) return '   -  ';
  return (ms / 1000).toFixed(2) + 's';
}

async function measureOnce(browser, page) {
  const context = await browser.newContext(
    MOBILE ? { ...devices['Galaxy S9+'] } : { viewport: { width: 1440, height: 900 } }
  );
  const tab = await context.newPage();
  const result = { fcp: null, lcp: null, ready: null, error: null };
  try {
    // LCP는 관측을 시작해둬야 값이 쌓인다. 문서 스크립트보다 먼저 걸어둔다.
    await tab.addInitScript(() => {
      window.__lcp = 0;
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) window.__lcp = entry.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      } catch (e) { /* 미지원 브라우저는 LCP 없이 진행 */ }
    });

    const started = Date.now();
    await tab.goto(BASE + page.url, { waitUntil: 'commit', timeout: NAV_TIMEOUT });
    try {
      await tab.waitForSelector(page.ready, { timeout: READY_TIMEOUT, state: 'attached' });
      result.ready = Date.now() - started;
    } catch (e) {
      result.error = 'ready 요소가 ' + (READY_TIMEOUT / 1000) + '초 안에 안 나타남';
    }

    // 화면이 채워진 뒤 지표를 걷는다. LCP는 그 시점까지의 최대값이다.
    const paints = await tab.evaluate(() => {
      const fcpEntry = performance.getEntriesByName('first-contentful-paint')[0];
      return { fcp: fcpEntry ? fcpEntry.startTime : null, lcp: window.__lcp || null };
    });
    result.fcp = paints.fcp == null ? null : Math.round(paints.fcp);
    result.lcp = paints.lcp == null ? null : Math.round(paints.lcp);
  } catch (e) {
    result.error = String(e && e.message || e).slice(0, 120);
  } finally {
    await context.close();
  }
  return result;
}

(async () => {
  const browser = await chromium.launch();
  console.log('대상: ' + BASE + '  뷰포트: ' + (MOBILE ? '모바일' : '데스크톱') + '  반복: ' + RUNS + '회(중앙값)');
  console.log('');
  console.log('페이지                      FCP     LCP    쓸 수 있게 되기까지   비고');
  console.log('--------------------------------------------------------------------------------');

  for (const page of PAGES) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await measureOnce(browser, page));
    const errors = runs.map((r) => r.error).filter(Boolean);
    const label = (page.name + '                          ').slice(0, 26);
    console.log(
      label + ' ' + fmt(median(runs.map((r) => r.fcp)))
      + '  ' + fmt(median(runs.map((r) => r.lcp)))
      + '   ' + fmt(median(runs.map((r) => r.ready)))
      + '            ' + (errors.length ? errors[0] + (errors.length > 1 ? ' (x' + errors.length + ')' : '') : '')
    );
  }

  console.log('--------------------------------------------------------------------------------');
  console.log('FCP=첫 픽셀, LCP=가장 큰 요소, 쓸 수 있게=목록/수치가 실제로 채워진 시각');
  console.log('러너 위치·회선이 실제 사용자와 달라 절대값보다 페이지 간·변경 전후 비교에 쓴다.');
  await browser.close();
})();
