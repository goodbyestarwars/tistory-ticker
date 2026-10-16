/* test_accumulation_bars.py 가 호출하는 도우미: JSON 일봉 배열을 받아 chart-core 매집봉 인덱스를 출력한다. */
const fs = require('fs');
const core = require('../js/chart-core.js');
const bars = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
process.stdout.write(JSON.stringify(core.accumulationBars(bars).map((hit) => hit.index)));
