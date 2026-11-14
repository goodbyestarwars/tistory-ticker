const fs=require('fs'),path=require('path'),assert=require('assert');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const source=p=>fs.readFileSync(path.join(root,p),'utf8');
(async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});
 for(const width of [1280,390,320]){
  const p=await b.newPage({viewport:{width,height:900}});
  await p.route('https://ghlee.tistory.com/**',r=>r.fulfill({contentType:'text/html',body:'<div id="market-temp"></div><div id="nav-menu-mount"></div>'}));
  await p.goto('https://ghlee.tistory.com/page/market-temp?view=stocks');
  await p.addStyleTag({content:source('css/market-temp.css')});
  await p.evaluate(()=>{
   window.calls=[];
   window.NineUI={escapeHtml:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),spinner:()=>''};
   window.NineAccess={ready:Promise.resolve(),isAdmin:()=>true,allowsScreen:()=>true,menuAllowsHref:()=>true};
   window.KRX_MAP={'삼성전자':'005930','SK하이닉스':'000660'};
   window.WICS_MAP={'005930':{sector:'IT',industry:'반도체',market:'KOSPI'},'000660':{sector:'IT',industry:'반도체',market:'KOSPI'}};
   window.NineHttp={json:async u=>{calls.push(u);
    if(u.includes('theme-flow'))return {data:{rows:[{industry:'반도체',avg_change_rate:2}]}};
    if(u.includes('invest-signal'))return null;
    if(u.includes('market-board'))return {data:{updated_at:1794582000,rows:[{code:'005930',name:'삼성전자',price:70000,change_rate:2,trade_amount:2e9,trade_volume:30000,market:'KOSPI'},{code:'000660',name:'SK하이닉스',price:150000,change_rate:-1,trade_amount:3e9,trade_volume:20000,market:'KOSPI'}]}};
    if(u.includes('bubble=1'))return {};
    throw Error('Unexpected request '+u);
   }};
  });
  await p.addScriptTag({content:source('js/market-temp.js')});
  await p.locator('[data-all-stock-code="005930"]').waitFor();
  assert.equal(await p.locator('[data-all-stock-code]').count(),2);
  assert((await p.locator('[data-stocks-list]').innerText()).includes('70,000원'));
  assert.equal(await p.locator('[data-theme-picker-open], [data-adopt-group], .mt-pick-add').count(),0);
  assert(!(await p.evaluate(()=>calls)).some(u=>u.includes('sector-cards')));
  const n=await p.evaluate(()=>calls.length);await p.evaluate(()=>MarketTemp.init());assert.equal(await p.evaluate(()=>calls.length),n);
  await p.locator('[data-all-stock-search]').fill('삼성');assert.equal(await p.locator('[data-all-stock-code]').count(),1);
  await p.locator('[data-all-stock-refresh]').click();await p.locator('[data-all-stock-code="000660"]').waitFor();
  assert.equal(await p.locator('[data-theme-picker-open]').count(),0);
  await p.evaluate(()=>{NineAccess.isAdmin=()=>false;document.querySelector('#market-temp').__mtStocksInitialized=false;window.before=calls.length;MarketTemp.init();});
  await p.getByText('화면 접근은 허용되지만',{exact:false}).waitFor();assert.equal(await p.evaluate(()=>calls.length-before),0);
  await p.close();
 }
 for(const width of [1280,390,320]){
  const p=await b.newPage({viewport:{width,height:900}});
  await p.setContent('<style>:root{--font-title:"Noto Serif KR Site",serif}*{box-sizing:border-box}</style><div id="market-temp"></div><div id="nav-menu-mount"></div>');
  await p.addStyleTag({content:source('css/market-map.css')});
  await p.evaluate(()=>{
   window.NineUI={escapeHtml:s=>String(s)};
   window.NineAccess={isAdmin:()=>true,ready:Promise.resolve(),allowsScreen:()=>true,menuAllowsHref:()=>true};
   window.NineAPI={domesticQuotes:async()=>[],data:async()=>({benchmarks:{},prices:{}})};
   window.WICS_MAP={'005930':{name:'삼성전자',sector:'IT',industry:'반도체',market:'KOSPI'}};
  });
  await p.addScriptTag({content:source('js/market-map.js')});
  await p.evaluate(()=>MarketMap.init(document.querySelector('#market-temp')));
  const m=await p.evaluate(()=>{const l=document.querySelector('.mtm-search-label span'),i=document.querySelector('[data-mtm-search]'),h=document.querySelector('.mtm h1');return {labelHeight:l.getBoundingClientRect().height,inputWidth:i.getBoundingClientRect().width,titleSize:getComputedStyle(h).fontSize,titleFont:getComputedStyle(h).fontFamily};});
  assert(m.labelHeight<24);assert(m.inputWidth<250);assert.equal(m.titleSize,width>760?'24px':'22px');assert(m.titleFont.includes('Noto Serif KR Site'));
  await p.addScriptTag({content:source('js/skin-menu.js')});
  const menu=await p.locator('a[href="/page/market-temp?view=map"]').first().evaluate(e=>({label:e.textContent,group:e.closest('.nav-group').querySelector('.nav-group-trigger').textContent}));
  assert(menu.label.includes('시장 지도'));assert.equal(menu.group.trim(),'시장');
  await p.close();
 }
 await b.close();console.log('stocks page + market flow title/search/menu: 1280/390/320 passed');
})().catch(e=>{console.error(e);process.exit(1)});
