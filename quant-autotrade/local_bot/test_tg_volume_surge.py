# -*- coding: utf-8 -*-
"""거래량 급증 관찰 텔레그램 알림 - VM 공개 응답을 합성해 쓰며 네트워크·주문 호출이 없다. (2026-10-18)"""
import unittest

import tg_format as F
import tg_volume_surge as S
from test_tg_unit import Env


def item(code='123456', name='테스트종목', detected='2026-10-12T00:03:24+00:00', live=True, pace=0.042):
    return {'code': code, 'name': name, 'price': 12300, 'changeRate': 2.1, 'date': '2026-10-12',
            'patternDetail': {'live': live, 'detectedAt': detected, 'detectPrice': 12300, 'currentPrice': 12450, 'gainSinceDetectPct': 1.22,
                              'pace3': pace, 'volumeRatio': 0.31, 'changeRate': 2.1, 'status': 'early'}}


class FormatTests(unittest.TestCase):
    NOW = F.to_dt('2026-10-12T09:04:00+09:00')

    def test_message_has_required_fields_and_is_observation_only(self):
        d = S.live_detections({'items': [item()]})[0]
        text = S.fmt_surge(d, self.NOW)
        for needle in ('거래량 급증 감지', '👀 [관찰]', '자동매매 주문 아님', '테스트종목', '123456', '09:03:24 KST', '12,300원', '+2.10%',
                       '전일 거래량의 4.2%', '+1.22%', '매수 신호가 아닙니다'):
            self.assertIn(needle, text)
        self.assertNotIn('🏦', text)                    # 실계좌 주문 알림과 분류가 다르다

    def test_daily_accumulation_rows_and_incomplete_rows_are_ignored(self):
        rows = [item(live=False), dict(item(code='222222'), price=None), {'code': '333333', 'patternDetail': {}}, item(code='444444')]
        self.assertEqual([d['code'] for d in S.live_detections({'items': rows})], ['444444'])

    def test_session_window(self):
        self.assertTrue(S.in_session(F.to_dt('2026-10-12T09:03:00+09:00')))
        self.assertFalse(S.in_session(F.to_dt('2026-10-12T20:00:00+09:00')))
        self.assertFalse(S.in_session(F.to_dt('2026-10-17T10:00:00+09:00')))      # 토요일


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        self.env.baseline()
        self.calls = []
        self.seen = 0

    def tearDown(self):
        self.env.close()

    def feed(self, payload):
        def fetch():
            self.calls.append(1)
            if isinstance(payload, Exception):
                raise payload
            return payload
        self.env.svc.surge_fetch = fetch

    def surge_texts(self):
        texts = self.env.flush()
        new, self.seen = texts[self.seen:], len(texts)          # flush() 는 지금까지 나간 전체 목록을 돌려준다
        return [t for t in new if '거래량 급증 감지' in t]

    def test_sent_once_and_not_again_after_restart(self):
        e = self.env
        self.feed({'items': [item()]})
        e.advance(40)
        e.tick()
        self.assertEqual(len(self.surge_texts()), 1)
        e.advance(40)
        e.tick()
        self.assertEqual(self.surge_texts(), [])               # 같은 감지는 반복하지 않는다
        e.new_service()
        self.feed({'items': [item()]})
        e.advance(40)
        e.tick()
        self.assertEqual(self.surge_texts(), [])               # 재시작 후에도 마찬가지
        log = e.svc.tstore.kv_get('surge_log')
        self.assertEqual(len(log), 1)
        self.assertIn('delaySec', log[0])

    def test_new_detection_of_another_stock_and_time_alerts_again(self):
        e = self.env
        self.feed({'items': [item()]})
        e.advance(40)
        e.tick()
        self.surge_texts()
        self.feed({'items': [item(), item(code='654321', name='다른종목', detected='2026-10-12T00:05:10+00:00')]})
        e.advance(40)
        e.tick()
        texts = self.surge_texts()
        self.assertEqual(len(texts), 1)
        self.assertIn('다른종목', texts[0])

    def test_polling_interval_and_fetch_failure_do_not_break_the_monitor(self):
        e = self.env
        self.feed(RuntimeError('network down'))
        e.advance(40)
        e.tick()                                               # 가져오기 실패는 감시자가 삼키고 다음 주기에 다시 한다
        self.assertEqual(len(self.calls), 1)
        e.advance(5)
        e.tick()
        self.assertEqual(len(self.calls), 1)                   # 30초 안에는 다시 부르지 않는다
        e.advance(40)
        e.tick()
        self.assertEqual(len(self.calls), 2)

    def test_not_called_outside_the_session(self):
        e = self.env
        self.feed({'items': [item()]})
        e.at(2026, 10, 12, 21, 0)
        e.tick()
        self.assertEqual(self.calls, [])


if __name__ == '__main__':
    unittest.main()
