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
      // 2026-11-11: 메뉴는 서버 확인 관리자(NineAccess)일 때만 전체 표시 - 관리자 세션 스텁
      window.NineAccess={allowsHref:()=>true,isAdmin:()=>true,ready:Promise.resolve()};
    });
    await page.addScriptTag({content:fs.readFileSync('js/skin-menu.js','utf8')});
    await page.waitForTimeout(50);
    assert.equal(await page.getByRole('link',{name:'트레이딩 도구',exact:true}).count(),1,'Tistory owner sees both links before Google login');
    await page.evaluate(()=>{window.kisAllowed=true;window.dispatchEvent(new Event('focus'));});
    const kis=page.getByRole('link',{name:'트레이딩 도구',exact:true});
    await kis.waitFor();
    const group=page.locator('.nav-end-group');
    assert.deepEqual(await group.locator('a').allTextContents(),['자동매매','트레이딩 도구','화면 설정']);
    const boxes=await group.locator('a').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top};}));
    assert.ok(boxes[1].left>=boxes[0].right-1,JSON.stringify({width,boxes}));
    assert.equal(Math.round(boxes[0].top),Math.round(boxes[1].top));
    if(width===1280) {
      const my=await page.getByRole('link',{name:'MY',exact:true}).boundingBox();
      assert.ok(boxes[0].left>=my.x+my.width-1,'administrator links overlap MY');
    }
    await page.evaluate(()=>{window.kisAllowed=false;window.dispatchEvent(new Event('focus'));});
    await page.waitForTimeout(50);
    assert.equal(await kis.count(),1,'Google logout must not separate KIS from auto-trader');
    await page.evaluate(()=>{window.NineAPI.kisToolAccess=async()=>{throw Error('offline')};window.dispatchEvent(new Event('focus'));});
    await page.waitForTimeout(30);
    assert.equal(await kis.count(),1,'server access gate is independent from menu display');
    console.log('PASS owner links stay adjacent regardless of Google state:',width);
    await page.close();
    for (const googleAdmin of [false,true]) {
      const guest=await browser.newPage({viewport:{width,height:850}});
      await guest.setContent('<div id="nav-menu-mount"></div>');
      await guest.evaluate(allowed=>{
        window.T={config:{IS_LOGIN:false,ROLE:'guest'}};
        window.NineAPI={kisToolAccess:async()=>({allowed})};
      },googleAdmin);
      await guest.addScriptTag({content:fs.readFileSync('js/skin-menu.js','utf8')});
      await guest.waitForTimeout(50);
      assert.equal(await guest.getByRole('link',{name:'자동매매',exact:true}).count(),0);
      assert.equal(await guest.getByRole('link',{name:'트레이딩 도구',exact:true}).count(),0,'Google admin alone must not reveal KIS');
      await guest.close();
    }
  }
  await browser.close();
})().catch(error=>{console.error(error);process.exitCode=1;});
