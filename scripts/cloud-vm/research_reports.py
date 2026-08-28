# -*- coding: utf-8 -*-
"""무료 공개 종목 리포트 원문 메타데이터.

KIS ``invest-opinion`` 응답은 날짜·투자의견·목표가만 제공하고 증권사명, 제목,
원문 URL은 제공하지 않는다. 사용자가 숫자의 근거를 직접 확인할 수 있도록 Npay 증권의
공개 종목분석 목록에서 제목·증권사·작성일과 증권사 PDF 링크만 읽는다. 본문은 복제하지
않으며, KIS 관측치와 Npay 리포트는 서로 다른 공급원이므로 1:1 대응한다고 주장하지 않는다.
"""

import re
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser

KST = timezone(timedelta(hours=9))
LIST_URL = 'https://finance.naver.com/research/company_list.naver'
LOOKBACK_DAYS = 90
MAX_REPORTS = 20


def _clean(value):
    return re.sub(r'\s+', ' ', str(value or '')).strip()


class _ResearchListParser(HTMLParser):
    def __init__(self):
        HTMLParser.__init__(self, convert_charrefs=True)
        self.rows = []
        self._row = None
        self._cell = None
        self._anchor = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'tr':
            self._row = {'cells': [], 'links': []}
        elif tag == 'td' and self._row is not None:
            self._cell = []
        elif tag == 'a' and self._row is not None:
            self._anchor = {'href': attrs.get('href', ''), 'text': []}

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)
        if self._anchor is not None:
            self._anchor['text'].append(data)

    def handle_endtag(self, tag):
        if tag == 'a' and self._anchor is not None:
            self._anchor['text'] = _clean(''.join(self._anchor['text']))
            self._row['links'].append(self._anchor)
            self._anchor = None
        elif tag == 'td' and self._cell is not None:
            self._row['cells'].append(_clean(''.join(self._cell)))
            self._cell = None
        elif tag == 'tr' and self._row is not None:
            if any('company_read.naver' in link['href'] for link in self._row['links']):
                self.rows.append(self._row)
            self._row = None
            self._cell = None
            self._anchor = None


def parse_research_list(html, today=None, lookback_days=LOOKBACK_DAYS, limit=MAX_REPORTS):
    parser = _ResearchListParser()
    parser.feed(html or '')
    now = today or datetime.now(KST)
    cutoff = now.date() - timedelta(days=lookback_days)
    reports = []
    for row in parser.rows:
        detail = next((link for link in row['links'] if 'company_read.naver' in link['href']), None)
        pdf = next((link for link in row['links'] if link['href'].lower().endswith('.pdf')), None)
        stock = next((link for link in row['links'] if '/item/main.naver' in link['href']), None)
        cells = row['cells']
        if not detail or len(cells) < 5:
            continue
        try:
            report_date = datetime.strptime(cells[-2], '%y.%m.%d').date()
        except ValueError:
            continue
        if report_date < cutoff:
            continue
        reports.append({
            'stockName': (stock or {}).get('text') or cells[0],
            'title': detail.get('text') or cells[1],
            'broker': cells[2],
            'date': report_date.isoformat(),
            'detailUrl': urllib.parse.urljoin(LIST_URL, detail['href']),
            'pdfUrl': (pdf or {}).get('href') or None,
        })
        if len(reports) >= limit:
            break
    return reports


def fetch_recent_reports(code, today=None, lookback_days=LOOKBACK_DAYS, limit=MAX_REPORTS):
    query = urllib.parse.urlencode({'searchType': 'itemCode', 'itemCode': code})
    url = LIST_URL + '?' + query
    request = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (compatible; tistory-ticker/1.0)',
        'Accept-Language': 'ko-KR,ko;q=0.9',
    })
    with urllib.request.urlopen(request, timeout=8) as response:
        raw = response.read()
        charset = response.headers.get_content_charset() or 'euc-kr'
    html = raw.decode(charset, 'replace')
    reports = parse_research_list(html, today=today, lookback_days=lookback_days, limit=limit)
    return {
        'code': code,
        'lookbackDays': lookback_days,
        'reports': reports,
        'reportCount': len(reports),
        'source': 'Npay 증권 종목분석 리포트',
        'listUrl': url,
        'relationshipNote': 'KIS 투자의견 관측치와 별도 공급원이며 1:1 대응하지 않습니다.',
    }
