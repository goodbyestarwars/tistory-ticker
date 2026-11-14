const vm=require('vm'),fs=require('fs'),assert=require('assert');
const w={KRX_MAP:{'에코프로':'086520','에코프로머티':'450080'},SECTOR_MAP:{'코스피 3대장':[{code:'086520'}],'2차전지':[{code:'086520'},{code:'450080'}],'소재':[{code:'450080'}]}};
vm.runInNewContext(fs.readFileSync('js/news-stock-matcher.js','utf8'),{window:w,document:{},Map,Set});
const article={title:'에코프로 그룹주, 에코프로머티 20%대 상승'};
assert.deepEqual(Array.from(w.NineNewsStocks.relatedSectors(article)),['2차전지','소재']);
assert.deepEqual(Array.from(w.NineNewsStocks.relatedSectors({title:'기업 언급이 없는 일반 뉴스'})),[]);
assert.deepEqual(Array.from(w.NineNewsStocks.relatedSectors({title:'에코프로',krSectors:['2차전지','2차전지']})),['2차전지']);
assert.equal(w.NineNewsStocks.relatedStocks(article).length,2);
console.log('news business-sector badges: explicit companies only, provided metadata, dedup, curated group excluded PASS');
