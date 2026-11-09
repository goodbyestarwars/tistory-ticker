const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

async function verify() {
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    const page = await browser.newPage();
    const requests = [];
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'fixture.invalid') return route.abort();
      requests.push(url.pathname);
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
        <main data-market-discussion class="market-discussion">
          <div class="discussion-stockbar"><input id="discussionStockInput">
          <button data-discussion-stock="all">전체</button>
          <button data-discussion-stock="005930">삼성전자</button></div>
          <div class="discussion-current"><strong data-discussion-current></strong><button data-discussion-clear>해제</button></div>
          <div class="discussion-native-guestbook"><div class="discussion-write">
            <span class="discussion-write-note">등록하면 티스토리 방명록에 저장됩니다.</span><textarea aria-label="의견"></textarea><input type="submit" value="등록">
          </div></div>
          <div class="discussion-list-heading"><span data-discussion-count></span></div>
          <div class="discussion-list"><ol>
            <li data-discussion-entry class="guest_general"><div class="discussion-item-head">
              <span class="name">닉네임</span><span class="date">2026.11.09 10:20</span>
              <button>답글</button></div>
              <p class="discussion-item-body">[005930] 첫줄<br>&lt;img src=x onerror=alert(1)&gt;</p>
              <ul><li class="discussion-reply">답글 본문</li></ul>
            </li>
            <li data-discussion-entry class="guest_secret"><p>비밀 본문</p></li>
          </ol></div>
        </main>` });
    });
    async function open(query = '') {
      await page.goto('https://fixture.invalid/guestbook' + query);
      await page.addStyleTag({ path: path.join(__dirname, '../css/stock-discussion.css') });
      await page.addScriptTag({ path: path.join(__dirname, '../js/stock-discussion.js') });
    }
    await page.setViewportSize({ width: 360, height: 740 });
    await open();
    const terminal = page.locator('.discussion-terminal');
    const log = terminal.locator('ol');
    assert.equal(await log.locator('li').count(), 1);
    assert.match(await log.innerText(), /2026\.11\.09 10:20.*닉네임/s);
    assert.equal(await log.locator('.discussion-terminal-body').textContent(), '첫줄\n<img src=x onerror=alert(1)>');
    assert.equal(await log.locator('img').count(), 0);
    assert.doesNotMatch(await log.innerText(), /답글 본문|비밀 본문/);
    assert.equal(await terminal.locator('.discussion-terminal-bar strong').evaluate(el => getComputedStyle(el).color), 'rgb(255, 255, 255)');
    for (const selector of ['.discussion-stockbar', '.discussion-native-guestbook']) {
      assert.equal(await terminal.locator(selector).count(), 1);
    }
    assert.equal(await terminal.locator('.discussion-terminal-poem h2').textContent(), '실패할 수 있는 용기');
    assert.doesNotMatch(await terminal.locator('.discussion-terminal-welcome').innerText(), /회원ID|천리안 가입/);
    assert.equal(await terminal.locator('.discussion-terminal-rose').getAttribute('aria-hidden'), 'true');
    assert.equal(await terminal.locator('.discussion-terminal-modem').textContent(), '56K 로 가느라 좀 느립니다.');
    assert.equal(await terminal.locator('.discussion-write-note').count(), 0);
    assert.equal(await page.getByRole('textbox', { name: '메시지' }).getAttribute('placeholder'), '메시지를 입력하세요.');
    assert.ok((await log.boundingBox()).height >= 192);
    assert.equal(await terminal.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 0, 128)');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('button', { name: '삼성전자' }).click();
    assert.match(page.url(), /stock=005930/);
    assert.equal(await page.getByRole('button', { name: '삼성전자' }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('button', { name: '기본 방명록' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '답글' }).isVisible(), false);
    await page.getByRole('textbox', { name: '메시지' }).fill('테스트');
    await page.getByRole('button', { name: '보내기' }).click();
    assert.equal(await page.getByRole('textbox', { name: '메시지' }).inputValue(), '[005930] 테스트');
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
    await open('?view=native');
    assert.equal(await terminal.count(), 1);
    await page.goto('https://fixture.invalid/guestbook');
    assert.equal(await terminal.count(), 0);
    assert.equal(await page.getByRole('button', { name: '답글' }).isVisible(), true);
  } finally {
    await browser.close();
  }
}
verify().then(() => console.log('Classic discussion checks passed')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});

