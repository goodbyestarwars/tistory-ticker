"""Host-local kt00018 gate. No credentials, persistent timestamps or wall clock.

Hold an OS byte lock for the complete request; wait 550ms AFTER acquiring it.
Even after a killed owner the next owner waits a full gap before dispatch.
All participating Windows processes use the same ProgramData path, regardless
of checkout or credentials. Permission/lock errors fail closed. Never delete
the lock file while clients are running. Remote hosts/nonparticipants are not
covered. Serializing the full request intentionally prefers safety to latency.
"""
from contextlib import contextmanager
import errno
import os
from pathlib import Path
import time

GAP_SECONDS = 0.55
LOCK_TIMEOUT_SECONDS = 30.0


def lock_path():
    if os.name == 'nt':
        root = os.environ.get('PROGRAMDATA')
        if not root:
            raise RuntimeError('kt00018 shared gate unavailable')
        return Path(root) / '9Pay' / 'kiwoom-kt00018.lock'
    return Path('/tmp/9pay-kiwoom-kt00018.lock')


def _lock(stream):
    stream.seek(0)
    if os.name == 'nt':
        import msvcrt
        msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl
        fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)


def _unlock(stream):
    stream.seek(0)
    if os.name == 'nt':
        import msvcrt
        msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
    else:
        import fcntl
        fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


@contextmanager
def balance_request():
    path = lock_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    # Windows can lock a byte beyond EOF. No state initialization race.
    with open(path, 'a+b') as stream:
        deadline = time.monotonic() + LOCK_TIMEOUT_SECONDS
        while True:
            try:
                _lock(stream)
                break
            except OSError as exc:
                if exc.errno not in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                    raise RuntimeError('kt00018 shared gate unavailable') from None
                if time.monotonic() >= deadline:
                    raise RuntimeError('kt00018 shared gate timeout') from None
                time.sleep(0.025)
        try:
            until = time.monotonic() + GAP_SECONDS
            while True:
                remaining = until - time.monotonic()
                if remaining <= 0:
                    break
                time.sleep(remaining)
            yield
        finally:
            _unlock(stream)
