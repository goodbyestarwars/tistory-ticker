"""Last independently verified official notices, not an index membership list.

Facts checked 2026-10-28 against the linked issuer releases. Used only when the
upstream calendar omits an event. Future dates are never extrapolated. Scheduled
refreshes revalidate these URLs; 403 is recorded, never bypassed. Only metadata,
not article text/attachments, is redistributed.
"""
NOTICES = (
    dict(market='us', symbol='STX', company='Seagate Technology', fiscalPeriod='2027-Q1',
         eventDate='2026-10-27', kstDate='2026-10-28', us_date='2026-10-27', us_session='장후',
         timezone='America/New_York', conferenceCallAt='2026-10-27T17:00:00-04:00',
         sourceUrl='https://investors.seagate.com/news/news-details/2026/Seagate-Technology-to-Report-Fiscal-First-Quarter-2027-Financial-Results-on-October-27-2026/default.aspx'),
    dict(market='us', symbol='HOOD', company='Robinhood Markets', fiscalPeriod='2026-Q3',
         eventDate='2026-10-27', kstDate='2026-10-28', us_date='2026-10-27', us_session='장후',
         timezone='America/New_York', conferenceCallAt='2026-10-27T17:00:00-04:00',
         sourceUrl='https://investors.robinhood.com/news-releases/news-release-details/robinhood-markets-inc-announce-third-quarter-2026-results'),
    dict(market='domestic', symbol='000660', company='SK하이닉스', fiscalPeriod='2026-Q3',
         eventDate='2026-10-28', kstDate='2026-10-28', timezone='Asia/Seoul',
         conferenceCallAt='2026-10-28T09:00:00+09:00', releaseTimeNote='09:00 이전 (한국시간), 정확한 발표 시각 미확인',
         sourceUrl='https://news.skhynix.com/en/q3-2026-earnings-conference-call-invitation/'),
    dict(market='domestic', symbol='005930', company='삼성전자', fiscalPeriod='2026-Q3',
         eventDate='2026-10-29', kstDate='2026-10-29', timezone='Asia/Seoul',
         conferenceCallAt='2026-10-29T10:00:00+09:00', sourceUrl='https://www.samsung.com/global/ir/'),
)


def events():
    return [dict(row, title='$' + (row['symbol'] if row['market'] == 'us' else row['company']) + ' ' + row['fiscalPeriod'] + ' 실적발표 예정',
                 start=row['kstDate'], eventType='earnings', scheduledAt=None, status='scheduled',
                 source='corporate-ir-us' if row['market'] == 'us' else 'corporate-ir', link=row['sourceUrl'],
                 dateBasis='scheduled_event', datePrecision='session' if row['market'] == 'us' else 'date',
                 verification='official_snapshot', verifiedAt='2026-10-28') for row in NOTICES]
