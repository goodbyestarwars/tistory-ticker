// 국내 활동성 로드 실패 계약. 막대 구성·표시(거래량 통일, 거래대금 미혼합)는 test_market_volume_unified.js가 검증한다.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('js/skin-main.js','utf8').replace(/\r\n/g,'\n');
function extract(name){const a=source.indexOf('    function '+name+'(');assert(a>=0,name);return source.slice(a,source.indexOf('\n    }',a)+6);}
(async()=>{
 let rendered=false; const c={latestHomeParticipation:{domestic:{old:true}},window:{NineAPI:{marketParticipation:()=>Promise.reject(new Error('offline'))}},renderMarketParticipation(){rendered=true;}};
 vm.createContext(c);vm.runInContext(extract('loadDomesticParticipation'),c);c.loadDomesticParticipation();await new Promise(resolve=>setImmediate(resolve));assert.equal(c.latestHomeParticipation.domestic,null);assert.equal(rendered,true);
 console.log('PASS API error removes cached values');
})().catch(e=>{console.error(e);process.exitCode=1;});
