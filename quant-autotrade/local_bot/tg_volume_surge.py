# -*- coding: utf-8 -*-
"""거래량 급증 관찰 알림(2026-10-18): VM의 장중 감시(volume_surge_live.py) 결과를 텔레그램으로 알린다.

새로 전 종목을 훑지 않는다. 운영 VM이 이미 30초마다 만드는 공개 응답(`/volume-surge-live`)의 '실시간 감지' 행만 읽어 알림으로 바꾼다.
텔레그램 토큰은 PC `.env`에만 있으므로(VM에 새 비밀값을 두지 않는다) 알림은 PC 봇이 보낸다. 이 알림은 관찰용이며 자동매수·자동매도
조건과 주문에는 어떤 영향도 없다(읽기만 하고 주문 엔진·봇 판단 루프를 부르지 않는다).

중복 방지: 같은 거래일·같은 종목·같은 감지 시각은 알림 키(`vsurge:날짜:코드:감지시각`)가 같아 대기열(telegram.db)이 한 번만 받는다.
재시작해도 같은 DB 라 다시 보내지 않는다.
측정 지표(검출 성능 비교용): 알림을 적재할 때 감지 시각·알림 적재 시각·지연(초)을 kv `surge_log`에 최근 200건 남긴다. 순위 API 밖 종목 누락은
전체 시장 기준 자료가 없어 **측정 불가**다.
"""
import json
import time
import urllib.request
from datetime import datetime, timedelta, timezone

import tg_format as F

KST = timezone(timedelta(hours=9))
SURGE_URL = 'https://goodbyestar.cloud/volume-surge-live'
POLL_MIN_SEC = 30
FETCH_TIMEOUT_SEC = 6
LOG_KEEP = 200
TAG_WATCH = '👀 [관찰]'


def in_session(now_dt):
    """평일 08:55~15:40 KST 에만 VM 을 부른다(장 밖에는 감지가 없다. 휴장일은 VM 응답의 active=false 로 걸러진다)."""
    if now_dt.weekday() >= 5:
        return False
    hm = (now_dt.hour, now_dt.minute)
    return (8, 55) <= hm <= (15, 40)


def fetch(url=SURGE_URL, timeout=FETCH_TIMEOUT_SEC):
    """VM 공개 응답(JSON)의 data 를 돌려준다. 실패하면 예외(호출부가 삼킨다)."""
    req = urllib.request.Request(url, headers={'User-Agent': '9pay-quant-bot/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        payload = json.loads(res.read().decode('utf-8'))
    return payload.get('data') if isinstance(payload, dict) else None


def live_detections(payload):
    """응답에서 장중 실시간 감지 행만 골라 정규화한다. 일봉 기반 매집봉 행(patternDetail.live 가 없음)은 제외."""
    out = []
    for item in (payload or {}).get('items') or []:
        detail = item.get('patternDetail') or {}
        det_at = F.to_dt(detail.get('detectedAt'))
        if not item.get('code') or not detail.get('live') or det_at is None or item.get('price') is None:
            continue
        out.append({'code': str(item['code']), 'name': item.get('name'), 'detected_at': det_at, 'price': item.get('price'),
                    'change': detail.get('changeRate', item.get('changeRate')), 'pace3': detail.get('pace3'),
                    'cum_ratio': detail.get('volumeRatio'), 'status': detail.get('status'),
                    'gain_since': detail.get('gainSinceDetectPct'), 'current': detail.get('currentPrice')})
    return out


def alert_key(d):
    return 'vsurge:%s:%s:%s' % (d['detected_at'].strftime('%Y-%m-%d'), d['code'], d['detected_at'].strftime('%H%M%S'))


def fmt_surge(d, now):
    at = d['detected_at']
    lines = [F.head('👀', '거래량 급증 감지', '%s · 자동매매 주문 아님' % TAG_WATCH), '', F.stock(d.get('name'), d['code']),
             '감지 시각: %s(%s) %s KST' % (at.strftime('%Y-%m-%d'), F.WEEKDAYS[at.weekday()], at.strftime('%H:%M:%S')),
             '감지가: %s원 · 감지 시점 등락률 %s' % (F.num(d.get('price')), F.pct_points(d['change']) if d.get('change') is not None else '-')]
    if d.get('pace3') is not None:
        row = '거래량 속도: 최근 3분 거래량이 전일 거래량의 %s%%(3분 환산)' % F.num(float(d['pace3']) * 100, 1)
        if d.get('cum_ratio') is not None:
            row += ' · 오늘 누적은 전일의 %s%%' % F.num(float(d['cum_ratio']) * 100)
        lines.append(row)
    if d.get('gain_since') is not None:
        lines.append('감지가 대비 지금(조회 시점): %s %s' % (F.tone(d['gain_since']), F.pct_points(d['gain_since'])))
    lines += ['', '<i>거래가 붙기 시작한 초기 구간 감지입니다. 방향은 보장하지 않으며 매수 신호가 아닙니다. 기존 자동매수 조건과 무관한 관찰용 알림입니다.</i>', F.foot(now)]
    return '\n'.join(lines)


def record(tstore, d, noticed_epoch):
    """검출 성능 지표 기록(최근 LOG_KEEP 건): 감지 시각, 알림 적재 시각, 지연 초."""
    log = tstore.kv_get('surge_log') or []
    detected = d['detected_at'].timestamp()
    log.append({'key': alert_key(d), 'detectedAt': d['detected_at'].isoformat(), 'queuedAt': noticed_epoch,
                'delaySec': round(noticed_epoch - detected, 1)})
    tstore.kv_set('surge_log', log[-LOG_KEEP:])
