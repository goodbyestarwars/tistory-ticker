# -*- coding: utf-8 -*-
"""텔레그램 메시지 서식(순수 함수, HTML parse_mode). 모바일에서 한눈에 읽히도록 짧게, 줄마다 태그를 닫는다.

표기 규칙
- 상승은 🔴, 하락은 🔵(국내 관례·사이트 의미색과 동일). 경고는 ⚠️/🚨 로만 쓰고 🔴 와 섞지 않는다.
- 연구 후보 🔎 [연구] · 모의매매 🧪 [모의] · 실계좌 🏦 [실계좌] 를 항상 머리에 표기한다. 세 성과는 한 메시지 안에서도 섹션을 나누고 합산하지 않는다.
- 종목은 이름과 코드를 함께, 시각은 KST 로 표기한다. 미검증 값은 단정하지 않는다(체결 여부는 확인된 근거만 쓴다).
"""
import html
import re
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
WEEKDAYS = '월화수목금토일'
BRAND = '9Pay Quant'

SCANNER_ORDER = ('pullback', 'maCloudBreakout', 'doubleBottom', 'invHeadShoulders')
SCANNER_LABELS = {'pullback': '눌림목', 'maCloudBreakout': '구름대 돌파', 'doubleBottom': '쌍바닥', 'invHeadShoulders': '역헤드앤숄더'}
VARIANT_ORDER = ('trail_atr', 'atr_close', 'dead35')
VARIANT_LABELS = {'trail_atr': 'ATR 추적(장중·최대 30일)', 'atr_close': 'ATR 종가이탈(다음 시가·최대 150일)', 'dead35': '3·5일선 데드크로스(다음 시가·최대 150일)'}
VARIANT_SHORT = {'trail_atr': 'ATR 추적', 'atr_close': 'ATR 종가이탈', 'dead35': '3·5 데드크로스'}
EXIT_REASONS = {'STOP_INTRADAY': '추적선 장중 이탈', 'SIGNAL_ATR_CLOSE': '종가 추적선 이탈 → 다음 시가 체결', 'SIGNAL_DEAD35': '3·5일선 데드크로스 → 다음 시가 체결',
                'MAX_HOLD_30': '최대 30일 보유 종가 청산', 'MAX_HOLD_150': '최대 150일 보유 종가 청산'}
ORDER_REASONS = {'STOP': '손절', 'TP_CAP': '익절(상한)', 'TP_FLOOR': '익절(수익 보호)'}
RUNNER_STATES = {'starting': '시작 중', 'waiting': '스캔 확정 대기 중', 'done': '완료', 'no_scan': '스캔 미확정으로 종료', 'disk_limit': '용량 상한 도달(정지)'}

# 연구 모의 계좌 규칙(research/allocation.py LIMITS · candidate_gen.py 상수와 같은 값. test_telegram 이 일치를 검사한다)
PAPER_RULES = {'max_pos': 5, 'per_pos_pct': 10, 'total_cap_pct': 30, 'gap_skip_pct': 2.0, 'entry_slip_pct': 0.2}

TAG_PAPER, TAG_REAL, TAG_RESEARCH = '🧪 [모의]', '🏦 [실계좌]', '🔎 [연구]'

# 지속 경고 키 -> (표시 이름, 심각도). /status 의 활성 경고 목록과 등급 계산에 쓴다.
ALERT_META = {
    'kiwoom_balance': ('키움 잔고 조회 실패', 'critical'), 'bot_stalled': ('봇 판단 루프 정지', 'critical'), 'bot_stopped': ('봇 정지(STOP) 상태', 'warn'),
    'research_disk': ('연구 데이터 용량', 'warn'), 'research_hb': ('연구 작업 응답 없음', 'warn'), 'research_not_started': ('오늘 연구 작업 미시작', 'warn'),
    'research_stale': ('연구 데이터 갱신 지연', 'warn'), 'pc_disk': ('PC 디스크 여유 부족', 'warn'), 'tg_conflict': ('텔레그램 수신 충돌', 'warn'),
}


# ---- 공통 조각 ----------------------------------------------------------------
def esc(value):
    return html.escape('' if value is None else str(value), quote=False)


def to_dt(value):
    """ISO 문자열·epoch·datetime → KST datetime (못 읽으면 None)."""
    if value in (None, ''):
        return None
    try:
        if isinstance(value, datetime):
            dt = value
        elif isinstance(value, (int, float)):
            dt = datetime.fromtimestamp(value, KST)
        else:
            text = str(value).strip().replace('Z', '+00:00').replace(' ', 'T', 1)
            dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=KST)
    return dt.astimezone(KST)


def ts(value, with_date=True):
    dt = to_dt(value)
    if dt is None:
        return '-'
    return dt.strftime('%m-%d %H:%M' if with_date else '%H:%M')


def stamp(now):
    dt = to_dt(now) or datetime.now(KST)
    return '%s(%s) %s KST' % (dt.strftime('%Y-%m-%d'), WEEKDAYS[dt.weekday()], dt.strftime('%H:%M'))


def day_label(date_str):
    try:
        d = datetime.strptime(str(date_str)[:10], '%Y-%m-%d')
    except ValueError:
        return esc(date_str)
    return '%s(%s)' % (d.strftime('%Y-%m-%d'), WEEKDAYS[d.weekday()])


def num(value, digits=0):
    if value is None:
        return '-'
    try:
        return ('{:,.%df}' % digits).format(float(value))
    except (TypeError, ValueError):
        return '-'


def pct(frac, digits=2):
    """소수 수익률(0.0123) → '+1.23%'. 음수는 유니코드 마이너스."""
    if frac is None:
        return '-'
    return pct_points(frac * 100, digits)


def pct_points(points, digits=2):
    if points is None:
        return '-'
    text = ('{:+.%df}%%' % digits).format(points)
    return text.replace('-', '−')


def tone(value):
    if value is None or value == 0:
        return '⚪'
    return '🔴' if value > 0 else '🔵'


def stock(name, code):
    return '<b>%s</b> <code>%s</code>' % (esc(name or code), esc(code))


def head(icon, title, sub=None):
    out = '%s <b>%s</b> · <b>%s</b>' % (icon, BRAND, esc(title))
    return out + ('\n<i>%s</i>' % sub if sub else '')


def foot(now):
    return '<i>%s</i>' % stamp(now)


def light(level):
    return {'ok': '🟢 정상', 'warn': '🟡 주의', 'bad': '🔴 이상'}.get(level, '⚪ 확인 불가')


def clip(text, n=70):
    text = re.sub(r'\s+', ' ', str(text or '')).strip()
    return text if len(text) <= n else text[:n - 1] + '…'


def gb(nbytes):
    if nbytes is None:
        return '-'
    return '%.1fGB' % (nbytes / 1024 ** 3) if nbytes >= 1024 ** 3 else '%.1fMB' % (nbytes / 1024 ** 2)


# ---- 연구 후보 ----------------------------------------------------------------
def _reasons_text(raw):
    if not raw:
        return ''
    try:
        import json
        items = json.loads(raw) if isinstance(raw, str) and raw.lstrip().startswith('[') else [raw]
    except ValueError:
        items = [raw]
    return clip(' · '.join(str(i) for i in items[:2]), 80)


def group_by_scanner(cands):
    groups = {}
    for c in cands:
        groups.setdefault(c['scanner'], []).append(c)
    ordered = [(k, groups[k]) for k in SCANNER_ORDER if k in groups] + [(k, v) for k, v in groups.items() if k not in SCANNER_ORDER]
    return ordered


def fmt_scan_selected(scan_date, cands, scanned, now, per_scanner=5):
    """장 마감 스캔이 정상 완료됐을 때의 종목 선정 알림(후보 0건도 정상 완료로 알린다)."""
    lines = [head('🔎', '연구 후보 선정', '%s 장 마감 스캔 정상 완료' % day_label(scan_date))]
    if scanned and scanned.get('scanned'):
        lines.append('처리 %s종목 · 저장 %s' % (num(scanned['scanned']), ts(scanned.get('scannedAt'))))
    if not cands:
        lines += ['', '후보 <b>0종목</b> — 조건에 맞는 종목이 없었습니다. 스캔 자체는 정상입니다(오류 아님).']
    else:
        counts = ' · '.join('%s %d' % (SCANNER_LABELS.get(k, k), len(v)) for k, v in group_by_scanner(cands))
        lines += ['', '총 <b>%d종목</b> — %s' % (len(cands), counts), '<i>연구용 후보입니다. 자동 매수와 연결되어 있지 않습니다.</i>']
        for key, rows in group_by_scanner(cands):
            lines += ['', '▪ <b>%s</b> (%d)' % (SCANNER_LABELS.get(key, key), len(rows))]
            for i, c in enumerate(rows[:per_scanner], 1):
                lines.append('%d. %s · 점수 %s · 기준가 %s' % (i, stock(c.get('name'), c['code']), num(c.get('score'), 0), num(c.get('base_price'))))
                why = _reasons_text(c.get('reasons'))
                if why:
                    lines.append('   └ %s' % esc(why))
            if len(rows) > per_scanner:
                lines.append('   … 외 %d종목 (/candidates)' % (len(rows) - per_scanner))
        lines += ['', '진입은 다음 거래일 시가 기준 모의로만 기록됩니다.']
    lines += ['', foot(now)]
    return '\n'.join(lines)


# ---- 모의매매 -----------------------------------------------------------------
def variant_line(name, v, with_label=False):
    """한 전략의 독립 모의 계좌 요약 한 줄(공식 기록 = 보수적 가정)."""
    label = VARIANT_LABELS.get(name) if with_label else VARIANT_SHORT.get(name, name)
    if not v or not v.get('closed') and v.get('cumRet') is None:
        unsettled = (v or {}).get('unsettled') or 0
        return '%s: 청산 완료 거래 없음%s' % (esc(label), (' · 진행/대기 %d건' % unsettled) if unsettled else '')
    mdd = v.get('mdd')
    mdd_txt = pct(mdd) if mdd is not None else ('%s (종가 누락·근사)' % pct(v.get('mddApprox')) if v.get('mddApprox') is not None else '-')
    win = '%d%%' % round(v['win'] * 100) if v.get('win') is not None else '-'
    return '%s: 누적 %s %s · MDD %s · 청산 %d건 · 승률 %s' % (esc(label), tone(v.get('cumRet')), pct(v.get('cumRet')), mdd_txt, v.get('closed') or 0, win)


def fmt_paper_update(events, variants, now):
    entries = [e for e in events if e['kind'] == 'entry']
    signals = [e for e in events if e['kind'] == 'signal']
    closes = [e for e in events if e['kind'] == 'close']
    lines = [head('🧪', '모의매매 갱신', '가상 기록 · 실계좌 주문 아님')]
    if entries:
        lines += ['', '▪ <b>신규 진입 %d건</b>' % len(entries)]
        for e in entries[:8]:
            lines.append('· %s %s' % (stock(e.get('name'), e['code']), esc(SCANNER_LABELS.get(e['scanner'], e['scanner']))))
            lines.append('  진입 %s 시가 기준 %s (슬리피지 포함)' % (esc(str(e.get('entry_date'))[5:]), num(e.get('entry_price'))))
            for v in VARIANT_ORDER:
                vd = (e.get('variants') or {}).get(v)
                if vd is None:
                    continue
                if vd.get('stop_price'):
                    lines.append('  %s: 손절선 %s' % (VARIANT_SHORT[v], num(vd['stop_price'])))
                else:
                    lines.append('  %s: 가격 손절선 없음(신호 청산)' % VARIANT_SHORT[v])
        if len(entries) > 8:
            lines.append('… 외 %d건' % (len(entries) - 8))
    if signals:
        lines += ['', '▪ <b>청산 신호 · 다음 시가 체결 대기 %d건</b>' % len(signals)]
        for e in signals[:8]:
            extra = ' · 현재 추적선 %s' % num(e['trail_price']) if e.get('trail_price') else ''
            lines.append('· %s %s · 신호 %s%s' % (stock(e.get('name'), e['code']), esc(VARIANT_SHORT.get(e['variant'], e['variant'])), esc(str(e.get('signal_date'))[5:]), extra))
        lines.append('  체결가·수익률은 다음 거래일 시가 봉이 확인된 뒤 확정됩니다.')
    if closes:
        lines += ['', '▪ <b>청산 확정 %d건</b> (순수익률, 비용·슬리피지 반영)' % len(closes)]
        for e in closes[:8]:
            why = EXIT_REASONS.get(e.get('exit_reason'), e.get('exit_reason') or '-')
            lines.append('· %s %s %s' % (tone(e.get('ret')), pct(e.get('ret')), stock(e.get('name'), e['code'])))
            lines.append('  %s · %s 청산 · %s일 보유 · %s' % (esc(VARIANT_SHORT.get(e['variant'], e['variant'])), esc(str(e.get('exit_date'))[5:]), e.get('hold_days') or '-', esc(why)))
        if len(closes) > 8:
            lines.append('… 외 %d건' % (len(closes) - 8))
    if variants:
        lines += ['', '▪ <b>전략별 누적 (모의 · 독립 계좌)</b>']
        lines += [variant_line(k, variants.get(k)) for k in VARIANT_ORDER if k in variants]
    lines += ['', foot(now)]
    return '\n'.join(lines)


# ---- 실계좌 감시·주문 ------------------------------------------------------------
def _pos_line(d):
    parts = []
    if d.get('gain') is not None:
        parts.append('%s %s' % (tone(d['gain']), pct_points(d['gain'])))
    if d.get('avg') and d.get('price'):
        parts.append('매입 %s → 현재 %s' % (num(d['avg']), num(d['price'])))
    if d.get('qty'):
        parts.append('%s주' % num(d['qty']))
    return ' · '.join(parts)


def fmt_order_event(kind, d, now):
    """실계좌 감시·주문 알림. kind: DRY | SENT | REJECTED | FAILED | CLOSED | PARTIAL.
    접수(SENT)와 체결(CLOSED/PARTIAL)을 구분한다: 접수는 주문 API 응답, 체결은 잔고에서 확인된 변화만 쓴다."""
    who = stock(d.get('name'), d['code'])
    reason = ORDER_REASONS.get(d.get('reason'), d.get('reason') or '-')
    if kind == 'DRY':
        lines = [head('🏦', '감시 종목 매도 조건 발생', '%s · 기록 전용' % TAG_REAL), '', '%s — <b>%s</b> 조건' % (who, esc(reason)), _pos_line(d),
                 '⚠️ <b>주문은 전송되지 않았습니다</b> (LIVE_SELL 꺼짐). DRY_SELL 기록만 남겼습니다.']
    elif kind == 'SENT':
        no = d.get('ord_no')
        lines = [head('📨', '매도 주문 접수', TAG_REAL), '', '%s — <b>%s</b>' % (who, esc(reason)), _pos_line(d),
                 '시장가 매도 주문이 증권사에 <b>접수</b>됐습니다%s.' % (' (주문번호 …%s)' % esc(str(no)[-4:]) if no else ''),
                 '<i>접수일 뿐 체결 확인이 아닙니다. 잔고에서 줄어든 것이 확인되면 별도로 알립니다.</i>']
    elif kind == 'REJECTED':
        lines = [head('⛔', '매도 주문 거부', TAG_REAL), '', '%s — %s' % (who, esc(reason)), _pos_line(d), '증권사가 주문을 <b>거부</b>했습니다: %s' % esc(clip(d.get('message'), 120)),
                 '주문은 들어가지 않았습니다. 같은 조건이 계속되면 봇이 한도 내에서 다시 시도하고, 한도에 닿으면 알립니다.']
    elif kind == 'FAILED':
        lines = [head('⛔', '매도 주문 전송 실패', TAG_REAL), '', '%s — %s' % (who, esc(reason)), _pos_line(d), '전송 중 오류: %s' % esc(clip(d.get('message'), 120)),
                 '⚠️ 주문이 접수됐는지 <b>불명확</b>합니다. 증권사 앱에서 직접 확인하세요.']
    elif kind == 'CLOSED':
        if d.get('had_order'):
            what = '봇의 매도 주문 접수 뒤 잔고에서 사라졌습니다 → <b>체결로 판단</b>(잔고 기준)'
        else:
            what = '봇 주문 없이 잔고에서 사라졌습니다 → 직접 매도 등 <b>외부 변동</b>으로 보입니다'
        last = ('마지막 조회 %s %s (체결가 아님)' % (tone(d.get('gain')), pct_points(d['gain']))) if d.get('gain') is not None else ''
        lines = [head('✅', '감시 종목 보유 종료', TAG_REAL), '', who, what]
        if last:
            lines.append(last)
        lines.append('<i>실제 체결가·손익은 증권사 앱에서 확인하세요.</i>')
    else:  # PARTIAL
        lines = [head('◐', '감시 종목 수량 감소', TAG_REAL), '', who, '보유 수량 %s주 → %s주 (잔고 기준)' % (num(d.get('before')), num(d.get('after'))),
                 '일부 체결 또는 직접 매도로 보입니다. 증권사 앱에서 확인하세요.']
    lines += ['', foot(now)]
    return '\n'.join(l for l in lines if l is not None)


def fmt_alert(title, body, level='warn', action=None, now=None):
    icon = '🚨' if level == 'critical' else '⚠️'
    lines = [head(icon, '시스템 경고 — %s' % title), '']
    lines += body if isinstance(body, (list, tuple)) else [body]
    if action:
        lines += ['', '▶ %s' % action]
    if now is not None:
        lines += ['', foot(now)]
    return '\n'.join(lines)


def fmt_startup(info, now):
    """봇(텔레그램 관제) 시작·복구 알림."""
    kind = info.get('kind')
    title = {'boot': 'PC 부팅 후 자동 시작', 'planned': '재시작 완료', 'unclean': '비정상 종료 후 복구', 'first': '시작'}.get(kind, '시작')
    icon = '⚠️' if kind == 'unclean' else '✅'
    lines = [head(icon, '기존 수동 감시 봇 %s' % title), '']
    if kind == 'unclean':
        lines.append('이전 실행이 정상 종료되지 않았습니다. 마지막 생존 신호 %s' % ts(info.get('last_heartbeat')))
        lines.append('원인: 전원 차단·강제 종료·프로세스 오류 등. 그동안(%s) 손절·익절 판단이 없었습니다.' % info.get('gap_text', '-'))
    elif kind == 'boot':
        lines.append('PC가 켜진 뒤 자동으로 시작했습니다. 마지막 생존 신호 %s' % ts(info.get('last_heartbeat')))
    lines.append('기존 감시 기능: %s' % ('🚨 <b>실주문 ON (매도 전용)</b>' if info.get('live_sell') else '기록 전용 (이 봇은 매도 주문 미전송)'))
    if info.get('mode_changed'):
        lines.append('⚠️ 지난 실행과 모드(LIVE_SELL)가 달라졌습니다. 의도한 변경인지 확인하세요.')
    lines.append('기존 수동 감시 종목 %d · 텔레그램 관제 연결됨' % info.get('watch_count', 0))
    lines.append('별도 실계좌 자동매매 엔진의 주문·보유 상태를 뜻하지 않습니다.')
    lines += ['', '메뉴는 /help', foot(now)]
    return '\n'.join(lines)


# ---- 일일 보고서 ----------------------------------------------------------------
def fmt_daily(d):
    """d: scan_date, now, scan_ok, scanned, cands, paper_events, variants, bot, health, errors, report_note"""
    now = d['now']
    lines = [head('📊', '일일 보고서', '%s 데이터 기준 · 작성 %s' % (day_label(d['scan_date']), stamp(now)))]
    # ① 시스템
    lines += ['', '<b>① 시스템</b>']
    if d.get('scan_ok'):
        scanned = d.get('scanned') or {}
        lines.append('🟢 장 마감 스캔 정상 완료%s' % (' · 처리 %s종목 · 저장 %s' % (num(scanned.get('scanned')), ts(scanned.get('scannedAt'))) if scanned.get('scanned') else ''))
    else:
        lines.append('⚪ 이 날짜의 스캔 완료 기록 없음 — 후보·모의 정보는 마지막 기록 기준입니다')
    errs = d.get('errors') or []
    lines.append('🟢 최근 오류 없음' if not errs else '🟡 최근 오류 %d건: %s' % (len(errs), esc(clip(errs[-1], 80))))
    health = d.get('health') or {}
    if health.get('active_alerts'):
        lines.append('🟡 진행 중 경고: %s' % esc(', '.join(health['active_alerts'][:3])))
    # ② 연구 후보
    cands = d.get('cands') or []
    lines += ['', '<b>② 연구 후보</b> %s' % TAG_RESEARCH]
    if not cands:
        lines.append('후보 0종목 (스캔 정상 시 오류 아님)')
    else:
        lines.append('총 %d종목 · 자동 매수 연결 없음' % len(cands))
        for key, rows in group_by_scanner(cands):
            names = ', '.join('%s %s' % (esc(c.get('name') or c['code']), num(c.get('score'), 0)) for c in rows[:4])
            more = ' 외 %d' % (len(rows) - 4) if len(rows) > 4 else ''
            lines.append('· <b>%s</b> %d: %s%s' % (SCANNER_LABELS.get(key, key), len(rows), names, more))
    # ③ 모의매매 사건
    events = d.get('paper_events') or []
    entries = [e for e in events if e['kind'] == 'entry']
    signals = [e for e in events if e['kind'] == 'signal']
    closes = [e for e in events if e['kind'] == 'close']
    lines += ['', '<b>③ 모의매매</b> %s' % TAG_PAPER]
    if not events:
        lines.append('오늘 신규 진입·청산 변화 없음')
    else:
        lines.append('신규 진입 %d · 청산 신호(체결 대기) %d · 청산 확정 %d' % (len(entries), len(signals), len(closes)))
        for e in entries[:4]:
            lines.append('· 진입 %s (%s) %s' % (esc(e.get('name') or e['code']), esc(SCANNER_LABELS.get(e['scanner'], e['scanner'])), num(e.get('entry_price'))))
        for e in closes[:4]:
            lines.append('· 청산 %s %s %s %s' % (tone(e.get('ret')), pct(e.get('ret')), esc(e.get('name') or e['code']), esc(VARIANT_SHORT.get(e['variant'], e['variant']))))
        extra = len(entries) + len(closes) - 8
        if extra > 0:
            lines.append('… 상세는 /paper')
    # ④ 전략별 누적
    variants = d.get('variants') or {}
    lines += ['', '<b>④ 전략별 누적</b> %s <i>독립 계좌·합산 아님</i>' % TAG_PAPER]
    if variants:
        lines += [variant_line(k, variants.get(k)) for k in VARIANT_ORDER if k in variants]
    else:
        lines.append('집계 없음(모의 거래 기록 전)')
    # ⑤ 실계좌
    bot = d.get('bot') or {}
    lines += ['', '<b>⑤ 실계좌 감시</b> %s <i>매도 전용·백테스트/모의와 별개</i>' % TAG_REAL]
    lines.append('모드: %s' % ('🚨 실주문 ON' if bot.get('live_sell') else '기록 전용'))
    lines.append('보유 %s종목 중 감시 %s종목 (마지막 조회 %s)' % (bot.get('holdings_n', '-'), bot.get('watch_count', '-'), ts(bot.get('last_poll'))))
    lines.append('당일 감시 조건 발생 %d건 · 주문 접수 %d건 · 오류 %d건' % (bot.get('dry_today', 0), bot.get('sent_today', 0), bot.get('error_today', 0)))
    lines += ['', '상세: /candidates · /paper · /holdings · /status']
    return '\n'.join(lines)


# ---- 명령 응답 ---------------------------------------------------------------
HELP_ITEMS = (('status', '시스템 현재 상태'), ('candidates', '최신 연구 후보'), ('paper', '모의매매 전략별 성과'), ('sim', '장중 가상매매(실시간 모의) 현황'), ('holdings', '실제 계좌 보유 종목'),
              ('orders', '최근 주문·처리 상태'), ('risk', '자금 한도·위험관리 규칙'), ('daily', '최신 일일 보고서'),
              ('mute', '일반 알림 일시 중지 (/mute 2h)'), ('unmute', '일반 알림 재개'), ('test', '텔레그램 연결 확인'), ('help', '명령어 안내'))


def fmt_help():
    lines = [head('📖', '명령어 안내'), '', '모두 <b>읽기 전용</b>입니다. 매수·매도 지시나 규칙 변경은 텔레그램으로 할 수 없습니다.', '']
    lines += ['/%s — %s' % (c, d) for c, d in HELP_ITEMS]
    lines += ['', '<i>/mute 는 종목선정·모의매매·일일보고서만 멈춥니다. 시스템 경고와 실계좌 감시·주문 알림은 계속 옵니다.</i>']
    return '\n'.join(lines)


def fmt_status(s):
    now = s['now']
    bot, rs, tg, pc = s.get('bot') or {}, s.get('research') or {}, s.get('telegram') or {}, s.get('pc') or {}
    lines = [head('📊', '시스템 상태'), '%s%s' % (light(s.get('level')), (' · 활성 경고 %d건' % len(s['alerts'])) if s.get('alerts') else ''), '']
    lines.append('<b>로컬 봇</b> %s' % TAG_REAL)
    lines.append('모드: %s' % ('🚨 <b>실주문 ON (매도 전용)</b>' if bot.get('live_sell') else '기록 전용 (매도 주문 미전송)'))
    lines.append('장: %s · 마지막 조회 %s' % ('장중' if bot.get('market_open') else '장외', ts(bot.get('last_poll'))))
    lines.append('정지 상태: %s' % ('🛑 예 (STOP) — 판단 중단' if bot.get('stopped') else '아니오'))
    fails = bot.get('balance_failures') or 0
    lines.append('잔고 조회: %s' % ('정상' if not fails else '⚠️ 연속 %d회 실패' % fails))
    lines.append('감시 %d종목 · 오늘 매도 주문 %d/%d건' % (bot.get('watch_count', 0), bot.get('sells_today', 0), bot.get('max_sells_per_day', 0)))
    lines += ['', '<b>연구 엔진</b> %s' % TAG_RESEARCH]
    if not rs.get('available'):
        lines.append('상태 파일 없음 — 연구 작업이 아직 실행되지 않았습니다')
    else:
        lines.append('상태: %s · 갱신 %s' % (esc(RUNNER_STATES.get(rs.get('runner'), rs.get('runner') or '-')), ts(rs.get('updatedAt'))))
        gen = rs.get('lastGen') or {}
        if gen:
            lines.append('마지막 확인: %s (%s)' % ('후보 생성 성공' if gen.get('ok') else '미확정', esc(clip(gen.get('reason'), 40))))
        lines.append('오늘 후보 %s종목 · 다음 정기 실행 %s' % (rs.get('candidatesToday', 0), ts(rs.get('nextRunAt'))))
        lines.append('저장 용량 %s / %s' % (gb(rs.get('diskUsedBytes')), gb(rs.get('diskLimitBytes'))))
    lines += ['', '<b>텔레그램</b>']
    mute = tg.get('mute_until')
    lines.append('알림: %s · 무음 %s' % ('정상' if tg.get('net_ok') else '⚠️ 전송 지연 중', ('~%s' % ts(mute)) if mute else '해제'))
    lines.append('대기열 %d건 · 마지막 전송 %s' % (tg.get('pending', 0), ts(tg.get('last_ok'))))
    if pc.get('free_bytes') is not None:
        lines.append('')
        lines.append('<b>PC</b> 디스크 여유 %s' % gb(pc['free_bytes']))
    if s.get('alerts'):
        lines += ['', '<b>활성 경고</b>'] + ['· %s (%s 경과)' % (esc(a['label']), esc(a['age'])) for a in s['alerts'][:6]]
    lines += ['', foot(now)]
    return '\n'.join(lines)


def fmt_candidates(d, scanner=None):
    """요약(검색기별 건수·상위) 또는 검색기 상세. d: scan_date, cands, now"""
    now = d['now']
    cands = d.get('cands') or []
    if not d.get('scan_date'):
        return '\n'.join([head('🔎', '연구 후보'), '', '아직 생성된 연구 후보가 없습니다. 평일 20:15 이후 스캔이 확정되면 만들어집니다.', '', foot(now)])
    lines = [head('🔎', '연구 후보', '%s 스캔 기준 · 자동 매수 연결 없음' % day_label(d['scan_date']))]
    if scanner:
        rows = [c for c in cands if c['scanner'] == scanner]
        lines += ['', '▪ <b>%s</b> %d종목' % (SCANNER_LABELS.get(scanner, scanner), len(rows))]
        for i, c in enumerate(rows[:15], 1):
            lines.append('%d. %s · 점수 %s · 기준가 %s%s' % (i, stock(c.get('name'), c['code']), num(c.get('score'), 0), num(c.get('base_price')),
                                                         ' · %s' % esc(c['status']) if c.get('status') not in (None, 'NEW') else ''))
            why = _reasons_text(c.get('reasons'))
            if why:
                lines.append('   └ %s' % esc(why))
    elif not cands:
        lines += ['', '후보 0종목 (스캔은 정상 완료)']
    else:
        lines.append('총 %d종목' % len(cands))
        for key, rows in group_by_scanner(cands):
            lines += ['', '▪ <b>%s</b> %d' % (SCANNER_LABELS.get(key, key), len(rows))]
            for c in rows[:3]:
                lines.append('  %s · 점수 %s' % (stock(c.get('name'), c['code']), num(c.get('score'), 0)))
            if len(rows) > 3:
                lines.append('  … 외 %d (아래 버튼으로 전체 보기)' % (len(rows) - 3))
    lines += ['', foot(now)]
    return '\n'.join(lines)


def fmt_paper(d, variant=None):
    """모의매매 전략별 성과 요약 또는 전략 상세. d: variants, open_counts, recent_closed, now"""
    now = d['now']
    variants = d.get('variants') or {}
    lines = [head('🧪', '모의매매 성과', '가상 기록 · 실계좌/백테스트와 합산 안 함')]
    if not variants:
        lines += ['', '집계 없음 — 모의 진입이 시작되면 표시됩니다.']
    elif variant:
        v = variants.get(variant) or {}
        lines += ['', '<b>%s</b>' % esc(VARIANT_LABELS.get(variant, variant)), variant_line(variant, v)]
        lines.append('진행 %d · 청산 대기 %d · 후보 거래 %d건' % (v.get('openPositions') or 0, v.get('pendingExit') or 0, v.get('candidateTrades') or 0))
        if v.get('execution'):
            lines.append('청산 규칙: %s' % esc(clip(v['execution'], 100)))
        sd = v.get('sameDay') or {}
        if sd.get('cumRet') is not None:
            lines.append('<i>참고 시나리오(당일 재투입 가정): 누적 %s · 공식 기록 아님</i>' % pct(sd['cumRet']))
        closed = [r for r in d.get('recent_closed') or [] if r['variant'] == variant]
        if closed:
            lines += ['', '최근 청산']
            for r in closed[:8]:
                lines.append('%s %s %s · %s · %s일' % (tone(r.get('ret')), pct(r.get('ret')), stock(r.get('name'), r['code']), esc(str(r.get('exit_date'))[5:]), r.get('hold_days') or '-'))
    else:
        lines += ['', '<b>전략별 누적 (독립 계좌, 공식 기록=보수적 가정)</b>']
        lines += [variant_line(k, variants.get(k)) for k in VARIANT_ORDER if k in variants]
        oc = d.get('open_counts') or {}
        if oc:
            lines += ['', '진행 중 (진행/청산 대기)']
            lines += ['· %s: %s / %s' % (VARIANT_SHORT[k], oc.get(k, {}).get('open', 0), oc.get(k, {}).get('pending', 0)) for k in VARIANT_ORDER if k in oc]
    lines += ['', '<i>규칙: 동시 최대 %d종목 · 종목당 %d%% · 전체 %d%% · 갭 +%.0f%% 이상 진입 제외 · 비용·슬리피지 반영</i>'
              % (PAPER_RULES['max_pos'], PAPER_RULES['per_pos_pct'], PAPER_RULES['total_cap_pct'], PAPER_RULES['gap_skip_pct']), foot(now)]
    return '\n'.join(lines)


def fmt_holdings(d):
    now = d['now']
    holdings = d.get('holdings') or []
    src = '실시간 조회' if d.get('fresh') else '마지막 조회(%s) 기준' % ts(d.get('updated'))
    lines = [head('💼', '보유 종목', '%s · %s' % (TAG_REAL, src))]
    if d.get('note'):
        lines.append('⚠️ %s' % esc(d['note']))
    if not holdings:
        lines += ['', '보유 종목이 없습니다.']
    else:
        total = sum((h.get('price') or 0) * (h.get('qty') or 0) for h in holdings)
        cost = sum((h.get('avg') or 0) * (h.get('qty') or 0) for h in holdings)
        for h in holdings:
            gain = (h['price'] / h['avg'] - 1) * 100 if h.get('avg') and h.get('price') else None
            lines += ['', '%s%s' % (stock(h.get('name'), h['code']), ' 👁 감시' if h.get('watched') else '')]
            lines.append('%s %s · 매입 %s → 현재 %s · %s주' % (tone(gain), pct_points(gain), num(h.get('avg')), num(h.get('price')), num(h.get('qty'))))
        if cost:
            lines += ['', '합계(매입가·현재가×수량 합산) 평가 %s원 · 수익률 %s %s' % (num(total), tone(total - cost), pct_points((total / cost - 1) * 100))]
        lines.append('<i>👁 감시 = 손절·익절 규칙 적용 대상. 감시하지 않는 종목은 봇이 건드리지 않습니다.</i>')
    lines += ['', foot(now)]
    return '\n'.join(lines)


def fmt_orders(d):
    now = d['now']
    orders = d.get('orders') or []
    lines = [head('📜', '최근 주문·처리 상태', TAG_REAL), '오늘 접수 %d건 · 모드 %s' % (d.get('sent_today', 0), '실주문 ON' if d.get('live_sell') else '기록 전용')]
    if not orders:
        lines += ['', '주문·기록이 없습니다.']
    status_text = {'DRY': '📝 기록만(주문 미전송)', 'SENT': '📨 접수(체결 확인 전)', 'REJECTED': '⛔ 증권사 거부', 'FAILED': '⛔ 전송 실패(접수 여부 불명)', 'ERROR': '⛔ 오류'}
    for o in orders[:8]:
        lines += ['', '%s %s %s %s주 — %s' % (ts(o['ts']), esc(o.get('name') or ''), '<code>%s</code>' % esc(o['code']), num(o['qty']), esc(ORDER_REASONS.get(o['reason'], o['reason'])))]
        extra = ''
        if o.get('ord_no'):
            extra = ' · 주문번호 …%s' % esc(str(o['ord_no'])[-4:])
        lines.append('   %s%s' % (status_text.get(o.get('kind') or o['status'], esc(o['status'])), extra))
    lines += ['', '<i>체결 확인은 잔고 반영 시 별도 알림 · 증권사 체결 내역과 다를 수 있습니다.</i>', foot(now)]
    return '\n'.join(lines)


def fmt_risk(d):
    now = d['now']
    cfg = d.get('config') or {}
    lines = [head('🛡', '자금·위험관리 규칙'), '', '<b>실계좌 감시 봇</b> %s' % TAG_REAL,
             '손절 −%s%% · 익절 상한 +%s%% · 수익 보호 +%s%% 도달 후 이탈 시 매도' % (cfg.get('stop_loss_pct'), cfg.get('take_profit_cap_pct'), cfg.get('take_profit_floor_pct')),
             '하루 매도 주문 최대 %s건 · 종목당 하루 %s회 · 재주문 대기 %s초' % (cfg.get('max_sells_per_day'), cfg.get('max_attempts_per_code_per_day'), cfg.get('sell_cooldown_sec')),
             '모드: %s' % ('🚨 실주문 ON (매도 전용)' if d.get('live_sell') else '기록 전용 (LIVE_SELL 꺼짐)'),
             '오늘 매도 주문 %d/%d건' % (d.get('sells_today', 0), cfg.get('max_sells_per_day', 0)),
             '자동 매수 기능 없음 · 감시 종목만 대상 · 정지(STOP) 시 모든 판단 중단', '',
             '<b>모의 계좌 규칙</b> %s' % TAG_PAPER,
             '동시 최대 %d종목 · 종목당 %d%% · 전체 투자 %d%% 한도' % (PAPER_RULES['max_pos'], PAPER_RULES['per_pos_pct'], PAPER_RULES['total_cap_pct']),
             '다음 거래일 시가 진입(+%.1f%% 슬리피지) · 갭 +%.0f%% 이상 제외 · 비용 반영' % (PAPER_RULES['entry_slip_pct'], PAPER_RULES['gap_skip_pct']),
             '', '<b>연구 데이터</b> %s' % TAG_RESEARCH, '저장 용량 상한 %s · 후보는 실계좌 매수와 연결되지 않음' % gb(d.get('disk_limit')),
             '', '<i>텔레그램은 읽기 전용입니다. 규칙·LIVE_SELL 은 PC의 .env·config.json 에서만 바꿉니다.</i>', foot(now)]
    return '\n'.join(lines)


def fmt_test(d):
    return '\n'.join([head('✅', '연결 확인'), '', '텔레그램 연결이 정상입니다.', '명령 수신 지연 %s초 · 허용 사용자 ***%s' % (d.get('latency'), d.get('uid_tail')),
                      '알림: %s · 무음 %s' % ('정상' if d.get('net_ok') else '⚠️ 지연', ('~%s' % ts(d['mute_until'])) if d.get('mute_until') else '해제'), '', foot(d['now'])])


def fmt_mute(until, now):
    return '\n'.join([head('🔕', '일반 알림 중지'), '', '%s 까지 종목선정·모의매매·일일보고서 알림을 보내지 않습니다.' % ts(until),
                      '시스템 경고와 실계좌 감시·주문 알림은 <b>계속</b> 옵니다. 재개: /unmute', foot(now)])


def fmt_unmute(suppressed, now):
    tail = '중지 중 생략된 알림 %d건은 /daily · /candidates · /paper 로 확인하세요.' % suppressed if suppressed else '중지 중 생략된 알림은 없습니다.'
    return '\n'.join([head('🔔', '일반 알림 재개'), '', tail, foot(now)])

# ---- 장중 가상매매(C: 실시간 페이퍼 트레이딩) -------------------------------------------------
TAG_LIVE = '[모의매매]'
LIVE_EXIT_REASONS = {'STOP_INTRADAY': '추적선 장중 이탈(가상 손절)', 'SIGNAL_EXIT': '청산 신호 → 다음 거래일 관측가 매도', 'FIX_STOP': '−3% 손절(대조군)',
                     'FIX_TARGET': '+5% 익절(대조군)', 'MAX_HOLD_30': '최대 30일 보유 종가 청산', 'MAX_HOLD_150': '최대 150일 보유 종가 청산'}
LIVE_SIGNAL_REASONS = {'SIGNAL_ATR_CLOSE': '종가가 추적선 아래', 'SIGNAL_DEAD35': '3·5일선 데드크로스', 'STOP_BREACH_UNOBSERVED': '장중 추적선 이탈(시세 단절로 실시간 미관측)'}
LIVE_ALERT_KINDS = {'FEED_DOWN', 'LIVE_SELL_ACTIVE', 'CALENDAR_ERROR', 'NO_CANDIDATES'}


def _vshort(sid):
    return VARIANT_SHORT.get(sid, sid or '-')


def fmt_live_events(events, now):
    """lp_events 묶음 한 번에 한 메시지. 맨 앞에 [모의매매]를 달아 실주문 알림과 구별한다. 가상 체결이며 실제 체결이 아니다."""
    lines = [head('🧪', '%s 장중 가상매매' % TAG_LIVE, '가상 체결 · 실계좌 주문 아님 · 관측 시세 기준')]
    groups = {}
    for e in events:
        groups.setdefault(e['kind'], []).append(e)
    sel = groups.get('CANDIDATES_SELECTED')
    if sel:
        p = sel[-1]['payload']
        by = ' · '.join('%s %d' % (SCANNER_LABELS.get(k, k), v) for k, v in (p.get('byScanner') or {}).items())
        lines += ['', '▪ <b>연구 후보 자동 선정</b> (스캔 %s)' % esc(p.get('scan_date')), '  선정 %s건 · 제외 %s건%s' % (p.get('selected'), p.get('excluded'), (' · ' + by) if by else '')]
    buys = groups.get('BUY') or []
    if buys:
        per = {}
        for e in buys:
            per.setdefault(e['code'], []).append(e)
        lines += ['', '▪ <b>가상 매수 %d종목</b>' % len(per)]
        for code, es in list(per.items())[:8]:
            p = es[0]['payload']
            lines.append('· %s %s' % (stock(p.get('name'), code), esc(SCANNER_LABELS.get(p.get('scanner'), p.get('scanner')))))
            lines.append('  가상 체결가 %s (관측 %s %s, 슬리피지 가정 포함) · %s주' % (num(p.get('price')), num(p.get('quote')), esc(str(p.get('quoteTs'))[11:16]), num(p.get('qty'))))
            lines.append('  계좌: ' + ', '.join('%s %s원' % (_vshort(x['strategy_id']), num(x['payload'].get('cost'))) for x in es))
        if len(per) > 8:
            lines.append('… 외 %d종목' % (len(per) - 8))
    sells = (groups.get('SELL') or []) + (groups.get('SELL_STOP') or [])
    if sells:
        lines += ['', '▪ <b>가상 매도 %d건</b> (순수익률, 비용·슬리피지 반영)' % len(sells)]
        for e in sells[:10]:
            p = e['payload']
            lines.append('· %s %s %s %s' % (tone(p.get('netRet')), pct(p.get('netRet')), stock(p.get('name'), e['code']), esc(_vshort(e['strategy_id']))))
            lines.append('  %s · 가상 체결가 %s · 손익 %s원' % (esc(LIVE_EXIT_REASONS.get(p.get('reason'), p.get('reason'))), num(p.get('price')), num(p.get('pnl'))))
    sig = groups.get('EXIT_SIGNAL') or []
    if sig:
        lines += ['', '▪ <b>청산 신호 %d건</b> · 다음 거래일 처음 관측한 시세에 가상 매도' % len(sig)]
        for e in sig[:8]:
            lines.append('· %s %s — %s' % (stock(e['payload'].get('name'), e['code']), esc(_vshort(e['strategy_id'])), esc(LIVE_SIGNAL_REASONS.get(e['payload'].get('reason'), e['payload'].get('reason')))))
    eod = groups.get('EOD_REPORT')
    if eod:
        accts = eod[-1]['payload'].get('accounts') or {}
        lines += ['', '▪ <b>장 마감 가상 계좌</b>']
        for sid, a in accts.items():
            lines.append('· %s 평가자산 %s원 · 보유 %s종목' % (esc(_vshort(sid)), num(a.get('equity')), a.get('positions')))
    for kind, label in (('FEED_DOWN', '🚨 시세 수신 중단'), ('FEED_RECOVERED', '✅ 시세 수신 복구'), ('ENGINE_START', 'ℹ️ 장중 모의매매 엔진 시작'),
                        ('ENGINE_RESTART', 'ℹ️ 엔진 재시작·복구(단절 구간은 채우지 않음)'),
                        ('LIVE_SELL_ACTIVE', '🚨 실주문 스위치(LIVE_SELL) 감지 — 모의매매 엔진 중지'), ('CALENDAR_ERROR', '⚠️ 거래일 달력 확인 불가 — 진입 보류'),
                        ('NO_CANDIDATES', '⚠️ 직전 거래일 후보 없음 — 오늘 진입 없음')):
        for e in groups.get(kind, [])[:2]:
            msg = e['payload'].get('msg') or ''
            lines += ['', '%s%s' % (label, (' — ' + esc(msg)) if msg else '')]
    lines += ['', foot(now)]
    return '\n'.join(lines)


def fmt_live(st, now):
    lines = [head('🧪', '%s 장중 가상매매 현황' % TAG_LIVE, '실시간 페이퍼 트레이딩 · 가상 체결')]
    if not st:
        lines += ['', '상태 파일 없음 — 장중 모의매매 엔진(live_paper_job)이 아직 실행되지 않았습니다.', '', foot(now)]
        return '\n'.join(lines)
    lines.append('엔진: %s%s · 시세 %s · 마지막 수신 %s' % (esc(st.get('engine')), (' (' + esc(st['halted']) + ')') if st.get('halted') else '',
                                                        '정상' if st.get('feedOk') else '⚠️ 단절', ts(st.get('lastQuoteAt'))))
    lines.append('실주문: %s' % ('🚨 LIVE_SELL 켜짐(엔진 중지)' if st.get('liveSellActive') else '차단됨(주문 API 호출 없음)'))
    for sid, a in (st.get('accounts') or {}).items():
        lines += ['', '<b>%s</b>' % esc(_vshort(sid)),
                  '평가자산 %s원 (%s) · 예수금 %s원 · 보유 %s종목' % (num(a.get('equity')), pct(a.get('cumRet')), num(a.get('cash')), a.get('positions')),
                  '실현 %s원 · MDD %s · 청산 %s건%s' % (num(a.get('realizedPnl')), pct(a.get('mdd')), a.get('closed'), (' · 승률 %s' % pct(a['win'], 0)) if a.get('win') is not None else '')]
    pos = st.get('positions') or []
    if pos:
        lines += ['', '▪ <b>가상 보유</b>']
        for p in pos[:10]:
            lines.append('· %s %s %s · 매수 %s → 현재 %s' % (tone(p.get('ret')), pct(p.get('ret')), stock(p.get('name'), p['code']), num(p.get('entryPrice')), num(p.get('lastPrice'))))
    lines += ['', foot(now)]
    return '\n'.join(lines)
