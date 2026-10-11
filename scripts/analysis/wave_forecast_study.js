/* 다음 파동 시나리오(js/wave-forecast.js)를 날짜별로 순차 계산해 표본 파일로 만든다(오프라인 연구용, 운영·주문과 무관).
 *   node scripts/analysis/wave_forecast_study.js bars.json out.json [--stride 3] [--shard 0/4] [--level medium] [--window 500] [--min 260]
 * bars.json = { 종목코드: [[date, open, high, low, close, volume], ...] }  (wave_forecast_study.py 가 sqlite 에서 내보낸다)
 * out.json  = { 종목코드: [{ i, date, close, atr, sigma, p: 주시나리오|null, c: [보조], up, down, inv, bands:{5,10,20} }] }
 *
 * 미래 비참조: 각 표본 날짜 t 에서는 bars[max(0,t-window+1) .. t] 만 엔진에 넣는다(운영 화면이 일봉 최대 500봉을 받는 것과 같은 조건).
 * 결과는 그 날짜에 실제로 제공할 수 있었던 예측이며, 이후 봉을 추가해도 이미 낸 표본은 바뀌지 않는다(test/test_wave_forecast_causality.js 가 검증). */
const fs = require('fs');
require('../../js/auto-wave.js');
const WF = require('../../js/wave-forecast.js');

const args = process.argv.slice(2);
const [inPath, outPath] = args;
function opt(name, def) { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; }
if (!inPath || !outPath) { console.error('usage: wave_forecast_study.js bars.json out.json [--stride 3] [--shard 0/4] [--level medium]'); process.exit(1); }
const stride = +opt('stride', 3), level = opt('level', 'medium'), windowBars = +opt('window', 500), minBars = +opt('min', 260);
const [shard, shards] = opt('shard', '0/1').split('/').map(Number);
const data = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const codes = Object.keys(data).sort().filter((_, k) => k % shards === shard);
const out = {};
let total = 0;
const t0 = Date.now();
codes.forEach((code, k) => {
  const bars = data[code].map((r) => ({ date: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
  const rows = [];
  for (let t = minBars; t < bars.length; t += stride) {
    const win = bars.slice(Math.max(0, t - windowBars + 1), t + 1);
    const f = WF.forecast(win, null, { level });
    if (!f || f.insufficient) continue;
    const prim = f.scenarios.find((s) => s.primary);
    rows.push({
      i: t, date: bars[t].date, close: f.close, atr: f.atr, sigma: f.sigma, p: f.primary, c: f.candidates,
      up: prim && prim.watch && prim.watch.up ? prim.watch.up.price : null,
      down: prim && prim.watch && prim.watch.down ? prim.watch.down.price : null,
      inv: prim && prim.invalidate ? prim.invalidate.price : null,
      regime: f.state.regime,
      bands: f.bands.reduce((o, b) => { o[b.h] = [b.low, b.high]; return o; }, {})
    });
  }
  out[code] = rows; total += rows.length;
  if ((k + 1) % 10 === 0) console.error('shard ' + shard + ': ' + (k + 1) + '/' + codes.length + ' stocks, ' + total + ' samples, ' + Math.round((Date.now() - t0) / 1000) + 's');
});
fs.writeFileSync(outPath, JSON.stringify({ modelVersion: WF.MODEL_VERSION, engineVersion: global.AutoWave.version, level, stride, window: windowBars, samples: out }));
console.log('shard ' + shard + ' done: ' + total + ' samples for ' + codes.length + ' stocks (model ' + WF.MODEL_VERSION + ', engine ' + global.AutoWave.version + ')');
