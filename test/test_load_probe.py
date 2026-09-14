# -*- coding: utf-8 -*-
"""/health/load 스냅샷 계약(2026-09-15). 가짜 /proc 트리로 파싱을 확인한다(Windows에서도 돈다)."""

import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLOUD_VM = os.path.join(ROOT, 'scripts', 'cloud-vm')
sys.path.insert(0, CLOUD_VM)

import load_probe  # noqa: E402


def stat_line(pid, comm, utime, stime, starttime):
    # pid (comm) state ppid pgrp session tty tpgid flags minflt cminflt majflt cmajflt utime stime
    # cutime cstime priority nice num_threads itrealvalue starttime ...
    fields = ['S', '1', '1', '1', '0', '-1', '0', '0', '0', '0', '0', str(utime), str(stime),
              '0', '0', '20', '0', '1', '0', str(starttime), '0', '0']
    return '%s (%s) %s\n' % (pid, comm, ' '.join(fields))


class LoadProbeTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.write('loadavg', '1.50 0.80 0.40 2/180 12345\n')
        self.write('uptime', '1000.00 900.00\n')
        self.write('meminfo', 'MemTotal:        1000000 kB\nMemAvailable:     250000 kB\n'
                              'SwapTotal:             0 kB\nSwapFree:              0 kB\n')
        # FastAPI 프로세스(pid 100) + 스레드 두 개
        self.write('100/stat', stat_line(100, 'python3', 500, 100, 1000))
        self.write('100/status', 'Name:\tpython3\nVmRSS:\t  307200 kB\n')
        self.write('100/cmdline', '/venv/bin/python\x00-m\x00uvicorn\x00main:app\x00')
        self.write('100/task/100/stat', stat_line(100, 'python3', 300, 50, 1000))
        self.write('100/task/100/comm', 'python3\n')
        self.write('100/task/101/stat', stat_line(101, 'market temp) x', 150, 50, 1000))
        self.write('100/task/101/comm', 'python3\n')
        # 스캔 프로세스(pid 200) - 인자에 민감한 값이 있어도 스크립트 이름만 나가야 한다
        self.write('200/stat', stat_line(200, 'python', 4000, 1000, 50000))
        self.write('200/status', 'VmRSS:\t  512000 kB\n')
        self.write('200/cmdline', '/venv/bin/python\x00/home/app/daily_scan.py\x00--token=SECRET\x00')
        # 파이썬이 아닌 프로세스는 제외
        self.write('300/cmdline', '/usr/sbin/nginx\x00')

    def write(self, rel, text):
        path = os.path.join(self.root, *rel.split('/'))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8', newline='') as handle:
            handle.write(text)

    def snap(self):
        original = load_probe._clock_ticks
        load_probe._clock_ticks = lambda: 100
        try:
            return load_probe.snapshot(proc_root=self.root, self_pid=100, thread_names={101: 'market-temp'})
        finally:
            load_probe._clock_ticks = original

    def test_system_and_process_numbers(self):
        snap = self.snap()
        self.assertTrue(snap['available'])
        self.assertEqual(snap['loadAvg'], [1.5, 0.8, 0.4])
        self.assertEqual(snap['memory']['memTotalMb'], 976.6)
        self.assertEqual(snap['memory']['memAvailableMb'], 244.1)
        self.assertEqual(snap['memory']['swapTotalMb'], 0.0)
        self.assertEqual(snap['process']['rssMb'], 300.0)
        self.assertEqual(snap['process']['cpuSec'], 6.0)
        self.assertEqual(snap['process']['threadCount'], 2)

    def test_threads_are_named_and_sorted_by_cpu(self):
        threads = self.snap()['topThreads']
        self.assertEqual([t['cpuSec'] for t in threads], [3.5, 2.0])
        # comm에 괄호·공백이 섞여도 파싱되고, threading 이름이 붙는다.
        self.assertEqual(threads[1]['name'], 'market-temp')

    def test_other_python_processes_show_script_name_only(self):
        others = self.snap()['otherPythonProcesses']
        self.assertEqual(len(others), 1)
        scan = others[0]
        self.assertEqual(scan['script'], 'daily_scan.py')
        self.assertEqual(scan['rssMb'], 500.0)
        self.assertEqual(scan['cpuSec'], 50.0)
        self.assertEqual(scan['elapsedSec'], 500)
        self.assertNotIn('SECRET', repr(others))

    def test_missing_proc_is_reported_as_unavailable(self):
        self.assertEqual(load_probe.snapshot(proc_root=os.path.join(self.root, 'nope')), {'available': False})


class LoadEndpointWiringTests(unittest.TestCase):
    def test_endpoint_is_public_rate_limited_and_uses_the_probe(self):
        with open(os.path.join(CLOUD_VM, 'main.py'), encoding='utf-8') as handle:
            main = handle.read()
        start = main.index("@app.get('/health/load')")
        body = main[start:main.index('\n\n\n', start)]
        self.assertIn("_check_rate_limit('health_load', request", body)
        self.assertIn('load_probe.snapshot()', body)


if __name__ == '__main__':
    unittest.main()
