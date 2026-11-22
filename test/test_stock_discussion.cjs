const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

async function verify() {
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    const requests = [];
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'goodbyestarwars.github.io' && url.pathname.endsWith('/data/krx_map.js')) {
        return route.fulfill({ contentType: 'text/javascript; charset=utf-8', path: path.join(__dirname, '../data/krx_map.js') });
      }
      if (url.hostname !== 'fixture.invalid') return route.abort();
      requests.push(url.pathname);
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
        <main data-market-discussion class="market-discussion">
          <div class="discussion-stockbar"><input id="discussionStockInput">
          <button data-discussion-stock="all">전체</button>
          <button data-discussion-stock="005930">삼성전자</button></div>
          <div class="discussion-current"><strong data-discussion-current></strong><button data-discussion-clear>해제</button></div>
          <div class="discussion-native-guestbook"><div class="discussion-write">
            <div class="discussion-guest-fields"><input name="name" aria-label="이름"><input type="password" aria-label="비밀번호"></div><span class="discussion-write-note">등록하면 티스토리 방명록에 저장됩니다.</span><textarea aria-label="의견"></textarea><input type="submit" value="등록">
          </div></div>
          <div class="discussion-list-heading"><span data-discussion-count></span></div>
          <div class="discussion-list"><ol>
            <li data-discussion-entry class="guest_general"><div class="discussion-item-head">
              <span class="name">닉네임</span><span class="date">2026.11.09 10:20</span>
              <button>답글</button></div>
              <p class="discussion-item-body">[005930] 첫줄<br>&lt;img src=x onerror=alert(1)&gt;</p>
              <ul><li class="discussion-reply">답글 본문</li></ul>
            </li>
            <li data-discussion-entry class="guest_general"><div class="discussion-item-head">
              <span class="name">일반 사용자</span><span class="date">2026.11.09 11:20</span></div>
              <p class="discussion-item-body">일반방 글 [005930] 언급</p>
            </li>
            <li data-discussion-entry class="guest_general"><div class="discussion-item-head">
              <span class="name">이전 사용자</span><span class="date">2026.11.08 09:00</span></div>
              <p class="discussion-item-body">이전 글</p>
            </li>
            <li data-discussion-entry class="guest_admin"><div class="discussion-item-head">
              <span class="name">gOOdbyestar</span><span class="date">2026.11.21 03:12</span></div>
              <p class="discussion-item-body">블로그 주인 공개 글</p>
            </li>
            <li data-discussion-entry class="guest_admin_secret"><p>주인 비밀 본문</p></li>
            <li data-discussion-entry class="guest_secret"><p>비밀 본문</p></li>
            <li data-discussion-entry class="guest_general"><div class="discussion-item-head">
              <span class="name">상장 종목 사용자</span><span class="date">2026.11.22 10:00</span></div>
              <p class="discussion-item-body">[0147B0] 영문 포함 상장 코드</p>
            </li>
            <li data-discussion-entry class="guest_general"><div class="discussion-item-head">
              <span class="name">이전 유령방 사용자</span><span class="date">2026.11.22 11:00</span></div>
              <p class="discussion-item-body">[US:ZZZFAKE] 예전 미등록 방 글</p>
            </li>
          </ol></div>
        </main>` });
    });
    async function open(query = '') {
      await page.goto('https://fixture.invalid/guestbook' + query);
      await page.addStyleTag({ path: path.join(__dirname, '../css/stock-discussion.css') });
      await page.evaluate(() => {
        window.NineUI = { escapeHtml: value => String(value).replaceAll('<', '&lt;') };
        window.NineHttp = { json: () => Promise.resolve({ data: { content: null } }) };
      });
      await page.addScriptTag({ path: path.join(__dirname, '../js/stock-search-panel.js') });
      await page.addScriptTag({ path: path.join(__dirname, '../js/stock-discussion.js') });
    }
    await page.setViewportSize({ width: 360, height: 740 });
    await open();
    const terminal = page.locator('.discussion-terminal');
    const log = terminal.locator('ol');
    assert.deepEqual(pageErrors, []);
    assert.equal(await terminal.locator('.discussion-terminal-status').count(), 0);
    assert.equal(await log.locator('li').count(), 3);
    assert.doesNotMatch(await log.innerText(), /예전 미등록 방 글|영문 포함 상장 코드/);
    assert.match(await log.locator('li').first().innerText(), /블로그 주인 공개 글/);
    assert.match(await log.locator('li').nth(1).innerText(), /이전 글/);
    assert.match(await log.locator('li').last().innerText(), /일반방 글/);
    assert.doesNotMatch(await log.innerText(), /주인 비밀 본문/);
    assert.match(await log.innerText(), /일반방 글/);
    assert.doesNotMatch(await log.innerText(), /첫줄/);
    await page.getByRole('textbox', { name: '메시지' }).fill('일반방 테스트');
    await page.getByRole('button', { name: '보내기' }).click();
    assert.equal(await page.getByRole('textbox', { name: '이름' }).evaluate(el => el.validity.valid), false);
    await page.getByRole('textbox', { name: '이름' }).fill('방문자');
    await page.getByLabel('비밀번호').fill('test1234');
    await page.getByRole('button', { name: '보내기' }).click();
    assert.equal(await page.getByRole('textbox', { name: '메시지' }).inputValue(), '일반방 테스트');
    await page.getByRole('button', { name: '삼성전자' }).click();
    assert.doesNotMatch(await log.innerText(), /일반방 글/);
    assert.match(await log.innerText(), /2026\.11\.09 10:20.*닉네임/s);
    assert.equal(await log.locator('.discussion-terminal-body').textContent(), '첫줄\n<img src=x onerror=alert(1)>');
    assert.equal(await log.locator('img').count(), 0);
    assert.doesNotMatch(await log.innerText(), /답글 본문|비밀 본문/);
    assert.equal(await terminal.locator('.discussion-terminal-bar strong').evaluate(el => getComputedStyle(el).color), 'rgb(255, 255, 255)');
    for (const selector of ['.discussion-stockbar', '.discussion-native-guestbook']) {
      assert.equal(await terminal.locator(selector).count(), 1);
    }
    assert.equal(await terminal.locator('.discussion-terminal-poem h2').count(), 0);
    assert.doesNotMatch(await terminal.locator('.discussion-terminal-welcome').innerText(), /회원ID|천리안 가입/);
    assert.equal(await terminal.locator('.discussion-terminal-etiquette').textContent(), '대화실 이용시 건전한 언어를 사용합시다.');
    assert.equal(await terminal.locator('.discussion-terminal-welcome').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 0, 128)');
    assert.equal(await terminal.locator('.discussion-terminal-rose').getAttribute('aria-hidden'), 'true');
    assert.equal(await terminal.locator('.discussion-terminal-modem').textContent(), '56K 로 가느라 좀 느립니다.');
    assert.equal(await terminal.locator('.discussion-write-note').count(), 0);
    assert.equal(await terminal.locator('.discussion-composer-prompt').textContent(), '> 메시지 입력');
    const message = terminal.locator('.discussion-composer').getByRole('textbox', { name: '메시지' });
    await terminal.locator('.discussion-composer-prompt').click();
    assert.equal(await message.evaluate(el => document.activeElement === el && getComputedStyle(el).outlineStyle === 'none'), true);
    assert.equal(await page.getByRole('button', { name: '보내기' }).inputValue(), '↵');
    assert.ok((await log.boundingBox()).height >= 192);
    assert.equal(await terminal.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 0, 128)');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.match(page.url(), /stock=005930/);
    assert.equal(await page.getByRole('button', { name: '삼성전자' }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('button', { name: '기본 방명록' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '답글' }).isVisible(), false);
    await message.fill('테스트');
    await message.press('Enter');
    assert.equal(await message.inputValue(), '테스트\n');
    await message.dispatchEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true });
    assert.equal(await message.inputValue(), '테스트\n');
    await message.press('Control+Enter');
    assert.equal(await message.inputValue(), '[005930] 테스트\n');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('9pay.discussion.returnRoom')), '005930');
    assert.equal(requests.length, 1);
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: '새로고침' }).click();
    assert.equal(requests.length, 1);
    await page.getByRole('textbox', { name: '메시지' }).fill('');
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: '새로고침' }).click()]);
    assert.equal(requests.length, 2);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open('?stock=000660');
    assert.match(await terminal.innerText(), /표시할 공개 의견이 없습니다/);
    const stockInput = page.locator('#discussionStockInput');
    const room = page.locator('[data-discussion-current]');
    await stockInput.fill('ㅅㅌㄹㅇ');
    await page.getByRole('option').filter({ hasText: /셀트리온068270/ }).waitFor();
    await stockInput.fill('셀트리온');
    assert.match(await page.getByRole('option').first().textContent(), /셀트리온068270/);
    await page.getByRole('option').first().click();
    assert.match(await room.innerText(), /셀트리온 · 068270/);
    assert.match(page.url(), /stock=068270/);
    for (const invalid of ['999999', 'ZZZFAKE', '대화방테스트', 'INDEX:KOSPI', 'CRYPTO:BTC']) {
      await stockInput.fill(invalid);
      await stockInput.press('Enter');
      await page.waitForFunction(() => document.querySelector('#discussionStockInput').validity.customError);
      assert.equal(await page.getByRole('option').count(), 0);
      assert.match(page.url(), /stock=068270/);
    }
    await stockInput.fill('aapl');
    await stockInput.press('Enter');
    await page.waitForURL(/stock=US%3AAAPL/);
    assert.match(await room.innerText(), /애플 · US:AAPL/);
    await open('?stock=068270');
    await room.filter({ hasText: /셀트리온 · 068270/ }).waitFor();
    await open('?stock=0147b0');
    await room.filter({ hasText: /래블업 · 0147B0/ }).waitFor();
    assert.match(await log.innerText(), /영문 포함 상장 코드/);
    for (const invalid of ['999999', 'US%3AZZZFAKE']) {
      await open('?stock=' + invalid);
      await page.waitForURL(url => !url.searchParams.has('stock'));
      assert.equal(await room.innerText(), '일반방');
      assert.doesNotMatch(await log.innerText(), /예전 미등록 방 글/);
    }
    await open('?view=native');
    assert.equal(await terminal.count(), 1);
    await page.goto('https://fixture.invalid/guestbook');
    assert.equal(await terminal.count(), 0);
    assert.equal(await page.getByRole('button', { name: '답글' }).isVisible(), true);
    await page.evaluate(() => sessionStorage.setItem('9pay.discussion.returnRoom', '005930'));
    await open();
    assert.match(page.url(), /stock=005930/);
    assert.match(await log.innerText(), /첫줄/);
    assert.equal(await page.getByRole('textbox', { name: '이름' }).inputValue(), '방문자');
    assert.equal(await page.getByLabel('비밀번호').inputValue(), 'test1234');
    await page.getByLabel('비밀번호').fill('');
    await open();
    assert.equal(await page.getByLabel('비밀번호').inputValue(), '');
  } finally {
    await browser.close();
  }
}
verify().then(() => console.log('Classic discussion checks passed')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});

