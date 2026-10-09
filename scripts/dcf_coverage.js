/* Independently count archive presence and automatic-model eligibility. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const C = require('../js/dcf-core.js');
const dir = path.join(__dirname, '../dcf-data');
function read(file) { const text=fs.readFileSync(file,'utf8');return JSON.parse(text.slice(text.indexOf('=')+1).replace(/;\s*$/,'')); }
const index=read(path.join(dir,'index.js'));
const seen=new Set(), reasons={}, stats={archives:0,estimated:0,disclosureOnly:0,unavailable:0};
for(const stock of index.stocks) {
  if(stock.shareClass==='preferred'||seen.has(stock.sourceCode))continue;
  seen.add(stock.sourceCode);
  if(!index.available[stock.sourceCode])continue;
  stats.archives++;
  const payload=read(path.join(dir,'companies',stock.sourceCode+'.js'))[stock.sourceCode];
  const d=C.autoDraft({...stock,hasOtherShares:index.stocks.some(s=>s.sourceCode===stock.sourceCode&&s.shareClass==='preferred')},payload,payload.years[4].year);
  const extra=path.join(dir,'supplements',stock.sourceCode+'.js');
  if(fs.existsSync(extra))d.supplement=read(extra);
  const a=C.analyze(d);
  if(a.ok)stats.estimated++;else{stats.unavailable++;const reason=a.reason.includes('금융업')?'업종·주식권리 제한':a.reason.includes('음수')?'음수·비양수 FCFF':a.reason.includes('순차입금')?'지분 조정 자료 부족':'핵심 FCFF·신선도 자료 부족';reasons[reason]=(reasons[reason]||0)+1;}
}
index.valuationCoverage={generatedAt:new Date().toISOString(),...stats,pending:seen.size-stats.archives,reasons};
index.supplements=fs.existsSync(path.join(dir,'supplements'))?fs.readdirSync(path.join(dir,'supplements')).filter(s=>s.endsWith('.js')).map(s=>s.slice(0,-3)):[];
fs.writeFileSync(path.join(dir,'index.js'),'window.DCF_INDEX='+JSON.stringify(index).replace(/</g,'\\u003c')+';\n');
console.log(index.valuationCoverage);
