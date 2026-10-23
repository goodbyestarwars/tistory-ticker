# -*- coding: utf-8 -*-
"""실계좌 runner 상태(live_status.json)와 오늘 장부를 읽기 전용으로 읽어 텔레그램 알림 문구와 판단만 만든다(2026-10-23).

배경: 2026-10-22·23 연속으로 매수가 막혔는데(FOREIGN_HOLDINGS, SLOTS_FULL) 사용자가 파일을 직접 열어 보기 전에는 알 수 없었다.
runner·엔진·주문 코드는 건드리지 않고, 이미 남는 기록(live_status.json, live_orders.db 의 intents·skips·positions)만 읽는다.

알림 종류
  막힘 상태   runner 가 매수·청산을 못 하는 상태(FOREIGN_HOLDINGS, PENDING_ORDERS, ERROR_* 등) - 발생 시 즉시, 계속되면 재알림, 풀리면 복구 알림
  피드 장애   9Pay 신호 피드가 3분 넘게 불가
  응답 없음   장중인데 live_status.json 이 5분 넘게 갱신되지 않음(runner 가 죽었거나 멈춤)
  요약        평일 09:05 준비 점검, 14:05 매수 시간 종료, 15:35 장 마감 - 오늘 주문·보유·못 산 이유

값을 지어내지 않는다: 읽지 못한 항목은 '확인 불가'로 쓰고, 상태 문구는 장부·상태 파일에 있는 값만 옮긴다.
"""
import json
import os
import sqlite3
from datetime import datetime

import tg_format as F

STATUS_FILE = 'live_status.json'
LEDGER_FILE = 'live_orders.db'
STALE_SEC = 300
FEED_DOWN_SEC = 180

# 상태 -> (수준, 제목, 설명, 조치). 이 상태가 계속되면 새 매수·청산이 진행되지 않는다.
BLOCKING = {
    'FOREIGN_HOLDINGS': ('critical', '계좌에 장부 밖 보유 종목', '장부에도 제외 목록에도 없는 보유 종목이 있어 runner 가 신규 매수를 하지 않고 종료합니다.',
                         '제외할 종목이면 engine_excluded.json 과 장부에 추가하거나 직접 정리하세요'),
    'PENDING_ORDERS': ('warn', '미체결 주문 있음', '계좌에 미체결 주문이 있어 runner 가 새 주문을 내지 않습니다.', '증권사 앱에서 미체결 주문을 확인·정리하세요'),
    'BUY_FILL_UNCONFIRMED': ('critical', '매수 체결 미확인', '접수한 매수 주문의 체결이 확인되지 않아 runner 가 멈췄습니다.', '증권사 앱에서 체결 여부를 확인하세요'),
    'SELL_FILL_UNCONFIRMED': ('critical', '매도 체결 미확인', '접수한 매도 주문의 체결이 확인되지 않아 runner 가 멈췄습니다.', '증권사 앱에서 체결 여부를 확인하세요'),
    'DISABLED_OR_UNCERTAIN': ('critical', '실거래 승인·장부 상태 불확실', '승인 파일 불일치 또는 장부에 불확실한 주문이 있어 runner 가 멈췄습니다.', '승인 파일(LIVE_TRADING_APPROVAL)과 장부를 확인하세요'),
    'EXCLUSION_UNCONFIRMED': ('critical', '제외 목록 확인 불가', '제외 목록을 읽지 못해 어떤 주문도 내지 않습니다.', 'engine_excluded.json 형식을 확인하세요'),
    'INSUFFICIENT_STARTING_CASH': ('warn', '시작 현금 부족', '첫 매수 전 주문가능금액이 예산보다 적어 매수하지 않습니다.', '입금 또는 예산 설정을 확인하세요'),
}
SKIP_TEXT = {
    'SLOTS_FULL': '종목 수 한도(슬롯)가 가득 참', 'NO_CASH': '주문가능금액이 유보금 이하', 'BUDGET_COMMITTED': '예산이 이미 점유됨',
    'WINDOW_CLOSED': '진입 시간이 아님', 'GAP_UP_OVER_2PCT': '시가 갭 상승 2% 초과', 'BELOW_20D_MEAN': '20일 평균 아래',
    'LOW_TRADED_VALUE': '거래대금 부족', 'QTY_OR_PER_STOCK_LIMIT': '1주 가격이 한도 초과', 'ALREADY_HELD_OR_SENT': '이미 보유·주문함',
    'EXCLUDED': '제외 종목', 'PRODUCT_EXCLUDED': '상품 제외(인버스·레버리지·금리형)',
}
SUMMARY_SLOTS = (('0905', 9 * 60 + 5, '준비 점검'), ('1405', 14 * 60 + 5, '매수 시간 종료'), ('1535', 15 * 60 + 35, '장 마감'))


def is_blocking(state):
    return state in BLOCKING or str(state or '').startswith('ERROR_')


def blocking_info(state):
    if state in BLOCKING:
        return BLOCKING[state]
    return ('critical', 'runner 오류 (%s)' % state, 'runner 가 오류로 멈췄습니다. 상태값: %s' % state, 'logs 폴더와 live_status.json 을 확인하세요')


def read_status(base_dir):
    try:
        with open(os.path.join(base_dir, STATUS_FILE), encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def status_age_sec(status, now_dt):
    """checked_at 이 읽히면 경과 초, 아니면 None."""
    dt = F.to_dt((status or {}).get('checked_at'))
    if dt is None:
        return None
    if dt.tzinfo is None and now_dt.tzinfo is not None:
        dt = dt.replace(tzinfo=now_dt.tzinfo)
    return (now_dt - dt).total_seconds()


def feed_info(status):
    feed = (status or {}).get('feed') or {}
    return feed.get('state'), feed.get('reason')


def read_today(base_dir, day):
    """오늘 장부 요약(읽기 전용). 열 수 없으면 None. {'orders': [...], 'open': [...], 'skips': [(reason, count, detail)]}"""
    path = os.path.join(base_dir, LEDGER_FILE)
    if not os.path.exists(path):
        return None
    try:
        conn = sqlite3.connect('file:%s?mode=ro' % path.replace('\\', '/'), uri=True, timeout=2)
    except sqlite3.Error:
        return None
    try:
        orders = [dict(zip(('ts', 'code', 'side', 'qty', 'price', 'state'), r)) for r in conn.execute(
            "SELECT ts,code,side,qty,price,state FROM intents WHERE substr(ts,1,10)=? ORDER BY id", (day,))]
        open_pos = [dict(zip(('code', 'qty', 'state'), r)) for r in conn.execute("SELECT code,qty,state FROM positions WHERE state!='CLOSED'")]
        skips = conn.execute("SELECT reason,SUM(count),MAX(detail) FROM skips WHERE day=? GROUP BY reason ORDER BY SUM(count) DESC", (day,)).fetchall()
        return {'orders': orders, 'open': open_pos, 'skips': [(r[0], int(r[1] or 0), r[2]) for r in skips]}
    except sqlite3.Error:
        return None
    finally:
        conn.close()


def fmt_blocking(state, now_dt):
    level, title, body, action = blocking_info(state)
    return level, F.fmt_alert(title, [body, '상태값: <code>%s</code>' % F.esc(state)], level, action, now_dt)


def fmt_feed_down(reason, now_dt):
    return F.fmt_alert('9Pay 신호 피드 불가', ['9Pay 신호 피드가 %d분 넘게 불가입니다.' % (FEED_DOWN_SEC // 60), '사유: %s' % F.esc(reason or '확인 불가'),
                                            '피드가 복구되기 전에는 9Pay 신호 매수가 나가지 않습니다(기존 엔진 매수와 청산은 별도).'], 'warn',
                       'VM 상태는 https://goodbyestar.cloud/health/9pay 에서 확인하세요', now_dt)


def fmt_stale(age_sec, now_dt):
    return F.fmt_alert('runner 응답 없음', ['live_status.json 이 %d분 넘게 갱신되지 않았습니다(마지막 %d분 전).' % (STALE_SEC // 60, age_sec // 60),
                                         'runner 가 멈췄거나 PC 가 절전 상태일 수 있습니다. 이 동안 매수와 청산 점검이 없습니다.'], 'critical',
                       'PC에서 AutotraderLiveTrading 작업 상태를 확인하세요', now_dt)


def skip_lines(skips, limit=4):
    out = []
    for reason, count, detail in skips[:limit]:
        text = SKIP_TEXT.get(reason, reason)
        extra = ' (%s)' % F.esc(F.clip(detail, 60)) if detail and reason in ('SLOTS_FULL', 'NO_CASH', 'BUDGET_COMMITTED') else ''
        out.append('· %s ×%d%s' % (F.esc(text), count, extra))
    return out


def fmt_summary(label, status, today, now_dt, name_of=lambda code: None):
    """label: 준비 점검 | 매수 시간 종료 | 장 마감."""
    lines = [F.head('📋', '자동매매 %s' % label), '']
    state = (status or {}).get('state')
    fstate, freason = feed_info(status)
    age = status_age_sec(status, now_dt)
    if status is None:
        lines.append('runner 상태 파일을 읽지 못했습니다(확인 불가).')
    else:
        lines.append('runner 상태: <code>%s</code>%s' % (F.esc(state or '-'), '' if age is None else ' · 마지막 점검 %d분 전' % (age // 60)))
        lines.append('신호 피드: %s' % ('정상' if fstate == 'OK' else '불가 (%s)' % F.esc(freason or '확인 불가') if fstate else '확인 불가'))
    if today is None:
        lines += ['', '오늘 장부를 읽지 못했습니다(확인 불가).']
    else:
        buys = [o for o in today['orders'] if o['side'] == 'BUY']
        sells = [o for o in today['orders'] if o['side'] == 'SELL']
        lines += ['', '오늘 주문: 매수 %d건 · 매도 %d건' % (len(buys), len(sells))]
        for o in (buys + sells)[:5]:
            nm = name_of(o['code']) or o['code']
            lines.append('· %s %s %s주%s' % ('매수' if o['side'] == 'BUY' else '매도', F.esc(nm), o['qty'], '' if not o.get('price') else ' @%s' % format(int(o['price']), ',')))
        lines.append('열린 포지션: %d종목' % len(today['open']))
        if not buys and today['skips']:
            lines += ['', '못 산 이유(오늘 기록):'] + skip_lines(today['skips'])
        elif not buys and label != '준비 점검':
            lines += ['', '오늘 매수 신호가 없었습니다(기록된 막힘 사유 없음).']
    return '\n'.join(lines + ['', F.foot(now_dt)])


def due_slots(now_dt):
    """지금 시각이 지난 요약 슬롯 키 목록(오늘 아직 안 보낸 것은 호출 쪽이 키로 거른다). 평일만."""
    if now_dt.weekday() >= 5:
        return []
    hm = now_dt.hour * 60 + now_dt.minute
    return [(key, label) for key, minute, label in SUMMARY_SLOTS if minute <= hm < minute + 20]


def day_key(now_dt):
    return now_dt.strftime('%Y%m%d')


def parse_day(now_dt):
    return now_dt.strftime('%Y-%m-%d')
