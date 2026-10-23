// 문장 단위 줄바꿈 공용 함수: .!? 뒤 공백에서만 나누고 소수점·숫자는 유지한다.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('js/market-temp.js','utf8').replace('global.MarketTemp = MarketTemp;','global.MarketTemp = MarketTemp; global.t={splitSentences_,sentenceHtml_};');
const sb={window:{},document:{readyState:'loading',addEventListener(){}},console,setTimeout,clearTimeout,fetch:async()=>({ok:true,json:async()=>({})})};
vm.runInNewContext(src,sb);const t=sb.window.t;
const split=text=>JSON.stringify(t.splitSentences_(text));
assert.equal(split('하락이 넓게 퍼졌습니다. 내 종목의 변화부터 확인하세요.'),JSON.stringify(['하락이 넓게 퍼졌습니다.','내 종목의 변화부터 확인하세요.']));
assert.equal(split('1달러 1,326.7원 (-0.80원)입니다. 환율을 보세요.'),JSON.stringify(['1달러 1,326.7원 (-0.80원)입니다.','환율을 보세요.']));
assert.equal(split('한 문장입니다.'),JSON.stringify(['한 문장입니다.']));
assert.equal(split(''),'[]');
assert.equal(split(null),'[]');
const html=t.sentenceHtml_('<b>A</b>. B!');
assert(html.includes('&lt;b&gt;A&lt;/b&gt;.'),'HTML은 이스케이프');
assert.equal(html.split('mt-sent').length,3,'문장마다 span');
console.log('sentence split ok');
