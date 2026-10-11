/* 자동 파동 엔진이 낸 상태 신호(H1·H2·H3·base_breakout·failed_rally)를 종목별로 뽑는다(수익성 비교 연구용, 운영·주문과 무관).
 *   node scripts/analysis/auto_wave_signals.js bars.json out.json
 * bars.json = { 종목코드: [[date, open, high, low, close, volume], ...] }  (wave_hypothesis_study.py 가 sqlite 에서 내보낸다)
 * out.json  = { 종목코드: [{ type, index, date }, ...] }
 * 신호는 엔진이 봉을 순차로 읽으며 그 봉까지의 자료만으로 낸 것이다(test/test_auto_wave_causality.js 가 prefix 분석과 같음을 검증). */
const fs = require('fs');
const { analyze } = require('../../js/auto-wave.js');

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) { console.error('usage: auto_wave_signals.js bars.json out.json'); process.exit(1); }
const data = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const out = {};
let total = 0;
Object.keys(data).forEach((code) => {
  const bars = data[code].map((r) => ({ date: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
  const res = analyze(bars);
  out[code] = res.signals.map((s) => ({ type: s.type, index: s.index, date: bars[s.index].date }));
  total += out[code].length;
});
fs.writeFileSync(outPath, JSON.stringify(out));
console.log('signals ' + total + ' for ' + Object.keys(out).length + ' stocks (engine ' + require('../../js/auto-wave.js').version + ')');
