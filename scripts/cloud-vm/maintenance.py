# -*- coding: utf-8 -*-
"""장외 시간 VM 유지보수.

배포 타이머가 매일 새벽에 한 번 호출한다. 운영 API를 멈추지 않고 수행할 수
있는 보존 정리만 담당하며, 삭제 대상이 명시된 테이블 외에는 데이터를 지우지
않는다. 장시간 VACUUM은 별도 작업으로 남겨 서비스 중 I/O 폭주를 피한다.
"""

import argparse
import os
import sqlite3
from datetime import datetime, timedelta, timezone

try:
    import fcntl
except ImportError:  # pragma: no cover - Windows 개발 환경에서는 단일 실행으로 대체
    fcntl = None

import db_schema
import news_momentum
import backup_sqlite


KST = timezone(timedelta(hours=9))
MAX_LOG_LINES = 10000
LOG_FILES = (
    'deploy.log',
    'search-scan-refresh.log',
    'latency_monitor.log',
    'maintenance.log',
)
LOCK_FILE_NAME = '.off_hours_maintenance.lock'


def _app_dir():
    return os.path.dirname(os.path.abspath(__file__))


def _kst_now():
    return datetime.now(KST)


def is_off_hours(now=None):
    """현금시장 정규장(평일 09:00~15:40) 밖인지 확인한다."""
    current = now or _kst_now()
    if current.weekday() >= 5:
        return True
    minutes = current.hour * 60 + current.minute
    return minutes < 9 * 60 or minutes > 15 * 60 + 40


def trim_log(path, max_lines=MAX_LOG_LINES):
    try:
        with open(path, 'r', encoding='utf-8') as source:
            lines = source.readlines()
    except FileNotFoundError:
        return 0
    if len(lines) <= max_lines:
        return 0
    temp_path = path + '.tmp'
    with open(temp_path, 'w', encoding='utf-8') as output:
        output.writelines(lines[-max_lines:])
    os.replace(temp_path, path)
    return len(lines) - max_lines


def _maintenance_news_momentum():
    path = os.path.join(_app_dir(), 'news_momentum.db')
    if not os.path.exists(path):
        return {'dailyDeleted': 0, 'trendsDeleted': 0, 'skipped': True}
    backup_sqlite.backup_database(path, os.path.join(_app_dir(), 'backups'), keep=7)
    conn = news_momentum.get_conn(path)
    try:
        return news_momentum.prune_old_details(conn, today=_kst_now().date())
    finally:
        conn.close()


def _maintenance_volume_profile():
    path = os.path.join(_app_dir(), 'ohlc_snapshot.db')
    if not os.path.exists(path):
        return {'deleted': 0, 'skipped': True}
    cutoff = (_kst_now().date() - timedelta(days=200)).isoformat()
    conn = db_schema.get_conn(path)
    try:
        before = conn.total_changes
        db_schema.prune_volume_profile_daily(conn, cutoff)
        return {'deleted': conn.total_changes - before, 'cutoff': cutoff}
    finally:
        conn.close()


def _checkpoint_sqlite(path):
    if not os.path.exists(path):
        return {'skipped': True}
    conn = sqlite3.connect(path, timeout=60)
    try:
        result = conn.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()
        conn.execute('PRAGMA optimize')
        return {'checkpoint': list(result) if result else None}
    finally:
        conn.close()


def run(force=False):
    if not force and not is_off_hours():
        raise RuntimeError('장외 시간이 아니므로 유지보수를 실행하지 않습니다.')
    app_dir = _app_dir()
    trimmed = {}
    for name in LOG_FILES:
        trimmed[name] = trim_log(os.path.join(app_dir, name))
    result = {
        'dateKst': _kst_now().date().isoformat(),
        'logsTrimmed': trimmed,
        'newsMomentum': _maintenance_news_momentum(),
        'volumeProfile': _maintenance_volume_profile(),
        'ohlcCheckpoint': _checkpoint_sqlite(os.path.join(app_dir, 'ohlc_snapshot.db')),
        'newsCheckpoint': _checkpoint_sqlite(os.path.join(app_dir, 'news_momentum.db')),
    }
    print('[maintenance] %s' % result, flush=True)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description='Run safe off-hours VM maintenance')
    parser.add_argument('--force', action='store_true', help='ignore the market-hours guard')
    args = parser.parse_args(argv)
    lock_path = os.path.join(_app_dir(), LOCK_FILE_NAME)
    with open(lock_path, 'w', encoding='ascii') as lock:
        if fcntl is not None:
            try:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                print('[maintenance] already running', flush=True)
                return 75
        try:
            return 0 if run(force=args.force) is not None else 1
        finally:
            if fcntl is not None:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


if __name__ == '__main__':
    raise SystemExit(main())
