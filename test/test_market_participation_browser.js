const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),cp=require('node:child_process');
const {extract,entry}=require('./test_market_participation');
const {render}=require('./test_market_participation_bars');
const {chromium}=require('playwright');
(async()=>{
 const dir=process.env.QA_DIR || 'docs/qa/domestic-participation-2026-10-28';fs.mkdirSync(dir,{recursive:true});
 const old=cp.execFileSync('git',['show','1182b05b:js/skin-main.js'],{encoding:'utf8'});
 const target={innerHTML:''},basis={};const c={isFinite,latestHomeParticipation:{domestic:{byIndex:{KOSPI:entry(),KOSDAQ:entry(1,.8)}}},homeMarketSession:()=>({market:'domestic'}),dashboardSection:{querySelector:s=>s==='[data-home-participation]'?target:basis}};
 vm.createContext(c);vm.runInContext(['escapeHomeHtml','homeParticipationModel','homeVolumeScale','renderMarketParticipation'].map(n=>extract(n,old)).join('\n'),c);c.renderMarketParticipation();
 const oldCss=cp.execFileSync('git',['show','1182b05b:css/home-market-board.css'],{encoding:'utf8'});
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge'});
 for(const width of [1440,390,360]){
   const page=await browser.newPage({viewport:{width,height:900}});
   let originalPixels, originalGeometry;
   for(const state of ['before','after','missing','stale']){
     const result=state==='before'?{html:target.innerHTML,basis:basis.textContent}:state==='missing'?render(null,null):state==='stale'?render({...entry(),status:'stale'}):render();
     await page.setContent('<html><head><meta charset="utf-8"><style>:root{--font-ui:Arial;--font-data:Arial;--hmb-ink:#222;--hmb-mute:#667;--hmb-faint:#667;--hmb-flat:#aaa;--ui-paragraph-gap:14px;--num-up:red;--num-down:blue}*{box-sizing:border-box}body{margin:0;padding:20px}.home-editorial-page{max-width:1000px;margin:auto}'+(state==='before'?oldCss:fs.readFileSync('css/home-market-board.css','utf8'))+'</style></head><body id="tt-body-index"><main class="home-editorial-page"><section id="homeMarketBoard" class="hmb2"><p>검증용 합성 자료 · 시장 방향: 상승 우위 (기존 지표 유지)</p><div class="hmb2-verdict has-market-breadth"><div class="hmb2-direction">시장 방향</div><div data-home-participation class="hmb2-participation '+''+'">'+result.html+'</div><div class="hmp-basis hmp-note">'+result.basis+'</div></div></section></main></body></html>');
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),state+' overflow '+width);
     if(state==='before' || state==='after'){
       const chart=page.locator('[data-home-participation]');
       const pixels=[];
       for(const graph of await chart.locator('.hmp-column-chart').all()) pixels.push(await graph.screenshot({animations:'disabled'}));
       const geometry=await chart.locator('.hmp-column-track,.hmp-baseline,.hmp-column').evaluateAll(nodes=>nodes.map(n=>{
         const r=n.getBoundingClientRect(),s=getComputedStyle(n);
         return {x:r.x,y:r.y,width:r.width,height:r.height,color:s.backgroundColor,animation:s.animation,transition:s.transition};
       }));
       if(state==='before'){originalPixels=pixels;originalGeometry=geometry;}
       else {assert.deepEqual(geometry,originalGeometry,'original chart layout/color/animation at '+width);assert.equal(pixels.length,originalPixels.length);pixels.forEach((image,i)=>assert(image.equals(originalPixels[i]),'pixel-identical original graph '+i+' at '+width));}
     }
     await page.screenshot({path:dir+'/'+state+'-'+width+'.png',fullPage:true});
   }
   await page.close();
 }
 await browser.close();console.log('PASS browser: before/after/missing/stale at 1440/390/360, pixel-identical original chart, dimensions/colors/animation/baseline/side-by-side preserved, no overflow');
})().catch(e=>{console.error(e);process.exit(1)});
