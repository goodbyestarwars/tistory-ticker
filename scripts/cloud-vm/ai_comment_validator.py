# -*- coding: utf-8 -*-
"""AI 시장 코멘트의 4단계: 생성된 문장 검증(2026-10-23).

AI는 틀릴 수 있으므로 화면에 나가기 전에 코드가 막는다. 통과하지 못한 문장은 쓰지 않는다(재시도 또는 해설 없음).
고정 문구 풀로 되돌려 채우지 않는다 - 해설 없음이 안전한 기본값이다.

막는 것
    형식       빈 문장·너무 길거나 짧음·줄바꿈/마크다운/이모지/URL·한글이 아닌 문장·허용 목록 밖의 영문
    숫자       사실 객체의 numbers 에 없는 숫자(날짜·단위 포함해 틀린 숫자 인용 차단)
    사실 모순  카드 상태(상승/하락/매수/매도)와 정반대 표현만 있는 문장, 큰 변동·연속·고저점 표현의 근거 없는 사용
    창작       원인 단정(때문에·영향으로 …)·사건/기관/종목 언급·관련 없는 다른 지표 언급
    금융 단정  매수·매도 권유, 수익 보장, 폭락/급등 예고, 카드별 금지 해석(예탁금 감소=자금 이탈 등)
    반복       최근 14일 같은 카드의 문장 또는 말투 예시와 너무 비슷한 문장
"""
import re
from collections import namedtuple

Result = namedtuple('Result', 'ok reasons similarity')

MIN_LEN = 8
MAX_LEN = 64
MAX_LEN_SUMMARY = 96
SIMILAR_REJECT = 0.60     # 이 이상이면 반복으로 보고 다시 쓰게 한다
SIMILAR_HARD = 0.90       # 재시도를 다 써도 이 이상이면 해설을 내지 않는다
SUMMARY_SLOTS = ('brief_summary', 'market_summary')

# 프롬프트의 말투 예시를 그대로 베끼지 못하게 막는다(예시는 톤 참고용일 뿐 출력 문구가 아니다)
TONE_EXAMPLES = (
    '거래가 이렇게 없나… 다들 눈치만 보는 모양이네',
    '외국인이 돌아왔네? 이번엔 오래 머물려나',
    '20일 내내 매도 우세라니… 수급이 무겁겠어',
    '빚내서 들어오는 돈이 많네… 과열 신호일까',
    '장기금리가 확 빠졌네… 경기 걱정 때문인지 봐야겠어',
    '달러가 또 비싸지네… 해외주식 살 때 부담이야',
)

# ---- 금융 단정·창작 금지 -------------------------------------------------------------------------------

GLOBAL_BAN = [
    ('매수·매도 권유', r'(사라|사세요|사자|사야|팔아|팔자|팔라|파세요|파는\s*게|매수\s*(하세요|해라|해도|기회|타이밍|추천)|매도\s*(하세요|해라|타이밍)|담아라|담으세요|추천|유망|저점\s*매수|분할\s*매수|손절|익절|비중\s*(늘|줄|확대|축소)|지금이\s*기회|기회다|기회야|진입|청산|물타|들어가|빠져라)'),
    ('확정적 표현', r'(확실|틀림없|분명|무조건|반드시|보장|장담|수밖에)'),
    ('예고·붕괴 표현', r'(곧\s*(폭락|급락|급등|무너|터진|터질)|폭락\s*(온다|예고|신호|임박)|붕괴|패닉|대폭락|버블|내일은?\s*(오른|내린|하락|상승|반등|폭락)|전망이다|예측)'),
    ('원인 단정', r'(때문(에|이|입니다)|탓(에|이)|덕분|덕택|로\s*인해|으로\s*인해|인해서|영향(으로|때문|에)|여파|영향을\s*받|힘입어|원인은|이유는|배경은|까닭)'),
    ('사건·기관·종목 언급', r'(연준|Fed|FOMC|연방준비|파월|트럼프|바이든|관세|전쟁|분쟁|제재|금통위|기준금리|실적|어닝|뉴스|보도|속보|공시|CPI|PPI|고용\s*지표|물가\s*지표|엔비디아|삼성전자|하이닉스|테슬라|애플|마이크로소프트|구글|아마존|정부|대통령|선거|총선|지정학|이란|중국|일본|북한|우크라이나|이스라엘|중동|OPEC|감산|증산|배당|상장|IPO|ETF|규제|서킷|사이드카)'),
    ('인과 동사', r'(끌어내|끌어올|이끌|견인|주도|야기|촉발|초래|떠받|짓눌|압박)'),
    ('비속어·과한 표현', r'(ㅋ|ㅎ|ㅠ|ㅜ|씨|젠장|미쳤|개\s*(비싸|싸|많|올|빠)|헐|대박|ㄷㄷ|ㅅㅂ)'),
]
SLOT_BAN = {
    'deposits': ('자금 이탈·고갈 단정', r'(고갈|바닥났|말랐|마르|이탈|빠져나|유출|돈이\s*없|자금이\s*(없|빠))'),
    'credit': ('과열·위험 단정', r'(고갈|이탈|빠져나|유출|반대매매|위험\s*(하|수위|신호다)|거품)'),
    'foreign': ('하락 확정', r'(하락\s*(확정|예고|신호)|상승\s*(확정|예고|신호))'),
    'institution': ('하락 확정', r'(하락\s*(확정|예고|신호)|상승\s*(확정|예고|신호))'),
    'individual': ('하락 확정', r'(하락\s*(확정|예고|신호)|상승\s*(확정|예고|신호))'),
    'program': ('하락 확정', r'(하락\s*(확정|예고|신호)|상승\s*(확정|예고|신호))'),
    'putcall': ('투자자 전체 베팅 단정', r'(다들|모두|전부|투자자들|시장\s*참여자|베팅|배팅|올인|공포|비관|낙관)'),
    'rate': ('자금 이동·정책 단정', r'(주식에서|채권으로|채권\s*쪽|자금\s*(이동|이탈)|갈아타|호재|악재|인상|인하|돈이\s*(몰|빠)|안전자산)'),
    'fx': ('환 수익·원인 단정', r'(환차익|환차손|수익|이익|이득|손해|손실|돈\s*벌|유리|불리|투자하기|환전\s*(타이밍|기회)|수출|수입|무역|외국인\s*(때문|매도))'),
    'vix': ('공포·위기 단정', r'(폭락|공포|위기|경고음|비상|위험하)'),
    'kospi_volume': ('거래량=매수세 단정', r'(매수세|유입|사들|몰렸|몰리|몰려|자금이|돈이)'),
    'kosdaq_volume': ('거래량=매수세 단정', r'(매수세|유입|사들|몰렸|몰리|몰려|자금이|돈이)'),
    'oil': ('원인 단정', r'(안전자산|달러\s*(약세|강세)|인플레|반감기|고래|수요\s*(감소|증가)|공급)'),
    'gold': ('원인 단정', r'(안전자산|달러\s*(약세|강세)|인플레|수요\s*(감소|증가)|공급)'),
    'btc': ('원인 단정', r'(반감기|고래|승인|규제|안전자산|달러\s*(약세|강세))'),
}
# 해당 flags 가 참일 때만 쓸 수 있는 표현
NEED_BIG = ('큰 변동 표현(근거 없음)', r'(급등|급락|폭등|폭락|급증|급감|치솟|곤두박|폭발|쏟아|뚝\s*떨어|훅|확\s*(올|뛰|빠|내려|떨어|줄|늘|치))')
NEED_STREAK = ('연속 표현(근거 없음)', r'(연속|내내|줄곧|연일|계속|쭉|며칠째|일째|거듭|꾸준히)')
NEED_EXTREME = ('고점·저점 표현(근거 없음)', r'(사상|역대|최고|최저|신고가|신저가|고점|저점|바닥|천장)')
INTRADAY_VOLUME_BAN = ('장중 누적 거래량의 많고 적음 단정', r'거래(량|가)?.{0,8}(낮|적|한산|저조|부진|활발|많|높|늘|줄|없|말랐|터|붐비|뜸)')

UP_WORDS = r'(상승|올랐|오르|올라|오름|뛰|강세|(?<!오)늘(었|어|고|며|지|면|리)|증가|확대|순매수|사들|커졌|커지|높아|비싸|올려|매수\s*우위)'
DOWN_WORDS = r'(하락|내렸|내리|내림|떨어|빠졌|빠지|빠져|약세|줄(었|어|며|고|지|면|인|이)|감소|축소|순매도|팔(고|아|았|리|린|려|렸|지|며)|던지|던져|작아|낮아|싸졌|싸지|가라앉|눌(렸|리|림|려|린)|밀렸|밀리|매도\s*우위)'

# 다른 지표를 가리키는 말 -> 지표. 관련 지표로 허용되지 않은 지표를 억지로 이어 붙이지 못하게 한다.
INDICATOR_WORDS = [
    (r'환율|달러|원화|원/달러', 'fx'), (r'금리|국채|채권', 'rate'), (r'예탁금', 'deposits'), (r'빚투|신용', 'credit'),
    (r'프로그램', 'program'), (r'외국인', 'foreign'), (r'기관', 'institution'), (r'개인(?!적)', 'individual'),
    (r'풋|콜', 'putcall'), (r'유가|기름|원유|브렌트|WTI', 'oil'), (r'금값|금 선물', 'gold'), (r'비트코인|코인', 'btc'),
    (r'VIX|변동성지수', 'vix'), (r'반도체|SOX', 'sox'), (r'나스닥', 'nas'), (r'다우', 'dji'), (r'S&P', 'spx'),
    (r'야간선물|야간', 'night'),
]
# 한 슬롯 안에서 자연스럽게 함께 나오는 말(예: 거래량 코멘트의 '코스피')은 지표 목록에 없으므로 따로 허용할 필요가 없다.
SELF_ALIASES = {'foreign': {'foreign'}, 'program': {'program'}}
# 환율은 '달러 상승=원화 약세'처럼 같은 사실을 반대 단어로 말할 수 있어 방향 단어 검사를 하지 않는다
NO_DIRECTION_CHECK = frozenset(('fx',))
LATIN_OK = {'VIX', 'SOX', 'WTI', 'BTC', 'KOSPI', 'KOSDAQ', 'bp', 'AI', 'FX'}
NAME_WHITELIST = [r'S&P\s*500', r'S&P500', r'코스피\s*200', r'KOSPI\s*200', r'3대', r'200일선?', r'(?<!\d)(2|10|30)년물?']
GLOBAL_NUMBERS = (5.0, 20.0)

EMOJI = re.compile('[\U0001F000-\U0001FFFF☀-➿⬀-⯿️]')
MARKUP = re.compile(r'[\n\r\t*#`<>{}\[\]\\|_~]|https?://|www\.')
NUMBER = re.compile(r'(?<![\w.])[-+−]?\d[\d,]*(?:\.\d+)?')
LATIN = re.compile(r'[A-Za-z][A-Za-z&]+')
HANGUL = re.compile('[가-힣]')


def _compile(rows):
    return [(label, re.compile(rx)) for label, rx in rows]


_GLOBAL = _compile(GLOBAL_BAN)
_SLOT = {k: re.compile(v[1]) for k, v in SLOT_BAN.items()}
_INDICATORS = [(re.compile(rx), slot) for rx, slot in INDICATOR_WORDS]
_BIG, _STREAK, _EXTREME = (re.compile(NEED_BIG[1]), re.compile(NEED_STREAK[1]), re.compile(NEED_EXTREME[1]))
_VOLBAN = re.compile(INTRADAY_VOLUME_BAN[1])
_UP, _DOWN = re.compile(UP_WORDS), re.compile(DOWN_WORDS)
_WHITE = [re.compile(rx) for rx in NAME_WHITELIST]
_CAUSE_OK = re.compile(r'(때문|탓)(인지|일까|일지|인가)')


def normalize(text):
    return re.sub(r'[\s.,!?…~·\-–—"\'“”‘’()（）:;]+', '', str(text or ''))


def _bigrams(text):
    t = normalize(text)
    return {t[i:i + 2] for i in range(len(t) - 1)} if len(t) > 1 else {t}


def similarity(a, b):
    """두 문장의 유사도(0~1): 글자 2-그램 자카드와 공통 앞부분 길이 중 큰 값."""
    na, nb = normalize(a), normalize(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    ba, bb = _bigrams(na), _bigrams(nb)
    jac = len(ba & bb) / len(ba | bb) if (ba | bb) else 0.0
    pre = 0
    for x, y in zip(na, nb):
        if x != y:
            break
        pre += 1
    prefix = 0.7 if pre >= 6 else 0.0
    return max(jac, prefix)


def max_similarity(text, others):
    return max([similarity(text, o) for o in others if o] or [0.0])


def _number_ok(token, allowed):
    raw = token.replace(',', '').replace('−', '-').lstrip('+-')
    try:
        t = float(raw)
    except ValueError:
        return False
    decimals = len(raw.split('.')[1]) if '.' in raw else 0
    tol = 0.5 * 10 ** (-decimals) + 1e-9
    return any(abs(t - a) <= tol for a in allowed)


def allowed_numbers(facts):
    out = set(GLOBAL_NUMBERS)
    for v in (facts.get('numbers') or {}).values():
        try:
            out.add(abs(float(v)))
        except (TypeError, ValueError):
            pass
    return out


def validate(facts, text, recent=(), examples=TONE_EXAMPLES):
    """facts = ai_comment_facts 의 사실 객체 하나. 반환 Result(ok, reasons, similarity). 유사도 사유도 reasons 에 들어간다."""
    slot = facts['slot']
    reasons = []
    if not isinstance(text, str):
        return Result(False, ['문장이 문자열이 아님'], 0.0)
    t = text.strip()
    limit = MAX_LEN_SUMMARY if slot in SUMMARY_SLOTS else MAX_LEN
    if len(t) < MIN_LEN:
        reasons.append('너무 짧음(%d자 미만)' % MIN_LEN)
    if len(t) > limit:
        reasons.append('너무 김(%d자 초과, 카드에 2줄까지만 들어감)' % limit)
    if MARKUP.search(t) or EMOJI.search(t):
        reasons.append('줄바꿈·마크다운·이모지·링크 금지')
    letters = re.sub(r'\s', '', t)
    if letters and len(HANGUL.findall(letters)) / len(letters) < 0.4:
        reasons.append('한국어 문장이어야 함')
    for word in LATIN.findall(re.sub(r'S&P\s*500|S&P500', 'SP', t)):
        if word not in LATIN_OK and word != 'SP':
            reasons.append('허용되지 않은 영문 표기: %s' % word)
            break
    # 숫자: numbers 밖의 숫자는 모두 막는다(고유명사 속 숫자는 제외)
    probe = t
    for rx in _WHITE:
        probe = rx.sub(' ', probe)
    allowed = allowed_numbers(facts)
    bad = [tok for tok in NUMBER.findall(probe) if not _number_ok(tok, allowed)]
    if bad:
        reasons.append('근거 없는 숫자: %s (사용 가능: %s)' % (', '.join(bad[:3]), ', '.join(sorted({('%g' % a) for a in allowed})[:12]) or '없음'))
    for label, rx in _GLOBAL:
        # '때문인지·탓일까'처럼 의문형으로 궁금해하는 표현은 원인 단정이 아니므로 허용한다
        m = rx.search(_CAUSE_OK.sub('', t) if label == '원인 단정' else t)
        if m:
            reasons.append('%s 금지: "%s"' % (label, m.group(0)))
    if slot in _SLOT:
        m = _SLOT[slot].search(t)
        if m:
            reasons.append('%s 금지: "%s"' % (SLOT_BAN[slot][0], m.group(0)))
    flags = facts.get('flags') or {}
    for (label, _), rx, need in ((NEED_BIG, _BIG, flags.get('big')), (NEED_STREAK, _STREAK, flags.get('streak')),
                                (NEED_EXTREME, _EXTREME, flags.get('extreme'))):
        m = rx.search(t)
        if m and not need:
            reasons.append('%s: "%s"' % (label, m.group(0)))
    if slot in ('kospi_volume', 'kosdaq_volume') and flags.get('intraday'):
        m = _VOLBAN.search(t)
        if m:
            reasons.append('%s: "%s"' % (INTRADAY_VOLUME_BAN[0], m.group(0)))
    # 방향 모순: 카드 상태와 정반대 표현만 있는 문장
    state = facts.get('state')
    if slot in NO_DIRECTION_CHECK:
        state = None
    if state in ('up', 'buy') and _DOWN.search(t) and not _UP.search(t):
        reasons.append('카드는 상승/매수 우위인데 하락·매도 표현만 있음')
    if state in ('down', 'sell') and _UP.search(t) and not _DOWN.search(t):
        reasons.append('카드는 하락/매도 우위인데 상승·매수 표현만 있음')
    # 관련 없는 다른 지표 언급
    ok_slots = {slot} | set(facts.get('related') or ())
    for rx, other in _INDICATORS:
        if other in ok_slots:
            continue
        m = rx.search(t)
        if m:
            reasons.append('관련 확인되지 않은 지표 언급: "%s"' % m.group(0))
            break
    sim = max_similarity(t, list(recent))
    sim_example = max_similarity(t, list(examples))
    if sim_example >= 0.7:
        reasons.append('말투 예시를 그대로 따라 씀')
    if sim >= SIMILAR_REJECT:
        reasons.append('최근 14일 문장과 너무 비슷함(유사도 %.2f) - 다른 관점·구조로' % sim)
    return Result(not reasons, reasons, sim)


def parse_model_json(raw):
    """모델 응답 문자열 -> dict. 코드펜스·앞뒤 설명이 붙어도 첫 JSON 객체를 찾는다. 실패하면 ValueError."""
    import json
    if raw is None:
        raise ValueError('빈 응답')
    s = str(raw).strip()
    s = re.sub(r'^```(?:json)?\s*|\s*```$', '', s)
    try:
        value = json.loads(s)
    except ValueError:
        i, j = s.find('{'), s.rfind('}')
        if i < 0 or j <= i:
            raise ValueError('JSON 객체를 찾지 못함')
        try:
            value = json.loads(s[i:j + 1])
        except ValueError as exc:
            raise ValueError('JSON 해석 실패: %s' % exc) from None
    if not isinstance(value, dict):
        raise ValueError('JSON 객체가 아님')
    return value
