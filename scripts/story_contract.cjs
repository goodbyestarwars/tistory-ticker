// Use the browser's pure contract in batch generation/validation; no second formula engine.
const fs=require('node:fs'),vm=require('node:vm');
const win={};vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../js/stock-story-template.js'),'utf8'),{window:win});
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const api=win.StockStoryTemplate;
process.stdout.write(JSON.stringify(input.mode==='validate'?api.merge(input.cards,[]):api.build(input)));
