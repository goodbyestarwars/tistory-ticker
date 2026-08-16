# -*- coding: utf-8 -*-
"""국내 46종목 4주 스윙 백테스트 재실행 도구.

운영 VM의 daily_prices를 사용해 재현한다. 이 저장소에는 운영 SQLite와
기존 46종목 결과 파일이 포함되지 않으므로, 로컬에서 임의의 시장 데이터를
만들지 않는다. DB가 있으면 KRX_MAP의 국내 대표 종목 앞 46개를 고정된
순서로 사용하고, --legacy-json이 있으면 구 모델 결과와 같은 신호일의
T+5/T+10/T+20을 비교한다.

구 모델 결과 형식(선택):
{
  "signals": [{"code":"005930", "date":"2026-01-02", "entry": true,
               "t5_return": 1.2, "t10_return": 2.0, "t20_return": 4.0}]
}

구 결과가 없을 때도 새 모델의 실제 가격 결과는 계산하되, 구·신 비교는
"legacy unavailable"로 명시한다.
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone

import db_schema
import swing_model


ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
KRX_MAP_FILE = os.path.join(ROOT, 'data', 'krx_map.js')


def load_46_universe(path=KRX_MAP_FILE):
    with open(path, 'r', encoding='utf-8') as handle:
        text = handle.read()
    etf_names = set()
    match = re.search(r'window\.KRX_ETF_NAMES=(.*?);', text)
    if match:
        etf_names = set(re.findall(r'"([^"]+)"', match.group(1)))
    result = []
    for name, code in re.findall(r'"([^"]+)":"([0-9A-Za-z]{6})"', text):
        if name in etf_names or not code.isdigit():
            continue
        result.append({'code': code, 'name': name})
        if len(result) == 46:
            break
    if len(result) < 46:
        raise RuntimeError('KRX_MAP에서 국내 46종목을 구성하지 못했습니다.')
    return result


def _forward_returns(daily, index):
    entry = daily[index].get('close')
    if not entry:
        return {}
    result = {}
    for label, horizon in (('t5', 5), ('t10', 10), ('t20', 20)):
        target = index + horizon
        if target < len(daily) and daily[target].get('close'):
            result[label + '_return'] = round(daily[target]['close'] / entry * 100 - 100, 4)
    return result


def evaluate_stock(conn, stock, min_history=60):
    daily = db_schema.load_daily_prices(conn, stock['code'])
    rows = []
    for index in range(min_history, max(min_history, len(daily) - 20)):
        assessment = swing_model.build_swing_assessment(daily[:index + 1])
        chart = assessment['chartRegime']
        if chart['key'] not in ('uptrend', 'upturn'):
            continue
        if chart['key'] == 'upturn' and chart.get('turningPoint') != 'confirmed':
            continue
        outcome = _forward_returns(daily, index)
        if 't20_return' not in outcome:
            continue
        rows.append({
            'code': stock['code'], 'name': stock['name'], 'date': daily[index]['date'],
            'regime': chart['label'], 'turningPoint': chart.get('turningPoint'),
            **outcome,
        })
    return rows


def summarize(rows):
    grouped = defaultdict(list)
    for row in rows:
        grouped[row['regime']].append(row)

    def stats(items):
        if not items:
            return {'signals': 0, 't5Avg': None, 't10Avg': None, 't20Avg': None,
                    't5WinRate': None, 't10WinRate': None, 't20WinRate': None}
        def avg(field):
            return round(sum(item[field] for item in items) / len(items), 4)
        def win(field):
            return round(sum(item[field] > 0 for item in items) / len(items) * 100, 2)
        return {'signals': len(items), 't5Avg': avg('t5_return'), 't10Avg': avg('t10_return'),
                't20Avg': avg('t20_return'), 't5WinRate': win('t5_return'),
                't10WinRate': win('t10_return'), 't20WinRate': win('t20_return')}

    return {key: stats(value) for key, value in sorted(grouped.items())}


def load_legacy(path):
    if not path:
        return None
    with open(path, 'r', encoding='utf-8') as handle:
        payload = json.load(handle)
    return payload.get('signals') if isinstance(payload, dict) else None


def compare_legacy(rows, legacy_rows):
    if legacy_rows is None:
        return {'status': 'legacy unavailable', 'matchedSignals': 0}
    old = {(row.get('code'), row.get('date')): row for row in legacy_rows if row.get('entry')}
    new = {(row.get('code'), row.get('date')): row for row in rows}
    matched = []
    for key, old_row in old.items():
        new_row = new.get(key)
        if not new_row:
            continue
        matched.append({
            'code': key[0], 'date': key[1],
            'oldT5': old_row.get('t5_return'), 'newT5': new_row.get('t5_return'),
            'oldT10': old_row.get('t10_return'), 'newT10': new_row.get('t10_return'),
            'oldT20': old_row.get('t20_return'), 'newT20': new_row.get('t20_return'),
        })
    return {'status': 'matched', 'matchedSignals': len(matched), 'rows': matched}


def run(db_file=None, legacy_json=None):
    db_path = db_file or db_schema.DB_FILE
    if not os.path.exists(db_path):
        return {
            'status': 'data unavailable', 'db': db_path,
            'message': '운영 ohlc_snapshot.db가 없어 임의 수익률을 생성하지 않았습니다.',
            'universe': load_46_universe(),
        }
    conn = db_schema.get_conn(db_path)
    db_schema.create_schema(conn)
    universe = load_46_universe()
    rows = []
    for stock in universe:
        rows.extend(evaluate_stock(conn, stock))
    conn.close()
    return {
        'status': 'completed', 'modelVersion': swing_model.MODEL_VERSION,
        'generatedAt': datetime.now(timezone.utc).isoformat(), 'universe': universe,
        'signals': len(rows), 'byRegime': summarize(rows),
        'legacyComparison': compare_legacy(rows, load_legacy(legacy_json)),
    }


def main():
    parser = argparse.ArgumentParser(description='Run the domestic 46-stock 4-week swing backtest.')
    parser.add_argument('--db', default=None, help='SQLite ohlc_snapshot.db path')
    parser.add_argument('--legacy-json', default=None, help='optional old-model signal result JSON')
    parser.add_argument('--output', default=None, help='optional JSON output path')
    args = parser.parse_args()
    payload = run(args.db, args.legacy_json)
    rendered = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as handle:
            handle.write(rendered + '\n')
    print(rendered)


if __name__ == '__main__':
    main()
