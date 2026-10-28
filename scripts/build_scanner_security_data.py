"""Manual public-display metadata build. No credentials, prices, VM or orders.

Reuse the existing public-master source and static JS writer. Official layouts:
https://github.com/koreainvestment/open-trading-api/blob/main/stocks_info/kis_kospi_code_mst.py
https://github.com/koreainvestment/open-trading-api/blob/main/stocks_info/kis_kosdaq_code_mst.py
The tail includes the newline, exactly as the official parser does.
"""
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import re
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
LAYOUTS = {'KOSPI': (228, 29), 'KOSDAQ': (222, 24)}


def parse_master(text, market):
    tail, offset = LAYOUTS[market]
    result = {}
    for row in text.replace('\r\n', '\n').splitlines(keepends=True):
        if len(row) < 21 + tail:
            raise ValueError('truncated public master')
        code = row[:9].strip()
        if not re.fullmatch(r'[0-9A-Z]{6}', code):
            continue
        fields = row[-tail:]
        # Only ordinary stock group; derivatives/funds are not common stocks.
        if fields[:2] != 'ST':
            continue
        flag = fields[offset:offset+1]
        if flag not in ('Y', 'N'):
            raise ValueError('unknown SPAC flag; preserve prior snapshot')
        if code in result:
            raise ValueError('duplicate security code')
        result[code] = flag == 'Y'
    return result


def build():
    classified = {}
    counts = {}
    for market in LAYOUTS:
        name = market.lower() + '_code.mst'
        url = 'https://new.real.download.dws.co.kr/common/master/' + name + '.zip'
        with urllib.request.urlopen(url, timeout=30) as response:
            raw = response.read()
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            rows = parse_master(archive.read(name).decode('cp949'), market)
        if len(rows) < 500 or set(rows) & set(classified):
            raise ValueError('incomplete or overlapping market master')
        classified.update(rows)
        counts[market] = {'classified': len(rows), 'spac': sum(rows.values())}
    if classified.get('005930') is not False or classified.get('035900') is not False:
        raise ValueError('ordinary stock controls failed')
    data = {'version': 1, 'asOf': datetime.now(timezone.utc).isoformat(),
            'source': 'KIS public KOSPI/KOSDAQ master SPAC flag', 'coverage': counts,
            'spacCodes': sorted(c for c, flag in classified.items() if flag),
            'ordinaryCodes': sorted(c for c, flag in classified.items() if not flag)}
    # Static data, not a new runtime collector or provider connection.
    target = ROOT / 'js/scanner-security-data.js'
    from build_dcf_data import write_js
    write_js(target, 'SCANNER_SECURITY_TYPES', data)
    return counts


if __name__ == '__main__':
    print(json.dumps(build()))
