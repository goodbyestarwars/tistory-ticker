# -*- coding: utf-8 -*-
"""VM 배포 스크립트의 재시작 범위 계약(2026-09-14).

master가 바뀔 때마다(js/css만 바뀐 커밋도) FastAPI를 재시작하고 검색 스캔을 다시 돌려, 연속
머지 때 WebSocket이 끊기고 1코어 VM이 무거워졌다. VM이 실행하거나 로컬에서 읽는 경로가 바뀐
커밋에만 재시작한다. test/test_news_momentum.py도 이 스크립트를 보지만 fcntl 때문에 Windows에서
수집되지 않아, 이 계약은 어디서나 도는 별도 파일에 둔다.
"""

import os
import re
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, 'scripts', 'cloud-vm', 'deploy_check.sh')


class DeployRestartScopeTest(unittest.TestCase):
    def setUp(self):
        with open(SCRIPT, 'r', encoding='utf-8') as handle:
            self.script = handle.read()
        start = self.script.index('if [ "$LAST_DEPLOYED" != "$REMOTE" ]; then')
        # 바깥 if는 0열의 fi로 끝난다(안쪽 fi는 들여쓰기돼 있다).
        self.block = self.script[start:self.script.index('\nfi\n', start)]

    def test_watch_paths_cover_vm_code_and_locally_read_data(self):
        # sector_cards.py가 ../../data/sectors-v3.js를 로컬에서 읽는다.
        self.assertIn('VM_WATCH_PATHS="scripts/cloud-vm/ data/"', self.script)
        self.assertIn('git diff --quiet "$LAST_DEPLOYED" "$REMOTE" -- $VM_WATCH_PATHS', self.block)

    def test_restart_and_rescan_are_gated(self):
        gate = self.block.index('if [ "$VM_CODE_CHANGED" = "1" ]; then')
        self.assertLess(gate, self.block.index('cp "$APP_DIR"/scripts/cloud-vm/*.py "$APP_DIR"/'))
        self.assertLess(gate, self.block.index('sudo systemctl restart kiwoom-api'))
        self.assertLess(gate, self.block.index('post_deploy_check.py" --base-only'))
        self.assertIn('if [ "$DEPLOY_OCCURRED" = "1" ] && [ "$POST_CHECK" = "ok" ]; then'
                      '\n    run_search_scan_refresh_after_deploy', self.block)
        # 재시작하지 않았으면 뉴스 모멘텀의 배포 후 검증도 돌지 않게 기존 인자를 그대로 쓴다.
        self.assertIn('run_news_momentum_if_due "$DEPLOY_OCCURRED" || true', self.script)

    def test_unknown_previous_sha_falls_back_to_full_deploy(self):
        self.assertIn('VM_CODE_CHANGED=1', self.block)
        self.assertIn('git cat-file -e "${LAST_DEPLOYED}^{commit}"', self.block)
        self.assertLess(self.block.index('VM_CODE_CHANGED=1'), self.block.index('VM_CODE_CHANGED=0'))

    def test_deployed_sha_is_recorded_even_when_restart_is_skipped(self):
        # 기록하지 않으면 5분마다 같은 커밋을 다시 판정한다.
        record = self.block.index('printf \'%s\\n\' "$REMOTE" > "$DEPLOYED_FILE"')
        self.assertGreater(record, self.block.index('else\n    echo "VM 실행 경로'))

    def test_failed_post_check_still_records_the_sha(self):
        """2026-09-17: 점검 실패로 SHA가 안 남아 5분마다 재배포·재시작이 반복됐다.

        기동이 41~64초 걸리는데 점검 대기가 25초여서 배포마다 결정적으로 실패했고,
        set -e가 SHA 기록 앞에서 스크립트를 끊었다. 배포는 실제로 끝났으므로 기록한다.
        """
        check = self.block.index('post_deploy_check.py" --base-only')
        record = self.block.index('> "$DEPLOYED_FILE"')
        self.assertLess(check, record)
        self.assertIn('POST_CHECK=failed', self.block)
        # 점검 줄이 그대로 set -e에 걸려 스크립트를 끊으면 안 된다.
        self.assertNotIn('\n    "$PYTHON" "$APP_DIR/post_deploy_check.py" --base-only\n', self.block)
        self.assertIn('post_check=$POST_CHECK', self.block)

    def test_rescan_is_skipped_when_post_check_failed(self):
        """API가 성치 않은 상태에서 1코어 VM에 재스캔을 얹지 않는다."""
        self.assertIn('[ "$POST_CHECK" = "ok" ]', self.block)
        self.assertIn('POST_CHECK=skipped', self.script)

    def test_background_jobs_do_not_inherit_the_deploy_lock(self):
        """백그라운드 작업이 fd 200을 물려받으면 본체가 끝나도 배포 잠금이 안 풀린다(2026-09-14).

        flock은 같은 열린 파일을 가진 프로세스가 하나라도 남으면 유지된다. 배포 후 재스캔이
        돌던 20여 분 동안 다음 5분 회차가 전부 "진행 중"으로 건너뛰었다.
        """
        lines = self.script.splitlines()
        background = [line for line in lines if re.search(r'(^|[^&])&\s*$', line)]
        self.assertTrue(background, '백그라운드 실행 줄을 찾지 못했다')
        for line in background:
            self.assertIn('200>&-', line, '배포 잠금 fd를 닫지 않은 백그라운드 실행: ' + line.strip())
        # disown 개수와 백그라운드 실행 개수가 같아야 누락이 없다.
        self.assertEqual(len(background), self.script.count('disown'))

    def test_news_momentum_batch_runs_outside_the_deploy_lock(self):
        """전 종목 뉴스 모멘텀 배치(20분 슬라이스)가 배포 잠금을 쥔 채 전면에서 돌아
        하루 대부분 배포가 최대 20분씩 밀렸다(2026-09-14, VM fuser로 확인)."""
        start = self.script.index('run_news_momentum_if_due() {')
        body = self.script[start:self.script.index('\n}\n', start)]
        # 설명 주석에도 파일 이름이 나오므로 실제 실행 인자로 찾는다.
        scan = body.index('"$APP_DIR/news_momentum_scan.py"')
        opener = body.rindex('\n  (\n', 0, scan)
        closer = body.index('\n  ) 200>&- &\n  disown', scan)
        self.assertLess(opener, scan)
        self.assertLess(scan, closer)
        # 겹침은 배치 전용 잠금이 막는다(실행 중이면 75로 즉시 빠진다).
        self.assertIn('flock -n -E 75 "$MOMENTUM_LOCK"', body[opener:closer])

    def test_price_recap_cleanup_waits_for_the_momentum_lock(self):
        """배치가 백그라운드로 가면 같은 news_momentum.db를 동시에 쓸 수 있다."""
        start = self.script.index('run_price_recap_cleanup_once() {')
        body = self.script[start:self.script.index('\n}\n', start)]
        self.assertIn('flock -n "$MOMENTUM_LOCK" "$PYTHON" "$APP_DIR/cleanup_price_recap_topics.py"', body)

    def test_scan_timers_are_reinstalled_when_setup_script_changes(self):
        """설치 스크립트의 시각만 바꾸면 VM 유닛은 예전 시각 그대로였다(2026-09-14 스캔 시각 이동)."""
        start = self.script.index('ensure_scan_timers_current() {')
        body = self.script[start:self.script.index('\n}\n', start)]
        self.assertIn('for name in dailyscan strategyscan anglemomentumscan gongpasanscan week52 batch scanreaper; do', body)
        self.assertIn('sha256sum "$setup_script"', body)
        self.assertIn('sudo systemctl restart "kiwoom-${name}.timer"', body)
        # Persistent=true 타이머가 재시작 직후 "놓친 실행"을 한꺼번에 몰아 돌지 않게 stamp를 먼저 맞춘다.
        self.assertLess(body.index('sudo touch "/var/lib/systemd/timers/stamp-kiwoom-${name}.timer"'),
                        body.index('sudo systemctl restart "kiwoom-${name}.timer"'))
        # 성공했을 때만 해시 마커를 남겨 실패하면 다음 회차가 다시 시도한다.
        self.assertLess(body.index('sudo systemctl restart'), body.index('> "$marker"'))
        self.assertIn('ensure_scan_timers_current || true', self.script)
        for name in ('dailyscan', 'strategyscan', 'anglemomentumscan', 'gongpasanscan', 'week52', 'batch',
                     'scanreaper'):
            setup = os.path.join(ROOT, 'scripts', 'cloud-vm', 'setup_%s_timer.sh' % name)
            with open(setup, encoding='utf-8') as handle:
                self.assertIn('kiwoom-%s.timer' % name, handle.read(), setup)

    def test_post_deploy_rescan_skips_weekday_market_hours(self):
        """사용자 지시(2026-09-14): 20:00까지는 스캔을 돌리지 않는다."""
        start = self.script.index('run_search_scan_refresh_after_deploy() {')
        body = self.script[start:self.script.index('\n}\n', start)]
        gate = body.index('if [ "$kst_dow" -le 5 ] && [ "$kst_hm" -ge 800 ] && [ "$kst_hm" -lt 2000 ]; then')
        self.assertIn('kst_hm=$((10#$(TZ=Asia/Seoul date +%H%M)))', body)
        self.assertLess(gate, body.index('"$APP_DIR/rescan_patterns.py"'))
        self.assertLess(gate, body.index('"$APP_DIR/strategy_scan.py"'))

    def test_post_deploy_rescan_only_when_scan_rule_code_changed(self):
        """2026-09-15 /health/load 실측: 배포마다 도는 재스캔이 코어 약 50%, 수집기 전체는 약 1%."""
        start = self.script.index('run_search_scan_refresh_after_deploy() {')
        body = self.script[start:self.script.index('\n}\n', start)]
        gate = body.index('git diff --quiet "$LAST_DEPLOYED" "$REMOTE" -- $scan_rule_paths; then')
        self.assertLess(gate, body.index('"$APP_DIR/rescan_patterns.py"'))
        self.assertLess(gate, body.index('"$APP_DIR/strategy_scan.py"'))
        for path in ('scripts/cloud-vm/pattern_detect.py', 'scripts/cloud-vm/rescan_patterns.py',
                     'scripts/cloud-vm/strategy_scan.py', 'scripts/cloud-vm/invest_signal.py', 'data/'):
            self.assertIn(path, body)
        # 직전 SHA를 모르면 건너뛰지 않고 예전처럼 돈다.
        self.assertIn('if [ -n "${LAST_DEPLOYED:-}" ] && git cat-file -e "${LAST_DEPLOYED}^{commit}" 2>/dev/null', body)

    @unittest.skipUnless(os.name != 'nt' and shutil.which('bash'), 'Linux bash에서만 구문 검사')
    def test_script_parses(self):
        subprocess.run(['bash', '-n', SCRIPT], check=True)


if __name__ == '__main__':
    unittest.main()

    def test_heavy_jobs_share_one_scan_lock(self):
        """2026-09-17 장애: 밤새 스캔·후속작업·뉴스배치·야간정리가 겹쳐 스왑 2GB가 바닥났다.

        1GB VM이라 무거운 파이썬 작업은 한 번에 하나만 돌아야 한다. 겹칠 수 있는 진입점이
        모두 공용 잠금(.scan_serial.lock)을 거치는지 고정한다.
        """
        daily_unit = os.path.join(ROOT, 'scripts', 'cloud-vm', 'setup_dailyscan_timer.sh')
        with open(daily_unit, encoding='utf-8') as handle:
            unit = handle.read()
        # 차트검색 후속 작업(ExecStartPost)도 같은 잠금 안에서 줄 선다.
        self.assertIn('ExecStartPost=/usr/bin/flock $HOME_DIR/.scan_serial.lock', unit)
        # 뉴스 모멘텀 배치: 스캔이 돌면 기다리지 않고 건너뛴다(-n), 전용 잠금과 구분되는 종료코드.
        self.assertIn('flock -n -E 76 "$APP_DIR/.scan_serial.lock"', self.script)
        self.assertIn('뉴스 모멘텀 건너뜀: 스캔 실행 중(공용 잠금)', self.script)
        # 야간 유지보수도 같은 방식으로 겹치지 않는다.
        self.assertIn('flock -n -E 76 "$APP_DIR/.scan_serial.lock" "$PYTHON" "$APP_DIR/maintenance.py"',
                      self.script)
        self.assertIn('스캔 실행 중 - 장외 유지보수는 다음 회차로 미룸', self.script)

    def test_scan_deadline_reaper_is_installed(self):
        """사용자 기준(2026-09-17): "스캔은 07:30분까지는 끝내야 해".

        건너뛰지 않고 마감만 강제한다 - 07:30 KST(22:30 UTC)에 남아 있는 스캔을 정리한다.
        """
        self.assertIn('week52 batch scanreaper; do', self.script)
        reaper = os.path.join(ROOT, 'scripts', 'cloud-vm', 'setup_scanreaper_timer.sh')
        self.assertTrue(os.path.exists(reaper))
        with open(reaper, encoding='utf-8') as handle:
            script = handle.read()
        self.assertIn('OnCalendar=*-*-* 22:30:00', script)          # 07:30 KST
        self.assertIn('systemctl stop kiwoom-\\$unit.service', script)
        # 잠금을 쥔 채 죽지 않는 프로세스(2026-09-17 strategy_scan)가 있으면 그것까지 정리한다.
        self.assertIn('fuser -k -TERM', script)
        self.assertIn('fuser -k -KILL', script)
