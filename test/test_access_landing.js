'use strict';
// node test/test_access_landing.js (Playwright + Edge) - 시작 화면: 큰 버튼 2개, 로그인 모달(닫기·ESC·바깥 클릭·포커스), 비회원 입장
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
    // 비회원 입장의 페이지 이동(location.assign('/'))만 플래그로 바꿔 검사한다
    await page.addScriptTag({content: fs.readFileSync('js/access-landing.js', 'utf8').replace("global.location.assign('/')", "global.__guestGo = true")});
    await page.evaluate(() => window.NineLanding.show(true));
    // 시작 화면: 상단 공개 메뉴·로그인 버튼 없음, 왼쪽 하단 큰 버튼 2개
    assert.equal(await page.locator('.nl-nav').count(), 0);
    const names = (await page.locator('.nl-actions .nl-btn').allInnerTexts()).map(t => t.trim());
    assert.deepEqual(names, ['로그인', '비회원 로그인']);
    const boxes = await page.locator('.nl-actions .nl-btn').evaluateAll(a => a.map(n => { const r = n.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height}; }));
    for (const b of boxes) { assert.ok(b.h >= 56 && b.h <= 64, 'button height ' + b.h); assert.ok(b.x >= 0 && b.x + b.w <= width + 1 && b.y + b.h <= 800, 'inside viewport ' + JSON.stringify(b)); }
    if (width > 720) { assert.ok(boxes[0].w >= 200 && boxes[0].w <= 241 && boxes[0].x < width / 2, 'desktop width/left ' + JSON.stringify(boxes[0])); assert.ok(Math.abs(boxes[0].y - boxes[1].y) < 2, 'same row'); }
    else assert.ok(boxes[1].y > boxes[0].y, 'stacked on mobile');
    assert.equal(await page.locator('.nl-modal').isHidden(), true);
    // 로그인 → 큰 모달 + 포커스 이동 + 3개 제공자
    await page.click('[data-nl-login]');
    assert.equal(await page.locator('.nl-modal').isHidden(), false);
    const hrefs = await page.locator('.nl-card a.nl-pv').evaluateAll(a => a.map(x => x.getAttribute('href')));
    assert.ok(/\/auth\/google\/start\?return_to=/.test(hrefs[0]) && /\/auth\/naver\/start\?return_to=/.test(hrefs[1]) && /tistory\.com\/manage/.test(hrefs[2]), hrefs.join());
    const card = await page.locator('.nl-card').boundingBox();
    assert.ok(card.x >= 0 && card.x + card.width <= width + 1 && card.y >= 0 && card.y + card.height <= 800 + 1, 'card inside ' + JSON.stringify(card));
    if (width > 720) assert.ok(card.width >= 560 && card.width <= 601, 'modal width ' + card.width);
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('nl-pv')), true, 'focus moves into modal');
    // 포커스 가둠: 마지막에서 Tab → 첫 요소(닫기 버튼 또는 첫 제공자)
    for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('.nl-modal')), true, 'focus stays inside modal');
    // ESC / 닫기 버튼 / 바깥 클릭
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.nl-modal').isHidden(), true, 'ESC closes');
    await page.click('[data-nl-login]'); await page.click('.nl-x');
    assert.equal(await page.locator('.nl-modal').isHidden(), true, 'x closes');
    await page.click('[data-nl-login]'); await page.mouse.click(4, 4);
    assert.equal(await page.locator('.nl-modal').isHidden(), true, 'outside click closes');
    // 로그인 확인되면 시작 화면이 닫힌다
    await page.evaluate(() => { sessionStorage.clear(); window.NineLanding.settle({authenticated: true}); });
    assert.equal(await page.locator('#nineLanding').count(), 0);
    // 비회원 로그인: 인증 없이 비회원 표시(sessionStorage)를 남기고 시작 화면을 닫는다
    await page.evaluate(() => { sessionStorage.clear(); window.NineLanding.show(false); });
    await page.evaluate(() => document.querySelector('[data-nl-guest]').click());
    assert.equal(await page.evaluate(() => window.__guestGo), true, 'guest goes to /');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('nine_guest')), '1');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('nine_authed') || localStorage.getItem('nine_authed')), null, 'guest is not authenticated');
    assert.equal(await page.locator('#nineLanding').count(), 0);
    console.log('PASS landing', width);
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
