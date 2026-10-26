require('./helpers/common_runtime');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const shell=fs.readFileSync('js/skin-shell.js','utf8');
const ui='/* NineUI:'+shell.split('/* NineUI:')[1].split('/* End NineUI */')[0];
function link(){const handlers={};return {rel:'stylesheet',href:'',sheet:null,addEventListener(k,f){handlers[k]=f},removeEventListener(k){delete handlers[k]},remove(){this.removed=true},fire(k){if(handlers[k])handlers[k]()}}}
(async()=>{
 const links=[],doc={querySelectorAll:()=>links,createElement:()=>link(),head:{appendChild(e){links.push(e)}}};
 const context={window:{document:doc},document:doc,setTimeout,clearTimeout};vm.runInNewContext(ui,context);
 const api=context.window.NineUI;
 assert.ok(!api.state('loading','로딩','ps-hint',{spinner:false}).includes('<svg'));
 assert.ok(api.state('loading','로딩').includes('<svg'),'other consumers retain existing loader');
 const first=api.loadStyle('https://test/scanner.css');let ready=false;first.then(()=>ready=true);
 assert.equal(links.length,1);assert.equal(api.loadStyle('https://test/scanner.css'),first);assert.equal(ready,false);
 links[0].sheet={};links[0].fire('load');await first;assert.equal(ready,true);
 const failed=api.loadStyle('https://test/fail.css');links[1].fire('error');await assert.rejects(failed);
 doc.querySelectorAll=()=>links.filter(e=>!e.removed);
 const retry=api.loadStyle('https://test/fail.css');links[2].sheet={};links[2].fire('load');await retry;
 const part=shell.split('/* Scanner status is shared')[1].split('/* Shared interaction dependency')[0];
 let resolveCss;const inserted=[];
 const gateDoc={currentScript:{src:'https://test/js/skin-shell.js'},querySelector:()=>null,createElement:()=>({setAttribute(){}}),head:{appendChild(e){inserted.push(e)}}};
 vm.runInNewContext('/* Scanner status is shared'+part,{window:{NineUI:{loadStyle:()=>new Promise(r=>resolveCss=r)}},document:gateDoc,location:{pathname:'/page/pattern-scan'},URL});
 assert.equal(inserted.length,0,'no gauge script before CSS load');resolveCss();await Promise.resolve();assert.equal(inserted.length,1);
 const pattern=fs.readFileSync('js/pattern-scan.js','utf8');const c={window:{},document:{readyState:'loading',addEventListener(){}},console};
 vm.runInNewContext(pattern.replace('global.PatternScan = {','global.PatternScan = { buildShellForTest:buildShell, emptyHtmlForTest:emptyUnifiedHtml,'),c);
 assert.ok(c.window.PatternScan.emptyHtmlForTest().includes('aria-busy="true"'),'initial grouped results remain loading, not a false empty result');
 const html=c.window.PatternScan.buildShellForTest();assert.ok(!html.includes('ps-spinner'));assert.ok(html.includes('aria-busy="true"'));assert.ok(!pattern.includes('ps-spinner'));
 console.log('PASS CSS readiness/dedup/retry, scanner mount gate and no pre-style SVG loading waveform');
})().catch(e=>{console.error(e);process.exitCode=1});
