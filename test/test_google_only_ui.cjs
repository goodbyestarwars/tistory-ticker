const {chromium}=require('playwright'),path=require('path'),assert=require('assert');
(async()=>{
const b=await chromium.launch({channel:'msedge',headless:true}),p=await b.newPage();
const root=path.resolve(__dirname,'..');
for(const file of ['js/access-landing.js','js/skin-shell.js','js/access-gate.js','js/stock-discussion.js','js/skin-menu.js','js/watchlist.js','css/stock-discussion.css']){
await p.route('https://goodbyestarwars.github.io/tistory-ticker/'+file+'*',r=>r.fulfill({path:path.join(root,file),contentType:file.endsWith('.css')?'text/css':'application/javascript'}));
}
await p.goto('https://ghlee.tistory.com/guestbook',{waitUntil:'domcontentloaded'});
await p.waitForSelector('.discussion-intro-edit',{state:'attached'});
await p.waitForFunction(()=>!!window.NineAccess&&!!window.NineLanding&&!!window.NinePayAccountLogin);
await p.evaluate(()=>window.NineAccess.ready);
await p.evaluate(()=>{window.NineLanding.close();window.NineLanding.showLogin(true);});
assert.equal(await p.locator('.nl-pv').count(),1);
assert.equal(await p.locator('.nl-pv.nl-google').count(),1);
assert.equal(await p.locator('.nl-naver,.nl-kakao').count(),0);
await p.evaluate(()=>{window.NineLanding.close();window.NinePayAccountLogin.open();});
assert.equal(await p.locator('.account-login-naver').count(),0);
assert.equal(await p.locator('.account-login-google').count(),1);
assert.equal(await p.locator('.account-login-tistory').count(),1);
await p.keyboard.press('Escape');
for(const width of [1280,390,320]){
await p.setViewportSize({width,height:844});
for(const admin of [false,true,false]){
await p.evaluate(admin=>{window.NineAccess.isAdmin=()=>admin;if(window.T?.config)window.T.config.ROLE=admin?'guest':'owner';window.dispatchEvent(new CustomEvent('nineaccess:change'));},admin);
const v=await p.evaluate(()=>{const edit=document.querySelector('.discussion-intro-edit'),all=[...document.querySelectorAll('.discussion-terminal-bar button')].find(e=>e.textContent.includes('방 글 보기'));return {edit:!edit.hidden,all:getComputedStyle(all.parentElement).display!=='none'};});
assert.equal(v.edit,admin);assert.equal(v.all,admin);
}
}
await b.close();console.log('Google-only landing/shared chooser; Tistory-native option preserved; Google role controls edit/all rooms at 1280/390/320; revocation hides controls');
})().catch(e=>{console.error(e);process.exit(1)});

