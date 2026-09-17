# -*- coding: utf-8 -*-
"""옵션 실시간 구독 스위치(2026-09-17 사용자 확인).

사용자: "옵션은 아직 보조로 내가 넣으라고 한건데, 이건 실시간 아니여도 된다."

배경: 코스피200 옵션 콜/풋 상위 각 10계약이 KIS 실시간 등록 자리 40개 중 10개를 상시 차지하고
있었다. 그만큼 개별 종목이 밀렸고, 사용자가 검색해서 연 종목(010170)에 체결이 한 건도 안 오는
일이 생겼다. 단타라 실시간 자리는 개별 종목이 먼저 써야 한다.

끄더라도 콜/풋 숫자는 5분 REST 전광판 스냅샷(`_poll_loop`)으로 계속 갱신돼야 한다 - 화면이
비면 안 된다.

option_flow.py는 리눅스 전용 모듈을 끌고 오는 이웃들을 임포트하므로, 스위치 함수만 떼어 쓴다.
"""

import io
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, 'scripts', 'cloud-vm', 'option_flow.py')
FUTURES_JS = os.path.join(ROOT, 'js', 'kospi-futures.js')


def read(path):
    with io.open(path, encoding='utf-8') as handle:
        return handle.read()


def load_switch():
    """`realtime_ws_enabled`와 `websocket_available`만 떼어 실행한다."""
    text = read(SOURCE)
    start = text.index('def realtime_ws_enabled():')
    end = text.index('OPTION_TRADE_TR_ID', start)
    namespace = {'os': os}
    exec(compile(text[start:end], SOURCE, 'exec'), namespace)  # noqa: S102
    return namespace


class SwitchTest(unittest.TestCase):
    def setUp(self):
        self.mod = load_switch()
        self._saved = os.environ.get('OPTION_REALTIME_WS')

    def tearDown(self):
        if self._saved is None:
            os.environ.pop('OPTION_REALTIME_WS', None)
        else:
            os.environ['OPTION_REALTIME_WS'] = self._saved

    def test_default_is_off(self):
        """기본이 꺼짐이어야 실시간 자리가 개별 종목에 간다."""
        os.environ.pop('OPTION_REALTIME_WS', None)
        self.assertFalse(self.mod['realtime_ws_enabled']())

    def test_can_be_turned_back_on(self):
        for value in ('1', 'true', 'TRUE', 'yes', 'on'):
            os.environ['OPTION_REALTIME_WS'] = value
            self.assertTrue(self.mod['realtime_ws_enabled'](), value)

    def test_other_values_stay_off(self):
        for value in ('', '0', 'false', 'no', 'off', 'maybe'):
            os.environ['OPTION_REALTIME_WS'] = value
            self.assertFalse(self.mod['realtime_ws_enabled'](), value)

    def test_label_flag_is_false_when_disabled(self):
        """화면이 'WS 실시간 보강'이라고 거짓말하면 안 된다."""
        os.environ.pop('OPTION_REALTIME_WS', None)
        self.assertFalse(self.mod['websocket_available']())


class WiringTest(unittest.TestCase):
    def setUp(self):
        self.source = read(SOURCE)

    def test_disabled_path_uses_the_rest_poll_loop(self):
        """실시간을 꺼도 5분 REST 스냅샷은 계속 돌아야 한다(화면이 비면 안 된다)."""
        start = self.source.index('def start_background(')
        body = self.source[start:self.source.index('return t', start)]
        self.assertIn('if not realtime_ws_enabled():', body)
        gate = body.index('if not realtime_ws_enabled():')
        self.assertLess(gate, body.index('_ws_loop'))
        self.assertIn('target = _poll_loop', body[gate:body.index('else:', gate)])

    def test_rest_loop_still_refreshes_every_five_minutes(self):
        start = self.source.index('def _poll_loop(')
        body = self.source[start:self.source.index('\ndef ', start + 10)]
        self.assertIn('refresh_option_flow', body)
        self.assertIn('_POLL_INTERVAL_SEC', body)

    def test_frontend_label_follows_the_flag(self):
        """kospi-futures.js가 이 값으로 문구를 가른다 - 계약을 고정한다."""
        self.assertIn('websocket ?', read(FUTURES_JS).replace('bySide.', ''))


if __name__ == '__main__':
    unittest.main()
