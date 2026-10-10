# -*- coding: utf-8 -*-
"""키움 모의서버 읽기 전용 실측 도구 (2026-10-11). 주문·계좌 TR은 호출하지 않는다.

측정: 일봉/분봉 과거 조회 깊이(연속조회), 호가 TR 응답 필드, 호출 간격별 오류 여부.
안전장치: 주소가 모의서버(mockapi.kiwoom.com)가 아니면 실행을 거부한다. 키는 .env 의
KIWOOM_MOCK_APPKEY / KIWOOM_MOCK_SECRETKEY 에서만 읽고 결과 파일·화면에 남기지 않는다.
결과: probe_result.json (시세 필드 구조와 통계만 저장)
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = 'https://mockapi.kiwoom.com'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36'
CODE = '005930'
HERE = os.path.dirname(os.path.abspath(__file__))


def load_env():
    path = os.path.join(HERE, '.env')
    if os.path.exists(path):
        for line in open(path, encoding='utf-8-sig'):
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def post(path, body, headers):
    h = {'User-Agent': UA, 'Content-Type': 'application/json;charset=UTF-8'}
    h.update(headers)
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode('utf-8'), headers=h, method='POST')
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            data = json.loads(res.read().decode('utf-8'))
            return res.status, data, {k.lower(): v for k, v in res.headers.items()}, time.time() - t0
    except urllib.error.HTTPError as e:
        txt = e.read().decode('utf-8', 'ignore')[:200]
        return e.code, {'_error': txt}, {}, time.time() - t0


def main():
    load_env()
    if 'mockapi.kiwoom.com' not in BASE:
        print('모의서버가 아니므로 중단합니다.'); sys.exit(1)
    ak, sk = os.environ.get('KIWOOM_MOCK_APPKEY'), os.environ.get('KIWOOM_MOCK_SECRETKEY')
    if not ak or not sk:
        print('.env 에 KIWOOM_MOCK_APPKEY / KIWOOM_MOCK_SECRETKEY (모의투자용 키)를 넣어 주세요.'); sys.exit(1)
    out = {'host': BASE, 'startedAt': time.strftime('%Y-%m-%d %H:%M:%S'), 'tests': {}}
    st, tok, _, _ = post('/oauth2/token', {'grant_type': 'client_credentials', 'appkey': ak, 'secretkey': sk}, {})
    token = tok.get('token')
    out['tests']['token'] = {'http': st, 'ok': bool(token), 'return_code': tok.get('return_code'), 'return_msg': tok.get('return_msg') or tok.get('_error')}
    if not token:
        finish(out); return
    auth = {'authorization': 'Bearer ' + token}

    def paged(api_id, path, body, listkey, datekey, max_pages):
        rows_total, pages, oldest, newest, cont_seen, errs = 0, 0, None, None, False, []
        keys = None
        cont, nxt = '', ''
        t_all = time.time()
        for _ in range(max_pages):
            hd = dict(auth, **{'api-id': api_id})
            if cont == 'Y' and nxt:
                hd['cont-yn'], hd['next-key'] = 'Y', nxt
            st, data, hdr, dt = post(path, body, hd)
            if st != 200 or str(data.get('return_code', '0')) not in ('0', ''):
                errs.append({'http': st, 'return_code': data.get('return_code'), 'msg': str(data.get('return_msg') or data.get('_error'))[:120]})
                break
            rows = data.get(listkey) or []
            if keys is None and rows:
                keys = sorted(rows[0].keys())
            pages += 1
            rows_total += len(rows)
            for r in rows:
                v = r.get(datekey)
                if v:
                    oldest = v if oldest is None or v < oldest else oldest
                    newest = v if newest is None or v > newest else newest
            cont = str(hdr.get('cont-yn') or '').upper()
            nxt = hdr.get('next-key') or ''
            cont_seen = cont_seen or cont == 'Y'
            if cont != 'Y' or not rows:
                break
            time.sleep(0.6)
        return {'pages': pages, 'rows': rows_total, 'oldest': oldest, 'newest': newest, 'contSeen': cont_seen,
                'fields': keys, 'errors': errs, 'seconds': round(time.time() - t_all, 1)}

    out['tests']['daily'] = paged('ka10081', '/api/dostk/chart', {'stk_cd': CODE, 'base_dt': time.strftime('%Y%m%d'), 'upd_stkpc_tp': '1'},
                                  'stk_dt_pole_chart_qry', 'dt', 12)
    out['tests']['minute1'] = paged('ka10080', '/api/dostk/chart', {'stk_cd': CODE, 'tic_scope': '1', 'upd_stkpc_tp': '1'},
                                    'stk_min_pole_chart_qry', 'cntr_tm', 60)
    # 호가
    st, data, _, dt = post('/api/dostk/mrkcond', {'stk_cd': CODE}, dict(auth, **{'api-id': 'ka10004'}))
    out['tests']['orderbook'] = {'http': st, 'return_code': data.get('return_code'), 'msg': str(data.get('return_msg') or data.get('_error'))[:120],
                                 'keys': sorted(data.keys())[:60], 'seconds': round(dt, 2)}
    # 호출 간격별 오류(호가 TR, 간격마다 최대 8회, 첫 오류에서 중단)
    rate = []
    for gap in (1.0, 0.5, 0.25, 0.1):
        res = {'gap': gap, 'calls': 0, 'errors': []}
        for _ in range(8):
            st, data, _, _ = post('/api/dostk/mrkcond', {'stk_cd': CODE}, dict(auth, **{'api-id': 'ka10004'}))
            res['calls'] += 1
            if st != 200 or str(data.get('return_code', '0')) not in ('0', ''):
                res['errors'].append({'http': st, 'return_code': data.get('return_code'), 'msg': str(data.get('return_msg') or data.get('_error'))[:100]})
                break
            time.sleep(gap)
        rate.append(res)
        if res['errors']:
            break
        time.sleep(2)
    out['tests']['rate'] = rate
    finish(out)


def finish(out):
    p = os.path.join(HERE, 'probe_result.json')
    json.dump(out, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('완료: ' + p)


if __name__ == '__main__':
    main()
