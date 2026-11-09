'use strict';
// NineUI.chartOptions 보조지표 팝오버(2026-11-07): 기존 체크박스 노드를 그대로 옮기고, 상세 설정 등록·열고 닫기·
// PC 고정 위치/모바일 하단 시트를 확인한다. Run: node test/test_chart_options_ribbon.js
const fs = require('fs'), assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const shell = fs.readFileSync('js/skin-shell.js','utf8');
const ui = '/* NineUI:' + shell.split('/* NineUI:')[1].split('/* End NineUI */')[0];
const featureCss = fs.readFileSync('css/ui-system.css','utf8') + fs.readFileSync('css/foreign-flow.css','utf8') + fs.readFileSync('css/stock-search.css','utf8');
(async () => {
 const browser = await chromium.launch({channel:'msedge',headless:true});
 try {
  for (const width of [1280,760,390]) for (const dark of [false,true]) {
   const page = await browser.newPage({viewport:{width,height:900}});
   await page.setContent('<html class="'+(dark?'dark':'')+'"><body><div id="foreign-flow" style="overflow:hidden"><div class="ff-price-chart-panel"><div class="ff-chart-toggles"><label title="설명 문구"><input id="option" type="checkbox" checked>단기 이평선</label><label data-study-detail="ma"><input id="ma" type="checkbox">이동평균선</label></div><div class="ff-draw-tools"><button>직선</button></div><div id="chart"></div></div></div><div id="stock-search"><div class="ss-stock-controls"><div class="ss-chart-tabs"><div class="ss-drawing-tools"><button>그리기</button></div></div><div class="ss-chart-studies"><label><input type="checkbox">볼린저 밴드</label></div></div></div></body></html>');
   await page.addStyleTag({content:':root{--ui-rule:#ddd;--ui-ink:#123;--ui-surface:#fff;--ui-muted:#666;--font-ui:sans-serif}'+featureCss});
   await page.addScriptTag({content:ui});
   await page.addScriptTag({path:'chart-wave-overlay.js'});
   await page.evaluate(() => {
    document.querySelector('.ff-chart-toggles').insertAdjacentHTML('beforeend', NineChartWave.levelHtml('ff', true, 'major', true));
    window.originalOption=document.querySelector('#option');window.optionChanges=0;window.detailCalls=0;
    originalOption.addEventListener('change',()=>window.optionChanges++);
    NineUI.chartOptions(document);
    NineUI.chartOptions(document.querySelector('#foreign-flow'),{details:{ma:function(host){window.detailCalls++;host.innerHTML='<input id="period" value="20">';}}});
   });
   assert.equal(await page.locator('.nine-chart-options').count(),2,'idempotent wrappers');
   const wrap=page.locator('#foreign-flow .nine-chart-options'), pop=wrap.locator('.nine-studies-pop');
   assert.equal(await pop.isVisible(),false,'closed at start');
   assert(await page.locator('.ff-draw-tools button').isVisible(),'drawing stays outside popover');
   await wrap.locator('.nine-chart-options-trigger').click();
   assert(await pop.isVisible(),'opens');
   assert.equal(await wrap.locator('.nine-chart-options-trigger').getAttribute('aria-expanded'),'true');
   assert.equal(await page.locator('#option').getAttribute('title'),null,'native tooltip moved into the detail pane');
   assert.equal(await pop.locator('.nine-studies-detail-head p').textContent(),'설명 문구');
   const box=await pop.boundingBox();
   assert(box.x>=0 && box.x+box.width<=width+1,'popover stays inside the viewport and escapes overflow:hidden');
   if(width<=720) assert(Math.abs(box.y+box.height-900)<2,'mobile bottom sheet');
   const list=pop.locator('.nine-studies-list'), resize=pop.getByRole('separator');
   const fits=async () => {
    const panel=await list.boundingBox(), trend=await pop.locator('[data-wave-trend]').locator('..').boundingBox();
    assert(trend.x>=panel.x && trend.x+trend.width<=panel.x+panel.width,'trend label fits in the list');
   };
   await fits();
   if(width>720) {
    const handle=await resize.boundingBox(), x=handle.x+handle.width/2, y=handle.y+handle.height/2;
    assert.equal((await list.boundingBox()).width,246);
    await page.mouse.move(x,y);
    await page.mouse.down();
    await page.mouse.move(x+90,y,{steps:4});
    await page.mouse.up();
    assert.equal((await list.boundingBox()).width,336);
    await resize.press('Home');
    assert.equal((await list.boundingBox()).width,200);
    await fits();
    await resize.press('End');
    assert.equal((await list.boundingBox()).width,380);
   } else assert.equal(await resize.isVisible(),false);
   // 이름을 누르면 상세만 바뀌고 체크는 그대로, 동그라미(체크박스)는 원래 change 처리를 탄다.
   await page.locator('label[data-study-detail="ma"]').click({position:{x:12,y:10}});
   assert.equal(await page.locator('#ma').isChecked(),false,'label text selects, does not toggle');
   assert(await page.locator('#period').isVisible() && await page.evaluate(()=>detailCalls)>=1,'registered detail renderer');
   await page.locator('#option').uncheck();
   assert(await page.evaluate(()=>originalOption===document.querySelector('#option') && optionChanges===1),'same checkbox node and listener');
   await page.keyboard.press('Escape');
   assert.equal(await pop.isVisible(),false,'Esc closes');
   await wrap.locator('.nine-chart-options-trigger').click();
   await page.mouse.click(width-5,5);
   assert.equal(await pop.isVisible(),false,'outside click closes');
   await page.close();
   console.log('Chart studies popover',width,dark?'dark':'light','passed');
  }
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
