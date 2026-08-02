# -*- coding: utf-8 -*-
"""운영 SQLite를 VACUUM INTO(SQLite 3.27+)로 일관성 있게 백업한다.

2026-08-02: 예전에는 sqlite3.Connection.backup()(온라인 백업 API, pages=1024 단위로
나눠 복사)을 썼는데, 이 API는 복사 도중 원본이 바뀌면(공식 문서에 명시된 동작 - 특히
WAL 체크포인트가 끼면) 처음부터 다시 복사를 시작한다. ohlc_snapshot.db는 실시간
시세가 계속 쓰는 라이브 DB라 초당 여러 번 커밋이 발생하고, 200MB 백업 하나가 40분
넘게 걸리는 동안 이 재시작이 반복되면서 실측 확인된 사례에서 같은 파일을 300배
가까이(59GB) 다시 쓰고 VM 디스크 I/O를 포화시켜 서비스 전체(uvicorn 포함)가 응답을
못 하는 사고로 이어졌다. VACUUM INTO는 단일 트랜잭션으로 스냅샷을 원자적으로 복사해
이 재시작 문제 자체가 없다 - 시작 시점 기준 일관된 스냅샷을 한 번에 쓰고 끝난다."""

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
    if os.path.exists(destination_path):
        # 타임스탬프가 초 단위라 이론상 거의 안 겹치지만, VACUUM INTO는 이미 있는
        # 파일(특히 빈 파일이 아닌 경우)에 쓰려고 하면 "file is not a database"처럼
        # 오해하기 쉬운 오류를 내므로 미리 명확한 오류로 막는다.
        raise FileExistsError('백업 대상 파일이 이미 있습니다: %s' % destination_path)
    source_uri = 'file:%s?mode=ro' % source_path.replace('\\', '/')

    source = sqlite3.connect(source_uri, uri=True, timeout=600)
    try:
        source.execute('PRAGMA busy_timeout=600000')
        source.execute('VACUUM INTO ?', (destination_path,))
    except Exception:
        source.close()
        if os.path.isfile(destination_path):
            os.remove(destination_path)
        raise
    else:
        source.close()

    destination = sqlite3.connect(destination_path)
    try:
        integrity = destination.execute('PRAGMA integrity_check').fetchone()[0]
    finally:
        destination.close()
    if integrity != 'ok':
        os.remove(destination_path)
        raise RuntimeError('백업 무결성 검사 실패: %s' % integrity)

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
    parser = argparse.ArgumentParser(description='SQLite VACUUM INTO 백업 실행')
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
