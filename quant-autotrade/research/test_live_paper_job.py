# -*- coding: utf-8 -*-
"""실행기 하루치 루프 통합 테스트(합성 시계·합성 시세). 실제 관측 데이터가 아니다."""
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import live_paper as lp  # noqa: E402
import live_paper_job as job  # noqa: E402
from test_live_paper import Base, FakeQuotes, KST, SCAN, make_daily  # noqa: E402


class DayLoop(Base):
    def test_full_day_buy_stop_eod_and_status_file(self):
        self.cand('000100')
        self.cand('000200', 'doubleBottom', 80)
        self.q = FakeQuotes()
        eng = lp.Engine(self.conn, self.q, lambda c: self.daily.get(c, []), self.cfg, environ={})
        clock = {'t': datetime(2026, 10, 12, 8, 50, tzinfo=KST)}

        def sleep(sec):
            clock['t'] += timedelta(seconds=sec)
            now = clock['t']
            for code, px in (('000100', 10000.0), ('000200', 10050.0)):
                price = px if now.hour < 11 else px * 0.85           # 11시 이후 급락
                self.q.set(code, price, now.replace(second=0))
            if (now.hour, now.minute) >= (15, 40):
                self.daily['000100'] = make_daily(extra=[('2026-10-12', 10000, 10010, 8400, 8500)])
                self.daily['000200'] = make_daily(extra=[('2026-10-12', 10050, 10060, 8500, 8540)])

        tmp = tempfile.mkdtemp()
        self.assertEqual(job.run(eng, tmp, lambda: clock['t'], sleep), 'done')
        self.assertGreaterEqual(self.count("SELECT COUNT(*) FROM lp_events WHERE kind='BUY'"), 6)
        self.assertEqual(self.count("SELECT COUNT(*) FROM lp_positions WHERE strategy_id='trail_atr' AND status='CLOSED'"), 2)    # 급락 시 장중 손절
        self.assertEqual(self.count("SELECT COUNT(*) FROM lp_positions WHERE strategy_id='atr_close' AND status='PENDING_EXIT'"), 2)  # 종가 신호는 다음 거래일 대기
        self.assertEqual(self.count("SELECT COUNT(*) FROM lp_events WHERE kind='EOD_REPORT'"), 1)
        st = json.load(open(os.path.join(tmp, 'livepaper.json'), encoding='utf-8'))
        self.assertEqual(st['simulationType'], 'LIVE_PAPER')
        self.assertEqual(st['orderApi'], 'none')
        self.assertEqual(set(st['accounts']), set(lp.STRATEGIES))
        self.assertTrue(st['trades'] and st['positions'])
        self.assertTrue(all(p['balanceAfterBuy'] is not None for p in st['positions']))
        self.assertTrue(all(t['balanceAfterBuy'] is not None and t['balanceAfterSell'] is not None for t in st['trades']))
        self.assertTrue(all(t['scanDate'] for t in st['trades']))
        # 같은 날 다시 켜도(재시작) 새 매수·중복 EOD 없음
        n_pos = self.count('SELECT COUNT(*) FROM lp_positions')
        clock['t'] = datetime(2026, 10, 12, 15, 46, tzinfo=KST)
        job.run(lp.Engine(self.conn, self.q, lambda c: self.daily.get(c, []), self.cfg, environ={}), tmp, lambda: clock['t'] if clock['t'].hour < 15 or clock['t'].minute < 50 else clock['t'], sleep)
        self.assertEqual(self.count('SELECT COUNT(*) FROM lp_positions'), n_pos)
        self.assertEqual(self.count("SELECT COUNT(*) FROM lp_events WHERE kind='EOD_REPORT'"), 1)

    def test_read_only_client_blocks_order_paths(self):
        """봇과 공유하는 키움 클라이언트라도 모의매매 실행기에서는 조회 TR 외에 네트워크로 나갈 수 없다."""
        import research_job as rj

        class FakeClient:
            def __init__(self):
                self.sent = []

            def call(self, api_id, path, body, _retried=False):
                self.sent.append((api_id, path))
                return {}

            def sell_market(self, code, qty):
                self.sent.append(('kt10001', '/api/dostk/ordr'))
                return {'ok': True}

        c = rj.read_only_client(FakeClient())
        c.call('ka10080', '/api/dostk/chart', {})            # 1분봉 조회는 통과
        c.call('ka10081', '/api/dostk/chart', {})            # 일봉 조회는 통과
        for api, path in (('kt10001', '/api/dostk/ordr'), ('kt10000', '/api/dostk/ordr'), ('kt00018', '/api/dostk/acnt'), ('ka10081', '/api/dostk/ordr')):
            with self.assertRaises(RuntimeError):
                c.call(api, path, {})
        with self.assertRaises(RuntimeError):
            c.sell_market('005930', 1)
        self.assertEqual(c.sent, [('ka10080', '/api/dostk/chart'), ('ka10081', '/api/dostk/chart')])   # 차단된 호출은 전송 단계까지 가지 못했다

    def test_holiday_does_nothing(self):
        eng = lp.Engine(self.conn, self.q, lambda c: [], self.cfg, environ={})
        self.assertEqual(job.run(eng, None, lambda: datetime(2026, 10, 9, 9, 0, tzinfo=KST), lambda s: None), 'NOT_TRADING_DAY')


if __name__ == '__main__':
    unittest.main()
