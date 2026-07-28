# -*- coding: utf-8 -*-
"""배포 후 news_momentum.db가 지정 8종목으로 실제 생성·갱신됐는지 확인한다."""

import os
import sqlite3


APP_DIR = '/home/goodbyestarwars/kiwoom-api'
DB_FILE = os.path.join(APP_DIR, 'news_momentum.db')
PILOT_CODES = (
    '000660', '005930', '005380', '083650',
    '042660', '035420', '066570', '247540',
)


def verify_database(db_file=DB_FILE):
    db_file = os.path.abspath(db_file)
    if not os.path.isfile(db_file) or os.path.getsize(db_file) <= 0:
        raise RuntimeError('news_momentum.db missing-or-empty')
    uri = 'file:%s?mode=ro' % db_file.replace('\\', '/')
    conn = sqlite3.connect(uri, uri=True, timeout=5)
    try:
        integrity = conn.execute('PRAGMA quick_check').fetchone()[0]
        if integrity != 'ok':
            raise RuntimeError('news_momentum.db quick-check-failed')
        placeholders = ','.join('?' for _ in PILOT_CODES)
        rows = conn.execute(
            'SELECT stock_code,actual_end_date,updated_at FROM news_stock_coverage '
            'WHERE stock_code IN (%s)' % placeholders,
            PILOT_CODES,
        ).fetchall()
    finally:
        conn.close()
    found = {row[0] for row in rows}
    missing = [code for code in PILOT_CODES if code not in found]
    if missing:
        raise RuntimeError('news_momentum.db missing-pilot-coverage')
    if any(not row[1] or not row[2] for row in rows):
        raise RuntimeError('news_momentum.db incomplete-coverage')
    return {
        'bytes': os.path.getsize(db_file),
        'stocks': len(found),
        'latestDataDate': max(row[1] for row in rows),
        'latestUpdatedAt': max(row[2] for row in rows),
    }


def main():
    result = verify_database()
    print('PASS news_momentum.db stocks=%d bytes=%d dataDate=%s' % (
        result['stocks'], result['bytes'], result['latestDataDate']
    ))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
