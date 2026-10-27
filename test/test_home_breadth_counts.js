const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const s=fs.readFileSync('js/skin-main.js','utf8');
function source(name){const a=s.indexOf('    function '+name+'(');return s.slice(a,s.indexOf('\n    }',a)+6);}
const context={usRegularSessionState:()=>({open:true}),resolveMarketDirection:()=>({label:'중립'}),isFinite};
vm.createContext(context);vm.runInContext(source('summarizeUsMarket'),context);
const summary=context.summarizeUsMarket({rows:[{change_rate:2},{change_rate:-1},{change_rate:0},{change_rate:null},{change_rate:''},{}]},[]);
assert.equal(summary.breadth.total,3);assert.equal(summary.breadth.up,1);assert.equal(summary.breadth.down,1);assert.equal(summary.breadth.flat,1);
const row={classList:{remove(){},add(){}},innerHTML:''};let rendered;
context.renderHomeRiseRatio=(up,down,target)=>rendered={up,down,target};
vm.runInContext(source('renderHomeBreadthEntry'),context);
context.renderHomeBreadthEntry(row,'코스피',{up:595,down:275,flat:45,total:915},false);
assert.match(row.innerHTML,/전체 915종목/);assert.match(row.innerHTML,/595/);assert.equal(rendered.up,595/915);
context.renderHomeBreadthEntry(row,'미국 종목',summary.breadth,true);assert.match(row.innerHTML,/집계 3종목/);assert.doesNotMatch(row.innerHTML,/전체/);
context.renderHomeBreadthEntry(row,'코스피',null,false);assert.doesNotMatch(row.innerHTML,/595/);assert.equal(rendered.up,null);
console.log('PASS: US sample excludes missing data; counts and neutral stock handling; shared renderer clears missing entries.');
