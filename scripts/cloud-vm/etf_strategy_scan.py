# -*- coding: utf-8 -*-
"""전략검색의 ETF 수익률 카테고리만 매일 갱신한다.

나머지 전략(저평가·배당·국민연금·목표주가)은 주 1회 strategy_scan.py가 갱신한다.
같은 JSON 캐시를 원자적으로 교체하지 않고 기존 카테고리와 합쳐 저장해, 두 주기가 서로의
결과를 지우지 않게 한다.
"""
import json
import os
import sys
from datetime import datetime, timezone

import db_schema
import market_clock
import scan_forward
import strategy_scan


def main():
    skip_today, scan_day = market_clock.skip_scan_today()
    if skip_today:
        strategy_scan.log('휴장일(%s) - ETF 전략 스캔을 건너뜁니다(직전 결과 유지).' % scan_day)
        return
    strategy_scan.load_dotenv()
    universe = [stock for stock in strategy_scan.load_full_universe() if stock.get('is_etf')]
    if not universe:
        strategy_scan.log('ETF 유니버스를 못 불러왔습니다.')
        sys.exit(1)
    conn = db_schema.get_conn()
    db_schema.create_schema(conn)
    try:
        daily_cache = strategy_scan.preload_daily_prices(conn, universe)
        sectors, scanned = strategy_scan.scan_etf_returns(universe, conn, daily_cache=daily_cache)
    finally:
        conn.close()

    path = strategy_scan.OUTPUT_FILE
    existing = {}
    if os.path.exists(path):
        try:
            with open(path, encoding='utf-8') as handle:
                existing = json.load(handle)
        except (OSError, ValueError):
            existing = {}
    categories = existing.get('categories') if isinstance(existing.get('categories'), dict) else {}
    categories['etfReturn'] = {
        'name': strategy_scan.ETF_RETURN_CATEGORY_NAME,
        'methodology': strategy_scan.methodology(
            ('계산', '유효한 가격 데이터가 있는 국내 ETF 전체'),
            ('정렬', '기본은 1개월 누적수익률. 화면에서 1·3·6·12개월을 선택해 다시 정렬할 수 있습니다.'),
            ('제외', 'ETN·스팩·우선주·거래정지·정리매매·동전주'),
            ('성격', '기간 수익률과 편입 구성을 비교하는 화면이며, 매수 의견이 아닙니다.'),
        ),
        'sectors': {sector: {'name': sector, 'matches': matches} for sector, matches in sectors.items() if matches},
    }
    now = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    existing['categories'] = categories
    existing['etfScanned'] = scanned
    existing['etfScannedAt'] = now
    existing.setdefault('universe', len(strategy_scan.load_full_universe()))
    existing.setdefault('scannedAt', now)
    tmp_path = path + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as handle:
        json.dump(existing, handle, ensure_ascii=False)
    os.replace(tmp_path, path)
    try:
        hits_conn = db_schema.get_conn()
        try:
            recorded = scan_forward.record_grouped_hits(
                hits_conn, scan_forward.today_kst(), 'strategy',
                {'etfReturn': categories['etfReturn']},
            )
            if recorded:
                strategy_scan.log('ETF 포워드 추적 기록: %s' % ', '.join('%s %d' % item for item in sorted(recorded.items())))
        finally:
            hits_conn.close()
    except Exception as exc:
        strategy_scan.log('ETF 포워드 추적 기록 실패(무시하고 계속): %s' % exc)
    strategy_scan.log('ETF 전략 스캔 완료: 판정 %d / ETF 유니버스 %d' % (scanned, len(universe)))


if __name__ == '__main__':
    main()
