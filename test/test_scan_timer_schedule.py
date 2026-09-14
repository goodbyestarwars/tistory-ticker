# -*- coding: utf-8 -*-
"""스캔·배치 타이머 시각 계약(2026-09-14).

사용자 지시: "20:00시까지는 스캔 돌리지마. 장 끝나고 돌려". 같은 날부터 KRX 애프터마켓과 NXT가
20:00까지 열려, 16:00~19:30에 돌던 스캔·배치가 거래가 끝나기 전에 돌고 있었다.
장중 스냅샷이 목적인 거래량 돌파(09:10)만 예외다.
"""

import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLOUD_VM = os.path.join(ROOT, 'scripts', 'cloud-vm')

# 이름: (UTC 시각, 설명). 타이머는 VM 시계(UTC) 기준이다. KST = UTC + 9시간.
EXPECTED = {
    'dailyscan': '11:10',          # 20:10 KST - 마감 10분 뒤, 그날 일봉을 채운다
    'strategyscan': '11:30',       # 20:30 KST - daily_scan이 채운 DB만 읽는다
    'anglemomentumscan': '11:35',  # 20:35 KST
    'gongpasanscan': '11:40',      # 20:40 KST
    'week52': '11:50',             # 20:50 KST - daily_scan의 daily_prices를 재사용
    'batch': '12:00',              # 21:00 KST - 섹터 풀 수급 배치
}


def on_calendar(name):
    with open(os.path.join(CLOUD_VM, 'setup_%s_timer.sh' % name), encoding='utf-8') as handle:
        match = re.search(r'^OnCalendar=(.+)$', handle.read(), re.M)
    return match.group(1).strip() if match else None


def kst_minutes(utc_hm):
    hour, minute = (int(part) for part in utc_hm.split(':'))
    return ((hour + 9) % 24) * 60 + minute


class ScanTimerScheduleTest(unittest.TestCase):
    def test_after_close_scans_use_the_new_slots(self):
        for name, utc_hm in EXPECTED.items():
            self.assertEqual(on_calendar(name), '*-*-* %s:00' % utc_hm, name)

    def test_no_after_close_scan_runs_before_2000_kst(self):
        for name, utc_hm in EXPECTED.items():
            self.assertGreaterEqual(kst_minutes(utc_hm), 20 * 60, name)

    def test_daily_scan_runs_before_the_scans_that_read_its_prices(self):
        daily = kst_minutes(EXPECTED['dailyscan'])
        for name in ('strategyscan', 'anglemomentumscan', 'gongpasanscan', 'week52', 'batch'):
            self.assertGreater(kst_minutes(EXPECTED[name]), daily, name)
        # 원래 간격(daily 뒤 20분, 이후 5분씩)을 유지한다 - daily_scan 소요시간 실측이 없어 검증된 간격을 쓴다.
        self.assertEqual(kst_minutes(EXPECTED['strategyscan']) - daily, 20)

    def test_scans_run_one_at_a_time_below_fastapi_priority(self):
        """2026-09-14 23:08 KST 장애: 스캔이 한꺼번에 떠 1코어 VM의 응답이 전부 멈췄다."""
        for name in EXPECTED:
            with open(os.path.join(CLOUD_VM, 'setup_%s_timer.sh' % name), encoding='utf-8') as handle:
                source = handle.read()
            self.assertIn('ExecStart=/usr/bin/flock $HOME_DIR/.scan_serial.lock $HOME_DIR/venv/bin/python ', source, name)
            for line in ('Nice=10', 'CPUWeight=20', 'IOSchedulingClass=idle'):
                self.assertIn(line + '\n', source, name)
        with open(os.path.join(CLOUD_VM, 'deploy_check.sh'), encoding='utf-8') as handle:
            deploy = handle.read()
        self.assertIn('flock "$APP_DIR/.scan_serial.lock" nice -n 10 "$PYTHON" "$APP_DIR/rescan_patterns.py"', deploy)
        self.assertIn('flock "$APP_DIR/.scan_serial.lock" nice -n 10 "$PYTHON" "$APP_DIR/strategy_scan.py"', deploy)
        # 이미 몰려 떠 있던 스캔은 새 유닛 설치 전에 한 번 멈추고, 돌고 있지 않으면 건드리지 않는다.
        start = deploy.index('stop_piled_up_scans_once() {')
        body = deploy[start:deploy.index('\n}\n', start)]
        # Type=oneshot 스캔은 실행 중 ActiveState가 activating이라 is-active로는 못 잡는다.
        self.assertIn('systemctl show -p ActiveState --value "kiwoom-${name}.service"', body)
        self.assertIn('if [ "$state" = "activating" ] || [ "$state" = "active" ]; then', body)
        self.assertNotIn('systemctl is-active', body)
        self.assertLess(deploy.index('stop_piled_up_scans_once || true'), deploy.index('ensure_scan_timers_current || true'))

    def test_intraday_volume_breakout_stays_at_0910_kst(self):
        # "개장 10분 만에 전일 거래량을 넘었는가"는 09:10에만 판정할 수 있다.
        self.assertEqual(on_calendar('volumebreakout'), 'Mon..Fri *-*-* 00:10:00')


if __name__ == '__main__':
    unittest.main()
