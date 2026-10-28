/* Real headless Edge UI regression, synthetic local data only. NODE_PATH may
 * point at the bundled runtime packages. No production writes or broker calls. */
const {chromium} = require('playwright');
const {pathToFileURL} = require('url');
const path = require('path');
const fs = require('fs');
const assert = require('assert/strict');
(async()=>{
 const out = process.env.NINEPAY_CALENDAR_QA_DIR || path.resolve(__dirname,'../../calendar-qa');
 fs.mkdirSync(out,{recursive:true});
 const browser = await chromium.launch({channel:process.env.NINEPAY_QA_CHANNEL || 'msedge',headless:true});
 const reports=[];
 try {
  for(const width of [1440,390]) {
   const context=await browser.newContext({viewport:{width,height:1000},timezoneId:'America/Los_Angeles',isMobile:width===390});
   await context.route('https://**/*',route=>route.abort());
   const page=await context.newPage();
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.clock.install({time:new Date('2026-10-28T02:00:00Z')});
   await page.goto(pathToFileURL(path.join(__dirname,'calendar-unified.html')).href);
   await page.locator('.sc-completed-card').first().waitFor();
   const input=page.locator('[data-disclosure-search]');
   const requests=await page.evaluate(()=>calendarRequests.length);
   for(const query of ['STX','시게이트','HOOD','로빈후드','SK하이닉스','000660','삼성전자','005930','NVDA','엔비디아','FOMC','Google','분기보고서']) {
    await input.fill(query);
    assert.ok(await page.locator('.sc-completed-card').count()>0,query);
   }
   await input.fill('  stx  '); await input.press('Enter');
   assert.equal(await page.locator('.sc-completed-card').count(),1);
   await page.locator('.sc-search-submit').click();
   assert.equal(await page.locator('.sc-completed-card').count(),1);
   await page.locator('[data-calendar-result]').click();
   assert.ok((await page.locator('.sc-today-head').innerText()).includes('10월 28일'));
   assert.ok(await page.locator('.is-highlighted').count()>0);
   assert.equal(await page.evaluate(()=>calendarRequests.length),requests,'search must not fetch');
   await input.fill('nonexistent-zzzz');
   assert.ok((await page.locator('.sc-completed').innerText()).includes('검색 결과가 없습니다'));
   await input.fill('');
   assert.ok((await page.locator('.sc-completed h2').innerText()).includes('공시 완료'));
   await input.dispatchEvent('compositionstart');
   await input.fill('SK'); // composing suppresses input rendering
   await input.dispatchEvent('compositionend');
   assert.ok((await page.locator('.sc-completed').innerText()).includes('SK하이닉스'));
   await input.fill('HOOD');
   await page.locator('[data-calendar-action="next"]').click();
   assert.equal(await input.inputValue(),'HOOD');
   assert.ok((await page.locator('.sc-cal-title').innerText()).includes('11월'));
   await page.locator('[data-calendar-action="previous"]').click();
   assert.equal(await input.inputValue(),'HOOD');
   await input.fill('');
   await page.locator('[data-calendar-date="2026-10-28"]').click();
   assert.ok(await page.locator('.sc-more').count()>0);
   await page.locator('.sc-list-col .sc-more summary').click();
   assert.ok(await page.locator('.sc-list-col details[open]').count()>0);
   await page.locator('[data-calendar-market="econ"]').click();
   await input.fill('FOMC');
   assert.equal(await page.locator('.sc-completed-card').count(),1);
   await page.locator('[data-calendar-market="all"]').click();
   await input.fill('SK하이닉스');
   assert.ok((await page.locator('.sc-completed-card').innerText()).includes('콜 09:00'));
   assert.equal(errors.length,0,errors.join('\n'));
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
   assert.equal(overflow,false,'horizontal overflow at '+width);
   await page.screenshot({path:path.join(out,'calendar-'+width+'.png'),fullPage:true});
   await page.evaluate(()=>document.documentElement.classList.add('dark'));
   await page.screenshot({path:path.join(out,'calendar-dark-'+width+'.png'),fullPage:true});
   if(width===390){
    const base=pathToFileURL(path.join(__dirname,'calendar-unified.html')).href;
    await page.goto(base+'?error');
    await page.locator('.sc-source-health').waitFor();
    assert.ok((await page.locator('.sc-source-health').textContent()).includes('수집 실패'));
    await page.goto(base+'?apierror');
    await page.locator('.sc-source-health').waitFor();
    await page.locator('[data-disclosure-search]').fill('STX');
    assert.ok(await page.locator('.sc-completed-card').count()>0,'outage retains verified cached events');
    assert.ok((await page.locator('.sc-source-health').textContent()).includes('실적 API 조회 실패'));
   }
   reports.push({width,searches:13,requests:await page.evaluate(()=>calendarRequests.length),overflow,errors});
   await context.close();
  }
  fs.writeFileSync(path.join(out,'calendar-browser-results.json'),JSON.stringify(reports,null,2));
  console.log(JSON.stringify(reports));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
