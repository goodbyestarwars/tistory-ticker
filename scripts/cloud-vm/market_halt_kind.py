# -*- coding: utf-8 -*-
"""시장 전체 사이드카·서킷브레이커 수신 - 한국거래소 KIND "오늘의 공시"의 시장조치 공시 (2026-10-15 사용자 승인).

출처: https://kind.krx.co.kr/disclosure/todaydisclosure.do (한국거래소 상장공시시스템 KIND, 공개 페이지)
  - 목록: POST method=searchTodayDisclosureSub (제목·분 단위 시각·접수번호·제출인)
  - 본문: /common/disclsviewer.do?method=search → searchContents → /external/.../*.htm (초 단위 발동시각·지수 변동·지속시간)
  제출인이 '유가증권시장본부'·'코스닥시장본부'인 공시만 쓴다('파생상품시장본부'의 가격제한폭·CB 연동 공시는 시장 전체 조치가 아니라 제외).

수집 가능 항목(2026-10-15 실측): 서킷브레이커 발동(1~3단계, 초 단위 시각, 지수·등락률)·거래재개(CB 해제 시각), 사이드카 발동(매도/매수, 초 단위 시각, 선물 등락률,
'향후 5분간' 지속). 사이드카 해제 공시는 따로 없고 공시 본문의 지속시간(5분)이 지나면 자동 해제되므로 "발동 후 N분 경과"로 계산해 표시한다(출처 표기).
VI는 이 경로로 제공되지 않는다(KRX 정보데이터시스템 VI 현황은 로그인이 필요 - 응답 LOGOUT). VI는 기존 KIS 경로를 그대로 쓴다.

지연·주기: KIND에 공시가 오르는 시점까지의 지연은 확인하지 못했고(발동 시각과 목록 시각 차이는 실측 1분 이내), 이 모듈은 평일 08:50~16:10에 30초마다 목록 1쪽을 확인하므로
화면 반영은 '공시 게시 + 최대 약 30초'다. 실시간 체결 데이터가 아니라 공시 기준이며 화면에도 그렇게 표시한다. 요청은 목록 1건/30초 + 새 시장조치 공시당 3건뿐이다.
이용 조건: KRX 법적고지는 사전 동의 없는 복제·전송·배포를 금지한다 - 원문을 옮기지 않고 사실 항목(시장·종류·단계·시각·등락률)만 쓰며 출처와 링크를 표시한다(docs/MARKET_HALT_KIND.md).
"""
import html as htmllib
import logging
import re
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

import circuit_breaker

logger = logging.getLogger('market_halt_kind')

KST = timezone(timedelta(hours=9))
LIST_URL = 'https://kind.krx.co.kr/disclosure/todaydisclosure.do'
VIEW_URL = 'https://kind.krx.co.kr/common/disclsviewer.do'
SOURCE_LABEL = '한국거래소 KIND 시장조치 공시'
SOURCE_URL = 'https://kind.krx.co.kr/disclosure/todaydisclosure.do?method=searchTodayDisclosureMain'
UA = 'Mozilla/5.0 (compatible; market-halt-monitor; +https://ghlee.tistory.com)'
POLL_SEC = 30
IDLE_SEC = 60
WINDOW_START_MIN = 8 * 60 + 50
WINDOW_END_MIN = 16 * 60 + 10
PAGE_SIZE = 100
DETAIL_GAP_SEC = 0.2      # 본문 조회 사이 간격(공개 서버 부담 최소화)
MAX_PAGES = 8
SUBMITTER_MARKET = {'유가증권시장본부': 'KOSPI', '코스닥시장본부': 'KOSDAQ'}

_ROW_TIME = re.compile(r'<td class="first txc">\s*(\d{1,2}:\d{2})\s*</td>')
_ROW_TITLE = re.compile(r"openDisclsViewer\('(\d+)',''\)\"\s*title='([^']*)'")
_CELLS = re.compile(r'<td>([^<]*)</td>')
_STAGE = re.compile(r'(\d)\s*단계\s*CB', re.I)
_FULL_TS = re.compile(r'(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})')
_KOR_TS = re.compile(r'(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(\d{1,2})시\s*(\d{1,2})분\s*(\d{1,2})초')
_MINUTES = re.compile(r'향후\s*(\d+)\s*분간')
_CHANGE = re.compile(r'등락율\(%\)\s*(?:[^\d\-+]*?)([\d,\.]+)\s+([\d,\.]+)\s+(-?[\d,\.]+)\s+(-?[\d,\.]+)')

_lock = threading.Lock()
_rows = {}            # 접수번호 -> 시장 전체 조치로 분류된 목록 행(최신 1쪽만 볼 때도 이전 이벤트를 잃지 않도록 하루 동안 누적)
_docs = {}            # 접수번호 -> 파싱 결과(None = 시장조치 아님/실패해도 다시 안 받음) - 같은 공시를 두 번 내려받지 않는다
_state = {'date': None, 'primed': False, 'last_ok': None, 'last_error': None}
_thread = None


def default_getter(url, data=None):
    req = urllib.request.Request(url, data=data, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=20) as res:
        raw = res.read()
    for enc in ('utf-8', 'euc-kr'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode('utf-8', errors='replace')


def parse_list(page_html):
    """목록 HTML → [{acptno, hhmm, title, submitter}]."""
    rows = []
    for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', page_html or '', re.S):
        t, title = _ROW_TIME.search(tr), _ROW_TITLE.search(tr)
        if not t or not title:
            continue
        cells = _CELLS.findall(tr)
        rows.append({'acptno': title.group(1), 'hhmm': t.group(1), 'title': htmllib.unescape(title.group(2)).strip(),
                     'submitter': htmllib.unescape(cells[-1]).strip() if cells else ''})
    return rows


def classify(title, submitter):
    """시장 전체 조치 공시인지 가른다. 파생상품시장본부·개별 회사 공시는 None.
    반환: {'role': 'START'|'END', 'kind', 'market', 'stage', 'direction'}"""
    market = SUBMITTER_MARKET.get(submitter)
    if not market:
        return None
    if re.search(r'CB\s*해제', title) and '재개' in title:
        return {'role': 'END', 'kind': 'CIRCUIT_BREAKER', 'market': market, 'stage': None, 'direction': None}
    m = _STAGE.search(title)
    if m and '발동' in title and ('중단' in title or '종료' in title) and int(m.group(1)) in (1, 2, 3):
        return {'role': 'START', 'kind': 'CIRCUIT_BREAKER', 'market': market, 'stage': int(m.group(1)), 'direction': None}
    if re.search(r'(side\s*car|사이드카)', title, re.I) and '발동' in title:
        direction = 'SELL' if '매도' in title else ('BUY' if '매수' in title else None)
        return {'role': 'START', 'kind': 'SIDECAR', 'market': market, 'stage': None, 'direction': direction}
    return None


def _num(text):
    try:
        return float(str(text).replace(',', ''))
    except ValueError:
        return None


def parse_body(text):
    """공시 본문 텍스트 → {'at': 발동/재개 시각(KST, 초 단위), 'minutes': 지속분, 'change_pct', 'index_value'}. 시각을 못 읽으면 at=None."""
    at = None
    for rx in (_FULL_TS, _KOR_TS):
        m = rx.search(text or '')
        if m:
            y, mo, d, hh, mi, ss = (int(x) for x in m.groups())
            try:
                at = datetime(y, mo, d, hh, mi, ss, tzinfo=KST)
            except ValueError:
                at = None
            break
    mins = _MINUTES.search(text or '')
    chg = _CHANGE.search(text or '')
    return {'at': at, 'minutes': int(mins.group(1)) if mins else None,
            'index_value': _num(chg.group(1)) if chg else None, 'change_pct': _num(chg.group(4)) if chg else None}


def body_text(page_html):
    page_html = re.sub(r'(?is)<style.*?</style>', ' ', page_html or '')
    page_html = re.sub(r'(?is)<script.*?</script>', ' ', page_html)
    return re.sub(r'\s+', ' ', htmllib.unescape(re.sub(r'<[^>]+>', ' ', page_html))).strip()


def fetch_doc_text(acptno, getter):
    """접수번호 → 공시 본문 텍스트(2단계 조회: 뷰어에서 문서번호, 문서번호로 본문 경로)."""
    view = getter('%s?method=search&acptno=%s&docno=&viewerhost=&viewerport=' % (VIEW_URL, acptno))
    m = re.search(r"<option value='(\d+)\|[YN]'", view)
    if not m:
        raise ValueError('문서번호 없음 %s' % acptno)
    contents = getter('%s?method=searchContents&docNo=%s' % (VIEW_URL, m.group(1)))
    p = re.search(r"setPath\('[^']*','([^']*)'", contents)
    if not p:
        raise ValueError('본문 경로 없음 %s' % acptno)
    return body_text(getter(p.group(1)))


def _hhmm_dt(day, hhmm):
    try:
        h, m = (int(x) for x in hhmm.split(':'))
        return datetime(day.year, day.month, day.day, h, m, tzinfo=KST)
    except ValueError:
        return None


def build_events(rows, now_kst, getter, docs=None):
    """시장조치 공시 목록에서 화면용 이벤트를 만든다(발동은 본문에서 초 단위 시각을 읽고, 재개 공시는 가장 가까운 앞선 같은 시장 CB에 연결한다)."""
    docs = _docs if docs is None else docs
    starts, ends = [], []
    for row in sorted(rows, key=lambda r: r['acptno']):
        info = classify(row['title'], row['submitter'])
        if not info:
            continue
        if row['acptno'] not in docs:
            try:
                parsed = parse_body(fetch_doc_text(row['acptno'], getter))
            except Exception as exc:
                logger.info('시장조치 본문 조회 실패 %s: %s', row['acptno'], exc)
                continue                       # 다음 주기에 다시 시도(캐시하지 않는다)
            time.sleep(DETAIL_GAP_SEC)
            docs[row['acptno']] = parsed
        parsed = docs[row['acptno']]
        at, precision = parsed['at'], 'second'
        if at is None:
            at, precision = _hhmm_dt(now_kst, row['hhmm']), 'minute'
        if at is None:
            continue
        item = dict(info, id=row['acptno'], at=at, precision=precision, parsed=parsed, title=row['title'])
        (starts if info['role'] == 'START' else ends).append(item)
    events = []
    for s in sorted(starts, key=lambda x: x['at']):
        e = {'id': s['id'], 'market': s['market'], 'kind': s['kind'], 'stage': s['stage'], 'status': 'active', 'triggered_at': s['at'].isoformat(),
             'released_at': None, 'resumed_at': None, 'direction': s['direction'], 'time_precision': s['precision'],
             'change_pct': s['parsed']['change_pct'], 'index_value': s['parsed']['index_value'], 'source_id': s['id']}
        if s['kind'] == 'SIDECAR':
            minutes = s['parsed']['minutes'] or 5
            e['ends_at'] = (s['at'] + timedelta(minutes=minutes)).isoformat()      # 공시 본문의 '향후 N분간' 지속시간
        events.append(e)
    for r in sorted(ends, key=lambda x: x['at']):
        target = None
        for e in events:
            if e['kind'] == 'CIRCUIT_BREAKER' and e['market'] == r['market'] and e['status'] == 'active' and e['triggered_at'] <= r['at'].isoformat():
                target = e                       # 재개 시각 이전에 발동한 가장 최근 CB
        if target:
            target['status'] = 'resumed'
            target['resumed_at'] = r['at'].isoformat()
    return events


def fetch_rows(now_kst, getter, first_run):
    """오늘의 공시 목록. 처음(재시작 직후)에는 하루치를 모두, 이후에는 최신 1쪽만 확인한다."""
    rows = []
    for page in range(1, (MAX_PAGES if first_run else 1) + 1):
        body = urllib.parse.urlencode({
            'method': 'searchTodayDisclosureSub', 'currentPageSize': PAGE_SIZE, 'pageIndex': page, 'orderMode': 0, 'orderStat': 'D',
            'forward': 'todaydisclosure_sub', 'chose': 'S', 'todayFlag': 'Y', 'selDate': now_kst.strftime('%Y-%m-%d')}).encode('utf-8')
        page_rows = parse_list(getter(LIST_URL, body))
        rows.extend(page_rows)
        if len(page_rows) < PAGE_SIZE:
            break
    return rows


def poll_once(now_kst=None, getter=None):
    """한 번 확인하고 circuit_breaker에 넣는다. 반환: 이벤트 목록(실패 시 None - 직전 이벤트는 그대로 두고 수신 시각도 갱신하지 않는다)."""
    now_kst = now_kst or datetime.now(KST)
    getter = getter or default_getter
    today = now_kst.strftime('%Y-%m-%d')
    with _lock:
        if _state['date'] != today:
            _state.update({'date': today, 'primed': False, 'last_ok': None, 'last_error': None})
            _docs.clear()
            _rows.clear()
        first_run = not _state['primed']
    try:
        rows = fetch_rows(now_kst, getter, first_run)
        if not rows and first_run and now_kst.hour >= 10:
            raise ValueError('오늘의 공시 목록이 비어 있음(응답 형식 변경 가능성)')
        for row in rows:
            if classify(row['title'], row['submitter']):
                _rows[row['acptno']] = row
        events = build_events(list(_rows.values()), now_kst, getter)
    except Exception as exc:
        with _lock:
            _state['last_error'] = str(exc)[:200]
        circuit_breaker.set_halt_error(str(exc)[:200])
        logger.info('KIND 시장조치 조회 실패: %s', exc)
        return None
    with _lock:
        _state.update({'primed': True, 'last_ok': now_kst.isoformat(timespec='seconds'), 'last_error': None})
    circuit_breaker.ingest_market_halt(events, SOURCE_LABEL, now_kst, source_url=SOURCE_URL, refresh_sec=POLL_SEC)
    return events


def in_window(now_kst):
    import market_clock
    if not market_clock.is_kr_trading_day(now_kst):
        return False
    minutes = now_kst.hour * 60 + now_kst.minute
    return WINDOW_START_MIN <= minutes <= WINDOW_END_MIN


def _loop():
    import market_clock
    while True:
        now_kst = datetime.now(KST)
        try:
            if in_window(now_kst):
                poll_once(now_kst)
                time.sleep(POLL_SEC)
                continue
            # 장 마감 뒤 재시작했을 때도 오늘 이력을 한 번 받아 둔다(그날 아직 수신한 적이 없으면)
            with _lock:
                got_today = _state['date'] == now_kst.strftime('%Y-%m-%d') and _state['last_ok']
            minutes = now_kst.hour * 60 + now_kst.minute
            if market_clock.is_kr_trading_day(now_kst) and minutes > WINDOW_END_MIN and not got_today:
                poll_once(now_kst)
        except Exception:
            logger.exception('KIND 시장조치 루프 오류')
        time.sleep(IDLE_SEC)


def start_background():
    global _thread
    with _lock:
        if _thread is not None and _thread.is_alive():
            return _thread
        _thread = threading.Thread(target=_loop, name='market-halt-kind', daemon=True)
        _thread.start()
    return _thread
