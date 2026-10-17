# -*- coding: utf-8 -*-
"""실계좌 엔진(PC 전용 live_engine.py)의 매수·매도 주문을 텔레그램으로 알리기 위한 읽기 전용 부품(2026-10-18).

실제 주문을 내는 엔진은 저장소 밖의 live_engine.py 이고 장부는 `live_orders.db`(intents·positions)다. 지금까지 텔레그램 감시자(tg_monitor)는
로컬 봇의 `autotrader.db`(감시 종목 손절·익절)만 읽어서, 엔진이 낸 매수·매도 주문은 알림에 나타나지 않았다.
여기서는 엔진 코드와 주문 흐름은 건드리지 않고 장부를 **읽기 전용**으로 읽어 알림 문구만 만든다. 전송 실패가 엔진에 영향을 주지 않는다
(별도 스레드·읽기 전용 연결·예외 삼킴).

검증된 사실과 미확인
- 검증(저장소 테스트·문서): intents 열 id·ts·code·side(BUY|SELL)·qty·state·order_no, 새 엔진은 price(매수=주문 접수가, 매도=판정가)·reason(ENTRY|STOP_3|STOP_EMERGENCY|TRAIL_2_5)
  ·note(JSON) 를 채운다. 접수 상태값 `ACK`. 체결 평균가는 장부에 없고 사용자가 남기는 `order_fills.json`(키움 당일매매일지)에만 있다.
- 미확인: ACK 이외 state 값의 정확한 목록(거부·실패·부분체결 표기), note JSON의 검색기 이름 키. 그래서 알 수 없는 state 는 원문을 그대로 보여 주고
  '체결 완료'로 쓰지 않는다. 체결·손익은 order_fills.json 근거가 있을 때만 표시한다.
"""
import json
import os
import re

import tg_data
import tg_format as F

# 접수 이후 단계. 확인된 근거 없이 'FILLED'를 만들지 않는다.
STAGES = {
    'REQUESTED': ('🕘', '주문 요청', '엔진이 주문을 만들었지만 증권사 접수는 아직 확인되지 않았습니다'),
    'ACCEPTED': ('📨', '증권사 접수', '접수일 뿐 체결 확인이 아닙니다'),
    'PARTIAL': ('◐', '일부 체결', '일부 수량만 체결이 확인됐습니다'),
    'FILLED': ('✅', '전량 체결', '체결 기록으로 전량 체결이 확인됐습니다'),
    'REJECTED': ('⛔', '증권사 거부', '주문이 들어가지 않았습니다'),
    'FAILED': ('⛔', '전송 실패', '접수 여부가 불명확합니다. 증권사 앱에서 직접 확인하세요'),
    'UNKNOWN': ('❔', '상태 확인 필요', '엔진 장부의 상태값을 해석하지 못했습니다. 증권사 앱에서 확인하세요'),
}
EXIT_REASONS = {'STOP_3': '손절(가격 -3% 연속 확인)', 'STOP_EMERGENCY': '비상 손절(가격 -5%)', 'TRAIL_2_5': '익절(고점 대비 -2.5% 이탈)',
                'STOP': '손절', 'TP_CAP': '익절(상한)', 'TP_FLOOR': '익절(수익 보호)'}
ENTRY_REASONS = {'ENTRY': '진입 조건 충족'}
SCANNER_KEYS = ('scanner', 'scanner_name', 'scanners', 'source', 'strategy', '검색기')
SCANNER_LABELS = {'pullback': '눌림목', 'maCloudBreakout': '구름대 돌파', 'doubleBottom': '쌍바닥', 'invHeadShoulders': '역헤드앤숄더',
                  'risingLows': '저점상승형', 'shortTermMaBreakout': '단기이평 돌파', 'boxRangeLow': '박스권 하단',
                  'firstPullbackBreakout': '첫 눌림 돌파', 'angleMomentum': '각도기', 'gongpasan': '공파산', 'volumeBreakout': '거래량 돌파'}
CODE_RE = re.compile(r'\d{6}|[0-9A-Z]{6}')


def base_stage(state):
    """장부 state -> 단계. 검증된 값은 ACK 하나뿐이라 나머지는 이름에 든 낱말로만 조심스럽게 가른다."""
    s = str(state or '').upper()
    if s in ('ACK', 'ACKED', 'ACCEPTED', 'SENT'):
        return 'ACCEPTED'
    if 'REJ' in s:
        return 'REJECTED'
    if 'FAIL' in s or 'ERR' in s:
        return 'FAILED'
    if 'PART' in s:
        return 'PARTIAL'
    if s in ('NEW', 'PENDING', 'REQUESTED', 'CREATED', 'INTENT', 'SENDING'):
        return 'REQUESTED'
    return 'UNKNOWN'


def read_intents(path, day):
    """오늘(KST 날짜 문자열) 의 intents 행. 열이 없는 예전 장부도 동작한다. 장부가 없거나 열 수 없으면 빈 목록."""
    conn = tg_data.ro_connect(path)
    if conn is None:
        return []
    try:
        cols = {r[1] for r in conn.execute('PRAGMA table_info(intents)')}
        if not {'id', 'ts', 'code', 'side', 'qty', 'state'} <= cols:
            return []
        extra = ''.join(',%s' % c for c in ('order_no', 'price', 'reason', 'note') if c in cols)
        rows = conn.execute('SELECT id,ts,code,side,qty,state%s FROM intents WHERE ts>=? ORDER BY id' % extra, (day,)).fetchall()
        names = ['id', 'ts', 'code', 'side', 'qty', 'state'] + [c for c in ('order_no', 'price', 'reason', 'note') if c in cols]
        out = []
        for r in rows:
            d = dict(zip(names, r))
            if str(d.get('ts') or '')[:10] != day:
                continue
            note = d.get('note')
            if isinstance(note, str):
                try:
                    note = json.loads(note)
                except ValueError:
                    note = {}
            d['note'] = note if isinstance(note, dict) else {}
            out.append(d)
        return out
    except Exception:
        return []
    finally:
        conn.close()


def read_fills(folder):
    """order_fills.json(사용자가 남긴 키움 당일매매일지 체결)을 읽는다. server.load_fills 와 같은 형식. 없으면 빈 목록."""
    path = os.path.join(folder, 'order_fills.json')
    try:
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return []
    out = []
    for row in (data.get('fills') if isinstance(data, dict) else None) or []:
        try:
            code, side, date = str(row.get('code') or ''), str(row.get('side') or '').upper(), str(row.get('date') or '')
            price, qty = float(row.get('price') or 0), int(row.get('qty') or 0)
        except (TypeError, ValueError, AttributeError):
            continue
        if CODE_RE.fullmatch(code) and side in ('BUY', 'SELL') and len(date) == 10 and price > 0 and qty > 0:
            out.append({'date': date, 'code': code, 'side': side, 'price': price, 'qty': qty, 'source': str(row.get('source') or '체결 기록')})
    return out


def scanner_label(note):
    """note JSON 에서 검색기 이름을 찾는다(키 이름은 미확인이라 흔한 후보만 본다). 못 찾으면 None."""
    for key in SCANNER_KEYS:
        value = (note or {}).get(key)
        if isinstance(value, (list, tuple)):
            value = ', '.join(str(v) for v in value)
        if value:
            parts = [SCANNER_LABELS.get(p.strip(), p.strip()) for p in str(value).split(',') if p.strip()]
            if parts:
                return ', '.join(parts)
    return None


def build(intent, intents, fills, name=None):
    """한 주문의 알림 재료와 중복 방지 키. 반환 (key, data). data 는 fmt_live_order 입력.
    같은 주문이라도 단계(접수 -> 일부/전량 체결)나 확인된 체결이 바뀌면 키가 달라져 새 알림이 한 번 더 나간다."""
    day = str(intent['ts'])[:10]
    side, code = intent['side'], intent['code']
    stage = base_stage(intent.get('state'))
    qty_total = sum(int(i.get('qty') or 0) for i in intents if i['code'] == code and i['side'] == side and str(i['ts'])[:10] == day)
    fill = next((f for f in fills if f['date'] == day and f['code'] == code and f['side'] == side), None)
    if fill and stage in ('ACCEPTED', 'REQUESTED', 'PARTIAL', 'UNKNOWN'):
        stage = 'FILLED' if qty_total and fill['qty'] >= qty_total else 'PARTIAL'
    buy_fill = None
    if side == 'SELL':
        buy_fill = next((f for f in fills if f['code'] == code and f['side'] == 'BUY' and f['date'] <= day), None)
    note = intent.get('note') or {}
    data = {'id': intent['id'], 'ts': intent['ts'], 'side': side, 'code': code, 'name': name, 'qty': int(intent.get('qty') or 0),
            'price': intent.get('price'), 'state': intent.get('state'), 'stage': stage, 'order_no': intent.get('order_no'),
            'reason': intent.get('reason'), 'scanner': scanner_label(note), 'note': note, 'fill': fill, 'buy_fill': buy_fill}
    sig = '%s:%s' % (fill['qty'], int(fill['price'])) if fill else '-'
    return 'liveord:%s:%s:%s:%s' % (intent['id'], stage, str(intent.get('state') or '-'), sig), data


def _krw(value):
    return '%s원' % F.num(value)


def fmt_live_order(d, now):
    """실계좌 엔진 매수·매도 주문 알림(🏦 [실계좌]). 확인되지 않은 체결가·손익은 만들지 않는다."""
    icon, label, hint = STAGES[d['stage']]
    is_buy = d['side'] == 'BUY'
    title = '%s %s · %s' % ('매수' if is_buy else '매도', '주문', label)
    when = F.to_dt(d.get('ts'))
    who = F.stock(d.get('name'), d['code'])
    lines = [F.head(icon, title, F.TAG_REAL), '', who]
    lines.append('주문 시각: %s' % ('%s(%s) %s KST' % (when.strftime('%Y-%m-%d'), F.WEEKDAYS[when.weekday()], when.strftime('%H:%M:%S')) if when else '-'))
    qty, price = d.get('qty') or 0, d.get('price')
    price_kind = '주문가' if is_buy else '판정가(시장가 주문)'
    row = '주문 수량: %s주' % F.num(qty)
    if price:
        row += ' · %s %s' % (price_kind, _krw(price))
        row += ' · 주문금액 %s(%s 기준, 체결금액 아님)' % (_krw(qty * float(price)), price_kind)
    else:
        row += ' · %s 기록 없음' % price_kind
    lines.append(row)
    fill = d.get('fill')
    if fill:
        lines.append('<b>확인된 체결</b>: %s주 · 평균 %s · 체결금액 %s <i>(%s)</i>' % (F.num(fill['qty']), _krw(fill['price']), _krw(fill['qty'] * fill['price']), F.esc(fill['source'])))
    else:
        lines.append('확인된 체결: 아직 없음 <i>(체결 평균가는 체결 기록이 남은 뒤에만 표시)</i>')
    reason = d.get('reason')
    if is_buy:
        text = ENTRY_REASONS.get(reason, reason or '기록 없음')
        lines.append('매수 사유: %s%s' % (F.esc(text), ' · 검색기 %s' % F.esc(d['scanner']) if d.get('scanner') else ' · 검색기 이름 기록 없음'))
    else:
        lines.append('매도 사유: %s' % F.esc(EXIT_REASONS.get(reason, reason or '기록 없음')))
        buy_fill = d.get('buy_fill')
        if fill and buy_fill:
            profit = (fill['price'] - buy_fill['price']) * fill['qty']
            rate = (fill['price'] / buy_fill['price'] - 1) * 100
            lines.append('실현손익: %s %s원 (%s) <i>(체결 평균가 %s → %s, 비용 제외)</i>' % (F.tone(profit), F.num(profit), F.pct_points(rate), F.num(buy_fill['price']), F.num(fill['price'])))
        else:
            lines.append('실현손익: 확인 불가 <i>(매수·매도 체결가가 모두 확인돼야 계산합니다)</i>')
    lines += ['', '<i>%s</i>' % F.esc(hint)]
    meta = '상태 코드 %s' % F.esc(d.get('state') or '-')
    if d.get('order_no'):
        meta += ' · 주문번호 …%s' % F.esc(str(d['order_no'])[-4:])
    lines += ['<i>%s</i>' % meta, F.foot(now)]
    return '\n'.join(lines)
