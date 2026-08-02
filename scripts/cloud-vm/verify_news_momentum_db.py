# -*- coding: utf-8 -*-
"""배포 후 news_momentum.db가 실제로 생성·갱신됐는지 확인한다.

배치는 전 상장종목을 커서로 순회하지만, 회귀 검사 기준은 처음부터 수집돼 있던
파일럿 8종목의 커버리지·감성 집계를 그대로 쓴다(전 종목 커버리지는 며칠에 걸쳐
채워지므로 배포 시점의 합격 조건으로 삼을 수 없다).
"""

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
        topic_columns = {
            row[1] for row in conn.execute('PRAGMA table_info(news_topics)')
        }
        daily_columns = {
            row[1] for row in conn.execute('PRAGMA table_info(news_topic_daily)')
        }
        if not {
            'positive_count', 'neutral_count', 'negative_count',
            'previous_7d_count', 'change_rate', 'momentum_status',
        } <= topic_columns:
            raise RuntimeError('news_momentum.db topic-schema-outdated')
        if not {
            'positive_count', 'neutral_count', 'negative_count',
        } <= daily_columns:
            raise RuntimeError('news_momentum.db daily-schema-outdated')
        placeholders = ','.join('?' for _ in PILOT_CODES)
        rows = conn.execute(
            'SELECT stock_code,actual_end_date,updated_at FROM news_stock_coverage '
            'WHERE stock_code IN (%s)' % placeholders,
            PILOT_CODES,
        ).fetchall()
        sentiment_rows = conn.execute(
            'SELECT stock_code,total_count,positive_count,neutral_count,negative_count '
            'FROM news_topics WHERE stock_code IN (%s)'
            % placeholders,
            PILOT_CODES,
        ).fetchall()
        covered_total = conn.execute(
            'SELECT COUNT(*) FROM news_stock_coverage'
        ).fetchone()[0]
    finally:
        conn.close()
    found = {row[0] for row in rows}
    missing = [code for code in PILOT_CODES if code not in found]
    if missing:
        raise RuntimeError('news_momentum.db missing-pilot-coverage')
    if any(not row[1] or not row[2] for row in rows):
        raise RuntimeError('news_momentum.db incomplete-coverage')
    complete_sentiment_stocks = {
        row[0] for row in sentiment_rows
        if row[2] is not None and row[3] is not None and row[4] is not None
    }
    if any(
        (row[2] is None or row[3] is None or row[4] is None)
        and not (row[2] is None and row[3] is None and row[4] is None)
        or (
            row[2] is not None
            and row[2] + row[3] + row[4] != row[1]
        )
        for row in sentiment_rows
    ) or complete_sentiment_stocks != set(PILOT_CODES):
        raise RuntimeError('news_momentum.db incomplete-sentiment-aggregates')
    return {
        'bytes': os.path.getsize(db_file),
        'stocks': len(found),
        'coveredStocks': covered_total,
        'latestDataDate': max(row[1] for row in rows),
        'latestUpdatedAt': max(row[2] for row in rows),
    }


def main():
    result = verify_database()
    print('PASS news_momentum.db pilotStocks=%d coveredStocks=%d bytes=%d dataDate=%s' % (
        result['stocks'], result['coveredStocks'], result['bytes'], result['latestDataDate']
    ))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
