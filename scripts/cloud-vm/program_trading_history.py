# -*- coding: utf-8 -*-
"""프로그램매매(차익/비차익거래) 일별 스냅샷을 로컬에 누적 저장한다.

ka90007(프로그램매매누적추이요청)은 date 파라미터로 지정한 "그날 하루"의 값만 주고
과거 여러 날을 한 번에 돌려주지 않는다(2026-08-14 VM 실측 - mktfunds(FHKST649100C0)와
달리 output이 1건뿐이었음). 그래서 "1년 평균"을 내려면 하루하루 값을 직접 쌓아야
한다 - domestic_market_indicators.fetch_program_trading()이 성공적으로 조회할 때마다
그날 값을 여기에 기록하고(같은 날짜는 최신 값으로 덮어씀), backfill_program_trading_history.py
(1회성 스크립트)로 과거 영업일을 미리 채워 넣을 수도 있다.
"""

import json
import os

HISTORY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'program_trading_history.json')
# 영업일 기준 1년(약 252일)보다 넉넉히 - 달력일 기준 공휴일 포함해도 1년을 covers.
MAX_ENTRIES = 400


def load():
    """{'YYYY-MM-DD': {'arbitrage':.., 'nonArbitrage':.., 'total':..}, ...}"""
    if not os.path.exists(HISTORY_FILE):
        return {}
    try:
        with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save(history):
    with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
        json.dump(history, f, ensure_ascii=False)


def record(date, arbitrage, non_arbitrage, total):
    """오늘(또는 지정 날짜) 값을 기록한다. 같은 날짜가 이미 있으면 최신 값으로 덮어쓴다.
    항목이 MAX_ENTRIES를 넘으면 가장 오래된 날짜부터 지운다."""
    if not date:
        return
    history = load()
    history[date] = {'arbitrage': arbitrage, 'nonArbitrage': non_arbitrage, 'total': total}
    if len(history) > MAX_ENTRIES:
        for old_date in sorted(history.keys())[:len(history) - MAX_ENTRIES]:
            del history[old_date]
    _save(history)


def series(history, field, limit=None):
    """오래된 날짜 -> 최신 날짜 순으로 정렬된 (date, value) 목록. limit이 있으면 최근
    limit개만(1년 평균처럼 특정 구간 평균을 낼 때 사용)."""
    rows = sorted(
        ((date, entry.get(field)) for date, entry in history.items() if entry.get(field) is not None),
        key=lambda row: row[0],
    )
    return rows[-limit:] if limit else rows


def average(history, field, limit=None):
    rows = series(history, field, limit)
    values = [value for _, value in rows]
    return (sum(values) / len(values)) if values else None
