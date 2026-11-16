# -*- coding: utf-8 -*-
"""���� ������ "�����ں� �Ÿ� ����" ����(�۾����ü� #4, 2026-07-20 + UI���� ���ü�
2026-07-21) - ���庰(�ڽ���/�ڽ���) ����/�ܱ���/����� �Ϻ� ���ż�(���) ���� + ��/��/�� ����.

�۾����ü��� Ű�� TR(get_investor_summary/get_investor_trend)�� stk_cd ���� ȣ���ϸ�
���� ��ü(�ڽ���) ���� �شٰ� ����������, ���� ���(2026-07-20, MCP get_investor_summary/
get_investor_trend�� stk_cd ���� ���� ȣ��) �� �� `����: 'stk_cd'`�� ���� - �� TR ���
���� ��ȸ �����̰� ���� ��ü ���踦 �������� �ʴ´�.

**������ �ҽ�**: KIS(�ѱ���������) TR `FHPTJ04040000`(���庰 �����ڸŸŵ���(�Ϻ�),
kis_client.fetch_market_investor_daily)�� ����Ѵ�. �ѱ����� HTS [0404] ���庰 �Ϻ������
1:1 �����ϴ� ���� API�̸� market_iscd�� 'KSP'(�ڽ���)/'KSQ'(�ڽ���)�� �����Ѵ�. �Ϸ�ġ����
��ȸ�Ǵ� ������(���� ������ FID_INPUT_DATE_1=FID_INPUT_DATE_2�� ������) ��¥���� �ݺ�
ȣ���� DB(investor_trend_daily, market �÷����� ���� ����)�� �״´�. `_tr_pbmn`(�ŷ����)
�ʵ�� �鸸�� �����̸�, �ܱ����� frgn_reg_ntby_pbmn(��� �ܱ���)�� ����Ѵ�. KIS ��� ����
���� KIS ĳ�ø� �����ϰ� �ٸ� �����ڷ� ��ü���� �ʴ´�.

**���� ���(2026-07-20, �ڽ��� ����)**: �� ������ ���� ��ǥ�ߴ� "HTS �����ں��Ÿ�����
([0780]/[0404]/[0403] ��) �ڽ��� ��"�� ��Ȯ�� ��ġ�ϴ� �ҽ��� �� ã�� - KIS �Ϻ�/Ű��
ka10051/KIS �ü�(FHPTJ04030000, ���) �� ������ ���������� ���� �佺��Ű�� HTS ����
�޶���, Ű�� ���� AI ���Ƿε� "������ REST TR �� �� ȭ��� 1:1 �����ϴ� �� ����, ����
TR(ka10059)�� �� ����(800����) ��ȸ �ջ��ؾ� �ϴµ� �׷��� ETF ���Կ��Ρ�����ó�� ��
ȭ�� ���� ���� ���̷� ���� ��ġ�� ���� �� ��"�̶�� ���� ����(������ ��ȸ�� �� ���Ÿ���
ȣ�ⷮ�� ���������̶� ä�� �� ��). ����� �Ǵ����� KIS �Ϻ��� ���� �ҽ��� ä��.
**2026-07-21 ����**: �׷��� ����ڰ� KRX ���� ���(�ڽ��� ���/�ܱ���/���� ���ż�, �ʾ��
����)�� ���� ������ ��� KIS �Ϻ� ���� KRX ������ ���� ��Ȯ�� ��ġ���� Ȯ��(���� ����
0.07��, ��� 4.9�� �� �ݿø� ����) - �� �¾Ҵ� �� Ű��/�佺 HTS `[0780]` ���� ���� KRX
���� ��ġ�� �ٸ� ��ü ���踦 ���� �־��� ������ ���. KIS �Ϻ��� ���信 �����ٴ� ���̶�
�״�� ����.

**�ڽ��� ������ 2026-07-21 ���� ��� ������ �ҽ��� ���� �� ���� �������� ����**�� - KIS
���������ɼ� ī�װ��� 43�� API ��ü�� �����ڸŸŵ��� API ��ü�� ����(kis-code-assistant-mcp
Ȯ��), Ű�� ���۷��� �������� ���� ������ TR�� ����, ���̹��� �ش� �������� ����(�����
Ȯ�� �� �ڽ���/�ڽ��� 2�� �������� ��� ���� ����).

���̹� ���� ���� ����(2026-07-20, curl ����):
- bizdate �Ķ���Ͱ� �ʼ� - �����ϸ� �� �������� ��(�� URL�� �Ķ���� ���� ȣ���� ��� 0��).
- sosok�� ����(�Ǵ� ����) �ڽ���, ���� �־(��: 1) �� ������������ �� ��� - 2026-07-21
  ��Ȯ���ص� ������ �� ����� �ڽ����� �� �������� �� ����(���� ���).
- page=N���� bizdate ���� ���� ���������̼� ����(1������=10��, page=14�� �� 6���� ��) -
  bond_yield.py�� interestDailyQuote.naver�� ������ ����¡ ����.
- ���� ���̺� �÷� ����: ��¥, ����, �ܱ���, �����, (��� ���� 6�÷�), ��Ÿ���� - �� �����
  �� 4�÷�(��¥/����/�ܱ���/�����)�� ����. �� ��ȣ�� �� Ŭ����(rate_up3/rate_down3)�� �ƴ϶�
  �ؽ�Ʈ ��ü�� '-'�� ���Ե� ����(Ŭ������ �����, �Ľ̿� �� ��)."""

import logging
import json
import math
import re
import threading
import time
import urllib.request
from collections import OrderedDict
from datetime import datetime, timedelta, timezone

import db_schema
import kis_client
import kiwoom_client

logger = logging.getLogger('investor_trend')

KST = timezone(timedelta(hours=9))
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
_URL = 'https://finance.naver.com/sise/investorDealTrendDay.naver?bizdate=%s&sosok=&page=%d'

_ROWS_PER_PAGE = 10
_HISTORY_PAGES = 14  # 140�� - "��" �� �ֱ� 6����(~126�ŷ���) + ������
_RECENT_POLL_SEC = 60  # ��/�� �� "1�� ����" �䱸����
_HISTORY_REFRESH_SEC = 6 * 3600  # �� ���� �帶�� �� Ȯ��ġ�� ��� - �ٸ� ��ġ ���� ���� �ֱ�

# ���� Ű(����Ʈ/�����Ķ���Ϳ�, �ҹ���) -> DB�� �����ϴ� ����� + �� �ҽ��� �Ķ����.
# ������ ������ �ҽ��� ���� ����(�� ��� ����Ʈ�� ����).
MARKETS = {
    'kospi': {'db': 'KOSPI', 'kis_iscd': 'KSP', 'kis_inds_cd': '0001', 'kiwoom_mrkt_tp': '0', 'naver': True, 'label': 'KOSPI'},
    'kosdaq': {'db': 'KOSDAQ', 'kis_iscd': 'KSQ', 'kis_inds_cd': '1001', 'kiwoom_mrkt_tp': '1', 'naver': False, 'label': 'KOSDAQ'},
}
DEFAULT_MARKET = 'kospi'

# ��¥ �� + ����/�ܱ���/����� 3�� �� ���� �̴´�(�� �������/��Ÿ���� �÷��� ����).
_ROW_RE = re.compile(
    r'<td class="date2">(?P<date>[\d.]+)</td>\s*'
    r'<td class="rate_\w+3">(?P<ind>-?[\d,]+)</td>\s*'
    r'<td class="rate_\w+3">(?P<frgn>-?[\d,]+)</td>\s*'
    r'<td class="rate_\w+3">(?P<orgn>-?[\d,]+)</td>',
)


def _today_bizdate():
    return datetime.now(KST).strftime('%Y%m%d')


def _fetch_page(bizdate, page):
    req = urllib.request.Request(_URL % (bizdate, page), headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=15) as res:
        html = res.read().decode('euc-kr', errors='replace')
    rows = []
    for m in _ROW_RE.finditer(html):
        try:
            rows.append({
                'date': '20' + m.group('date').replace('.', ''),  # 'YY.MM.DD' -> 'YYYYMMDD'
                'ind': float(m.group('ind').replace(',', '')),
                'frgn': float(m.group('frgn').replace(',', '')),
                'orgn': float(m.group('orgn').replace(',', '')),
            })
        except (TypeError, ValueError):
            continue
    return rows


def fetch_recent(pages=1, bizdate=None):
    """[���̹� ����, �ڽ��� ����] �ֱ� page*10��(��������). pages=1�̸� �ֱ� 10�ŷ���."""
    bizdate = bizdate or _today_bizdate()
    rows = []
    for page in range(1, pages + 1):
        page_rows = _fetch_page(bizdate, page)
        if not page_rows:
            break
        rows.extend(page_rows)
    rows.reverse()  # ���̹��� �ֽż����� �ֹǷ� ������������ ������(�ٸ� ������� ����)
    return rows


def refresh_recent(market_db='KOSPI'):
    """[���̹� ����, �ڽ��� ����] 1�� ������ - page=1(�ֱ� 10�ŷ���)�� ����ȸ�� ���� ���� �� ����."""
    rows = fetch_recent(pages=1)
    if not rows:
        logger.warning('investor_trend[%s]: Naver recent fetch got 0 rows', market_db)
        return
    conn = db_schema.get_conn()
    try:
        db_schema.upsert_investor_trend_rows(conn, market_db, rows)
        logger.info('investor_trend[%s] Naver recent refreshed: %d rows (latest=%s)', market_db, len(rows), rows[-1]['date'])
    finally:
        conn.close()


def refresh_history(market_db='KOSPI'):
    """[���̹� ����, �ڽ��� ����] 6�ð� �ֱ� - ���� ���������� �Ⱦ� "��/��" ���� �Ⱓ�� ä���."""
    rows = fetch_recent(pages=_HISTORY_PAGES)
    if not rows:
        logger.warning('investor_trend[%s]: Naver history fetch got 0 rows', market_db)
        return
    conn = db_schema.get_conn()
    try:
        db_schema.upsert_investor_trend_rows(conn, market_db, rows)
        logger.info('investor_trend[%s] Naver history refreshed: %d rows (%s ~ %s)',
                     market_db, len(rows), rows[0]['date'], rows[-1]['date'])
    finally:
        conn.close()


# ---- KIS(1�� �ҽ�) - ���庰 �����ڸŸŵ���(�Ϻ�), ��¥�� �ݺ� ȣ�� ----

_KIS_CALL_DELAY_SEC = 0.25  # ���� �� ������ ���� ȣ�� ����(���� rate limit ����ȭ �� ���־� ����������)
_KIS_TARGET_DAYS = _HISTORY_PAGES * _ROWS_PER_PAGE  # ���̹� ����� ������ ������(140��)
_KIS_MAX_CALENDAR_DAYS = 220  # �ָ�/������ �����ص� 140�������� ä��� ����� ����


def _kis_row_to_common(date_str, row):
    def amt(key):
        try:
            return float(row.get(key) or 0) / 100  # �鸸�� -> ���(2026-07-20 ���̺� �������� Ȯ��)
        except (TypeError, ValueError):
            return 0.0

    def index_close():
        # �������� ����(bstp_nmix_prpr). ���� ���� �� �ð� ������ ���� �� ���� �� ������ ���������.
        try:
            value = float(row.get('bstp_nmix_prpr'))
        except (TypeError, ValueError):
            return None
        return value if value > 0 else None

    return {
        'date': row.get('stck_bsop_date') or date_str,
        'ind': amt('prsn_ntby_tr_pbmn'),
        'frgn': amt('frgn_reg_ntby_pbmn'),
        'orgn': amt('orgn_ntby_tr_pbmn'),
        'index': index_close(),
    }


def fetch_kis_day(token, appkey, appsecret, date_str, kis_iscd='KSP', kis_inds_cd='0001'):
    """date_str('YYYYMMDD') �Ϸ�ġ. ������/������ �����̸� None."""
    output = kis_client.fetch_market_investor_daily(
        token, appkey, appsecret, date_str, date_str, market_iscd=kis_iscd, inds_cd=kis_inds_cd)
    if not output:
        return None
    return _kis_row_to_common(date_str, output[0])


# ---- KIS �̷�(�� �� ȣ��� �� 300������) - �����ں� �ڱ� �帧 �׷���(1��)�� ----
# 2026-10-12 � VM ����: FHPTJ04040000 �� ��¥�� �ϳ��� �൵(DATE_1=DATE_2) �� ��¥������ �ֱ� 300������ ����
# �Ѳ����� �����ش�(�ڽ��ǡ��ڽ��� ��� 2025-07-16~2026-10-08, ��¥ �ߺ� ����, �ʵ� ���� ����). �ึ�� ���ż� ��������ݰ� ��������
# ������ �ְ� **�Ѹż����Ѹŵ� �ʵ�� ����**(���ż� ��� *_ntby_tr_pbmn, ���ż� ���� *_ntby_qty, ���� bstp_nmix_*).
# �׷��� �� ����� �Ѹż����Ѹŵ��� ���������� ���ż����� �Ųٷ� ��������� �ʴ´�.
_HISTORY_MAX_DAYS = 300
_HISTORY_NOTE_GROSS = ('KIS ���庰 �����ڸŸŵ���(�Ϻ�, FHPTJ04040000)�� �����ں� ���ż�(���������)�� ���������� �����ϰ� '
                       '�Ѹż����Ѹŵ� �ݾ� �ʵ尡 �����ϴ�. ���ż����� �Ųٷ� ������� �ʽ��ϴ�.')


def fetch_kis_history(token, appkey, appsecret, kis_iscd, kis_inds_cd, anchor=None):
    """����(�����̸� ���� ����� ���� ��¥)�� �������� KIS �Ϻ� ���� ��ü(�ֱ� �� 300������)�� ���� ������ �ٲ� �����ش�."""
    day = anchor or datetime.now(KST)
    for back in range(0, 8):
        date_str = (day - timedelta(days=back)).strftime('%Y%m%d')
        output = kis_client.fetch_market_investor_daily(
            token, appkey, appsecret, date_str, date_str, market_iscd=kis_iscd, inds_cd=kis_inds_cd)
        if output:
            rows = [_kis_row_to_common(date_str, r) for r in output if r.get('stck_bsop_date')]
            # �� ���� ��� 0�� ���� �ŷ��� �ڷᰡ �ƴϴ�(��Ȯ���������� ����) - 0�� �ŷ��� �������� �ʴ´�.
            return [r for r in rows if r['ind'] or r['frgn'] or r['orgn']]
        time.sleep(_KIS_CALL_DELAY_SEC)
    return []


def backfill_history_kis(appkey, appsecret, market_db, kis_iscd, kis_inds_cd):
    """������ �� �� ��: ����� KIS 1ȸ ȣ��� �̷¡����� ������ ä���. ���� ��¥�� ����Ἥ �ߺ��� ������ �ʴ´�."""
    token = kis_client.get_token(appkey, appsecret)
    rows = fetch_kis_history(token, appkey, appsecret, kis_iscd, kis_inds_cd)
    if not rows:
        logger.warning('investor_trend[%s] KIS history backfill got no rows', market_db)
        return 0
    first, last = min(r['date'] for r in rows), max(r['date'] for r in rows)
    conn = db_schema.get_conn()
    try:
        db_schema.upsert_investor_trend_rows(conn, market_db, rows)
        # �� �������� �ŷ��Ұ� �������� ���� ��¥�� ��ŷ����̴�. ���� ��¥�� ������ ���� �ָ��������� ��(�ְ� �հ� ���� ��)�� �����.
        stale = db_schema.delete_investor_trend_non_trading(conn, market_db, first, last, [r['date'] for r in rows])
    finally:
        conn.close()
    if stale:
        logger.warning('investor_trend[%s] removed %d non-trading rows saved by an older backfill: %s', market_db, len(stale), ','.join(stale))
    logger.info('investor_trend[%s] KIS history backfill: %d trading days %s..%s', market_db, len(rows), first, last)
    return len(rows)


def _iso_date(d):
    return '%s-%s-%s' % (d[:4], d[4:6], d[6:8])


def get_history(market=DEFAULT_MARKET, days=260, now=None):
    """/investor-trend/history - DB�� ���� �Ϻ� ���ż�(���)�� ���� ������ ��¥ ������������ �����ش�(�ǽð� ȣ�� ����).
    �ŷ��� ���� ���� �� ��ü�� ����(0������ ä���� ����), Ȯ���� �Ⱓ��ŭ�� �������� ��û �ϼ����� ������ count �� �� �� �ִ�."""
    market_cfg = MARKETS.get(market, MARKETS[DEFAULT_MARKET])
    days = max(5, min(int(days or 260), _HISTORY_MAX_DAYS))
    conn = db_schema.get_conn()
    try:
        rows = db_schema.load_investor_trend_daily(conn, market_cfg['db'], limit_days=days + 30)
    finally:
        conn.close()
    seen, clean = set(), []
    for r in rows:
        if r['date'] in seen:
            continue
        seen.add(r['date'])
        if not (r['ind'] or r['frgn'] or r['orgn']):
            continue
        if datetime.strptime(r['date'], '%Y%m%d').weekday() >= 5:
            continue  # �ָ����� ���� ������ �ʴ´�(���� ������ ���� �ָ� �� ���)
        clean.append(r)
    clean.sort(key=lambda r: r['date'])
    clean = clean[-days:]
    now = now or datetime.now(KST)
    latest = clean[-1]['date'] if clean else None
    as_of = max((r['updated_at'] for r in clean if r.get('updated_at')), default=None)
    # ���� ���� ���� ����ġ�̰ų� ���� ���� ����ġ�� �� �ִ�(�����ں� ��ġ�� ���� �ڿ��� ���� ������ �� ����).
    provisional = bool(latest == now.strftime('%Y%m%d') and now.hour * 60 + now.minute < 18 * 60 + 30)
    return {
        'market': market_cfg['label'], 'unit': '���', 'source': 'KIS ���庰 �����ڸŸŵ���(�Ϻ�) FHPTJ04040000',
        'foreignBasis': '��� �ܱ��� ���ż�(frgn_reg_ntby_pbmn)',
        'asOf': as_of, 'latestDate': _iso_date(latest) if latest else None, 'provisional': provisional,
        'count': len(clean), 'requestedDays': days,
        'from': _iso_date(clean[0]['date']) if clean else None, 'to': _iso_date(latest) if latest else None,
        'rows': [{
            'date': _iso_date(r['date']),
            'individual': round(r['ind'], 1), 'foreign': round(r['frgn'], 1), 'institution': round(r['orgn'], 1),
            'indexClose': round(r['index'], 2) if r.get('index') else None,
        } for r in clean],
        'gross': {'supported': False, 'reason': _HISTORY_NOTE_GROSS},
    }


def backfill_kis(appkey, appsecret, market_db, kis_iscd, kis_inds_cd, target_days=_KIS_TARGET_DAYS, max_calendar_days=_KIS_MAX_CALENDAR_DAYS):
    """���ú��� �Ž��� �ö󰡸� ��¥���� ȣ�� - target_days(������)�� ä��ų�
    max_calendar_days(�޷���)�� �� �� ������. �ָ��� ȣ�� ��ü�� �ǳʶڴ�(�������� ȣ����
    �ϵ� �� �������� �ڿ� ��ŵ). ȣ�⸶�� upsert�ؼ� �߰��� �����ص� �׶����� ������� ����."""
    token = kis_client.get_token(appkey, appsecret)
    conn = db_schema.get_conn()
    collected = 0
    calendar_checked = 0
    d = datetime.now(KST)
    try:
        while collected < target_days and calendar_checked < max_calendar_days:
            calendar_checked += 1
            if d.weekday() < 5:  # ��~�ݸ� ȣ��(��/�� ��ŵ)
                date_str = d.strftime('%Y%m%d')
                row = None
                try:
                    row = fetch_kis_day(token, appkey, appsecret, date_str, kis_iscd, kis_inds_cd)
                except Exception:
                    logger.exception('investor_trend[%s] KIS backfill failed at %s', market_db, date_str)
                if row:
                    db_schema.upsert_investor_trend_rows(conn, market_db, [row])
                    collected += 1
                time.sleep(_KIS_CALL_DELAY_SEC)
            d -= timedelta(days=1)
    finally:
        conn.close()
    logger.info('investor_trend[%s] KIS backfill done: %d trading days over %d calendar days',
                 market_db, collected, calendar_checked)


_FORCE_KIS_REBACKFILL = False  # 2026-07-21: �ڽ��� �����ڵ�(0001->1001) ������ �̹� �����
# �߸���(���� 0) ���� �����Ϳ��� �ݿ��Ϸ��� 1ȸ True�� ������ ����� �Ϸᡤ���̺� Ȯ�ε� - ����.


def _ensure_kis_backfill(appkey, appsecret, market_db, kis_iscd, kis_inds_cd):
    """�̹� ����� �׿�������(����� ��) ������ �ǳʶڴ� - �Ź� 130��ȸ ȣ���� ����.
    _FORCE_KIS_REBACKFILL=True�� ������ �ǳʶ��� �ʰ� �׻� �����."""
    if not _FORCE_KIS_REBACKFILL:
        conn = db_schema.get_conn()
        try:
            existing = db_schema.load_investor_trend_daily(conn, market_db, limit_days=_KIS_TARGET_DAYS)
        finally:
            conn.close()
        if len(existing) >= _KIS_TARGET_DAYS - 5:
            logger.info('investor_trend[%s] KIS backfill skipped - already have %d rows', market_db, len(existing))
            return
    backfill_kis(appkey, appsecret, market_db, kis_iscd, kis_inds_cd)


def refresh_recent_kis(appkey, appsecret, market_db, kis_iscd, kis_inds_cd):
    """1�� ������ - ���� �Ϸ�ġ�� ����ȸ(���� �� ����)."""
    token = kis_client.get_token(appkey, appsecret)
    date_str = _today_bizdate()
    row = fetch_kis_day(token, appkey, appsecret, date_str, kis_iscd, kis_inds_cd)
    if not row:
        logger.warning('investor_trend[%s]: KIS recent fetch got no row for %s', market_db, date_str)
        return
    conn = db_schema.get_conn()
    try:
        db_schema.upsert_investor_trend_rows(conn, market_db, [row])
        logger.info('investor_trend[%s] KIS recent refreshed: %s ind=%.0f frgn=%.0f orgn=%.0f',
                     market_db, row['date'], row['ind'], row['frgn'], row['orgn'])
        try:
            record_intraday(conn, market_db, row)
        except Exception:
            logger.exception('investor_trend[%s] intraday observation failed', market_db)
    finally:
        conn.close()


# ---- Ű��(3��, "����"��) - ka10051 �����������ڼ��ż��� "����" �� ----

def fetch_kiwoom_today(appkey, secretkey, mrkt_tp='0'):
    """ka10051�� ��¥ �Ķ���Ͱ� ���� ����/�ֱ� Ȯ�� �������� �ش� - "����" ����.
    stex_tp=3(���� KRX+NXT)�� �� ������Ʈ ����(market_rank.py, kis_client.py ��).
    mrkt_tp='0'(�ڽ���)/'1'(�ڽ���) - ������ ù ���� �׻� "����"(mrkt_tp=0�� ��
    inds_cd="001_AL" "����(KOSPI)"�� ���� Ȯ��, �ڽ��ڵ� ���� ��ġ�� ������ ����)."""
    token = kiwoom_client.get_token(appkey, secretkey)
    res = kiwoom_client.call_tr(token, 'ka10051', '/api/dostk/sect', {
        'mrkt_tp': mrkt_tp,
        'amt_qty_tp': '1',
        'stex_tp': '3',
    })
    rows = res.get('inds_netprps') or []
    if not rows:
        logger.warning('investor_trend: ka10051(mrkt_tp=%s) ������ ������� - return_code=%s',
                        mrkt_tp, res.get('return_code'))
        return None
    top_row = rows[0]

    def amt(key):
        try:
            return float(str(top_row.get(key) or '0').replace(',', ''))
        except (TypeError, ValueError):
            return 0.0

    return {
        'date': _today_bizdate(),
        'ind': amt('ind_netprps'),
        'frgn': amt('frgnr_netprps'),
        'orgn': amt('orgn_netprps'),
    }


def refresh_recent_kiwoom(appkey, secretkey, market_db, mrkt_tp):
    """1�� ������ - "����" �ุ Ű������ �����(���� ���� KIS/���̹� ���� �״�� ����)."""
    row = fetch_kiwoom_today(appkey, secretkey, mrkt_tp)
    if not row:
        return
    conn = db_schema.get_conn()
    try:
        db_schema.upsert_investor_trend_rows(conn, market_db, [row])
        logger.info('investor_trend[%s] Kiwoom recent refreshed: %s ind=%.0f frgn=%.0f orgn=%.0f',
                     market_db, row['date'], row['ind'], row['frgn'], row['orgn'])
    finally:
        conn.close()


# ---- ��/��/�� ���� - rows�� ��������(��¥��) [{date, ind, frgn, orgn}, ...] ���� ----

def bucket_daily(rows, count=10):
    rows = rows[-count:]
    return [
        {'label': '%s.%s' % (r['date'][4:6], r['date'][6:8]), 'ind': r['ind'], 'frgn': r['frgn'], 'orgn': r['orgn']}
        for r in rows
    ]


def _week_monday(date_str):
    d = datetime.strptime(date_str, '%Y%m%d')
    return (d - timedelta(days=d.weekday())).strftime('%Y%m%d')


def _week_label(monday_str):
    d = datetime.strptime(monday_str, '%Y%m%d')
    week_of_month = (d.day - 1) // 7 + 1
    return '%d�� %d��' % (d.month, week_of_month)


def bucket_weekly(rows, count=5):
    buckets = OrderedDict()
    for r in rows:
        key = _week_monday(r['date'])
        b = buckets.setdefault(key, {'ind': 0.0, 'frgn': 0.0, 'orgn': 0.0})
        b['ind'] += r['ind']
        b['frgn'] += r['frgn']
        b['orgn'] += r['orgn']
    keys = list(buckets.keys())[-count:]
    return [
        {'label': _week_label(k), 'ind': buckets[k]['ind'], 'frgn': buckets[k]['frgn'], 'orgn': buckets[k]['orgn']}
        for k in keys
    ]


def bucket_monthly(rows, count=6):
    buckets = OrderedDict()
    for r in rows:
        key = r['date'][:6]  # YYYYMM
        b = buckets.setdefault(key, {'ind': 0.0, 'frgn': 0.0, 'orgn': 0.0})
        b['ind'] += r['ind']
        b['frgn'] += r['frgn']
        b['orgn'] += r['orgn']
    keys = list(buckets.keys())[-count:]
    return [
        {'label': '%s.%s' % (k[:4], k[4:6]), 'ind': buckets[k]['ind'], 'frgn': buckets[k]['frgn'], 'orgn': buckets[k]['orgn']}
        for k in keys
    ]


PERIOD_BUCKETS = {
    'day': lambda rows: bucket_daily(rows, 10),
    'week': lambda rows: bucket_weekly(rows, 5),
    'month': lambda rows: bucket_monthly(rows, 6),
}


def record_intraday(conn, market, row, now=None):
    """Record observed cumulative values, not interval sums or exchange ticks."""
    import market_clock
    now = (now or datetime.now(KST)).astimezone(KST)
    minute = now.hour * 60 + now.minute
    date = now.strftime('%Y%m%d')
    if (row.get('date') != date or not market_clock.is_kr_trading_day(now)
            or not 540 <= minute <= 930):
        return False
    values = [row.get(key) for key in ('ind', 'frgn', 'orgn')]
    if any(v is None or not math.isfinite(float(v)) for v in values):
        return False
    ind, frgn, orgn = map(float, values)
    slot = (minute - 540) // 30
    conn.execute(
        'INSERT INTO investor_trend_intraday '
        '(market,date,slot,ind_amt,frgn_amt,orgn_amt,frgn_high,frgn_low,updated_at) '
        'VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(market,date,slot) DO UPDATE SET '
        'ind_amt=excluded.ind_amt,frgn_amt=excluded.frgn_amt,orgn_amt=excluded.orgn_amt,'
        'frgn_high=MAX(investor_trend_intraday.frgn_high,excluded.frgn_high),'
        'frgn_low=MIN(investor_trend_intraday.frgn_low,excluded.frgn_low),updated_at=excluded.updated_at',
        (market, date, slot, ind, frgn, orgn, frgn, frgn, now.isoformat()))
    cutoff = (now - timedelta(days=14)).strftime('%Y%m%d')
    conn.execute('DELETE FROM investor_trend_intraday WHERE date < ?', (cutoff,))
    conn.commit()
    return True


def get_intraday_result(market=DEFAULT_MARKET, now=None):
    import market_clock
    now = (now or datetime.now(KST)).astimezone(KST)
    market = market if market in MARKETS else DEFAULT_MARKET
    cfg = MARKETS[market]
    conn = db_schema.get_conn()
    try:
        daily = db_schema.load_investor_trend_daily(conn, cfg['db'], limit_days=1)
        latest_day = conn.execute('SELECT MAX(date) FROM investor_trend_intraday WHERE market=?',
                                  (cfg['db'],)).fetchone()[0]
        today = now.strftime('%Y%m%d')
        active_date = market_clock.is_kr_trading_day(now) and now.hour >= 9
        date = today if active_date else latest_day or (daily[-1]['date'] if daily else today)
        records = conn.execute(
            'SELECT slot,ind_amt,frgn_amt,orgn_amt,frgn_high,frgn_low,updated_at '
            'FROM investor_trend_intraday WHERE market=? AND date=? ORDER BY slot',
            (cfg['db'], date)).fetchall()
    finally:
        conn.close()
    def label(slot):
        minute = 540 + slot * 30
        return '%02d:%02d' % divmod(minute, 60)
    rows = [{'slot': r[0], 'label': label(r[0]), 'ind': r[1], 'frgn': r[2], 'orgn': r[3],
             'high': r[4], 'low': r[5], 'asOf': r[6]} for r in records]
    fallback = daily[-1] if daily and daily[-1]['date'] == date else None
    latest = rows[-1]['frgn'] if rows else fallback['frgn'] if fallback else None
    high = max(rows, key=lambda r: r['high']) if rows else None
    low = min(rows, key=lambda r: r['low']) if rows else None
    return {'period': 'intraday', 'market': market, 'date': _iso_date(date),
            'intervalMinutes': 30, 'sessionStart': '09:00', 'sessionEnd': '15:30', 'slotCount': 14,
            'source': 'KIS FHPTJ04040000', 'basis': '���� �ð� ���� ���� ���ż�',
            'state': 'ok' if rows else 'no_samples', 'rows': rows, 'latest': latest,
            'asOf': rows[-1]['asOf'] if rows else fallback['updated_at'] if fallback else None,
            'extrema': {'high': {'value': high['high'], 'slot': high['slot']} if high else None,
                        'low': {'value': low['low'], 'slot': low['slot']} if low else None}}


def get_result(period, market=DEFAULT_MARKET):
    """main.py�� /investor-trend�� ȣ�� - DB�� ���� ĳ�ø� �д´�(�ǽð� ȣ�� ����).
    market: MARKETS�� Ű('kospi'/'kosdaq', �ҹ���) - �𸣴� ���̸� �⺻ �ڽ��Ƿ� ó��."""
    if period == 'intraday':
        return get_intraday_result(market)
    fn = PERIOD_BUCKETS.get(period)
    if fn is None:
        raise ValueError('unknown period: %s' % period)
    market_cfg = MARKETS.get(market, MARKETS[DEFAULT_MARKET])
    conn = db_schema.get_conn()
    try:
        rows = db_schema.load_investor_trend_daily(conn, market_cfg['db'], limit_days=_HISTORY_PAGES * _ROWS_PER_PAGE)
    finally:
        conn.close()
    as_of = rows[-1]['updated_at'] if rows else None
    return {'period': period, 'market': market, 'asOf': as_of, 'rows': fn(rows)}


def _refresh_recent_chain(market_cfg, has_kis, kis_appkey, kis_appsecret):
    """"����" ���� KIS(FHPTJ04040000)�θ� �����Ѵ�."""
    market_db = market_cfg['db']
    if not has_kis:
        logger.warning('investor_trend[%s] KIS credentials unavailable; keeping existing KIS cache', market_db)
        return
    try:
        refresh_recent_kis(kis_appkey, kis_appsecret, market_db, market_cfg['kis_iscd'], market_cfg['kis_inds_cd'])
    except Exception:
        logger.exception('investor_trend[%s] refresh_recent_kis failed; keeping existing KIS cache', market_db)


def _poll_market(market_key, market_cfg, kis_appkey, kis_appsecret, kiwoom_appkey, kiwoom_secretkey, state):
    """���� �ϳ��� ���� KIS �ʱ� ����(1ȸ) + "����" ����(�� tick)."""
    has_kis = bool(kis_appkey and kis_appsecret)
    market_db = market_cfg['db']

    if not state.get('backfilled'):
        if has_kis:
            try:
                _ensure_kis_backfill(kis_appkey, kis_appsecret, market_db, market_cfg['kis_iscd'], market_cfg['kis_inds_cd'])
            except Exception:
                logger.exception('investor_trend[%s] KIS backfill failed; keeping existing KIS cache', market_db)
        else:
            logger.warning('investor_trend[%s] KIS credentials unavailable; backfill skipped', market_db)
        state['backfilled'] = True

    # �̷¡����� ���� Ȯ��(���μ��� ���� �� 1ȸ, ����� KIS 1ȸ ȣ��). �����ϸ� ���� tick ���� �ٽ� �õ��ϵ� �ִ� 5�������� �θ���(KIS �ѵ� ��ȣ).
    if has_kis and not state.get('history_done') and state.get('history_tries', 0) < 5:
        state['history_tries'] = state.get('history_tries', 0) + 1
        try:
            if backfill_history_kis(kis_appkey, kis_appsecret, market_db, market_cfg['kis_iscd'], market_cfg['kis_inds_cd']):
                state['history_done'] = True
        except Exception:
            logger.exception('investor_trend[%s] KIS history backfill failed (try %d/5)', market_db, state['history_tries'])

    _refresh_recent_chain(market_cfg, has_kis, kis_appkey, kis_appsecret)


def _poll_loop(kis_appkey=None, kis_appsecret=None, kiwoom_appkey=None, kiwoom_secretkey=None):
    market_state = {key: {} for key in MARKETS}
    while True:
        try:
            poll_futures_observation(kis_appkey, kis_appsecret)
        except Exception:
            logger.exception('futures investor observation failed')
        for market_key, market_cfg in MARKETS.items():
            try:
                _poll_market(market_key, market_cfg, kis_appkey, kis_appsecret, kiwoom_appkey, kiwoom_secretkey,
                              market_state[market_key])
            except Exception:
                logger.exception('investor_trend[%s] poll tick failed', market_cfg['db'])
        # 2026-09-15 ���� ����: ���� ���� ���� �ð����� "����" ���� �ٲ��� �����Ƿ� 15�и��ٸ�.
        import market_clock
        time.sleep(market_clock.sleep_seconds(market_clock.kr_market_active(), _RECENT_POLL_SEC))


def start_background(kis_appkey=None, kis_appsecret=None, kiwoom_appkey=None, kiwoom_secretkey=None):
    t = threading.Thread(
        target=_poll_loop, args=(kis_appkey, kis_appsecret, kiwoom_appkey, kiwoom_secretkey),
        name='investor-trend-poll', daemon=True,
    )
    t.start()
    return t


# On-demand home futures snapshot; no new worker/timer and no equity amount conversion.
_futures_flow_lock = threading.Lock()
_futures_flow_cache = None
_futures_flow_retry_at = 0.0


def parse_futures_investors(payload):
    rows = payload.get('output') if isinstance(payload, dict) else None
    row = rows[0] if isinstance(rows, list) and len(rows) == 1 else rows if isinstance(rows, dict) else None
    if not isinstance(row, dict):
        raise ValueError('futures investor snapshot missing')
    result = {}
    for who, prefix in (('foreign', 'frgn'), ('institution', 'orgn'), ('individual', 'prsn')):
        values = []
        for suffix in ('shnu_vol', 'seln_vol', 'ntby_qty'):
            raw = row.get(prefix + '_' + suffix)
            try:
                value = float(str(raw).replace(',', '').strip())
            except (TypeError, ValueError):
                raise ValueError('futures investor quantity missing') from None
            if not math.isfinite(value) or not value.is_integer():
                raise ValueError('futures investor quantity invalid')
            values.append(int(value))
        buy, sell, net = values
        if buy < 0 or sell < 0 or buy - sell != net:
            raise ValueError('futures investor quantity inconsistent')
        result[who] = dict(buy=buy, sell=sell, net=net)
    # Other corporations are a separate top-level group; institutional subgroups
    # (securities, funds, banks, etc.) must never be added again.
    other = []
    for suffix in ('shnu_vol', 'seln_vol', 'ntby_vol'):
        try:
            value = float(str(row.get('etc_corp_' + suffix)).replace(',', '').strip())
            if not math.isfinite(value) or not value.is_integer():
                break
            other.append(int(value))
        except (TypeError, ValueError):
            break
    if len(other) == 3 and other[0] >= 0 and other[1] >= 0 and other[0] - other[1] == other[2]:
        result['other'] = dict(buy=other[0], sell=other[1], net=other[2])
    return result


def futures_activity_details(participants):
    """Validate gross contracts independently of the legacy net-only observations."""
    checked = {}
    for key in ('foreign', 'institution', 'individual', 'other'):
        row = (participants or {}).get(key) or {}
        values = [row.get(field) for field in ('buy', 'sell', 'net')]
        if any(isinstance(v, bool) or not isinstance(v, int) for v in values):
            continue
        buy, sell, net = values
        if buy >= 0 and sell >= 0 and buy - sell == net:
            checked[key] = dict(buy=buy, sell=sell, net=net)
    complete = len(checked) == 4
    buys = sum(row['buy'] for row in checked.values())
    sells = sum(row['sell'] for row in checked.values())
    matched = complete and buys == sells
    return dict(participants=checked, totalContracts=buys if matched else None,
                totalStatus='complete' if matched else 'unbalanced' if complete else 'incomplete',
                totalBasis='all-investor-buy-equals-sell')


def get_futures_result(appkey=None, appsecret=None):
    global _futures_flow_cache, _futures_flow_retry_at
    with _futures_flow_lock:
        now = time.monotonic()
        if now < _futures_flow_retry_at:
            return dict(_futures_flow_cache) if _futures_flow_cache else dict(
                available=False, stale=True, unit='contracts', market='K2I', category='F001')
        try:
            if not appkey or not appsecret:
                raise ValueError('futures investor credentials unavailable')
            token = kis_client.get_token(appkey, appsecret)
            participants = parse_futures_investors(kis_client.fetch_futures_investors(token, appkey, appsecret))
            _futures_flow_cache = dict(available=True, stale=False, unit='contracts', market='K2I', category='F001',
                scope='KOSPI200 futures whole market', **futures_activity_details(participants),
                retrievedAt=datetime.now(KST).isoformat(timespec='seconds'),
                sourceDate=None, sourceTime=None, provisional=True)
            _futures_flow_retry_at = now + 300
        except Exception:
            _futures_flow_retry_at = now + 30
            if _futures_flow_cache:
                _futures_flow_cache = dict(_futures_flow_cache, stale=True)
        return dict(_futures_flow_cache) if _futures_flow_cache else dict(
            available=False, stale=True, unit='contracts', market='K2I', category='F001')


def capture_futures_observation(snapshot, now=None):
    """Persist only fresh in-session server observations, never historical reconstruction."""
    import market_clock
    now = (now or datetime.now(KST)).astimezone(KST)
    minute = now.hour * 60 + now.minute
    if not 525 <= minute <= 945 or not market_clock.is_kr_trading_day(now):
        return False
    if not snapshot.get('available') or snapshot.get('stale'):
        return False
    try:
        stamp = datetime.fromisoformat(snapshot['retrievedAt'])
        if stamp.tzinfo is None or stamp.astimezone(KST).date() != now.date() or not 0 <= (now-stamp).total_seconds() <= 60:
            return False
        values = [snapshot['participants'][key]['net'] for key in ('foreign','institution','individual')]
        if any(isinstance(v,bool) or not isinstance(v,int) for v in values):
            return False
    except (KeyError,TypeError,ValueError):
        return False
    conn = db_schema.get_conn()
    try:
        details = futures_activity_details(snapshot.get('participants'))
        # Old net-only rows stay null: gross quantities cannot be reconstructed.
        details_json = json.dumps(details, separators=(',', ':')) if all(
            key in details['participants'] and details['participants'][key]['net'] == values[i]
            for i, key in enumerate(('foreign', 'institution', 'individual'))) else None
        conn.execute('INSERT OR IGNORE INTO futures_flow_observations '
            '(session,observed_ts,foreign_net,institution_net,individual_net,details_json) VALUES (?,?,?,?,?,?)',
            (now.strftime('%Y-%m-%d'),int(stamp.timestamp()),*values,details_json))
        conn.execute('DELETE FROM futures_flow_observations WHERE session < ?',((now-timedelta(days=14)).strftime('%Y-%m-%d'),))
        conn.commit()
    finally:
        conn.close()
    return True


def poll_futures_observation(appkey=None, appsecret=None, now=None):
    import market_clock
    observed_now = now
    now = (now or datetime.now(KST)).astimezone(KST)
    if not 525 <= now.hour*60+now.minute <= 945 or not market_clock.is_kr_trading_day(now):
        return False
    return capture_futures_observation(get_futures_result(appkey,appsecret),observed_now)


def get_futures_history():
    conn = db_schema.get_conn()
    try:
        rows = conn.execute('SELECT session,observed_ts,foreign_net,institution_net,individual_net,details_json '
            'FROM futures_flow_observations WHERE session=(SELECT MAX(session) FROM futures_flow_observations) '
            'ORDER BY observed_ts LIMIT 200').fetchall()
        observations = []
        for row in rows:
            item = dict(ts=row[1], foreign=row[2], institution=row[3], individual=row[4])
            try:
                detail = json.loads(row[5]) if row[5] else {}
                validated = futures_activity_details(detail.get('participants'))
                item.update(validated)
            except (TypeError, ValueError, AttributeError):
                item.update(totalContracts=None, participants={}, totalStatus='incomplete')
            observations.append(item)
        return dict(historyDate=rows[0][0] if rows else None,
            observations=observations,
            observationBasis='server-retrieval-time',observationIntervalMinutes=5)
    finally:
        conn.close()

