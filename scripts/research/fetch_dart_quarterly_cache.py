# -*- coding: utf-8 -*-
"""상승 구간 해부 3단계: DART 분기 실적 캐시 (연구 전용, 운영 DB·주문과 무관 - 2026-11-19 사용자 승인).

DART 다중회사 주요계정(fnlttMultiAcnt, 한 번에 최대 100개 회사)으로 2020~2026 분기·반기·사업보고서의
매출액·영업이익·당기순이익(3개월/누적/전년 같은 기간)을 받는다. 공통 VM 모듈 scripts/cloud-vm/dart_client.py의
전송(_fetch)과 종목코드->corp_code 매핑(get_corp_code_map)을 재사용하고 VM 코드는 바꾸지 않는다.

관측 가능 시점: DART 접수번호 앞 8자리(접수일)를 '알 수 있게 된 날'로 쓴다. 정기보고서 접수일은 잠정실적
(공정공시)보다 늦으므로 보수적이다(발표 직후 반응은 놓치지만 미래 참조는 없다). 연구 쪽은 접수일 '다음 날'부터 쓴다.
4분기 3개월 값 = 사업보고서 연간 - 3분기 보고서 누적(같은 사업연도·같은 연결/별도 구분). 없으면 결측(0으로 채우지 않는다).

실행:
  1) 수집  python fetch_dart_quarterly_cache.py fetch <작업 폴더(cache/ 포함)>   키: 환경변수 DART_API_KEY (출력·저장하지 않음)
     원본 응답은 <작업 폴더>/dart_raw/<연도>_<보고서>_<묶음>.json 에 저장, 있으면 건너뛴다(이어받기). 호출 간격 0.6초.
  2) 정리  python fetch_dart_quarterly_cache.py build <작업 폴더>  -> <작업 폴더>/earn.json
     {종목코드: [[가용일, 사업연도, 보고서, 연결/별도, 매출3m, 매출3m전년, 영업이익3m, 영업이익3m전년, 순이익3m, 순이익3m전년], ...]}
"""
import json
import os
import sys
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'cloud-vm'))

YEARS = range(2020, 2027)
REPORTS = ('11013', '11012', '11014', '11011')  # 1분기, 반기, 3분기, 사업보고서
BATCH = 100
SLEEP = 0.6
ACCOUNTS = {'rev': ('매출액', '수익(매출액)', '영업수익'), 'op': ('영업이익', '영업이익(손실)'), 'ni': ('당기순이익', '당기순이익(손실)')}


def num(v):
    s = str(v or '').replace(',', '').strip()
    if s in ('', '-'):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def account_key(name):
    n = (name or '').replace(' ', '')
    for k, names in ACCOUNTS.items():
        if n in names:
            return k
    return None


def fetch(lab):
    import dart_client
    key = os.environ.get('DART_API_KEY', '').strip()
    if not key:
        raise SystemExit('DART_API_KEY 없음')
    codes = sorted(f[:6] for f in os.listdir(os.path.join(lab, 'cache')) if f.endswith('.json'))
    cmap = dart_client.get_corp_code_map(key)
    corps = [cmap[c] for c in codes if c in cmap]
    print('종목', len(codes), 'corp_code 매핑', len(corps), flush=True)
    raw_dir = os.path.join(lab, 'dart_raw')
    os.makedirs(raw_dir, exist_ok=True)
    calls = 0
    for y in YEARS:
        for rc in REPORTS:
            for b in range(0, len(corps), BATCH):
                out = os.path.join(raw_dir, '%d_%s_%03d.json' % (y, rc, b // BATCH))
                if os.path.exists(out):
                    continue
                url = dart_client.BASE_URL + '/fnlttMultiAcnt.json?' + urllib.parse.urlencode(
                    {'crtfc_key': key, 'corp_code': ','.join(corps[b:b + BATCH]), 'bsns_year': str(y), 'reprt_code': rc})
                for attempt in range(4):
                    try:
                        data = json.loads(dart_client._fetch(url).decode('utf-8'))
                        break
                    except Exception as e:  # 네트워크 오류는 재시도, 키는 메시지에 넣지 않는다
                        print('재시도', y, rc, b // BATCH, type(e).__name__, flush=True)
                        time.sleep(5 * (attempt + 1))
                else:
                    raise SystemExit('반복 실패 %d %s %d' % (y, rc, b // BATCH))
                calls += 1
                st = data.get('status')
                if st not in ('000', '013'):
                    msg = data.get('message') or ''
                    raise SystemExit('DART status %s %s (%d %s %d) - 한도/오류로 중단, 다시 실행하면 이어받는다' % (st, msg, y, rc, b // BATCH))
                tmp = out + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump({'status': st, 'list': data.get('list') or []}, f, ensure_ascii=False)
                os.replace(tmp, out)
                time.sleep(SLEEP)
            print('완료', y, rc, '누적 호출', calls, flush=True)
    print('DONE fetch', calls, flush=True)


def build_rows(lists):
    """원본 행 목록들 -> {종목: [[가용일, 연도, 보고서, fs, rev, rev_p, op, op_p, ni, ni_p], ...]} (가용일 오름차순).
    분기(11013/11012/11014)는 3개월 값(thstrm/frmtrm_amount), 사업보고서는 연간 - 3분기 누적으로 4분기 3개월을 만든다.
    연결(CFS)이 있으면 연결, 없으면 별도(OFS)."""
    rec = {}  # (code, year, rc, fs) -> {'dt':, 'k': {acc: (cur, prev, cur_add, prev_add)}}
    for L in lists:
        for r in L:
            k = account_key(r.get('account_nm'))
            code = (r.get('stock_code') or '').strip()
            if not k or not code or r.get('sj_div') not in ('IS', 'CIS', None, ''):
                continue
            key = (code, int(r['bsns_year']), r['reprt_code'], r.get('fs_div'))
            e = rec.setdefault(key, {'dt': str(r.get('rcept_no') or '')[:8], 'k': {}})
            if k not in e['k']:
                e['k'][k] = (num(r.get('thstrm_amount')), num(r.get('frmtrm_amount')),
                             num(r.get('thstrm_add_amount')), num(r.get('frmtrm_add_amount')))
    out = {}
    for (code, y, rc, fs), e in rec.items():
        if fs == 'OFS' and (code, y, rc, 'CFS') in rec:
            continue
        if not (len(e['dt']) == 8 and e['dt'].isdigit()):
            continue
        vals = []
        for acc in ('rev', 'op', 'ni'):
            cur, prev = (e['k'].get(acc) or (None, None, None, None))[:2]
            if rc == '11011':
                q3 = rec.get((code, y, '11014', fs))
                q3v = (q3 or {}).get('k', {}).get(acc)
                cur = cur - q3v[2] if cur is not None and q3v and q3v[2] is not None else None
                prev = prev - q3v[3] if prev is not None and q3v and q3v[3] is not None else None
            vals += [cur, prev]
        out.setdefault(code, []).append([e['dt'], y, rc, fs] + vals)
    for code in out:
        out[code].sort(key=lambda x: (x[0], x[1], x[2]))
    return out


def build(lab):
    raw_dir = os.path.join(lab, 'dart_raw')
    lists = []
    for fn in sorted(os.listdir(raw_dir)):
        if fn.endswith('.json'):
            lists.append(json.load(open(os.path.join(raw_dir, fn), encoding='utf-8')).get('list') or [])
    rows = build_rows(lists)
    tmp = os.path.join(lab, 'earn.json.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(rows, f, ensure_ascii=False)
    os.replace(tmp, os.path.join(lab, 'earn.json'))
    n = sum(len(v) for v in rows.values())
    op = sum(1 for v in rows.values() for r in v if r[6] is not None and r[7] is not None)
    print('DONE build 종목', len(rows), '보고서', n, '영업이익 3개월·전년 모두 있음', op, flush=True)


if __name__ == '__main__':
    {'fetch': fetch, 'build': build}[sys.argv[1]](sys.argv[2])
