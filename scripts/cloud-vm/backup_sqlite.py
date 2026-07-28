# -*- coding: utf-8 -*-
"""운영 SQLite를 sqlite3 backup API로 일관성 있게 백업한다."""

import argparse
import os
import sqlite3
from datetime import datetime, timezone


def backup_database(source_path, backup_dir, keep=7):
    source_path = os.path.abspath(source_path)
    backup_dir = os.path.abspath(backup_dir)
    if not os.path.isfile(source_path):
        raise FileNotFoundError('백업 원본 DB가 없습니다: %s' % source_path)
    if backup_dir in (os.path.abspath(os.sep), os.path.dirname(os.path.abspath(os.sep))):
        raise ValueError('백업 디렉터리가 너무 넓습니다.')
    os.makedirs(backup_dir, exist_ok=True)

    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    base_name = os.path.splitext(os.path.basename(source_path))[0]
    destination_path = os.path.join(backup_dir, '%s_%s.db' % (base_name, stamp))
    source_uri = 'file:%s?mode=ro' % source_path.replace('\\', '/')

    source = sqlite3.connect(source_uri, uri=True, timeout=600)
    destination = sqlite3.connect(destination_path, timeout=600)
    try:
        source.execute('PRAGMA busy_timeout=600000')
        source.backup(destination, pages=1024, sleep=0.05)
        integrity = destination.execute('PRAGMA integrity_check').fetchone()[0]
        if integrity != 'ok':
            raise RuntimeError('백업 무결성 검사 실패: %s' % integrity)
    except Exception:
        destination.close()
        source.close()
        if os.path.isfile(destination_path):
            os.remove(destination_path)
        raise
    else:
        destination.close()
        source.close()

    prefix = base_name + '_'
    candidates = sorted(
        (
            os.path.join(backup_dir, name)
            for name in os.listdir(backup_dir)
            if name.startswith(prefix) and name.endswith('.db')
            and os.path.isfile(os.path.join(backup_dir, name))
        ),
        key=os.path.getmtime,
        reverse=True,
    )
    for old_path in candidates[max(1, keep):]:
        os.remove(old_path)
    return {
        'source': source_path,
        'backup': destination_path,
        'bytes': os.path.getsize(destination_path),
        'integrity': 'ok',
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description='SQLite online backup API 실행')
    parser.add_argument('--source', required=True)
    parser.add_argument('--backup-dir', required=True)
    parser.add_argument('--keep', type=int, default=7)
    args = parser.parse_args(argv)
    result = backup_database(args.source, args.backup_dir, args.keep)
    print('SQLite 백업 완료: %s (%d bytes, integrity=%s)' % (
        result['backup'], result['bytes'], result['integrity']
    ))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
