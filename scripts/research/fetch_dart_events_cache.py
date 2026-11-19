# -*- coding: utf-8 -*-
"""상승 구간 해부 4단계: DART 공시 사건 캐시 (연구 전용, 운영 DB·주문과 무관 - 2026-11-19 사용자 승인).

DART 공시검색(list.json)으로 거래소 수시공시(I001)·공정공시(I002) 목록을 분기 창(회사 미지정 검색 최대 3개월)으로 받는다.
공시 원문은 받지 않는다(건마다 호출이 늘어나므로). 내용 대신 연구 쪽에서 공시 전후 2일 주가 반응을 쓴다.
공통 VM 모듈 scripts/cloud-vm/dart_client.py의 전송(_fetch)을 재사용하고 VM 코드는 바꾸지 않는다.

사건 분류(report_nm, 정정·첨부·해지 제외 - '['로 시작하는 정정류는 같은 사건의 중복):
  earn      영업(잠정)실적(공정공시) - 연결/별도
  contract  단일판매ㆍ공급계약체결 (해지 제외)
  buyback   자기주식취득결정 (신탁계약 체결 포함)
  bonus     무상증자결정
  facility  신규시설투자등
  rights    유상증자결정 (참고: 보통 악재)
실행:
  1) 수집  python fetch_dart_events_cache.py fetch <작업 폴더>   키: 환경변수 DART_API_KEY(출력·저장 안 함)
     원본 <작업 폴더>/dart_events_raw/<유형>_<시작일>_<쪽>.json, 있으면 건너뜀(이어받기). 실행당 호출 상한 MAX_CALLS(기본 8000).
  2) 정리  python fetch_dart_events_cache.py build <작업 폴더>  -> <작업 폴더>/events.json {종목코드: [[접수일, 유형], ...]}
"""
import datetime as dt
import json
import os
import sys
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'cloud-vm'))

START, END = os.environ.get('EV_START', '20201001'), os.environ.get('EV_END', '20260831')
TYPES = ('I002', 'I001')
SLEEP = 0.3
MAX_CALLS = int(os.environ.get('MAX_CALLS', '8000'))
RULES = (('earn', ('영업(잠정)실적',)), ('contract', ('단일판매ㆍ공급계약체결', '단일판매·공급계약체결')),
         ('buyback', ('자기주식취득결정', '자기주식취득신탁계약체결결정')), ('bonus', ('무상증자결정',)),
         ('facility', ('신규시설투자등',)), ('rights', ('유상증자결정',)))


def classify(report_nm):
    n = (report_nm or '').replace(' ', '')
    if not n or n.startswith('[') or '해지' in n or '자회사' in n or '종속회사' in n:
        return None
    for kind, keys in RULES:
        if any(k in n for k in keys):
            if kind == 'bonus' and '유무상' in n:
                return None
            if kind == 'rights' and ('무상' in n):
                return None
            return kind
    return None


def windows(start, end):
    s = dt.date(int(start[:4]), int(start[4:6]), int(start[6:]))
    e = dt.date(int(end[:4]), int(end[4:6]), int(end[6:]))
    """3개월 창(회사 미지정 검색 한도). 시작일은 달의 1일로 가정."""
    while s <= e:
        k = s.month - 1 + 3
        nxt = dt.date(s.year + k // 12, k % 12 + 1, 1)
        last = min(nxt - dt.timedelta(days=1), e)
        yield s.strftime('%Y%m%d'), last.strftime('%Y%m%d')
        s = nxt


def fetch(lab):
    import dart_client
    key = os.environ.get('DART_API_KEY', '').strip()
    if not key:
        raise SystemExit('DART_API_KEY 없음')
    raw = os.path.join(lab, 'dart_events_raw')
    os.makedirs(raw, exist_ok=True)
    calls = 0
    for ty in TYPES:
        for b, e in windows(START, END):
            page, total = 1, None
            while total is None or page <= total:
                out = os.path.join(raw, '%s_%s_%03d.json' % (ty, b, page))
                if os.path.exists(out):
                    total = json.load(open(out, encoding='utf-8')).get('total_page') or 0
                    page += 1
                    continue
                if calls >= MAX_CALLS:
                    raise SystemExit('호출 상한 %d 도달 - 다시 실행하면 이어받는다' % MAX_CALLS)
                url = dart_client.BASE_URL + '/list.json?' + urllib.parse.urlencode(
                    {'crtfc_key': key, 'pblntf_detail_ty': ty, 'bgn_de': b, 'end_de': e, 'page_no': page, 'page_count': 100})
                for attempt in range(4):
                    try:
                        data = json.loads(dart_client._fetch(url).decode('utf-8'))
                        break
                    except Exception as ex:
                        print('재시도', ty, b, page, type(ex).__name__, flush=True)
                        time.sleep(5 * (attempt + 1))
                else:
                    raise SystemExit('반복 실패 %s %s %d' % (ty, b, page))
                calls += 1
                st = data.get('status')
                if st == '013':
                    data = {'status': st, 'total_page': 0, 'list': []}
                elif st != '000':
                    raise SystemExit('DART status %s %s (%s %s %d) - 다시 실행하면 이어받는다' % (st, data.get('message'), ty, b, page))
                tmp = out + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump({'status': st, 'total_page': data.get('total_page') or 0,
                               'list': [{k: r.get(k) for k in ('stock_code', 'corp_cls', 'report_nm', 'rcept_no', 'rcept_dt')}
                                        for r in data.get('list') or []]}, f, ensure_ascii=False)
                os.replace(tmp, out)
                total = data.get('total_page') or 0
                page += 1
                time.sleep(SLEEP)
            print('완료', ty, b, '쪽', total, '누적 호출', calls, flush=True)
    print('DONE fetch', calls, flush=True)


def build_events(lists, codes=None):
    """원본 목록 -> {종목: [[접수일, 유형], ...]} (접수일 오름차순, 같은 날 같은 유형은 하나)."""
    out = {}
    for L in lists:
        for r in L:
            code = (r.get('stock_code') or '').strip()
            kind = classify(r.get('report_nm'))
            d = str(r.get('rcept_dt') or '')
            if not kind or not code or (codes is not None and code not in codes) or not (len(d) == 8 and d.isdigit()):
                continue
            out.setdefault(code, set()).add((d, kind))
    return {c: [list(x) for x in sorted(v)] for c, v in out.items()}


def build(lab):
    raw = os.path.join(lab, 'dart_events_raw')
    lists = [json.load(open(os.path.join(raw, f), encoding='utf-8')).get('list') or [] for f in sorted(os.listdir(raw)) if f.endswith('.json')]
    codes = {f[:6] for f in os.listdir(os.path.join(lab, 'cache')) if f.endswith('.json')}
    ev = build_events(lists, codes)
    tmp = os.path.join(lab, 'events.json.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(ev, f, ensure_ascii=False)
    os.replace(tmp, os.path.join(lab, 'events.json'))
    cnt = {}
    for v in ev.values():
        for _, k in v:
            cnt[k] = cnt.get(k, 0) + 1
    print('DONE build 종목', len(ev), '사건', cnt, flush=True)


if __name__ == '__main__':
    {'fetch': fetch, 'build': build}[sys.argv[1]](sys.argv[2])
