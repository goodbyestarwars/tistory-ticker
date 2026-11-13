const fs=require('fs'),path=require('path'),assert=require('assert');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});
 for(const width of [1280,390,320]){
  const p=await b.newPage({viewport:{width,height:900}});
  await p.setContent('<style>*{box-sizing:border-box}:root{--font-title:"Noto Serif KR Site",serif}</style><div id="market-temp"></div>');
  await p.addStyleTag({content:fs.readFileSync(path.join(root,'css/market-map.css'),'utf8')});
  await p.evaluate(()=>{
   window.NineUI={escapeHtml:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))};
   window.NineAccess={isAdmin:()=>true};window.SECTOR_MAP={'반도체 장비':[{code:'100000'}]};
   window.COMPANY_PROFILES={asOf:'2026-10-07',source:'검증 fixture',companies:{'100000':{summary:'반도체 장비를 제조함.'}}};
   window.wics=Object.fromEntries(Array.from({length:350},(_,i)=>[String(100000+i),{name:'회사'+i,sector:'IT',industry:'반도체'}]));
   window.KRX_MAP={};
   window.requests=[];
   window.NineAPI={vmUrl:'https://example.test',domesticQuotes:async(codes,options)=>{
    requests.push({kind:'quotes',codes,options});return codes.filter(c=>c!=='100348').map(code=>({code,price:70000,changeRate:2,market:'KOSPI',marketCap:1e12}));
   },data:async(url)=>{const codes=new URL(url).searchParams.get('codes').split(',');requests.push({kind:'rs',codes});return {benchmarks:{KOSPI:{asOf:'2026-11-12',base1m:'2026-10-12',base1y:'2025-11-12',index1m:1,index1y:2}},prices:Object.fromEntries(codes.map(c=>[c,{'2026-11-12':120,'2026-10-12':100,'2025-11-12':90}]))};}};
  });
  await p.addScriptTag({content:fs.readFileSync(path.join(root,'js/market-map.js'),'utf8')});
  await p.evaluate(()=>MarketMap.init(document.querySelector('#market-temp'),wics));
  await p.waitForFunction(()=>!document.querySelector('#market-temp').__mtm.taxonomyLoading&&!document.querySelector('#market-temp').__mtm.loading);
  assert.equal(await p.evaluate(()=>document.querySelector('#market-temp').__mtm.candidates.length),350);
  const missing=await p.locator('[data-mtm-category] option').evaluateAll(es=>es.find(e=>e.value.startsWith('사업분류 미등록')).value);
  await p.locator('[data-mtm-category]').selectOption(missing);
  await p.waitForFunction(()=>!document.querySelector('#market-temp').__mtm.loading);
  assert.equal(await p.locator('[data-mtm-list-node]').count(),300);
  await p.locator('[data-mtm-page="next"]').click();await p.waitForFunction(()=>!document.querySelector('#market-temp').__mtm.loading);
  assert.equal(await p.locator('[data-mtm-list-node]').count(),49);
  assert((await p.locator('[data-mtm-list-node="100348"]').innerText()).includes('—'));
  await p.locator('[data-mtm-search]').fill('公司');await p.locator('[data-mtm-search]').fill('회사349');
  await p.waitForFunction(()=>document.querySelector('#market-temp').__mtm.quotes.some(q=>q.code==='100349'));
  assert.equal(await p.locator('[data-mtm-list-node]').count(),1);
  await p.locator('[data-mtm-list-node="100349"]').click();
  assert(await p.locator('dialog').evaluate(e=>e.open));assert((await p.locator('dialog').innerText()).includes('회사349'));
  assert(await p.locator('[data-mtm-page-nav]').isHidden());
  assert(await p.locator('dialog').evaluate(e=>{const r=e.getBoundingClientRect();return r.width<=innerWidth&&r.left>=0&&r.right<=innerWidth;}));
  if(process.env.MAP_SCREENSHOT_DIR)await p.screenshot({path:path.join(process.env.MAP_SCREENSHOT_DIR,'market-company-modal-'+width+'.png'),fullPage:true});
  await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.querySelector('dialog').open);
  await p.waitForFunction(()=>document.activeElement.getAttribute('data-mtm-list-node')==='100349');
  assert.equal(await p.evaluate(()=>document.activeElement.getAttribute('data-mtm-list-node')),'100349');
  await p.locator('[data-mtm-node="100349"]').hover();
  await p.waitForFunction(()=>getComputedStyle(document.querySelector('[data-mtm-node="100349"] .mtm-bubble')).strokeWidth==='1px');
  const hover=await p.locator('[data-mtm-node="100349"] .mtm-bubble').evaluate(e=>({stroke:getComputedStyle(e).stroke,width:getComputedStyle(e).strokeWidth}));
  assert.equal(hover.stroke,'rgb(255, 255, 255)');assert.equal(hover.width,'1px');
  assert.equal(await p.locator('svg .mtm-axis, svg .mtm-zero').count(),0);
  assert(!(await p.locator('main').innerText()).includes('지난 1년 시장보다 강함'));
  assert(!(await p.locator('[data-mtm-node-list]').innerText()).includes('%p'));
  assert((await p.evaluate(()=>requests)).every(r=>r.codes.length<=300));
  assert((await p.evaluate(()=>requests)).filter(r=>r.kind==='quotes').every(r=>r.options.fallback===false));
  if(process.env.MAP_SCREENSHOT_DIR)await p.screenshot({path:path.join(process.env.MAP_SCREENSHOT_DIR,'market-flow-'+width+'.png'),fullPage:true});
  await p.close();
 }
 await b.close();console.log('market map UI: full catalog, scope pagination, missing rows, modal focus/Esc, white hover, clean axes PASS (1280/390/320)');
})().catch(e=>{console.error(e);process.exit(1)});
