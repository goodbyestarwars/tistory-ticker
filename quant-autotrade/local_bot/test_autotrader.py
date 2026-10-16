# -*- coding: utf-8 -*-
"""오프라인 테스트(가짜 키움 클라이언트): python -m unittest -v"""
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import timedelta

import bot as bot_mod
import server as server_mod


class FakeClient:
    def __init__(self):
        self.holdings = []
        self.sells = []
        self.fail_balance = False
        self.sell_result = {'ok': True, 'ord_no': '0001', 'return_code': 0, 'return_msg': ''}

    def balance(self):
        if self.fail_balance:
            raise RuntimeError('잔고 오류')
        return [dict(h) for h in self.holdings]

    def sell_market(self, code, qty):
        self.sells.append((code, qty))
        return dict(self.sell_result)


def holding(code='005930', avg=100000.0, price=100000.0, qty=10, sellable=None):
    return {'code': code, 'name': '테스트', 'qty': qty, 'sellable': qty if sellable is None else sellable, 'avg': avg, 'price': price}


class BaseCase(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.store = bot_mod.Store(os.path.join(self.dir, 't.db'))
        self.client = FakeClient()
        self.config = dict(bot_mod.DEFAULT_CONFIG)
        self.bot = bot_mod.Bot(self.client, self.store, self.config)
        bot_mod.STOP_FLAG = os.path.join(self.dir, 'STOP')
        server_mod.STOP_FLAG = bot_mod.STOP_FLAG
        self.store.watch_add('005930', '삼성전자', confirmed=True)
        os.environ.pop('LIVE_SELL', None)
        # Exercise the legacy order path only inside tests; production gate stays shut.
        self._orig_live = bot_mod.live_sell_enabled
        bot_mod.live_sell_enabled = lambda: os.environ.get('LIVE_SELL') == 'true'
        # 장 시간으로 고정(평일 10:00)
        self._orig_now = bot_mod.now_kst
        base = bot_mod.now_kst()
        while base.weekday() >= 5:
            base -= timedelta(days=1)
        self.now = base.replace(hour=10, minute=0, second=0, microsecond=0)
        bot_mod.now_kst = lambda: self.now

    def tearDown(self):
        bot_mod.now_kst = self._orig_now
        bot_mod.live_sell_enabled = self._orig_live
        os.environ.pop('LIVE_SELL', None)

    def poll(self, price, avg=100000.0, **kw):
        self.client.holdings = [holding(avg=avg, price=price, **kw)]
        self.bot.poll_once()

    def types(self):
        return [e['type'] for e in self.store.events()]


class DecideExitTests(unittest.TestCase):
    def test_deployed_order_gate_remains_closed_with_old_env(self):
        old = os.environ.get('LIVE_SELL')
        try:
            os.environ['LIVE_SELL'] = 'true'
            self.assertFalse(bot_mod.live_sell_enabled())
        finally:
            if old is None:
                os.environ.pop('LIVE_SELL', None)
            else:
                os.environ['LIVE_SELL'] = old

    def test_rules(self):
        cfg = bot_mod.DEFAULT_CONFIG
        self.assertEqual(bot_mod.decide_exit(-3.0, -3.0, cfg), 'STOP')
        self.assertEqual(bot_mod.decide_exit(-2.99, -2.99, cfg), None)
        self.assertEqual(bot_mod.decide_exit(5.0, 5.0, cfg), 'TP_CAP')
        self.assertEqual(bot_mod.decide_exit(4.0, 4.0, cfg), None)        # 3~5% 구간에서는 들고 간다
        self.assertEqual(bot_mod.decide_exit(2.9, 3.4, cfg), 'TP_FLOOR')  # 3%를 넘겼다가 3% 아래로 내려오면 수익 확정
        self.assertEqual(bot_mod.decide_exit(2.9, 2.9, cfg), None)        # 3%에 도달한 적 없으면 보유
        self.assertEqual(bot_mod.decide_exit(3.0, 4.5, cfg), None)        # 정확히 3%면 아직 보유


class ExitFlowTests(BaseCase):
    def test_dry_by_default_no_order(self):
        self.poll(96000)                       # -4%
        self.assertEqual(self.client.sells, [])
        self.assertIn('DRY_SELL', self.types())

    def test_live_stop_sends_one_market_sell(self):
        os.environ['LIVE_SELL'] = 'true'
        self.poll(96500)                       # -3.5%
        self.assertEqual(self.client.sells, [('005930', 10)])
        self.assertIn('SELL_SENT', self.types())
        self.poll(96500)                       # 같은 종목 재주문은 쿨다운 동안 막힌다
        self.assertEqual(len(self.client.sells), 1)
        self.now += timedelta(seconds=self.config['sell_cooldown_sec'] + 1)
        self.poll(96500)                       # 쿨다운 뒤에도 보유가 남아 있으면 다시 시도
        self.assertEqual(len(self.client.sells), 2)

    def test_take_profit_cap_and_floor(self):
        os.environ['LIVE_SELL'] = 'true'
        self.poll(103500)                      # +3.5% 보유, 고점 기록
        self.assertEqual(self.client.sells, [])
        self.poll(104800)                      # +4.8% 보유
        self.assertEqual(self.client.sells, [])
        self.poll(102900)                      # 3% 아래로 되돌림 -> 매도
        self.assertEqual(len(self.client.sells), 1)
        self.assertEqual(self.store.orders()[0]['reason'], 'TP_FLOOR')

    def test_take_profit_cap_sells_immediately(self):
        os.environ['LIVE_SELL'] = 'true'
        self.poll(105100)
        self.assertEqual(self.store.orders()[0]['reason'], 'TP_CAP')

    def test_not_watched_is_never_touched(self):
        os.environ['LIVE_SELL'] = 'true'
        self.store.watch_remove('005930')
        self.poll(90000)
        self.assertEqual(self.client.sells, [])

    def test_sellable_qty_only_and_zero_skips(self):
        os.environ['LIVE_SELL'] = 'true'
        self.poll(96000, qty=10, sellable=4)
        self.assertEqual(self.client.sells, [('005930', 4)])
        self.setUp()
        os.environ['LIVE_SELL'] = 'true'
        self.poll(96000, qty=10, sellable=0)
        self.assertEqual(self.client.sells, [])

    def test_zero_price_or_avg_skipped(self):
        os.environ['LIVE_SELL'] = 'true'
        self.poll(0)
        self.poll(96000, avg=0)
        self.assertEqual(self.client.sells, [])

    def test_stopped_flag_and_market_closed(self):
        os.environ['LIVE_SELL'] = 'true'
        with open(bot_mod.STOP_FLAG, 'w') as f:
            f.write('x')
        self.poll(90000)
        self.assertEqual(self.client.sells, [])
        os.remove(bot_mod.STOP_FLAG)
        self.now = self.now.replace(hour=8)
        self.poll(90000)
        self.assertEqual(self.client.sells, [])
        self.now = self.now.replace(hour=15, minute=25)    # 종가 단일가 구간
        self.poll(90000)
        self.assertEqual(self.client.sells, [])

    def test_daily_limits(self):
        os.environ['LIVE_SELL'] = 'true'
        self.config['max_sells_per_day'] = 1
        self.store.watch_add('000660', 'SK하이닉스', confirmed=True)
        self.client.holdings = [holding('005930', 100000, 96000), holding('000660', 100000, 96000)]
        self.bot.poll_once()
        self.assertEqual(len(self.client.sells), 1)
        self.assertIn('CRITICAL', self.types())

    def test_order_rejection_and_exception_are_recorded(self):
        os.environ['LIVE_SELL'] = 'true'
        self.client.sell_result = {'ok': False, 'ord_no': None, 'return_code': 20, 'return_msg': '거부'}
        self.poll(96000)
        self.assertIn('ERROR', self.types())
        self.assertEqual(self.store.orders()[0]['status'], 'ERROR')

    def test_balance_failure_escalates_without_selling(self):
        os.environ['LIVE_SELL'] = 'true'
        self.client.fail_balance = True
        for _ in range(3):
            self.bot.poll_once()
        self.assertIn('CRITICAL', self.types())
        self.assertEqual(self.client.sells, [])

    def test_position_closed_clears_peak(self):
        self.poll(103500)
        self.assertIsNotNone(self.store.peak_get('005930'))
        self.client.holdings = []
        self.bot.poll_once()
        self.assertIsNone(self.store.peak_get('005930'))
        self.assertIn('POSITION_CLOSED', self.types())

    def test_legacy_watch_bot_never_buys(self):
        names = ' '.join(dir(bot_mod.Bot)).lower()
        for word in ('buy', 'kt10000', 'purchase'):
            self.assertNotIn(word, names)


class OpsCenterTests(BaseCase):
    """2026-10-15 운영센터: 장전 잔고 조회, 기존 보유 구분, 분석 전용, 규칙 확인 게이트, 정책 대조."""

    def test_balance_state_before_first_poll_is_not_yet_not_zero(self):
        info = self.bot.balance_info()
        self.assertEqual(info['state'], 'NOT_YET')
        self.assertIsNone(info['count'])

    def test_premarket_reads_balance_but_never_orders(self):
        os.environ['LIVE_SELL'] = 'true'
        self.now = self.now.replace(hour=8, minute=30)
        self.poll(90000)                                   # 장전: 규칙상 손절 구간이어도
        self.assertEqual(self.client.sells, [])
        self.assertEqual(self.store.orders(), [])
        info = self.bot.balance_info()
        self.assertEqual(info['state'], 'OK')
        self.assertEqual(info['count'], 1)
        self.assertEqual(self.bot.holdings[0]['code'], '005930')
        self.assertIsNotNone(info['last_ok'])

    def test_balance_failure_is_not_shown_as_zero_holdings(self):
        self.now = self.now.replace(hour=8, minute=30)
        self.client.fail_balance = True
        self.bot.poll_once()
        info = self.bot.balance_info()
        self.assertEqual(info['state'], 'FAILED')
        self.assertIsNone(info['count'])
        self.assertIn('잔고 조회 실패', info['error'])
        self.assertEqual(self.client.sells, [])

    def test_failure_after_success_keeps_last_ok_time(self):
        self.poll(100000)
        ok_at = self.bot.balance_ok_at
        self.client.fail_balance = True
        self.bot.poll_once()
        info = self.bot.balance_info()
        self.assertEqual((info['state'], info['last_ok']), ('FAILED', ok_at))

    def test_zero_holdings_is_a_real_empty_balance(self):
        self.client.holdings = []
        self.bot.poll_once()
        info = self.bot.balance_info()
        self.assertEqual((info['state'], info['count']), ('OK', 0))

    def test_off_hours_balance_is_throttled(self):
        self.now = self.now.replace(hour=8, minute=30)
        calls = []
        orig = self.client.balance
        self.client.balance = lambda: (calls.append(1), orig())[1]
        self.bot.poll_once()
        self.bot.poll_once()
        self.assertEqual(len(calls), 1)

    def test_unconfirmed_watch_is_not_evaluated_until_confirmed(self):
        os.environ['LIVE_SELL'] = 'true'
        self.store.watch_add('000660', 'SK하이닉스')          # 기본: 규칙 미확인
        self.client.holdings = [holding('000660', 100000, 90000)]   # 이미 -10%
        self.bot.poll_once()
        self.assertEqual(self.client.sells, [])
        self.assertEqual(self.store.orders(), [])
        self.assertNotIn('DRY_SELL', self.types())
        self.assertTrue(self.store.watch_confirm('000660'))
        self.bot.poll_once()
        self.assertEqual(self.client.sells, [('000660', 10)])    # 확인 뒤에는 기존 규칙대로(테스트 경로)

    def test_analysis_only_code_is_never_evaluated_even_if_watched(self):
        os.environ['LIVE_SELL'] = 'true'
        self.assertIn('032640', [a['code'] for a in self.store.analysis_list()])   # 시드
        self.store.watch_add('032640', 'LG유플러스', confirmed=True)
        self.client.holdings = [holding('032640', 15000, 10000)]  # -33%
        self.bot.poll_once()
        self.assertEqual(self.client.sells, [])
        self.assertFalse(self.bot.holdings[0]['watched'])
        self.assertTrue(self.bot.holdings[0]['analysis_only'])

    def test_analysis_add_removes_fixed_rule_watch(self):
        self.store.analysis_add('005930', '삼성전자')
        self.assertEqual(self.store.watch_list(), [])
        self.poll(90000)
        self.assertEqual(self.client.sells, [])

    def test_classify_manual_engine_mixed_and_flags(self):
        hold = [dict(holding('032640', 15000, 14700, qty=10, sellable=6), gain=-2.0),
                dict(holding('000660', 100000, 90000, qty=5), gain=-10.0),
                dict(holding('005930', 100000, 100000, qty=8), gain=0.0)]
        positions = {'000660': {'qty': 5, 'state': 'OPEN', 'floor_reached': 0}, '005930': {'qty': 3, 'state': 'OPEN', 'floor_reached': 1}}
        orders = [{'ts': '2026-10-15 09:01:00', 'code': '000660', 'status': 'ACK'}]
        rows = {r['code']: r for r in server_mod.classify_holdings(
            hold, positions, orders, {'000660': {'confirmed': 0}}, {'032640'}, self.config, '2026-10-15')}
        self.assertEqual((rows['032640']['kind'], rows['032640']['manual_qty'], rows['032640']['locked_qty'], rows['032640']['sell_watch']),
                         ('manual', 10, 4, 'analysis'))
        self.assertEqual((rows['000660']['kind'], rows['000660']['sell_watch'], rows['000660']['rule_beyond'], rows['000660']['pending_order']),
                         ('engine', 'rule_unconfirmed', True, True))
        self.assertEqual((rows['005930']['kind'], rows['005930']['engine_qty'], rows['005930']['manual_qty']), ('mixed', 3, 5))
        self.assertFalse(rows['032640']['rule_beyond'])

    def test_live_policy_reads_engine_constants_or_reports_none(self):
        folder = tempfile.mkdtemp()
        self.assertIsNone(bot_mod.live_policy(folder))
        path = os.path.join(folder, 'live_engine.py')
        body = ('BUDGET=2_000_000\nRESERVE=50_000\nPER_STOCK=500_000\nMAX_STOCKS=2\nCOST_PCT=0.5\n'
                'def exit_reason(g, r):\n    if g <= -5: return "STOP_NET_5"\n    if g >= 6: return "PROFIT_NET_6"\n'
                '    if r and g < 3: return "PROFIT_FLOOR_NET_3"\n')
        with open(path, 'w', encoding='utf-8') as f:
            f.write(body.replace('\\n', '\n'))
        pol = bot_mod.live_policy(folder)
        self.assertEqual((pol['budget'], pol['max_stocks'], pol['per_stock']), (2000000, 2, 500000))
        self.assertEqual(pol['exit']['stop_net_pct'], -5.0)
        # 손절선이 다르면(-4) 값을 보여 주지 않는다 - 하드코딩된 문구를 현재 설정처럼 쓰지 않기 위해
        with open(path, 'w', encoding='utf-8') as f:
            f.write(body.replace('\\n', '\n').replace('g <= -5', 'g <= -4'))
        os.utime(path, (1, 1))
        self.assertIsNone(bot_mod.live_policy(folder)['exit'])

    def test_engine_excluded_list_is_read_with_the_engines_validation(self):
        folder = tempfile.mkdtemp()
        self.assertIsNone(bot_mod.engine_excluded(folder))                       # 파일 없음 = 확인 불가
        path = os.path.join(folder, 'engine_excluded.json')
        for raw, expected in (('{"codes": ["032640"]}', ['032640']), ('{"codes": []}', []), ('{"codes": "032640"}', None),
                              ('{"codes": ["32640"]}', None), ('{bad', None), ('﻿{"codes": ["032640"]}', None)):
            with open(path, 'w', encoding='utf-8') as f:
                f.write(raw)
            self.assertEqual(bot_mod.engine_excluded(folder), expected, raw)

    def test_status_exposes_balance_and_never_enables_orders(self):
        st = self.bot.status()
        self.assertEqual(st['balance']['state'], 'NOT_YET')
        self.assertEqual(st['order_gate'], 'LOCAL_BOT_RECORD_ONLY')


class ServerTests(BaseCase):
    def setUp(self):
        super().setUp()
        self.token = 'secret-token'
        self.httpd = server_mod.start_server(self.bot, self.store, self.token, port=0)
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        super().tearDown()

    def _req(self, path, method='GET', token=None, origin=None, body=None):
        headers = {}
        if token:
            headers['X-AutoTrader-Token'] = token
        if origin:
            headers['Origin'] = origin
        data = None
        if body is not None:
            data = json.dumps(body).encode('utf-8')
            headers['Content-Type'] = 'application/json'
        elif method == 'POST':
            data = b''
        req = urllib.request.Request('http://127.0.0.1:%d%s' % (self.port, path), method=method, headers=headers, data=data)
        try:
            with urllib.request.urlopen(req) as res:
                return res.status, dict(res.headers), json.loads(res.read().decode('utf-8') or 'null')
        except urllib.error.HTTPError as exc:
            exc.close()
            return exc.code, dict(exc.headers), None

    def test_requires_token_and_hides_secrets(self):
        self.assertEqual(self._req('/api/status')[0], 401)
        status, _, body = self._req('/api/status', token=self.token)
        self.assertEqual(status, 200)
        self.assertFalse(body['live_sell'])
        self.assertNotIn('key', json.dumps(body).lower())

    def test_cors_only_for_blog_origin(self):
        _, headers, _ = self._req('/api/status', token=self.token, origin='https://ghlee.tistory.com')
        self.assertEqual(headers.get('Access-Control-Allow-Origin'), 'https://ghlee.tistory.com')
        _, headers2, _ = self._req('/api/status', token=self.token, origin='https://evil.example')
        self.assertIsNone(headers2.get('Access-Control-Allow-Origin'))
        status, h3, _ = self._req('/api/status', method='OPTIONS', origin='https://ghlee.tistory.com')
        self.assertEqual(status, 204)
        self.assertEqual(h3.get('Access-Control-Allow-Private-Network'), 'true')

    def test_stop_resume(self):
        self.assertEqual(self._req('/api/stop', 'POST')[0], 401)
        self.assertEqual(self._req('/api/stop', 'POST', self.token)[0], 200)
        self.assertTrue(self.bot.stopped())
        self.assertEqual(self._req('/api/resume', 'POST', self.token)[0], 200)
        self.assertFalse(self.bot.stopped())

    def test_watch_add_remove_validation(self):
        self.assertEqual(self._req('/api/watch', 'POST', self.token, body={'code': '12'})[0], 400)
        self.assertEqual(self._req('/api/watch', 'POST', self.token, body={'code': 'abcdef'})[0], 400)
        status, _, body = self._req('/api/watch', 'POST', self.token, body={'code': '000660', 'name': 'SK하이닉스'})
        self.assertEqual(status, 200)
        self.assertIn('000660', [w['code'] for w in body['watch']])
        status, _, body = self._req('/api/unwatch', 'POST', self.token, body={'code': '000660'})
        self.assertNotIn('000660', [w['code'] for w in body['watch']])
        self.assertEqual(self._req('/api/watch', 'POST', body={'code': '000660'})[0], 401)

    def test_analysis_and_watch_confirm_endpoints(self):
        self.assertEqual(self._req('/api/analysis', 'POST', body={'code': '032640'})[0], 401)
        st, _, body = self._req('/api/watch', 'POST', self.token, body={'code': '032640', 'name': 'LG유플러스'})
        self.assertEqual(st, 409)                                  # 분석 전용 종목은 고정 규칙 감시로 올릴 수 없다
        st, _, body = self._req('/api/watch', 'POST', self.token, body={'code': '000660', 'name': 'SK하이닉스'})
        self.assertFalse([w for w in self.store.watch_list() if w['code'] == '000660'][0]['confirmed'])   # 새 등록은 규칙 미확인
        self.assertEqual(self._req('/api/watch-confirm', 'POST', self.token, body={'code': '000660'})[0], 200)
        self.assertTrue([w for w in self.store.watch_list() if w['code'] == '000660'][0]['confirmed'])
        self.assertEqual(self._req('/api/watch-confirm', 'POST', self.token, body={'code': '111111'})[0], 404)
        st, _, body = self._req('/api/analysis', 'POST', self.token, body={'code': '000660', 'name': 'SK하이닉스'})
        self.assertEqual(st, 200)
        self.assertNotIn('000660', [w['code'] for w in body['watch']])
        self.assertEqual(self._req('/api/analysis-remove', 'POST', self.token, body={'code': '000660'})[0], 200)

    def test_holdings_report_engine_exclusion_match(self):
        self.poll(100000)
        orig = server_mod.engine_excluded
        try:
            server_mod.engine_excluded = lambda: ['005930']
            self.assertIs(self._req('/api/holdings', token=self.token)[2]['holdings'][0]['engine_excluded'], True)
            server_mod.engine_excluded = lambda: ['000660']
            self.assertIs(self._req('/api/holdings', token=self.token)[2]['holdings'][0]['engine_excluded'], False)
            server_mod.engine_excluded = lambda: None
            self.assertIsNone(self._req('/api/holdings', token=self.token)[2]['holdings'][0]['engine_excluded'])
        finally:
            server_mod.engine_excluded = orig

    def test_holdings_response_has_balance_and_kind(self):
        self.poll(100000)
        _, _, body = self._req('/api/holdings', token=self.token)
        self.assertEqual(body['balance']['state'], 'OK')
        self.assertEqual(body['holdings'][0]['kind'], 'manual')
        self.assertEqual(body['holdings'][0]['sell_watch'], 'rule_confirmed')

    def test_holdings_orders_events(self):
        self.poll(96000)
        _, _, body = self._req('/api/holdings', token=self.token)
        self.assertEqual(body['holdings'][0]['code'], '005930')
        self.assertTrue(body['holdings'][0]['watched'])
        self.assertEqual(self._req('/api/orders', token=self.token)[2]['orders'][0]['status'], 'DRY')
        self.assertEqual(self._req('/api/events?limit=5', token=self.token)[0], 200)


if __name__ == '__main__':
    unittest.main()
