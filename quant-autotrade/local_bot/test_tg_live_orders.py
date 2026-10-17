# -*- coding: utf-8 -*-
"""실계좌 엔진(live_engine.py) 장부의 매수·매도 주문 텔레그램 알림 - 합성 장부만 쓰며 주문·네트워크·계좌 호출이 없다. (2026-10-18)"""
import json
import os
import sqlite3
import unittest

import tg_live_orders as L
import tg_format as F
from test_tg_unit import Env

DAY = '2026-10-12'


def make_ledger(folder, rows, with_note=True):
    path = os.path.join(folder, 'live_orders.db')
    db = sqlite3.connect(path)
    db.execute('CREATE TABLE intents(id INTEGER PRIMARY KEY,ts TEXT,code TEXT,side TEXT,qty INTEGER,state TEXT,order_no TEXT,price INTEGER,reason TEXT,note TEXT)')
    for r in rows:
        db.execute('INSERT INTO intents VALUES(?,?,?,?,?,?,?,?,?,?)', r)
    db.commit()
    db.close()
    return path


def write_fills(folder, fills):
    with open(os.path.join(folder, 'order_fills.json'), 'w', encoding='utf-8') as f:
        json.dump({'fills': fills}, f, ensure_ascii=False)


def fill(date, code, side, qty, price):
    return {'date': date, 'code': code, 'side': side, 'qty': qty, 'price': price, 'source': '키움 당일매매일지'}


BUY = (1, DAY + 'T10:01:05+09:00', '005930', 'BUY', 3, 'ACK', 'A1234567', 85300, 'ENTRY', json.dumps({'scanner': 'pullback'}))
SELL = (2, DAY + 'T10:40:30+09:00', '005930', 'SELL', 3, 'ACK', 'B7654321', 82700, 'STOP_3', None)


class StageTests(unittest.TestCase):
    def test_only_ack_is_trusted_and_unknown_states_are_not_called_fills(self):
        self.assertEqual(L.base_stage('ACK'), 'ACCEPTED')
        self.assertEqual(L.base_stage('REJECTED'), 'REJECTED')
        self.assertEqual(L.base_stage('SEND_ERROR'), 'FAILED')
        self.assertEqual(L.base_stage('PENDING'), 'REQUESTED')
        self.assertEqual(L.base_stage('FILLED'), 'UNKNOWN')       # 장부 state 만으로는 체결 완료라고 단정하지 않는다
        self.assertEqual(L.base_stage('???'), 'UNKNOWN')


class FormatTests(unittest.TestCase):
    NOW = F.to_dt('2026-10-12T10:02:00+09:00')

    def render(self, rows, fills=None, idx=0, name='삼성전자'):
        intents = []
        for r in rows:
            d = dict(zip(('id', 'ts', 'code', 'side', 'qty', 'state', 'order_no', 'price', 'reason', 'note'), r))
            d['note'] = json.loads(d['note']) if d['note'] else {}
            intents.append(d)
        key, data = L.build(intents[idx], intents, fills or [], name)
        return key, L.fmt_live_order(data, self.NOW)

    def test_buy_accepted_shows_all_required_fields_without_claiming_fill(self):
        _, text = self.render([BUY])
        for needle in ('매수 주문 · 증권사 접수', '삼성전자', '005930', '2026-10-12(월) 10:01:05 KST', '3주', '85,300원', '255,900원',
                       '진입 조건 충족', '눌림목', '확인된 체결: 아직 없음', '체결 확인이 아닙니다', '상태 코드 ACK', '…4567'):
            self.assertIn(needle, text)
        self.assertNotIn('전량 체결', text)
        self.assertNotIn('· 평균', text)

    def test_buy_with_confirmed_fill_shows_average_and_amount(self):
        key, text = self.render([BUY], [fill(DAY, '005930', 'BUY', 3, 85000)])
        self.assertIn('전량 체결', text)
        self.assertIn('확인된 체결</b>: 3주 · 평균 85,000원 · 체결금액 255,000원', text)
        self.assertIn('키움 당일매매일지', text)
        self.assertTrue(key.startswith('liveord:1:FILLED:'))

    def test_partial_fill_is_separate_stage_and_key(self):
        k_acc, _ = self.render([BUY])
        k_part, text = self.render([BUY], [fill(DAY, '005930', 'BUY', 1, 85100)])
        k_full, _ = self.render([BUY], [fill(DAY, '005930', 'BUY', 3, 85100)])
        self.assertIn('일부 체결', text)
        self.assertEqual(len({k_acc, k_part, k_full}), 3)           # 단계가 바뀌면 새 알림, 같으면 같은 키

    def test_sell_reason_and_profit_only_when_both_fills_known(self):
        _, no_fill = self.render([BUY, SELL], idx=1)
        self.assertIn('매도 주문 · 증권사 접수', no_fill)
        self.assertIn('손절(가격 -3% 연속 확인)', no_fill)
        self.assertIn('판정가(시장가 주문) 82,700원', no_fill)
        self.assertIn('실현손익: 확인 불가', no_fill)
        _, only_sell = self.render([BUY, SELL], [fill(DAY, '005930', 'SELL', 3, 82500)], idx=1)
        self.assertIn('실현손익: 확인 불가', only_sell)             # 매수 체결가가 없으면 계산하지 않는다
        _, both = self.render([BUY, SELL], [fill(DAY, '005930', 'BUY', 3, 85000), fill(DAY, '005930', 'SELL', 3, 82500)], idx=1)
        self.assertIn('실현손익: 🔵 -7,500원 (−2.94%)', both)
        self.assertIn('비용 제외', both)

    def test_missing_name_still_shows_code(self):
        _, text = self.render([BUY], name=None)
        self.assertIn('<b>005930</b> <code>005930</code>', text)

    def test_rejected_failed_and_unknown_are_distinguished(self):
        def with_state(state):
            return self.render([BUY[:5] + (state,) + BUY[6:]])[1]
        self.assertIn('증권사 거부', with_state('REJECTED'))
        self.assertIn('전송 실패', with_state('SEND_FAILED'))
        self.assertIn('주문 요청', with_state('NEW'))
        unknown = with_state('XYZ')
        self.assertIn('상태 확인 필요', unknown)
        self.assertIn('상태 코드 XYZ', unknown)
        self.assertNotIn('체결 확인됐', unknown)

    def test_message_is_valid_telegram_html(self):
        _, text = self.render([BUY, SELL], [fill(DAY, '005930', 'BUY', 3, 85000)], idx=1)
        self.assertLessEqual(len(text), 4096)
        self.assertEqual(text.count('<b>'), text.count('</b>'))
        self.assertEqual(text.count('<i>'), text.count('</i>'))


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        self.env.baseline()

    def tearDown(self):
        self.env.close()

    def test_new_live_orders_are_sent_once_and_updates_on_fill(self):
        e = self.env
        make_ledger(e.dir, [BUY])
        e.tick()
        texts = e.flush()
        self.assertEqual(len([t for t in texts if '매수 주문' in t]), 1)
        e.tick()
        e.tick()
        self.assertEqual(len([t for t in e.flush() if '매수 주문' in t]), 1)     # 같은 단계는 반복하지 않는다
        write_fills(e.dir, [fill(DAY, '005930', 'BUY', 3, 85000)])
        e.tick()
        texts = e.flush()
        self.assertEqual(len([t for t in texts if '전량 체결' in t]), 1)
        self.assertIn('85,000원', [t for t in texts if '전량 체결' in t][0])

    def test_restart_does_not_resend(self):
        e = self.env
        make_ledger(e.dir, [BUY])
        e.tick()
        e.flush()
        count = len(e.api.texts())
        e.new_service()                    # 같은 telegram.db 로 재시작
        e.tick()
        e.flush()
        self.assertEqual(len(e.api.texts()), count)

    def test_other_days_and_missing_ledger_are_ignored(self):
        e = self.env
        e.tick()                           # 장부 없음: 오류 없이 지나간다
        make_ledger(e.dir, [(9, '2026-10-09T10:00:00+09:00', '005930', 'BUY', 1, 'ACK', 'Z', 1000, 'ENTRY', None)])
        e.tick()
        self.assertEqual([t for t in e.flush() if '주문' in t and '실계좌' in t], [])

    def test_telegram_failure_does_not_touch_the_engine_or_raise(self):
        e = self.env
        path = make_ledger(e.dir, [BUY])
        before = os.path.getmtime(path)
        e.svc.notifier.notify = lambda *a, **k: (_ for _ in ()).throw(RuntimeError('telegram down'))
        e.tick()                           # 알림 적재가 예외를 던져도 감시자는 계속 돈다
        self.assertEqual(os.path.getmtime(path), before)          # 장부는 읽기만 했다
        db = sqlite3.connect(path)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM intents').fetchone()[0], 1)
        db.close()


if __name__ == '__main__':
    unittest.main()
