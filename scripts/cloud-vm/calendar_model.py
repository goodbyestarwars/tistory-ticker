"""Calendar-only identity, provenance and lifecycle. No network or trading dependencies."""
import copy
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def symbol(value):
    return str(value or '').strip().upper().replace('-', '.')


def period(text):
    text = str(text or '')
    for pattern in (r'(20\d{2})\s*(?:년도?)?\s*[. /-]?\s*([1-4])\s*분기',
                    r'Q([1-4])\s*(20\d{2})', r'([1-4])Q\s*(?:FY)?(20\d{2}|\d{2})'):
        hit = re.search(pattern, text, re.I)
        if hit:
            a, b = hit.groups()
            return (a + '-Q' + b) if len(a) == 4 else ('20' + b[-2:] + '-Q' + a)
    formal = re.search(r'(?:보고서|재무제표).*?\(?\s*(20\d{2})[./-](03|06|09|12)\s*\)?', text)
    return formal[1] + '-Q' + str(int(formal[2]) // 3) if formal else None


def normalize(event):
    e = copy.deepcopy(event)
    market = str(e.get('market') or '').strip().lower()
    if market in ('kr', 'korea', 'domestic') or (not market and e.get('source') == 'dart'):
        e['market'] = 'domestic'
    elif market in ('us', 'usa', 'foreign') or (not market and e.get('source') == 'finnhub'):
        e['market'] = 'us'
    e['symbol'] = symbol(e.get('symbol') or e.get('stock_code'))
    e.setdefault('company', e.get('corp_name') or '')
    e.setdefault('eventType', 'earnings' if e.get('source') in ('finnhub', 'dart') else 'ir')
    e.setdefault('eventDate', e.get('us_date') or str(e.get('start') or '')[:10])
    e.setdefault('kstDate', str(e.get('start') or '')[:10])
    e.setdefault('timezone', 'America/New_York' if e.get('market') == 'us' else 'Asia/Seoul')
    e.setdefault('scheduledAt', None)
    if e.get('scheduledAt'):
        exact = datetime.fromisoformat(str(e['scheduledAt']).replace('Z', '+00:00'))
        if exact.utcoffset() is None:
            raise ValueError('exact schedule requires an explicit UTC offset')
        local = exact.astimezone(ZoneInfo(e['timezone']))
        kst = exact.astimezone(ZoneInfo('Asia/Seoul'))
        e.update(eventDate=local.date().isoformat(), kstDate=kst.date().isoformat(), start=kst.isoformat())
    e.setdefault('fiscalPeriod', period(e.get('report_name') or e.get('title')))
    e.setdefault('sourceUrl', e.get('link'))
    e.setdefault('verifiedAt', stamp())
    e.setdefault('reportedAt', e['verifiedAt'] if e.get('status') == 'reported' else None)
    e.setdefault('dateBasis', 'disclosure_receipt' if e.get('source') == 'dart' else 'scheduled_event')
    e.setdefault('verification', 'provider')
    return e


def identity(e):
    if e.get('symbol') and e.get('fiscalPeriod') and e.get('eventType') == 'earnings':
        return ':'.join((e.get('market', 'domestic'), e['symbol'], e['fiscalPeriod'], 'earnings'))
    if e.get('source') == 'dart' and e.get('receipt_no'):
        return 'dart:' + str(e['receipt_no'])
    if e.get('source') == 'finnhub':
        return 'finnhub:' + symbol(e.get('symbol')) + ':' + str(e.get('us_date') or e.get('start'))[:7]
    return str(e.get('eventId') or '|'.join((e.get('source', ''), e.get('symbol', ''), e.get('eventType', ''), e.get('eventDate', ''), e.get('title', ''))))


def reconcile(previous, incoming):
    """Never infer cancellation/completion from absence. Keep all conflicting evidence."""
    new = normalize(incoming)
    if not previous:
        new['eventId'] = identity(new)
        new['sources'] = [evidence(new)]
        new['history'] = []
        return new
    old = copy.deepcopy(previous)
    old.setdefault('sources', [evidence(old)])
    proof = evidence(new)
    # One current observation per source URL; chronology retained in history.
    sources = [s for s in old['sources'] if (s.get('source'), s.get('url')) != (proof.get('source'), proof.get('url'))]
    sources.append(proof)
    old['sources'] = sources
    old['verifiedAt'] = new['verifiedAt']
    history = old.setdefault('history', [])
    if new.get('status') == 'reported':
        if old.get('status') != 'reported':
            history.append({'at': new['verifiedAt'], 'eventDate': old.get('eventDate'),
                            'status': old.get('status'), 'sourceUrl': old.get('sourceUrl')})
        # Receipt date is evidence of publication, not a replacement for the announced date.
        for key in ('result', 'reportedAt', 'receipt_no', 'report_name', 'receipt_date', 'resultUrl'):
            if new.get(key) is not None:
                old[key] = new[key]
        old['resultUrl'] = new.get('sourceUrl')
        old['status'] = 'reported'
        if old.get('verification') != 'conflict':
            old['verification'] = new.get('verification', old.get('verification'))
        old['title'] = new['title'] if new.get('source') == old.get('source') else str(old.get('title', '')).replace('예정', '완료')
        if old.get('dateBasis') == 'disclosure_receipt' and new.get('dateBasis') != 'disclosure_receipt':
            for key in ('start', 'eventDate', 'kstDate', 'dateBasis', 'scheduledAt', 'conferenceCallAt'):
                if key in new:
                    old[key] = new[key]
    elif new.get('dateBasis') != 'disclosure_receipt':
        same_source = new.get('source') == old.get('source') and new.get('sourceUrl') == old.get('sourceUrl')
        if new.get('supersedes') and new.get('source') == old.get('source'):
            same_source = True
        official_upgrade = old.get('dateBasis') == 'disclosure_receipt'
        date_changed = old.get('eventDate') != new.get('eventDate')
        if date_changed and not (same_source or official_upgrade):
            old['verification'] = 'conflict'
            old['conflicts'] = sources
        else:
            reported = old.get('status') == 'reported'
            reported_title = old.get('title')
            if date_changed or new.get('status') == 'cancelled':
                history.append({'at': new['verifiedAt'], 'eventDate': old.get('eventDate'),
                                'status': old.get('status'), 'sourceUrl': old.get('sourceUrl')})
            protected = {'eventId', 'sources', 'history', 'reportedAt', 'result', 'resultUrl'}
            old.update({k: v for k, v in new.items() if k not in protected and v is not None})
            if reported:
                old['status'] = 'reported'
                old['title'] = reported_title
            elif date_changed and not official_upgrade and new.get('status') != 'cancelled':
                old['status'] = 'changed'
    return old


def evidence(e):
    return {k: v for k, v in {'source': e.get('source'), 'url': e.get('sourceUrl') or e.get('link'),
            'eventDate': e.get('eventDate'), 'scheduledAt': e.get('scheduledAt'),
            'status': e.get('status'), 'verifiedAt': e.get('verifiedAt')}.items() if v is not None}
