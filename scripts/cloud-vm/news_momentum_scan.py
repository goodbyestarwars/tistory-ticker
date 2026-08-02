# -*- coding: utf-8 -*-
"""종목 뉴스 모멘텀 배치.

기본 실행은 안전하게 파일럿 종목만 처리한다. --full은 전 상장종목을 대상으로 하되,
한 번에 전부 돌지 않고 batch_scan.py(scan_fundamentals)와 같은 이어달리기 방식으로
동작한다 - 커서 위치부터 시간 예산과 KST 하루 단위 API 호출 예산 안에서만 처리하고,
남은 종목은 다음 회차가 이어서 처리한다. 네이버 뉴스/DataLab 일일 한도를 넘지 않으면서
전 종목 커버리지를 며칠에 걸쳐 채우고, 이후에는 같은 순서로 계속 순환 갱신한다.
"""

import argparse
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone

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
STATUS_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    'news_momentum_batch_status.json',
)
CURSOR_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    'news_momentum_cursor.json',
)

# --full 이어달리기 기본 예산. batch_scan.py의 펀더멘탈 스캔(20분 예산 + 커서)과 같은 값·패턴.
FULL_TIME_BUDGET_SEC = 20 * 60
# 2026-08-02: 파일럿 8종목일 땐 안 드러났지만 --full로 전 종목을 도는 동안 종목 사이에
# 쉬는 시간이 전혀 없어서(batch_scan.py는 이미 THROTTLE_SEC=0.25로 쉬어감) VM 전체가
# 느려지는 문제가 실측 확인됐다(사용자 리포트 - 자원과 무관한 로컬 `clear` 명령조차 느려짐,
# CPU/디스크 I/O 경합으로 추정). 같은 값으로 맞춘다 - 종목당 여러 번 호출하므로 배치 전체
# 소요시간에 큰 영향은 없지만(호출 자체가 네트워크 대기가 대부분), 요청 사이 텀을 둬 VM의
# 다른 프로세스가 CPU/디스크를 나눠 쓸 여유를 준다.
THROTTLE_SEC = 0.25

# 네이버 검색 API(API HUB) 한도: 일 25,000회 / 월 775,000건(검색 카테고리 통합 관리).
# 같은 키를 쓰는 다른 소비자는 /naver-news(증시·코스피·코스닥 3개 쿼리, GAS 15분 캐시)로
# 하루 300회 남짓이라 나머지를 이 배치가 쓴다 - 양쪽 한도에 여유를 두고 잡은 값이다.
# 예산은 실행 단위가 아니라 KST 하루/월 단위로 누적 집계한다.
FULL_NEWS_CALL_BUDGET = 22000
FULL_NEWS_MONTHLY_BUDGET = 680000
# DataLab(Search Trend)은 검색 API와 별개 한도라 기존 보수적인 값을 유지한다.
FULL_DATALAB_CALL_BUDGET = 900
# 하루 안에 같은 종목을 다시 조회하지 않는다(뉴스 기준일이 하루 단위라 재조회 이득이 없음).
FULL_REFRESH_INTERVAL_DAYS = 1

# run()의 종료코드. deploy_check.sh가 "오늘 할 일이 남았는지"를 이걸로 판단한다.
EXIT_DONE_FOR_TODAY = 0   # 전수 완료 또는 오늘 예산 소진 - 날짜 마커 기록
EXIT_BATCH_FAILED = 1     # 처리된 종목 없이 전량 실패
EXIT_SLICE_ONLY = 2       # 시간 예산으로 슬라이스만 끝남 - 다음 회차가 이어서 진행


def kst_today():
    return (datetime.now(timezone.utc) + timedelta(hours=9)).date()


def load_cursor():
    """이어달리기 위치와 KST 하루/월 단위 API 호출 사용량."""
    state = {
        'cursor': 0, 'day': None, 'newsCalls': 0, 'datalabCalls': 0,
        'month': None, 'monthNewsCalls': 0, 'lastPassCompletedAt': None,
    }
    if os.path.exists(CURSOR_FILE):
        try:
            with open(CURSOR_FILE, 'r', encoding='utf-8') as source:
                stored = json.load(source)
            if isinstance(stored, dict):
                state.update({k: stored.get(k, v) for k, v in state.items()})
        except (OSError, ValueError):
            pass  # 손상된 커서는 처음부터 다시 시작한다(데이터 유실 없음).
    try:
        state['cursor'] = max(0, int(state['cursor'] or 0))
    except (TypeError, ValueError):
        state['cursor'] = 0
    for key in ('newsCalls', 'datalabCalls', 'monthNewsCalls'):
        try:
            state[key] = max(0, int(state[key] or 0))
        except (TypeError, ValueError):
            state[key] = 0
    return state


def save_cursor(state):
    temp_path = CURSOR_FILE + '.tmp'
    with open(temp_path, 'w', encoding='utf-8') as output:
        json.dump(state, output, ensure_ascii=False)
    os.replace(temp_path, CURSOR_FILE)


def write_batch_status(status, **fields):
    payload = {
        'status': status,
        'at': datetime.now(timezone.utc).isoformat(),
    }
    payload.update(fields)
    temp_path = STATUS_FILE + '.tmp'
    with open(temp_path, 'w', encoding='utf-8') as output:
        json.dump(payload, output, ensure_ascii=False)
    os.replace(temp_path, STATUS_FILE)


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
    scope.add_argument('--full', action='store_true', help='전 상장종목 대상(커서 이어달리기)')
    scope.add_argument('--codes', help='쉼표로 구분한 6자리 종목코드')
    parser.add_argument('--skip-datalab', action='store_true', help='뉴스만 집계하고 DataLab 호출 생략')
    parser.add_argument('--db', default=news_momentum.DB_FILE, help='SQLite 파일 경로')
    parser.add_argument('--lock-file', help='중복 실행 방지 잠금 파일 경로')
    parser.add_argument('--time-budget-sec', type=int, default=FULL_TIME_BUDGET_SEC,
                        help='--full에서 이번 회차에 쓸 시간 예산(초)')
    parser.add_argument('--news-call-budget', type=int, default=FULL_NEWS_CALL_BUDGET,
                        help='--full에서 KST 하루 동안 쓸 네이버 뉴스 API 호출 예산')
    parser.add_argument('--news-monthly-budget', type=int, default=FULL_NEWS_MONTHLY_BUDGET,
                        help='--full에서 KST 한 달 동안 쓸 네이버 뉴스 API 호출 예산')
    parser.add_argument('--datalab-call-budget', type=int, default=FULL_DATALAB_CALL_BUDGET,
                        help='--full에서 KST 하루 동안 쓸 DataLab 호출 예산')
    parser.add_argument('--refresh-interval-days', type=int, default=FULL_REFRESH_INTERVAL_DAYS,
                        help='--full에서 같은 종목을 다시 조회하기까지의 최소 일수')
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


def rotate_from_cursor(universe, cursor):
    """커서 위치부터 한 바퀴 순서대로 돌려준다(마지막까지 가면 처음으로 되돌아감)."""
    if not universe:
        return []
    start = cursor % len(universe)
    return universe[start:] + universe[:start]


def run(args):
    load_dotenv()
    started = time.monotonic()
    full_universe = select_universe(daily_scan.load_full_universe(), args)
    if not full_universe:
        raise RuntimeError('empty-pilot-universe')

    client_id = os.environ.get('NAVER_APIHUB_CLIENT_ID')
    client_secret = os.environ.get('NAVER_APIHUB_CLIENT_SECRET')
    if not client_id or not client_secret:
        raise RuntimeError('missing-naver-environment')

    today_kst = kst_today()
    month_kst = today_kst.strftime('%Y-%m')
    cursor_state = load_cursor() if args.full else None
    if cursor_state is not None:
        if cursor_state['day'] != today_kst.isoformat():
            # KST 날짜가 바뀌면 하루 단위 호출 예산을 초기화한다(커서 위치는 유지).
            cursor_state.update({'day': today_kst.isoformat(), 'newsCalls': 0, 'datalabCalls': 0})
        if cursor_state['month'] != month_kst:
            cursor_state.update({'month': month_kst, 'monthNewsCalls': 0})
    # 일 25,000회와 월 775,000건 두 한도를 모두 지켜야 하므로 남은 예산 중 작은 쪽을 쓴다.
    news_budget = min(
        max(0, args.news_call_budget - cursor_state['newsCalls']),
        max(0, args.news_monthly_budget - cursor_state['monthNewsCalls']),
    ) if cursor_state else None
    datalab_budget = (
        max(0, args.datalab_call_budget - cursor_state['datalabCalls']) if cursor_state else None
    )

    before_size = os.path.getsize(args.db) if os.path.exists(args.db) else 0
    conn = news_momentum.get_conn(args.db)
    news_calls = 0
    datalab_calls = 0
    topic_count = 0
    processed = 0
    skipped_fresh = 0
    stop_reason = 'universe-complete'
    failures = []
    try:
        news_momentum.create_schema(conn)
        today = date.today()
        start_date = (today - timedelta(days=89)).isoformat()
        end_date = today.isoformat()

        if cursor_state is None:
            universe = full_universe
            coverage_dates = {}
        else:
            universe = rotate_from_cursor(full_universe, cursor_state['cursor'])
            coverage_dates = news_momentum.load_coverage_dates(conn)
            if news_budget <= 0:
                stop_reason = 'news-budget-exhausted'
                universe = []

        for index, stock in enumerate(universe, 1):
            if cursor_state is not None:
                # 시간·호출 예산을 넘기면 커서만 남기고 멈춘다 - 남은 종목은 다음 회차가 잇는다.
                if time.monotonic() - started >= args.time_budget_sec:
                    stop_reason = 'time-budget-exhausted'
                    break
                if news_calls >= news_budget:
                    stop_reason = 'news-budget-exhausted'
                    break
                last_scanned = coverage_dates.get(stock['code'])
                if (last_scanned is not None
                        and (today_kst - last_scanned).days < args.refresh_interval_days):
                    skipped_fresh += 1
                    cursor_state['cursor'] = (cursor_state['cursor'] + 1) % len(full_universe)
                    continue
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

                # DataLab은 일일 한도가 뉴스 검색보다 훨씬 작아서 예산을 따로 확인한다.
                # 예산이 떨어져도 뉴스 집계는 계속하고 검색 관심도만 다음 회차로 미룬다.
                datalab_allowed = datalab_budget is None or datalab_calls < datalab_budget
                if not args.skip_datalab and datalab_allowed:
                    due = news_momentum.datalab_topics_due(conn, stock['code'], today=today)
                    if due:
                        trends = news_momentum.fetch_datalab_trends(
                            due, client_id, client_secret, start_date, end_date, 'date'
                        )
                        datalab_calls += 1
                        news_momentum.save_datalab_trends(
                            conn, due, trends, start_date, end_date, 'date'
                        )
                processed += 1
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
            finally:
                # 실패한 종목도 커서를 넘긴다 - 한 종목이 계속 실패해도 나머지가 막히지 않는다.
                if cursor_state is not None:
                    cursor_state['cursor'] = (cursor_state['cursor'] + 1) % len(full_universe)
                time.sleep(THROTTLE_SEC)

        prune = news_momentum.prune_old_details(conn, today=today)
    finally:
        conn.close()

    if cursor_state is not None:
        cursor_state['newsCalls'] += news_calls
        cursor_state['monthNewsCalls'] += news_calls
        cursor_state['datalabCalls'] += datalab_calls
        if stop_reason == 'universe-complete':
            cursor_state['lastPassCompletedAt'] = datetime.now(timezone.utc).isoformat()
        save_cursor(cursor_state)

    after_size = os.path.getsize(args.db) if os.path.exists(args.db) else 0
    print('완료: 처리 %d / 오늘 이미 수집돼 건너뜀 %d / 이슈 %d / 뉴스 API %d회 / DataLab %d회 / 실패 %d' % (
        processed, skipped_fresh, topic_count, news_calls, datalab_calls, len(failures)
    ))
    if cursor_state is not None:
        print('대상 %d종목 / 중단사유 %s / 다음 커서 %d' % (
            len(full_universe), stop_reason, cursor_state['cursor']
        ))
    print('DB: %d -> %d bytes (%+d), 보관정책: %s, 실행시간: %.2f초' % (
        before_size, after_size, after_size - before_size, prune, time.monotonic() - started
    ))
    status_fields = {
        # 전 종목 모드에서 실패 목록이 무한정 커지지 않도록 상한을 둔다(종류 파악용).
        'failures': failures[:50],
        'failureCount': len(failures),
        'newsApiCalls': news_calls,
        'datalabCalls': datalab_calls,
        'topics': topic_count,
        'dbBytes': after_size,
        'elapsedSeconds': round(time.monotonic() - started, 2),
    }
    if cursor_state is None:
        status_fields['stockCodes'] = [stock['code'] for stock in universe]
    else:
        # 전 종목 모드에서는 종목코드를 전부 남기지 않고 진행 상황만 기록한다.
        status_fields.update({
            'mode': 'full',
            'universeSize': len(full_universe),
            'processed': processed,
            'skippedFresh': skipped_fresh,
            'stopReason': stop_reason,
            'nextCursor': cursor_state['cursor'],
            'dayKst': cursor_state['day'],
            'dayNewsCalls': cursor_state['newsCalls'],
            'monthNewsCalls': cursor_state['monthNewsCalls'],
        })
    # 일부 종목이 실패해도 나머지 수집 결과는 정상이므로, 전 종목 모드에서는
    # 전량 실패일 때만 failed로 본다(개별 실패는 failures 목록으로 남긴다).
    batch_failed = bool(failures) if cursor_state is None else (bool(failures) and processed == 0)
    write_batch_status('failed' if batch_failed else 'completed', **status_fields)
    if batch_failed:
        return EXIT_BATCH_FAILED
    # 시간 예산 때문에 멈춘 거라면 오늘 호출 예산이 아직 남아 있다는 뜻이다.
    # 다음 5분 회차가 커서부터 이어받도록 "슬라이스만 끝남"을 알린다(deploy_check.sh).
    if cursor_state is not None and stop_reason == 'time-budget-exhausted':
        return EXIT_SLICE_ONLY
    return EXIT_DONE_FOR_TODAY


def main(argv=None):
    args = parse_args(argv)
    lock_file = args.lock_file or (os.path.abspath(args.db) + '.lock')
    try:
        with BatchLock(lock_file):
            return run(args)
    except AlreadyRunning:
        print('이미 뉴스 모멘텀 배치가 실행 중이므로 이번 실행을 건너뜁니다.')
        write_batch_status('skipped', reason='already-running')
        return 0
    except Exception as exc:
        # 인증값·요청·응답은 쓰지 않고 예외 종류와 내부 고정 메시지만 남긴다.
        write_batch_status(
            'failed',
            fatalType=type(exc).__name__,
            fatalReason=str(exc) if str(exc) in (
                'empty-pilot-universe', 'missing-naver-environment'
            ) else 'unexpected-batch-error',
        )
        print('뉴스 모멘텀 배치 실패: %s' % type(exc).__name__, file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
