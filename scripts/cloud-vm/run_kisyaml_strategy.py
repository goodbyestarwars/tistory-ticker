# -*- coding: utf-8 -*-
"""`.kis.yaml` 전략 파일을 종목 1개에 대해 평가해보는 수동 실행용 CLI(daily_scan.py 같은
자동 배치에는 연결돼 있지 않음 - kisyaml_strategy.py 사용법 확인·수동 점검용).

사용:
    python run_kisyaml_strategy.py strategies/golden_cross.kis.yaml 005930

DB(ohlc_snapshot.db)의 daily_prices를 그대로 읽는다 - 별도 API 호출 없음. daily_scan.py가
먼저 한 번 이상 돌아서 해당 종목의 일봉이 DB에 쌓여 있어야 한다."""

import argparse
import json
import sys

import db_schema
import kisyaml_strategy


def main():
    parser = argparse.ArgumentParser(description='.kis.yaml 전략을 종목에 적용해 시그널을 계산한다.')
    parser.add_argument('strategy_path', help='.kis.yaml 파일 경로')
    parser.add_argument('code', help='종목코드 (예: 005930)')
    args = parser.parse_args()

    try:
        strategy = kisyaml_strategy.load_strategy_file(args.strategy_path)
    except kisyaml_strategy.StrategyError as e:
        print('전략 파일 오류: %s' % e, file=sys.stderr)
        sys.exit(1)

    conn = db_schema.get_conn()
    db_schema.create_schema(conn)
    daily = db_schema.load_daily_prices(conn, args.code)
    if not daily:
        print('daily_prices에 %s 데이터가 없습니다(daily_scan.py를 먼저 실행하세요).' % args.code,
              file=sys.stderr)
        sys.exit(1)

    try:
        result = kisyaml_strategy.evaluate(strategy, daily)
    except kisyaml_strategy.StrategyError as e:
        print('전략 평가 오류: %s' % e, file=sys.stderr)
        sys.exit(1)

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
