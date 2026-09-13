# -*- coding: utf-8 -*-
"""VM 배포 스크립트의 재시작 범위 계약(2026-09-14).

master가 바뀔 때마다(js/css만 바뀐 커밋도) FastAPI를 재시작하고 검색 스캔을 다시 돌려, 연속
머지 때 WebSocket이 끊기고 1코어 VM이 무거워졌다. VM이 실행하거나 로컬에서 읽는 경로가 바뀐
커밋에만 재시작한다. test/test_news_momentum.py도 이 스크립트를 보지만 fcntl 때문에 Windows에서
수집되지 않아, 이 계약은 어디서나 도는 별도 파일에 둔다.
"""

import os
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
        self.assertIn('if [ "$DEPLOY_OCCURRED" = "1" ]; then\n    run_search_scan_refresh_after_deploy', self.block)
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

    @unittest.skipUnless(os.name != 'nt' and shutil.which('bash'), 'Linux bash에서만 구문 검사')
    def test_script_parses(self):
        subprocess.run(['bash', '-n', SCRIPT], check=True)


if __name__ == '__main__':
    unittest.main()
