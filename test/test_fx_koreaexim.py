# -*- coding: utf-8 -*-
"""한국수출입은행 환율 수집·저장·조회 테스트. 응답 샘플은 2026-10-11 실제 API 응답(2026-10-08 고시)에서 그대로 옮긴 값이다."""
import json
import os
import sys
import tempfile
import unittest
import urllib.error
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import fx_koreaexim as fx

KST = timezone(timedelta(hours=9))
FAKE_KEY = 'TESTKEY0123456789TESTKEY0123456789'


def real_row(cur_unit, nm, deal, ttb, tts, bkpr):
    return {'result': 1, 'cur_unit': cur_unit, 'ttb': ttb, 'tts': tts, 'deal_bas_r': deal, 'bkpr': bkpr, 'yy_efee_r': '0', 'ten_dd_efee_r': '0',
            'kftc_bkpr': bkpr, 'kftc_deal_bas_r': deal, 'cur_nm': nm}


# 2026-10-08 고시(실측) 중 일부 + KRW 행(값 1 / 송금환율 0)
SAMPLE = [
    real_row('CNH', '위안화', '199.71', '197.71', '201.7', '199'),
    real_row('EUR', '유로', '1,500.04', '1,485.03', '1,515.04', '1,500'),
    real_row('GBP', '영국 파운드', '1,770.02', '1,752.31', '1,787.72', '1,770'),
    real_row('IDR(100)', '인도네시아 루피아', '7.49', '7.41', '7.56', '7'),
    real_row('JPY(100)', '일본 옌', '847.46', '838.98', '855.93', '847'),
    real_row('KRW', '한국 원', '1', '0', '0', '1'),
    real_row('USD', '미국 달러', '1,339.2', '1,325.8', '1,352.59', '1,339'),
    real_row('CHF', '스위스 프랑', '1,607.97', '1,591.89', '1,624.04', '1,607'),
]


def scaled(rows, factor):
    """다른 날짜용 샘플: 모든 환율에 같은 비율을 곱한다(쉼표 문자열 형식 유지)."""
    out = []
    for r in rows:
        r = dict(r)
        for k in ('deal_bas_r', 'ttb', 'tts', 'kftc_deal_bas_r'):
            r[k] = '{:,.2f}'.format(float(r[k].replace(',', '')) * factor)
        out.append(r)
    return out


def at(y, m, d, h=0, mi=0):
    return datetime(y, m, d, h, mi, tzinfo=KST)


class ParseTests(unittest.TestCase):
    def test_cur_unit_keeps_base_unit(self):
        self.assertEqual(fx.parse_cur_unit('USD'), ('USD', 1))
        self.assertEqual(fx.parse_cur_unit('JPY(100)'), ('JPY', 100))
        self.assertEqual(fx.parse_cur_unit('IDR(100)'), ('IDR', 100))
        self.assertIsNone(fx.parse_cur_unit('JPY(0)'))
        self.assertIsNone(fx.parse_cur_unit('usd'))
        self.assertIsNone(fx.parse_cur_unit(None))

    def test_numbers_with_commas_and_zero_means_missing(self):
        self.assertEqual(fx.parse_number('1,339.2'), 1339.2)
        self.assertEqual(fx.parse_number('4,345.94'), 4345.94)
        self.assertIsNone(fx.parse_number('0'))
        self.assertIsNone(fx.parse_number(''))
        self.assertIsNone(fx.parse_number(None))
        self.assertIsNone(fx.parse_number('nan'))
        self.assertIsNone(fx.parse_number('abc'))

    def test_parse_rows_skips_krw_and_keeps_units(self):
        rows = {r['cur_unit']: r for r in fx.parse_rows(SAMPLE)}
        self.assertNotIn('KRW', {r['cur_code'] for r in rows.values()})
        self.assertEqual(rows['JPY(100)']['unit'], 100)
        self.assertEqual(rows['JPY(100)']['deal_bas_r'], 847.46)          # 100엔당 원 - 1엔으로 환산하지 않는다
        self.assertEqual(rows['USD']['ttb'], 1325.8)
        self.assertEqual(rows['USD']['tts'], 1352.59)
        self.assertEqual(rows['CNH']['cur_code'], 'CNH')                   # CNY 가 아니라 API 표기 그대로

    def test_classify_outcomes(self):
        self.assertEqual(fx.classify([])['outcome'], 'empty')                                  # 공휴일·주말
        self.assertEqual(fx.classify(SAMPLE)['outcome'], 'ok')
        self.assertEqual(fx.classify([{'result': 3, 'cur_unit': None, 'deal_bas_r': None}])['outcome'], 'auth')   # 잘못된 인증키(실측)
        self.assertEqual(fx.classify([{'result': 4}])['outcome'], 'quota')
        self.assertEqual(fx.classify([{'result': 2}])['outcome'], 'bad_request')
        self.assertEqual(fx.classify({'result': 1})['outcome'], 'format')
        self.assertEqual(fx.classify([{'result': 1, 'cur_unit': 'KRW', 'deal_bas_r': '1'}])['outcome'], 'format')


class FetchTests(unittest.TestCase):
    class FakeResponse:
        def __init__(self, body):
            self.body = body

        def read(self, n=-1):
            return self.body

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def test_fetch_builds_request_and_hides_key_in_errors(self):
        seen = {}

        def opener(req, timeout=0):
            seen['url'] = req.full_url
            return self.FakeResponse(json.dumps(SAMPLE).encode('utf-8'))
        result = fx.fetch_day('20261008', FAKE_KEY, opener=opener)
        self.assertEqual(result['outcome'], 'ok')
        self.assertTrue(seen['url'].startswith('https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON?'))
        self.assertIn('searchdate=20261008', seen['url'])
        self.assertIn('data=AP01', seen['url'])

        def boom(req, timeout=0):
            raise urllib.error.URLError('failed for %s' % req.full_url)
        result = fx.fetch_day('20261008', FAKE_KEY, opener=boom)
        self.assertEqual(result['outcome'], 'network')
        self.assertNotIn(FAKE_KEY, json.dumps(result))

        def http_error(req, timeout=0):
            raise urllib.error.HTTPError(req.full_url, 500, 'x', {}, None)
        result = fx.fetch_day('20261008', FAKE_KEY, opener=http_error)
        self.assertEqual((result['outcome'], result['detail']), ('network', 'HTTP 500'))
        self.assertNotIn(FAKE_KEY, json.dumps(result))
        bad = fx.fetch_day('20261008', FAKE_KEY, opener=lambda req, timeout=0: self.FakeResponse(b'<html>x</html>'))
        self.assertEqual(bad['outcome'], 'format')

    def test_api_key_from_env_then_dotenv_without_restart(self):
        d = tempfile.mkdtemp()
        env_file = os.path.join(d, '.env')
        self.assertIsNone(fx.api_key(env={}, env_file=env_file))
        with open(env_file, 'w', encoding='utf-8') as f:
            f.write('OTHER=1\n%s="%s"\n' % (fx.ENV_KEY, FAKE_KEY))
        self.assertEqual(fx.api_key(env={}, env_file=env_file), FAKE_KEY)
        self.assertEqual(fx.api_key(env={fx.ENV_KEY: 'FROMENV'}, env_file=env_file), 'FROMENV')
        self.assertEqual(fx.daily_budget({}), fx.DEFAULT_BUDGET)
        self.assertEqual(fx.daily_budget({'KOREAEXIM_DAILY_BUDGET': 'x'}), fx.DEFAULT_BUDGET)
        self.assertEqual(fx.daily_budget({'KOREAEXIM_DAILY_BUDGET': '5000'}), 900)


class Env:
    def __init__(self):
        self.dir = tempfile.mkdtemp()
        self.db = os.path.join(self.dir, 'fx.db')
        fx._schema_ready.discard(self.db)
        fx.ensure_schema(self.db)
        fx.clear_cache()
        self.calls = []
        self.script = {}          # 'YYYYMMDD' -> payload(list) 또는 {'outcome': ...}

    def fetch(self, date_str, key):
        self.calls.append(date_str)
        value = self.script.get(date_str, [])
        if isinstance(value, dict):
            return value
        return fx.classify(value)

    def cycle(self, now, key=FAKE_KEY, budget=300):
        conn = fx.connect(self.db)
        try:
            return fx.run_cycle(conn, now, key, fetch=self.fetch, pause=lambda s: None, budget=budget)
        finally:
            conn.close()

    def status_of(self, date_text):
        conn = fx.connect(self.db)
        try:
            row = conn.execute('SELECT status, final, rows FROM fx_dates WHERE rate_date=?', (date_text,)).fetchone()
            return tuple(row) if row else None
        finally:
            conn.close()


class CollectionTests(unittest.TestCase):
    def setUp(self):
        self.e = Env()
        self._window = fx.WINDOW_DAYS
        fx.WINDOW_DAYS = 12

    def tearDown(self):
        fx.WINDOW_DAYS = self._window

    def test_no_key_never_calls_and_reports_state(self):
        result = self.e.cycle(at(2026, 10, 12, 12), key=None)
        self.assertEqual((result['state'], result['calls']), ('no_key', 0))
        self.assertEqual(self.e.calls, [])
        snap = fx.snapshot(self.e.db, at(2026, 10, 12, 12))
        self.assertEqual(snap['state'], 'no_key')
        self.assertEqual(snap['currencies'], [])
        self.assertTrue(snap['official'])
        self.assertFalse(snap['realtime'])

    def test_before_publish_hour_only_past_days_are_requested(self):
        now = at(2026, 10, 12, 10, 30)                      # 월요일 오전 - 오늘 고시는 11시 이후에 확인한다
        self.cycle_all(now)
        self.assertNotIn('20261012', self.e.calls)

    def cycle_all(self, now, limit=10):
        for _ in range(limit):
            result = self.e.cycle(now)
            if result['calls'] == 0:
                return result
        return result

    def test_today_empty_retries_then_data_arrives_and_past_days_not_refetched(self):
        # 10-09(금, 한글날 공휴일)은 빈 응답, 10-08(목)은 데이터
        self.e.script = {'20261008': SAMPLE, '20261007': scaled(SAMPLE, 0.998), '20261006': scaled(SAMPLE, 0.996), '20261005': scaled(SAMPLE, 0.994),
                         '20261002': scaled(SAMPLE, 0.992), '20261001': scaled(SAMPLE, 0.99)}
        self.cycle_all(at(2026, 10, 12, 11, 5))             # 월요일 11:05, 오늘(10-12)은 아직 공개 전(빈 응답)
        self.assertEqual(self.e.status_of('2026-10-12'), ('EMPTY', 0, 0))                    # 오늘 빈 응답은 확정하지 않는다
        self.assertEqual(self.e.status_of('2026-10-09'), ('EMPTY', 1, 0))                    # 지난 휴일은 확정
        self.assertEqual(self.e.status_of('2026-10-08'), ('DATA', 1, 7))                     # KRW 제외 7개 통화
        self.assertEqual(self.e.status_of('2026-10-10'), ('WEEKEND', 1, 0))
        calls_after_first = list(self.e.calls)
        self.assertEqual(self.e.calls.count('20261008'), 1)
        # 5분 뒤: 재시도 간격(10분) 전이라 오늘을 다시 부르지 않는다
        self.e.calls.clear()
        self.e.cycle(at(2026, 10, 12, 11, 10))
        self.assertEqual(self.e.calls, [])
        # 11:20 - 이제 재시도한다. 이번에는 공개됨
        self.e.script['20261012'] = scaled(SAMPLE, 1.003)
        self.e.cycle(at(2026, 10, 12, 11, 20))
        self.assertEqual(self.e.calls, ['20261012'])
        self.assertEqual(self.e.status_of('2026-10-12'), ('DATA', 1, 7))
        # 이후 주기들은 과거를 다시 부르지 않는다(중복 호출 방지)
        self.e.calls.clear()
        for minute in (30, 40, 50):
            self.e.cycle(at(2026, 10, 12, 11, minute))
        self.e.cycle(at(2026, 10, 12, 15, 0))
        self.assertEqual(self.e.calls, [])
        self.assertEqual(len(calls_after_first), len(set(calls_after_first)))                # 같은 날짜를 두 번 부르지 않았다

    def test_holiday_today_stays_empty_and_is_finalized_next_day(self):
        self.e.script = {'20261008': SAMPLE}
        self.cycle_all(at(2026, 10, 9, 11, 5))              # 금요일(한글날) 11:05 - 계속 빈 응답
        self.assertEqual(self.e.status_of('2026-10-09'), ('EMPTY', 0, 0))
        n = len(self.e.calls)
        self.e.cycle(at(2026, 10, 9, 14, 0))                # 13시 이후는 1시간 간격
        self.assertEqual(len(self.e.calls), n + 1)
        self.e.cycle(at(2026, 10, 9, 14, 20))
        self.assertEqual(len(self.e.calls), n + 1)
        self.e.calls.clear()
        self.cycle_all(at(2026, 10, 12, 9, 0))              # 다음 영업일 오전: 어제(금) 빈 응답을 한 번 더 확인해 확정
        self.assertIn('20261009', self.e.calls)
        self.assertEqual(self.e.status_of('2026-10-09'), ('EMPTY', 1, 0))
        self.e.calls.clear()
        self.cycle_all(at(2026, 10, 12, 9, 30))
        self.assertNotIn('20261009', self.e.calls)          # 확정된 휴일은 다시 부르지 않는다

    def test_snapshot_change_prev_and_units(self):
        self.e.script = {'20261008': SAMPLE, '20261007': scaled(SAMPLE, 0.99)}
        self.cycle_all(at(2026, 10, 9, 12, 0))
        snap = fx.snapshot(self.e.db, at(2026, 10, 9, 12, 0))
        self.assertEqual((snap['baseDate'], snap['prevDate']), ('2026-10-08', '2026-10-07'))
        by = {c['code']: c for c in snap['currencies']}
        self.assertNotIn('KRW', by)
        usd, jpy = by['USD'], by['JPY']
        self.assertEqual((usd['unit'], usd['dealBasR'], usd['ttb'], usd['tts']), (1, 1339.2, 1325.8, 1352.59))
        self.assertEqual((jpy['unit'], jpy['curUnit'], jpy['dealBasR']), (100, 'JPY(100)', 847.46))
        prev = float('{:,.2f}'.format(1339.2 * 0.99).replace(',', ''))
        self.assertAlmostEqual(usd['prev'], prev, places=2)
        self.assertAlmostEqual(usd['change'], round(1339.2 - prev, 4), places=3)
        self.assertAlmostEqual(usd['changeRate'], round((1339.2 - prev) / prev * 100, 4), places=3)
        self.assertGreater(usd['change'], 0)
        codes = [c['code'] for c in snap['currencies']]
        self.assertEqual(codes[:6], ['USD', 'JPY', 'EUR', 'CNH', 'GBP', 'CHF'])               # 주요 통화 우선
        self.assertTrue(snap['pendingToday'])                                               # 금요일 12시: 오늘(10-09) 고시가 없다(공개 전이거나 공휴일) -> 대기 표시
        self.assertEqual(snap['coverage']['to'], '2026-10-08')

    def test_pending_today_flag_and_weekend_keeps_last_data(self):
        self.e.script = {'20261008': SAMPLE}
        self.cycle_all(at(2026, 10, 9, 12, 0))
        snap = fx.snapshot(self.e.db, at(2026, 10, 9, 12, 0))
        self.assertTrue(snap['pendingToday'])                # 영업일 11시 이후인데 오늘 고시가 없다(공휴일이거나 공개 전)
        fx.clear_cache()
        weekend = fx.snapshot(self.e.db, at(2026, 10, 11, 12, 0))
        self.assertFalse(weekend['pendingToday'])
        self.assertEqual(weekend['baseDate'], '2026-10-08')  # 주말에는 직전 정상 고시일 유지
        self.assertEqual(len(weekend['currencies']), 7)

    def test_history_ranges_and_incomplete_flag(self):
        fx.WINDOW_DAYS = 60
        base = at(2026, 10, 8)
        script = {}
        d, i = base, 0
        while i < 40:
            if d.weekday() < 5:
                script[d.strftime('%Y%m%d')] = scaled(SAMPLE, 1 + i * 0.001)
                i += 1
            d -= timedelta(days=1)
        self.e.script = script
        for _ in range(8):
            self.e.cycle(at(2026, 10, 9, 12, 0))
        hist = fx.history('USD', '1m', self.e.db)
        self.assertEqual(hist['to'], '2026-10-08')
        self.assertGreater(hist['count'], 15)
        self.assertEqual(hist['unit'], 1)
        self.assertEqual(hist['points'][-1], ['2026-10-08', 1339.2])
        self.assertTrue(all(hist['points'][k][0] < hist['points'][k + 1][0] for k in range(len(hist['points']) - 1)))
        year = fx.history('USD', '1y', self.e.db)
        self.assertTrue(year['incomplete'])                   # 1년치가 아직 없으면 실제 시작일을 알려 준다
        self.assertEqual(year['coverageFrom'], year['from'])
        jpy = fx.history('JPY', '3m', self.e.db)
        self.assertEqual((jpy['unit'], jpy['curUnit']), (100, 'JPY(100)'))
        self.assertEqual(fx.history('ZZZ', '3m', self.e.db)['points'], [])
        with self.assertRaises(ValueError):
            fx.history('usd; drop', '3m', self.e.db)
        with self.assertRaises(ValueError):
            fx.history('USD', '5y', self.e.db)

    def test_error_outcomes_back_off_and_do_not_lose_data(self):
        self.e.script = {'20261008': SAMPLE}
        self.cycle_all(at(2026, 10, 9, 12, 0))
        self.e.script = {'20261012': {'outcome': 'network', 'detail': 'URLError'}}
        result = self.e.cycle(at(2026, 10, 12, 11, 30))
        self.assertEqual(result['state'], 'error')
        self.assertEqual(result['sleep'], fx.ERROR_BACKOFF_SEC)
        snap = fx.snapshot(self.e.db, at(2026, 10, 12, 11, 30))
        self.assertEqual(snap['state'], 'network_error')
        self.assertEqual(snap['baseDate'], '2026-10-08')                               # 직전 정상 데이터 유지
        self.assertEqual(len(snap['currencies']), 7)
        self.e.script = {'20261012': {'outcome': 'auth', 'detail': 'result=3'}}
        fx.clear_cache()
        result = self.e.cycle(at(2026, 10, 12, 12, 0))
        self.assertEqual((result['state'], result['sleep']), ('auth', fx.AUTH_BACKOFF_SEC))
        self.assertEqual(fx.snapshot(self.e.db, at(2026, 10, 12, 12, 0))['state'], 'auth_error')

    def test_quota_stops_for_the_day_and_budget_limits_calls(self):
        self.e.script = {'20261008': {'outcome': 'quota', 'detail': 'result=4'}}
        result = self.e.cycle(at(2026, 10, 9, 12, 0))
        self.assertEqual(result['state'], 'quota')
        n = len(self.e.calls)
        again = self.e.cycle(at(2026, 10, 9, 13, 0))
        self.assertEqual((again['state'], len(self.e.calls)), ('quota', n))               # 같은 날은 더 부르지 않는다
        self.assertEqual(fx.snapshot(self.e.db, at(2026, 10, 9, 13, 0))['state'], 'quota')
        e2 = Env()
        result = e2.cycle(at(2026, 10, 9, 12, 0), budget=3)
        self.assertEqual(len(e2.calls), 3)
        self.assertEqual(result['state'], 'budget')
        self.assertEqual(e2.cycle(at(2026, 10, 9, 12, 5), budget=3)['calls'], 0)           # 예산 소진 후 호출 없음
        e2.cycle(at(2026, 10, 10, 12, 0), budget=3)                                        # 다음 날 예산 갱신
        self.assertGreater(len(e2.calls), 3)

    def test_per_cycle_cap(self):
        fx.WINDOW_DAYS = 100
        result = self.e.cycle(at(2026, 10, 12, 9, 0))
        self.assertEqual(result['calls'], fx.MAX_PER_CYCLE)
        self.assertEqual(result['sleep'], fx.BACKFILL_SEC)


class StaticContractTests(unittest.TestCase):
    """공개 파일(JS·CSS·skin.html·문서)에 인증키가 없고, 탭이 기존 구조에 등록돼 있는지 정적으로 확인한다."""
    ROOT = os.path.dirname(os.path.dirname(__file__))

    def read(self, rel):
        with open(os.path.join(self.ROOT, rel), encoding='utf-8') as f:
            return f.read()

    def test_no_key_in_public_assets(self):
        for rel in ('js/fx-rates.js', 'css/fx-rates.css', 'js/skin-main.js', 'skin.html', 'scripts/cloud-vm/fx_koreaexim.py', 'test/fx-rates.html'):
            text = self.read(rel)
            self.assertNotRegex(text, r'authkey=[A-Za-z0-9]{20,}', rel)                  # 키가 박힌 요청 주소가 없다
            self.assertNotRegex(text, r'KOREAEXIM_API_KEY\s*=\s*[A-Za-z0-9]{20,}', rel)   # 키 값이 대입된 곳이 없다
        self.assertNotIn('KOREAEXIM_API_KEY', self.read('js/fx-rates.js'))

    def test_tab_registered_without_skin_change(self):
        main = self.read('js/skin-main.js')
        self.assertIn("key: 'fx', label: '환율', slug: 'fx-rates'", main)
        self.assertIn("mountIds: ['fx-rates']", main)
        self.assertIn("globalName: 'FxRates'", main)
        for key in ("key: 'domestic'", "key: 'global'", "key: 'us-macro'", "key: 'crypto'"):
            self.assertIn(key, main)                                                   # 기존 4개 탭 유지
        self.assertNotIn('fx-rates', self.read('skin.html'))                           # 스킨 HTML 수동 반영이 필요 없다

    def test_routes_are_public_get_only_and_read_db_only(self):
        main = self.read('scripts/cloud-vm/main.py')
        self.assertIn("@app.get('/fx-rates')", main)
        self.assertIn("@app.get('/fx-rates/history')", main)
        self.assertNotIn("@app.post('/fx", main)
        module = self.read('scripts/cloud-vm/fx_koreaexim.py')
        snapshot_src = module[module.index('def snapshot('):module.index('def history(')]
        self.assertNotIn('fetch_day', snapshot_src)                                    # 요청 경로에서 외부 API를 호출하지 않는다
        self.assertNotIn('urllib', snapshot_src)


if __name__ == '__main__':
    unittest.main()
