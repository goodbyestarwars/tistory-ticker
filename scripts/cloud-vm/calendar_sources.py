"""Bounded public corporate IR adapters, run only by the calendar scheduler.

IRGO is deliberately NOT fetched: terms art.17 prohibit reuse (robots permission
is not a data licence). DART exchange filings provide the official IR alternative.
No attachment download, browser rendering or private endpoints.
"""
import html
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo

from calendar_model import period, stamp

MAX_BYTES = 1500000
MONTHS = 'January February March April May June July August September October November December'.split()
DATE_RE = r'(' + '|'.join(MONTHS) + r')\.?\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2})'
HYNIX_FEED = 'https://news.skhynix.com/en/category/ir/feed/'
SAMSUNG_IR = 'https://www.samsung.com/global/ir/'


def read(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or parsed.hostname not in (
        'news.skhynix.com', 'www.samsung.com', 'investors.seagate.com',
        'investors.robinhood.com', 'kind.krx.co.kr'):
        raise ValueError('unapproved IR host')
    request = urllib.request.Request(url, headers={'User-Agent': '9Pay-calendar/2.0 (+https://ghlee.tistory.com)'})
    with urllib.request.urlopen(request, timeout=10) as response:
        # Reject redirects to unknown domains as well.
        if urllib.parse.urlsplit(response.url).hostname != parsed.hostname:
            raise ValueError('unexpected redirect')
        data = response.read(MAX_BYTES + 1)
        encoding = response.headers.get_content_charset() or 'utf-8'
    if len(data) > MAX_BYTES:
        raise ValueError('IR page exceeds byte budget')
    return data.decode(encoding, errors='replace')


def text(value):
    value = re.sub(r'<(script|style)\b[^>]*>.*?</\1>', '', value, flags=re.S | re.I)
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', value))).strip()


def english_date(value):
    hit = re.search(DATE_RE, value, re.I)
    if not hit:
        return None
    month = next(i + 1 for i, name in enumerate(MONTHS) if name.lower() == hit[1].lower())
    return datetime(int(hit[3]), month, int(hit[2])).date().isoformat()


def parse_hynix(title, body, url, published=None):
    p = period(title)
    if not p or not re.search(r'earnings|financial results', title, re.I):
        return None
    content = text(body)
    # Invitation body, not its Oct 21 publication date, determines Oct 28 event date.
    hit = re.search(r'(?:present|announce).*?earnings.*?\bon\s+(' + DATE_RE + ')', content, re.I)
    if not hit:
        hit = re.search(r'(?:Seoul,\s*)?(' + DATE_RE + r')\s*[–—-]', content, re.I)
    event_date = english_date(hit[1]) if hit else None
    if not event_date:
        return None
    reported = bool(re.search(r'Announces.*Financial Results', title, re.I))
    call = re.search(r'conference call.{0,100}?at\s+(\d{1,2})(?::(\d{2}))?\s*a\.?m', content, re.I)
    e = {'market': 'domestic', 'symbol': '000660', 'company': 'SK하이닉스', 'corp_name': 'SK하이닉스',
         'title': '$SK하이닉스 ' + p + ' 실적발표' + (' 완료' if reported else ' 예정'),
         'fiscalPeriod': p, 'eventType': 'earnings', 'eventDate': event_date, 'start': event_date,
         'kstDate': event_date, 'timezone': 'Asia/Seoul', 'scheduledAt': None,
         'status': 'reported' if reported else 'scheduled', 'source': 'corporate-ir',
         'sourceUrl': url, 'link': url, 'verifiedAt': stamp(), 'verification': 'official',
         'publishedAt': published, 'dateBasis': 'scheduled_event'}
    if call:
        e['conferenceCallAt'] = event_date + 'T%02d:%02d:00+09:00' % (int(call[1]), int(call[2] or 0))
    if re.search(r'before\s+9:00\s*a\.?m', content, re.I):
        e['releaseTimeNote'] = '09:00 이전 (한국시간), 정확한 발표 시각 미확인'
    if reported:
        try:
            e['reportedAt'] = parsedate_to_datetime(published).isoformat() if published else stamp()
        except (ValueError, TypeError):
            e['reportedAt'] = stamp()
        e['result'] = '공식 실적 자료 공개'
    return e


def fetch_hynix():
    root = ET.fromstring(read(HYNIX_FEED))
    out = []
    for item in root.findall('./channel/item')[:20]:
        title = item.findtext('title') or ''
        if not re.search(r'Earnings Conference Call Invitation|Announces.*Financial Results', title, re.I):
            continue
        url = item.findtext('link') or ''
        body = item.findtext('{http://purl.org/rss/1.0/modules/content/}encoded') or ''
        event = parse_hynix(title, body, url, item.findtext('pubDate'))
        if not event:
            event = parse_hynix(title, read(url), url, item.findtext('pubDate'))
        if event:
            out.append(event)
        if len(out) == 6:
            break
    # Process announcements before results, independent of RSS reverse chronology.
    return sorted(out, key=lambda e: e['status'] == 'reported')


def parse_samsung(body):
    content = text(body)
    hit = re.search(r'(?:([1-4])Q(\d{2}) Earnings Call).*?earnings call for the.*?scheduled for\s+(\d{1,2})\s*a\.?m\.?\s+on\s+(' + DATE_RE + ')', content, re.I)
    if not hit:
        raise ValueError('Samsung IR date structure changed')
    event_date = english_date(hit[4])
    return [{'market': 'domestic', 'symbol': '005930', 'company': '삼성전자', 'corp_name': '삼성전자',
             'fiscalPeriod': '20' + hit[2] + '-Q' + hit[1], 'eventType': 'earnings',
             'title': '$삼성전자 20' + hit[2] + '년 ' + hit[1] + '분기 실적발표 예정',
             'start': event_date, 'eventDate': event_date, 'kstDate': event_date,
             'timezone': 'Asia/Seoul', 'scheduledAt': None,
             'conferenceCallAt': event_date + 'T%02d:00:00+09:00' % int(hit[3]),
             'status': 'scheduled', 'source': 'corporate-ir', 'sourceUrl': SAMSUNG_IR,
             'link': SAMSUNG_IR, 'verification': 'official', 'verifiedAt': stamp(), 'dateBasis': 'scheduled_event'}]


def parse_ir_disclosure(body, row, source='dart-ir', url=None):
    """Only explicit event date/time + explicit quarter earnings purpose qualify.

    Used for public DART copies of KIND exchange IR filings. General NDR/Corporate
    Day titles alone never qualify. No inference from receipt date.
    """
    content = text(body)
    p = period(content)
    if not p or not re.search(r'(?:실적|경영성과).{0,30}(?:발표|설명)|(?:발표|설명).{0,30}실적', content):
        return None
    day = re.search(r'(?:공시예정일|발표예정일|개최일자|개최일|일시|일자)\s*[:：]?\s*(20\d{2})\s*[년./-]\s*(\d{1,2})\s*[월./-]\s*(\d{1,2})', content)
    cancelled = bool(re.search(r'개최\s*취소|행사\s*취소', content))
    if not day and not cancelled:
        return None
    try:
        event_date = datetime(*map(int, day.groups())).date().isoformat() if day else None
    except ValueError:
        return None
    tm = re.search(r'(?:시간|개최시각)\s*[:：]?\s*(\d{1,2})\s*[:시]\s*(\d{2})', content)
    conference = None
    if tm and event_date and int(tm[1]) < 24 and int(tm[2]) < 60:
        conference = event_date + 'T%02d:%02d:00+09:00' % (int(tm[1]), int(tm[2]))
    url = url or 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + row['rcept_no']
    company = row.get('corp_name', '')
    event_type = 'ir' if re.search(r'\bNDR\b|Corporate\s*Day|기업탐방', content, re.I) else 'earnings'
    return {'market': 'domestic', 'symbol': row.get('stock_code', ''), 'company': company,
            'corp_name': company, 'title': '$' + company + ' ' + p + (' 실적발표 예정' if event_type == 'earnings' else ' 실적 관련 IR'),
            'eventType': event_type, 'fiscalPeriod': p, 'start': event_date, 'eventDate': event_date,
            'kstDate': event_date, 'timezone': 'Asia/Seoul', 'scheduledAt': None,
            'conferenceCallAt': conference, 'status': 'cancelled' if cancelled else 'scheduled',
            'source': source, 'sourceUrl': url, 'link': url, 'publishedAt': row.get('rcept_dt'),
            'supersedes': bool(re.search(r'정정|취소', row.get('report_nm', ''))),
            'dateBasis': 'scheduled_event', 'verification': 'official', 'verifiedAt': stamp(),
            'hasAttachment': bool(re.search(r'첨부|\.pdf|\.hwpx?', body, re.I))}


def attachment_policy(metadata):
    # The live feed is independent of attachment support. Do not guess dates or
    # silently download image/HWP files. Parsing may be added to an offline worker.
    return {'state': 'not_required' if metadata.get('eventDate') else 'needs_review',
            'downloaded': False, 'reason': 'public text first; no request-path attachment parsing'}


US_IR_SOURCES = (
    ('STX', 'Seagate Technology', 'https://investors.seagate.com/news/default.aspx'),
    ('HOOD', 'Robinhood Markets', 'https://investors.robinhood.com/news-releases'),
)


def parse_us_notice(body, ticker, company, url):
    content = text(body)
    # Restrict to the actual release heading; footer links must not supply dates.
    heading = re.search(r'<h[1-3][^>]*>(.*?)</h[1-3]>', body, re.S | re.I)
    titles = re.findall(r'<(?:h[1-3]|title)[^>]*>(.*?)</(?:h[1-3]|title)>', body, re.S | re.I)
    title = next((text(t) for t in titles if re.search(r'(?:to Report|to Announce).*?(?:Results|Earnings)', text(t), re.I)), '')
    if not title:
        return None
    event_date = english_date(title.split(' on ')[-1])
    quarter = re.search(r'(First|Second|Third|Fourth)\s+Quarter\s+(20\d{2})', title, re.I)
    if not event_date or not quarter:
        return None
    q = ['first', 'second', 'third', 'fourth'].index(quarter[1].lower()) + 1
    session = 'amc' if re.search(r'after.{0,30}(?:market close|market closes)', content, re.I) else None
    from datetime import date, timedelta
    kst = (date.fromisoformat(event_date) + timedelta(days=1)).isoformat() if session == 'amc' else event_date
    return {'market': 'us', 'symbol': ticker, 'company': company,
            'fiscalPeriod': quarter[2] + '-Q' + str(q), 'eventType': 'earnings',
            'title': '$' + ticker + ' ' + quarter[2] + '-Q' + str(q) + ' 실적발표 예정',
            'start': kst, 'eventDate': event_date, 'us_date': event_date,
            'us_session': '장후' if session else '', 'kstDate': kst if session else None,
            'timezone': 'America/New_York', 'datePrecision': 'session' if session else 'date',
            'scheduledAt': None, 'source': 'corporate-ir-us', 'sourceUrl': url, 'link': url,
            'verification': 'official', 'dateBasis': 'scheduled_event', 'status': 'scheduled', 'verifiedAt': stamp()}


def fetch_us_notices(ticker, company, index_url):
    page = read(index_url)
    links = re.findall(r'<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', page, re.S | re.I)
    urls = []
    for href, label in links:
        if re.search(r'(?:to Report|to Announce).*?(?:Results|Earnings)', text(label), re.I):
            url = urllib.parse.urljoin(index_url, html.unescape(href))
            if url not in urls:
                urls.append(url)
    if not urls:
        raise ValueError('IR announcement listing unavailable')
    result = [parse_us_notice(read(url), ticker, company, url) for url in urls[:2]]
    return [e for e in result if e]
