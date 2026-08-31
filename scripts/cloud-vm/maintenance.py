# -*- coding: utf-8 -*-
"""장외 시간 VM 유지보수.

배포 타이머가 매일 새벽에 한 번 호출한다. 운영 API를 멈추지 않고 수행할 수
있는 보존 정리만 담당하며, 삭제 대상이 명시된 테이블 외에는 데이터를 지우지
않는다. 장시간 VACUUM은 별도 작업으로 남겨 서비스 중 I/O 폭주를 피한다.
"""

import argparse
import os
import re
import sqlite3
import subprocess
import time
from datetime import datetime, timedelta, timezone

try:
    import fcntl
except ImportError:  # pragma: no cover - Windows 개발 환경에서는 단일 실행으로 대체
    fcntl = None

import db_schema
import domestic_news
import news_momentum
import backup_sqlite


KST = timezone(timedelta(hours=9))
MAX_LOG_LINES = 10000
SYSTEM_LOG_DIR = '/var/log'
SYSTEM_LOG_FILES = (
    'syslog',
    'kern.log',
    'auth.log',
    'daemon.log',
    'messages',
    'debug',
)
ROTATED_LOG_RE = re.compile(r'^.+\.(?:\d+|gz|xz|bz2)$')
JOURNAL_VACUUM_SIZE = '500M'
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


def is_weekend(now=None):
    current = now or _kst_now()
    return current.weekday() >= 5


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


def _privileged_command(args):
    """Return a non-interactive command for operations owned by root."""
    geteuid = getattr(os, 'geteuid', None)
    if geteuid is not None and geteuid() == 0:
        return list(args)
    return ['sudo', '-n'] + list(args)


def _run_privileged(args):
    try:
        completed = subprocess.run(
            _privileged_command(args),
            check=True,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (FileNotFoundError, PermissionError, subprocess.CalledProcessError) as exc:
        return {
            'ok': False,
            'command': list(args),
            'error': type(exc).__name__,
        }
    except subprocess.TimeoutExpired:
        return {'ok': False, 'command': list(args), 'error': 'TimeoutExpired'}
    return {
        'ok': True,
        'command': list(args),
        'output': (completed.stdout or '').strip()[-500:],
    }


def _truncate_system_log(path):
    if not os.path.isfile(path):
        return {'skipped': True}
    result = _run_privileged(['truncate', '-s', '0', path])
    result['path'] = path
    return result


def _remove_rotated_logs():
    """Remove only rotated files directly under /var/log; active logs stay."""
    if not os.path.isdir(SYSTEM_LOG_DIR):
        return {'skipped': True, 'removed': 0}
    removed = []
    failures = []
    try:
        entries = list(os.scandir(SYSTEM_LOG_DIR))
    except OSError as exc:
        return {'ok': False, 'removed': 0, 'error': type(exc).__name__}
    for entry in entries:
        if not entry.is_file() or not ROTATED_LOG_RE.match(entry.name):
            continue
        result = _run_privileged(['rm', '-f', entry.path])
        if result.get('ok'):
            removed.append(entry.name)
        else:
            failures.append({'name': entry.name, 'error': result.get('error')})
    return {'ok': not failures, 'removed': removed, 'failures': failures}


def cleanup_system_logs():
    """Clean VM OS logs during the weekend without deleting active log files."""
    truncated = {}
    for name in SYSTEM_LOG_FILES:
        truncated[name] = _truncate_system_log(os.path.join(SYSTEM_LOG_DIR, name))
    rotated = _remove_rotated_logs()
    journal = _run_privileged([
        'journalctl',
        '--vacuum-time=14d',
        '--vacuum-size=%s' % JOURNAL_VACUUM_SIZE,
    ])
    failures = [
        item for item in truncated.values()
        if item.get('ok') is False
    ]
    if rotated.get('ok') is False:
        failures.append(rotated)
    if journal.get('ok') is False:
        failures.append(journal)
    return {
        'ok': not failures,
        'truncated': truncated,
        'rotated': rotated,
        'journal': journal,
        'failures': failures,
    }


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


def _maintenance_domestic_news():
    """국내 뉴스 캐시 보존 정리.

    2026-08-31: 이 DB는 유지보수 대상에서 빠져 있어 수집한 기사가 영구 누적됐고,
    그게 /domestic-news가 6~13초 걸리던 근본 원인이었다(인덱스 추가로 조회는 빨라졌지만
    파일은 계속 커진다). 다른 뉴스 DB와 같이 삭제 전에 백업을 남긴다.
    """
    path = os.path.join(_app_dir(), 'domestic_news.db')
    if not os.path.exists(path):
        return {'deleted': 0, 'skipped': True}
    backup_sqlite.backup_database(path, os.path.join(_app_dir(), 'backups'), keep=7)
    return domestic_news.prune_old_rows()


def _maintenance_us_caches():
    """미국 뉴스·분석 캐시에서 오래 안 쓴 심볼을 지운다.

    두 테이블 모두 심볼 단위라 행이 무한히 늘지는 않지만(us_analysis_cache는 심볼당
    1행, us_news_cache는 save_cached_news가 심볼별로 지우고 다시 넣는다), 한 번 조회된
    뒤 다시 안 보는 심볼이 계속 남는다. 읽기 TTL이 각각 6시간·30분이라 30일이 지난
    행은 확실히 재조회 대상이고, 지워도 다음 요청 때 다시 채워진다.
    """
    cutoff = int(time.time()) - 30 * 86400
    result = {}
    news_path = os.path.join(_app_dir(), 'us_news_cache.db')
    if os.path.exists(news_path):
        conn = sqlite3.connect(news_path, timeout=60)
        try:
            before = conn.total_changes
            conn.execute('DELETE FROM us_news_cache WHERE fetched_at < ?', (cutoff,))
            conn.execute('DELETE FROM us_news_cache_meta WHERE fetched_at < ?', (cutoff,))
            conn.commit()
            result['usNewsDeleted'] = conn.total_changes - before
        finally:
            conn.close()
    else:
        result['usNewsDeleted'] = 0
    analysis_path = os.path.join(_app_dir(), 'us_analysis_cache.db')
    if os.path.exists(analysis_path):
        conn = sqlite3.connect(analysis_path, timeout=60)
        try:
            before = conn.total_changes
            conn.execute('DELETE FROM us_analysis_cache WHERE fetched_at < ?', (cutoff,))
            conn.commit()
            result['usAnalysisDeleted'] = conn.total_changes - before
        finally:
            conn.close()
    else:
        result['usAnalysisDeleted'] = 0
    result['cutoffEpoch'] = cutoff
    return result


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
    system_logs = cleanup_system_logs() if is_weekend() else {
        'skipped': True,
        'reason': '주말 OS 로그 정리 일정이 아닙니다.',
    }
    if system_logs.get('ok') is False:
        raise RuntimeError('VM OS 로그 정리에 실패했습니다: %s' % system_logs)
    result = {
        'dateKst': _kst_now().date().isoformat(),
        'logsTrimmed': trimmed,
        'systemLogs': system_logs,
        'newsMomentum': _maintenance_news_momentum(),
        'volumeProfile': _maintenance_volume_profile(),
        # 2026-08-31: 코드가 쓰는 SQLite는 5개인데 유지보수 대상이 2개뿐이었다.
        # 나머지 3개(domestic_news / us_news_cache / us_analysis_cache)를 편입한다.
        'domesticNews': _maintenance_domestic_news(),
        'usCaches': _maintenance_us_caches(),
        'ohlcCheckpoint': _checkpoint_sqlite(os.path.join(app_dir, 'ohlc_snapshot.db')),
        'newsCheckpoint': _checkpoint_sqlite(os.path.join(app_dir, 'news_momentum.db')),
        'domesticNewsCheckpoint': _checkpoint_sqlite(os.path.join(app_dir, 'domestic_news.db')),
        'usNewsCheckpoint': _checkpoint_sqlite(os.path.join(app_dir, 'us_news_cache.db')),
        'usAnalysisCheckpoint': _checkpoint_sqlite(os.path.join(app_dir, 'us_analysis_cache.db')),
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
