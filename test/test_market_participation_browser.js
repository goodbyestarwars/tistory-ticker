const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),cp=require('node:child_process');
const {extract,entry}=require('./test_market_participation');
const {render}=require('./test_market_participation_bars');
const {chromium}=require('playwright');
(async()=>{
 const dir='docs/qa/domestic-participation-2026-10-28';fs.mkdirSync(dir,{recursive:true});
 const old=cp.execFileSync('git',['show','origin/master:js/skin-main.js'],{encoding:'utf8'});
 const target={innerHTML:''},basis={};const c={isFinite,latestHomeParticipation:{domestic:{byIndex:{KOSPI:entry(),KOSDAQ:entry(1,.8)}}},homeMarketSession:()=>({market:'domestic'}),dashboardSection:{querySelector:s=>s==='[data-home-participation]'?target:basis}};
 vm.createContext(c);vm.runInContext(['escapeHomeHtml','homeParticipationModel','homeVolumeScale','renderMarketParticipation'].map(n=>extract(n,old)).join('\n'),c);c.renderMarketParticipation();
 const oldCss=cp.execFileSync('git',['show','origin/master:css/home-market-board.css'],{encoding:'utf8'});
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge'});
 for(const width of [1440,390,360]){
   const page=await browser.newPage({viewport:{width,height:900}});
   for(const state of ['before','after','missing','stale']){
     const result=state==='before'?{html:target.innerHTML,basis:basis.textContent}:state==='missing'?render(null,null):state==='stale'?render({...entry(),status:'stale'}):render();
     await page.setContent('<html><head><meta charset="utf-8"><style>:root{--font-ui:Arial;--font-data:Arial;--hmb-ink:#222;--hmb-mute:#667;--hmb-faint:#667;--hmb-flat:#aaa;--ui-paragraph-gap:14px;--num-up:red;--num-down:blue}*{box-sizing:border-box}body{margin:0;padding:20px}.home-editorial-page{max-width:1000px;margin:auto}'+(state==='before'?oldCss:fs.readFileSync('css/home-market-board.css','utf8'))+'</style></head><body id="tt-body-index"><main class="home-editorial-page"><section id="homeMarketBoard" class="hmb2"><p>검증용 합성 자료 · 시장 방향: 상승 우위 (기존 지표 유지)</p><div class="hmb2-verdict has-market-breadth"><div class="hmb2-direction">시장 방향</div><div data-home-participation class="hmb2-participation '+(state==='before'?'':'is-domestic')+'">'+result.html+'</div><div class="hmp-basis hmp-note">'+result.basis+'</div></div></section></main></body></html>');
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),state+' overflow '+width);
     if(state==='after'){
       const tracks=await page.locator('.hmp-ratio-track').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()));assert.equal(tracks.length,2);
       assert(Math.abs(tracks[0].width-tracks[1].width)<1);
       if(width<600)assert(tracks[1].y>tracks[0].y);
       await page.locator('summary').first().click();assert(await page.locator('details').first().evaluate(n=>n.open));
     }
     await page.screenshot({path:dir+'/'+state+'-'+width+'.png',fullPage:true});
   }
   await page.close();
 }
 await browser.close();console.log('PASS browser: before/after/missing/stale at 1440/390/360, no overflow, equal axes, mobile stack, details');
})().catch(e=>{console.error(e);process.exit(1)});
