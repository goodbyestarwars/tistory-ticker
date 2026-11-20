// 2026-11-20 검색기 메뉴별 과거 성적 한 줄 회귀: 6개 메뉴 모두 값이 있고, 연구 원문 수치와 같으며, 보장 문구를 붙인다.
const assert=require('node:assert/strict'),fs=require('fs');
const src=fs.readFileSync('js/pattern-scan.js','utf8');
const grab=n=>{const i=src.indexOf('function '+n+'(');let d=0,j=src.indexOf('{',i);for(let k=j;k<src.length;k++){if(src[k]=='{')d++;else if(src[k]=='}'){d--;if(!d)return src.slice(i,k+1);}}};
const card=src.slice(src.indexOf('var MENU_SCORECARD='),src.indexOf('function scorecardHtml('));
const make=tab=>new Function('var escapeHtml=s=>String(s);var activeTab='+JSON.stringify(tab)+';'+card+grab('scorecardHtml')+'return scorecardHtml();')();
for(const t of ['liveFlow','trendBreakout','bottomFormation','pullbackRebreak','longTermQuality','leaderPullback'])
  assert.ok(/과거 5년 성적/.test(make(t)) && /미래 수익 보장 아님/.test(make(t)),t);
{const h=make('trendBreakout');assert.ok(h.includes('+0.1%p')&&h.includes('-0.2%p')&&h.includes('+0.8%p'));}
assert.ok(make('pullbackRebreak').includes('우위 없음'));
assert.ok(make('leaderPullback').includes('+10.3%')&&make('leaderPullback').includes('2024~2025.6') && make('leaderPullback').includes('검증 통과'));
assert.ok(make('longTermQuality').includes('재무 조건 제외 근사'));
assert.equal(make('unknown'),'');
assert.ok(/list\.innerHTML=market\+scorecardHtml\(\)/.test(src),'매수후보 위에 표시');
console.log('test_scanner_scorecard ok');
