const {chromium}=require('playwright');
const assert=require('assert');
(async()=>{
const b=await chromium.launch({channel:'msedge',headless:true}),p=await b.newPage();
let data={revision:0,content:null},writeFail=false;
const content='<main data-market-discussion><div class="discussion-heading"></div><div class="discussion-stockbar"><input id="discussionStockInput"><button data-discussion-stock="all">일반방</button></div><div class="discussion-current"><strong data-discussion-current></strong><span data-discussion-count></span><button data-discussion-clear></button></div><div class="discussion-list-heading"></div><ol class="discussion-list"></ol><form class="discussion-native-guestbook"><div class="discussion-write"><textarea></textarea></div></form></main>';
async function mount(role,width=390){
await p.goto('about:blank');await p.setViewportSize({width,height:844});await p.setContent(content);
await p.addStyleTag({path:'css/stock-discussion.css'});
await p.exposeFunction('introRequest',async opts=>{if(opts.fetchOptions.method==='PUT'){if(writeFail)throw Error('denied');const body=JSON.parse(opts.fetchOptions.body);assert.equal(body.revision,data.revision);data={revision:data.revision+1,content:body.content};}return {data};}).catch(()=>{});
await p.evaluate(role=>{window.T={config:{ROLE:'owner'}};window.NineAccess={ready:Promise.resolve(),isAdmin:()=>role==='admin'};window.NineHttp={json:(u,o)=>window.introRequest(o)};window.NineUI={escapeHtml:s=>String(s).replaceAll('<','&lt;')};},role);
await p.addScriptTag({path:'js/stock-discussion.js'});
await p.waitForTimeout(80);
}
for(const role of ['guest','member']){await mount(role);assert.equal(await p.locator('.discussion-intro-edit').isVisible(),false);}
for(const width of [1280,390,320]){
await mount('admin',width);await p.locator('.discussion-intro-edit').click();await p.locator('[name=title]').fill('수정한 제목');
await p.locator('[name=body]').fill('<img src=x onerror=alert(1)>\n둘째 줄');await p.locator('[name=etiquette]').fill('새 안내');
await p.locator('[type=submit]').click();await p.waitForFunction(()=>!document.querySelector('dialog'));
assert.equal(await p.locator('.discussion-terminal-poem h2').textContent(),'수정한 제목');
assert.equal(await p.locator('.discussion-terminal-poem img').count(),0);
await p.locator('.discussion-intro-edit').click();await p.locator('[name=title]').waitFor();await p.waitForFunction(()=>!document.querySelector('dialog [type=submit]').disabled);
assert.equal(await p.locator('[name=title]').inputValue(),'수정한 제목');
assert(await p.evaluate(()=>{let r=document.querySelector('dialog').getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight;}));
await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.querySelector('dialog'));assert.equal(await p.locator('dialog').count(),0);
}
await mount('guest');assert.equal(await p.locator('.discussion-terminal-poem h2').textContent(),'수정한 제목');
await mount('admin');await p.locator('.discussion-intro-edit').click();await p.waitForFunction(()=>!document.querySelector('dialog [type=submit]').disabled);
writeFail=true;await p.locator('[type=submit]').click();await p.waitForFunction(()=>document.querySelector('[role=status]').textContent.includes('保存')||document.querySelector('[role=status]').textContent.includes('저장하지'));
assert.equal(await p.locator('dialog').count(),1);

await b.close();console.log('guest/member/owner spoof, admin editing, shared reload, XSS, save failure, Esc, 1280/390/320 passed');
})().catch(e=>{console.error(e);process.exit(1)});

