# -*- coding: utf-8 -*-
"""종목 뉴스 모멘텀 배치.

기본 실행은 안전하게 테스트 종목 3개만 처리한다. 전 종목 전환은 운영 검수 뒤
명시적으로 --full을 준 경우에만 허용한다.
"""

import argparse
import os
import sys
import time
from datetime import date, timedelta

import daily_scan
import naver_news
import news_momentum


PILOT_CODES = (
    '000660',  # SK하이닉스
    '005930',  # 삼성전자
    '005380',  # 현대차
    '083650',  # 비에이치아이
    '042660',  # 한화오션
    '035420',  # NAVER
    '066570',  # LG전자
    '247540',  # 에코프로비엠
)
TEST_CODES = PILOT_CODES  # 기존 테스트/운영 호출부 호환


class AlreadyRunning(Exception):
    pass


class BatchLock:
    """프로세스가 비정상 종료돼도 OS가 자동 해제하는 비차단 파일 잠금."""

    def __init__(self, path):
        self.path = os.path.abspath(path)
        self.handle = None

    def __enter__(self):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        self.handle = open(self.path, 'a+', encoding='ascii')
        try:
            if os.name == 'nt':
                import msvcrt
                self.handle.seek(0)
                if not self.handle.read(1):
                    self.handle.write('0')
                    self.handle.flush()
                self.handle.seek(0)
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (OSError, IOError):
            self.handle.close()
            self.handle = None
            raise AlreadyRunning(self.path)
        self.handle.seek(0)
        self.handle.truncate()
        self.handle.write(str(os.getpid()))
        self.handle.flush()
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        if not self.handle:
            return
        try:
            if os.name == 'nt':
                import msvcrt
                self.handle.seek(0)
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
        finally:
            self.handle.close()
            self.handle = None


def load_dotenv():
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if not os.path.exists(env_path):
        return
    with open(env_path, 'r', encoding='utf-8') as source:
        for line in source:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, value = line.partition('=')
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description='뉴스·검색 관심도 모멘텀 배치')
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument('--full', action='store_true', help='전체 종목 처리(운영 검수 후에만 사용)')
    scope.add_argument('--codes', help='쉼표로 구분한 6자리 종목코드')
    parser.add_argument('--skip-datalab', action='store_true', help='뉴스만 집계하고 DataLab 호출 생략')
    parser.add_argument('--db', default=news_momentum.DB_FILE, help='SQLite 파일 경로')
    parser.add_argument('--lock-file', help='중복 실행 방지 잠금 파일 경로')
    return parser.parse_args(argv)


def select_universe(universe, args):
    by_code = {stock['code']: stock for stock in universe}
    if args.full:
        return universe
    requested = [
        code.strip() for code in (args.codes or ','.join(TEST_CODES)).split(',') if code.strip()
    ]
    return [by_code[code] for code in requested if code in by_code]


def fetch_news_backfill(stock_name, client_id, client_secret, today, backfill_days=90):
    """최신순 페이지를 최근 90일 경계까지 읽고 실제 커버리지 상태를 함께 반환한다."""
    cutoff = (today - timedelta(days=backfill_days - 1)).isoformat()
    items_by_url = {}
    calls = 0
    reached_cutoff = False
    exhausted = False
    start = 1
    while start <= 1000:
        page = naver_news.search_news(
            stock_name, client_id, client_secret,
            display=100, sort='date', start=start, raise_errors=True,
        )
        calls += 1
        if not page:
            exhausted = True
            break
        page_dates = []
        for item in page:
            published = news_momentum._parse_date(item.get('pubDate'), today.isoformat())
            page_dates.append(published)
            if published >= cutoff:
                key = item.get('link') or item.get('title')
                items_by_url[key] = item
        if min(page_dates) <= cutoff:
            reached_cutoff = True
            break
        if len(page) < 100:
            exhausted = True
            break
        start += 100

    items = list(items_by_url.values())
    dates = [
        news_momentum._parse_date(item.get('pubDate'), today.isoformat())
        for item in items
    ]
    return items, {
        'requestedStartDate': cutoff,
        'actualStartDate': min(dates) if dates else None,
        'actualEndDate': max(dates) if dates else None,
        'backfillDays': backfill_days,
        'backfillComplete': reached_cutoff or exhausted,
        'newsApiCalls': calls,
    }


def run(args):
    load_dotenv()
    started = time.monotonic()
    universe = select_universe(daily_scan.load_full_universe(), args)
    if not universe:
        raise SystemExit('처리할 종목이 없습니다.')

    client_id = os.environ.get('NAVER_APIHUB_CLIENT_ID')
    client_secret = os.environ.get('NAVER_APIHUB_CLIENT_SECRET')
    if not client_id or not client_secret:
        raise SystemExit('NAVER_APIHUB_CLIENT_ID / NAVER_APIHUB_CLIENT_SECRET이 필요합니다.')

    before_size = os.path.getsize(args.db) if os.path.exists(args.db) else 0
    conn = news_momentum.get_conn(args.db)
    news_calls = 0
    datalab_calls = 0
    topic_count = 0
    failures = []
    try:
        news_momentum.create_schema(conn)
        today = date.today()
        start_date = (today - timedelta(days=89)).isoformat()
        end_date = today.isoformat()

        for index, stock in enumerate(universe, 1):
            try:
                items, coverage = fetch_news_backfill(
                    stock['name'], client_id, client_secret, today
                )
                news_calls += coverage['newsApiCalls']
                topics = news_momentum.extract_topics(
                    stock['code'], stock['name'], items, today=today
                )
                news_momentum.upsert_topics(
                    conn, stock['code'], stock['name'], topics, today=today
                )
                news_momentum.refresh_topic_statuses(
                    conn, today=today, stock_code=stock['code']
                )
                news_momentum.save_stock_coverage(
                    conn,
                    stock['code'],
                    stock['name'],
                    coverage['requestedStartDate'],
                    coverage['actualStartDate'],
                    coverage['actualEndDate'],
                    coverage['backfillComplete'],
                    len(items),
                    coverage['newsApiCalls'],
                    coverage['backfillDays'],
                )
                topic_count += len(topics)

                if not args.skip_datalab:
                    due = news_momentum.datalab_topics_due(conn, stock['code'], today=today)
                    if due:
                        trends = news_momentum.fetch_datalab_trends(
                            due, client_id, client_secret, start_date, end_date, 'date'
                        )
                        datalab_calls += 1
                        news_momentum.save_datalab_trends(
                            conn, due, trends, start_date, end_date, 'date'
                        )
                print('[%d/%d] %s(%s): 뉴스 %d건 / 이슈 %d개 / 기준일 %s / 90일 백필 %s' % (
                    index, len(universe), stock['name'], stock['code'], len(items), len(topics),
                    coverage['actualEndDate'] or '-',
                    '완료' if coverage['backfillComplete'] else '부분',
                ))
            except Exception as exc:
                # API 키, 요청 헤더, NAVER 응답 본문은 로그에 남기지 않는다.
                failures.append('%s(%s): %s' % (
                    stock['name'], stock['code'], type(exc).__name__
                ))
                print('[%d/%d] 실패: %s' % (index, len(universe), failures[-1]), file=sys.stderr)

        prune = news_momentum.prune_old_details(conn, today=today)
    finally:
        conn.close()

    after_size = os.path.getsize(args.db) if os.path.exists(args.db) else 0
    print('완료: 종목 %d / 이슈 %d / 뉴스 API %d회 / DataLab %d회 / 실패 %d' % (
        len(universe), topic_count, news_calls, datalab_calls, len(failures)
    ))
    print('DB: %d -> %d bytes (%+d), 보관정책: %s, 실행시간: %.2f초' % (
        before_size, after_size, after_size - before_size, prune, time.monotonic() - started
    ))
    return 1 if failures else 0


def main(argv=None):
    args = parse_args(argv)
    lock_file = args.lock_file or (os.path.abspath(args.db) + '.lock')
    try:
        with BatchLock(lock_file):
            return run(args)
    except AlreadyRunning:
        print('이미 뉴스 모멘텀 배치가 실행 중이므로 이번 실행을 건너뜁니다.')
        return 0


if __name__ == '__main__':
    raise SystemExit(main())
