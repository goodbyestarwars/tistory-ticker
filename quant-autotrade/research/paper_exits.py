# -*- coding: utf-8 -*-
"""연구용 모의매매 청산 엔진 (2026-10-11). 실주문 없음 - 일봉 데이터만으로 판정한다.

세 전략을 같은 후보·같은 진입(다음 거래일 시가 + 0.2%)에 병렬 적용하고, 각 전략의 청산 방식과 최대 보유 기간을 구분해 기록한다.

  trail_atr  ATR 추적(장중 이탈). 초기선 = 진입가 − 2.5×ATR14, 이후 고점 − 2.5×ATR 로 상향만. 저가가 선에 닿으면 선(또는 갭이면 시가)에 체결. 최대 30거래일(마지막 날 종가 청산).
  atr_close  같은 추적선을 **종가**가 이탈하면 신호 → **다음 거래일 시가**에 체결. 최대 150거래일.
  dead35     3일선이 5일선을 아래로 교차(어제 MA3>=MA5, 오늘 MA3<MA5)하면 신호 → 다음 거래일 시가 체결. 최대 150거래일. 가격 손절선 없음.

확정 규칙(미래 참조·조기 확정 금지)
- 상태: PENDING_ENTRY(다음 거래일 봉 없음) → OPEN → PENDING_EXIT(종가로 신호가 났지만 다음 거래일 시가 봉이 아직 없음) → CLOSED.
- CLOSED 는 체결 가격을 만드는 봉이 데이터에 실제로 있을 때만 된다. 데이터가 모자라면 미확정(OPEN/PENDING_*)으로 남긴다.
- 어떤 날짜까지의 데이터로 계산하든 CLOSED 결과는 이후 데이터가 늘어나도 바뀌지 않는다(tests: 절단 일관성 검사).
- 같은 봉에서 손절선 확인은 시가·저가로만 하며, 추적선은 그 봉이 끝난 뒤 갱신한다(다음 봉부터 적용).
백테스트(`backtest/trend_exit_study.py`, `exit_study.simulate`)와 같은 비용·슬리피지·체결 가정을 쓰고, 동일 입력에서 같은 결과가 나오는지 테스트로 확인한다.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
for _p in (os.path.join(REPO, 'quant-autotrade', 'backtest'), os.path.join(REPO, 'scripts', 'analysis'), os.path.join(REPO, 'scripts', 'cloud-vm')):
    if _p not in sys.path:
        sys.path.insert(0, _p)
import exit_study as ex  # noqa: E402

ENTRY_SLIP = ex.ENTRY_SLIP
EXIT_SLIP = ex.EXIT_SLIP
COST = ex.COST
ATR_MULT = 2.5

VARIANTS = {
    'trail_atr': {'label': 'ATR 추적(장중 이탈·최대 30일)', 'maxHold': 30, 'execution': '추적선에 닿으면 선(갭이면 시가)에 체결, 30일째 종가 청산'},
    'atr_close': {'label': 'ATR 추적(종가 이탈→다음 시가·최대 150일)', 'maxHold': 150, 'execution': '종가가 추적선 아래면 신호, 다음 거래일 시가 체결'},
    'dead35': {'label': '3·5일선 데드크로스→다음 시가(최대 150일)', 'maxHold': 150, 'execution': 'MA3가 MA5 아래로 교차하면 신호, 다음 거래일 시가 체결'},
}
PRIMARY_ORDER = ('trail_atr', 'atr_close', 'dead35')


def _sma(closes, k, n):
    if k < n - 1:
        return None
    return sum(closes[k - n + 1:k + 1]) / n


def evaluate(daily, scan_idx, variant, entry_mode='open'):
    """scan_idx: 스캔일 봉의 인덱스. daily 는 오름차순 일봉(확정된 봉만). 반환 dict(상태·가격·사유). 데이터가 모자라면 미확정 상태.

    entry_mode='open'  : 다음 거래일 시가(+0.2%)에 진입(기본·공식 기록).
    entry_mode='close' : **당일 재투입 시나리오 전용** - 같은 날 시가에는 자금이 없어 못 산 후보를 장 마감 시점(종가 +0.2%)에 매수한다.
                         진입 봉의 장중 가격은 쓰지 않고 다음 봉부터 손절선·신호를 판정한다. 청산 전략 자체는 같다."""
    spec = VARIANTS[variant]
    n = len(daily)
    start = scan_idx + 1
    base = {'variant': variant, 'maxHold': spec['maxHold'], 'status': 'PENDING_ENTRY', 'entry_date': None, 'entry_price': None, 'stop_price': None,
            'trail_price': None, 'signal_date': None, 'exit_date': None, 'exit_price': None, 'gross_ret': None, 'net_ret': None,
            'exit_reason': None, 'hold_days': None, 'last_bar_date': daily[-1]['date'] if daily else None}
    if start >= n or scan_idx < 15:
        return base
    if entry_mode == 'close':
        px1 = daily[start]['close']
        first = start + 1               # 종가에 사서 다음 봉부터 평가
    else:
        px1 = daily[start]['open']
        first = start
    if not px1:
        return base
    entry = px1 * (1 + ENTRY_SLIP)
    atr = ex.atr14(daily, scan_idx)
    if not atr:
        return dict(base, note='ATR 계산 불가')
    closes = [d['close'] for d in daily]
    out = dict(base, status='OPEN', entry_date=daily[start]['date'], entry_price=entry, entry_mode=entry_mode)
    uses_trail = variant in ('trail_atr', 'atr_close')
    hh = entry
    trail = entry - ATR_MULT * atr
    if uses_trail:
        out['stop_price'] = trail
        out['trail_price'] = trail
    cap = first + spec['maxHold'] - 1                 # 마지막으로 허용되는 봉
    last_avail = n - 1
    pending = False
    pending_reason = None

    def close_out(k, fill, reason):
        gross = fill / entry - 1
        r = dict(out, status='CLOSED', exit_date=daily[k]['date'], exit_price=fill, gross_ret=gross, net_ret=gross - COST,
                 exit_reason=reason, hold_days=k - first + 1)
        if uses_trail:
            r['trail_price'] = trail
        return r

    for k in range(first, min(last_avail, cap) + 1):
        bar = daily[k]
        o, lo, hi, cl = bar['open'], bar['low'], bar['high'], bar['close']
        if pending:   # 어제 종가에서 난 신호 -> 오늘 시가 체결
            return close_out(k, o * (1 - EXIT_SLIP), pending_reason)
        if variant == 'trail_atr':
            if lo <= trail:
                return close_out(k, min(o, trail) * (1 - EXIT_SLIP), 'STOP_INTRADAY')
            hh = max(hh, hi)
            trail = max(trail, hh - ATR_MULT * atr)
        elif variant == 'atr_close':
            hh = max(hh, hi)
            trail = max(trail, hh - ATR_MULT * atr)
            if cl < trail:
                pending = True
                out['signal_date'] = bar['date']
                pending_reason = 'SIGNAL_ATR_CLOSE'
        else:  # dead35
            m3, m5, p3, p5 = _sma(closes, k, 3), _sma(closes, k, 5), _sma(closes, k - 1, 3), _sma(closes, k - 1, 5)
            if None not in (m3, m5, p3, p5) and m3 < m5 and p3 >= p5:
                pending = True
                out['signal_date'] = bar['date']
                pending_reason = 'SIGNAL_DEAD35'
        if k == cap:   # 최대 보유일 마지막 봉(존재함): 종가 청산(백테스트의 'end')
            return close_out(k, cl * (1 - EXIT_SLIP / 3), 'MAX_HOLD_%d' % spec['maxHold'])
    # 데이터가 끝났고 아직 확정되지 않았다
    if uses_trail:
        out['trail_price'] = trail
    out['hold_days'] = max(0, last_avail - first + 1)
    if pending:
        out['status'] = 'PENDING_EXIT'
        out['note'] = '종가로 청산 신호(%s)가 났고 다음 거래일 시가 봉 대기 중' % out['signal_date']
    else:
        out['note'] = '진행 중(마지막 확정 봉 %s)' % daily[-1]['date']
    return out


def exit_class(reason):
    """청산 체결 시각의 선후관계 분류(일봉만으로 알 수 있는 범위).
    'open'     다음 거래일 시가 체결(신호 청산) - 장 시작 시점
    'intraday' 장중 추적선 이탈 체결 - 시가 이후 ~ 종가 이전 어디든(정확한 시각은 일봉으로 알 수 없음, 단 종가 이전임은 확실)
    'close'    최대 보유일 마지막 종가 청산 - 종가 시점
    None       미청산"""
    if not reason:
        return None
    if reason.startswith('SIGNAL_'):
        return 'open'
    if reason == 'STOP_INTRADAY':
        return 'intraday'
    if reason.startswith('MAX_HOLD'):
        return 'close'
    return None
