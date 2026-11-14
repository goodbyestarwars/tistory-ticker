'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 for(const width of [390,320])for(const account of ['guest','member','admin','failed']){
  const p=await browser.newPage({viewport:{width,height:844}});let authed=account==='member'||account==='admin',fail=account==='failed',logout=[];
  const fixture='<html><head><style>'+read('style.css')+'\n'+read('css/home-mobile-tabs.css')+'</style></head><body><nav class="navbar"><div class="nav-icons"><a class="nav-icon-btn nav-manage-btn" href="/manage">계정</a><a class="nav-icon-btn nav-logout-btn" href="#"><svg width="18" height="18"></svg></a></div></nav><div id="nav-menu-mount"></div><script>window.__isBlogAdmin=()=>false;window.NineGuestHome={mount:()=>true};window.NineLanding={seen:()=>false,isOpen:()=>!!document.querySelector("#landing"),settle:()=>{},close:()=>{},show:()=>{if(!document.querySelector("#landing")){let el=document.createElement("div");el.id="landing";el.textContent="로그인";document.body.appendChild(el)}}};</script><script>'+read('js/access-gate.js')+'</script><script>'+read('js/home-mobile-tabs.js')+'</script></body></html>';
  await p.route('https://ghlee.tistory.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:fixture}));
  await p.route('https://goodbyestar.cloud/access-policy',r=>fail?r.abort():r.fulfill({json:{data:{authenticated:authed,isAdmin:authed&&account==='admin',screens:{guestbook:{allowed:true},home:{allowed:authed&&account==='admin'},my:{allowed:authed}}}}}));
  await p.route('https://goodbyestar.cloud/auth/google/me',r=>r.fulfill({json:{data:{authenticated:authed,naverConfigured:false}}}));
  await p.route('https://goodbyestar.cloud/auth/google/logout?**',r=>{logout.push('server');authed=false;fail=false;return r.fulfill({contentType:'text/html',body:'<script>location.replace("https://ghlee.tistory.com/")</script>'});});
  await p.route('https://www.tistory.com/auth/logout?**',r=>{logout.push('tistory');return r.fulfill({contentType:'text/html',body:'<script>location.replace("https://ghlee.tistory.com/")</script>'});});
  await p.addInitScript(()=>{if(!sessionStorage.getItem('test_initialized')){sessionStorage.setItem('test_initialized','1');sessionStorage.setItem('nine_guest','1');localStorage.setItem('nine_authed','1');}});
  await p.goto('https://ghlee.tistory.com/guestbook');await p.evaluate(()=>NineAccess.ready);
  await p.locator('.nav-logout-btn').waitFor({state:'visible'});
  assert.equal(await p.locator('.nav-logout-btn').getAttribute('aria-label'),authed?'로그아웃':'이용 종료');
  await p.locator('[data-mtab="more"]').click();
  assert.equal(await p.locator('.mtab-account-status').textContent(),authed?(account==='admin'?'관리자로 로그인됨':'로그인됨'):fail?'로그인 상태 확인 실패':'비회원으로 이용 중');
  assert.equal(await p.locator('#mtabDrawer [data-mtab-proxy=".nav-logout-btn"]').count(),1);
  if(account==='member'){
   authed=false;await p.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
   await p.waitForFunction(()=>document.querySelector('.mtab-account-status').textContent==='비회원으로 이용 중');
   assert.equal(await p.evaluate(()=>localStorage.getItem('nine_authed')),null);
   assert.equal(await p.evaluate(()=>sessionStorage.getItem('nine_guest')),null);
  }
  await p.locator('#mtabDrawer [data-mtab-proxy=".nav-logout-btn"]').click();await p.locator('#landing').waitFor({timeout:15000}).catch(async e=>{console.log({url:p.url(),logout,body:await p.locator('body').innerText()});throw e;});
  assert.deepEqual(logout,['server','tistory']);
  assert.equal(await p.evaluate(()=>sessionStorage.getItem('nine_guest')),null);
  assert.equal(await p.evaluate(()=>localStorage.getItem('nine_authed')),null);
  console.log('PASS mobile account',account,width,'status, exit, server→Tistory→landing');await p.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
