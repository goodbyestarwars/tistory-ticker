# -*- coding: utf-8 -*-
"""'장중 거래량 급증' 검색기의 두 매집 패턴 판정 - 순수 함수(네트워크·DB·파일 접근 없음). (2026-10-15)

① 실시간 매집 의심(장중): 상대거래량(RVOL)·거래대금·봉의 종가 위치와, 5분봉에서 거래량이 늘어난 뒤 가격을 지키는지(가격 방어)를 본다.
   급등 뒤 긴 윗꼬리·상승분 반납 같은 분배 의심 신호는 감점하고 분배 위험(낮음/보통/높음)으로 따로 표시한다.
   5분봉은 외부 분봉 API가 아니라 장중 감시가 30초마다 쌓는 (시각, 누적거래량, 현재가) 표본으로 만든다 - 표본이 모자라면 해당 판정은 '보류'다.
② 기존 매집봉 재상승(일봉): 최근 15거래일 안의 대량 거래 양봉(매집봉)을 찾고, 이후 거래량 감소와 가격 지지를 확인한 뒤
   매집봉 고점 재돌파 + 거래량 재증가면 우선순위를 올린다.

원칙: 없는 값은 추정하지 않는다(None → 판정 보류). RVOL은 '누적 거래량 ÷ (20일 평균 거래량 × 정규장 경과 비율)'이며 경과 비율은 단순 시간비례(09:00~15:30)다 -
실제 장중 거래량 분포(장 초반·마감 쏠림)를 반영하지 않는 근사이므로 화면에도 그렇게 적는다. 임계값은 검증 전 임시값이며 자동매매에 연결하지 않는다.
"""
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))

TYPE_REALTIME = 'REALTIME_ACCUM'
TYPE_OLD_BAR = 'OLD_BAR_REBREAK'
LABELS = {TYPE_REALTIME: '실시간 매집 의심', TYPE_OLD_BAR: '기존 매집봉 재상승'}

# ---- 실시간(장중) ----
SESSION_MIN = 390                 # 09:00~15:30
MIN_ELAPSED_MIN = 20              # 개장 20분 전에는 RVOL이 불안정해 판정하지 않는다
RVOL_MIN = 2.0
AMOUNT_MIN = 3_000_000_000        # 누적 거래대금 30억
AVG_AMOUNT_MIN = 1_000_000_000    # 20일 평균 거래대금 10억(유동성)
AVG_VOLUME_MIN = 50_000
CHANGE_MIN, CHANGE_MAX = -1.0, 8.0
CLOSE_POS_MIN = 0.5
BAR_SEC = 300
BARS_NEEDED = 3                   # 완성된 5분봉(거래량을 계산할 수 있는) 최소 개수
SPIKE_MULT = 1.5                  # 거래량 급증 봉 = 다른 봉 중앙값의 1.5배 이상
DEFEND_LOW_TOL = 0.003            # 급증 봉 저가를 0.3% 넘게 깨면 방어 실패
DEFEND_CLOSE_TOL = 0.005
WICK_RATIO = 0.6
WICK_MIN_RANGE_PCT = 1.2
GIVEBACK_RATIO = 0.5
GIVEBACK_MIN_RUN_PCT = 3.0
SAMPLES_PER_BAR_MIN = 3

# ---- 일봉 매집봉 ----
ACC_LOOKBACK = 15
ACC_VOL_MULT = 2.5
ACC_MIN_BODY_PCT = 2.0
ACC_CLOSE_POS_MIN = 0.6
ACC_AMOUNT_MIN = 3_000_000_000
DRY_RATIO = 0.6                   # 이후 평균 거래량 <= 매집봉의 60%
SUPPORT_LOW_TOL = 0.02            # 이후 저가가 매집봉 저가를 2% 넘게 깨면 지지 실패
SUPPORT_CLOSE_TOL = 0.04          # 이후 종가가 매집봉 종가를 4% 넘게 밑돌면 지지 실패
REBREAK_VOL_MULT = 1.5
NEAR_BREAK_PCT = 3.0
EXTENDED_PCT = 15.0


def _f(value):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v


def elapsed_minutes(now_kst):
    """정규장 경과 분(09:00 기준). 장 밖이면 None."""
    minutes = now_kst.hour * 60 + now_kst.minute + now_kst.second / 60.0 - 9 * 60
    return minutes if 0 <= minutes <= SESSION_MIN else None


def rvol_time_proportional(cum_volume, avg20_volume, elapsed_min):
    """누적 거래량 ÷ (20일 평균 거래량 × 경과 비율). 입력이 모자라면 None."""
    cum, avg = _f(cum_volume), _f(avg20_volume)
    if not cum or not avg or avg <= 0 or elapsed_min is None or elapsed_min < MIN_ELAPSED_MIN:
        return None
    return cum / (avg * (elapsed_min / SESSION_MIN))


# ---------------------------------------------------------------- 5분봉(표본 기반) ----------
def build_bars(samples, now_t):
    """samples: [(t, 누적거래량, 현재가)] 오름차순 → 완성된 5분봉 [{start, open, high, low, close, volume, n}].

    봉 거래량 = 그 봉의 마지막 표본 누적 - 직전 봉의 마지막 표본 누적이다. 직전 봉 표본이 없는 첫 봉의 거래량은 알 수 없어 None이다.
    표본이 SAMPLES_PER_BAR_MIN개 미만인 봉은 버린다(30초 표본이 빠진 구간을 메워 쓰지 않는다)."""
    buckets = {}
    for t, cum, price in samples:
        if price is None or cum is None:
            continue
        buckets.setdefault(int(t // BAR_SEC), []).append((t, cum, price))
    bars, prev_close_cum = [], None
    for key in sorted(buckets):
        pts = buckets[key]
        end = (key + 1) * BAR_SEC
        if end > now_t or len(pts) < SAMPLES_PER_BAR_MIN:
            prev_close_cum = None if end <= now_t else prev_close_cum
            continue
        prices = [p for _, _, p in pts]
        last_cum = pts[-1][1]
        vol = (last_cum - prev_close_cum) if prev_close_cum is not None and last_cum >= prev_close_cum else None
        bars.append({'start': key * BAR_SEC, 'open': pts[0][2], 'high': max(prices), 'low': min(prices), 'close': pts[-1][2], 'volume': vol, 'n': len(pts)})
        prev_close_cum = last_cum
    return bars


def _median(values):
    values = sorted(values)
    n = len(values)
    if not n:
        return None
    return values[n // 2] if n % 2 else (values[n // 2 - 1] + values[n // 2]) / 2.0


def price_defense(bars, price_now):
    """거래량 급증 봉 뒤 가격을 지키는지: True / False / None(판정 보류).

    급증 봉 = 거래량을 아는 봉 중 다른 봉 중앙값의 SPIKE_MULT배 이상인 가장 큰 봉. 그 뒤 완성된 봉이 하나도 없으면(방금 급증) 보류."""
    vols = [(i, b['volume']) for i, b in enumerate(bars) if b['volume'] is not None]
    if len(vols) < BARS_NEEDED:
        return None, None
    spike_i, spike_v = max(vols, key=lambda x: x[1])
    others = [v for i, v in vols if i != spike_i]
    med = _median(others)
    if not med or spike_v < SPIKE_MULT * med:
        return None, None                    # 뚜렷한 급증 봉이 없다 - 방어 여부를 말할 수 없다
    spike = bars[spike_i]
    after = bars[spike_i + 1:]
    if not after:
        return None, spike_i
    low_ok = all(b['low'] >= spike['low'] * (1 - DEFEND_LOW_TOL) for b in after)
    last_ok = price_now is None or price_now >= spike['close'] * (1 - DEFEND_CLOSE_TOL)
    return bool(low_ok and last_ok), spike_i


def distribution_flags(bars, price_now, avg_bar_volume=None):
    """분배 의심 신호 목록. 반환: (flags, risk) - risk는 'LOW'/'MID'/'HIGH'(신호 0/1/2개 이상)."""
    flags = []
    recent = bars[-3:]
    mean_vol = avg_bar_volume or (_median([b['volume'] for b in bars if b['volume'] is not None]) if bars else None)
    for b in recent:
        rng = b['high'] - b['low']
        if rng <= 0 or b['close'] <= 0:
            continue
        if rng / b['close'] * 100 >= WICK_MIN_RANGE_PCT and (b['high'] - b['close']) / rng >= WICK_RATIO \
                and (b['volume'] is None or not mean_vol or b['volume'] >= SPIKE_MULT * mean_vol):
            flags.append('LONG_UPPER_WICK')
            break
    if bars and price_now:
        hi = max(b['high'] for b in bars)
        lo = min(b['low'] for b in bars)
        if lo > 0 and hi > lo and (hi / lo - 1) * 100 >= GIVEBACK_MIN_RUN_PCT and (hi - price_now) / (hi - lo) >= GIVEBACK_RATIO:
            flags.append('GIVEBACK')
    return flags, ('LOW', 'MID', 'HIGH')[min(len(flags), 2)]


FLAG_TEXT = {'LONG_UPPER_WICK': '급등 뒤 긴 윗꼬리', 'GIVEBACK': '상승분 반납', 'CLOSE_WEAK': '종가 위치 약함', 'BIG_SELL_BAR': '대량 음봉',
             'EXTENDED': '고점 대비 과열(추격 위험)', 'UPPER_WICK_DAY': '당일 긴 윗꼬리'}
RISK_TEXT = {'LOW': '낮음', 'PENDING': '판정 보류', 'MID': '보통', 'HIGH': '높음'}


def realtime_signal(samples, now_t, now_kst, price, change_rate, cum_volume, cum_amount, avg20_volume, avg20_amount):
    """① 실시간 매집 의심 판정. 조건을 못 채우면 None, 채우면 신호 dict(status: confirmed | pending).

    pending = 거래량·거래대금·RVOL 조건은 맞지만 5분봉 표본이 모자라 가격 방어를 판정하지 못한 상태(목록에는 보류로 표시)."""
    elapsed = elapsed_minutes(now_kst)
    rvol = rvol_time_proportional(cum_volume, avg20_volume, elapsed)
    amount, avg_amount, avg_vol = _f(cum_amount), _f(avg20_amount), _f(avg20_volume)
    if rvol is None or amount is None or not avg_amount or not avg_vol:
        return None
    if avg_amount < AVG_AMOUNT_MIN or avg_vol < AVG_VOLUME_MIN or amount < AMOUNT_MIN or rvol < RVOL_MIN:
        return None
    chg = _f(change_rate)
    if chg is None or chg < CHANGE_MIN or chg > CHANGE_MAX:
        return None
    bars = build_bars(samples, now_t)
    pts = [p for _, _, p in samples if p]
    close_pos = None
    if len(pts) >= 6 and max(pts) > min(pts):
        close_pos = (price - min(pts)) / (max(pts) - min(pts))
    flags, risk = distribution_flags(bars, price)
    if close_pos is not None and close_pos < 0.35 and 'CLOSE_WEAK' not in flags:
        flags = flags + ['CLOSE_WEAK']
        risk = ('LOW', 'MID', 'HIGH')[min(len(flags), 2)]
    if risk == 'LOW' and len(bars) < BARS_NEEDED:
        risk = 'PENDING'          # 5분봉 표본이 모자라 윗꼬리·상승분 반납을 볼 수 없다 - 낮음이 아니라 판정 보류
    defended, spike_i = price_defense(bars, price)
    if risk == 'HIGH' or defended is False or (close_pos is not None and close_pos < CLOSE_POS_MIN):
        return None
    score = 50 + (10 if rvol >= 2 else 0) + (10 if rvol >= 3 else 0) + (10 if rvol >= 5 else 0)
    score += 10 if (close_pos is not None and close_pos >= 0.7) else 0
    score += 10 if defended else 0
    score -= 15 if risk == 'MID' else 0
    status = 'confirmed' if defended else 'pending'
    if status == 'pending':
        score = min(score, 60)
    reasons = ['RVOL %.1f배(누적 거래량 ÷ 20일 평균 × 경과시간 비율, 단순 시간비례 근사)' % rvol,
               '누적 거래대금 %.0f억원(20일 평균 %.0f억원)' % (amount / 1e8, avg_amount / 1e8)]
    if close_pos is not None:
        reasons.append('장중 가격 범위 안 현재 위치 %.0f%%(표본 기준)' % (close_pos * 100))
    if defended is True:
        reasons.append('5분봉 거래량 급증 뒤 급증 봉 저가·종가를 지킴')
    elif defended is None:
        reasons.append('5분봉 표본 부족 - 가격 방어 판정 보류' if len(bars) < BARS_NEEDED or spike_i is None else '급증 봉 직후라 가격 방어 판정 보류')
    return {'type': TYPE_REALTIME, 'label': LABELS[TYPE_REALTIME], 'status': status, 'score': max(0, min(100, int(score))), 'rvol': round(rvol, 2),
            'amount': amount, 'closePos': round(close_pos, 3) if close_pos is not None else None, 'defended': defended,
            'barsUsed': len(bars), 'distribution': {'risk': risk, 'flags': flags}, 'reasons': reasons}


# ---------------------------------------------------------------- 일봉 매집봉 ----------
def _avg(values):
    values = [v for v in values if v is not None]
    return sum(values) / len(values) if values else None


def find_accumulation_bar(daily):
    """최근 ACC_LOOKBACK거래일 안에서 가장 최근의 매집봉(대량 거래 양봉) 인덱스. 없으면 None. 마지막 봉은 제외(이후 흐름이 있어야 한다)."""
    n = len(daily)
    if n < 25:
        return None
    for i in range(n - 2, max(20, n - 1 - ACC_LOOKBACK) - 1, -1):
        bar = daily[i]
        o, h, l, c, v = (_f(bar.get(k)) for k in ('open', 'high', 'low', 'close', 'volume'))
        if None in (o, h, l, c, v) or o <= 0 or c <= 0 or h <= l:
            continue
        avg20 = _avg([_f(b.get('volume')) for b in daily[i - 20:i]])
        if not avg20 or v < ACC_VOL_MULT * avg20 or c <= o or (c / o - 1) * 100 < ACC_MIN_BODY_PCT:
            continue
        if (c - l) / (h - l) < ACC_CLOSE_POS_MIN or c * v < ACC_AMOUNT_MIN:
            continue
        return i
    return None


def old_bar_post_avg(daily):
    """매집봉 이후 '조정 구간'(마지막 봉 제외) 평균 거래량. 매집봉이 없으면 None - 장중 재증가 배율의 분모."""
    i = find_accumulation_bar(daily)
    if i is None or len(daily) - i - 1 < 2:
        return None
    return _avg([_f(b.get('volume')) for b in daily[i + 1:-1]])


def old_bar_signal(daily, live_price=None, live_rvol_vs_post=None):
    """② 기존 매집봉 재상승 판정. 조건(매집봉 + 이후 거래량 감소 + 가격 지지)을 못 채우면 None.

    daily: 확정 일봉 오름차순. live_price/live_rvol_vs_post: 장중이면 현재가와 (시간비례 환산 오늘 거래량 ÷ 이후 평균 거래량) - 없으면 확정 일봉 기준이다.
    stage: REBREAK(고점 재돌파 + 거래량 재증가, 우선순위 상향) / NEAR(고점 3% 이내 접근) / SUPPORTED(지지 유지, 대기)."""
    i = find_accumulation_bar(daily)
    if i is None:
        return None
    acc = daily[i]
    post = daily[i + 1:]
    if len(post) < 2:
        return None
    a_o, a_h, a_l, a_c, a_v = (_f(acc[k]) for k in ('open', 'high', 'low', 'close', 'volume'))
    post_vols = [_f(b.get('volume')) for b in post]
    mid = post[:-1]                              # 마지막 봉(최근)을 뺀 '조정 구간'
    mid_avg = _avg([_f(b.get('volume')) for b in mid])
    if mid_avg is None or mid_avg > DRY_RATIO * a_v:
        return None                              # 거래량이 줄지 않았다 - 분배일 수 있어 제외
    if any(_f(b.get('low')) is not None and _f(b.get('low')) < a_l * (1 - SUPPORT_LOW_TOL) for b in post) or \
            any(_f(b.get('close')) is not None and _f(b.get('close')) < a_c * (1 - SUPPORT_CLOSE_TOL) for b in post):
        return None                              # 매집봉 저가·종가를 크게 깨 지지 실패
    last = post[-1]
    live = _f(live_price)
    if live is not None and (live < a_l * (1 - SUPPORT_LOW_TOL) or live < a_c * (1 - SUPPORT_CLOSE_TOL)):
        return None                              # 장중 현재가가 매집봉 저가·종가 지지를 이탈 - 지지 대기로 두지 않는다
    price = live or _f(last.get('close'))
    last_vol = _f(last.get('volume'))
    vol_ratio = (live_rvol_vs_post if live_rvol_vs_post is not None else (last_vol / mid_avg if last_vol and mid_avg else None))
    if price is None:
        return None
    gap_pct = (price / a_h - 1) * 100
    flags = []
    lo_, hi_, cl_ = (_f(last.get(k)) for k in ('low', 'high', 'close'))
    if None not in (lo_, hi_, cl_) and hi_ > lo_ and (hi_ - lo_) / cl_ * 100 >= 3.0 and (hi_ - cl_) / (hi_ - lo_) >= WICK_RATIO:
        flags.append('UPPER_WICK_DAY')
    if any((_f(b.get('close')) or 0) < (_f(b.get('open')) or 0) and (_f(b.get('volume')) or 0) >= 1.5 * mid_avg for b in post[-5:]):
        flags.append('BIG_SELL_BAR')
    if gap_pct >= EXTENDED_PCT:
        flags.append('EXTENDED')
    risk = ('LOW', 'MID', 'HIGH')[min(len(flags), 2)]
    if price > a_h and vol_ratio is not None and vol_ratio >= REBREAK_VOL_MULT:
        stage, score = 'REBREAK', 75
    elif -NEAR_BREAK_PCT <= gap_pct <= 0:
        stage, score = 'NEAR', 60
    elif price <= a_h:
        stage, score = 'SUPPORTED', 50
    else:
        stage, score = 'SUPPORTED', 50          # 고점은 넘었지만 거래량 재증가 미확인 - 재돌파로 올리지 않는다
    if stage == 'REBREAK' and vol_ratio is None:
        stage, score = 'SUPPORTED', 50
    score += {'LOW': 0, 'MID': -10, 'HIGH': -25}[risk]
    reasons = ['매집봉 %s: 거래량 20일 평균의 %.1f배 양봉(고점 %s원·저가 %s원)' % (acc['date'], a_v / _avg([_f(b.get('volume')) for b in daily[i - 20:i]]), format(int(a_h), ','), format(int(a_l), ',')),
               '이후 %d거래일 평균 거래량 매집봉의 %.0f%%로 감소' % (len(mid), mid_avg / a_v * 100),
               '이후 저가·종가가 매집봉 저가·종가 부근을 지킴']
    if stage == 'REBREAK':
        reasons.append('매집봉 고점 %s원 재돌파 + 거래량 %.1f배 재증가' % (format(int(a_h), ','), vol_ratio))
    elif stage == 'NEAR':
        reasons.append('매집봉 고점까지 %.1f%% - 재돌파 대기' % (-gap_pct))
    else:
        reasons.append('고점 대비 %+.1f%% - 지지 유지, 재돌파·거래량 재증가 미확인' % gap_pct)
    return {'type': TYPE_OLD_BAR, 'label': LABELS[TYPE_OLD_BAR], 'stage': stage, 'status': 'confirmed', 'score': max(0, min(100, int(score))),
            'accDate': acc['date'], 'accHigh': a_h, 'accLow': a_l, 'accVolume': a_v, 'volumeMultiple': round(vol_ratio, 2) if vol_ratio is not None else None,
            'gapToHighPct': round(gap_pct, 2), 'distribution': {'risk': risk, 'flags': flags}, 'reasons': reasons}


# ---------------------------------------------------------------- 병합 ----------
def merge_signals(signals):
    """한 종목의 신호 목록 → (대표 점수, 신호 목록 우선순위 정렬). 두 신호가 함께 있으면 점수에 가산해 우선순위를 올린다."""
    signals = [s for s in signals if s]
    if not signals:
        return 0, []
    kinds = {s['type'] for s in signals}
    best = max(s['score'] for s in signals)
    score = min(100, best + (10 if len(kinds) > 1 else 0))
    order = {TYPE_OLD_BAR: 0, TYPE_REALTIME: 1, 'EARLY_PACE': 2}
    return score, sorted(signals, key=lambda s: (order.get(s['type'], 9), -s['score']))


def worst_risk(signals):
    ranks = {'LOW': 0, 'PENDING': 1, 'MID': 2, 'HIGH': 3}
    risks = [s.get('distribution', {}).get('risk', 'LOW') for s in signals]
    return max(risks, key=lambda r: ranks.get(r, 0)) if risks else 'LOW'


# ---------------------------------------------------------------- 화면용 행 ----------
def interpretation_for(signals, risk):
    labels = ' + '.join(s['label'] for s in signals)
    pending = any(s.get('status') == 'pending' for s in signals)
    text = '%s 신호입니다. 분배 위험 %s.' % (labels, RISK_TEXT.get(risk, '-'))
    if risk == 'PENDING':
        text = '%s 신호입니다. 분배 위험은 5분봉 표본이 부족해 판정 보류.' % labels
    if pending:
        text += ' 일부 판정(가격 방어)은 데이터 부족으로 보류 중입니다.'
    text += ' 매집 여부를 확정하는 신호가 아니며 방향을 보장하지 않습니다.'
    return text


def daily_detail(sig):
    """일봉 판정 결과 → 차트검색 patternDetail(pattern_detect.build_pattern_match의 detail 입력)."""
    risk = sig['distribution']['risk']
    return {'score': sig['score'], 'reasons': list(sig['reasons']), 'interpretation': interpretation_for([sig], risk), 'status': sig['stage'],
            'live': False, 'priceBasis': 'SCAN', 'signals': [sig], 'distribution': sig['distribution'], 'volumeMultiple': sig.get('volumeMultiple'),
            'accDate': sig['accDate'], 'accHigh': sig['accHigh'], 'accLow': sig['accLow'], 'gapToHighPct': sig['gapToHighPct']}


def combined_item(code, name, price, change_rate, date, signals, extra_reasons=(), live=True, status='watch', extra_detail=None, price_basis=None):
    """여러 신호를 한 종목 한 행으로 합친다(중복 표시 없음). 반환: 차트검색 공통 행."""
    score, ordered = merge_signals(signals)
    risk = worst_risk(ordered)
    flags = []
    for s in ordered:
        for f in s.get('distribution', {}).get('flags', []):
            if f not in flags:
                flags.append(f)
    reasons = []
    for s in ordered:
        reasons.extend('[%s] %s' % (s['label'], r) for r in s.get('reasons', []))
    reasons.extend(extra_reasons)
    mult = next((s.get('volumeMultiple') or s.get('rvol') for s in ordered if s.get('volumeMultiple') or s.get('rvol')), None)
    detail = {'score': score, 'reasons': reasons, 'interpretation': interpretation_for(ordered, risk), 'live': live, 'status': status,
              'signals': ordered, 'distribution': {'risk': risk, 'flags': flags}, 'volumeMultiple': mult}
    detail.update(extra_detail or {})
    if price_basis:
        detail['priceBasis'] = price_basis          # DETECT(장중 감지가) / SCAN(일봉 스캔가) - 화면 라벨 구분용
    return {'code': code, 'name': name, 'price': price, 'changeRate': change_rate, 'date': date, 'miniChart': [], 'score': score,
            'reasons': reasons, 'interpretation': detail['interpretation'], 'patternDetail': detail}


def merge_lists(primary, secondary):
    """두 목록(차트검색 행)을 종목코드로 합친다. 같은 종목은 신호를 합쳐 한 행으로(primary 행 기준), 점수 내림차순."""
    out, by_code = [], {}
    for item in list(primary or []) + list(secondary or []):
        code = item.get('code')
        if code in by_code:
            base = by_code[code]
            sigs = list(base['patternDetail'].get('signals') or []) + list(item['patternDetail'].get('signals') or [])
            seen, uniq = set(), []
            for s in sigs:
                if s['type'] not in seen:
                    seen.add(s['type'])
                    uniq.append(s)
            merged = combined_item(code, base['name'], base['price'], base.get('changeRate'), base.get('date'), uniq,
                                   live=bool(base['patternDetail'].get('live')), status=base['patternDetail'].get('status') or 'watch',
                                   extra_detail={k: v for k, v in base['patternDetail'].items() if k not in ('signals', 'score', 'reasons', 'interpretation', 'distribution', 'volumeMultiple')},
                                   price_basis=base['patternDetail'].get('priceBasis'))
            merged['miniChart'] = base.get('miniChart') or item.get('miniChart') or []
            by_code[code].clear()
            by_code[code].update(merged)
        else:
            by_code[code] = item
            out.append(item)
    return sorted(out, key=lambda it: -(it.get('score') or 0))
