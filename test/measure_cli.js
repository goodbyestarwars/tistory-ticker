/* test_measure_tool.py 가 호출하는 도우미: chart-drawing.js 의 측정 도구 순수 함수를 실행한다. */
const D = require('../js/chart-drawing.js');
const input = JSON.parse(process.argv[2]);
// 가짜 시리즈: 가격 -> y 픽셀은 y = 1000 - price (1px = 1원)
const series = { priceToCoordinate: (p) => 1000 - p };
const out = input.map((c) => {
  if (c.fn === 'metrics') return D.measureMetrics(c.start, c.end);
  if (c.fn === 'lines') return D.measureLabelLines(D.measureMetrics(c.start, c.end), c.start, c.end);
  if (c.fn === 'snap') return D.snapToBarExtreme({ bars: c.bars, series }, c.point, c.y, c.tol);
  return null;
});
process.stdout.write(JSON.stringify(out));
