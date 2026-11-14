const fs=require('fs'), path=require('path'), assert=require('assert');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 for(const width of [1280,390,320]) {
  const page=await browser.newPage({viewport:{width,height:800}});
  await page.setContent('<html><head></head><body></body></html>');
  await page.evaluate(()=>{
   window.members=[];window.writes=[];
   window.NineHttp={json:async(u,o)=>{const r=await window.fetch(u,o.fetchOptions);if(!r.ok)throw Error('http');return r.json();}};
   window.fetch=async(u,o={})=>{
    if(u.endsWith('/members')) {
     if(o.body){const b=JSON.parse(o.body);window.writes.push(b);if(b.action==='add')window.members=[...new Set([...window.members,b.email])];else window.members=window.members.filter(e=>e!==b.email);}
     return {ok:true,json:async()=>({data:{emails:window.members,revision:window.writes.length}})};
    }
    return {ok:true,json:async()=>({data:{isAdmin:true,screens:{stocks:{label:'종목',level:'member',roles:{guest:false,member:true,admin:true}},scanner:{label:'검색기',level:'admin',roles:{admin:true}},strategy:{label:'전략검색',level:'admin',roles:{admin:true}}}}})};
   };
  });
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'js/access-settings.js'),'utf8')});
  await page.evaluate(()=>NineAccessSettings.open());
  await page.getByText('등록된 일반회원이 없습니다.').waitFor();
  assert.equal(await page.locator('[data-key="scanner"][data-role="member"]').count(),0);
  await page.getByLabel('일반회원 이메일').fill('USER@EXAMPLE.COM');
  await page.getByRole('button',{name:'등록',exact:true}).click();
  await page.getByText('user@example.com',{exact:true}).waitFor();
  await page.getByRole('button',{name:'해제',exact:true}).click();
  await page.getByText('등록된 일반회원이 없습니다.').waitFor();
  assert.deepStrictEqual(await page.evaluate(()=>writes),[{action:'add',email:'user@example.com'},{action:'remove',email:'user@example.com'}]);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.evaluate(()=>{
    NineAccessSettings.close();
    document.body.innerHTML='<nav class="navbar"><div id="navSearchMount"></div></nav><div id="nav-menu-mount"></div>';
    window.T={config:{IS_LOGIN:true,ROLE:'owner'}};
    window.NineAccess={ready:Promise.resolve(),isAdmin:()=>false,allowsScreen:k=>['stocks','home','my','tools','market-temp'].includes(k),
     menuAllowsHref:href=>!(/pattern-scan|strategy-search|auto-trader|kis-tool|access-settings/.test(href))};
  });
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'js/skin-menu.js'),'utf8')});
  const links=await page.locator('#nav-menu-mount').innerText();
  for(const forbidden of ['검색기','전략검색','자동매매','KIS','화면 설정'])assert(!links.includes(forbidden),forbidden);
  assert(links.includes('종목분석'));
  await page.close();
 }
 await browser.close();console.log('members UI: 1280/390/320 add/remove/role ceiling passed');
})().catch(e=>{console.error(e);process.exit(1)});
