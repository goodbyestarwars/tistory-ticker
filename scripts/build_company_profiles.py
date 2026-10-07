"""Build static domestic-company introductions locally; never run on the VM."""
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
import re
import json
import argparse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
import time
import urllib.request

MAX_BYTES = 512 * 1024
SOURCE = '네이버 증권 · WISEreport'
_request_lock = threading.Lock()
_last_request = 0.0


def source_url(code):
    if not re.fullmatch(r'[0-9A-Z]{6}', str(code)):
        raise ValueError('올바른 6자리 종목코드가 필요합니다.')
    return 'https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cmp_cd=' + code


class _OverviewParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.overview_depth = None
        self.parts = None
        self.paragraphs = []
        self.ignored = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('br', 'img', 'meta', 'link', 'input', 'hr', 'wbr', 'source'):
            return
        self.depth += 1
        attrs = dict(attrs)
        if 'cmp_comment' in attrs.get('class', '').split():
            self.overview_depth = self.depth
        if self.overview_depth is not None and tag == 'li':
            self.parts = []
        if tag in ('script', 'style'):
            self.ignored += 1

    def handle_endtag(self, tag):
        if tag in ('br', 'img', 'meta', 'link', 'input', 'hr', 'wbr', 'source'):
            return
        if self.parts is not None and tag == 'li':
            text = re.sub(r'\s+', ' ', ''.join(self.parts)).strip()
            if text:
                self.paragraphs.append(text)
            self.parts = None
        if self.depth == self.overview_depth:
            self.overview_depth = None
        if tag in ('script', 'style'):
            self.ignored = max(0, self.ignored - 1)
        self.depth = max(0, self.depth - 1)

    def handle_data(self, data):
        if self.parts is not None and not self.ignored:
            self.parts.append(data)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)


def parse_summary(html):
    parser = _OverviewParser()
    parser.feed(html)
    # Prefer what the company does over incorporation history or earnings.
    def rank(text):
        business = len(re.findall(r'영위|주요.{0,8}사업|주력|제조|생산|제품|서비스|플랫폼|제공|매출을 창출|개발|판매|유통|운영|공급|솔루션|지주회사|은행|금융|대출|신약|치료제|건설|방산|정유|석유|게임|콘텐츠|물류|운송|운용', text))
        financial = len(re.findall(r'전년동기|영업이익|순이익|실적|매출액.{0,12}(증가|감소)', text))
        return business * 3 - financial * 8
    candidates = [text for text in parser.paragraphs if rank(text) > 0]
    if not candidates:
        return None
    text = max(candidates, key=rank)
    text = re.sub(r'^동사는\s*', '', text).strip()
    # Keep a complete source paragraph; never generate an inferred business.
    return brief(text)


def _download(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=5) as response:
        body = response.read(MAX_BYTES + 1)
        if len(body) > MAX_BYTES:
            raise ValueError('기업개요 응답 크기 초과')
        charset = response.headers.get_content_charset() or 'utf-8'
    return body.decode(charset, errors='replace')


def brief(text):
    """Small factual excerpt, at most 25 space-separated words and 180 chars."""
    words = text.split()
    shortened = ' '.join(words[:25])
    if len(shortened) > 180:
        shortened = shortened[:180].rsplit(' ', 1)[0]
    return shortened + ('…' if shortened != text else '')


def load_universe(path):
    text = Path(path).read_text(encoding='utf-8')
    stocks = json.loads(re.search(r'window.KRX_MAP\s*=\s*(\{.*?\});', text, re.S).group(1))
    etfs = set(json.loads(re.search(r'window.KRX_ETF_NAMES\s*=\s*(\[.*?\]);', text, re.S).group(1)))
    targets, aliases = {}, {}
    for name, code in stocks.items():
        if name in etfs or re.search(r'ETN|스팩|SPAC|기업인수목적', name, re.I):
            continue
        base_name = re.sub(r'(?:\d*우[A-Z]?)$', '', name)
        canonical = stocks.get(base_name, code)
        aliases[code] = canonical
        targets.setdefault(canonical, base_name if canonical != code else name)
    return targets, aliases


def fetch_one(code):
    global _last_request
    # Low-concurrency, paced local maintenance. No production VM API calls.
    with _request_lock:
        wait = 0.15 - (time.monotonic() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()
    try:
        return parse_summary(_download(source_url(code)))
    except Exception:
        return None


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument('--resume', action='store_true', help='Reuse the local collection checkpoint')
    parser.add_argument('--retry-missing', action='store_true')
    parser.add_argument('--limit', type=int)
    args = parser.parse_args()
    targets, aliases = load_universe(root / 'data/krx_map.js')
    checkpoint = root / 'work/company-profiles-checkpoint.json'
    checkpoint.parent.mkdir(exist_ok=True)
    collected = json.loads(checkpoint.read_text(encoding='utf-8')) if args.resume and checkpoint.exists() else {}
    pending = [code for code in targets if code not in collected or (args.retry_missing and not collected[code])]
    if args.limit:
        pending = pending[:args.limit]
    print('Collection targets: %d companies, %d stock codes, %d pending' % (len(targets), len(aliases), len(pending)), flush=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {pool.submit(fetch_one, code): code for code in pending}
        for i, future in enumerate(as_completed(futures), 1):
            collected[futures[future]] = future.result()
            if i % 100 == 0 or i == len(pending):
                checkpoint.write_text(json.dumps(collected, ensure_ascii=False), encoding='utf-8')
                print('Collected %d/%d; introductions %d' % (i, len(pending), sum(bool(v) for v in collected.values())), flush=True)
    wics_text = (root / 'data/wics-map.js').read_text(encoding='utf-8')
    wics = json.loads(re.search(r'window.WICS_MAP\s*=\s*(\{.*\});', wics_text, re.S).group(1))
    entries = {code: {'summary': collected.get(canonical), 'sourceCode': canonical,
                      'industry': (wics.get(canonical) or {}).get('industry')}
               for code, canonical in sorted(aliases.items())}
    missing = sorted(code for code, item in entries.items() if not item['summary'])
    data = {'asOf': datetime.now(timezone(timedelta(hours=9))).date().isoformat(),
            'source': SOURCE, 'total': len(aliases), 'covered': len(entries) - len(missing),
            'missing': missing, 'companies': entries}
    (root / 'data/company-profiles.js').write_text('window.COMPANY_PROFILES=' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    print('Static data ready: %d/%d stock codes, %d missing' % (data['covered'], len(aliases), len(missing)), flush=True)


if __name__ == '__main__':
    main()
