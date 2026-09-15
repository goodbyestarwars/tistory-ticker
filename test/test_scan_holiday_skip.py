# -*- coding: utf-8 -*-
"""휴장일에는 스캔을 건너뛴다(2026-09-16).

사용자 지시: "휴장은 쉬게 하자". 스캔은 끝날 때 자기 몫의 결과를 통째로 덮어쓰므로, 휴장일에 그냥 돌면
차트검색·전략검색 목록이 직전 거래일 것과 달라지거나 비어버릴 수 있다. 건너뛰면 직전 거래일 결과가 남는다.
"""

import os
import re
import sys
import unittest
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLOUD_VM = os.path.join(ROOT, 'scripts', 'cloud-vm')
sys.path.insert(0, CLOUD_VM)

import market_clock  # noqa: E402

KST = timezone(timedelta(hours=9))

# 타이머가 도는 스크립트 - 스캔 결과를 덮어쓰는 것만. 배포 직후 재스캔(rescan_patterns.py)은
# 저장된 일봉으로 다시 계산만 하므로(목록을 비우지 않음) 그대로 둔다.
GUARDED_SCRIPTS = ('daily_scan.py', 'angle_momentum_scan.py', 'gongpasan_scan.py',
                   'volume_breakout_scan.py', 'week52_scan.py', 'strategy_scan.py')


def kst(y, mo, d, h=20, mi=10):
    return datetime(y, mo, d, h, mi, tzinfo=KST)


class SkipScanTodayTests(unittest.TestCase):
    def tearDown(self):
        os.environ.pop(market_clock.SCAN_FORCE_ENV, None)

    def test_trading_day_runs(self):
        skip, day = market_clock.skip_scan_today(kst(2026, 9, 16))
        self.assertFalse(skip)
        self.assertEqual(day, '2026-09-16')

    def test_weekend_and_holiday_skip(self):
        for when, label in ((kst(2026, 9, 19), '토요일'), (kst(2026, 9, 20), '일요일'),
                            (kst(2026, 9, 24), '추석 연휴(평일)')):
            skip, _ = market_clock.skip_scan_today(when)
            self.assertTrue(skip, label)

    def test_force_env_runs_even_on_holiday(self):
        os.environ[market_clock.SCAN_FORCE_ENV] = '1'
        skip, _ = market_clock.skip_scan_today(kst(2026, 9, 19))
        self.assertFalse(skip)

    def test_uses_the_single_holiday_table(self):
        import market_temp
        self.assertFalse(market_temp.is_kr_trading_day(kst(2026, 9, 24)))
        self.assertTrue(market_temp.is_kr_trading_day(kst(2026, 9, 16)))


class ScanScriptsGuardTests(unittest.TestCase):
    def test_every_timer_scan_skips_closed_days_before_doing_work(self):
        for name in GUARDED_SCRIPTS:
            with self.subTest(script=name):
                with open(os.path.join(CLOUD_VM, name), encoding='utf-8') as handle:
                    source = handle.read()
                self.assertIn('import market_clock', source)
                body = source[source.index('\ndef main():\n'):]
                self.assertIn('market_clock.skip_scan_today()', body)
                # 가드가 실제 작업(저장·API 호출)보다 먼저여야 의미가 있다.
                guard_at = body.index('market_clock.skip_scan_today()')
                for token in ('daily_scan_cache.update', 'db_schema.get_conn', 'requests', 'urlopen'):
                    if token in body:
                        self.assertLess(guard_at, body.index(token), '%s: %s' % (name, token))
                self.assertIn("log('휴장일(%s) - 스캔을 건너뜁니다(직전 거래일 결과 유지).' % scan_day)", body)

    def test_post_deploy_rescan_stays_unguarded(self):
        with open(os.path.join(CLOUD_VM, 'rescan_patterns.py'), encoding='utf-8') as handle:
            self.assertNotIn('skip_scan_today', handle.read())

    def test_timer_units_are_unchanged_calendar(self):
        # 건너뛰기는 스크립트가 판단한다 - 타이머 시각(20:10 KST 등)은 그대로 둔다.
        with open(os.path.join(CLOUD_VM, 'setup_dailyscan_timer.sh'), encoding='utf-8') as handle:
            self.assertIn('OnCalendar=*-*-* 11:10:00', handle.read())
        with open(os.path.join(CLOUD_VM, 'setup_volumebreakout_timer.sh'), encoding='utf-8') as handle:
            self.assertIsNotNone(re.search(r'OnCalendar=Mon\.\.Fri \*-\*-\* 00:10:00', handle.read()))


if __name__ == '__main__':
    unittest.main()
