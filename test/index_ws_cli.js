/* test_index_ws.py 가 호출하는 도우미: stock-search.js 에서 kstToday·indexLiveBar 두 순수 함수만 꺼내 실행한다. */
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'js', 'stock-search.js'), 'utf8');
function grab(name) {
  const a = src.indexOf('function ' + name);
  const m = /\r?\n  \}\r?\n/.exec(src.slice(a));
  return src.slice(a, a + m.index + m[0].length);
}
const api = new Function(grab('kstToday') + grab('indexLiveBar') + '; return { kstToday: kstToday, indexLiveBar: indexLiveBar };')();
const cases = JSON.parse(process.argv[2]);
process.stdout.write(JSON.stringify(cases.map((c) => c.fn === 'kstToday' ? api.kstToday(c.now) : api.indexLiveBar(c.code, c.last, c.price, c.today))));
