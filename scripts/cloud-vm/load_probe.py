# -*- coding: utf-8 -*-
"""VM 부하를 접속 없이 보는 읽기 전용 스냅샷(/health/load).

2026-09-15 사용자 지시("서버 부하를 낮춰야해", "부하 걸리는 작업은 전부 새벽으로 하고 장 시작은
뉴스 + 시세 정도만 계속 업데이트 하면 될꺼 같은데(추측이야)"). 전날 밤 장애 때 SSH가 열리지 않아
무엇이 CPU·메모리를 쓰는지 끝내 확인하지 못했다. 추측으로 기능을 끄지 않도록 근거를 먼저 모은다.

- 시스템: load average, 메모리·스왑(/proc/meminfo)
- FastAPI 프로세스: RSS, 스레드별 누적 CPU 초(스레드 이름은 threading 이름으로 붙인다)
- 같은 VM의 다른 파이썬 프로세스(스캔·배치 등): 스크립트 파일 이름, RSS, 누적 CPU 초, 경과 초

CPU 초는 누적값이다. 두 번 불러 차이를 보면 그 사이 무엇이 CPU를 썼는지 알 수 있다.
명령줄 인자는 내보내지 않고 .py 파일 이름만 쓴다(인자에 민감한 값이 들어갈 수 있으므로).
리눅스 /proc가 없으면 available=False만 돌려준다.
"""

import os
import threading
import time

TOP_THREADS = 12
TOP_PROCESSES = 10


def _read(path):
    try:
        with open(path, 'r', encoding='utf-8', errors='replace') as handle:
            return handle.read()
    except OSError:
        return None


def _clock_ticks():
    try:
        return os.sysconf('SC_CLK_TCK')
    except (AttributeError, ValueError, OSError):
        return 100


def _parse_stat(text):
    """/proc/<pid>/stat → (utime+stime 틱, starttime 틱). comm에 공백·괄호가 있어도 마지막 ')' 뒤부터 센다."""
    if not text or ')' not in text:
        return None, None
    fields = text[text.rindex(')') + 2:].split()
    # fields[0]은 원래 3번째 필드(state). utime=14, stime=15, starttime=22 → 인덱스 11, 12, 19.
    try:
        return int(fields[11]) + int(fields[12]), int(fields[19])
    except (IndexError, ValueError):
        return None, None


def _status_kb(text, key):
    for line in (text or '').splitlines():
        if line.startswith(key + ':'):
            parts = line.split()
            if len(parts) >= 2 and parts[1].isdigit():
                return int(parts[1])
    return None


def _meminfo(proc_root):
    text = _read(os.path.join(proc_root, 'meminfo')) or ''
    out = {}
    for key, name in (('MemTotal', 'memTotalMb'), ('MemAvailable', 'memAvailableMb'),
                      ('SwapTotal', 'swapTotalMb'), ('SwapFree', 'swapFreeMb')):
        kb = _status_kb(text, key)
        out[name] = round(kb / 1024.0, 1) if kb is not None else None
    return out


def _uptime_sec(proc_root):
    text = _read(os.path.join(proc_root, 'uptime'))
    try:
        return float(text.split()[0])
    except (AttributeError, IndexError, ValueError):
        return None


def snapshot(proc_root='/proc', self_pid=None, thread_names=None):
    if not os.path.isdir(os.path.join(proc_root, 'self' if self_pid is None else str(self_pid))):
        return {'available': False}
    ticks = float(_clock_ticks())
    self_dir = os.path.join(proc_root, 'self' if self_pid is None else str(self_pid))
    uptime = _uptime_sec(proc_root)

    loadavg = None
    text = _read(os.path.join(proc_root, 'loadavg'))
    if text:
        try:
            loadavg = [float(value) for value in text.split()[:3]]
        except ValueError:
            loadavg = None

    if thread_names is None:
        thread_names = {getattr(t, 'native_id', None): t.name for t in threading.enumerate()}

    threads = []
    task_dir = os.path.join(self_dir, 'task')
    try:
        task_ids = os.listdir(task_dir)
    except OSError:
        task_ids = []
    for tid in task_ids:
        cpu, _start = _parse_stat(_read(os.path.join(task_dir, tid, 'stat')))
        if cpu is None:
            continue
        comm = (_read(os.path.join(task_dir, tid, 'comm')) or '').strip()
        name = thread_names.get(int(tid)) if tid.isdigit() else None
        threads.append({'tid': int(tid) if tid.isdigit() else tid,
                        'name': name or comm or '?', 'cpuSec': round(cpu / ticks, 1)})
    threads.sort(key=lambda row: -row['cpuSec'])

    status = _read(os.path.join(self_dir, 'status'))
    rss_kb = _status_kb(status, 'VmRSS')
    self_cpu, _self_start = _parse_stat(_read(os.path.join(self_dir, 'stat')))

    try:
        my_pid = int(os.path.basename(os.path.realpath(self_dir))) if self_pid is None else int(self_pid)
    except ValueError:
        my_pid = None

    others = []
    try:
        entries = os.listdir(proc_root)
    except OSError:
        entries = []
    for entry in entries:
        if not entry.isdigit() or (my_pid is not None and int(entry) == my_pid):
            continue
        raw = _read(os.path.join(proc_root, entry, 'cmdline'))
        if not raw:
            continue
        args = [part for part in raw.split('\x00') if part]
        if not args or 'python' not in os.path.basename(args[0]):
            continue
        script = next((os.path.basename(part) for part in args[1:] if part.endswith('.py')), None)
        if not script:
            continue
        cpu, start = _parse_stat(_read(os.path.join(proc_root, entry, 'stat')))
        rss = _status_kb(_read(os.path.join(proc_root, entry, 'status')), 'VmRSS')
        others.append({
            'pid': int(entry),
            'script': script,
            'rssMb': round(rss / 1024.0, 1) if rss is not None else None,
            'cpuSec': round(cpu / ticks, 1) if cpu is not None else None,
            'elapsedSec': round(uptime - start / ticks) if (uptime is not None and start is not None) else None,
        })
    others.sort(key=lambda row: -(row['cpuSec'] or 0))

    return {
        'available': True,
        'sampledAt': time.time(),
        'loadAvg': loadavg,
        'memory': _meminfo(proc_root),
        'process': {
            'rssMb': round(rss_kb / 1024.0, 1) if rss_kb is not None else None,
            'cpuSec': round(self_cpu / ticks, 1) if self_cpu is not None else None,
            'threadCount': len(threads),
        },
        'topThreads': threads[:TOP_THREADS],
        'otherPythonProcesses': others[:TOP_PROCESSES],
    }
