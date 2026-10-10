# -*- coding: utf-8 -*-
"""봇 단일 실행 보장(PID 잠금 파일 + 생존 갱신).

작업 스케줄러 감시 작업(AutotraderBot)이 5분마다 봇을 켜려고 시도해도, 이미 살아 있으면 새 프로세스는 조용히 끝난다.
- 잠금 파일(bot.lock)에 PID 를 적고 30초마다 수정 시각을 갱신한다.
- 다른 프로세스가 살아 있고 잠금이 STALE_SEC 안에 갱신됐으면 점유 중으로 본다. PID 가 죽었거나 갱신이 끊겼으면(강제 종료·재부팅) 인계한다.
"""
import os
import threading
import time

STALE_SEC = 180
TOUCH_SEC = 30


def pid_alive(pid):
    if pid <= 0:
        return False
    if os.name == 'nt':
        # 이미 종료된 프로세스라도 누군가(작업 스케줄러·부모 프로세스)가 핸들을 쥐고 있으면 OpenProcess 가 성공한다.
        # 그래서 종료 코드가 STILL_ACTIVE(259)인지까지 확인해야 죽은 PID 를 '실행 중'으로 오판하지 않는다.
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        kernel.GetExitCodeProcess.argtypes = (wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD))
        kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
        handle = kernel.OpenProcess(0x1000, False, pid)                  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        code = wintypes.DWORD()
        ok = kernel.GetExitCodeProcess(handle, ctypes.byref(code))
        kernel.CloseHandle(handle)
        return bool(ok) and code.value == 259
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def held_by_other(path, now=None):
    """다른 살아 있는 프로세스가 잠금을 쥐고 있으면 그 PID, 아니면 None."""
    now = time.time() if now is None else now
    if not os.path.exists(path):
        return None
    try:
        pid = int(open(path).read().strip() or 0)
        fresh = now - os.path.getmtime(path) < STALE_SEC
    except (OSError, ValueError):
        return None
    return pid if pid and pid != os.getpid() and fresh and pid_alive(pid) else None


class InstanceLock:
    def __init__(self, path):
        self.path = path
        self._stop = threading.Event()
        self._thread = None

    def acquire(self):
        if held_by_other(self.path) is not None:
            return False
        with open(self.path, 'w') as f:
            f.write(str(os.getpid()))
        self._thread = threading.Thread(target=self._touch, name='lock-keeper', daemon=True)
        self._thread.start()
        return True

    def _touch(self):
        while not self._stop.wait(TOUCH_SEC):
            try:
                os.utime(self.path, None)
            except OSError:
                pass

    def release(self):
        self._stop.set()
        try:
            if os.path.exists(self.path) and int(open(self.path).read().strip() or 0) == os.getpid():
                os.remove(self.path)
        except (OSError, ValueError):
            pass
