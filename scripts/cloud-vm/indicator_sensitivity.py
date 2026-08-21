# -*- coding: utf-8 -*-
"""각도기 타점(accumulation_angle.py)의 entry_signal을 기준(baseline)으로 두고, "이 신호에
보조지표 조건을 하나 더 얹으면 승률이 오르는가?"를 종목별로 하나씩 돌리는 대신 한 번의
전종목 스캔으로 전부 확인하기 위한 분석 도구.

방식: entry_signal이 뜬 날마다 이미 하던 대로 net_return(5일 보유 백테스트)을 계산하면서,
같은 날짜의 보조지표 값(거래량 이평선 비율, RSI, MACD 히스토그램, 볼린저 %b, 스토캐스틱 %K,
ADX, ATR 변동성, 이격도, OBV 기울기)도 같이 기록한다. 전종목을 다 돈 뒤 지표별로 값을
4분위(Q1=낮음~Q4=높음)로 나눠 구간별 승률·평균수익률을 비교하면, "이 지표가 높을 때/낮을 때
승률이 오른다"는 걸 지표당 1번씩 VM에서 따로 백테스트를 돌리지 않고도 한 번에 확인할 수 있다.

주의:
- 여기 지표 공식(RSI/MACD/볼린저/스토캐스틱/ADX)은 표준 정의를 pandas로 재현한 것이지
  pandas-ta 등 특정 라이브러리 실제 출력과 대조 검증하지 않았다(accumulation_angle.py의
  기존 주의사항과 동일한 성격 - 값의 절대적 정확성보다 "구간별 상대 비교"가 목적이라
  약간의 계산 방식 차이는 이 분석의 결론에 큰 영향을 주지 않을 것으로 본다).
- 지표를 10개나 동시에 사후적으로 비교하는 거라 다중검정(multiple comparisons) 문제가
  있다 - 우연히 한두 개 지표가 그럴듯한 구간별 차이를 보일 수 있다. 트레이드 건수와
  구간별 차이 크기를 함께 보고, 실제로 필터를 채택하기 전에는 그 지표만 따로 넣은
  백테스트로 한 번 더 확인하는 걸 권장한다(이 스크립트는 "후보를 좁히는" 용도).
"""

import numpy as np
import pandas as pd

RSI_PERIOD = 14
MACD_FAST, MACD_SLOW, MACD_SIGNAL = 12, 26, 9
BB_PERIOD, BB_STD_MULT = 20, 2.0
STOCH_PERIOD = 14
ADX_PERIOD = 14
VOLUME_MA_SHORT, VOLUME_MA_LONG = 5, 20
DISPARITY_MA = 20
OBV_LOOKBACK = 5

INDICATOR_COLUMNS = [
    'volume_ratio20', 'volume_ma_cross', 'rsi14', 'macd_hist', 'bb_percent_b',
    'stoch_k', 'adx14', 'atr_ratio_pct', 'disparity20', 'obv_slope5',
]

INDICATOR_LABELS = {
    'volume_ratio20': '거래량/20일 평균 거래량 배율',
    'volume_ma_cross': '거래량 5일선/20일선 비율',
    'rsi14': 'RSI(14)',
    'macd_hist': 'MACD 히스토그램(12,26,9)',
    'bb_percent_b': '볼린저밴드 %b(20, 2표준편차)',
    'stoch_k': '스토캐스틱 %K(14)',
    'adx14': 'ADX(14) 추세강도',
    'atr_ratio_pct': 'ATR(14)/종가 변동성(%)',
    'disparity20': '20일선 이격도(종가/20일선*100)',
    'obv_slope5': 'OBV 5일 기울기(20일 평균거래량 대비 정규화)',
}


def compute_candidate_indicators(df):
    """accumulation_angle.compute_accumulation_angle()이 만든 DataFrame(open/high/low/close/
    volume 포함)에 후보 보조지표 컬럼(INDICATOR_COLUMNS)을 추가해 반환한다. 원본 df는
    건드리지 않고 복사본에 추가한다."""
    if df is None or df.empty:
        return df
    d = df.copy()
    close, high, low, volume = d['close'], d['high'], d['low'], d['volume']

    vol_ma20 = volume.rolling(VOLUME_MA_LONG).mean()
    vol_ma5 = volume.rolling(VOLUME_MA_SHORT).mean()
    d['volume_ratio20'] = volume / vol_ma20
    d['volume_ma_cross'] = vol_ma5 / vol_ma20

    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / RSI_PERIOD, adjust=False, min_periods=RSI_PERIOD).mean()
    avg_loss = loss.ewm(alpha=1 / RSI_PERIOD, adjust=False, min_periods=RSI_PERIOD).mean()
    rs = avg_gain / avg_loss
    d['rsi14'] = 100 - (100 / (1 + rs))
    d.loc[avg_loss == 0, 'rsi14'] = 100.0

    ema_fast = close.ewm(span=MACD_FAST, adjust=False).mean()
    ema_slow = close.ewm(span=MACD_SLOW, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    macd_signal = macd_line.ewm(span=MACD_SIGNAL, adjust=False).mean()
    d['macd_hist'] = macd_line - macd_signal

    bb_ma = close.rolling(BB_PERIOD).mean()
    bb_std = close.rolling(BB_PERIOD).std()
    bb_upper = bb_ma + BB_STD_MULT * bb_std
    bb_lower = bb_ma - BB_STD_MULT * bb_std
    band_width = bb_upper - bb_lower
    d['bb_percent_b'] = (close - bb_lower) / band_width.where(band_width != 0)

    low_n = low.rolling(STOCH_PERIOD).min()
    high_n = high.rolling(STOCH_PERIOD).max()
    stoch_range = (high_n - low_n)
    d['stoch_k'] = (close - low_n) / stoch_range.where(stoch_range != 0) * 100

    up_move = high.diff()
    down_move = -low.diff()
    plus_dm = pd.Series(np.where((up_move > down_move) & (up_move > 0), up_move, 0.0), index=d.index)
    minus_dm = pd.Series(np.where((down_move > up_move) & (down_move > 0), down_move, 0.0), index=d.index)
    tr = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low - close.shift()).abs(),
    ], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1 / ADX_PERIOD, adjust=False).mean()
    plus_di = 100 * plus_dm.ewm(alpha=1 / ADX_PERIOD, adjust=False).mean() / atr.where(atr != 0)
    minus_di = 100 * minus_dm.ewm(alpha=1 / ADX_PERIOD, adjust=False).mean() / atr.where(atr != 0)
    di_sum = (plus_di + minus_di)
    dx = (plus_di - minus_di).abs() / di_sum.where(di_sum != 0) * 100
    d['adx14'] = dx.ewm(alpha=1 / ADX_PERIOD, adjust=False).mean()
    d['atr_ratio_pct'] = atr / close * 100

    ma20 = close.rolling(DISPARITY_MA).mean()
    d['disparity20'] = close / ma20.where(ma20 != 0) * 100

    obv = (np.sign(close.diff()).fillna(0) * volume).cumsum()
    d['obv_slope5'] = (obv - obv.shift(OBV_LOOKBACK)) / (vol_ma20.where(vol_ma20 != 0) * OBV_LOOKBACK)

    return d


def collect_indicator_trades(df, hold_days, slippage_pct):
    """entry_signal이 뜬 날마다 backtest_entry_signal()과 동일한 진입/청산 가정(다음날 시가
    진입, hold_days일 뒤 종가 청산, 왕복 슬리피지)으로 net_return을 계산하면서, 신호 발생일
    시점의 보조지표 값도 함께 담은 레코드 리스트를 반환한다(각 레코드: {'netReturn': float,
    지표명: float 또는 NaN})."""
    if df is None or df.empty or 'entry_signal' not in df.columns:
        return []
    needed = ['open', 'close', 'entry_signal'] + INDICATOR_COLUMNS
    d = df[needed].copy()
    d['entry_price'] = d['open'].shift(-1)
    d['exit_price'] = d['close'].shift(-(hold_days + 1))
    trades = d[d['entry_signal']].dropna(subset=['entry_price', 'exit_price'])
    if trades.empty:
        return []
    gross_return = (trades['exit_price'] - trades['entry_price']) / trades['entry_price']
    net_return = gross_return - (slippage_pct * 2)
    records = []
    for (idx, net), (_, row) in zip(net_return.items(), trades.iterrows()):
        record = {'netReturn': float(net)}
        for col in INDICATOR_COLUMNS:
            value = row[col]
            record[col] = float(value) if pd.notna(value) else None
        records.append(record)
    return records


def _quartile_buckets(values):
    """오름차순 정렬된 값 리스트를 4분위(Q1~Q4)로 균등하게 자른 경계 인덱스를 반환."""
    n = len(values)
    edges = [round(n * i / 4) for i in range(5)]
    return edges


def summarize_indicator_sensitivity(records, quartiles=4):
    """collect_indicator_trades()가 전종목에 걸쳐 모은 레코드 리스트를 지표별로 4분위 구간
    승률/평균수익률로 요약한다. 반환값은 지표명 -> {baseline, buckets:[...], correlation}."""
    if not records:
        return {}
    all_returns = np.array([r['netReturn'] for r in records], dtype=float)
    baseline_win_rate = round(float((all_returns > 0).mean() * 100), 2)
    result = {}
    for col in INDICATOR_COLUMNS:
        pairs = [(r[col], r['netReturn']) for r in records if r[col] is not None and np.isfinite(r[col])]
        if len(pairs) < quartiles * 5:  # 구간마다 최소 표본이 있어야 의미가 있음
            result[col] = {'label': INDICATOR_LABELS[col], 'sampleCount': len(pairs), 'buckets': None, 'correlation': None}
            continue
        pairs.sort(key=lambda p: p[0])
        values = np.array([p[0] for p in pairs], dtype=float)
        returns = np.array([p[1] for p in pairs], dtype=float)
        edges = [round(len(pairs) * i / quartiles) for i in range(quartiles + 1)]
        buckets = []
        for q in range(quartiles):
            lo, hi = edges[q], edges[q + 1]
            if hi <= lo:
                continue
            seg_values = values[lo:hi]
            seg_returns = returns[lo:hi]
            wins = seg_returns > 0
            buckets.append({
                'quartile': q + 1,
                'count': int(len(seg_returns)),
                'valueRangeLow': round(float(seg_values.min()), 4),
                'valueRangeHigh': round(float(seg_values.max()), 4),
                'winRatePct': round(float(wins.mean() * 100), 2),
                'avgReturnPct': round(float(seg_returns.mean() * 100), 2),
                'medianReturnPct': round(float(np.median(seg_returns) * 100), 2),
            })
        correlation = None
        if np.std(values) > 0 and np.std(returns) > 0:
            correlation = round(float(np.corrcoef(values, returns)[0, 1]), 4)
        result[col] = {
            'label': INDICATOR_LABELS[col],
            'sampleCount': len(pairs),
            'baselineWinRatePct': baseline_win_rate,
            'buckets': buckets,
            'correlation': correlation,
        }
    return result
