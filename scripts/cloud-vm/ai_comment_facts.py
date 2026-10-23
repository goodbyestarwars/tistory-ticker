# -*- coding: utf-8 -*-
"""AI 시장 코멘트의 1~2단계: 실제 수집 데이터 -> 정량 분석 -> '사실 객체'(2026-10-23).

AI(Groq)에게는 이 모듈이 계산한 사실 객체만 건넨다. AI가 가격·지표·시그널 계산을 바꾸지 못하고,
코멘트에 쓸 수 있는 숫자도 여기서 정한다(numbers). 이 모듈은 DB·네트워크에 접근하지 않는 순수 함수다.

사실 객체(slot facts)
    slot      카드 식별자(예: program, deposits)
    group     brief | intraday | funds | macro  - 생성 주기가 같은 묶음(묶음당 Groq 요청 1회)
    label     화면에 보이는 이름
    asof      코멘트가 근거로 삼은 데이터 기준일(YYYY-MM-DD). 휴장·미수신이면 마지막 실제 자료의 날짜.
    state     시장 상태 한 단어(up/down/flat, buy/sell 등). 저장된 코멘트와 현재 상태가 다르면 조회 API가 코멘트를 숨긴다.
    sig       재생성 서명. 이 값이 바뀔 때만 다시 만든다(같은 상태에서는 몇 번을 새로 고쳐도 같은 코멘트).
    numbers   코멘트에 인용해도 되는 숫자(검증기가 이 값 밖의 숫자를 막는다). 장중에 계속 변하는 값은 일부러 넣지 않는다.
    context   해석에만 쓰는 사실(숫자 인용 금지, 방향·강도·추세 태그 포함)
    flags     big(큰 변동 표현 허용) / streak(연속 표현 허용) / extreme(고점·저점 표현 허용) / intraday(장중 잠정치)
    related   함께 해석해도 되는 다른 slot(관련성이 확인된 쌍만)
    avoid     이 카드에서 하면 안 되는 해석(금융적 단정 방지)
    angles    이 데이터가 실제로 뒷받침하는 관점 후보(날마다 다른 관점으로 쓰게 하기 위함)

정량 분석 항목: 전일 대비, 5거래일 변화, 20거래일 추세, 평균 대비 강도, 연속 상승·하락 일수, 매수·매도 우위,
위험 신호, 관련 지표 간 방향 일치 여부.
"""
import hashlib
import json
import math
import re
from datetime import datetime

# ---- 공통 헬퍼 --------------------------------------------------------------------------------------

GROUP_SLOTS = {
    'brief': ('spx', 'nas', 'dji', 'sox', 'vix', 'night', 'brief_summary'),
    'intraday': ('kospi_volume', 'kosdaq_volume', 'breadth', 'foreign', 'institution', 'individual',
                 'program', 'putcall', 'market_summary'),
    'funds': ('credit', 'deposits'),
    'macro': ('rate', 'fx', 'oil', 'gold', 'btc'),
}
SLOT_GROUP = {s: g for g, slots in GROUP_SLOTS.items() for s in slots}

LABELS = {
    'spx': 'S&P 500', 'nas': '나스닥 종합', 'dji': '다우존스', 'sox': '필라델피아 반도체(SOX)', 'vix': 'VIX(변동성지수)',
    'night': '코스피200 야간선물', 'brief_summary': '07:00 시장 브리핑 요약',
    'kospi_volume': '코스피 거래량', 'kosdaq_volume': '코스닥 거래량', 'breadth': '상승·하락 종목 수',
    'foreign': '외국인 순매매(코스피+코스닥)', 'institution': '기관 순매매(코스피+코스닥)',
    'individual': '개인 순매매(코스피+코스닥)', 'program': '코스피 프로그램매매(차익+비차익)',
    'putcall': '코스피200 옵션 풋/콜 거래량', 'market_summary': '장중 시장 한줄 요약',
    'credit': '빚투(신용융자 잔고)', 'deposits': '고객예탁금',
    'rate': '미국 국채 금리(10년·30년)', 'fx': '원/달러 환율', 'oil': '원유(WTI·브렌트)', 'gold': '금 선물',
    'btc': '비트코인',
}
# 카드에서 코멘트와 짝을 이루는 서로 다른 지표를 함께 말해도 되는 쌍(관련성이 확인된 것만)
RELATED = {
    'foreign': ('institution', 'individual', 'program'), 'institution': ('foreign', 'individual', 'program'),
    'individual': ('foreign', 'institution'), 'program': ('foreign', 'institution'),
    'kospi_volume': ('kosdaq_volume', 'breadth'), 'kosdaq_volume': ('kospi_volume', 'breadth'),
    'breadth': ('kospi_volume', 'kosdaq_volume'),
    'credit': ('deposits',), 'deposits': ('credit',),
}
# 금융적 단정을 막기 위해 카드마다 AI에게 알려 주는 금지 해석(검증기에도 같은 취지의 정규식이 있다)
AVOID = {
    'spx': ['지수 한 번 움직였다고 다음 날 방향을 단정하지 않는다'],
    'nas': ['지수 한 번 움직였다고 다음 날 방향을 단정하지 않는다'],
    'dji': ['지수 한 번 움직였다고 다음 날 방향을 단정하지 않는다'],
    'sox': ['반도체지수가 올랐다고 특정 종목·업종 수혜를 단정하지 않는다'],
    'vix': ['VIX가 올랐다고 폭락·위기를 예고하지 않는다(불안 심리가 커졌다 정도까지만)'],
    'night': ['야간선물만으로 오늘 장 방향을 단정하지 않는다'],
    'kospi_volume': ['거래량이 늘었다고 매수세가 들어왔다고 단정하지 않는다(방향은 따로)', '장중 거래량은 마감 전 누적치이므로 많고 적음을 단정하지 않는다'],
    'kosdaq_volume': ['거래량이 늘었다고 매수세가 들어왔다고 단정하지 않는다(방향은 따로)', '장중 거래량은 마감 전 누적치이므로 많고 적음을 단정하지 않는다'],
    'breadth': ['종목 수 비중만으로 지수 방향이나 내일을 단정하지 않는다'],
    'foreign': ['외국인 순매도만으로 지수 하락을 확정하지 않는다', '순매매의 원인을 지어내지 않는다'],
    'institution': ['순매매의 원인을 지어내지 않는다', '기관 순매도만으로 하락을 확정하지 않는다'],
    'individual': ['개인 순매매만으로 시장 방향을 단정하지 않는다'],
    'program': ['프로그램 순매도만으로 하락을 확정하지 않는다', '프로그램 매매의 원인을 지어내지 않는다'],
    'putcall': ['풋 거래량이 많다고 투자자 전체가 하락에 베팅한다고 말하지 않는다(헤지·차익 등 이유가 섞인다)', '집계는 최근월물 상위 100행 합계이며 시장 전체가 아니다'],
    'credit': ['신용융자 증가를 곧바로 폭락 신호로 단정하지 않는다(과열 가능성 정도까지)', '예탁금과 신용이 엇갈리면 서로 다른 의미로 구분해서 말한다'],
    'deposits': ['예탁금이 줄었다고 시장 자금이 마르거나 빠져나간다고 단정하지 않는다', '예탁금과 신용이 엇갈리면 서로 다른 의미로 구분해서 말한다'],
    'rate': ['금리가 올랐다고 주식에서 채권으로 돈이 옮겨간다고 단정하지 않는다', '금리가 크게 움직인 원인(연준·물가·경기 등)을 지어내지 않는다', '금리 하락을 증시 호재로만 단정하지 않는다'],
    'fx': ['원화 강세/약세를 달러 투자 수익이나 손해로 연결하지 않는다', '환율이 움직인 원인을 지어내지 않는다'],
    'oil': ['유가가 움직인 원인(전쟁·감산 등)을 지어내지 않는다'],
    'gold': ['금값이 움직인 원인을 지어내지 않는다'],
    'btc': ['코인 가격이 움직인 원인을 지어내지 않는다'],
    'brief_summary': ['개별 지표에 없는 원인·사건을 지어내지 않는다', '시초가 방향을 확정적으로 예언하지 않는다(가능성·분위기 수준)'],
    'market_summary': ['개별 지표에 없는 원인·사건을 지어내지 않는다', '오늘 마감 방향을 단정하지 않는다'],
}
# (flat 경계 %, big 경계 %) - 등락률 하나를 방향·강도 단계로 바꿀 때 쓴다
PCT_BANDS = {
    'spx': (0.3, 1.0), 'nas': (0.3, 1.0), 'dji': (0.3, 1.0), 'sox': (0.3, 3.0), 'vix': (0.3, 5.0), 'night': (0.3, 0.5),
    'fx': (0.15, 0.6), 'oil': (0.3, 2.0), 'gold': (0.3, 2.0), 'btc': (0.3, 2.0), 'index': (0.3, 1.5),
}


def num(value):
    """유한한 실수만 통과(bool·NaN·문자열 숫자 제외하지 않고 변환 시도)."""
    if isinstance(value, bool) or value is None:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) else None


def rnd(value, digits=1):
    value = num(value)
    return None if value is None else round(value, digits)


def js_round(x):
    """JS Math.round(반올림 .5는 위로) - 프런트 rateStats_ 와 같은 값을 내기 위해."""
    return int(math.floor(x + 0.5))


def iso_date(value, anchor=None):
    """'YYYYMMDD'/'YYYY-MM-DD'/'YYYY.MM.DD' -> 'YYYY-MM-DD'. 'MM.DD'는 anchor(기준일)의 같은 해(미래면 전년)로."""
    text = str(value or '').strip()
    m = re.match(r'^(\d{4})[-./]?(\d{2})[-./]?(\d{2})', text)
    if m:
        out = '%s-%s-%s' % m.groups()
    else:
        s = re.match(r'^(\d{2})[./](\d{2})$', text)
        a = re.match(r'^(\d{4})-(\d{2})-(\d{2})', str(anchor or ''))
        if not s or not a:
            return None
        year = int(a.group(1))
        if s.group(1) + s.group(2) > a.group(2) + a.group(3):
            year -= 1
        out = '%04d-%s-%s' % (year, s.group(1), s.group(2))
    try:
        datetime.strptime(out, '%Y-%m-%d')
    except ValueError:
        return None
    return out


def points_from(rows, date_key='date', value_key='close', anchor=None, positive=False):
    """행 목록 -> [(YYYY-MM-DD, 값)] 날짜 오름차순·중복 날짜는 마지막 값."""
    by = {}
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        d = iso_date(row.get(date_key), anchor)
        v = num(row.get(value_key))
        if d and v is not None and (not positive or v > 0):
            by[d] = v
    return [(d, by[d]) for d in sorted(by)]


def pct_change(new, old):
    new, old = num(new), num(old)
    if new is None or old is None or old == 0:
        return None
    return (new / old - 1) * 100


def streak_of(values):
    """끝에서부터 같은 방향으로 이어진 변화 횟수. 오르면 +n, 내리면 -n, 보합/데이터 부족이면 0."""
    if len(values) < 2:
        return 0
    last = values[-1] - values[-2]
    if last == 0:
        return 0
    sign = 1 if last > 0 else -1
    n = 0
    for i in range(len(values) - 1, 0, -1):
        d = values[i] - values[i - 1]
        if d * sign > 0:
            n += 1
        else:
            break
    return sign * n


def series_stats(points):
    """[(date, value)] -> 전일 대비·5/20 기록 변화·20기록 평균 대비·연속·고저점·60기록 내 위치."""
    vals = [v for _, v in points]
    n = len(vals)
    if n == 0:
        return None
    out = {'n': n, 'date': points[-1][0], 'last': vals[-1], 'prev': vals[-2] if n > 1 else None,
           'prev_date': points[-2][0] if n > 1 else None}
    out['chg_pct'] = pct_change(vals[-1], vals[-2]) if n > 1 else None
    out['chg_abs'] = vals[-1] - vals[-2] if n > 1 else None
    out['chg5_pct'] = pct_change(vals[-1], vals[-6]) if n > 5 else None
    out['chg20_pct'] = pct_change(vals[-1], vals[-21]) if n > 20 else None
    if n > 20:
        mean = sum(vals[-21:-1]) / 20
        out['mean20'] = mean
        out['vs_mean20_pct'] = pct_change(vals[-1], mean)
    else:
        out['mean20'] = out['vs_mean20_pct'] = None
    out['streak'] = streak_of(vals)
    out['high20'] = n >= 20 and vals[-1] >= max(vals[-20:])
    out['low20'] = n >= 20 and vals[-1] <= min(vals[-20:])
    win = vals[-60:]
    out['rank60'] = sum(1 for v in win if v <= vals[-1]) / len(win) if len(win) >= 20 else None
    return out


def band_tier(pct, kind='index'):
    """등락률 -> flat/upMild/upBig/downMild/downBig."""
    pct = num(pct)
    if pct is None:
        return None
    flat, big = PCT_BANDS.get(kind, PCT_BANDS['index'])
    a = abs(pct)
    if a < flat:
        return 'flat'
    return ('up' if pct > 0 else 'down') + ('Big' if a >= big else 'Mild')


def tier_state(tier):
    return 'flat' if tier in (None, 'flat') else 'up' if tier.startswith('up') else 'down'


def signature(*parts):
    return '|'.join(str(p) for p in parts)


def facts_hash(slot_facts):
    """같은 사실이면 같은 지문. 수치는 코멘트에 영향을 주는 정밀도로만 반올림해 비교한다."""
    def clean(v):
        if isinstance(v, float):
            return round(v, 3)
        if isinstance(v, dict):
            return {k: clean(x) for k, x in sorted(v.items())}
        if isinstance(v, (list, tuple)):
            return [clean(x) for x in v]
        return v
    body = {k: clean(slot_facts.get(k)) for k in ('slot', 'asof', 'state', 'sig', 'numbers', 'context', 'flags')}
    return hashlib.sha1(json.dumps(body, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest()[:16]


def make_slot(slot, asof, state, sig, numbers=None, context=None, flags=None, angles=None, extra_avoid=None, related=None):
    """사실 객체 하나. numbers 는 None 값을 거른다."""
    nums = {k: v for k, v in (numbers or {}).items() if num(v) is not None}
    fl = {'big': False, 'streak': False, 'extreme': False, 'intraday': False}
    fl.update(flags or {})
    out = {'slot': slot, 'group': SLOT_GROUP[slot], 'label': LABELS[slot], 'asof': asof, 'state': state, 'sig': sig,
           'numbers': nums, 'context': context or {}, 'flags': fl,
           'related': list(RELATED.get(slot, ()) if related is None else related),
           'avoid': list(AVOID.get(slot, ())) + list(extra_avoid or ()), 'angles': list(angles or ())}
    out['hash'] = facts_hash(out)
    return out


def _clean_ctx(d):
    return {k: v for k, v in d.items() if v is not None}


def _streak_flags(streak, minimum=3):
    return abs(streak or 0) >= minimum


def _angles(*pairs):
    """(관점, 조건) 중 조건이 참인 관점만 순서대로."""
    return [a for a, ok in pairs if ok]


# ---- 1. 07:00 브리핑 묶음 ------------------------------------------------------------------------------

BRIEF_CHART_SYMBOL = {'spx': 'SP500_INDEX', 'nas': 'NASDAQ_INDEX', 'dji': 'DOW_INDEX', 'sox': 'SOX', 'vix': 'VIX'}


def _chart_upto(macro, symbol, last_ymd):
    row = (macro or {}).get(symbol) or {}
    pts = points_from(row.get('chart'), positive=True)
    iso = iso_date(last_ymd)
    return [p for p in pts if iso is None or p[0] <= iso]


def brief_facts(snapshot, macro):
    """확정된 07:00 브리핑 스냅샷(+그 날짜까지의 일봉 맥락) -> 사실 객체. 스냅샷이 없으면 {}."""
    if not snapshot or not snapshot.get('inputs'):
        return {}
    target = snapshot.get('targetDate')
    inputs = snapshot['inputs']
    out = {}
    tiers = {}
    for key, symbol in BRIEF_CHART_SYMBOL.items():
        inp = inputs.get(key)
        pct = num(inp and inp.get('pct'))
        if pct is None:
            continue
        stats = series_stats(_chart_upto(macro, symbol, inp.get('date')))
        tier = band_tier(pct, key)
        tiers[key] = tier
        s5 = rnd(stats and stats['chg5_pct'], 1)
        s20 = rnd(stats and stats['chg20_pct'], 1)
        streak = (stats or {}).get('streak', 0)
        extreme = bool(stats and (stats['high20'] or stats['low20']))
        numbers = {'change_pct': rnd(pct, 2), 'close': rnd(inp.get('close'), 2)}
        if _streak_flags(streak):
            numbers['streak_days'] = abs(streak)
        if s5 is not None:
            numbers['change5_pct'] = s5
        if s20 is not None:
            numbers['change20_pct'] = s20
        ctx = _clean_ctx({
            'us_session_date': iso_date(inp.get('date')), 'tier': tier, 'prev_close': rnd(inp.get('prevClose'), 2),
            'above_20d_avg_pct': rnd(stats and stats['vs_mean20_pct'], 1),
            'is_20d_high': True if stats and stats['high20'] else None, 'is_20d_low': True if stats and stats['low20'] else None,
            'meaning': {'vix': 'VIX 상승=시장 불안 심리 증가, 하락=완화(위기 예고 아님)',
                        'sox': '반도체지수. 코스피에서 반도체 비중이 커서 참고'}.get(key),
        })
        out[key] = make_slot(
            key, iso_date(inp.get('date')) or target, tier_state(tier), signature(target, key, rnd(pct, 2)),
            numbers, ctx, {'big': tier in ('upBig', 'downBig'), 'streak': _streak_flags(streak), 'extreme': extreme},
            _angles(('오늘 움직임의 크기', True), ('최근 5일 흐름', s5 is not None), ('20일 추세 속 위치', s20 is not None),
                    ('연속 흐름', _streak_flags(streak)), ('다른 미국 지표와의 일치/엇갈림', True)))
    night = snapshot.get('night') or {}
    if night.get('included') and num(night.get('gapPct')) is not None:
        gap = num(night['gapPct'])
        tier = band_tier(gap, 'night')
        tiers['night'] = tier
        out['night'] = make_slot(
            'night', iso_date(night.get('sessionDate')) or target, tier_state(tier), signature(target, 'night', rnd(gap, 2)),
            {'gap_pct': rnd(gap, 2), 'night_close': rnd(night.get('close'), 2), 'day_close': rnd(night.get('dayClose'), 2)},
            {'tier': tier, 'session': '전 거래일 저녁~오늘 05:00 야간 세션, 주간 종가 대비', 'status': '최종 마감'},
            {'big': tier in ('upBig', 'downBig')}, ['주간 종가 대비 위치', '미국 지표와의 일치/엇갈림'])
    sig = snapshot.get('signal') or {}
    bucket = sig.get('bucket') or {}
    if bucket:
        us3 = [inputs.get(k, {}).get('pct') for k in ('spx', 'nas', 'dji')]
        us3 = [num(v) for v in us3 if num(v) is not None]
        agree = ('3대 지수 모두 상승' if us3 and all(v > 0 for v in us3) else '3대 지수 모두 하락' if us3 and all(v < 0 for v in us3)
                 else '3대 지수 엇갈림') if len(us3) == 3 else None
        fx = inputs.get('fx')
        ctx = _clean_ctx({
            'signal': bucket.get('label'), 'tone': sig.get('tone'), 'us_three_indices': agree,
            'sox': tiers.get('sox'), 'vix': tiers.get('vix'), 'night': tiers.get('night') or '반영 없음',
            'usdkrw': ('원화 약세(환율 상승)' if num(fx and fx.get('pct')) and fx['pct'] > 0.15 else '원화 강세(환율 하락)'
                       if num(fx and fx.get('pct')) and fx['pct'] < -0.15 else '환율 보합') if fx else None,
            'history_note': bucket.get('gap'),
        })
        out['brief_summary'] = make_slot(
            'brief_summary', target, sig.get('tone') or 'flat', signature(target, bucket.get('key'), tiers.get('night'), agree),
            {}, ctx, {'big': 'strong' in str(bucket.get('key', '')).lower()},
            ['미국 마감 분위기', '반도체·VIX의 결', '야간선물과의 일치/엇갈림'],
            related=['spx', 'nas', 'dji', 'sox', 'vix', 'night'])
    return out


# ---- 2. 장중(국내) 묶음 ---------------------------------------------------------------------------------

VOLUME_TIERS = ((50, '극도로 낮음', 'low'), (80, '낮음', 'low'), (120, '평소 수준', 'normal'), (180, '높음', 'high'))


def _volume_tier(ratio):
    for limit, name, cls in VOLUME_TIERS:
        if ratio < limit:
            return name, cls
    return '극도로 높음', 'high'


def _kst_today(now):
    return now.strftime('%Y-%m-%d')


def _intraday_open(now, data_date):
    """데이터 기준일이 오늘이고 아직 15:40 전이면 마감 전 잠정치."""
    return data_date == _kst_today(now) and now.hour * 60 + now.minute < 15 * 60 + 40


def volume_facts(domestic, now):
    out = {}
    indices = (domestic or {}).get('indices') or {}
    for market, slot in (('KOSPI', 'kospi_volume'), ('KOSDAQ', 'kosdaq_volume')):
        item = indices.get(market) or {}
        rows = ((item.get('intervals') or {}).get('day') or {}).get('rows') or []
        vol = points_from(rows, value_key='volume', positive=True)
        close = points_from(rows, value_key='close', positive=True)
        if len(vol) < 21:
            continue
        date = vol[-1][0]
        avg = sum(v for _, v in vol[-21:-1]) / 20
        ratio = vol[-1][1] / avg * 100
        intraday = _intraday_open(now, date)
        name, cls = _volume_tier(ratio)
        idx_pct = pct_change(close[-1][1], close[-2][1]) if len(close) > 1 and close[-1][0] == date else None
        q = item.get('quote') or {}
        if q.get('change_rate') is not None and num(q.get('change_rate')) is not None and intraday:
            idx_pct = num(q['change_rate'])
        idx_tier = band_tier(idx_pct, 'index')
        # 최근 5거래일 거래량 흐름(마감 확정 기록끼리): 오늘 값이 잠정이면 빼고 비교
        confirmed = vol[:-1] if intraday else vol
        trend = None
        if len(confirmed) >= 25:
            last5 = sum(v for _, v in confirmed[-5:]) / 5
            prior20 = sum(v for _, v in confirmed[-25:-5]) / 20
            trend = rnd(pct_change(last5, prior20), 0)
        state = 'partial' if intraday else cls
        ctx = _clean_ctx({
            'phase': '장중 잠정 누적(마감 전이라 평소보다 낮아 보이는 게 정상)' if intraday else '마감 확정',
            'ratio_vs_20d_avg_pct': rnd(ratio, 0) if not intraday else None,
            'volume_status': name if not intraday else None,
            'index_change_tier': idx_tier, 'index_change_pct': rnd(idx_pct, 2),
            'confirmed_5d_vs_prior20d_avg_pct': trend,
        })
        numbers = {} if intraday else {'ratio_vs_20d_avg_pct': rnd(ratio, 0)}
        out[slot] = make_slot(
            slot, date, state, signature(date, state, tier_state(idx_tier), 'tr' if trend and trend >= 15 else 'tf' if trend and trend <= -15 else 'tn'),
            numbers, ctx, {'intraday': intraday, 'big': (not intraday) and (ratio < 50 or ratio >= 180)},
            _angles(('지수 방향과 거래량의 조합', idx_tier is not None), ('최근 5일 거래량 흐름', trend is not None),
                    ('평균 대비 강도', not intraday)))
    return out


def breadth_facts(market_temp):
    b = ((market_temp or {}).get('marketBreadth') or {}).get('total')
    if not isinstance(b, dict):
        return {}
    up, down, total = num(b.get('up')), num(b.get('down')), num(b.get('total'))
    if up is None or down is None or not total or up + down > total:
        return {}
    flat = num(b.get('flat'))
    asof = iso_date((market_temp.get('marketBreadth') or {}).get('asOf')) or iso_date(market_temp.get('date')) or iso_date(market_temp.get('updatedAt'))
    state = 'down' if down > up * 1.5 else 'up' if up > down * 1.5 else 'mixed'
    up_share = up / total * 100
    ctx = {'up_count': int(up), 'down_count': int(down), 'flat_count': int(flat) if flat is not None else None,
           'total': int(total), 'up_share_pct': rnd(up_share, 0), 'down_share_pct': rnd(down / total * 100, 0),
           'scope': '코스피+코스닥 전체'}
    return {'breadth': make_slot(
        'breadth', asof, state, signature(asof, state, int(up_share // 10)), {}, _clean_ctx(ctx),
        {'intraday': True, 'big': state != 'mixed' and max(up, down) > 3 * min(up, down) + 1},
        ['상승·하락 비중의 쏠림', '지수 방향과의 일치/엇갈림'])}


def investor_daily(domestic, field):
    """코스피+코스닥 일별 순매수 합(억원). 두 시장 날짜가 맞는 날만(프런트와 같은 규칙). 없으면 [] ."""
    investor = (domestic or {}).get('investor') or {}
    per = {}
    for market in ('KOSPI', 'KOSDAQ'):
        data = investor.get(market) or {}
        m = {}
        for r in data.get('rows') or []:
            d = iso_date(r.get('date') or r.get('label'), data.get('asOf'))
            v = num(r.get(field))
            if d and v is not None:
                m[d] = v
        per[market] = m
    if per['KOSPI'] and per['KOSDAQ']:
        return [(d, per['KOSPI'][d] + per['KOSDAQ'][d]) for d in sorted(per['KOSPI']) if d in per['KOSDAQ']]
    which = per['KOSPI'] or per['KOSDAQ']
    return [(d, which[d]) for d in sorted(which)]


def _eok_to_text(eok):
    a = abs(eok)
    return ('%.1f조' % (a / 10000)) if a >= 10000 else ('{:,}억'.format(int(round(a))))


def flow_facts(domestic, now):
    """외국인·기관·개인 순매수 흐름. 숫자 인용은 일수(연속·20일 중 N일)만 허용한다(장중 금액은 계속 변해서)."""
    out = {}
    for slot, field in (('foreign', 'foreign'), ('institution', 'institution'), ('individual', 'individual')):
        pts = investor_daily(domestic, field)
        if len(pts) < 5:
            continue
        date = pts[-1][0]
        vals = [v for _, v in pts]
        intraday = _intraday_open(now, date)
        latest = vals[-1]
        confirmed = vals[:-1] if intraday else vals
        win20 = confirmed[-20:]
        avg_abs0 = sum(abs(v) for v in win20) / len(win20) if win20 else None
        # 0 근처에서 부호가 왔다 갔다 하는 것은 방향 전환으로 보지 않는다(평소 크기의 10% 미만이면 보합)
        sign = 'flat' if latest == 0 or (avg_abs0 and abs(latest) < avg_abs0 * 0.1) else 'buy' if latest > 0 else 'sell'
        buy_days = sum(1 for v in win20 if v > 0) if len(win20) >= 10 else None
        sell_days = sum(1 for v in win20 if v < 0) if len(win20) >= 10 else None
        cum5 = sum(confirmed[-5:]) if len(confirmed) >= 5 else None
        cum20 = sum(win20) if len(win20) >= 20 else None
        # 연속 매수/매도 일수는 확정 기록 기준(오늘 잠정치는 장중에 부호가 바뀔 수 있어 포함하지 않는다)
        s = 0
        if confirmed:
            last_sign = 1 if confirmed[-1] > 0 else -1 if confirmed[-1] < 0 else 0
            for v in reversed(confirmed):
                if last_sign and (v > 0) == (last_sign > 0) and v != 0:
                    s += 1
                else:
                    break
            s *= last_sign
        avg_abs = sum(abs(v) for v in win20) / len(win20) if win20 else None
        ratio = abs(latest) / avg_abs if avg_abs else None
        ratio_bucket = 'x' if ratio is None else 'big' if ratio >= 1.5 else 'small' if ratio < 0.5 else 'norm'
        # 최근 확정 흐름과 오늘 방향의 관계(전환 여부)
        prev_sign = (1 if confirmed[-1] > 0 else -1 if confirmed[-1] < 0 else 0) if confirmed else 0
        turned = bool(intraday and prev_sign and latest and (latest > 0) != (prev_sign > 0)) or bool(
            (not intraday) and len(vals) > 1 and vals[-2] and latest and (latest > 0) != (vals[-2] > 0))
        numbers = {}
        if abs(s) >= 2:
            numbers['streak_days'] = abs(s)
        if buy_days is not None:
            numbers['buy_days_of_20'] = buy_days
            numbers['sell_days_of_20'] = sell_days
        ctx = _clean_ctx({
            'today_direction': {'buy': '순매수', 'sell': '순매도', 'flat': '보합'}[sign],
            'today_note': '장중 잠정(계속 변함)' if intraday else '마감 확정',
            'today_vs_20d_avg_size': {'big': '평소보다 큼', 'small': '평소보다 작음', 'norm': '평소 수준', 'x': None}[ratio_bucket],
            'prior_streak': ('매수 우위 %d일 연속' % s) if s >= 2 else ('매도 우위 %d일 연속' % -s) if s <= -2 else None,
            'cum5_direction': None if cum5 is None else '순매수' if cum5 > 0 else '순매도' if cum5 < 0 else '보합',
            'cum20_direction': None if cum20 is None else '순매수' if cum20 > 0 else '순매도' if cum20 < 0 else '보합',
            'cum20_size': _eok_to_text(cum20) if cum20 is not None else None,
            'turned_from_prior_day': True if turned else None,
        })
        out[slot] = make_slot(
            slot, date, sign, signature(date, sign, 'sk%d' % min(abs(s), 4), ratio_bucket, 'T' if turned else ''),
            numbers, ctx, {'intraday': intraday, 'streak': abs(s) >= 3, 'big': ratio_bucket == 'big'},
            _angles(('오늘 방향', True), ('직전 흐름에서 이어졌는지/바뀌었는지', turned or abs(s) >= 2), ('5일·20일 누적 방향', cum5 is not None),
                    ('평소 대비 규모', ratio is not None)))
    return out


def program_cumulative(pt, live):
    """프로그램매매 20거래일 누적(프런트 programCumulative_ 와 같은 규칙, 금액 단위 백만원)."""
    by = {}
    for r in pt.get('history') or []:
        a, n, d = num(r.get('arbitrage')), num(r.get('nonArbitrage')), iso_date(r.get('date'))
        if d and a is not None and n is not None:
            by[d] = (a, n)
    a, n, d = num(pt.get('arbitrage')), num(pt.get('nonArbitrage')), iso_date(pt.get('date'))
    if d and a is not None and n is not None:
        by[d] = (a, n)
    allrows = [(d, by[d][0], by[d][1]) for d in sorted(by)]
    rows = [r for r in allrows if r[0] != iso_date(pt.get('date'))] if live else allrows
    use = rows[-20:]
    for i in range(len(use) - 1, 0, -1):
        if (datetime.strptime(use[i][0], '%Y-%m-%d') - datetime.strptime(use[i - 1][0], '%Y-%m-%d')).days > 10:
            use = use[i:]
            break
    totals = [r[1] + r[2] for r in use]
    return {'all': allrows, 'n': len(use), 'totals': totals, 'complete': len(use) >= 20,
            'cum20': sum(totals), 'sell': sum(1 for v in totals if v < 0), 'buy': sum(1 for v in totals if v > 0),
            'cum5': sum(totals[-5:]) if len(use) >= 5 else None,
            'avg_abs_non': sum(abs(r[2]) for r in use) / len(use) if use else 0, 'streak': streak_sign(totals)}


def streak_sign(totals):
    """끝에서부터 같은 부호가 이어진 일수(매수 +n / 매도 -n)."""
    if not totals or totals[-1] == 0:
        return 0
    sign = 1 if totals[-1] > 0 else -1
    n = 0
    for v in reversed(totals):
        if v * sign > 0:
            n += 1
        else:
            break
    return sign * n


def program_facts(domestic, now):
    pt = (domestic or {}).get('programTrading') or {}
    if pt.get('available') is not True or num(pt.get('nonArbitrage')) is None or num(pt.get('arbitrage')) is None or not pt.get('date'):
        return {}
    date = iso_date(pt['date'])
    live = _intraday_open(now, date)
    c = program_cumulative(pt, live)
    if not c['complete']:
        return {}
    today = num(pt['arbitrage']) + num(pt['nonArbitrage'])
    today_sign = 'buy' if today > 0 else 'sell' if today < 0 else 'flat'
    trend = 'sell' if c['cum20'] < 0 and c['sell'] > c['buy'] else 'buy' if c['cum20'] > 0 and c['buy'] > c['sell'] else 'mixed'
    cum5_dir = None if c['cum5'] is None else 'buy' if c['cum5'] > 0 else 'sell' if c['cum5'] < 0 else 'flat'
    avg = c['avg_abs_non']
    surge = bool(avg and abs(num(pt['nonArbitrage'])) >= avg * 2)
    turned5 = bool((cum5_dir == 'buy' and trend == 'sell') or (cum5_dir == 'sell' and trend == 'buy'))
    numbers = {'sell_days_of_20': c['sell'], 'buy_days_of_20': c['buy'], 'window_days': 20}
    if abs(c['streak']) >= 2:
        numbers['streak_days'] = abs(c['streak'])
    ctx = _clean_ctx({
        'trend_20d': {'sell': '20일 매도 우세', 'buy': '20일 매수 우세', 'mixed': '20일 수급 엇갈림'}[trend],
        'cum20_direction': '순매도' if c['cum20'] < 0 else '순매수', 'cum20_size': _eok_to_text(c['cum20'] / 100),
        'cum5_direction': {'buy': '순매수', 'sell': '순매도', 'flat': '보합', None: None}[cum5_dir],
        'turned_in_last_5d': True if turned5 else None,
        'today_direction': {'buy': '순매수', 'sell': '순매도', 'flat': '보합'}[today_sign],
        'today_note': '장중 잠정(누적에서는 제외)' if live else '마감 확정',
        'today_non_arbitrage_surge_vs_20d_avg': True if surge else None,
        'basis': '코스피 차익+비차익 일별 순매수',
    })
    return {'program': make_slot(
        'program', date, today_sign, signature(date, trend, cum5_dir, 'S' if surge else '', today_sign, 'sk%d' % min(abs(c['streak']), 6) if abs(c['streak']) >= 3 else ''),
        numbers, ctx, {'intraday': live, 'streak': abs(c['streak']) >= 3 or c['sell'] >= 14 or c['buy'] >= 14, 'big': surge},
        _angles(('20일 누적 추세', True), ('최근 5일의 전환 여부', cum5_dir is not None), ('오늘 비차익 규모', surge),
                ('외국인·기관 수급과의 일치/엇갈림', True)))}


def putcall_facts(option_flow, now):
    c, p = (option_flow or {}).get('CALL'), (option_flow or {}).get('PUT')
    if not c or not p:
        return {}
    cv, pv = num(c.get('volume')), num(p.get('volume'))
    if cv is None or pv is None or cv <= 0:
        return {}
    at = str(c.get('updated_at') or '')
    try:
        stamp = datetime.fromisoformat(at.replace('Z', '+00:00'))
        stamp_kst = stamp.astimezone(now.tzinfo) if now.tzinfo else stamp
    except ValueError:
        return {}
    ratio = pv / cv
    state = 'put' if ratio >= 1 else 'call'
    bucket = 'lt0.8' if ratio < 0.8 else 'lt1' if ratio < 1 else 'lt1.2' if ratio < 1.2 else 'ge1.2'
    asof = stamp_kst.strftime('%Y-%m-%d')
    ctx = {'put_call_ratio_tier': {'lt0.8': '콜이 뚜렷이 우세', 'lt1': '콜이 약간 우세', 'lt1.2': '풋이 약간 우세', 'ge1.2': '풋이 뚜렷이 우세'}[bucket],
           'scope': '최근월물 상위 100행 합계(시장 전체 아님)', 'volume_based': True}
    return {'putcall': make_slot('putcall', asof, state, signature(asof, bucket), {}, ctx,
                                 {'intraday': True, 'big': ratio >= 1.2 or ratio < 0.8},
                                 ['풋·콜 거래량 균형', '쏠림의 정도'])}


def market_summary_facts(slots, now):
    """장중 한줄 요약: 개별 카드의 상태만 모아서 건넨다(새 수치를 만들지 않는다)."""
    if len(slots) < 3:
        return {}
    states = {k: v['state'] for k, v in slots.items()}
    ctx = {k: {'state': v['state'], **{ck: cv for ck, cv in v['context'].items() if ck in (
        'today_direction', 'trend_20d', 'phase', 'index_change_tier', 'put_call_ratio_tier', 'up_share_pct', 'down_share_pct')}}
           for k, v in slots.items()}
    asof = max(v['asof'] for v in slots.values() if v.get('asof'))
    foreign, inst, ind = states.get('foreign'), states.get('institution'), states.get('individual')
    flows = [s for s in (foreign, inst, ind) if s]
    ctx['flow_agreement'] = ('외국인·기관 같은 방향' if foreign and inst and foreign == inst and foreign != 'flat'
                             else '외국인·기관 엇갈림' if foreign and inst and foreign != inst else None)
    return {'market_summary': make_slot(
        'market_summary', asof, states.get('breadth') or 'mixed',
        signature(asof, *[states.get(k) for k in ('breadth', 'foreign', 'institution', 'individual', 'program', 'putcall', 'kospi_volume')]),
        {}, _clean_ctx(ctx), {'intraday': True}, ['수급 주체들의 방향 일치/엇갈림', '상승·하락 종목 폭', '거래량 분위기'],
        related=list(slots.keys()))}


def intraday_facts(domestic, market_temp, option_flow, now):
    out = {}
    out.update(volume_facts(domestic, now))
    out.update(breadth_facts(market_temp))
    out.update(flow_facts(domestic, now))
    out.update(program_facts(domestic, now))
    out.update(putcall_facts(option_flow, now))
    out.update(market_summary_facts(out, now))
    return out


# ---- 3. 빚투·예탁금(일별 확정) -----------------------------------------------------------------------------

def funds_facts(domestic, now):
    funds = (domestic or {}).get('funds') or {}
    if funds.get('available') is False or not funds.get('series'):
        return {}
    unit = {'hundred_million_krw': 1.0, 'million_krw': 0.01, 'krw': 1e-8}.get(funds.get('credit_unit'))
    unit_dep = {'hundred_million_krw': 1.0, 'million_krw': 0.01, 'krw': 1e-8}.get(funds.get('market_funds_unit'))
    if not unit or not unit_dep:
        return {}
    series = {}
    for slot, (key, field, factor) in {'credit': ('credit', 'loan_total', unit), 'deposits': ('market_funds', 'investor_deposits', unit_dep)}.items():
        rows = []
        for r in funds['series']:
            f = r.get(key)
            v = f if isinstance(f, (int, float)) and not isinstance(f, bool) else (f or {}).get(field) if isinstance(f, dict) else None
            d = (f.get('date') if isinstance(f, dict) else None) or r.get('date')
            v = num(v)
            if v is not None and v >= 0:
                rows.append({'date': d, 'v': v * factor})  # 억원 단위로 통일
        series[slot] = points_from(rows, value_key='v')
    out = {}
    stats = {slot: series_stats(pts) for slot, pts in series.items() if len(pts) >= 6}
    for slot, st in stats.items():
        tier = band_tier(st['chg_pct'], 'index') if st['chg_pct'] is not None else None
        flat = st['chg_pct'] is not None and abs(st['chg_pct']) < 0.1
        state = 'flat' if flat else 'up' if (st['chg_abs'] or 0) > 0 else 'down'
        level_jo = st['last'] / 10000
        numbers = {'level_jo': rnd(level_jo, 1), 'change_pct': rnd(st['chg_pct'], 2), 'change5_pct': rnd(st['chg5_pct'], 1),
                   'change20_pct': rnd(st['chg20_pct'], 1)}
        if abs(st['streak']) >= 3:
            numbers['streak_days'] = abs(st['streak'])
        big = st['chg_pct'] is not None and abs(st['chg_pct']) >= (1.5 if slot == 'deposits' else 1.0)
        ctx = _clean_ctx({
            'data_date': st['date'], 'unit_note': '억원 단위 원자료를 조원으로 환산',
            'vs_prev_record': {'up': '증가', 'down': '감소', 'flat': '거의 변화 없음'}[state],
            'position_in_60_records_pct': rnd(st['rank60'] * 100, 0) if st['rank60'] is not None else None,
            'is_20_record_high': True if st['high20'] else None, 'is_20_record_low': True if st['low20'] else None,
            'trend_5': None if st['chg5_pct'] is None else '증가' if st['chg5_pct'] > 0 else '감소' if st['chg5_pct'] < 0 else '보합',
            'trend_20': None if st['chg20_pct'] is None else '증가' if st['chg20_pct'] > 0 else '감소' if st['chg20_pct'] < 0 else '보합',
            'meaning': ('신용융자 잔고=빚내서 주식을 산 금액. 늘면 과열·레버리지 부담 가능성, 줄면 정리 가능성(둘 다 단정 아님)' if slot == 'credit'
                        else '고객예탁금=증권계좌에 대기 중인 투자자 예수금. 줄었다고 시장 자금이 빠져나갔다고 단정할 수 없음'),
        })
        out[slot] = make_slot(
            slot, st['date'], state, signature(st['date'], slot, state, 'B' if big else '', 'sk%d' % min(abs(st['streak']), 5) if abs(st['streak']) >= 3 else ''),
            numbers, ctx, {'big': big, 'streak': abs(st['streak']) >= 3, 'extreme': bool(st['high20'] or st['low20'])},
            _angles(('전일 대비 변화', True), ('최근 5·20기록 추세', st['chg5_pct'] is not None), ('최근 고점·저점권 여부', st['high20'] or st['low20']),
                    ('예탁금과 신용의 엇갈림/동행', len(stats) == 2)))
    if len(stats) == 2:
        c, d = out['credit'], out['deposits']
        pair = (d['state'], c['state'])
        label = {('down', 'up'): '예탁금 감소 + 신용 증가(엇갈림: 대기자금은 줄고 빚투는 늘어난 모습)',
                 ('up', 'down'): '예탁금 증가 + 신용 감소(엇갈림: 대기자금은 늘고 빚투는 정리되는 모습)',
                 ('up', 'up'): '예탁금·신용 동반 증가', ('down', 'down'): '예탁금·신용 동반 감소'}.get(pair, '한쪽 이상이 보합')
        for slot in ('credit', 'deposits'):
            out[slot]['context']['pair_reading'] = label
            out[slot]['sig'] += '|' + '%s-%s' % pair
            out[slot]['hash'] = facts_hash(out[slot])
    return out


# ---- 4. 금리·환율·원자재·가상자산 -------------------------------------------------------------------------

RATE_ABS_HIGH = {'US10Y': 4.5, 'US30Y': 5.0}


def _percentile(sorted_vals, q):
    return sorted_vals[min(len(sorted_vals) - 1, int(math.floor(len(sorted_vals) * q)))] if sorted_vals else None


def rate_stats(row, symbol, now):
    """프런트 rateStats_ 와 같은 계산(일봉 종가, 최근 120일 위치·일 변동 bp)."""
    pts = points_from((row or {}).get('chart'), positive=True)
    if not row or row.get('stale') is True or len(pts) < 6:
        return None
    last_date = datetime.strptime(pts[-1][0], '%Y-%m-%d').replace(tzinfo=now.tzinfo)
    if (now - last_date).total_seconds() > 7 * 86400 + 9 * 3600:
        return None
    closes = [v for _, v in pts[-120:]]
    y, prev = pts[-1][1], pts[-2][1]
    deltas = sorted(abs(js_round((closes[i] - closes[i - 1]) * 100)) for i in range(1, len(closes)))
    below = sum(1 for c in closes if c <= y + 1e-9)
    return {'y': y, 'date': pts[-1][0], 'bp': js_round((y - prev) * 100), 'bp5': js_round((y - pts[-6][1]) * 100),
            'pct': below / len(closes), 'n': len(closes), 'p90': max(3, _percentile(deltas, 0.9) or 0), 'streak': streak_of(closes),
            'symbol': symbol}


def rate_facts(macro, now):
    s10, s30 = rate_stats((macro or {}).get('US10Y'), 'US10Y', now), rate_stats((macro or {}).get('US30Y'), 'US30Y', now)
    lst = [s for s in (s10, s30) if s]
    if not lst or any(s['n'] < 20 for s in lst):
        return {}
    pct = sum(s['pct'] for s in lst) / len(lst)
    abs_high = bool((s10 and s10['y'] >= RATE_ABS_HIGH['US10Y']) or (s30 and s30['y'] >= RATE_ABS_HIGH['US30Y']))
    level = 'high' if pct >= 0.67 or (abs_high and pct >= 0.34) else 'low' if pct <= 0.33 and not abs_high else 'mid'
    m = sum(s['bp'] / s['p90'] for s in lst) / len(lst)
    move = 'Surge' if m >= 1 else 'Up' if m >= 0.4 else 'Plunge' if m <= -1 else 'Down' if m <= -0.4 else 'Flat'
    main = s10 or s30
    state = 'up' if move in ('Surge', 'Up') else 'down' if move in ('Plunge', 'Down') else 'flat'
    numbers = {}
    if s10:
        numbers.update({'us10y_pct': rnd(s10['y'], 2), 'us10y_bp': s10['bp'], 'us10y_5d_bp': s10['bp5']})
    if s30:
        numbers.update({'us30y_pct': rnd(s30['y'], 2), 'us30y_bp': s30['bp'], 'us30y_5d_bp': s30['bp5']})
    if s10 and s30:
        numbers['spread_30_10_bp'] = js_round((s30['y'] - s10['y']) * 100)
    ctx = _clean_ctx({
        'data_date': main['date'], 'basis': '미국 국채 일봉 종가(하루 1회 확정)',
        'level_vs_recent_120d': {'high': '최근 120일 중 높은 편', 'mid': '최근 120일 중 중간', 'low': '최근 120일 중 낮은 편'}[level],
        'daily_move': {'Surge': '급등', 'Up': '상승', 'Flat': '안정', 'Down': '하락', 'Plunge': '급락'}[move],
        'five_day_direction': '상승' if main['bp5'] > 0 else '하락' if main['bp5'] < 0 else '보합',
    })
    return {'rate': make_slot(
        'rate', main['date'], state, signature(main['date'], level, move), numbers, ctx,
        {'big': move in ('Surge', 'Plunge'), 'streak': abs(main['streak']) >= 3},
        _angles(('수준(높음/낮음)과 움직임의 조합', True), ('5거래일 흐름', True), ('장단기 금리 차이', bool(s10 and s30))))}


def fx_facts(macro, now):
    row = (macro or {}).get('USDKRW') or {}
    pts = points_from(row.get('chart'), positive=True)
    if len(pts) < 6 or row.get('stale') is True:
        return {}
    st = series_stats(pts)
    last_date = datetime.strptime(st['date'], '%Y-%m-%d').replace(tzinfo=now.tzinfo)
    if (now - last_date).total_seconds() > 7 * 86400 + 9 * 3600:
        return {}
    tier = band_tier(st['chg_pct'], 'fx')
    state = tier_state(tier)
    numbers = {'usdkrw': rnd(st['last'], 1), 'change_pct': rnd(st['chg_pct'], 2), 'change_won': rnd(st['chg_abs'], 1),
               'change5_pct': rnd(st['chg5_pct'], 1), 'change20_pct': rnd(st['chg20_pct'], 1)}
    if abs(st['streak']) >= 3:
        numbers['streak_days'] = abs(st['streak'])
    ctx = _clean_ctx({
        'data_date': st['date'], 'basis': '원/달러 일봉 종가', 'tier': tier,
        'meaning': '환율 상승=원화 약세(달러가 비싸짐), 하락=원화 강세. 투자 수익·손해와 연결하지 않는다',
        'position_in_60_records_pct': rnd(st['rank60'] * 100, 0) if st['rank60'] is not None else None,
        'is_20d_high': True if st['high20'] else None, 'is_20d_low': True if st['low20'] else None,
        'trend_20': None if st['chg20_pct'] is None else '상승' if st['chg20_pct'] > 0 else '하락' if st['chg20_pct'] < 0 else '보합',
    })
    return {'fx': make_slot(
        'fx', st['date'], state, signature(st['date'], tier), numbers, ctx,
        {'big': tier in ('upBig', 'downBig'), 'streak': abs(st['streak']) >= 3, 'extreme': bool(st['high20'] or st['low20'])},
        _angles(('전일 대비 움직임', True), ('5일 흐름', st['chg5_pct'] is not None), ('20일 추세 속 위치', st['chg20_pct'] is not None),
                ('연속 흐름', abs(st['streak']) >= 3)))}


def live_quote(row, now, max_age_h=36):
    """/futures 행에서 표시용 현재값을 읽는다(프런트 commodityStrip_ 규칙: stale·미수신·36시간 초과면 None)."""
    if not row or row.get('stale') is True:
        return None
    price, rate = num(row.get('price')), num(row.get('change_rate'))
    if price is None or price <= 0 or rate is None:
        return None
    try:
        at = datetime.fromisoformat(str(row.get('updated_at')).replace('Z', '+00:00'))
    except ValueError:
        return None
    if at.tzinfo is None:
        return None
    if (now - at).total_seconds() > max_age_h * 3600:
        return None
    return {'price': price, 'rate': rate, 'at': at.astimezone(now.tzinfo)}


def _commodity_slot(slot, symbols, macro, now, label_map):
    reads = {s: live_quote((macro or {}).get(s), now) for s in symbols}
    have = {s: r for s, r in reads.items() if r}
    if not have:
        return {}
    mean = sum(r['rate'] for r in have.values()) / len(have)
    tier = band_tier(mean, slot)
    date = max(r['at'] for r in have.values()).strftime('%Y-%m-%d')
    ctx = {'tier': tier, 'items': {}}
    streak = 0
    for s, r in have.items():
        pts = points_from(((macro or {}).get(s) or {}).get('chart'), positive=True)
        st = series_stats(pts) if len(pts) >= 6 else None
        item = {'change_vs_prev_close': band_tier(r['rate'], slot), 'name': label_map.get(s, s)}
        if st:
            item['five_day'] = '상승' if (st['chg5_pct'] or 0) > 0 else '하락' if (st['chg5_pct'] or 0) < 0 else '보합'
            if st['chg20_pct'] is not None:
                item['twenty_day'] = '상승' if st['chg20_pct'] > 0 else '하락' if st['chg20_pct'] < 0 else '보합'
            if abs(st['streak']) > abs(streak):
                streak = st['streak']
            if st['high20'] or st['low20']:
                item['at_20d_extreme'] = '20일 고점' if st['high20'] else '20일 저점'
        ctx['items'][s] = item
    if len(have) < len(symbols):
        ctx['missing'] = [label_map.get(s, s) for s in symbols if s not in have]
    numbers = {'streak_days': abs(streak)} if abs(streak) >= 3 else {}
    extreme = any('at_20d_extreme' in i for i in ctx['items'].values())
    return {slot: make_slot(slot, date, tier_state(tier), signature(date, tier, ','.join(sorted(have))), numbers, _clean_ctx(ctx),
                            {'big': tier in ('upBig', 'downBig'), 'streak': abs(streak) >= 3, 'extreme': extreme, 'intraday': True},
                            _angles(('오늘 움직임', True), ('최근 5일 흐름', True), ('20일 고점·저점권', extreme)))}


def macro_facts(macro, now):
    out = {}
    out.update(rate_facts(macro, now))
    out.update(fx_facts(macro, now))
    out.update(_commodity_slot('oil', ('WTI', 'BRENT'), macro, now, {'WTI': 'WTI', 'BRENT': '브렌트유'}))
    out.update(_commodity_slot('gold', ('GOLD',), macro, now, {'GOLD': '금 선물'}))
    out.update(_commodity_slot('btc', ('BTC',), macro, now, {'BTC': '비트코인'}))
    return out


def group_facts(group, inputs):
    """inputs = {'now', 'domestic', 'market_temp', 'macro', 'option', 'briefing'(스냅샷)}."""
    now = inputs['now']
    if group == 'brief':
        return brief_facts(inputs.get('briefing'), inputs.get('macro'))
    if group == 'intraday':
        return intraday_facts(inputs.get('domestic'), inputs.get('market_temp'), inputs.get('option'), now)
    if group == 'funds':
        return funds_facts(inputs.get('domestic'), now)
    if group == 'macro':
        return macro_facts(inputs.get('macro'), now)
    raise ValueError('unknown group: %s' % group)
