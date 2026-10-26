const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const shell = fs.readFileSync('js/skin-shell.js', 'utf8');
const anchor = shell.indexOf('  var KST_OFFSET_MS');
const calendar = { window: {} };
vm.runInNewContext(shell.slice(shell.lastIndexOf('(function (global)', anchor), shell.indexOf('})(window);', anchor) + 11), calendar);
const source = fs.readFileSync('js/home-switch-countdown.js', 'utf8');
let selected = 'domestic';
let placeholder;
const label = { textContent: '' };
const units = Array.from({length:4}, (_,i) => {
  const digits = Array.from({length:2}, () => {
    const faces = [{textContent:'0'}, {textContent:'0'}];
    return {faces, classList:{remove(){},add(){}}, querySelectorAll:q => q === '.hsc-flap' ? [] : faces};
  });
  return {getAttribute:()=>String(i), querySelectorAll:q => q === '.hsc-digit' ? digits : digits.flatMap(d=>d.faces)};
});
function clock() {
  return {isConnected:true,hidden:true,classList:{toggle(){}},setAttribute(k,v){this[k]=v;},
    querySelector:()=>label,querySelectorAll:()=>units};
}
placeholder = clock();
const intervals=[];
class FixedDate extends Date { constructor(...args) {super(...(args.length?args:['2026-10-26T23:00:00+09:00']));} static now(){return new FixedDate().getTime();} }
const context = {Date:FixedDate,Intl,document:{body:{id:'tt-body-index'},hidden:false,
  querySelector:()=>placeholder, addEventListener(){}},
  window:{MarketHours:calendar.window.MarketHours,HomeMarketSelection:{get:()=>selected},addEventListener(){}},
  setInterval:fn=>intervals.push(fn)};
vm.runInNewContext(source, context);
assert.equal(placeholder.hidden,false);
assert.match(label.textContent,/국내 다음 정규장 종료/);
assert.match(placeholder['aria-label'],/16시간 30분/);
selected='us';
placeholder.isConnected=false;
placeholder=clock();
context.window.HomeSwitchCountdown.refresh();
assert.equal(placeholder.hidden,false);
assert.match(label.textContent,/미국 정규장 종료/);
assert.match(placeholder['aria-label'],/6시간 0분/);
const next=context.window.HomeSwitchCountdown.nextOpening(FixedDate.now());
assert.equal(next.next.toISOString(),'2026-10-27T00:00:00.000Z');
assert.equal(next.market,'국내 정규장');
selected='closed';
placeholder.isConnected=false;
placeholder=clock();
context.window.HomeSwitchCountdown.refresh();
assert.equal(placeholder.hidden,true,'Closed tab never shows the white toolbar clock');
vm.runInNewContext(source, context);
assert.equal(intervals.length,1,'A second skin/dashboard load reuses the existing timer');
console.log('PASS domestic/US clocks, closed toolbar exclusion, remount and duplicate load');
