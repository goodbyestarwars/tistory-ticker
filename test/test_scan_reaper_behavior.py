# -*- coding: utf-8 -*-
"""07:30 마감 리퍼가 실제로 무엇을 멈추는지 확인한다(2026-09-17 첫 실전에서 드러난 버그).

스캔 유닛은 전부 Type=oneshot이라 ExecStart가 도는 동안 ActiveState가 "active"가 아니라
"activating"이다. 처음 구현은 `systemctl is-active --quiet`로 판정해서, batch_scan이
2,276/3,913까지 돌고 있는데도 "실행 중인 스캔 없음"을 찍고 유닛 중단을 건너뛰었다.
마감을 실제로 지킨 건 뒤의 잠금 정리(fuser -k)였고, 그 경로로 죽은 유닛은 failed로 남았다.

여기서는 setup 스크립트가 설치할 리퍼 본문을 그대로 꺼내 가짜 systemctl과 함께 돌린다.
"""

import os
import shutil
import stat
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETUP = os.path.join(ROOT, 'scripts', 'cloud-vm', 'setup_scanreaper_timer.sh')
UNITS = ['dailyscan', 'strategyscan', 'anglemomentumscan', 'gongpasanscan', 'week52', 'batch']


def find_bash():
    """실제로 동작하는 bash를 찾는다.

    윈도우에서는 PATH의 bash가 System32\\bash.exe(WSL 껍데기)로 잡히는 일이 흔하고, 배포판이
    설치돼 있지 않으면 안내문만 찍고 실패한다. Git Bash를 먼저 보고, 후보를 실제로 한 번
    돌려서 확인한다.
    """
    candidates = []
    git = shutil.which('git')
    if git:  # <git>/cmd/git.exe 또는 <git>/bin/git.exe 옆의 bin/bash
        candidates.append(os.path.join(os.path.dirname(os.path.dirname(git)), 'bin', 'bash.exe'))
    candidates.append(shutil.which('bash'))
    for candidate in candidates:
        if not candidate or not os.path.exists(candidate):
            continue
        try:
            probe = subprocess.run([candidate, '-c', 'echo __ok__'], capture_output=True,
                                   encoding='utf-8', errors='replace', timeout=20)
        except Exception:
            continue
        if probe.returncode == 0 and '__ok__' in (probe.stdout or ''):
            return candidate
    return None


BASH = find_bash()


def reaper_body():
    """setup 스크립트 안의 따옴표 heredoc(REAPEREOF) 본문을 꺼낸다."""
    with open(SETUP, 'r', encoding='utf-8') as handle:
        text = handle.read()
    start = text.index("<< 'REAPEREOF'\n") + len("<< 'REAPEREOF'\n")
    end = text.index('\nREAPEREOF\n', start)
    return text[start:end]


class ReaperContractTest(unittest.TestCase):
    """어디서나 도는 텍스트 계약 - activating을 놓치는 구현으로 되돌아가지 않게 한다."""

    def setUp(self):
        self.body = reaper_body()

    def test_activating_units_are_stopped(self):
        self.assertIn('active|activating|reloading)', self.body)
        self.assertNotIn('is-active', self.body)

    def test_all_scan_units_are_covered(self):
        for unit in UNITS:
            self.assertIn(unit, self.body)

    def test_lock_holders_are_cleaned_after_units(self):
        self.assertLess(self.body.index('systemctl stop'), self.body.index('fuser -k -TERM'))
        self.assertLess(self.body.index('fuser -k -TERM'), self.body.index('fuser -k -KILL'))

    def test_exec_start_is_resolved_at_install_time(self):
        r"""설치된 유닛의 ExecStart에 $가 남으면 systemd 확장과 bash 확장이 겹쳐 판단이 어렵다.

        설치 스크립트의 $REAPER_BIN은 따옴표 없는 heredoc이라 지금 펼쳐져 유닛에는 경로만
        남는다. 반대로 \$ 로 escape한 변수나 $(...)는 유닛 파일까지 살아남으므로 쓰지 않는다.
        """
        with open(SETUP, 'r', encoding='utf-8') as handle:
            lines = [line for line in handle if line.startswith('ExecStart=')]
        self.assertEqual(len(lines), 1, lines)
        self.assertNotIn('\\$', lines[0])
        self.assertNotIn('$(', lines[0])


@unittest.skipUnless(BASH, '동작하는 bash가 있어야 실제 실행을 확인할 수 있다')
class ReaperRunTest(unittest.TestCase):
    """가짜 systemctl로 리퍼를 실제로 실행해 본다."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.bin = os.path.join(self.tmp, 'bin')
        os.makedirs(self.bin)
        self.lock = os.path.join(self.tmp, '.scan_serial.lock')
        open(self.lock, 'w').close()
        self._write(os.path.join(self.tmp, 'reaper.sh'), reaper_body())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    @staticmethod
    def _write(path, text, executable=False):
        with open(path, 'w', encoding='utf-8', newline='\n') as handle:
            handle.write(text)
        if executable:
            os.chmod(path, os.stat(path).st_mode | stat.S_IEXEC)

    def _stub(self, name, body):
        self._write(os.path.join(self.bin, name), '#!/bin/bash\n' + body, executable=True)

    def _run(self, activating, lock_held):
        self._stub('systemctl',
                   'if [ "$1" = show ]; then\n'
                   '  if [ "$5" = "kiwoom-' + activating + '.service" ]; then echo activating;'
                   ' else echo inactive; fi\n'
                   '  exit 0\n'
                   'fi\n'
                   'if [ "$1" = stop ]; then echo "STOP $2" >> "$CALLS"; exit 0; fi\n')
        self._stub('flock', 'exit %d\n' % (1 if lock_held else 0))
        self._stub('fuser', 'echo "FUSER $*" >> "$CALLS"; exit 0\n')
        self._stub('sleep', 'exit 0\n')  # 테스트에서 20초를 실제로 기다리지 않는다

        # PATH 구분자와 경로 표기가 플랫폼마다 달라(윈도우는 ';'와 'C:\') 환경을 bash 안에서
        # 꾸린다. Git Bash에서는 cygpath로 POSIX 경로로 바꾼다.
        harness = os.path.join(self.tmp, 'harness.sh')
        self._write(harness,
                    '#!/bin/bash\n'
                    'TMP="$1"\n'
                    'case "$TMP" in [A-Za-z]:*) TMP=$(cygpath -u "$TMP" 2>/dev/null || echo "$TMP");; esac\n'
                    'export PATH="$TMP/bin:$PATH"\n'
                    'export SCAN_HOME="$TMP" CALLS="$TMP/calls.log"\n'
                    'exec bash "$TMP/reaper.sh"\n')
        # 리퍼가 한국어를 찍는데 윈도우 기본 인코딩이 cp949라 text=True만으로는 깨진다.
        done = subprocess.run([BASH, harness, self.tmp], capture_output=True,
                              encoding='utf-8', errors='replace')
        self.assertEqual(done.returncode, 0, (done.stdout or '') + (done.stderr or ''))
        calls_path = os.path.join(self.tmp, 'calls.log')
        calls = ''
        if os.path.exists(calls_path):
            with open(calls_path, encoding='utf-8') as handle:
                calls = handle.read()
        return done.stdout, calls

    def test_stops_a_oneshot_scan_that_is_still_activating(self):
        out, calls = self._run(activating='batch', lock_held=False)
        self.assertIn('07:30 마감으로 중단: kiwoom-batch(activating)', out)
        self.assertIn('STOP kiwoom-batch.service', calls)
        self.assertNotIn('STOP kiwoom-dailyscan.service', calls)

    def test_quiet_night_stops_nothing(self):
        out, calls = self._run(activating='none', lock_held=False)
        self.assertIn('실행 중인 스캔 없음', out)
        self.assertNotIn('STOP', calls)
        self.assertNotIn('FUSER', calls)

    def test_lock_holder_is_termed_then_killed(self):
        out, calls = self._run(activating='none', lock_held=True)
        self.assertIn('잠금을 아직 쥔 프로세스가 있어 정리한다', out)
        self.assertIn('FUSER -k -TERM', calls)
        self.assertIn('FUSER -k -KILL', calls)


if __name__ == '__main__':
    unittest.main()
