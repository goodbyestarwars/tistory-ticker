const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('js/market-temp.js','utf8');let builds=0,value='';
const container={querySelector(){return null},querySelectorAll(){return []},get innerHTML(){return value},set innerHTML(v){builds++;value=v}};
const window={location:{search:'?view=stocks'}};
const context={window,URLSearchParams,document:{readyState:'loading',addEventListener(){},querySelector(s){return s==='#market-temp'?container:null}},localStorage:{getItem(){return null}}};
vm.runInNewContext(source,context);window.MarketTemp.init();window.MarketTemp.init();
assert.equal(builds,1,'onload + DOMContentLoaded must not rebuild the same category page');
vm.runInNewContext(source,context);window.MarketTemp.init();assert.equal(builds,1,'a second script tag must preserve the live panel and pending requests');
console.log('duplicate init and duplicate script loading preserve one live category panel');
