"""체결강도 순위 기록(2026-11-14, 연구용 관측 저장).

홈 종목판이 이미 받아 오는 KIS 체결강도 순위(FHPST01680000, ETF·ETN·스팩 제외 섹션
`volumePowerStocks`)를 5분 슬롯마다 한 번만 기존 OHLC DB에 남긴다. 새 외부 호출·폴러·
프로세스는 없다. 종목판이 갱신될 때(방문자 또는 기존 워머)만 기록되므로 방문이 없던 시간은
빈 슬롯으로 남는다(빈 슬롯을 0이나 직전 값으로 채우지 않는다).
값은 KRX 순위 응답의 당일 체결강도(tday_rltv)이며 체결 스트리밍이나 NXT 통합값이 아니다.
보존 400일. 주문·검색기 판정에는 쓰지 않는다(이후 성과 연구용).
"""
from datetime import datetime, timedelta
import math
from zoneinfo import ZoneInfo

import db_schema

KST = ZoneInfo('Asia/Seoul')
SLOT_MINUTES = 5
KEEP_DAYS = 400
MAX_ROWS = 30
SESSION_START, SESSION_END = 9 * 60, 15 * 60 + 30
TABLE_SQL = ('CREATE TABLE IF NOT EXISTS volume_power_observations ('
             'session TEXT NOT NULL, slot INTEGER NOT NULL, observed_ts INTEGER NOT NULL, '
             'rank INTEGER NOT NULL, code TEXT NOT NULL, name TEXT, price REAL, change_rate REAL, '
             'strength REAL NOT NULL, trade_amount REAL, PRIMARY KEY(session, slot, code))')
_last_slot = None  # 같은 5분 슬롯은 프로세스 안에서 한 번만 쓴다(종목판은 20~30초마다 갱신).


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def capture(board, now=None, conn=None):
    """board: fetch_domestic_kis 결과. 기록한 행 수를 반환(조건 밖이면 0)."""
    import market_clock
    now = (now or datetime.now(KST)).astimezone(KST)
    minute = now.hour * 60 + now.minute
    if not SESSION_START <= minute <= SESSION_END or not market_clock.is_kr_trading_day(now):
        return 0
    if not isinstance(board, dict) or board.get('market') != 'domestic':
        return 0
    updated = board.get('updated_at')
    if not _finite(updated) or not 0 <= now.timestamp() - updated <= 120:
        return 0
    rows = ((board.get('sections') or {}).get('volumePowerStocks') or [])[:MAX_ROWS]
    clean = []
    for rank, row in enumerate(rows, 1):
        code = str((row or {}).get('code') or '')
        strength = (row or {}).get('execution_strength')
        if len(code) != 6 or not code.isdigit() or not _finite(strength) or strength < 0:
            continue
        clean.append((rank, code, row.get('name'), row.get('price') if _finite(row.get('price')) else None,
                      row.get('change_rate') if _finite(row.get('change_rate')) else None, float(strength),
                      row.get('trade_amount') if _finite(row.get('trade_amount')) else None))
    if not clean:
        return 0
    global _last_slot
    session, slot = now.strftime('%Y-%m-%d'), minute // SLOT_MINUTES * SLOT_MINUTES
    if conn is None and _last_slot == (session, slot):
        return 0
    own = conn is None
    conn = conn or db_schema.get_conn()
    try:
        # 장시간 배치가 쓰기 잠금을 쥐고 있으면 기다리지 않고 이번 슬롯을 건너뛴다(종목판 응답 지연 방지).
        conn.execute('PRAGMA busy_timeout=1500')
        # 운영 DB에 표가 아직 없을 수 있어(스키마는 야간 배치가 만든다) 같은 정의로 먼저 보장한다.
        conn.execute(TABLE_SQL)
        conn.executemany('INSERT OR IGNORE INTO volume_power_observations VALUES (?,?,?,?,?,?,?,?,?,?)',
                         [(session, slot, int(updated), *r) for r in clean])
        conn.execute('DELETE FROM volume_power_observations WHERE session < ?',
                     ((now - timedelta(days=KEEP_DAYS)).strftime('%Y-%m-%d'),))
        conn.commit()
        if own:
            _last_slot = (session, slot)
    finally:
        if own:
            conn.close()
    return len(clean)
