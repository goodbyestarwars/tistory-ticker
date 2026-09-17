# -*- coding: utf-8 -*-
"""스윙 추천 결과 채우기를 daily_scan에서 떼어낸 계약(2026-09-18).

증상: `kiwoom-dailyscan.service`가 `activating(start-post)`으로 **3시간 36분** 남아 있었다.
스캔 자체는 14:57:58에 끝나 캐시까지 저장했는데, `ExecStartPost`가 공용 잠금을 기다리고
있었다. daily_scan이 잠금을 놓는 순간 이미 줄 서 있던 batch_scan이 가져가기 때문이다.

그대로 두면 두 가지가 잘못된다.
  1) 07:30 마감 리퍼는 `activating` 유닛을 멈춘다(그게 원래 할 일이다). 줄이 길었던 날은
     후속 작업이 한 번도 못 돌고 죽는다.
  2) 유닛 상태만으로는 스캔 중인지 후속 대기 중인지 구분할 수 없다.

잠금은 그대로 둔다. 2026-09-17에 잠금 밖에서 돌렸다가 strategy_scan과 동시에 실행돼
1GB VM의 스왑을 전부 소진하고 API가 몇 시간 죽었다. 대신 기다림에 상한을 둔다.
"""

import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLOUD_VM = os.path.join(ROOT, 'scripts', 'cloud-vm')


def read(name):
    with open(os.path.join(CLOUD_VM, name), encoding='utf-8') as handle:
        return handle.read()


def minutes(body):
    """OnCalendar의 UTC 시각을 분으로."""
    match = re.search(r'^OnCalendar=\*-\*-\* (\d+):(\d+)', body, re.M)
    return int(match.group(1)) * 60 + int(match.group(2))


def directives(name):
    """주석을 뺀 실제 설정 줄만. 주석에는 옮긴 사정을 적어 두므로 이름이 그대로 나온다."""
    lines = [line for line in read(name).splitlines()
             if line.strip() and not line.lstrip().startswith('#')]
    return os.linesep.join(lines)


class DailyScanIsNoLongerBlockedTest(unittest.TestCase):
    def setUp(self):
        self.dailyscan = directives('setup_dailyscan_timer.sh')

    def test_daily_scan_has_no_post_step_left(self):
        """이게 이번 수정의 핵심이다. 후속 작업이 붙어 있으면 유닛이 또 물린다."""
        self.assertNotIn('ExecStartPost', self.dailyscan)

    def test_daily_scan_no_longer_runs_the_monitor(self):
        self.assertNotIn('monitor_swing_recommendations.py', self.dailyscan)

    def test_daily_scan_still_takes_the_serial_lock(self):
        """스캔 본체의 직렬화는 그대로다 - 1코어 VM에서 여러 스캔이 겹치면 안 된다."""
        self.assertIn('/usr/bin/flock $HOME_DIR/.scan_serial.lock', self.dailyscan)
        self.assertIn('daily_scan.py', self.dailyscan)


class SwingMonitorUnitTest(unittest.TestCase):
    def setUp(self):
        self.setup = read('setup_swingmonitor_timer.sh')

    def test_it_runs_the_monitor(self):
        self.assertIn('monitor_swing_recommendations.py', self.setup)

    def test_it_still_holds_the_serial_lock(self):
        """2026-09-17 OOM의 교훈. 잠금 밖으로 내보내면 안 된다."""
        self.assertIn('.scan_serial.lock', self.setup)

    def test_the_wait_is_bounded(self):
        """무한 대기는 유닛을 몇 시간씩 activating으로 잡아 둔다 - 그게 원래 문제였다."""
        match = re.search(r'flock -w (\d+) -E (\d+) ', self.setup)
        self.assertIsNotNone(match, 'flock에 -w(대기 상한)와 -E(건너뜀 종료코드)가 있어야 한다')
        wait_seconds, exit_code = int(match.group(1)), int(match.group(2))
        self.assertLessEqual(wait_seconds, 3600, '한 시간 넘게 기다리면 뗀 의미가 없다')
        self.assertGreater(wait_seconds, 0)
        self.assertEqual(exit_code, 76, 'deploy_check.sh와 같은 "잠금 바빠서 건너뜀" 코드')

    def test_skipping_is_not_reported_as_a_failure(self):
        """건너뛴 날을 failed로 남기면 진짜 실패를 못 알아본다. 이 작업은 내일 또 돈다."""
        self.assertIn('SuccessExitStatus=76', self.setup)

    def test_it_is_deprioritised_like_the_other_scans(self):
        for line in ('Nice=10', 'CPUWeight=20', 'IOSchedulingClass=idle'):
            self.assertIn(line, self.setup, line)

    def test_it_runs_right_after_the_reaper_clears_the_lock(self):
        """"줄이 빌 시각"을 달력으로 맞히는 건 못 믿는다.

        2026-09-17 실측: batch_scan이 펀더멘탈 구간에서 종목당 17초씩 쓰며 10시간 넘게
        잠금을 쥐었다. 리퍼가 남은 스캔을 멈추고 잠금까지 정리한 직후가, 하루 중 잠금이
        비어 있음이 보장되는 유일한 순간이다.
        """
        mine = minutes(self.setup)
        reaper = minutes(read('setup_scanreaper_timer.sh'))
        self.assertGreater(mine, reaper, '리퍼보다 앞서면 아직 batch가 잠금을 쥐고 있다')
        self.assertLessEqual(mine - reaper, 60, '리퍼 직후여야 한다 - 멀어질수록 딴 게 끼어든다')

    def test_it_finishes_before_the_market_opens(self):
        """09:00 KST 개장, 09:05 거래량 돌파 관측(00:05 UTC)보다 앞서야 장중과 안 겹친다."""
        self.assertLess(minutes(self.setup), 24 * 60, '자정(UTC)을 넘기면 관측 타이머와 겹친다')


class WiringTest(unittest.TestCase):
    def test_deploy_check_installs_the_new_timer(self):
        """목록에 없으면 이미 깔린 VM에는 새 타이머가 영영 안 닿는다(volumebreakout 전례)."""
        match = re.search(r'^  for name in (.+); do$', read('deploy_check.sh'), re.M)
        self.assertIn('swingmonitor', match.group(1).split())

    def test_the_reaper_covers_the_new_unit(self):
        """이 유닛도 같은 잠금을 쥔다. 마감 때 남아 있으면 같이 정리해야 한다."""
        match = re.search(r'^for unit in (.+); do$', read('setup_scanreaper_timer.sh'), re.M)
        self.assertIn('swingmonitor', match.group(1).split())

    def test_the_old_post_step_is_gone_everywhere(self):
        """다른 유닛에 같은 방식으로 다시 붙지 않았는지 훑는다."""
        for name in sorted(os.listdir(CLOUD_VM)):
            if name.startswith('setup_') and name.endswith('.sh'):
                if 'monitor_swing_recommendations.py' in directives(name):
                    self.assertEqual(name, 'setup_swingmonitor_timer.sh', name)


if __name__ == '__main__':
    unittest.main()
