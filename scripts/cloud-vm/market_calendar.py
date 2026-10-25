"""Lightweight shared KR holiday calendar; no collectors imported."""
KRX_HOLIDAYS_2026 = {
    '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-01', '2026-03-02',
    '2026-05-01', '2026-05-05', '2026-05-25', '2026-06-03', '2026-06-06', '2026-07-17',
    '2026-08-15', '2026-08-17', '2026-09-24', '2026-09-25', '2026-09-26', '2026-10-03',
    '2026-10-05', '2026-10-09', '2026-12-25', '2026-12-31',
}


def is_kr_trading_day(now_kst):
    """주말·공휴일이면 False. 표에 없는 해는 주말만 걸러진다(보수적으로 True)."""
    if now_kst.weekday() >= 5:
        return False
    return now_kst.strftime('%Y-%m-%d') not in KRX_HOLIDAYS_2026
