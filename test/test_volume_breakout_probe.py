# -*- coding: utf-8 -*-
"""거래량 돌파 스캔: 09:05 관측 패스와 과열 종목 후순위(2026-09-17 사용자 요청).

사용자 지적: "10분에 잡으니까 너무 떠서 가는데, 5분으로 줄일까?"
그날 09:10 실측 16종목의 등락률은 최소 +0.57 / 중앙 +9.34 / 최대 +17.14%였고, 같은 표본에서
거래량 배수와 등락률은 관계가 없었다(26.6배가 +4.7%, 2.0배가 +17.1%). 그래서 시각만 당겨
"배수 큰 것만" 남겨도 덜 뜬 종목을 잡게 되지 않는다. 대신
  (1) 09:05에 관측 전용 패스를 두어 "5분 시점 배수"를 모으고,
  (2) 이미 크게 오른 종목은 목록에서 빼지 않고 뒤로 보낸다.

volume_breakout_scan.py는 리눅스 전용 모듈(fcntl)을 끌고 오는 daily_scan_cache를 임포트해
윈도우에서 통째로 임포트할 수 없다. 그래서 필요한 함수만 떼어 실행한다.
"""

import io
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, 'scripts', 'cloud-vm', 'volume_breakout_scan.py')
SETUP = os.path.join(ROOT, 'scripts', 'cloud-vm', 'setup_volumebreakout_timer.sh')


def read(path):
    with io.open(path, encoding='utf-8') as handle:
        return handle.read()


def load_pieces():
    """상수와 순수 함수만 떼어 실행한다(외부 임포트 없이 도는 부분)."""
    text = read(SOURCE)
    start = text.index('OVERHEATED_CHANGE_PCT =')
    end = text.index('def build_match(')
    namespace = {'os': os, '__file__': SOURCE}  # PROBE_FILE 경로 계산에 쓰인다
    exec(compile(text[start:end], SOURCE, 'exec'), namespace)  # noqa: S102
    return namespace


class OverheatedTest(unittest.TestCase):
    def setUp(self):
        self.mod = load_pieces()

    def test_threshold_matches_the_measured_median(self):
        """2026-09-17 실측 중앙값(+9.34%)을 기준선으로 삼았다."""
        self.assertEqual(self.mod['OVERHEATED_CHANGE_PCT'], 10.0)

    def test_overheated_only_above_threshold(self):
        is_over = self.mod['is_overheated']
        self.assertFalse(is_over(9.99))
        self.assertTrue(is_over(10.0))
        self.assertTrue(is_over(17.14))
        self.assertFalse(is_over(-5.0))

    def test_missing_change_rate_is_not_overheated(self):
        """등락률을 못 받은 종목을 과열로 몰아 뒤로 보내면 안 된다."""
        is_over = self.mod['is_overheated']
        self.assertFalse(is_over(None))
        self.assertFalse(is_over(''))


class SortOrderTest(unittest.TestCase):
    """과열 종목은 목록에서 빼지 않고 배수 정렬 안에서 뒤로만 보낸다."""

    def sort_like_scan(self, items):
        items = list(items)
        items.sort(key=lambda item: (item['patternDetail']['overheated'],
                                     -item['patternDetail']['volumeRatio']))
        return [item['code'] for item in items]

    def make(self, code, ratio, overheated):
        return {'code': code, 'patternDetail': {'volumeRatio': ratio, 'overheated': overheated}}

    def test_cool_stocks_come_first_even_with_a_lower_ratio(self):
        order = self.sort_like_scan([
            self.make('hot_big', 26.6, True),
            self.make('cool_small', 1.02, False),
            self.make('cool_big', 5.06, False),
            self.make('hot_small', 2.02, True),
        ])
        self.assertEqual(order, ['cool_big', 'cool_small', 'hot_big', 'hot_small'])

    def test_nothing_is_dropped(self):
        items = [self.make('a', 3.0, True), self.make('b', 1.0, False)]
        self.assertEqual(len(self.sort_like_scan(items)), 2)

    def test_source_uses_this_sort_key(self):
        self.assertIn("key=lambda item: (item['patternDetail']['overheated'],", read(SOURCE))


class ProbeContractTest(unittest.TestCase):
    def setUp(self):
        self.source = read(SOURCE)
        self.setup = read(SETUP)

    def test_probe_mode_never_writes_screen_data(self):
        """관측 패스가 화면 결과를 덮으면 09:05에 목록이 반쯤 빈 채로 보인다."""
        start = self.source.index('def run_probe():')
        body = self.source[start:self.source.index('\ndef main():', start)]
        self.assertNotIn('daily_scan_cache.update', body)
        self.assertIn('save_probe(rows)', body)

    def test_probe_does_not_apply_the_one_times_threshold(self):
        """5분 시점 분포를 보려는 것이라 1.0배로 자르면 안 된다."""
        start = self.source.index('def probe_ratios(')
        body = self.source[start:self.source.index('\ndef save_probe(', start)]
        self.assertNotIn('< prev_volume', body)
        self.assertIn('MIN_PREV_VOLUME', body)  # 껍데기 종목 하한은 그대로 건다

    def test_probe_file_is_ignored_when_stale(self):
        """어제 관측 파일이 남아 있어도 오늘 결과와 섞이면 안 된다."""
        start = self.source.index('def load_probe():')
        body = self.source[start:self.source.index('\ndef log_probe_comparison(', start)]
        self.assertIn("payload.get('date') != today_kst()", body)

    def test_main_scan_logs_the_five_minute_comparison(self):
        self.assertIn('log_probe_comparison(matches)', self.source)

    def test_probe_timer_runs_five_minutes_before_the_main_scan(self):
        self.assertIn('OnCalendar=Mon..Fri *-*-* 00:05:00', self.setup)   # 09:05 KST
        self.assertIn('OnCalendar=Mon..Fri *-*-* 00:10:00', self.setup)   # 09:10 KST
        self.assertIn('volume_breakout_scan.py --probe', self.setup)

    def test_both_timers_are_enabled(self):
        self.assertIn('kiwoom-volumebreakout.timer kiwoom-volumebreakout-probe.timer', self.setup)


if __name__ == '__main__':
    unittest.main()
