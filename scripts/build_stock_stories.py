"""Publish evidence-backed Tier1 stories outside VM; Tier2 never runs this collector.

Use the existing KIS master parser, DART client, financial extraction and atomic IO.
All provider calls are bounded. Failed/newly pending disclosures retain old files.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.parse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'scripts/cloud-vm'))
from build_dcf_data import read_js, write_js, load_public_market_master, Collector, BudgetExhausted
import dart_client
import fundamentals
import story_disclosures
from snapshot_io import atomic_json

KST = timezone(timedelta(hours=9))
OUT = ROOT / 'data/stock-stories'
SELECTION = ROOT / 'data/stock-story-selection.js'
STATE = ROOT / 'work/stock-story-state.json'
VERSION = 2


BudgetExceeded = BudgetExhausted


class DisclosurePending(RuntimeError):
    pass


def iso_day(v):
    s = str(v or '')
    if re.fullmatch(r'\d{8}', s):
        s = s[:4] + '-' + s[4:6] + '-' + s[6:]
    return datetime.strptime(s[:10], '%Y-%m-%d').date().isoformat()


def load_story(code):
    path = OUT / (code + '.js')
    if not path.exists():
        return None
    match = re.search(r'window\.STOCK_STORIES\["' + re.escape(code) + r'"\]\s*=\s*(\{.*\});', path.read_text(encoding='utf-8'), re.S)
    if not match:
        raise ValueError('Invalid static story')
    return json.loads(match[1])


def publish_story(code, story):
    if not re.fullmatch(r'[0-9A-Z]{6}', code) or not isinstance(story.get('cards'), list):
        raise ValueError('Invalid story')
    body = json.dumps(story, ensure_ascii=False, separators=(',', ':'), allow_nan=False).replace('<', '\\u003c')
    source = 'window.STOCK_STORIES=window.STOCK_STORIES||{};window.STOCK_STORIES["' + code + '"]=' + body + ';\n'
    path = OUT / (code + '.js')
    if path.exists() and path.read_text(encoding='utf-8') == source:
        return False
    temporary = path.with_suffix('.tmp')
    temporary.write_text(source, encoding='utf-8')
    temporary.replace(path)
    return True


def select_members(master, count=100, pinned=()):
    candidates = [dict(code=c, name=master['stocks'][c], market=master['markets'][c], marketCap=v)
                  for c, v in master['marketCaps'].items()
                  if master['markets'].get(c) in ('KOSPI', 'KOSDAQ') and c in master['stocks']
                  and not re.search(r'스팩|SPAC|ETN', master['stocks'][c], re.I)]
    candidates.sort(key=lambda r: (-r['marketCap'], r['code']))
    ranks = {r['code']: i + 1 for i, r in enumerate(candidates)}
    members = {r['code']: dict(r, rank=ranks[r['code']]) for r in candidates[:count]}
    by_code = {r['code']: r for r in candidates}
    for code in pinned:
        if code in by_code:
            members[code] = dict(by_code[code], rank=ranks[code])
    if len(candidates) < 2000 or len(members) < count:
        raise ValueError('Incomplete whole-market ranking')
    return {'month': datetime.now(KST).strftime('%Y-%m'), 'source': master['source'],
            'retrievedAt': master['generatedAt'], 'basis': '전일 기준 시가총액(억원), 보통주, KOSPI·KOSDAQ 전체',
            'universeCount': len(candidates), 'members': members}


def won(v):
    n = fundamentals.to_num(v)
    if n is None:
        return None
    return f'{n / 100000000:,.1f}억원'


def change(current, previous):
    if current is None or previous is None or previous == 0:
        return None
    if previous < 0:
        return '흑자 전환' if current > 0 else '적자 축소' if current > previous else '적자 확대' if current < previous else '적자 유지'
    if current < 0:
        return '적자 전환'
    pct = fundamentals.pct_change(current, previous)
    return f'{pct:+.1f}%'


def financial_cards(rows, filing):
    receipt = str(filing.get('rcept_no') or '')
    if not re.fullmatch(r'\d{14}', receipt) or not rows or not any(r.get('rcept_no') == receipt for r in rows):
        raise DisclosurePending('Statement and latest disclosure do not match yet')
    rows = [r for r in rows if r.get('rcept_no') == receipt]
    as_of = iso_day(filing['rcept_dt'])
    annual = filing['reprt_code'] == '11011'
    period = str(filing['year']) + '년 ' + fundamentals.QUARTER_LABEL[filing['reprt_code']]
    prior_key = 'frmtrm_amount' if annual else 'frmtrm_q_amount'
    metrics = [
        ('매출액', fundamentals.REVENUE_IDS, '매출액'),
        ('영업이익', fundamentals.OPERATING_INCOME_IDS, '영업이익'),
        ('순이익', fundamentals.NET_INCOME_IDS, '당기순이익'),
    ]
    amounts, comparisons = [], []
    for label, ids, name in metrics:
        current = fundamentals.extract_amount(rows, ids, name, ('IS', 'CIS'), 'thstrm_amount')
        prior = fundamentals.extract_amount(rows, ids, name, ('IS', 'CIS'), prior_key)
        if current is not None:
            amounts.append({'k': label, 'v': won(current), 't': 'up' if current > 0 else 'dn' if current < 0 else 'n'})
        diff = change(current, prior)
        if diff is not None:
            comparisons.append({'k': label + ' YoY', 'v': diff, 't': 'up' if current > prior else 'dn' if current < prior else 'n'})
    if not amounts:
        raise DisclosurePending('No verified income statement values')
    def make(title, sub, pairs):
        return {'topic': 'earnings', 'title': title, 'sub': sub, 'pair': pairs, 'asOf': as_of,
                'src': 'DART ' + period + ' · 접수 ' + receipt,
                'sourceUrl': 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + receipt,
                'statementBasis': rows[0].get('fs_div'), 'periodBasis': 'annual' if annual else 'standalone_3m'}
    cards = [make(period + ' 실적을 펼쳐 보면',
                  ('1년 전체' if annual else '해당 분기 3개월') + ' 손익계산서다. 공시된 값만 표시하고, 없는 항목은 넣지 않았다.', amounts)]
    if comparisons:
        cards.append(make('작년 같은 기간과 비교하면',
                          '올해 ' + ('연간' if annual else '단독 분기') + '와 전년 같은 기간을 비교했다. 적자에서 흑자로 바뀐 경우는 증가 배수로 표현하지 않는다.', comparisons))
    ytd = fundamentals.build_current_year_ytd(rows, filing['year'], filing['reprt_code'])
    if ytd and ytd['through_quarter'] > 1:
        pairs = [{'k': label + ' 누적', 'v': won(ytd[key]), 't': 'up' if ytd[key] > 0 else 'dn' if ytd[key] < 0 else 'n'}
                 for label, key in [('매출액', 'revenue'), ('영업이익', 'operating_income'), ('순이익', 'net_income')]
                 if ytd.get(key) is not None]
        if pairs:
            c = make('연초부터 ' + str(ytd['through_quarter'] * 3) + '개월을 합치면',
                     '연초부터 보고 분기까지의 공시 누적 실적이다. 위 카드의 단독 3개월 실적과 기간이 다르다.', pairs)
            c['periodBasis'] = 'dart_ytd_reported'
            cards.append(c)
    return cards


def retired_badge(card, today):
    badge = card.get('badge')
    if not isinstance(badge, dict):
        return False
    if badge.get('status') == 'retired' or badge.get('active') is False:
        return True
    return bool(badge.get('expiresAt') and iso_day(badge['expiresAt']) < today)


def compose_story(old, member, cards, filing, today):
    old = old or {}
    managed = (old.get('maintenance') or {}).get('managed', False)
    # A newer editorial/preliminary result must never be replaced by an older periodic filing.
    keep_editorial = bool(old.get('cards') and all(c.get('kind') == 'interpretation' for c in old['cards']) and not managed and iso_day(old['asOf']) >= iso_day(filing['rcept_dt']))
    if keep_editorial:
        published = old['cards']
    else:
        other = [] if managed else [c for c in old.get('cards', []) if c.get('kind') == 'interpretation' and c.get('topic') == 'segment-profit']
        published = cards + other
    published = [dict(c) for c in published]
    for c in published:
        if retired_badge(c, today):
            c.pop('badge', None)
        if not c.get('asOf'):
            c['asOf'] = old.get('asOf') or iso_day(filing['rcept_dt'])
    story = dict(old, name=member['name'], cards=published,
                 asOf=max((c['asOf'] for c in published), default=iso_day(filing['rcept_dt'])),
                 maintenance={'version': VERSION, 'managed': managed or not old.get('cards'), 'filing': filing})
    same = old.get('cards') == published
    story['written'] = old.get('written', today) if same else today
    return story


def watch_disclosures(api_key, members, state, today, max_pages=8):
    """Bounded DART regular-report watcher. Detect and refresh affected members in this run.

    Scan a trailing three-day window with a resumable page cursor. The periodic
    full review covers longer outages. Never mark receipts applied before publication.
    """
    cursor = state.setdefault('watch', {})
    if cursor.get('date') != today:
        if cursor.get('date') and (datetime.fromisoformat(today) - datetime.fromisoformat(cursor['date'])).days > 3:
            state['reviewed'] = {}  # Reconcile every member after a gap beyond the watcher window.
        cursor.update(date=today, page=1)
    pending = state.setdefault('pending', {})
    for _ in range(max_pages):
        params = {'crtfc_key': api_key, 'bgn_de': (datetime.fromisoformat(today) - timedelta(days=3)).strftime('%Y%m%d'),
                  'end_de': today.replace('-', ''), 'pblntf_ty': 'A', 'page_count': '100',
                  'page_no': str(cursor['page']), 'sort': 'date', 'sort_mth': 'desc'}
        data = json.loads(dart_client._fetch(dart_client.BASE_URL + '/list.json?' + urllib.parse.urlencode(params)).decode('utf-8'))
        if data.get('status') == '013':
            cursor['page'] = 1
            return
        if data.get('status') != '000':
            raise RuntimeError('Disclosure watcher response failed')
        for report in data.get('list', []):
            code = report.get('stock_code')
            if code not in members or not fundamentals.latest_periodic_filing([report]):
                continue
            receipt = report.get('rcept_no') or ''
            if receipt > state.get('observed', {}).get(code, ''):
                pending[code] = max(receipt, pending.get(code, ''))
        if cursor['page'] >= int(data.get('total_page', 1)):
            cursor['page'] = 1
            return
        cursor['page'] += 1


def watch_supply_disclosures(api_key, state, today, max_pages=2):
    """Reuse the same server-side watcher, budget and cursor, across all listed stocks."""
    cursor = state.setdefault('supplyWatch', {'page': 1})
    pending = state.setdefault('supplyPending', {})
    end = datetime.fromisoformat(today)
    for _ in range(max_pages):
        params = {'crtfc_key': api_key, 'bgn_de': (end-timedelta(days=3)).strftime('%Y%m%d'),
                  'end_de': today.replace('-', ''), 'pblntf_ty':'B', 'page_count':'100',
                  'page_no':str(cursor['page']), 'sort':'date', 'sort_mth':'desc'}
        payload = json.loads(dart_client._fetch(dart_client.BASE_URL+'/list.json?'+urllib.parse.urlencode(params)).decode('utf-8'))
        if payload.get('status') == '013':
            cursor['page']=1
            break
        if payload.get('status') != '000':
            raise RuntimeError('Material disclosure watch failed')
        for report in payload.get('list', []):
            code=report.get('stock_code') or ''
            if re.fullmatch(r'[0-9A-Z]{6}',code) and any(k in re.sub(r'\s+','',report.get('report_nm','')) for k in story_disclosures.EVENTS):
                pending[report['rcept_no']]=report
        if cursor['page'] >= int(payload.get('total_page',1)):
            cursor['page']=1
            break
        cursor['page']+=1
    output=ROOT/'data'/'stock-story-supply'
    output.mkdir(parents=True,exist_ok=True)
    for receipt,report in list(pending.items())[:20]:
        code=report['stock_code']
        path=output/(code+'.js')
        old=read_js(path,'STOCK_STORY_SUPPLY') if path.exists() else None
        if old and receipt <= old.get('latest_receipt',''):
            del pending[receipt]
            continue
        cache=story_disclosures.collect_event(api_key,report,old)
        if cache is not None:
            write_js(path,'STOCK_STORY_SUPPLY',cache)
        del pending[receipt]


def install_budget(state, max_calls, daily_calls):
    today = datetime.now(KST).date().isoformat()
    usage = state.setdefault('usage', {})
    if usage.get('date') != today:
        usage.update(date=today, calls=0)
    original = dart_client._fetch
    run_calls = [0]
    def before_request():
        if usage['calls'] >= daily_calls:
            raise BudgetExceeded('DART request budget reached')
        run_calls[0] += 1
        usage['calls'] += 1
    collector = Collector(None, max_calls, 1200, before_request=before_request)
    def fetch(url):
        # Never print a credential-bearing URL or exception from urllib.
        return collector.call(lambda _key: original(url))
    dart_client._fetch = fetch
    return original, run_calls


def interpretation_cards(quarters):
    import subprocess
    result = subprocess.run(['node', str(ROOT / 'scripts' / 'story_contract.cjs')],
                            input=json.dumps({'fundamentals': {'fundamentals': {'quarters': quarters}}}),
                            text=True, capture_output=True, check=True, encoding='utf-8')
    return json.loads(result.stdout)


def refresh_member(code, member, corp, key, args, today, report_day):
    """Workers only collect/compute; the main thread publishes and acknowledges."""
    if not corp:
        raise DisclosurePending('Corporate mapping missing')
    filing = fundamentals.latest_periodic_filing(dart_client.call_periodic_reports(key, corp, report_day))
    if not filing or not filing.get('reprt_code'):
        raise DisclosurePending('Latest periodic report missing')
    old = load_story(code)
    if old and args.retired_badges:
        retired = set(args.retired_badges.split(','))
        for card in old.get('cards', []):
            if isinstance(card.get('badge'), dict) and card['badge'].get('id') in retired:
                card['badge']['status'] = 'retired'
    old_filing = (old or {}).get('maintenance', {}).get('filing')
    source_stale = old and (report_day - datetime.fromisoformat(old['asOf']).date()).days > 45
    badge_due = old and any(retired_badge(c, today) for c in old.get('cards', []))
    if old_filing == filing and not source_stale and not badge_due and (old.get('maintenance') or {}).get('version') == 2:
        return filing, None
    latest = dict(filing, fs_div='CFS')
    rows = fundamentals.call_fnltt_any(key, corp, filing['year'], filing['reprt_code'])
    if rows: latest['fs_div'] = rows[0].get('fs_div')
    quarters = fundamentals.fetch_quarter_history(key, corp, latest)
    cards = interpretation_cards(quarters)
    story = compose_story(old, member, cards, filing, today)
    story['quarterHistory'] = quarters
    return filing, story


def run(args):
    OUT.mkdir(parents=True, exist_ok=True)
    STATE.parent.mkdir(parents=True, exist_ok=True)
    state = json.loads(STATE.read_text(encoding='utf-8')) if STATE.exists() else {}
    now = datetime.now(KST)
    today = now.date().isoformat()
    old_index = read_js(OUT / 'index.js', 'STOCK_STORIES_INDEX') if (OUT / 'index.js').exists() else {}
    selection = read_js(SELECTION, 'STOCK_STORY_SELECTION') if SELECTION.exists() else {}
    # Existing editorial members are public, not the user's private watchlist.
    pinned = [code for code in old_index if not (load_story(code).get('maintenance') or {}).get('managed', False)]
    checked_month = state.get('selectionMonth') or selection.get('month')
    if not selection or checked_month != now.strftime('%Y-%m') or args.mode in ('bootstrap', 'reselect'):
        master = load_public_market_master()
        candidate = select_members(master, args.count, pinned)
        if any(candidate.get(k) != selection.get(k) for k in ('members', 'source', 'basis', 'universeCount')):
            selection = candidate
            write_js(SELECTION, 'STOCK_STORY_SELECTION', selection)
        state['selectionMonth'] = now.strftime('%Y-%m')
    members = selection['members']
    key = os.environ.get('DART_API_KEY', '').strip()
    if not key:
        raise RuntimeError('DART_API_KEY is required')
    dart_client.CORP_CODE_MAP_FILE = str(STATE.parent / 'dart_corp_code_map.json')
    original, run_calls = install_budget(state, args.max_calls, args.daily_calls)
    changed, errors, processed, budget_hit = [], [], 0, False
    try:
        mapping = dart_client.get_corp_code_map(key)
        if args.mode in ('watch', 'event'):
            watch_disclosures(key, members, state, today)
            watch_supply_disclosures(key, state, today)
        due = set(state.get('pending', {})) & set(members)
        if args.codes:
            due.update(c for c in args.codes.split(',') if c in members)
        review = state.setdefault('reviewed', {})
        for code in members:
            old = load_story(code)
            last = review.get(code)
            fortnight_due = not last or (now.date() - datetime.fromisoformat(last).date()).days >= 14
            badge_due = old and any(retired_badge(c, today) for c in old.get('cards', []))
            if not old or args.mode in ('bootstrap', 'review', 'reselect') or fortnight_due or badge_due:
                due.add(code)
        selected = sorted(due, key=lambda c: members[c]['rank'])[:args.max_symbols]
        # Actions only. The existing Collector owns the shared throttle/budget across four workers.
        with ThreadPoolExecutor(max_workers=4) as workers:
            futures = [(code, workers.submit(refresh_member, code, members[code], mapping.get(code), key, args, today, now.date())) for code in selected]
            for code, future in futures:
                processed += 1
                try:
                    filing, story = future.result()
                    if story and publish_story(code, story):
                        changed.append(code)
                        print('Updated verified story: ' + code, flush=True)
                    review[code] = today
                    state.setdefault('observed', {})[code] = max(filing['rcept_no'], state.get('pending', {}).get(code, ''))
                    state.setdefault('pending', {}).pop(code, None)
                except (BudgetExceeded, dart_client.DartRateLimitError):
                    budget_hit = True
                    state.setdefault('pending', {}).setdefault(code, '')
                except Exception as exc:
                    errors.append({'code': code, 'type': type(exc).__name__})
                    state.setdefault('pending', {}).setdefault(code, '')
        # Index only entries that have actual readable cards. Retired files are retained.
        index = {code: {'name': member['name'], 'market': member['market'], 'rank': member['rank']}
                 for code, member in members.items() if load_story(code)}
        if index != old_index:
            write_js(OUT / 'index.js', 'STOCK_STORIES_INDEX', index)
        summary = {'tier1': len(index), 'selected': len(members), 'changed': changed, 'errors': errors,
                   'calls': run_calls[0], 'pending': len(state.get('pending', {})), 'mode': args.mode, 'budgetHit': budget_hit}
        atomic_json(STATE.parent / 'stock-story-run.json', summary)
        print(json.dumps(summary, ensure_ascii=True))
        return 0 if len(index) >= args.count and not errors and not budget_hit and not summary['pending'] else 2
    finally:
        dart_client._fetch = original
        atomic_json(STATE, state)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['bootstrap', 'watch', 'event', 'review', 'reselect'], default='watch')
    parser.add_argument('--codes', default='')
    parser.add_argument('--retired-badges', default='')
    parser.add_argument('--count', type=int, default=100)
    parser.add_argument('--max-symbols', type=int, default=110)
    parser.add_argument('--max-calls', type=int, default=400)
    parser.add_argument('--daily-calls', type=int, default=1500)
    args = parser.parse_args()
    if args.count != 100 or not 1 <= args.max_calls <= 500 or not 1 <= args.max_symbols <= 150:
        parser.error('Bounded production settings required')
    if args.retired_badges and (not args.codes or not re.fullmatch(r'[A-Za-z0-9_.:-]+(?:,[A-Za-z0-9_.:-]+)*', args.retired_badges)):
        parser.error('Retired badge IDs require an explicit code scope')
    try:
        return run(args)
    except Exception as exc:
        print('Stock story run failed (' + type(exc).__name__ + '). Existing files preserved.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
