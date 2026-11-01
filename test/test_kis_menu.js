'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({channel:'msedge', headless:true});
  for (const width of [1280, 900, 390]) {
    const page = await browser.newPage({viewport:{width,height:850}});
    await page.setContent('<html><head></head><body><aside class="sidebar-left"><div id="nav-menu-mount"></div></aside></body></html>');
    await page.addStyleTag({content:fs.readFileSync('style.css','utf8')});
    await page.evaluate(() => {
      window.T={config:{IS_LOGIN:true,ROLE:'owner'}};
      window.kisAllowed=false;
      window.NineAPI={kisToolAccess:async()=>({allowed:window.kisAllowed})};
    });
    await page.addScriptTag({content:fs.readFileSync('js/skin-menu.js','utf8')});
    await page.waitForTimeout(50);
    assert.equal(await page.getByRole('link',{name:'KIS Trading Tool',exact:true}).count(),0);
    await page.evaluate(()=>{window.kisAllowed=true;window.dispatchEvent(new Event('focus'));});
    const kis=page.getByRole('link',{name:'KIS Trading Tool',exact:true});
    await kis.waitFor();
    const group=page.locator('.nav-end-group');
    assert.deepEqual(await group.locator('a').allTextContents(),['자동매매','KIS Trading Tool']);
    const boxes=await group.locator('a').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top};}));
    assert.ok(boxes[1].left>=boxes[0].right-1,JSON.stringify({width,boxes}));
    assert.equal(Math.round(boxes[0].top),Math.round(boxes[1].top));
    if(width===1280) {
      const my=await page.getByRole('link',{name:'MY',exact:true}).boundingBox();
      assert.ok(boxes[0].left>=my.x+my.width-1,'administrator links overlap MY');
    }
    await page.evaluate(()=>{window.kisAllowed=false;window.dispatchEvent(new Event('focus'));});
    await page.waitForTimeout(50);
    assert.equal(await kis.count(),0,'logout must remove private menu');
    await page.evaluate(()=>{window.NineAPI.kisToolAccess=async()=>{throw Error('offline')};window.dispatchEvent(new Event('focus'));});
    await page.waitForTimeout(30);
    assert.equal(await kis.count(),0,'auth outage must keep menu hidden');
    console.log('PASS menu visibility, adjacency, logout, auth failure:',width);
    await page.close();
  }
  await browser.close();
})().catch(error=>{console.error(error);process.exitCode=1;});
