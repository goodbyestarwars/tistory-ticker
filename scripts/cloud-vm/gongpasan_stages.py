# -*- coding: utf-8 -*-
"""급락 후 첫 눌림목(공파산) 진행 단계 판정과 단계 이력 저장 (2026-10-15).

기존 gongpasan_strategy.py의 컬럼(breakout_signal·entry_signal 등)과 상태 머신을 **그대로 읽기만** 하고 조건은
바꾸지 않는다. 마지막 봉에서 최종 지지 확인(entry_signal)만 보여 주던 것을, 같은 전략이 진행되는 4단계로 나눠 보여 준다.

  WATCH_ACCUM(매집 관찰)    낙폭 -25% + 40일 횡보 20% 이내 + 매집봉(거래대금 100억, 저점 유지)
  BREAKOUT(상승 돌파)       위 조건 + 오늘 돌파봉(5봉 고가 돌파·5일선 위·양봉·장대·거래대금 300억) - 아직 매수 신호 아님
  WAIT_PULLBACK(눌림 대기)  돌파 후 20거래일 안, 20일선 첫 접근 전
  SUPPORT_CONFIRMED(지지 확인)  첫 접근에서 저가<=20일선+3%, 종가>=20일선-1% (= 기존 entry_signal, 유일한 최종 신호)

stage_trace()는 한 봉씩 앞에서 뒤로만 읽으므로 i번째 판정에 i+1번째 이후 봉을 쓰지 않는다(미래 참조 없음).
중간 단계(관찰·돌파·대기)는 gongpasan_stage_log에만 쌓고 scan_hits/pattern_tracks(최종 신호 성과 통계)에는 섞지 않는다.
"""
import numpy as np

import gongpasan_strategy as gp

WATCH_ACCUM = 'WATCH_ACCUM'
BREAKOUT = 'BREAKOUT'
WAIT_PULLBACK = 'WAIT_PULLBACK'
SUPPORT_CONFIRMED = 'SUPPORT_CONFIRMED'

STAGE_LABELS = {
    WATCH_ACCUM: '매집 관찰',
    BREAKOUT: '상승 돌파',
    WAIT_PULLBACK: '눌림 대기',
    SUPPORT_CONFIRMED: '지지 확인',
}
STAGE_ORDER = (WATCH_ACCUM, BREAKOUT, WAIT_PULLBACK, SUPPORT_CONFIRMED)

# 화면 표시 상한 - 단계별 전체 건수(counts)는 따로 내려주고 목록만 자른다(e2-micro 응답 크기 절약).
MAX_ITEMS_PER_STAGE = 30


def stage_trace(df):
    """봉마다 진행 단계 코드 배열과 돌파 에피소드 목록을 돌려준다.

    stage: 0 없음 / 1 매집 관찰 / 2 상승 돌파(돌파 당일) / 3 눌림 대기 / 4 지지 확인.
    episodes: [{'b': 돌파 봉 인덱스, 'outcome': 'SUPPORT_CONFIRMED'|'SUPPORT_FAILED'|'EXPIRED'|'REPLACED'|None(진행 중),
                'end': 종료 봉 인덱스 또는 None}]
    첫 눌림 상태 머신은 gongpasan_strategy._first_pullback_entry_flags와 같은 규칙이다(테스트가 entry_signal과 일치를 검증).
    """
    n = len(df)
    breakout = df['breakout_signal'].to_numpy(dtype=bool)
    low = df['low'].to_numpy(dtype=float)
    close = df['close'].to_numpy(dtype=float)
    sma20 = df['sma20'].to_numpy(dtype=float)
    cond1 = (df['retreat_pct'].to_numpy(dtype=float) <= -gp.DECLINE_MIN_PCT) \
        & df['is_gongguri'].to_numpy(dtype=bool) & df['has_daejip_bong'].to_numpy(dtype=bool)

    stage = np.zeros(n, dtype=int)
    episodes = []
    watching = None
    ep = None
    for i in range(n):
        if breakout[i]:
            if ep is not None and ep['outcome'] is None:
                ep['outcome'], ep['end'] = 'REPLACED', i
            ep = {'b': i, 'outcome': None, 'end': None}
            episodes.append(ep)
            watching = i
            stage[i] = 2
            continue
        if watching is not None:
            bars = i - watching
            if bars > gp.PULLBACK_MAX_LOOKAHEAD:
                ep['outcome'], ep['end'] = 'EXPIRED', i
                watching = None
            else:
                ma = sma20[i]
                if bars >= 1 and np.isfinite(ma) and ma > 0 and low[i] <= ma * (1 + gp.SUPPORT_TOUCH_TOL_PCT / 100.0):
                    if close[i] >= ma * (1 - gp.SUPPORT_CLOSE_FLOOR_PCT / 100.0):
                        stage[i] = 4
                        ep['outcome'], ep['end'] = 'SUPPORT_CONFIRMED', i
                    else:
                        ep['outcome'], ep['end'] = 'SUPPORT_FAILED', i
                    watching = None
                else:
                    stage[i] = 3
                continue
        if cond1[i]:
            stage[i] = 1
    return {'stage': stage, 'episodes': episodes, 'cond1': cond1}


def _run_start(flags, i):
    j = i
    while j - 1 >= 0 and flags[j - 1]:
        j -= 1
    return j


def _date(df, i):
    return df.iloc[i]['date'].strftime('%Y-%m-%d')


def describe_stage(df, trace, i=None):
    """i번째 봉(기본 마지막)의 단계 설명. 단계가 없으면 None. i 이후 봉은 읽지 않는다."""
    n = len(df)
    i = n - 1 if i is None else i
    code = int(trace['stage'][i])
    if code == 0:
        return None
    key = {1: WATCH_ACCUM, 2: BREAKOUT, 3: WAIT_PULLBACK, 4: SUPPORT_CONFIRMED}[code]
    row = df.iloc[i]
    ma20 = float(row['sma20']) if row['sma20'] == row['sma20'] else None
    detail = {
        'stage': key, 'stageLabel': STAGE_LABELS[key], 'stageCode': code,
        'asOf': _date(df, i), 'close': float(row['close']),
        'ma20': ma20,
        'ma20GapPct': round((float(row['close']) - ma20) / ma20 * 100, 2) if ma20 else None,
        'retreatPct': round(float(row['retreat_pct']), 1) if row['retreat_pct'] == row['retreat_pct'] else None,
    }
    window = df.iloc[max(0, i + 1 - gp.GONGGURI_LOOKBACK):i + 1]
    base_range = (window['high'].max() - window['low'].min()) / window['low'].min() * 100 if len(window) else None
    detail['baseRangePct'] = round(float(base_range), 1) if base_range is not None else None
    detail['baseHigh'] = float(window['high'].max()) if len(window) else None
    detail['baseLow'] = float(window['low'].min()) if len(window) else None
    acc = df.iloc[max(0, i - gp.DAEJIP_LOOKBACK):i + 1]
    acc_idx = acc.index[acc['daejip_bar']].tolist()
    if acc_idx:
        a = acc_idx[-1]
        detail['accumulationDate'] = _date(df, a)
        detail['accumulationVolRatio'] = round(float(df.iloc[a]['daejip_vol_ratio']), 1)

    b = None
    if key in (BREAKOUT, WAIT_PULLBACK, SUPPORT_CONFIRMED):
        b = max((e['b'] for e in trace['episodes'] if e['b'] <= i), default=None)
        if b is None:
            return None
        detail['breakoutDate'] = _date(df, b)
        detail['breakoutLevel'] = float(df['high'].iloc[max(0, b - gp.ODORI_LOOKBACK):b].max()) if b > 0 else None
        detail['daysSinceBreakout'] = i - b
        detail['stageSince'] = detail['breakoutDate']
    else:
        detail['stageSince'] = _date(df, _run_start(trace['cond1'], i))

    low_gap = (float(row['low']) - ma20) / ma20 * 100 if ma20 else None
    detail['lowGapPct'] = round(low_gap, 2) if low_gap is not None else None

    met = []
    unmet = []
    if detail['retreatPct'] is not None:
        met.append('160일 고점 대비 %.1f%% 하락(기준 -25%% 이상)' % detail['retreatPct'])
    if detail['baseRangePct'] is not None:
        met.append('40일 변동폭 %.1f%%(기준 20%% 이내)' % detail['baseRangePct'])
    if acc_idx:
        met.append('매집봉 %s · 거래량 20일 평균의 %.1f배 · 저점 유지' % (detail['accumulationDate'], detail['accumulationVolRatio']))
    if key == WATCH_ACCUM:
        unmet.append('돌파봉 미발생(직전 5봉 고가 종가 돌파·5일선 위 양봉·몸통 3% 또는 ATR 0.8배·거래대금 300억 이상)')
        unmet.append('돌파 뒤 20일선 첫 눌림 미발생')
        invalid = '매집봉 저가의 95% 아래로 저점이 내려가거나 낙폭 -25%·40일 횡보 20% 조건이 깨지면 관찰이 끝납니다.'
    elif key == BREAKOUT:
        met.append('오늘 돌파봉: 직전 5봉 고가 %s원 종가 돌파' % format(int(detail['breakoutLevel'] or 0), ','))
        unmet.append('20일선 첫 접근·지지 미확인(아직 매수 신호가 아닙니다)')
        invalid = '돌파 뒤 20거래일 안에 20일선 첫 접근이 없으면 이 돌파는 끝납니다.'
    elif key == WAIT_PULLBACK:
        met.append('돌파 후 %d거래일째(기준일 %s, 돌파 기준가 %s원)' % (detail['daysSinceBreakout'], detail['breakoutDate'], format(int(detail['breakoutLevel'] or 0), ',')))
        unmet.append('20일선 첫 접근 대기: 저가가 20일선 +3%% 이내로 내려와야 합니다(현재 저가는 20일선 대비 %+.1f%%)' % (low_gap if low_gap is not None else 0.0))
        invalid = '첫 접근 봉의 종가가 20일선 -1% 아래면 이 돌파는 끝나고(재진입 없음), 20거래일이 지나도 끝납니다.'
    else:
        met.append('돌파 후 %d거래일째 첫 20일선 접근: 저가 20일선 대비 %+.1f%%, 종가 20일선 -1%% 이상 지지' % (detail['daysSinceBreakout'], low_gap if low_gap is not None else 0.0))
        invalid = '종가가 20일선보다 1% 넘게 아래로 내려가면 지지 실패입니다.'
    detail['met'] = met
    detail['unmet'] = unmet
    detail['invalid'] = invalid
    return detail


def build_stage_item(stock, df, detail):
    """차트검색 다른 탭과 같은 행 모양(최종 신호용 gongpasan_scan._build_match와 같은 키)을 중간 단계 후보용으로 만든다."""
    last = df.iloc[-1]
    prev = df.iloc[-2] if len(df) > 1 else None
    change_rate = None
    if prev is not None and prev['close']:
        change_rate = float((last['close'] - prev['close']) / prev['close'] * 100)
    mini = [{'date': r['date'].strftime('%Y-%m-%d'), 'close': float(r['close'])} for _, r in df.tail(20).iterrows()]
    date_str = last['date'].strftime('%Y-%m-%d')
    return {
        'code': stock['code'], 'name': stock['name'], 'price': float(last['close']),
        'changeRate': change_rate, 'date': date_str, 'miniChart': mini,
        'score': None,  # 중간 단계는 점수를 매기지 않는다(점수는 최종 신호만) - 순위와 성과 통계에 섞이지 않게
        'reasons': detail['met'],
        'interpretation': '%s 단계입니다. 최종 매수 신호(지지 확인)가 아닙니다.' % detail['stageLabel'],
        # signal(차트의 매수 타점 마커)은 일부러 넣지 않는다 - 중간 단계는 매수 신호가 아니다.
        'patternDetail': dict(detail, blueLine=float(last['blue_line']) if last['blue_line'] == last['blue_line'] else None),
    }


# ---------------------------------------------------------------- 단계 이력 -------------------------------------------------
SCHEMA = """
CREATE TABLE IF NOT EXISTS gongpasan_stage_log (
    code TEXT NOT NULL,
    stage TEXT NOT NULL,
    stage_since TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    first_seen_date TEXT NOT NULL,
    last_seen_date TEXT NOT NULL,
    breakout_date TEXT,
    breakout_level REAL,
    ma20 REAL,
    ma20_gap_pct REAL,
    days_since_breakout INTEGER,
    ended_date TEXT,
    end_reason TEXT,
    source TEXT NOT NULL DEFAULT 'live',
    created_at TEXT NOT NULL,
    PRIMARY KEY (code, stage, stage_since)
);
CREATE INDEX IF NOT EXISTS idx_gp_stage_log_open ON gongpasan_stage_log(ended_date, code);
"""


def ensure_schema(conn):
    conn.executescript(SCHEMA)


def record_stage(conn, scan_date, name, code, detail, now_iso):
    """(종목, 단계, 단계 시작일)이 처음 보이면 한 줄 넣고, 이미 있으면 마지막 확인일만 갱신한다 → 일별 중복 행이 생기지 않는다.
    반환: 새로 넣었으면 True."""
    cur = conn.execute(
        'INSERT OR IGNORE INTO gongpasan_stage_log (code, stage, stage_since, name, first_seen_date, last_seen_date, '
        'breakout_date, breakout_level, ma20, ma20_gap_pct, days_since_breakout, source, created_at) '
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,'live',?)",
        (code, detail['stage'], detail['stageSince'], name, scan_date, scan_date, detail.get('breakoutDate'),
         detail.get('breakoutLevel'), detail.get('ma20'), detail.get('ma20GapPct'), detail.get('daysSinceBreakout'), now_iso))
    if cur.rowcount and cur.rowcount > 0:
        return True
    conn.execute('UPDATE gongpasan_stage_log SET last_seen_date=? WHERE code=? AND stage=? AND stage_since=? AND ended_date IS NULL',
                 (scan_date, code, detail['stage'], detail['stageSince']))
    return False


def open_codes(conn):
    return {r[0] for r in conn.execute('SELECT DISTINCT code FROM gongpasan_stage_log WHERE ended_date IS NULL')}


def _reason_for(stage, since, df, trace, current_stage):
    """끝난 단계 행의 종료 사유. current_stage는 오늘 이 종목의 단계 키(없으면 None)."""
    if stage == WATCH_ACCUM:
        return 'PROMOTED' if current_stage in (BREAKOUT, WAIT_PULLBACK, SUPPORT_CONFIRMED) else 'CONDITION_LOST'
    for e in trace['episodes']:
        if _date(df, e['b']) == since:
            if e['outcome'] is None:
                return 'PROMOTED' if stage == BREAKOUT else None   # 아직 같은 에피소드 진행 중
            if e['outcome'] == 'SUPPORT_CONFIRMED':
                return 'PROMOTED' if stage != SUPPORT_CONFIRMED else 'SIGNAL_DONE'
            return e['outcome']                                      # SUPPORT_FAILED / EXPIRED / REPLACED
    return 'CONDITION_LOST'


def close_ended(conn, scan_date, current, frames):
    """오늘 보이지 않는(또는 다른 단계로 바뀐) 열린 행을 닫는다.
    current: {code: (stage, stage_since)} 오늘의 단계. frames: {code: (df, trace)} 열린 행이 있던 종목의 재계산 결과."""
    closed = 0
    rows = conn.execute('SELECT code, stage, stage_since FROM gongpasan_stage_log WHERE ended_date IS NULL').fetchall()
    for code, stage, since in rows:
        cur = current.get(code)
        if cur and cur == (stage, since):
            continue
        frame = frames.get(code)
        if frame is None:
            reason = 'CONDITION_LOST'
        else:
            reason = _reason_for(stage, since, frame[0], frame[1], cur[0] if cur else None)
            if reason is None:
                continue
        conn.execute('UPDATE gongpasan_stage_log SET ended_date=?, end_reason=? WHERE code=? AND stage=? AND stage_since=?',
                     (scan_date, reason, code, stage, since))
        closed += 1
    return closed
