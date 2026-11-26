"""Refresh the public calendar asset from official schedules without touching the VM."""

import calendar
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from io import BytesIO
from functools import lru_cache
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup
from pypdf import PdfReader
from pypdf.errors import PdfReadError

ASSET = Path(__file__).resolve().parents[1] / 'data/official-economic-calendar.js'
sys.path.insert(0, str(ASSET.parents[1] / 'scripts/cloud-vm'))
from market_calendar import KRX_HOLIDAYS_2026
PREFIX = 'window.OFFICIAL_ECON_CALENDAR = '
KST = ZoneInfo('Asia/Seoul')
BOK = 'https://www.bok.or.kr'
BOK_YEAR = BOK + '/portal/singl/crncyPolicyDrcMtg/listYear.do?menuNo=200755&mtgSe=A&pYear={}'
BOK_MONTH = BOK + '/portal/singl/mainEvent/listCldr.do?menuNo=200035&date={}'
BOK_WEEK = BOK + '/portal/bbs/P0001726/view.do?menuNo=200039&nttId=11066842'
BOK_STATS = BOK + '/portal/stats/statsPublictSchdul/listCldr.do?menuNo=200775&date={}-01'
BOK_NOTICES = {2026: BOK + '/eng/bbs/E0000627/view.do?menuNo=400022&nttId=10094301',
               2027: BOK + '/eng/bbs/E0000634/view.do?menuNo=400069&nttId=11066076'}
FED = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'
ECB = 'https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html'
BOJ = 'https://www.boj.or.jp/en/mopo/mpmsche_minu/index.htm'
NYSE = 'https://www.nyse.com/trade/hours-calendars'
NASDAQ = 'https://m.nasdaqtrader.com/TraderM.aspx?id=CalendarMobile'
NASDAQ_THANKSGIVING = 'https://www.nasdaqtrader.com/TraderNews.aspx?id=ETA2026-69'
KRX = 'https://open.krx.co.kr/contents/MKD/01/0110/01100305/MKD01100305.jsp'
BLS = 'https://www.bls.gov/schedule/{}/'
BEA = 'https://www.bea.gov/news/schedule/'
KOSTAT = 'https://www.kostat.go.kr/newsPln.es?mid=a10305000000&oa_yy={}&oa_mm={:02d}'
ET = 'America/New_York'


def fetch(url):
    for attempt in range(2):
        try:
            with urlopen(Request(url, headers={'User-Agent': '9Pay public economic calendar'}), timeout=15) as response:
                body = response.read(4_000_001)
                if len(body) > 4_000_000:
                    raise ValueError('response exceeds size limit')
                return body
        except OSError:
            if attempt == 1:
                raise
            time.sleep(2)


def html(url):
    return BeautifulSoup(fetch(url).decode('utf-8-sig'), 'html.parser')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def event(code, title, day, region, url, clock=None, zone='Asia/Seoul', kind='release', importance=3, **fields):
    start = day.isoformat()
    if clock:
        dt = datetime.fromisoformat(f'{day}T{clock}').replace(tzinfo=ZoneInfo(zone))
        start = dt.astimezone(KST).isoformat(timespec='seconds')
    return dict(code=code, title=title, localDate=day.isoformat(), start=start, region=region,
                eventType=kind, importance=importance, sourceUrl=url, **fields)


def evidence(label, url, day):
    return dict(source=label, url=url, eventDate=day.isoformat())


def english_month(name):
    return [month[:3] for month in calendar.month_name].index(name[:3])


def bok_notice_dates(url, year):
    attachment = html(url).select_one('a[href^="/fileSrc/"][href$=".pdf"]')
    require(attachment is not None, 'annual meeting PDF missing')
    pdf = PdfReader(BytesIO(fetch(urljoin(url, attachment['href']))))
    require(0 < len(pdf.pages) <= 4, 'unexpected annual meeting PDF length')
    body = ' '.join(page.extract_text() for page in pdf.pages)
    require(str(year) in body and 'meeting dates' in body.lower(), 'annual meeting PDF heading mismatch')
    dates = {date(year, english_month(month), int(day)) for month, day in
             re.findall(r'\b([A-Z][a-z]{2,8})\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday)\s+(\d{1,2})\b', body)}
    require(len(dates) == 8, 'expected eight policy decisions in annual notice')
    return dates


def bok_annual(year, today):
    url = BOK_YEAR.format(year)
    page = html(url)
    require(page.select_one(f'#pYear option[value="{year}"][selected]'), 'wrong BOK year')
    rows = {}
    for row in page.select('tr:has(th[scope="row"])'):
        match = re.fullmatch(r'(\d{2})월 (\d{2})일\(.+\)', row.th.get_text(strip=True))
        if match:
            rows[date(year, *map(int, match.groups()))] = row
    notice = BOK_NOTICES.get(year)
    dates = bok_notice_dates(notice, year) if notice else set(rows)
    require(len(dates) == 8, 'BOK annual schedule not yet available')
    if len(rows) == 8:
        require(set(rows) == dates, 'BOK annual notice and decision table disagree')
    else:
        require(set(rows) <= dates, 'BOK decision table disagrees with annual notice')
    cross = {}
    for day in dates:
        if abs((today - day).days) <= 35:
            monthly = BOK_MONTH.format(day.strftime('%Y-%m'))
            entries = html(monthly).select('dl:has(dd.date)')
            other_dates = {entry.select_one('dd.date').get_text(strip=True) for entry in entries
                           if '통화정책방향 회의' in entry.dt.get_text(' ', strip=True)}
            require(day.isoformat() in other_dates, f'BOK monthly calendar did not confirm {day}')
            cross[day] = evidence('한국은행 월간 행사', monthly, day)
    events = []
    for day in sorted(dates):
        row = rows.get(day)
        source = url if row is not None else notice
        links = [evidence('한국은행 연간 일정', notice or url, day)]
        if day in cross:
            links.append(cross[day])
        fields = {}
        if row is not None and day <= today:
            press = row.find('td').select_one('a[href*="/fileDown.do"][href*="fileSn=2"]')
            if press:
                fields.update(status='reported', resultUrl=urljoin(url, press['href']))
                if (today - day).days <= 7:
                    try:
                        body = PdfReader(BytesIO(fetch(fields['resultUrl']))).pages[0].extract_text()
                        text = re.sub(r'\s+', '', body)
                        rate = re.search(r'한국은행기준금리를[^%]{0,60}?(\d\.\d{2})%[^.]*?(?:에서유지|수준에서유지|수준으로운용|로인상|로인하)', text)
                        if rate:
                            fields['result'] = dict(state='ok', text=f'공식 기준금리 {rate[1]}%', basis='한국은행 통화정책방향 결정문')
                    except (OSError, PdfReadError, ValueError, IndexError) as exc:
                        print(f'::warning title=BOK result {day}::{exc}; retaining official result link')
        clock = None
        if day == date(2026, 11, 26):
            clock = '10:30'
            links.append(evidence('한국은행 주간보도계획', BOK_WEEK, day))
            fields.update(releaseTimeNote='보도자료 배포 예정 시각은 10:30경 (KST)')
        events.append(event('BOK', '한국은행 금융통화위원회 기준금리 결정', day, 'KR', source,
                            clock, kind='decision', sources=links, **fields))
    return events


def bok_november_briefings():
    # Times transcribed from the official weekly PDF. 13:30 is the public embargo time.
    day = date(2026, 11, 26)
    return [event(code, title, day, 'KR', BOK_WEEK, clock, kind='briefing', importance=importance,
                  releaseTimeNote=note)
            for code, title, clock, importance, note in (
                ('BOK_PRESS', '한국은행 총재 통화정책방향 기자간담회', '11:10', 3, ''),
                ('BOK_OUTLOOK', '한국은행 11월 경제전망 공개', '13:30', 3, '보도 가능 시각 (엠바고 해제)'),
                ('BOK_OUTLOOK_BRIEF', '한국은행 경제전망 설명회', '14:00', 2, ''))]


def fed_annual(page, year):
    heading = page.find(string=re.compile(rf'^\s*{year} FOMC Meetings\s*$'))
    require(heading is not None, 'missing Fed year heading')
    rows = heading.find_parent(class_='panel').select('.fomc-meeting__month')
    events = []
    for row in rows:
        day_cell = row.find_next_sibling(class_='fomc-meeting__date')
        label = day_cell.get_text(' ', strip=True)
        match = re.fullmatch(r'(?:\d{1,2}\s*[-–]\s*)?(\d{1,2})(\*)?', label)
        require(match is not None, f'unknown FOMC date format {label}')
        month = row.get_text(' ', strip=True).split('/')[-1].strip()
        day = date(year, english_month(month), int(match[1]))
        title = 'FOMC 금리 결정' + (' (경제전망·점도표)' if match[2] else '')
        fields = {}
        release = day_cell.parent.select_one('a[href*="/newsevents/pressreleases/monetary"]')
        if release:
            fields.update(status='reported', resultUrl=urljoin(FED, release['href']))
        events.append(event('FOMC', title, day, 'US', FED, '14:00', ET, 'decision', **fields))
    require(len(events) == 8, 'expected eight FOMC meetings')
    return events


def ecb_annual(page, year, today):
    events = []
    for entry in page.select('dt + dd'):
        if 'monetary policy meeting' not in entry.get_text(' ', strip=True).lower() or '(Day 2)' not in entry.get_text():
            continue
        day = datetime.strptime(entry.find_previous_sibling('dt').get_text(strip=True), '%d/%m/%Y').date()
        if day.year == year:
            events.append(event('ECB', 'ECB 통화정책회의 금리 결정', day, 'EU', ECB,
                                '14:15', 'Europe/Berlin', 'decision'))
    if year > today.year:
        require(len(events) == 8, 'expected eight ECB meetings for the next year')
    else:
        require(events or today.month == 12, 'ECB current-year calendar unexpectedly empty')
    return events


def boj_annual(page, year):
    caption = page.find('caption', string=re.compile(rf'Table\s*:\s*{year}\b'))
    require(caption is not None, 'BOJ annual table missing')
    events = []
    for row in caption.parent.select('tbody tr'):
        cell = row.td
        label = cell.get_text(' ', strip=True)
        match = re.fullmatch(r'([A-Z][a-z]+)\.?\s+(\d{1,2})\s*\([^)]*\)(?:,\s*(?:([A-Z][a-z]+)\.?\s+)?(\d{1,2})\s*\([^)]*\))?(?:\s*\[PDF[^]]*\])?', label)
        require(match is not None, f'unknown BOJ date format {label}')
        day = date(year, english_month(match[3] or match[1]), int(match[4] or match[2]))
        release = cell.select_one('a[href*="/mpmdeci/"]')
        fields = dict(status='reported', resultUrl=urljoin(BOJ, release['href'])) if release else {}
        events.append(event('BOJ', '일본은행(BOJ) 금융정책결정회의 결과', day, 'JP', BOJ,
                            kind='decision', **fields))
    require(len(events) == 8, 'expected eight BOJ meetings')
    return events


def nyse_annual(page, year):
    table = next((t for t in page.select('table') if 'Thanksgiving Day' in t.get_text()), None)
    require(table is not None, 'NYSE holiday table missing')
    header, *rows = table.select('tr')
    headers = [c.get_text(strip=True) for c in header.find_all(['th', 'td'], recursive=False)]
    require(str(year) in headers, 'NYSE year missing')
    column = headers.index(str(year))
    events = []
    for row in rows:
        cells = row.find_all(['th', 'td'], recursive=False)
        holiday = cells[0].get_text(' ', strip=True)
        label = cells[column].get_text(' ', strip=True)
        match = re.search(r'([A-Z][a-z]+) (\d{1,2})', label)
        if match:
            day = date(year, english_month(match[1]), int(match[2]))
            events.append(event('NYSE_CLOSED', f'뉴욕증권거래소 휴장 · {holiday}', day, 'US', NYSE,
                                kind='market', releaseTimeNote='미국 현지 거래일 기준'))
    require(9 <= len(events) <= 11, 'incomplete NYSE holiday table')
    for note in page.find_all('p'):
        label = note.get_text(' ', strip=True)
        if 'close early at 1:00 p.m.' not in label:
            continue
        for month, day in re.findall(rf'([A-Z][a-z]+) (\d{{1,2}}), {year}\b', label):
            local = date(year, english_month(month), int(day))
            events.append(event('NYSE_EARLY', '뉴욕증권거래소 정규장 조기 마감', local, 'US', NYSE,
                                '13:00', ET, 'market', releaseTimeNote=f'미국 현지 거래일 {local}'))
    require(any(row['code'] == 'NYSE_EARLY' for row in events), 'NYSE early close dates missing')
    return events


def nasdaq_cross_check(events, page):
    checked = {}
    for row in page.select('tr'):
        cells = [cell.get_text(' ', strip=True) for cell in row.find_all('td', recursive=False)]
        if len(cells) != 3:
            continue
        match = re.fullmatch(r'([A-Z][a-z]+) (\d{1,2}), (20\d{2})', cells[0])
        if match and ('thanksgiving' in cells[1].lower() or 'early close' in cells[1].lower()):
            day = date(int(match[3]), english_month(match[1]), int(match[2]))
            code = 'NYSE_CLOSED' if cells[2] == 'Closed' else 'NYSE_EARLY'
            checked[code, day.isoformat()] = evidence('Nasdaq', NASDAQ, day)
    # November 2026 has a dated Trader Alert as an additional official source.
    for day, code in ((date(2026, 11, 26), 'NYSE_CLOSED'), (date(2026, 11, 27), 'NYSE_EARLY')):
        checked.setdefault((code, day.isoformat()), evidence('Nasdaq Trader Alert', NASDAQ_THANKSGIVING, day))
    for row in events:
        if proof := checked.get((row['code'], row['localDate'])):
            row['title'] = row['title'].replace('뉴욕증권거래소', 'NYSE·Nasdaq')
            row['sources'] = [dict(source='NYSE', url=NYSE, eventDate=row['localDate']), proof]
    return events


def krx_holidays():
    return [event('KRX_CLOSED', '한국거래소(KRX) 휴장', date.fromisoformat(value), 'KR', KRX, kind='market')
            for value in sorted(KRX_HOLIDAYS_2026) if date.fromisoformat(value).weekday() < 5]


def bea_annual(page, year):
    events = []
    for row in page.select('tr:has(.release-date)'):
        title = row.select_one('.release-title').get_text(' ', strip=True)
        if title.startswith('GDP (') or title.startswith('Gross Domestic Product,'):
            code, label = 'GDP', '미국 GDP'
        elif title.startswith('Personal Income and Outlays,'):
            code, label = 'PCE', '미국 개인소득·지출(PCE 물가)'
        else:
            continue
        day_text = row.select_one('.release-date').get_text(' ', strip=True)
        day = datetime.strptime(f'{year} {day_text}', '%Y %B %d').date()
        clock = datetime.strptime(row.select_one('.scheduled-date small').get_text(strip=True), '%I:%M %p')
        link = row.select_one('td.views-field-field-scheduled-release-url a[href]')
        fields = dict(status='reported', resultUrl=urljoin(BEA, link['href'])) if link and link['href'].startswith(('/news/', 'https://www.bea.gov/news/')) else {}
        events.append(event(code, label, day, 'US', BEA, clock.strftime('%H:%M'), ET, **fields))
    require(all(sum(event['code'] == code for event in events) >= 10 for code in ('GDP', 'PCE')),
            'incomplete BEA annual releases')
    return events


def bls_annual(page, year):
    codes = {'Consumer Price Index': ('CPI', '미국 소비자물가지수(CPI)'),
             'Producer Price Index': ('PPI', '미국 생산자물가지수(PPI)'),
             'Employment Situation': ('NFP', '미국 고용보고서'),
             'Job Openings and Labor Turnover Survey': ('JOLTS', '미국 구인·이직 보고서(JOLTS)')}
    events = []
    for row in page.select('tr'):
        cells = [cell.get_text(' ', strip=True) for cell in row.find_all('td', recursive=False)]
        if len(cells) < 3:
            continue
        for title, (code, label) in codes.items():
            if not cells[2].startswith(title + ' for '):
                continue
            day = datetime.strptime(cells[0], '%A, %B %d, %Y').date()
            clock = datetime.strptime(cells[1], '%I:%M %p').strftime('%H:%M')
            require(day.year == year, 'BLS dates belong to a different year')
            events.append(event(code, label, day, 'US', BLS.format(year), clock, ET))
    require(all(sum(e['code'] == code for e in events) >= 10 for code, _ in codes.values()),
            'incomplete BLS annual releases')
    return events


def bok_gdp(year):
    url = BOK_STATS.format(year)
    events = []
    for row in html(url).select('tr'):
        cells = [cell.get_text(' ', strip=True) for cell in row.find_all('td', recursive=False)]
        if len(cells) < 3 or '실질 국내총생산(속보)' not in cells[2]:
            continue
        day = date.fromisoformat(cells[0])
        if day.year == year:
            clock = datetime.strptime(cells[1], '%H:%M').strftime('%H:%M')
            events.append(event('KR_GDP', cells[2], day, 'KR', url, clock))
    require(len(events) == 4, 'expected four Korean advance GDP releases per year')
    return events


def korean_statistics(year, month):
    url = KOSTAT.format(year, month)
    events = []
    for row in html(url).select('tr'):
        cells = [cell.get_text(' ', strip=True) for cell in row.find_all('td', recursive=False)]
        if len(cells) < 3:
            continue
        if '소비자물가동향' in cells[2]:
            code = 'KR_CPI'
        elif re.search(r'\d+월\s+고용동향$', cells[2]):
            code = 'KR_NFP'
        else:
            continue
        match = re.match(r'(\d+)\.(\d+)\.', cells[0])
        require(match is not None and int(match[1]) == month, 'KOSTAT wrong release month')
        day = date(year, month, int(match[2]))
        events.append(event(code, cells[2], day, 'KR', url, cells[1]))
    require({'KR_CPI', 'KR_NFP'} == {e['code'] for e in events}, 'Korean CPI or jobs release missing')
    return events


def collect_group(previous, year, label, replace, collect, keep_before=None):
    try:
        rows = collect()
        merged = {}
        if keep_before:
            merged.update({(row['code'], row['localDate']): row for row in previous.get('events', [])
                           if row['localDate'] < keep_before.isoformat()})
        keys = [(row['code'], row['localDate']) for row in rows]
        require(len(keys) == len(set(keys)), 'duplicate official event identity')
        for key, row in zip(keys, rows):
            prior = next((item for item in previous.get('events', [])
                          if (item['code'], item['localDate']) == key), {})
            if prior.get('result') and not row.get('result'):
                row.update(result=prior['result'], resultUrl=prior['resultUrl'], status='reported')
            merged[key] = row
        return dict(year=year, label=label, replace=replace, state='ok',
                    events=sorted(merged.values(), key=lambda row: (row['start'], row['code'])))
    except (ValueError, OSError, AttributeError, IndexError, KeyError, TypeError, PdfReadError) as exc:
        print(f'::warning title={label} {year}::{exc}; keeping last verified schedule')
        return dict(year=year, label=label, replace=previous.get('replace', []),
                    state='error', events=previous.get('events', []))


def build(previous, today):
    years = (today.year, today.year + 1)
    groups = dict(previous)
    tasks = {}

    def add(key, year, label, run, replace=(), keep_before=None):
        name = f'{key}:{year}'
        tasks[name] = (groups.get(name, {}), year, label, list(replace), run, keep_before)

    # Reuse a single public request across both years for publishers that combine them.
    page = lru_cache(maxsize=12)(html)
    for year in years:
        add('bok', year, '한국은행 금통위', lambda y=year: bok_annual(y, today))
        add('fed', year, '연준 FOMC', lambda y=year: fed_annual(page(FED), y), ['FOMC'])
        add('ecb', year, 'ECB', lambda y=year: ecb_annual(page(ECB), y, today), keep_before=today)
        add('boj', year, '일본은행', lambda y=year: boj_annual(page(BOJ), y))
        add('nyse', year, 'NYSE', lambda y=year: nyse_annual(page(NYSE), y))
        add('bea', year, '미국 BEA', lambda y=year: bea_annual(page(BEA + ('full' if y == today.year else 'next-year')), y),
            ['GDP', 'PCE'])
        add('bls', year, '미국 BLS', lambda y=year: bls_annual(page(BLS.format(y)), y), ['CPI', 'PPI', 'NFP', 'JOLTS'])
        add('bok-gdp', year, '한국 GDP', lambda y=year: bok_gdp(y))
    for month_start in (today.replace(day=1), (today.replace(day=28) + timedelta(days=4)).replace(day=1)):
        add(f'kostat-{month_start.month:02d}', month_start.year, '한국 소비자물가·고용',
            lambda day=month_start: korean_statistics(day.year, day.month))

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {key: pool.submit(collect_group, *task) for key, task in tasks.items()}
        groups.update({key: future.result() for key, future in futures.items()})
    current_nyse = groups[f'nyse:{today.year}']
    if current_nyse['state'] == 'ok':
        try:
            nasdaq_cross_check(current_nyse['events'], page(NASDAQ))
        except (OSError, ValueError, AttributeError) as exc:
            print(f'::warning title=Nasdaq cross-check::{exc}')
            for row in current_nyse['events']:
                previous_row = next((r for r in previous.get(f'nyse:{today.year}', {}).get('events', [])
                                     if r['code'] == row['code'] and r['localDate'] == row['localDate']), {})
                if previous_row.get('sources'):
                    row.update(title=previous_row['title'], sources=previous_row['sources'])
    groups['bok-briefings:2026'] = dict(year=2026, label='한국은행 주간보도계획', events=bok_november_briefings(), state='ok')
    groups['krx:2026'] = dict(year=2026, label='KRX 공통 휴장표', events=krx_holidays(), state='ok')
    for key in tasks:
        print(f'{key} {groups[key]["state"]}: {len(groups[key]["events"])}')
    return groups


def main():
    previous = json.loads(ASSET.read_text(encoding='utf-8').removeprefix(PREFIX).strip().removesuffix(';')) if ASSET.exists() else {}
    groups = build(previous.get('groups', {}), datetime.now(KST).date())
    serialized = json.dumps(groups, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    if groups != previous.get('groups'):
        temporary = ASSET.with_suffix('.tmp')
        temporary.write_text(PREFIX + '{"groups":' + serialized + '};\n', encoding='utf-8')
        temporary.replace(ASSET)


if __name__ == '__main__':
    main()
