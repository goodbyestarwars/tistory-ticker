"""Bounded offline collector; no VM requests, processes, timers or database writes.

Reuse existing dart_client for authenticated calls. Secret is environment-only.
Static files live outside data/ to avoid deploy_check's VM restart/rescan watch.
"""
import argparse
import json
import os
from pathlib import Path
import re
import sys
import time
from datetime import datetime, timedelta, timezone
import urllib.parse
import urllib.request
import zipfile
import io

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/cloud-vm'))
import dart_client
from dcf_normalize import annual, normalize_series, number, missing

OUT = ROOT / 'dcf-data'
KST = timezone(timedelta(hours=9))


def read_js(path, name):
    source = path.read_text(encoding='utf-8')
    match = re.search(r'window\.' + re.escape(name) + r'\s*=\s*(\{.*?\}|\[.*?\]);', source, re.S)
    return json.loads(match.group(1)) if match else {}


def universe():
    names = read_js(ROOT / 'data/krx_map.js', 'KRX_MAP')
    etfs = set(read_js(ROOT / 'data/krx_map.js', 'KRX_ETF_NAMES'))
    sectors = (ROOT / 'data/sectors-v3.js').read_text(encoding='utf-8')
    markets = dict(re.findall(r'code:\s*"([\dA-Z]{6})",\s*market:\s*"(KOSPI|KOSDAQ)"', sectors))
    market_archive = OUT / 'markets.js'
    if market_archive.exists():
        markets.update(read_js(market_archive, 'DCF_MARKETS').get('markets', {}))
    wics = read_js(ROOT / 'data/wics-map.js', 'WICS_MAP')
    result = {}
    for name, code in names.items():
        if name in etfs or re.search(r'ETN|스팩|SPAC|기업인수목적', name, re.I):
            continue
        base = re.sub(r'(?:\d*우[A-Z]?)$', '', name)
        canonical = names.get(base, code)
        industry = (wics.get(canonical) or {}).get('industry', '')
        preferred = base != name
        kind = 'financial' if re.search(r'은행|보험|증권|금융|카드|캐피탈', industry + ' ' + name) else 'holding' if re.search(r'홀딩스|지주', name) else 'unknown'
        result[code] = {'code': code, 'name': name, 'sourceCode': canonical, 'market': markets.get(code, markets.get(canonical, '확인 필요')),
                        'shareClass': 'preferred' if preferred else 'common', 'industry': industry, 'kind': kind}
    return result


def refresh_markets():
    """Public KIS master: same supplier already used by domestic_futures_ws.

    Only the documented leading nine-character short-code field is parsed.
    No financial ratios, prices or ambiguous thousand-share fields are imported.
    Source: koreainvestment/open-trading-api stocks_info/kis_*_code_mst.py.
    """
    markets = {}
    for market in ('KOSPI', 'KOSDAQ'):
        name = market.lower() + '_code.mst'
        url = 'https://new.real.download.dws.co.kr/common/master/' + name + '.zip'
        with urllib.request.urlopen(url, timeout=30) as response:
            raw = response.read()
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            for row in archive.read(name).splitlines():
                code = row[:9].decode('ascii').strip()
                if re.fullmatch(r'[0-9A-Z]{6}', code):
                    markets[code] = market
    if markets.get('005930') != 'KOSPI' or markets.get('035900') != 'KOSDAQ':
        raise ValueError('Public master validation failed')
    write_js(OUT / 'markets.js', 'DCF_MARKETS', {'generatedAt': datetime.now(KST).isoformat(), 'source': '한국투자증권 공개 종목 마스터', 'markets': markets})


def write_js(path, name, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    # Escape HTML-significant characters, also safe if an operator embeds the data.
    body = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
    temp.write_text('window.' + name + '=' + body + ';\n', encoding='utf-8')
    temp.replace(path)


class BudgetExhausted(RuntimeError):
    pass


class Collector:
    def __init__(self, key, max_calls):
        self.key, self.max_calls, self.calls = key, max_calls, 0
        self.started = time.monotonic()

    def call(self, fn, *args):
        if self.calls >= self.max_calls or time.monotonic() - self.started > 420:
            raise BudgetExhausted('수집 예산 종료')
        if self.calls:
            time.sleep(0.35)
        self.calls += 1
        return fn(self.key, *args)

    def reports(self, key, corp):
        params = {'crtfc_key': key, 'corp_code': corp, 'bgn_de': '20150101', 'last_reprt_at': 'Y',
                  'pblntf_detail_ty': 'A001', 'page_count': '100', 'sort': 'date', 'sort_mth': 'desc'}
        data = json.loads(dart_client._fetch(dart_client.BASE_URL + '/list.json?' + urllib.parse.urlencode(params)))
        if data.get('status') == '013':
            return []
        if data.get('status') == '020':
            raise dart_client.DartRateLimitError('공시목록 요청 제한')
        if data.get('status') != '000':
            # Do not log raw URL/exception text containing keys.
            raise RuntimeError('공시목록 요청 실패')
        if int(data.get('total_page', 1)) > 1:
            raise RuntimeError('공시목록 페이지 범위 초과: 별도 확인 필요')
        return data.get('list', [])

    def company(self, stock, corp, latest_year):
        reports = self.call(self.reports, corp)
        report_by_year = {}
        for report in reports:
            match = re.search(r'사업보고서\s*\((\d{4})\.(\d{2})\)', report.get('report_nm', ''))
            if match and int(match[1]) <= latest_year:
                year = int(match[1])
                if year not in report_by_year or report['rcept_no'] > report_by_year[year]['rcept_no']:
                    report_by_year[year] = report
        if not report_by_year:
            raise RuntimeError('완료 사업연도 보고서 미확보')
        # A currently completed year missing its report remains a gap; do not shift
        # the five-year window backwards and present stale years as recent years.
        basis = 'CFS'
        records = []
        for year in range(latest_year, latest_year - 6, -1):
            report = report_by_year.get(year)
            rows = self.call(dart_client.call_fnltt, corp, year, '11011', basis)
            if year == latest_year and not rows:
                # OFS is only safe after confirming the latest annual report exists.
                if report:
                    basis = 'OFS'
                    rows = self.call(dart_client.call_fnltt, corp, year, '11011', basis)
            records.append(annual(rows, year, basis, report))
        records = normalize_series(records)
        latest = records[-1]
        shares = self.call(dart_client.call_stock_totqy, corp, latest_year, '11011')
        common = [r for r in shares if r.get('se') in ('보통주', '보통주식')]
        share_fields = {k: missing('보통주 주식수 공시 미확보') for k in ('issuedShares', 'treasuryShares', 'shares')}
        if len(common) == 1:
            row = common[0]
            for key, source_key in [('issuedShares', 'istc_totqy'), ('treasuryShares', 'tesstk_co'), ('shares', 'distb_stock_co')]:
                value = number(row.get(source_key))
                share_fields[key] = {'value': value, 'status': 'review' if value is not None else 'missing',
                                     'reason': '사업보고서 보통주 기준. 이후 증자·자기주식·희석증권 확인 필요',
                                     'sources': [{'rcept_no': row.get('rcept_no'), 'account_nm': source_key, 'thstrm_amount': row.get(source_key), 'originalUnit': '주', 'stlm_dt': row.get('stlm_dt')}]}
            issued, treasury, circulating = [share_fields[k]['value'] for k in ('issuedShares', 'treasuryShares', 'shares')]
            if None in (issued, treasury, circulating) or issued - treasury != circulating:
                share_fields['shares'] = missing('발행−자기주식=유통주식수 대조 실패')
        # Market classification in the disclosure list is authoritative for the issuer.
        market = {'Y': 'KOSPI', 'K': 'KOSDAQ', 'N': 'KONEX'}.get((latest.get('report') or {}).get('corp_cls'), stock['market'])
        return {'schemaVersion': 1, 'code': stock['sourceCode'], 'corpCode': corp, 'market': market,
                'generatedAt': datetime.now(KST).isoformat(), 'currency': 'KRW', 'amountUnit': '원',
                'displayUnit': '억원', 'basis': basis, 'years': records[-5:], 'priorNwc': records[0]['fields']['nwc'],
                'shareFields': share_fields, 'quote': missing('VM 무부하 원칙: 현재주가 직접 입력'),
                'warnings': ['세율·운전자본·차입금·희석주식수는 수동 확인 필요', '정정공시 접수번호가 원자료와 다르면 자동 확인으로 표시하지 않음']}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--codes', default='', help='Comma-separated stock codes; default bounded cursor over master')
    parser.add_argument('--max-calls', type=int, default=60)
    parser.add_argument('--year', type=int, default=datetime.now(KST).year - 1)
    parser.add_argument('--index-only', action='store_true')
    parser.add_argument('--renormalize', action='store_true', help='Reapply rules to saved raw disclosure rows, no API calls')
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--refresh-markets', action='store_true')
    args = parser.parse_args()
    if args.refresh_markets:
        try:
            refresh_markets()
        except Exception:
            print('Public market master unavailable; existing verified classifications preserved.')
    stocks = universe()
    OUT.mkdir(exist_ok=True)
    manifest_path = OUT / 'index.js'
    old = read_js(manifest_path, 'DCF_INDEX') if manifest_path.exists() else {}
    available = old.get('available', {})
    failures = old.get('failures', {})
    cursor = old.get('cursor', 0)
    key = os.environ.get('DART_API_KEY', '').strip()
    if args.renormalize:
        for code in available:
            path = OUT / 'companies' / (code + '.js')
            payload = read_js(path, 'DCF_FILES')[code]
            records = [annual(r['rawRows'], r['year'], r['basis'], r['report']) for r in payload['years']]
            baseline = {'year': records[0]['year'] - 1, 'basis': payload['basis'], 'fields': {'nwc': payload['priorNwc']}}
            payload['years'] = normalize_series([baseline] + records)[-5:]
            write_js(path, 'DCF_FILES', {code: payload})
        print('Renormalized saved real disclosure rows without network requests.')
        return 0
    if not args.index_only and not key:
        print('DART_API_KEY environment variable is required; existing archives preserved.', file=sys.stderr)
        return 2
    if not args.index_only:
        collector = Collector(key, args.max_calls)
        # Existing corp-code client cache is redirected to local work/ (never VM).
        cache = ROOT / 'work/dart_corp_code_map.json'
        cache.parent.mkdir(exist_ok=True)
        dart_client.CORP_CODE_MAP_FILE = str(cache)
        try:
            corp_map = collector.call(dart_client.get_corp_code_map)
        except Exception:
            # During corpCode endpoint maintenance an existing public map remains
            # usable. It is not financial data; receipt validation is independent.
            if cache.exists():
                corp_map = json.loads(cache.read_text(encoding='utf-8'))
                print('Using existing public corp-code cache; download unavailable.')
            else:
                print('DART corp-code download unavailable. No archives overwritten.', file=sys.stderr)
                return 2
        canonical = sorted(set(row['sourceCode'] for row in stocks.values()))
        requested = [c.strip() for c in args.codes.split(',') if c.strip()]
        if any(c not in stocks for c in requested):
            raise ValueError('Unknown stock code')
        refresh_due = sorted(c for c, date in available.items() if c in canonical and datetime.now(KST) - datetime.fromisoformat(date) >= timedelta(days=30))
        rotated = canonical[cursor:] + canonical[:cursor]
        targets = list(dict.fromkeys(stocks[c]['sourceCode'] for c in requested)) if requested else refresh_due + [c for c in rotated if c not in refresh_due]
        for code in targets:
            # Skip fresh archives; weekly refresh also incorporates corrections.
            prior = available.get(code)
            if prior and not args.force and datetime.now(KST) - datetime.fromisoformat(prior) < timedelta(days=30):
                if not requested:
                    cursor = (canonical.index(code) + 1) % len(canonical)
                continue
            if collector.max_calls - collector.calls < 15:
                break  # Reserve enough budget to finish a complete issuer atomically.
            corp = corp_map.get(code)
            if not corp:
                failures[code] = 'DART 기업코드 미확보'
            else:
                try:
                    payload = collector.company(stocks[code], corp, args.year)
                    write_js(OUT / 'companies' / (code + '.js'), 'DCF_FILES', {code: payload})
                    available[code] = payload['generatedAt']
                    failures.pop(code, None)
                    print(code + ': annual archive written', flush=True)
                except (BudgetExhausted, dart_client.DartRateLimitError):
                    break
                except Exception:
                    failures[code] = '공시 수집 실패: 기존 자료 유지, 직접 입력 가능'
                    print(code + ': collection failed; previous archive preserved', flush=True)
            if not requested and code not in refresh_due:
                cursor = (canonical.index(code) + 1) % len(canonical)
    manifest = {'schemaVersion': 1, 'generatedAt': datetime.now(KST).isoformat(), 'stocks': list(stocks.values()),
                'available': available, 'failures': failures, 'cursor': cursor}
    write_js(manifest_path, 'DCF_INDEX', manifest)
    print('Search master: %d codes; real archives: %d; index: %d bytes' % (len(stocks), len(available), manifest_path.stat().st_size))
    return 0


if __name__ == '__main__':
    sys.exit(main())
