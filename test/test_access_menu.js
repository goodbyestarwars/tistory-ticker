'use strict';
// node test/test_access_menu.js  (Playwright + Edge 필요: test_kis_menu.js 와 같은 환경)
// 비로그인·장애·일반 회원·관리자 메뉴, 모바일 하단 탭, 화면 설정 반영을 실제 브라우저로 확인한다.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const KEYS = ['guestbook','calendar','briefing','indicators','home','stocks','tools','my','market-temp','autotrader','kis'];
const PUB = ['guestbook','calendar','briefing','indicators'];
function policy(admin, off = []) {
  return {data: {isAdmin: admin, authenticated: admin, screens: Object.fromEntries(KEYS.map(k => {
    const en = !off.includes(k); return [k, {label: k, public: PUB.includes(k), enabled: en, allowed: en && (PUB.includes(k) || admin), locked: k === 'guestbook'}];
  }))}};
}

(async () => {
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  const scenarios = [['비로그인', false, null], ['일반회원', false, null], ['인증장애', false, 'fail'], ['관리자', true, null]];
  for (const width of [1280, 390, 320]) {
    for (const [name, admin, mode] of scenarios) {
      const page = await browser.newPage({viewport: {width, height: 800}});
      await page.setContent('<html><head></head><body><nav class="navbar"><div id="navSearchMount"></div></nav><div id="nav-menu-mount"></div></body></html>');
      await page.addStyleTag({content: fs.readFileSync('style.css', 'utf8')});
      await page.evaluate(([p, mode]) => {
        window.T = {config: {IS_LOGIN: true, ROLE: 'owner'}};
        window.__policy = p;
        const real = window.fetch;
        window.fetch = (u, i) => /access-policy/.test(u)
          ? (mode === 'fail' ? Promise.reject(new TypeError('down')) : Promise.resolve({ok: true, json: () => Promise.resolve(window.__policy)}))
          : real(u, i);
      }, [policy(admin), mode]);
      await page.addScriptTag({content: fs.readFileSync('js/access-gate.js', 'utf8')});
      await page.addScriptTag({content: fs.readFileSync('js/skin-menu.js', 'utf8')});
      await page.waitForTimeout(150);
      const links = await page.locator('#nav-menu-mount a, #nav-menu-mount .nav-group-trigger').allTextContents();
      const text = links.map(t => t.trim()).join('|');
      if (!admin) {
        for (const forbidden of ['홈', '증시온도', '주요 뉴스', '종목분석', '검색기', '전략검색', '독립 차트', 'MY', '자동매매', 'KIS', '트레이딩', '화면 설정', '물타기']) {
          assert.ok(!text.includes(forbidden), `${name}/${width} must hide ${forbidden}: ${text}`);
        }
        for (const must of ['캘린더', '커뮤니티', '마켓브리핑', '시장지표']) assert.ok(text.includes(must), `${name}/${width} must show ${must}: ${text}`);
        assert.equal(await page.locator('#navSearchInput').count(), 0, 'no stock search UI');
      } else {
        for (const must of ['홈', '종목분석', '검색기', 'MY', '자동매매', '화면 설정', '시장지표']) assert.ok(text.includes(must), `admin/${width} must show ${must}: ${text}`);
        assert.equal(await page.locator('#navSearchInput').count(), 1, 'admin keeps search');
      }
      console.log('PASS', name, width);
      if (name === '관리자' && width === 1280) {
        // 설정 저장 직후 반영: 캘린더 OFF
        await page.evaluate(() => { window.__policy = JSON.parse(JSON.stringify(window.__policy)); window.__policy.data.screens.calendar.allowed = false; });
        await page.evaluate(() => window.NineAccess.refresh().then(() => window.dispatchEvent(new Event('nineaccess:change'))));
        await page.waitForTimeout(100);
        assert.ok(!(await page.locator('#nav-menu-mount').innerText()).includes('캘린더'), 'OFF hides the menu entry');
      }
      await page.close();
    }
  }
  // 모바일 하단 탭바: 비로그인은 공개 4개 + 더보기
  for (const [name, admin] of [['비로그인', false], ['관리자', true]]) {
    const page = await browser.newPage({viewport: {width: 390, height: 800}});
    await page.setContent('<html><head></head><body><div id="nav-menu-mount"></div></body></html>');
    await page.evaluate(([p]) => {
      window.__policy = p;
      window.fetch = (u) => Promise.resolve({ok: true, json: () => Promise.resolve(window.__policy)});
    }, [policy(admin)]);
    await page.addScriptTag({content: fs.readFileSync('js/access-gate.js', 'utf8')});
    await page.addScriptTag({content: fs.readFileSync('js/skin-menu.js', 'utf8')});
    await page.addScriptTag({content: fs.readFileSync('js/home-mobile-tabs.js', 'utf8')});
    await page.waitForTimeout(200);
    const labels = (await page.locator('#mtabBar .mtab-bar-item').allTextContents()).map(t => t.trim());
    if (admin) assert.deepEqual(labels, ['홈', '시장', '종목', '더보기']);
    else assert.deepEqual(labels, ['대화방', '캘린더', '브리핑', '시장지표', '더보기']);
    console.log('PASS mobile tabbar', name, labels.join('/'));
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error(e); process.exitCode = 1; });
