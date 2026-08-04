# -*- coding: utf-8 -*-
"""`.kis.yaml` 전략 포맷 파서 + 평가 엔진.

포맷 출처: 한국투자증권 open-trading-api strategy_builder README
(https://github.com/koreainvestment/open-trading-api/blob/main/strategy_builder/README.md
#kisyaml-포맷).

원본 저장소의 strategy_builder는 Next.js 비주얼 빌더 + FastAPI 백엔드 + Backtester +
KIS 계좌 인증/실전·모의 주문 실행까지 포함한 별도 애플리케이션이다. 이 모듈은 그 중
`.kis.yaml` 포맷 자체(파싱 + 지표 계산 + entry/exit 조건 평가)만 이식한다 - 이 프로젝트는
KIS 계좌 인증이나 주문 실행을 다루지 않는다(kis_client.py도 시세 조회 전용, 계좌/주문
API 없음). 화면 위젯 연동도 이 모듈의 범위 밖이다.

지표 계산은 db_schema.load_daily_prices()가 주는 오름차순 OHLC
({date, open, high, low, close, volume})를 입력으로 한다. README가 언급한 "80개 지표"를
전부 구현하지 않고, README의 .kis.yaml 예시(golden_cross)와 명세가 분명한 기본 지표
(sma/ema/rsi/roc/highest/lowest/stddev/atr/price)만 지원한다 - INDICATORS 딕셔너리에
계산 함수를 추가하면 확장 가능하다.

compare_to는 README 예시(entry 조건이 다른 지표 alias인 sma_slow를 참조)와 서술("RSI > 70")
을 근거로 '다른 지표의 alias 문자열' 또는 '숫자 리터럴' 둘 다 허용하는 것으로 해석했다 -
2026-08 기준 원본 저장소에 별도 JSON 스키마 파일이 공개돼 있지 않아 README 예시 기반 추정이다.
confidence(시그널 강도) 산식도 README가 "1.0=모두 충족, 0.5=일부 충족, 0.0=불충족"이라고만
서술하고 정확한 공식은 공개하지 않아, '충족 조건 수 / 전체 조건 수'로 근사했다(추정치).

이 프로젝트에 PyYAML 의존성을 새로 추가하지 않기 위해, `.kis.yaml`이 실제로 쓰는 문법
(2-space 들여쓰기, 매핑/리스트/스칼라, 인라인 리스트 `[a, b]`, 따옴표 문자열, 숫자/불린)만
지원하는 전용 파서를 아래에 둔다. YAML 앵커·멀티라인 블록·플로우 매핑 등은 지원하지 않는다."""

import re


class StrategyError(ValueError):
    """`.kis.yaml` 파싱/검증 실패."""


# ---------------------------------------------------------------------------
# 최소 YAML 서브셋 파서
# ---------------------------------------------------------------------------

_LIST_ITEM_RE = re.compile(r'^(\s*)-\s?(.*)$')


def _strip_comment(line):
    """따옴표 밖에서 시작하는 ' #' 이후를 잘라낸다(간단한 휴리스틱 - 이 포맷은 값 안에
    #을 쓰지 않으므로 충분하다)."""
    in_quote = None
    for i, ch in enumerate(line):
        if in_quote:
            if ch == in_quote:
                in_quote = None
        elif ch in ('"', "'"):
            in_quote = ch
        elif ch == '#' and (i == 0 or line[i - 1].isspace()):
            return line[:i]
    return line


def _split_kv(content):
    depth = 0
    in_quote = None
    for i, ch in enumerate(content):
        if in_quote:
            if ch == in_quote:
                in_quote = None
            continue
        if ch in ('"', "'"):
            in_quote = ch
        elif ch in '[{':
            depth += 1
        elif ch in ']}':
            depth -= 1
        elif ch == ':' and depth == 0:
            return content[:i].strip(), content[i + 1:].strip()
    raise StrategyError('콜론(:)이 없는 라인입니다: %r' % content)


def _parse_scalar(raw):
    if raw == '':
        return None
    if (raw[0] == '"' and raw[-1] == '"') or (raw[0] == "'" and raw[-1] == "'"):
        return raw[1:-1]
    if raw[0] == '[' and raw[-1] == ']':
        inner = raw[1:-1].strip()
        if not inner:
            return []
        return [_parse_scalar(part.strip()) for part in inner.split(',')]
    low = raw.lower()
    if low == 'true':
        return True
    if low == 'false':
        return False
    if low in ('null', '~'):
        return None
    try:
        return int(raw)
    except ValueError:
        pass
    try:
        return float(raw)
    except ValueError:
        pass
    return raw


def _tokenize(text):
    """들여쓰기가 있는 텍스트를 (indent, is_item, key, value) 토큰 리스트로 변환한다.
    `- key: value` 형태의 리스트 항목은 (dash 토큰) + (key: value가 dash+2칸 들여쓰기에
    있는 것처럼 보이는 토큰)으로 풀어서(unroll) 뒤따르는 형제 키들과 같은 들여쓰기로
    맞춘다."""
    tokens = []
    for raw_line in text.split('\n'):
        line = _strip_comment(raw_line).rstrip()
        if not line.strip():
            continue
        stripped = line.lstrip(' ')
        if stripped.startswith('#'):
            continue
        m = _LIST_ITEM_RE.match(line)
        if m:
            base_indent = len(m.group(1))
            rest = m.group(2)
            tokens.append({'indent': base_indent, 'is_item': True})
            if rest.strip():
                key, val = _split_kv(rest)
                tokens.append({'indent': base_indent + 2, 'is_item': False, 'key': key, 'value': val})
            continue
        indent = len(line) - len(stripped)
        key, val = _split_kv(stripped)
        tokens.append({'indent': indent, 'is_item': False, 'key': key, 'value': val})
    return tokens


def _parse_block(tokens, i, indent):
    if i >= len(tokens) or tokens[i]['indent'] < indent:
        return None, i
    if tokens[i]['is_item']:
        items = []
        while i < len(tokens) and tokens[i]['indent'] == indent and tokens[i]['is_item']:
            i += 1
            value, i = _parse_block(tokens, i, indent + 2)
            items.append(value)
        return items, i
    mapping = {}
    while i < len(tokens) and tokens[i]['indent'] == indent and not tokens[i]['is_item']:
        key = tokens[i]['key']
        raw_val = tokens[i]['value']
        i += 1
        if raw_val == '':
            if i < len(tokens) and tokens[i]['indent'] > indent:
                value, i = _parse_block(tokens, i, tokens[i]['indent'])
            else:
                value = None
        else:
            value = _parse_scalar(raw_val)
        mapping[key] = value
    return mapping, i


def parse_strategy_yaml(text):
    """`.kis.yaml` 문자열을 dict로 파싱하고 최소한의 구조를 검증한다."""
    tokens = _tokenize(text)
    data, _ = _parse_block(tokens, 0, 0)
    _validate(data)
    return data


def load_strategy_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        return parse_strategy_yaml(f.read())


def _validate(data):
    if not isinstance(data, dict):
        raise StrategyError('.kis.yaml 최상위는 매핑이어야 합니다.')
    st = data.get('strategy')
    if not isinstance(st, dict):
        raise StrategyError('strategy 섹션이 없습니다.')
    indicators = st.get('indicators')
    if not isinstance(indicators, list) or not indicators:
        raise StrategyError('strategy.indicators가 비어있습니다.')
    aliases = set()
    for ind in indicators:
        if not isinstance(ind, dict) or not ind.get('id'):
            raise StrategyError('indicators 항목에 id가 없습니다: %r' % ind)
        if ind['id'] not in INDICATORS:
            raise StrategyError(
                '지원하지 않는 지표 id: %r (지원: %s)' % (ind['id'], ', '.join(sorted(INDICATORS))))
        aliases.add(ind.get('alias') or ind['id'])
    for section in ('entry', 'exit'):
        group = st.get(section)
        if not group:
            continue
        for cond in group.get('conditions') or []:
            if cond.get('indicator') not in aliases:
                raise StrategyError(
                    '%s 조건이 정의되지 않은 지표를 참조합니다: %r' % (section, cond.get('indicator')))
            if cond.get('operator') not in _OPERATORS:
                raise StrategyError(
                    '지원하지 않는 연산자: %r (지원: %s)' % (cond.get('operator'), ', '.join(sorted(_OPERATORS))))
            compare_to = cond.get('compare_to')
            if isinstance(compare_to, str) and compare_to not in aliases:
                raise StrategyError(
                    '%s 조건의 compare_to가 정의되지 않은 지표를 참조합니다: %r' % (section, compare_to))
            elif not isinstance(compare_to, str) and not isinstance(compare_to, (int, float)):
                raise StrategyError('compare_to는 지표 alias 문자열 또는 숫자여야 합니다: %r' % (compare_to,))


# ---------------------------------------------------------------------------
# 지표 계산 - daily는 db_schema.load_daily_prices()와 같은 오름차순 OHLC 리스트
# ---------------------------------------------------------------------------

def _sma(daily, period, field='close'):
    n = len(daily)
    out = [None] * n
    s = 0.0
    for i in range(n):
        s += daily[i][field]
        if i >= period:
            s -= daily[i - period][field]
        if i >= period - 1:
            out[i] = s / period
    return out


def _ema(daily, period, field='close'):
    n = len(daily)
    out = [None] * n
    if n < period:
        return out
    seed = sum(daily[i][field] for i in range(period)) / period
    out[period - 1] = seed
    k = 2.0 / (period + 1)
    prev = seed
    for i in range(period, n):
        prev = daily[i][field] * k + prev * (1 - k)
        out[i] = prev
    return out


def _rsi(daily, period=14, field='close'):
    """Wilder's smoothing - js/foreign-flow.js의 computeRSI()와 동일한 공식."""
    n = len(daily)
    out = [None] * n
    if n <= period:
        return out
    gains = losses = 0.0
    for i in range(1, period + 1):
        diff = daily[i][field] - daily[i - 1][field]
        if diff > 0:
            gains += diff
        else:
            losses -= diff
    avg_gain = gains / period
    avg_loss = losses / period
    out[period] = 100 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    for i in range(period + 1, n):
        diff = daily[i][field] - daily[i - 1][field]
        gain = diff if diff > 0 else 0.0
        loss = -diff if diff < 0 else 0.0
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        out[i] = 100 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    return out


def _roc(daily, period=12, field='close'):
    n = len(daily)
    out = [None] * n
    for i in range(period, n):
        base = daily[i - period][field]
        if base:
            out[i] = (daily[i][field] - base) / base * 100
    return out


def _highest(daily, period, field='high'):
    n = len(daily)
    out = [None] * n
    for i in range(period - 1, n):
        out[i] = max(daily[j][field] for j in range(i - period + 1, i + 1))
    return out


def _lowest(daily, period, field='low'):
    n = len(daily)
    out = [None] * n
    for i in range(period - 1, n):
        out[i] = min(daily[j][field] for j in range(i - period + 1, i + 1))
    return out


def _stddev(daily, period, field='close'):
    n = len(daily)
    out = [None] * n
    for i in range(period - 1, n):
        window = [daily[j][field] for j in range(i - period + 1, i + 1)]
        mean = sum(window) / period
        var = sum((v - mean) ** 2 for v in window) / period
        out[i] = var ** 0.5
    return out


def _atr(daily, period=14):
    """Wilder's ATR. True Range는 field 무관하게 항상 고가/저가/전일종가로 계산한다."""
    n = len(daily)
    tr = [0.0] * n
    for i in range(n):
        if i == 0:
            tr[i] = daily[i]['high'] - daily[i]['low']
        else:
            tr[i] = max(
                daily[i]['high'] - daily[i]['low'],
                abs(daily[i]['high'] - daily[i - 1]['close']),
                abs(daily[i]['low'] - daily[i - 1]['close']),
            )
    out = [None] * n
    if n <= period:
        return out
    avg = sum(tr[1:period + 1]) / period
    out[period] = avg
    for i in range(period + 1, n):
        avg = (avg * (period - 1) + tr[i]) / period
        out[i] = avg
    return out


def _price(daily, field='close'):
    return [row[field] for row in daily]


INDICATORS = {
    'sma': lambda daily, p: _sma(daily, int(p.get('period', 20)), p.get('field', 'close')),
    'ema': lambda daily, p: _ema(daily, int(p.get('period', 20)), p.get('field', 'close')),
    'rsi': lambda daily, p: _rsi(daily, int(p.get('period', 14)), p.get('field', 'close')),
    'roc': lambda daily, p: _roc(daily, int(p.get('period', 12)), p.get('field', 'close')),
    'highest': lambda daily, p: _highest(daily, int(p.get('period', 20)), p.get('field', 'high')),
    'lowest': lambda daily, p: _lowest(daily, int(p.get('period', 20)), p.get('field', 'low')),
    'stddev': lambda daily, p: _stddev(daily, int(p.get('period', 20)), p.get('field', 'close')),
    'atr': lambda daily, p: _atr(daily, int(p.get('period', 14))),
    'price': lambda daily, p: _price(daily, p.get('field', 'close')),
}


def compute_indicator_series(strategy, daily):
    """strategy.strategy.indicators의 각 alias에 대해 daily와 같은 길이의 값 시리즈
    (앞부분은 데이터 부족으로 None)를 계산해 {alias: [...]}로 반환한다."""
    series = {}
    for ind in strategy['strategy']['indicators']:
        alias = ind.get('alias') or ind['id']
        fn = INDICATORS[ind['id']]
        series[alias] = fn(daily, ind.get('params') or {})
    return series


# ---------------------------------------------------------------------------
# 연산자 + entry/exit 평가
# ---------------------------------------------------------------------------

def _valid(*vals):
    return all(v is not None for v in vals)


_OPERATORS = {
    'cross_above': lambda pa, a, pb, b: _valid(pa, a, pb, b) and pa <= pb and a > b,
    'cross_below': lambda pa, a, pb, b: _valid(pa, a, pb, b) and pa >= pb and a < b,
    'greater_than': lambda pa, a, pb, b: _valid(a, b) and a > b,
    'less_than': lambda pa, a, pb, b: _valid(a, b) and a < b,
    'greater_equal': lambda pa, a, pb, b: _valid(a, b) and a >= b,
    'less_equal': lambda pa, a, pb, b: _valid(a, b) and a <= b,
    'equals': lambda pa, a, pb, b: _valid(a, b) and abs(a - b) < 1e-9,
}


def _resolve_compare_to(compare_to, series, i):
    if isinstance(compare_to, str):
        if compare_to not in series:
            raise StrategyError('compare_to가 정의되지 않은 지표 alias를 참조합니다: %r' % compare_to)
        prev = series[compare_to][i - 1] if i > 0 else None
        return prev, series[compare_to][i]
    if isinstance(compare_to, (int, float)) and not isinstance(compare_to, bool):
        return compare_to, compare_to
    raise StrategyError('compare_to를 해석할 수 없습니다: %r (지표 alias 또는 숫자만 지원)' % (compare_to,))


def _eval_condition(cond, series, i):
    alias = cond.get('indicator')
    prev_a = series[alias][i - 1] if i > 0 else None
    a = series[alias][i]
    prev_b, b = _resolve_compare_to(cond.get('compare_to'), series, i)
    return _OPERATORS[cond['operator']](prev_a, a, prev_b, b)


def _eval_group(group, series, i):
    conditions = (group or {}).get('conditions') or []
    if not conditions:
        return False, 0, 0
    logic = (group.get('logic') or 'AND').upper()
    results = [_eval_condition(c, series, i) for c in conditions]
    matched = sum(1 for r in results if r)
    if logic == 'AND':
        passed = all(results)
    elif logic == 'OR':
        passed = any(results)
    else:
        raise StrategyError('지원하지 않는 logic: %r (AND/OR만 지원)' % group.get('logic'))
    return passed, matched, len(results)


def evaluate(strategy, daily, index=-1):
    """daily(오름차순 OHLC, db_schema.load_daily_prices 형식)에 strategy를 적용해 index
    시점(기본값 -1=최신 봉)의 시그널을 계산한다.
    exit 조건이 충족되면 entry보다 우선해 SELL로 판정한다(포지션 보유 여부를 이 모듈이
    추적하지 않으므로, exit 충족 = 청산 신호로 단순화 - 원본 Strategy Builder의 포지션
    관리 방식과 다를 수 있다)."""
    st = strategy['strategy']
    if index < 0:
        index = len(daily) + index
    if index < 0 or index >= len(daily):
        raise StrategyError('daily 데이터 범위를 벗어난 index입니다.')

    series = compute_indicator_series(strategy, daily)
    entry_passed, entry_matched, entry_total = _eval_group(st.get('entry'), series, index)
    exit_passed, exit_matched, exit_total = _eval_group(st.get('exit'), series, index)

    if exit_passed:
        action = 'SELL'
        confidence = (exit_matched / exit_total) if exit_total else 0.0
    elif entry_passed:
        action = 'BUY'
        confidence = (entry_matched / entry_total) if entry_total else 0.0
    else:
        action = 'HOLD'
        confidence = max(
            entry_matched / entry_total if entry_total else 0.0,
            exit_matched / exit_total if exit_total else 0.0,
        )

    return {
        'date': daily[index].get('date'),
        'action': action,
        'confidence': round(confidence, 3),
        'entry': {'passed': entry_passed, 'matched': entry_matched, 'total': entry_total},
        'exit': {'passed': exit_passed, 'matched': exit_matched, 'total': exit_total},
    }


def risk_levels(strategy, entry_price):
    """risk.stop_loss/take_profit percent를 entry_price 기준 참고 가격으로 환산한다.
    실제 주문 실행은 하지 않는다(계좌/주문 연동은 이 프로젝트 범위 밖)."""
    risk = strategy.get('risk') or {}
    out = {}
    sl = risk.get('stop_loss') or {}
    if sl.get('enabled') and sl.get('percent') is not None:
        out['stop_loss_price'] = entry_price * (1 - sl['percent'] / 100)
    tp = risk.get('take_profit') or {}
    if tp.get('enabled') and tp.get('percent') is not None:
        out['take_profit_price'] = entry_price * (1 + tp['percent'] / 100)
    ts = risk.get('trailing_stop') or {}
    if ts.get('enabled') and ts.get('percent') is not None:
        out['trailing_stop_percent'] = ts['percent']
    return out
