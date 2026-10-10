# -*- coding: utf-8 -*-
"""키움 REST API 최소 클라이언트(조회 전용). 주문 함수는 이 프로그램에 아예 없다.

토큰 발급(/oauth2/token), 일봉(ka10081), 분봉(ka10080)만 쓴다. 호출 방식은 사이트 서버(kiwoom_client.py)에서
운영 중 검증된 것과 같다. 키는 환경변수(.env)에서만 읽고 로그·파일에 남기지 않는다.
"""
import json
import os
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

# 실서버 기본값. 모의투자로 먼저 확인하려면 .env에 KIWOOM_BASE_URL=https://mockapi.kiwoom.com 을 넣는다.
BASE_URL = os.environ.get('KIWOOM_BASE_URL', 'https://api.kiwoom.com').rstrip('/')
KST = timezone(timedelta(hours=9))
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
TOKEN_REFRESH_MARGIN_SEC = 300
TOKEN_FALLBACK_TTL_SEC = 3600


def _num(value):
    try:
        return abs(float(str(value).replace(',', '').replace('+', '')))
    except (TypeError, ValueError):
        return 0.0


class KiwoomClient:
    def __init__(self, appkey, secretkey, min_gap_sec=0.35):
        if not appkey or not secretkey:
            raise ValueError('KIWOOM_APPKEY / KIWOOM_SECRETKEY 가 비어 있습니다(.env 확인)')
        # .env 는 main.py가 이 클라이언트를 만들기 직전에 읽으므로 주소도 여기서(실행 시점에) 정한다.
        self.base_url = os.environ.get('KIWOOM_BASE_URL', BASE_URL).rstrip('/')
        self._appkey = appkey
        self._secretkey = secretkey
        self._min_gap = min_gap_sec
        self._lock = threading.Lock()
        self._token = None
        self._expires_at = 0.0
        self._last_call = 0.0

    # ---- 토큰 ----
    def _issue_token(self):
        body = json.dumps({'grant_type': 'client_credentials', 'appkey': self._appkey, 'secretkey': self._secretkey}).encode('utf-8')
        req = urllib.request.Request(self.base_url + '/oauth2/token', data=body, method='POST',
                                     headers={'User-Agent': UA, 'Content-Type': 'application/json;charset=UTF-8'})
        try:
            with urllib.request.urlopen(req, timeout=15) as res:
                data = json.loads(res.read().decode('utf-8'))
        except urllib.error.HTTPError as exc:
            raise RuntimeError('토큰 발급 HTTP %s: %s' % (exc.code, exc.read().decode('utf-8', 'ignore')[:200]))
        token = data.get('token') or data.get('access_token')
        if not token:
            raise RuntimeError('토큰 발급 실패: return_code=%s return_msg=%s' % (data.get('return_code'), data.get('return_msg')))
        expires_at = time.time() + TOKEN_FALLBACK_TTL_SEC
        text = str(data.get('expires_dt') or '').strip()
        if len(text) == 14 and text.isdigit():
            try:
                expires_at = datetime.strptime(text, '%Y%m%d%H%M%S').replace(tzinfo=KST).timestamp()
            except ValueError:
                pass
        return token, expires_at

    def _get_token(self, force=False):
        if force or not self._token or time.time() >= self._expires_at - TOKEN_REFRESH_MARGIN_SEC:
            self._token, self._expires_at = self._issue_token()
        return self._token

    # ---- TR 호출 ----
    def call(self, api_id, path, body, _retried=False):
        with self._lock:
            wait = self._min_gap - (time.time() - self._last_call)
            if wait > 0:
                time.sleep(wait)
            token = self._get_token()
            req = urllib.request.Request(self.base_url + path, data=json.dumps(body).encode('utf-8'), method='POST',
                                         headers={'User-Agent': UA, 'Content-Type': 'application/json;charset=UTF-8',
                                                  'authorization': 'Bearer ' + token, 'api-id': api_id})
            try:
                with urllib.request.urlopen(req, timeout=15) as res:
                    payload = json.loads(res.read().decode('utf-8'))
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode('utf-8', 'ignore')[:200]
                self._last_call = time.time()
                if exc.code in (401, 403) and not _retried:
                    self._get_token(force=True)
                    return self.call(api_id, path, body, True)
                raise RuntimeError('%s HTTP %s: %s' % (api_id, exc.code, detail))
            self._last_call = time.time()
        # 키움은 토큰이 죽어도 HTTP 200 + return_code로 답한다(8005).
        if '8005' in str(payload.get('return_msg') or '') and not _retried:
            self._get_token(force=True)
            return self.call(api_id, path, body, True)
        return payload

    # ---- 계좌 조회 (읽기 전용) ----
    def balance(self):
        """보유 종목 목록(계좌평가잔고내역 kt00018). [{code, name, qty, sellable, avg, price}]

        ※ kt00018 요청·응답 필드명은 키움 REST 공식 규격 기준이며 이 저장소에서 실호출 검증된 값이 아니다.
          필드가 다르면 RuntimeError로 응답의 실제 키를 알려 준다(`python main.py --check`로 먼저 확인).
        """
        res = self.call('kt00018', '/api/dostk/acnt', {'qry_tp': '1', 'dmst_stex_tp': 'KRX'})
        if str(res.get('return_code', '0')) not in ('0', ''):
            raise RuntimeError('kt00018 실패: return_code=%s return_msg=%s' % (res.get('return_code'), res.get('return_msg')))
        rows = res.get('acnt_evlt_remn_indv_tot')
        if rows is None:
            raise RuntimeError('kt00018 응답에 acnt_evlt_remn_indv_tot가 없음. 응답 키: %s' % list(res.keys()))
        out = []
        for r in rows:
            code = str(r.get('stk_cd') or '').strip()
            if code[:1] in ('A', 'a') and len(code) == 7:
                code = code[1:]
            qty = int(_num(r.get('rmnd_qty')))
            if not code or qty <= 0:
                continue
            sellable = r.get('trde_able_qty')
            out.append({'code': code, 'name': str(r.get('stk_nm') or '').strip(), 'qty': qty,
                        'sellable': int(_num(sellable)) if sellable not in (None, '') else qty,
                        'avg': _num(r.get('pur_pric')), 'price': _num(r.get('cur_prc'))})
        return out

    # ---- 주문 (매도 전용. 매수 함수는 이 프로그램에 없다) ----
    def sell_market(self, code, qty):
        """시장가 매도(kt10001). 성공 여부와 주문번호를 돌려준다. 호출은 bot.py의 LIVE_SELL 검사를 통과한 경우에만 일어난다.

        ※ 요청 필드(dmst_stex_tp, stk_cd, ord_qty, trde_tp=3 시장가)는 공식 규격 기준이며 실호출 검증 전이다.
          KIWOOM_BASE_URL 을 모의투자 주소로 바꿔 먼저 확인하는 것을 권한다.
        """
        res = self.call('kt10001', '/api/dostk/ordr', {'dmst_stex_tp': 'KRX', 'stk_cd': code, 'ord_qty': str(int(qty)),
                                                      'ord_uv': '', 'trde_tp': '3', 'cond_uv': ''})
        ok = str(res.get('return_code', '')) in ('0', '')
        return {'ok': ok, 'ord_no': res.get('ord_no'), 'return_code': res.get('return_code'), 'return_msg': res.get('return_msg')}

    # ---- 조회 ----
    def daily(self, code):
        """일봉(오름차순). {date, open, high, low, close, volume}"""
        res = self.call('ka10081', '/api/dostk/chart',
                        {'stk_cd': code, 'base_dt': datetime.now(KST).strftime('%Y%m%d'), 'upd_stkpc_tp': '1'})
        rows = res.get('stk_dt_pole_chart_qry') or []
        out, seen = [], set()
        for r in rows:
            dt = r.get('dt')
            if not dt or dt in seen:
                continue
            seen.add(dt)
            out.append({'date': '%s-%s-%s' % (dt[0:4], dt[4:6], dt[6:8]), 'open': _num(r.get('open_pric')),
                        'high': _num(r.get('high_pric')), 'low': _num(r.get('low_pric')),
                        'close': _num(r.get('cur_prc')), 'volume': _num(r.get('trde_qty'))})
        out.sort(key=lambda r: r['date'])
        return out

    def last_price(self, code):
        """가장 최근 1분봉 종가와 시각. (price, 'YYYY-MM-DD HH:MM') - 없으면 (None, None)"""
        res = self.call('ka10080', '/api/dostk/chart', {'stk_cd': code, 'tic_scope': '1', 'upd_stkpc_tp': '1'})
        rows = res.get('stk_min_pole_chart_qry')
        if not rows:
            return None, None
        newest = max(rows, key=lambda r: str(r.get('cntr_tm') or r.get('dt') or ''))
        tm = str(newest.get('cntr_tm') or newest.get('dt') or '')
        price = _num(newest.get('cur_prc'))
        stamp = '%s-%s-%s %s:%s' % (tm[0:4], tm[4:6], tm[6:8], tm[8:10], tm[10:12]) if len(tm) >= 12 else None
        return (price or None), stamp
