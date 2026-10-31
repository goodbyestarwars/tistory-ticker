"""One bounded VM job at a time; all deadlines use KST, commands are never logged."""
import argparse
from datetime import datetime, timedelta
import json
import logging
import os
from pathlib import Path
import signal
import subprocess
import time

import market_clock
from snapshot_io import atomic_json
from market_calendar import is_kr_trading_day

KST = market_clock.KST
# maxRun includes a 30-second graceful termination allowance.
CONTRACTS = {
    'dailyscan': dict(maxWait=21600, maxRun=21600, window='night', daily=False, trading=True),
    'etfstrategyscan': dict(maxWait=21600, maxRun=900, window='night', daily=True, trading=True),
    'anglemomentumscan': dict(maxWait=21600, maxRun=1800, window='night', daily=True, trading=True),
    'gongpasanscan': dict(maxWait=21600, maxRun=3600, window='night', daily=True, trading=True),
    'week52': dict(maxWait=21600, maxRun=900, window='night', daily=True, trading=True),
    'batch': dict(maxWait=21600, maxRun=10800, window='night', daily=True, trading=True),
    'strategyscan': dict(maxWait=21600, maxRun=7200, window='night', daily=True, trading=True),
    'maintenance': dict(maxWait=14400, maxRun=3600, window='maintenance', daily=False, trading=False),
    'swingmonitor': dict(maxWait=1800, maxRun=1800, window='morning', daily=False, trading=False),
    'volumebreakout': dict(maxWait=30, maxRun=300, window='open', daily=False, trading=True),
    'refresh-pattern': dict(maxWait=3600, maxRun=1800, window='off-hours', daily=False, trading=False),
    'refresh-strategy': dict(maxWait=3600, maxRun=7200, window='off-hours', daily=False, trading=False),
    'refresh-etf': dict(maxWait=3600, maxRun=900, window='off-hours', daily=False, trading=False),
}
CADENCE_KST = {
    'dailyscan': 'daily 20:10', 'etfstrategyscan': 'daily 20:30',
    'anglemomentumscan': 'daily 20:35', 'gongpasanscan': 'daily 20:40',
    'week52': 'daily 20:50', 'batch': 'daily 21:00', 'strategyscan': 'Monday 21:10',
    'maintenance': 'daily 03:00 (deploy timer)', 'swingmonitor': 'daily 07:45',
    'volumebreakout': 'Mon-Fri 09:05',
}
for _name, _policy in CONTRACTS.items():
    _policy.update(owner='VM systemd' if not _name.startswith('refresh-') else 'VM deploy',
                   cadenceKST=CADENCE_KST.get(_name, 'source change, off-hours only'),
                   prerequisite='completed daily snapshot for dataDate' if _policy['daily'] else 'none',
                   lock='per-job + scan_serial', retry='next scheduled run; no immediate retry',
                   holiday='skip' if _policy['trading'] else 'allowed',
                   priority='backup before cleanup' if _name == 'maintenance' else 'maintenance waiter first')


def session(now, window):
    now = now.astimezone(KST)
    minute = now.hour * 60 + now.minute
    basis = now if minute >= 1200 else now - timedelta(days=1)
    end = now.replace(hour=7, minute=20, second=0, microsecond=0)
    if window == 'night':
        return basis.date().isoformat(), (end + timedelta(days=1) if minute >= 1200 else end) if minute >= 1200 or minute < 440 else None
    if window == 'maintenance':
        return now.date().isoformat(), end if 180 <= minute < 440 else None
    if window == 'morning':
        return now.date().isoformat(), now.replace(hour=8, minute=15, second=0, microsecond=0) if 465 <= minute < 495 else None
    if window == 'open':
        return now.date().isoformat(), now.replace(hour=9, minute=20, second=0, microsecond=0) if 545 <= minute < 560 else None
    # Recomputing stored snapshots is also allowed on non-trading days.
    if is_kr_trading_day(now) and 440 <= minute < 1200:
        return now.date().isoformat(), None
    return basis.date().isoformat(), end + timedelta(days=1) if minute >= 440 else end


def write_status(folder, job, **values):
    import fcntl
    with open(folder / '.schedule_status.lock', 'a+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        target = folder / 'scheduled_jobs.json'
        try:
            data = json.loads(target.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            data = {}
        row = data.get(job, {})
        if values.get('state') == 'waiting':
            for key in ('startedAt', 'finishedAt', 'runSec', 'exitCode', 'waitSec'):
                row.pop(key, None)
        row.update(values)
        if values.get('state') == 'success':
            row['lastSuccessAt'] = values['finishedAt']
        data[job] = row
        atomic_json(target, data)


def report_progress(processed, total, phase, unit='종목'):
    """Optional telemetry, isolated per scheduled run; never blocks a scan on failure."""
    job = os.environ.get('NINEPAY_PROGRESS_JOB')
    started = os.environ.get('NINEPAY_PROGRESS_STARTED')
    if job not in CONTRACTS or not started:
        return
    try:
        atomic_json(Path(__file__).parent / ('scan_progress_' + job + '.json'), {
            'runStartedAt': started, 'updatedAt': stamp(), 'phase': phase,
            'processed': int(processed), 'total': int(total), 'unit': unit,
        })
    except (OSError, ValueError, TypeError):
        pass


def stamp():
    return datetime.now(KST).isoformat(timespec='seconds')


def try_lock(handle):
    import fcntl
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except BlockingIOError:
        return False


def maintenance_pending(folder):
    import fcntl
    with open(folder / '.off_hours_maintenance_trigger.lock', 'a+') as lock:
        if not try_lock(lock):
            return True
        fcntl.flock(lock, fcntl.LOCK_UN)
        return False


def stop_group(process, grace):
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=max(.01, grace))
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
    # A leader may exit on TERM while a child ignores it; clear remaining group.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


class Interrupted(Exception):
    pass


def run(job, command, folder, contract=None, grace=30, now=None):
    import fcntl
    folder = Path(folder)
    policy = dict(contract or CONTRACTS[job])
    now = now or (lambda: datetime.now(KST))
    basis, deadline = session(now(), policy['window'])
    def record(state, **extra):
        write_status(folder, job, state=state, dataDate=basis, finishedAt=stamp(), **extra)
        print('[schedule] ' + json.dumps(dict(job=job, state=state, dataDate=basis, **extra)), flush=True)
        level = logging.INFO if state in ('success', 'holiday', 'outside_window') else logging.WARNING
        logging.getLogger('schedule').log(level, json.dumps(dict(job=job, state=state, dataDate=basis, **extra)))
    if deadline is None:
        record('outside_window', exitCode=75)
        return 75
    if policy['trading'] and not is_kr_trading_day(datetime.fromisoformat(basis).replace(tzinfo=KST)):
        record('holiday', exitCode=0)
        return 0
    with open(folder / ('.schedule_%s.lock' % job), 'a+') as own:
        if not try_lock(own):
            print('[schedule] job=%s duplicate_skip=1' % job, flush=True)
            return 0
        queued = time.monotonic()
        write_status(folder, job, state='waiting', queuedAt=stamp(), dataDate=basis, contract=policy)
        with open(folder / '.scan_serial.lock', 'a+') as scan:
            while True:
                remaining = (deadline - now()).total_seconds()
                if remaining <= grace or time.monotonic() - queued >= policy['maxWait']:
                    record('wait_timeout', waitSec=round(time.monotonic()-queued, 3), exitCode=76)
                    return 76
                if job == 'maintenance' or not maintenance_pending(folder):
                    if try_lock(scan):
                        if job == 'maintenance' or not maintenance_pending(folder):
                            break
                        fcntl.flock(scan, fcntl.LOCK_UN)
                time.sleep(min(.5, max(.01, remaining-grace)))
            wait = round(time.monotonic()-queued, 3)
            if policy['daily']:
                import scan_prereq
                try:
                    snapshot = json.loads((folder / 'daily_scan_cache.json').read_text(encoding='utf-8'))
                except (OSError, ValueError):
                    snapshot = {}
                state, _ = scan_prereq.assess(now(), snapshot.get('generatedAt'), is_kr_trading_day, snapshot.get('dataDate'))
                if state != 'ready':
                    record('prerequisite_' + state, waitSec=wait, exitCode=75)
                    return 75
            budget = min(policy['maxRun'], (deadline-now()).total_seconds())
            if budget <= grace:
                record('deadline', waitSec=wait, exitCode=75)
                return 75
            env = dict(os.environ)
            if policy['window'] == 'night':
                env['NINEPAY_SCAN_DATA_DATE'] = basis
            run_started = stamp()
            env['NINEPAY_PROGRESS_JOB'] = job
            env['NINEPAY_PROGRESS_STARTED'] = run_started
            write_status(folder, job, state='running', startedAt=run_started, waitSec=wait, dataDate=basis)
            logging.getLogger('schedule').info(json.dumps(dict(job=job, state='running', dataDate=basis, waitSec=wait)))
            process = None
            started = time.monotonic()
            previous = {}
            def interrupted(signum, frame):
                raise Interrupted()
            for signum in (signal.SIGTERM, signal.SIGINT):
                previous[signum] = signal.signal(signum, interrupted)
            try:
                process = subprocess.Popen(command, cwd=folder, env=env, start_new_session=True, pass_fds=(scan.fileno(),))
                result = process.wait(timeout=budget-grace)
                state = 'success' if result == 0 else 'failed'
            except subprocess.TimeoutExpired:
                stop_group(process, grace)
                result, state = 124, 'run_timeout'
            except (Interrupted, KeyboardInterrupt):
                if process is not None:
                    stop_group(process, grace)
                result, state = 143, 'interrupted'
            except OSError:
                result, state = 127, 'launch_failed'
            finally:
                for signum, handler in previous.items():
                    signal.signal(signum, handler)
            record(state, waitSec=wait, runSec=round(time.monotonic()-started, 3), exitCode=result)
            return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('job', choices=CONTRACTS)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if not args.command:
        parser.error('command required')
    import log_setup
    log_setup.configure('scheduled_job')
    return run(args.job, args.command, Path(__file__).resolve().parent)


if __name__ == '__main__':
    raise SystemExit(main())
