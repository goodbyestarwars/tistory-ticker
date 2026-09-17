# -*- coding: utf-8 -*-
"""daily_scan 구간별 소요시간 계측(2026-09-17).

이 스캔이 3시간 50분 걸려 뒤따르는 스캔을 새벽까지 밀어냈고, 그게 스왑 고갈 장애로 이어졌다.
종목당 5.75초 중 throttle 0.5초를 뺀 나머지가 어디로 가는지 몰라서 구간별 누적을 넣었다.
여기서는 그 집계·표시가 맞는지, 구간을 새로 추가하고 표시에서 빠뜨리는 일이 없는지 본다.
"""

import importlib.util
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, 'scripts', 'cloud-vm', 'daily_scan.py')


def load_module():
    """daily_scan은 임포트 비용이 큰 모듈들을 끌고 오므로, 필요한 함수만 떼어 실행한다."""
    with open(SOURCE, 'r', encoding='utf-8') as handle:
        text = handle.read()
    start = text.index('TIMING_KEYS = (')
    end = text.index('def main():')
    namespace = {}
    exec(compile(text[start:end], SOURCE, 'exec'), namespace)  # noqa: S102 - 계측 함수만 떼어 실행
    return namespace


class TimingFormatTest(unittest.TestCase):
    def setUp(self):
        self.mod = load_module()

    def test_new_timings_covers_every_displayed_key(self):
        timings = self.mod['new_timings']()
        self.assertIn('loop', timings)
        for key in self.mod['TIMING_KEYS']:
            self.assertIn(key, timings)

    def test_rest_is_loop_minus_measured(self):
        """측정하지 않은 구간(시그널 계산·랭킹 갱신)이 '나머지'로 드러나야 한다."""
        timings = self.mod['new_timings']()
        timings['loop'] = 100.0
        timings['ohlcApi'] = 30.0
        timings['flowApi'] = 20.0
        timings['throttle'] = 10.0
        line = self.mod['format_timings'](timings, 200)
        self.assertIn('합계 100s', line)
        self.assertIn('종목당 0.50s', line)
        self.assertIn('ohlcApi 30s(30%)', line)
        self.assertIn('flowApi 20s(20%)', line)
        self.assertIn('나머지 40s(40%)', line)

    def test_every_key_appears_in_the_line(self):
        timings = self.mod['new_timings']()
        timings['loop'] = 10.0
        line = self.mod['format_timings'](timings, 10)
        for key in self.mod['TIMING_KEYS']:
            self.assertIn(key, line)

    def test_zero_loop_does_not_divide_by_zero(self):
        """첫 회차가 통째로 실패하면 loop이 0일 수 있다 - 로그 때문에 스캔이 죽으면 안 된다."""
        line = self.mod['format_timings'](self.mod['new_timings'](), 0)
        self.assertIn('합계 0s', line)


class InstrumentationContractTest(unittest.TestCase):
    """계측이 조용히 빠지지 않게 호출 지점을 고정한다."""

    def setUp(self):
        with open(SOURCE, 'r', encoding='utf-8') as handle:
            self.source = handle.read()

    def test_loop_time_is_counted_even_when_a_stock_fails(self):
        # finally가 아니면 실패한 종목이 합계에서 빠져 '나머지'가 부풀어 보인다.
        self.assertIn("finally:", self.source)
        self.assertIn("timings['loop'] += time.perf_counter() - loop_started", self.source)

    def test_both_api_calls_are_measured(self):
        self.assertIn("timings['ohlcApi'] +=", self.source)
        self.assertIn("timings['flowApi'] +=", self.source)

    def test_both_commits_are_measured(self):
        """종목마다 커밋을 두 번 한다 - 308MB SQLite에 fsync가 종목당 2회다."""
        self.assertIn("timings['ohlcSave'] +=", self.source)
        self.assertIn("timings['flowSave'] +=", self.source)

    def test_summary_is_logged_periodically(self):
        self.assertIn('log(format_timings(timings, i + 1))', self.source)


if __name__ == '__main__':
    unittest.main()
