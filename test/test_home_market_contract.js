'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('js/skin-main.js','utf8'),fields={};
const scope={document:{getElementById:()=>null},window:{NineTime:{updated:()=>''}},
  setField:(name,value)=>{fields[name]=value;}};
vm.createContext(scope);
const start=source.indexOf('    function resolveMarketDirection(');
const end=source.indexOf('    var MARKET_TEMP_VM_URL',start);
vm.runInContext(source.slice(start,end),scope);
scope.market={score100:23,grade3:{label:'공포'},temp:17,components:{
  riseRatio:{ratio:.094},avgChange:{avgChangeRate:-2.36},exchange:{price:1326.9,changeRate:.03}}};
vm.runInContext('renderMarketTemperature(market)',scope);
assert.equal(fields.temperature,'23점 공포');
assert.equal(fields.direction,'급락');
assert.match(fields.exchange,/1,326.9원/);
delete fields.temperature;
vm.runInContext('setHomeVmScore({score100:null}); renderMarketTemperature({temp:17,grade:{label:"중립"}})',scope);
assert.equal(fields.temperature,undefined,'missing score and legacy Celsius must not become a valid VM score');
assert(!source.includes("fetchHomeJson(GAS_TICKER_URL + '?marketTemp=1"));
assert(source.includes("home_market_temp_vm_v3"),'old Celsius cache cannot populate the canonical model');
console.log('PASS home uses VM score, breadth and exchange; null/legacy score stays missing');

/* Home market tabs keep a single source of style instead of competing
   generic segmented-control and legacy card-spacing overrides. */
const css=fs.readFileSync('style.css','utf8');
const homeTabSelector='body#tt-body-index .home-editorial-page .home-market-switch';
function cssBlock(selector) {
  const token=selector+' {';
  const at=css.indexOf(token);
  assert(at!==-1,'missing CSS selector: '+selector);
  const end=css.indexOf('}',at+token.length);
  assert(end!==-1,'unclosed CSS declaration: '+selector);
  return css.slice(at+token.length,end);
}
const homeTab=cssBlock(homeTabSelector);
const dashboard=cssBlock('body#tt-body-index .home-editorial-page');
const button=cssBlock(homeTabSelector+' button');
const underline=cssBlock(homeTabSelector+' button::after');
const underlineVisible=cssBlock(homeTabSelector+' button:is(:hover, .is-active, :focus-visible)::after');
const tabSelectors=css.split(/\r?\n/).filter(line=>line.includes('.home-market-switch'));
assert(tabSelectors.length>0);
for(const selectorLine of tabSelectors) {
  assert(selectorLine.includes(homeTabSelector),'market tabs may not appear in a shared segmented style: '+selectorLine);
}
assert.match(dashboard,/gap:\s*var\(--ui-section-gap\)/);
for(const expected of ['margin: 0','padding: 0','align-self: flex-start','max-width: 100%','overflow-x: auto','align-items: stretch','min-height: 44px']) {
  assert(homeTab.includes(expected),'market switch missing '+expected);
}
assert(!homeTab.includes('!important'),'no market tab specificity workarounds');
for(const expected of ['min-height: 44px','position: relative','border: 0']) {
  assert(button.includes(expected),'market tab button missing '+expected);
}
for(const expected of ['bottom: 0','height: 2px','opacity: 0']) {
  assert(underline.includes(expected),'market tab underline missing '+expected);
}
assert(underlineVisible.includes('opacity: 1'));
assert(cssBlock('html.dark '+homeTabSelector+' button::after').includes('var(--dk-text)'));
const homeWidgets=fs.readFileSync('js/home-widgets.js','utf8');
assert(homeWidgets.includes('dashboard.appendChild(marketSwitch)'));
assert(homeWidgets.includes('dashboard.appendChild(grid)'));
for(const market of ['domestic','us','closed']) {
  assert(source.includes('data-home-market-switch="'+market+'"'));
}
console.log('PASS home market tab underline, section gap and centralized CSS selectors');
