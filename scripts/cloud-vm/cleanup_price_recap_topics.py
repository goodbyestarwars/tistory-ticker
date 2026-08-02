# -*- coding: utf-8 -*-
"""이전 버전의 _issue_labels() 폴백 규칙이 만들어낸 순수 가격 서술 이슈("장중 하락"·
"마감 상승" 등)와 자기중복 이슈("종목명 종목명 하락" 형태)를 news_topics에서 정리한다.

news_topics는 원문 기사 제목을 저장하지 않고 topic_name(= "종목명 + 라벨")만 남기므로,
지금 코드로 다시 돌려도 라벨이 안 나올 조합인지 topic_name만으로 역으로 판정한다.
버그가 만든 라벨은 항상 "핵심어 사건어" 정확히 2단어 조합이었고, 정규식 규칙 라벨
(HBM 수요 증가/신규 수주/실적 개선 등)은 시점어나 종목명으로 시작하지 않으므로
두 종류는 안전하게 구분된다 - MARKET_SESSION_WORDS(news_momentum.py)에 새 단어가
추가되면 이 판정 기준도 같이 넓어진다.

기본은 미리보기(dry-run)만 하고 지우지 않는다. 실제로 지우려면 --apply를 명시해야
하고, 그 직전에 news_momentum.db를 자동 백업한다(backup_sqlite.py 재사용) - 삭제는
ON DELETE CASCADE로 news_topic_daily/datalab_trends도 함께 지워지므로 되돌릴 수
없는 작업이라 백업을 건너뛰지 않는다."""

import argparse
import os
import sys

import backup_sqlite
import news_momentum


def log(msg):
    print('[cleanup_price_recap_topics] ' + msg, flush=True)


def is_price_recap_label(stock_name, label):
    """topic_name에서 stock_name을 뗀 나머지(label)가 버그가 만든 조합인지 판정한다."""
    words = label.split(' ')
    if len(words) != 2:
        return False
    subject = words[0]
    if subject in news_momentum.MARKET_SESSION_WORDS:
        return True
    if stock_name and subject in stock_name:
        return True
    return False


def find_noisy_topics(conn):
    """(id, stock_code, stock_name, topic_name, label) 튜플 목록 - 삭제 대상만."""
    rows = conn.execute(
        'SELECT id, stock_code, stock_name, topic_name FROM news_topics'
    ).fetchall()
    noisy = []
    for row in rows:
        stock_name = row['stock_name']
        prefix = stock_name + ' '
        if not row['topic_name'].startswith(prefix):
            continue  # topic_name 구성 규칙(종목명+라벨)과 다른 예외적 행은 건드리지 않는다.
        label = row['topic_name'][len(prefix):]
        if is_price_recap_label(stock_name, label):
            noisy.append((row['id'], row['stock_code'], stock_name, row['topic_name'], label))
    return noisy


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', default=news_momentum.DB_FILE, help='SQLite 파일 경로')
    parser.add_argument('--backup-dir',
                        default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backups'))
    parser.add_argument('--apply', action='store_true',
                        help='명시해야만 실제로 삭제한다(기본은 미리보기만)')
    args = parser.parse_args(argv)

    if not os.path.exists(args.db):
        log('%s 가 없습니다 - 정리할 게 없음.' % args.db)
        return 0

    conn = news_momentum.get_conn(args.db)
    try:
        noisy = find_noisy_topics(conn)

        if not noisy:
            log('가격 서술 노이즈 이슈가 없습니다.')
            return 0

        log('%d건 발견:' % len(noisy))
        for topic_id, code, name, topic_name, label in noisy:
            log('  id=%d %s(%s) "%s" (라벨="%s")' % (topic_id, name, code, topic_name, label))

        if not args.apply:
            log('미리보기만 실행됨 - 실제로 지우려면 --apply를 붙여서 다시 실행하세요.')
            return 0

        backup = backup_sqlite.backup_database(args.db, args.backup_dir)
        log('삭제 전 백업 완료: %s (%d bytes)' % (backup['backup'], backup['bytes']))

        with conn:
            for topic_id, _code, _name, _topic_name, _label in noisy:
                conn.execute('DELETE FROM news_topics WHERE id=?', (topic_id,))
        log('%d건 삭제 완료(연결된 일별 데이터·검색트렌드는 CASCADE로 함께 삭제됨).' % len(noisy))
        return 0
    finally:
        conn.close()


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
