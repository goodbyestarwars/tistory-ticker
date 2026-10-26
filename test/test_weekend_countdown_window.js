const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const shell = fs.readFileSync('js/skin-shell.js', 'utf8');
const anchor = shell.indexOf('  var KST_OFFSET_MS');
const calendar = {window:{}};
vm.runInNewContext(shell.slice(shell.lastIndexOf('(function (global)',anchor),shell.indexOf('})(window);',anchor)+11),calendar);
const report = fs.readFileSync('js/home-weekly-report.js','utf8');
const source = report.slice(report.indexOf('  var countdownTimer = null;'),report.indexOf('  var INDEX_SPECS'));
function renderAt(iso) {
  const banner={hidden:true}, clock={label:'',setAttribute(name,value){this.label=value;},querySelector(){return {textContent:'',innerHTML:''};}};
  const opening={textContent:''}, next={textContent:''}, label={textContent:''}, delays=[];
  const root={hidden:false,querySelector(selector){return {'.wd-header':banner,'.wd-flip-clock':clock,'.wd-countdown-label':label,'[data-wd-open]':opening,'[data-wd-next-trading]':next}[selector];}};
  class FixedDate extends Date {constructor(...args){super(...(args.length?args:[iso]));} static now(){return new FixedDate().getTime();}}
  const context={Date:FixedDate,global:{MarketHours:calendar.window.MarketHours},document:{hidden:false,body:{contains:()=>true}},
    clearTimeout(){},setTimeout(fn,delay){delays.push(delay);},nextTradingDay:()=>'',};
  vm.runInNewContext(source+';startCountdown(root);',{...context,root});
  return {banner,clock,opening,label,delays};
}
for(const iso of ['2026-10-27T00:30:00+09:00','2026-10-30T23:00:00+09:00',
  '2026-10-31T08:59:59+09:00','2026-11-07T09:59:59+09:00',
  '2026-11-02T08:00:00+09:00','2027-01-02T12:00:00+09:00']) {
  const r=renderAt(iso);assert.equal(r.banner.hidden,false,iso);assert.equal(r.clock.hidden,true,iso);assert.equal(r.clock.label,'',iso);assert.match(r.label.textContent,/주말 미국장 종료 후/);
}
for(const iso of ['2026-10-31T09:00:00+09:00','2026-11-01T12:00:00+09:00',
  '2026-11-02T07:59:59+09:00','2026-11-07T10:00:00+09:00']) {
  const r=renderAt(iso);assert.equal(r.banner.hidden,false,iso);assert.equal(r.clock.hidden,false,iso);assert.match(r.clock.label,/남음/);assert.match(r.opening.textContent,/08:00 KST · 국내 프리마켓/);
}
assert.match(renderAt('2026-10-31T09:00:00+09:00').clock.label,/1일 23시간 0분 0초/);
console.log('PASS weekend display boundaries, US DST end, next opening, weekday and unknown calendar exclusions');
