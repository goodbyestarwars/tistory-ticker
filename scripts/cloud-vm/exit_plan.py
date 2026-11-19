# -*- coding: utf-8 -*-
"""연구 태그 매도 기준(exit plan)의 공통 계산 - 관찰 전용, 주문·계좌 연결 없음 (2026-11-20).

exit-v1  손절 -10% · +10% 고가 도달 뒤 종가 < 20일선이면 다음 거래일 시가 · 최대 60거래일 (기존)
exit-v2  손절 -10% · +10% 고가 도달 뒤 종가 < 60일선이면 다음 거래일 시가 · 최대 250거래일
         (docs/RALLY_ANATOMY_STUDY_2026-11-19.md 7단계, 학습 기간 선정 규칙이 검증·시험 통과)

신호일 종가까지 본 뒤 다음 거래일 시가에 산다. 손절은 저가가 닿으면 min(그날 시가, 손절가)에 판다(갭 하락 반영).
같은 날 손절 > 보호 순. 비용 0.7%(왕복 1회). 계산식은 scripts/research/exit_rule_study.simulate와 같고,
test/test_exit_plan.py가 두 구현의 결과가 같은지 대조한다(연구 코드는 발표 결과 재현을 위해 그대로 둔다).

track_summary는 기존 pattern_tracks에 이미 쌓인 연구 태그 포착 기록을 읽기만 하고, 두 규칙의 결과를
따로 집계한다. 기존 추적 통계(+5% 돌파 성공·20일 만료)와 섞지 않으며 DB에 쓰지 않는다.
"""

COST = 0.007
ARM_PCT = 0.10
RULES = {
    'exit-v1': dict(version='exit-v1', stopLossPct=-10, protectMa=20, maxHoldDays=60),
    'exit-v2': dict(version='exit-v2', stopLossPct=-10, protectMa=60, maxHoldDays=250),
}
CURRENT = 'exit-v2'


def _ma(closes, k, period):
    if k < period - 1:
        return None
    return sum(closes[k - period + 1:k + 1]) / period


def simulate(bars, i, rule):
    """bars: 날짜 오름차순 일봉 dict(open/high/low/close), i: 신호일 위치. i 이후 봉만 판정에 쓴다.

    반환 dict(status, ret, days, reason, exitDate):
      closed   손절·보호·최대 보유로 끝난 매매(ret은 비용 차감 확정 수익률)
      open     아직 보유 중(ret은 마지막 종가 기준 평가, 비용 차감). 보호 신호 뒤 다음 시가가 아직 없으면 reason=pendingExit
      no_entry 다음 거래일 봉이 아직 없음
    """
    n = len(bars)
    if i + 1 >= n:
        return dict(status='no_entry')
    closes = [float(b['close']) for b in bars]
    entry = float(bars[i + 1]['open'])
    if not entry > 0:
        return dict(status='no_entry')
    stop = entry * (1 + rule['stopLossPct'] / 100.0)
    hold, period = int(rule['maxHoldDays']), int(rule['protectMa'])
    armed = False
    for k in range(i + 1, min(i + 1 + hold, n)):
        b = bars[k]
        days = k - i
        if float(b['low']) <= stop:
            px = min(float(b['open']), stop)
            return dict(status='closed', ret=px / entry - 1 - COST, days=days, reason='stopLoss', exitDate=b['date'])
        if float(b['high']) >= entry * (1 + ARM_PCT):
            armed = True
        if armed:
            ma = _ma(closes, k, period)
            if ma is not None and closes[k] < ma:
                if k + 1 < n:
                    return dict(status='closed', ret=float(bars[k + 1]['open']) / entry - 1 - COST, days=days + 1,
                                reason='protect', exitDate=bars[k + 1]['date'])
                return dict(status='open', ret=closes[k] / entry - 1 - COST, days=days, reason='pendingExit')
    if i + hold <= n - 1:
        return dict(status='closed', ret=closes[i + hold] / entry - 1 - COST, days=hold, reason='maxHold',
                    exitDate=bars[i + hold]['date'])
    return dict(status='open', ret=closes[-1] / entry - 1 - COST, days=n - 1 - i, reason='holding')


def summarize(results):
    """results: [(code, i, simulate결과)] 포착일 순. 같은 종목 보유 중 재포착은 건너뛴다(연구와 같은 규칙)."""
    until, closed, opened = {}, [], []
    for code, i, r in results:
        if r.get('status') == 'no_entry':
            continue
        if code in until and (until[code] is None or i <= until[code]):
            continue
        if r['status'] == 'open':
            until[code] = None
            opened.append(r['ret'])
        else:
            until[code] = i + r['days']
            closed.append(r['ret'])
    out = dict(closed=len(closed), open=len(opened))
    if closed:
        wins = [x for x in closed if x > 0]
        loss = -sum(x for x in closed if x <= 0)
        out.update(winPct=round(100.0 * len(wins) / len(closed), 1), avgPct=round(100.0 * sum(closed) / len(closed), 2),
                   pf=round(sum(wins) / loss, 2) if loss > 0 else None)
    if opened:
        out['openAvgPct'] = round(100.0 * sum(opened) / len(opened), 2)
    return out


def track_summary(conn, scanner, load_bars=None):
    """기존 연구 태그 추적 기록(pattern_tracks)을 읽어 exit-v1/exit-v2 결과를 따로 집계한다(읽기 전용)."""
    if load_bars is None:
        from pattern_tracker import load_bars
    try:
        rows = conn.execute('SELECT code, detected_date FROM pattern_tracks WHERE scanner=? ORDER BY detected_date, code',
                            (scanner,)).fetchall()
    except Exception:
        rows = []
    per_rule = {key: [] for key in RULES}
    cache, missing = {}, 0
    for code, date in rows:
        code, date = str(code), str(date)
        bars = cache.get(code)
        if bars is None:
            bars = cache[code] = load_bars(conn, code)
        i = next((k for k, b in enumerate(bars) if str(b.get('date')) == date), None)
        if i is None:
            missing += 1
            continue
        for key, rule in RULES.items():
            per_rule[key].append((code, i, simulate(bars, i, rule)))
    return dict(version='exit-tracking-v1', scanner=scanner, current=CURRENT, observationOnly=True, orderAuthorized=False,
                signals=len(rows), missingBars=missing, since=(str(rows[0][1]) if rows else None),
                costPct=COST * 100, rules={key: dict(RULES[key], **summarize(per_rule[key])) for key in RULES})
