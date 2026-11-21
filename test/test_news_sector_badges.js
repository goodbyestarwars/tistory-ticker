const vm=require('vm'),fs=require('fs'),assert=require('assert');
const w={KRX_MAP:{'에코프로':'086520','에코프로머티':'450080'},SECTOR_MAP:{'코스피 3대장':[{code:'086520'}],'2차전지':[{code:'086520'},{code:'450080'}],'소재':[{code:'450080'}]}};
vm.runInNewContext(fs.readFileSync('js/news-stock-matcher.js','utf8'),{window:w,document:{},Map,Set});
const article={title:'에코프로 그룹주, 에코프로머티 20%대 상승'};
assert.deepEqual(Array.from(w.NineNewsStocks.relatedSectors(article)),['2차전지','소재']);
assert.deepEqual(Array.from(w.NineNewsStocks.relatedSectors({title:'기업 언급이 없는 일반 뉴스'})),[]);
assert.deepEqual(Array.from(w.NineNewsStocks.relatedSectors({title:'에코프로',krSectors:['2차전지','2차전지']})),['2차전지']);
assert.equal(w.NineNewsStocks.relatedStocks(article).length,2);
const rs=t=>Array.from(w.NineNewsStocks.relatedSectors(typeof t==='string'?{title:t}:t));
// 2026-11-21: 기업 언급이 없어도 제목에 적힌 산업 키워드는 관련 분야로 표시(등장 순서, 중복 제거, 최대 4개)
assert.deepEqual(rs('"반도체 살 돈도 빚 갚는 데 쓸 수도"…AI 기업 상장의 역설'),['반도체','AI']);
assert.deepEqual(rs('인공지능 칩 수요에 반도체 장비주 강세'),['AI','반도체']);
assert.deepEqual(rs('HBM 수요 확대, 데이터센터 전력망 투자 늘어'),['반도체','데이터센터','전력/에너지']);
assert.deepEqual(rs('AI반도체 배터리 자동차 조선업 원전 제약 정유 (초과분은 4개까지)'),['AI','반도체','2차전지','자동차']);
assert.deepEqual(rs('Taiwan Airways said strong sales'),[]);                 // 단어 속 'ai'는 AI가 아니다
assert.deepEqual(rs('조선일보 보도: 북조선 관련 소식'),[]);                      // 조선일보·북조선은 조선업이 아니다
assert.deepEqual(rs('에코프로 배터리 증설'),['2차전지']);              // 기업 분류와 같은 분야는 중복 표시하지 않는다
assert.deepEqual(rs({title:'AI 기업 상장',krSectors:['반도체']}),['반도체','AI']); // 서버 제공 분류가 먼저
console.log('news business-sector badges: explicit companies only, provided metadata, dedup, curated group excluded PASS');
