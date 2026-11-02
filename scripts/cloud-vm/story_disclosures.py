"""Batch/event-only potential supply cache. No visitor API calls or new polling process.
Official field references: docs/STOCK_STORIES.md. Missing price/date means omission.
"""
from datetime import datetime, timedelta, timezone
import re
import time
import dart_client
import fundamentals

EVENTS = {'전환사채권발행결정': ('cvbdIsDecsn', 'CB'),
          '신주인수권부사채권발행결정': ('bdwtIsDecsn', 'BW'),
          '유상증자결정': ('piicDecsn', '유상증자'),
          '자기주식처분결정': ('tsstkDpDecsn', '자기주식 처분')}

def number(v):
    return fundamentals.to_num(v)

def day(v):
    raw = re.sub(r'[^0-9]', '', str(v or ''))
    try:
        return datetime.strptime(raw, '%Y%m%d').date().isoformat()
    except ValueError:
        return None

def normalize(row, endpoint, label, ordinary_shares=None):
    receipt = str(row.get('rcept_no') or '')
    if not re.fullmatch(r'\d{14}', receipt):
        return None
    fields = {
        'cvbdIsDecsn': ('cv_prc','cvisstk_cnt','cvisstk_tisstk_vs','cvrqpd_bgd','cvrqpd_edd'),
        'bdwtIsDecsn': ('ex_prc','nstk_isstk_cnt','nstk_isstk_tisstk_vs','expd_bgd','expd_edd'),
        'tsstkDpDecsn': ('dpstk_prc_ostk','dppln_stk_ostk',None,'dpprpd_bgd','dpprpd_edd')}
    if endpoint not in fields:
        # piicDecsn/majorstock do not expose an issue/disposal price and start date.
        # Retain event evidence separately; never substitute par value or invent prices.
        return None
    pk, sk, ratio, start, end = fields[endpoint]
    price, shares = number(row.get(pk)), number(row.get(sk))
    percent = number(row.get(ratio)) if ratio else None
    if percent is None and shares is not None and ordinary_shares and ordinary_shares > 0:
        percent = shares / ordinary_shares * 100
    first, last = day(row.get(start)), day(row.get(end))
    if not price or price <= 0 or not shares or shares <= 0 or not percent or percent <= 0 or not first or not last:
        return None
    return dict(label=label, price=price, shares=shares, shares_pct=percent, start_date=first,
                end_date=last, as_of=day(receipt[:8]), rcpNo=receipt, source=endpoint,
                series=str(row.get('bd_tm') or receipt))

def refresh(api_key, corp_code, entry, now=None):
    """Detect events before fetching corresponding DS005 data, using the existing batch budget."""
    now = now or datetime.now(timezone.utc)
    old = entry.get('potential_supply') or {}
    try:
        if now - datetime.fromisoformat(old.get('checked_at', '')) < timedelta(days=1):
            return old
    except ValueError:
        pass
    begin = (now - timedelta(days=7 if old else 730)).strftime('%Y%m%d')
    end = now.strftime('%Y%m%d')
    reports = dart_client.call_material_disclosures(api_key, corp_code, begin, end)
    items = {r['rcpNo']: r for r in old.get('items', [])}
    seen = set(old.get('receipts', []))
    pending = []
    latest = entry.get('latest_quarter') or {}
    history = entry.get('quarters') or []
    shares = history[-1].get('ordinary_shares') if history else None
    for report in reports:
        receipt = str(report.get('rcept_no') or '')
        title = re.sub(r'\s+', '', report.get('report_nm') or '')
        event = next((v for k,v in EVENTS.items() if k in title), None)
        if not event or receipt in seen:
            continue
        endpoint, label = event
        time.sleep(fundamentals.THROTTLE_SEC)
        rows = dart_client.call_structured_event(api_key, endpoint, corp_code, receipt[:8], end)
        exact = [r for r in rows if r.get('rcept_no') == receipt]
        if not exact:
            pending.append(receipt)
            continue
        for row in exact:
            denominator = shares if (latest.get('rcept_dt') or '99999999') <= receipt[:8] else None
            item = normalize(row, endpoint, label, denominator)
            if item:
                # Correction replaces this series, not other CB/BW issues.
                items = {k:v for k,v in items.items() if not (v['source']==item['source'] and v['series']==item['series'])}
                items[receipt] = item
        seen.add(receipt)
    # Expired decisions do not describe future supply. Keep only bounded active evidence.
    active = sorted((r for r in items.values() if r['end_date'] >= now.date().isoformat()), key=lambda r:r['rcpNo'], reverse=True)[:30]
    return dict(status='pending' if pending else 'ok', items=active, receipts=sorted(seen)[-200:],
                pending=pending, checked_at=now.isoformat())


def collect_event(api_key, report, cached=None):
    """Called by the existing Actions disclosure watcher immediately on a material event."""
    receipt = str(report.get('rcept_no') or '')
    title = re.sub(r'\s+', '', report.get('report_nm') or '')
    kind = next((v for k,v in EVENTS.items() if k in title), None)
    if not kind:
        return None
    endpoint, label = kind
    rows = dart_client.call_structured_event(api_key, endpoint, report['corp_code'], receipt[:8], receipt[:8])
    exact = [row for row in rows if row.get('rcept_no') == receipt]
    if not exact:
        raise RuntimeError('Structured event pending')
    items = list((cached or {}).get('items', []))
    for row in exact:
        item = normalize(row, endpoint, label)
        if item:
            items = [r for r in items if not (r['source'] == item['source'] and r['series'] == item['series'])]
            items.append(item)
    return dict(status='ok', items=sorted(items,key=lambda r:r['rcpNo'],reverse=True)[:30],
                checked_at=datetime.now(timezone.utc).isoformat(), latest_receipt=receipt)


def load_cached(code):
    """Small local committed event snapshot. No network/DART on visitor requests."""
    import json
    from pathlib import Path
    if not re.fullmatch(r'[0-9A-Z]{6}', code):
        return None
    roots = [Path(__file__).resolve().parent, Path(__file__).resolve().parents[2]]
    for root in roots:
        path = root / 'data' / 'stock-story-supply' / (code + '.js')
        if not path.exists():
            continue
        if path.stat().st_size > 100000:
            return None
        text = path.read_text(encoding='utf-8')
        match = re.fullmatch(r'window\.STOCK_STORY_SUPPLY\s*=\s*(\{.*\});\s*', text, re.S)
        if not match:
            return None
        return json.loads(match[1])
    return None
