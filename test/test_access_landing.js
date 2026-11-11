'use strict';
// node test/test_access_landing.js (Playwright + Edge) - 로그인 랜딩: 공개 메뉴 4개·3개 로그인 경로·닫기/세션 기억
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({viewport: {width, height: 800}});
    await page.goto('https://ghlee.tistory.com/guestbook', {waitUntil: 'commit'}).catch(() => {});
    await page.route('**/*', r => r.abort());
    await page.setContent('<html><head></head><body><a class="nav-manage-btn" href="https://www.tistory.com/manage">m</a></body></html>');
    await page.addScriptTag({content: fs.readFileSync('js/access-landing.js', 'utf8')});
    await page.evaluate(() => window.NineLanding.show(true));
    assert.deepEqual((await page.locator('.nl-nav a').allInnerTexts()).map(t => t.trim()), ['대화방', '캘린더', '마켓브리핑', '시장지표']);
    assert.equal(await page.locator('.nl-card').isHidden(), true);
    await page.click('.nl-cta');
    const hrefs = await page.locator('.nl-card a').evaluateAll(a => a.map(x => x.getAttribute('href')));
    assert.ok(/\/auth\/google\/start\?return_to=/.test(hrefs[0]) && /\/auth\/naver\/start\?return_to=/.test(hrefs[1]) && /tistory\.com\/manage/.test(hrefs[2]), hrefs.join());
    const box = await page.locator('.nl-card').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= 800, 'card inside viewport ' + JSON.stringify(box));
    await page.click('.nl-back');
    assert.equal(await page.locator('.nl-card').isHidden(), true);
    // 현재 화면과 같은 메뉴를 누르면 닫히고 세션 동안 다시 뜨지 않는다
    await page.evaluate(() => { history.replaceState(null, '', '/guestbook'); });
    await page.locator('.nl-nav a', {hasText: '대화방'}).click();
    await page.waitForTimeout(50);
    assert.equal(await page.locator('#nineLanding').count(), 0);
    assert.equal(await page.evaluate(() => window.NineLanding.seen()), true);
    // 로그인 확인되면 닫힌다
    await page.evaluate(() => { sessionStorage.clear(); window.NineLanding.show(false); window.NineLanding.settle({authenticated: true}); });
    assert.equal(await page.locator('#nineLanding').count(), 0);
    console.log('PASS landing', width);
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error(e); process.exitCode = 1; });
