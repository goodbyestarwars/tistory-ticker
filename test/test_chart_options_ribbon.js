'use strict';
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
   await page.setContent('<html class="'+(dark?'dark':'')+'"><body><div id="foreign-flow"><div class="ff-price-chart-panel"><div class="ff-chart-toggles"><label><input id="option" type="checkbox" checked>단기 이평선</label></div><div class="ff-draw-tools"><button>직선</button></div><div id="chart"></div></div></div><div id="stock-search"><div class="ss-stock-controls"><div class="ss-chart-tabs"><div class="ss-drawing-tools"><button>그리기</button></div></div><div class="ss-chart-studies"><label><input type="checkbox">볼린저 밴드</label></div></div></div></body></html>');
   await page.addStyleTag({content:':root{--ui-rule:#ddd;--ui-ink:#123;--ui-surface:#fff;--ui-muted:#666;--font-ui:sans-serif}'+featureCss});
   await page.addScriptTag({content:ui});
   await page.addScriptTag({content:fs.readFileSync('js/chart-data.js','utf8')});
   await page.evaluate(() => {
    window.originalOption=document.querySelector('#option');window.optionChanges=0;
    originalOption.addEventListener('change',()=>window.optionChanges++);
    NineUI.chartOptions(document);NineUI.chartOptions(document);
    NineChartData.installRangeButtons(document.querySelector('#chart'),'005930',()=>({daily:[]}),()=>{});
   });
   assert.equal(await page.locator('.nine-chart-options').count(),2,'idempotent wrappers');
   const fold=page.locator('#foreign-flow .nine-chart-options');
   assert.equal(await fold.evaluate(n=>n.open),width>760,'responsive initial state');
   assert.equal(await page.locator('#option').isVisible(),width>760);
   assert(await page.locator('.ff-draw-tools button').isVisible(),'drawing stays outside fold');
   assert(await page.locator('.nine-chart-ranges').isVisible(),'periods stay outside fold');
   await fold.locator('summary').click();
   assert.equal(await fold.evaluate(n=>n.open),width<=760);
   if(width>760) await fold.locator('summary').click();
   await page.locator('#option').uncheck();
   await fold.locator('summary').click();await fold.locator('summary').focus();await page.keyboard.press('Enter');
   assert(await page.locator('#option').isVisible());
   assert.equal(await page.locator('#option').isChecked(),false);
   assert(await page.evaluate(()=>originalOption===document.querySelector('#option') && optionChanges===1),'same checkbox node and listener');
   await page.setViewportSize({width:width>760?390:1280,height:900});
   assert(await fold.evaluate(n=>n.open),'manual choice survives resize');
   await page.close();
   console.log('Chart option ribbon',width,dark?'dark':'light','passed');
  }
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
