/* test_volume_multiple.py 가 호출하는 도우미: 일봉 JSON -> core.volumeMultiples 결과. */
const fs = require('fs');
const core = require('../js/chart-core.js');
const bars = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
process.stdout.write(JSON.stringify(core.volumeMultiples(bars, 20)));
