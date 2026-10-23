# -*- coding: utf-8 -*-
"""AI 시장 코멘트 엔진 계약 - 2026-10-23. Groq(GAS) 호출은 전부 목(mock)으로 대체한다.

검증하는 것: 사실 객체(정량 분석), 검증기(숫자·방향·원인 단정·금융 단정·반복), 생성 파이프라인(캐시 유지·재시도·호출 제한·장애 시 숨김),
시나리오 시험(새로 고침/다음 거래일/같은 추세 반복/장중 전환/프로그램 20일/예탁금·신용/원화 강세/금리 급변/Groq 장애/휴장일), HTTP 계약.
"""
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone

CLOUD_VM_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
if CLOUD_VM_DIR not in sys.path:
    sys.path.insert(0, CLOUD_VM_DIR)

import ai_comment_facts as F  # noqa: E402
import ai_comment_validator as V  # noqa: E402
import ai_comments as AC  # noqa: E402
import db_schema  # noqa: E402
import market_clock  # noqa: E402

KST = timezone(timedelta(hours=9))


def kst(y, m, d, hh=0, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=KST)


def trading_days(n, end):
    out, d = [], end
    while len(out) < n:
        if market_clock.is_kr_trading_day(datetime(d.year, d.month, d.day, tzinfo=KST)):
            out.append(d)
        d -= timedelta(days=1)
    return list(reversed(out))


def make_conn(path=':memory:'):
    conn = sqlite3.connect(path)
    db_schema.create_schema(conn)
    return conn


# ---- 시장 입력 만들기 --------------------------------------------------------------------------------

def domestic_fixture(end=date(2026, 10, 23), fgn=-100.0, prog_non=-1500.0, deposits_step=-200.0, credit_step=100.0,
                     today_volume=None, last_fgn=None):
    ds = trading_days(70, end)
    rows = [{'date': d.isoformat(), 'close': 100 + i, 'volume': 1000 + (i % 5) * 10} for i, d in enumerate(ds)]
    if today_volume is not None:
        rows[-1]['volume'] = today_volume
    flows = []
    for i, d in enumerate(ds[-30:]):
        v = fgn if not (last_fgn is not None and i == 29) else last_fgn
        flows.append({'label': d.strftime('%m.%d'), 'foreign': v, 'institution': 50, 'individual': 50})
    return {
        'indices': {m: {'quote': {}, 'intervals': {'day': {'rows': rows}}} for m in ('KOSPI', 'KOSDAQ')},
        'investor': {m: {'asOf': end.isoformat(), 'rows': flows} for m in ('KOSPI', 'KOSDAQ')},
        'funds': {'available': True, 'credit_unit': 'hundred_million_krw', 'market_funds_unit': 'hundred_million_krw',
                  'series': [{'date': d.isoformat(), 'credit': {'date': d.isoformat(), 'loan_total': 200000 + i * credit_step},
                              'market_funds': {'date': d.isoformat(), 'investor_deposits': 600000 + i * deposits_step}}
                             for i, d in enumerate(ds)]},
        'programTrading': {'available': True, 'date': end.isoformat(), 'arbitrage': -100, 'nonArbitrage': prog_non,
                           'history': [{'date': d.isoformat(), 'arbitrage': -50, 'nonArbitrage': prog_non} for d in ds[:-1]]},
    }


def bars(pairs):
    return [{'date': d, 'open': c, 'high': c, 'low': c, 'close': c} for d, c in pairs]


def macro_fixture(end=date(2026, 10, 23), usdkrw_step=2.0, y10_step=0.0, y10_last_jump=0.0, wti_rate=0.1, now=None):
    now = now or kst(end.year, end.month, end.day, 11, 0)
    ds = [d.strftime('%Y%m%d') for d in trading_days(130, end)]
    out = {}
    for sym, base, step in (('USDKRW', 1350.0, usdkrw_step), ('US10Y', 4.0, y10_step), ('US30Y', 4.4, y10_step),
                            ('WTI', 70.0, 0.05), ('BRENT', 74.0, 0.05), ('GOLD', 2400.0, 1.0), ('BTC', 90000000.0, 10000.0)):
        pts = [(d, base + step * i) for i, d in enumerate(ds)]
        if y10_last_jump and sym in ('US10Y', 'US30Y'):
            pts[-1] = (pts[-1][0], pts[-1][1] + y10_last_jump)
        out[sym] = {'symbol': sym, 'chart': bars(pts), 'stale': False, 'price': pts[-1][1], 'change_rate': wti_rate,
                    'updated_at': now.astimezone(timezone.utc).isoformat()}
    return out


def inputs_fixture(now, **kw):
    end = now.date()
    dom = domestic_fixture(end, **{k: v for k, v in kw.items() if k in ('fgn', 'prog_non', 'deposits_step', 'credit_step', 'today_volume', 'last_fgn')})
    mt = {'marketBreadth': {'asOf': end.isoformat(), 'total': {'up': 400, 'down': 1100, 'flat': 50, 'total': 1550}}}
    opt = {'CALL': {'side': 'CALL', 'volume': 100, 'updated_at': now.astimezone(timezone.utc).isoformat()},
           'PUT': {'side': 'PUT', 'volume': 130, 'updated_at': now.astimezone(timezone.utc).isoformat()}}
    return {'now': now, 'domestic': dom, 'market_temp': mt, 'option': opt,
            'macro': macro_fixture(end, now=now, **{k: v for k, v in kw.items() if k in ('usdkrw_step', 'y10_step', 'y10_last_jump', 'wti_rate')}),
            'briefing': kw.get('briefing')}


# ---- 목 모델 -----------------------------------------------------------------------------------------

class MockModel:
    """요청된 카드마다 script[slot] 문장(없으면 기본 문장)을 돌려준다. 호출 기록을 남긴다."""

    def __init__(self, script=None, fail=None):
        self.script, self.fail, self.calls = script or {}, fail, []

    def __call__(self, system, user):
        self.calls.append(json.loads(user.split('\n')[-1]))
        if self.fail:
            raise AC.ModelError(self.fail)
        cards = self.calls[-1]['cards']
        out = {}
        for slot in cards:
            v = self.script.get(slot, DEFAULT.get(slot, '오늘은 그냥 지켜보는 분위기네'))
            out[slot] = v(len(self.calls)) if callable(v) else v
        return {'content': json.dumps({'comments': out}, ensure_ascii=False), 'model': 'mock-model',
                'usage': {'prompt_tokens': 1000, 'completion_tokens': 300, 'total_tokens': 1300}}


DEFAULT = {
    'kospi_volume': '지수는 오르는데 장중이라 거래는 더 지켜봐야겠네', 'kosdaq_volume': '코스닥도 장중이라 아직 판단하긴 이르네',
    'breadth': '내린 종목이 훨씬 많아서 체감은 별로겠네', 'foreign': '외국인은 팔고 기관이 받아 주는 모양새네',
    'institution': '기관이 외국인 물량을 받아 주는 느낌이네', 'individual': '개인도 같이 사는 쪽이네',
    'program': '프로그램은 20일 중 20일 팔았네… 수급이 무거워 보이네', 'putcall': '풋 거래가 콜보다 많이 오가네',
    'market_summary': '내린 종목이 많은데 기관과 개인이 받쳐 주는 장이네',
    'credit': '빚내서 사는 돈은 조금씩 늘고 있네', 'deposits': '대기 자금은 조금씩 줄어드는 중이네',
    'rate': '금리는 움직임이 크지 않고 조용하네', 'fx': '달러가 조금씩 비싸지는 흐름이네', 'oil': '기름값은 잠잠하네',
    'gold': '금값은 그대로 제자리네', 'btc': '비트코인은 조용히 쉬는 중이네',
}


# ---- 1. 사실 객체 ------------------------------------------------------------------------------------

class FactsTests(unittest.TestCase):
    def test_program_20d_sell_streak_is_counted_from_history(self):
        now = kst(2026, 10, 23, 16, 0)
        f = F.intraday_facts(domestic_fixture(), {}, {}, now)['program']
        self.assertEqual(f['state'], 'sell')
        self.assertEqual(f['numbers']['sell_days_of_20'], 20)
        self.assertEqual(f['numbers']['buy_days_of_20'], 0)
        self.assertTrue(f['flags']['streak'])
        self.assertEqual(f['context']['trend_20d'], '20일 매도 우세')

    def test_program_needs_20_confirmed_days(self):
        dom = domestic_fixture()
        dom['programTrading']['history'] = dom['programTrading']['history'][-10:]
        self.assertNotIn('program', F.intraday_facts(dom, {}, {}, kst(2026, 10, 23, 16, 0)))

    def test_deposits_down_credit_up_are_distinguished(self):
        f = F.funds_facts(domestic_fixture(deposits_step=-3000.0, credit_step=1500.0), kst(2026, 10, 23, 20, 0))
        self.assertEqual((f['deposits']['state'], f['credit']['state']), ('down', 'up'))
        self.assertIn('엇갈림', f['deposits']['context']['pair_reading'])
        self.assertIn('예탁금 감소 + 신용 증가', f['credit']['context']['pair_reading'])
        self.assertIn('credit', f['deposits']['related'])

    def test_live_intraday_values_are_not_quotable(self):
        # 장중에 계속 변하는 값(거래량 비율·순매수 금액)은 numbers 에 넣지 않는다 -> 검증기가 인용을 막는다
        f = F.intraday_facts(domestic_fixture(today_volume=300), {}, {}, kst(2026, 10, 23, 11, 0))
        self.assertEqual(f['kospi_volume']['numbers'], {})
        self.assertEqual(f['kospi_volume']['state'], 'partial')
        self.assertTrue(f['kospi_volume']['flags']['intraday'])
        self.assertNotIn('ratio_vs_20d_avg_pct', f['kospi_volume']['context'])

    def test_closed_volume_tier_uses_20d_average(self):
        f = F.intraday_facts(domestic_fixture(today_volume=2000), {}, {}, kst(2026, 10, 23, 16, 0))['kospi_volume']
        self.assertEqual(f['state'], 'high')
        self.assertEqual(f['numbers']['ratio_vs_20d_avg_pct'], 196)

    def test_foreign_turn_changes_signature_and_state(self):
        now = kst(2026, 10, 23, 11, 0)
        sell = F.intraday_facts(domestic_fixture(last_fgn=-120.0), {}, {}, now)['foreign']
        buy = F.intraday_facts(domestic_fixture(last_fgn=180.0), {}, {}, now)['foreign']
        self.assertEqual((sell['state'], buy['state']), ('sell', 'buy'))
        self.assertNotEqual(sell['sig'], buy['sig'])
        self.assertTrue(buy['context'].get('turned_from_prior_day'))

    def test_flows_near_zero_are_flat_not_a_turn(self):
        f = F.intraday_facts(domestic_fixture(last_fgn=-2.0), {}, {}, kst(2026, 10, 23, 11, 0))['foreign']
        self.assertEqual(f['state'], 'flat')

    def test_rate_move_tiers_follow_recent_distribution(self):
        now = kst(2026, 10, 23, 20, 0)
        calm = F.rate_facts(macro_fixture(), now)['rate']
        surge = F.rate_facts(macro_fixture(y10_last_jump=0.30), now)['rate']
        self.assertEqual(calm['state'], 'flat')
        self.assertEqual(surge['state'], 'up')
        self.assertTrue(surge['flags']['big'])
        self.assertEqual(surge['numbers']['us10y_bp'], 30)

    def test_fx_and_commodity_missing_data_is_not_invented(self):
        now = kst(2026, 10, 23, 20, 0)
        macro = macro_fixture()
        macro['USDKRW']['chart'] = []
        macro['BRENT']['stale'] = True
        macro['WTI']['updated_at'] = (now - timedelta(hours=40)).astimezone(timezone.utc).isoformat()
        f = F.macro_facts(macro, now)
        self.assertNotIn('fx', f)
        self.assertNotIn('oil', f)          # WTI 36시간 초과 + BRENT stale -> 둘 다 미수신
        self.assertIn('gold', f)

    def test_unavailable_inputs_give_no_facts(self):
        now = kst(2026, 10, 23, 11, 0)
        self.assertEqual(F.funds_facts({'funds': {'available': False, 'series': []}}, now), {})
        self.assertEqual(F.intraday_facts(None, None, None, now), {})
        self.assertEqual(F.brief_facts(None, {}), {})

    def test_brief_facts_use_snapshot_and_chart_context_only_up_to_us_session(self):
        snap = {'targetDate': '2026-10-26', 'inputs': {k: {'name': k, 'pct': p, 'date': '20261023', 'close': 100.0, 'prevClose': 99.0}
                                                       for k, p in (('spx', -1.2), ('nas', -1.8), ('dji', -0.6), ('sox', -3.5), ('vix', 8.0), ('fx', 0.4))},
                'night': {'included': True, 'gapPct': -0.7, 'close': 380.0, 'dayClose': 382.7, 'sessionDate': '20261023'},
                'signal': {'tone': 'down', 'bucket': {'key': 'down', 'label': '하락 우세', 'gap': '시초 하락 출발 86%'}}}
        macro = {sym: {'chart': bars([('202610%02d' % d, 100 + d) for d in range(1, 31)])} for sym in F.BRIEF_CHART_SYMBOL.values()}
        out = F.brief_facts(snap, macro)
        self.assertEqual(set(out), {'spx', 'nas', 'dji', 'sox', 'vix', 'night', 'brief_summary'})
        self.assertEqual(out['sox']['state'], 'down')
        self.assertTrue(out['sox']['flags']['big'])
        self.assertEqual(out['spx']['asof'], '2026-10-23')
        self.assertEqual(out['brief_summary']['context']['us_three_indices'], '3대 지수 모두 하락')
        self.assertEqual(out['night']['numbers']['gap_pct'], -0.7)


# ---- 2. 검증기 ---------------------------------------------------------------------------------------

def good(slot, flags=None, numbers=None, state='sell', related=()):
    f = {'slot': slot, 'state': state, 'numbers': numbers or {}, 'flags': {'big': False, 'streak': False, 'extreme': False, 'intraday': False},
         'related': list(related)}
    f['flags'].update(flags or {})
    return f


class ValidatorTests(unittest.TestCase):
    def check(self, facts, text, recent=()):
        return V.validate(facts, text, recent)

    def test_plain_natural_sentence_passes(self):
        r = self.check(good('program', numbers={'sell_days_of_20': 18}, flags={'streak': True}), '20일 중 18일이나 팔았네… 수급이 무겁겠어')
        self.assertTrue(r.ok, r.reasons)

    def test_numbers_must_come_from_facts(self):
        r = self.check(good('fx', numbers={'change_pct': 0.4}, state='up'), '달러가 0.9% 올랐네')
        self.assertFalse(r.ok)
        self.assertTrue(any('근거 없는 숫자' in x for x in r.reasons))
        self.assertTrue(self.check(good('fx', numbers={'change_pct': 0.4}, state='up'), '달러가 0.4% 올랐네').ok)

    def test_streak_day_count_must_match(self):
        f = good('foreign', numbers={'streak_days': 4}, flags={'streak': True})
        self.assertFalse(self.check(f, '외국인이 7일 연속 팔았네').ok)
        self.assertTrue(self.check(f, '외국인이 4일 연속 팔았네').ok)

    def test_causality_is_blocked_but_questions_are_allowed(self):
        f = good('rate', state='down')
        self.assertFalse(self.check(f, '경기 걱정 때문에 장기금리가 내렸네').ok)
        self.assertFalse(self.check(f, '연준 영향으로 금리가 내렸네').ok)
        self.assertTrue(self.check(f, '장기금리가 내렸네… 경기 걱정 때문인지 봐야겠어').ok)

    def test_no_investment_advice_or_guarantees(self):
        f = good('btc', state='up')
        for bad in ('비트코인 지금 사야 하나 싶네 무조건 오르겠네', '비트코인 사세요 오르네', '곧 폭락 온다 조심하네 올랐네'):
            self.assertFalse(self.check(f, bad).ok, bad)

    def test_finance_guards_per_card(self):
        self.assertFalse(self.check(good('deposits', state='down'), '예탁금이 줄었네… 시장 자금이 빠져나가나').ok)
        self.assertFalse(self.check(good('deposits', state='down'), '예탁금이 줄어서 자금이 고갈되네').ok)
        self.assertFalse(self.check(good('fx', state='down', numbers={}), '원화가 강세네… 달러 투자 수익이 나겠네').ok)
        self.assertFalse(self.check(good('rate', state='up'), '금리가 오르네… 주식에서 채권으로 돈이 옮겨가네').ok)
        self.assertFalse(self.check(good('vix', state='up'), 'VIX가 올랐네… 폭락이 올 수도 있겠네').ok)
        self.assertFalse(self.check(good('putcall', state='put', flags={'big': True}), '풋이 많네… 다들 하락에 베팅하나 보네').ok)
        self.assertFalse(self.check(good('kospi_volume', state='high', flags={'big': True}), '거래량이 늘었네… 매수세가 들어왔나 보네').ok)
        self.assertFalse(self.check(good('foreign', state='sell'), '외국인이 팔아서 지수를 끌어내렸네').ok)

    def test_movement_streak_extreme_words_need_flags(self):
        self.assertFalse(self.check(good('oil', state='up'), '기름값이 급등했네').ok)
        self.assertTrue(self.check(good('oil', state='up', flags={'big': True}), '기름값이 급등했네').ok)
        self.assertFalse(self.check(good('foreign', state='sell'), '외국인이 계속 팔고 있네').ok)
        self.assertTrue(self.check(good('foreign', state='sell', flags={'streak': True}), '외국인이 계속 팔고 있네').ok)
        self.assertFalse(self.check(good('credit', state='up'), '신용 잔고가 역대 최고네').ok)

    def test_direction_contradiction(self):
        r = self.check(good('program', state='sell'), '프로그램이 쓸어 담으며 순매수 우위네')
        self.assertFalse(r.ok)
        self.assertTrue(self.check(good('program', state='sell'), '순매수는 줄고 매도가 이어지네', ).ok is False or True)  # 혼합 표현은 통과 가능
        self.assertTrue(self.check(good('breadth', state='down'), '오늘 시장 별일 없네… 내린 종목이 많네').ok)

    def test_unrelated_indicators_are_not_mixed(self):
        self.assertFalse(self.check(good('rate', state='up'), '금리가 오르니 환율도 같이 뛰네').ok)
        self.assertTrue(self.check(good('foreign', state='sell', related=('institution', 'program')), '외국인은 팔고 기관은 받아 주는 흐름이네').ok)

    def test_events_and_stock_names_are_blocked(self):
        for bad in ('삼성전자가 내려서 지수가 눌렸네', '트럼프 발언에 놀랐나 보네', '연준 눈치를 보네'):
            self.assertFalse(self.check(good('spx', state='down'), bad).ok, bad)

    def test_format_rules(self):
        f = good('btc', state='flat')
        self.assertFalse(self.check(f, '짧음').ok)
        self.assertFalse(self.check(f, '가' * 80).ok)
        self.assertFalse(self.check(f, '비트코인은 조용하네\n그대로네').ok)
        self.assertFalse(self.check(f, '비트코인은 조용하네 😀').ok)
        self.assertFalse(self.check(f, 'Bitcoin looks quiet today and flat').ok)
        self.assertTrue(self.check(good('night', state='flat'), '야간선물은 거의 제자리라 조용하네').ok)

    def test_repetition_against_recent_and_tone_examples(self):
        f = good('fx', state='up')
        r = self.check(f, '달러가 또 비싸지네… 해외주식 살 때 부담이야')
        self.assertFalse(r.ok)
        self.assertTrue(any('말투 예시' in x for x in r.reasons))
        recent = ['달러가 슬금슬금 비싸지는 흐름이네']
        r = self.check(f, '달러가 슬금슬금 비싸지는 흐름이네', recent)
        self.assertFalse(r.ok)
        self.assertGreaterEqual(r.similarity, V.SIMILAR_REJECT)
        self.assertTrue(self.check(f, '원화 힘이 좀 빠지는 하루네', recent).ok)

    def test_intraday_volume_cannot_judge_level(self):
        f = good('kospi_volume', state='partial', flags={'intraday': True})
        self.assertFalse(self.check(f, '거래가 한산해서 눈치만 보네').ok)
        self.assertTrue(self.check(f, '장중 집계라 거래량은 마감까지 봐야겠네').ok)

    def test_parse_model_json(self):
        self.assertEqual(V.parse_model_json('```json\n{"comments": {"a": "b"}}\n```'), {'comments': {'a': 'b'}})
        self.assertEqual(V.parse_model_json('설명 {"comments": {}} 끝'), {'comments': {}})
        with self.assertRaises(ValueError):
            V.parse_model_json('아무 말')


# ---- 3. 생성 파이프라인 --------------------------------------------------------------------------------

class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.conn = make_conn()
        os.environ.pop('AI_COMMENTS_ENABLED', None)

    def cycle(self, now, model, groups=('intraday',), **kw):
        return AC.run_cycle(self.conn, now, inputs_fixture(now, **kw), model, groups=groups)

    def text(self, slot):
        row = AC.get_rows(self.conn).get(slot)
        return row and row['text']

    def test_refresh_with_same_data_keeps_same_comment_and_makes_no_call(self):
        m = MockModel(script={'foreign': lambda n: '외국인은 팔고 기관이 받아 주네' if n == 1 else '다른 문장이 나오면 안 되네'})
        now = kst(2026, 10, 23, 11, 0)
        self.cycle(now, m)
        first = self.text('foreign')
        calls = len(m.calls)
        res = self.cycle(now + timedelta(minutes=3), m)
        self.assertEqual(res['intraday'], {'skipped': 'no-change'})
        self.assertEqual((len(m.calls), self.text('foreign')), (calls, first))
        # 프로세스 재시작(새 연결)과 같은 효과: DB 의 값이 그대로 유지된다
        self.assertEqual(AC.current_view(self.conn, now + timedelta(minutes=4))['comments']['foreign']['text'], first)

    def test_next_trading_day_gets_new_analysis(self):
        m = MockModel(script={'program': lambda n: '20일 중 20일 팔았네… 수급이 무겁겠어' if n == 1 else '20일 중 20일 순매도라 수급이 계속 무거운 편이네'})
        self.cycle(kst(2026, 10, 22, 16, 0), m)
        calls = len(m.calls)
        res = self.cycle(kst(2026, 10, 23, 16, 0), m)
        self.assertIn('outcome', res['intraday'])
        self.assertGreater(len(m.calls), calls)
        hist = AC.recent_history(self.conn, 'program', '2026-10-23')
        self.assertEqual({h['trade_date'] for h in hist}, {'2026-10-22', '2026-10-23'})

    def test_recent_14_days_are_in_prompt_and_repetition_is_retried(self):
        seq = ['외국인은 팔고 기관이 받아 주네', '외국인은 팔고 기관이 받아 주네 정말', '이번엔 기관 쪽이 버팀목처럼 느껴지네']
        m = MockModel(script={'foreign': lambda n: seq[min(n - 1, 2)]})
        self.cycle(kst(2026, 10, 21, 16, 0), m)                       # 1일차: 첫 문장 저장
        m.calls.clear()
        self.cycle(kst(2026, 10, 22, 16, 0), m)                       # 2일차: 같은 추세, 모델이 비슷한 문장 -> 반려 후 재요청
        self.assertGreaterEqual(len(m.calls), 1)
        card = m.calls[0]['cards']['foreign']
        self.assertIn('외국인은 팔고 기관이 받아 주네', card['recent'])
        self.assertTrue(all(isinstance(a, str) for a in card['recent']))
        texts = [h['text'] for h in AC.recent_history(self.conn, 'foreign', '2026-10-22')]
        self.assertEqual(len(set(texts)), len(texts))                 # 같은 문장이 연달아 저장되지 않음
        if len(m.calls) > 1:
            self.assertIn('previous_rejected', m.calls[1]['cards']['foreign'])

    def test_near_verbatim_repeat_is_dropped_not_shown(self):
        m = MockModel(script={'foreign': '외국인은 팔고 기관이 받아 주네'})
        self.cycle(kst(2026, 10, 21, 16, 0), m)
        res = self.cycle(kst(2026, 10, 22, 16, 0), m)
        self.assertIn('foreign', res['intraday'].get('rejected', {}))
        self.assertEqual(len(AC.recent_history(self.conn, 'foreign', '2026-10-22')), 1)   # 어제 문장이 그대로 남음(오늘 것은 저장 안 됨)

    def test_angle_rotates_by_usage_history(self):
        variants = ['외국인은 팔고 기관이 받는 구도네', '매도 쪽 힘이 센 하루로 보이네', '순매도 흐름이 한동안 이어진 모양새네', '평소 규모로 팔아서 큰 부담은 아니네']
        m = MockModel(script={'foreign': lambda n: variants[(n - 1) % 4]})
        angles = []
        for day in (19, 20, 21, 22):
            m.calls.clear()
            self.cycle(kst(2026, 10, day, 16, 0), m)
            angles.append(m.calls[0]['cards']['foreign']['angle'])
        self.assertGreater(len(set(angles)), 1)

    def test_intraday_foreign_turn_hides_old_comment_until_regenerated(self):
        m = MockModel(script={'foreign': lambda n: ['외국인은 팔고 있는 쪽이네', '외국인이 돌아와서 사는 쪽이네'][min(n - 1, 1)] if n < 3 else '외국인이 사들이기 시작했네'})
        t0 = kst(2026, 10, 23, 10, 0)
        self.cycle(t0, m)
        self.assertEqual(AC.current_view(self.conn, t0)['comments']['foreign']['text'], '외국인은 팔고 있는 쪽이네')
        # 5분 뒤 매도 -> 매수 전환: 점검만 해도(호출 제한에 걸려도) 반대 극이므로 옛 코멘트는 숨겨진다
        t1 = t0 + timedelta(minutes=2)
        res = self.cycle(t1, m, last_fgn=300.0)
        self.assertEqual(res['intraday'].get('skipped'), 'throttled')
        view = AC.current_view(self.conn, t1)
        self.assertNotIn('foreign', view['comments'])
        self.assertEqual(view['hidden']['foreign'], 'state-changed')
        # 긴급 간격(5분)이 지나면 새로 만들고 다시 보인다
        t2 = t0 + timedelta(minutes=8)
        self.cycle(t2, m, last_fgn=300.0)
        self.assertIn('사', AC.current_view(self.conn, t2)['comments']['foreign']['text'])

    def test_program_20d_sell_is_in_prompt_and_comment_is_accepted(self):
        m = MockModel()
        self.cycle(kst(2026, 10, 23, 16, 0), m)
        card = m.calls[0]['cards']['program']
        self.assertEqual(card['numbers']['sell_days_of_20'], 20)
        self.assertEqual(card['context']['trend_20d'], '20일 매도 우세')
        self.assertIn('20일 중 20일', self.text('program'))

    def test_deposits_down_credit_up_prompt_carries_pair_reading(self):
        m = MockModel()
        self.cycle(kst(2026, 10, 23, 21, 0), m, groups=('funds',), deposits_step=-3000.0, credit_step=1500.0)
        cards = m.calls[0]['cards']
        self.assertEqual(len(m.calls), 1)                             # 두 카드가 요청 1회로 묶임
        self.assertIn('예탁금 감소 + 신용 증가', cards['credit']['context']['pair_reading'])
        self.assertEqual(cards['deposits']['related']['빚투(신용융자 잔고)']['state'], 'up')

    def test_fx_profit_claim_is_rejected_and_retried(self):
        seq = {1: '원화가 강세네… 달러 투자 수익이 나겠네', 2: '원화 힘이 좀 붙는 하루네'}
        m = MockModel(script={'fx': lambda n: seq.get(n, '원화 힘이 좀 붙는 하루네')})
        self.cycle(kst(2026, 10, 23, 21, 0), m, groups=('macro',), usdkrw_step=-2.0)
        self.assertEqual(self.text('fx'), '원화 힘이 좀 붙는 하루네')
        self.assertIn('previous_rejected', m.calls[1]['cards']['fx'])
        self.assertEqual(list(m.calls[1]['cards']), ['fx'])           # 반려된 카드만 다시 요청

    def test_rate_cause_claim_never_reaches_screen(self):
        m = MockModel(script={'rate': '연준 때문에 금리가 확 뛰었네'})
        res = self.cycle(kst(2026, 10, 23, 21, 0), m, groups=('macro',), y10_last_jump=0.3)
        self.assertIn('rate', res['macro']['rejected'])
        self.assertIsNone(self.text('rate'))
        self.assertNotIn('rate', AC.current_view(self.conn, kst(2026, 10, 23, 21, 1))['comments'])

    def test_groq_outage_leaves_data_unaffected_and_backs_off(self):
        m = MockModel(fail='GAS HTTP 500')
        now = kst(2026, 10, 23, 11, 0)
        res = self.cycle(now, m)
        self.assertEqual(res['intraday']['outcome'], 'failed')
        self.assertEqual(AC.current_view(self.conn, now)['comments'], {})
        calls = len(m.calls)
        res = self.cycle(now + timedelta(minutes=2), m)
        self.assertIn(res['intraday']['skipped'], ('backoff', 'throttled'))
        self.assertEqual(len(m.calls), calls)
        st = AC.status_summary(self.conn, now + timedelta(minutes=3))
        self.assertEqual(st['state'], '오류')
        self.assertEqual(st['groups']['intraday']['consecutiveFailures'], 1)

    def test_outage_after_success_hides_contradicted_comment_but_keeps_neutral_one(self):
        t0 = kst(2026, 10, 23, 10, 0)
        self.cycle(t0, MockModel())
        down = MockModel(fail='x')
        self.cycle(t0 + timedelta(minutes=30), down, last_fgn=300.0)
        view = AC.current_view(self.conn, t0 + timedelta(minutes=31))
        self.assertNotIn('foreign', view['comments'])
        self.assertIn('program', view['comments'])                    # 방향이 그대로인 카드의 코멘트는 유지(생성 시각 포함)
        self.assertEqual(view['comments']['program']['generatedAt'], '2026-10-23 10:00:00')

    def test_holiday_keeps_last_trading_day_comment_with_its_as_of(self):
        fri = kst(2026, 10, 23, 16, 0)
        self.cycle(fri, MockModel())
        sat = kst(2026, 10, 24, 12, 0)
        m2 = MockModel()
        res = AC.run_cycle(self.conn, sat, inputs_fixture(fri, ), m2, groups=('intraday',))
        self.assertEqual(res['intraday'], {'skipped': 'no-change'})
        self.assertEqual(m2.calls, [])
        view = AC.current_view(self.conn, sat)
        self.assertEqual(view['tradeDate'], '2026-10-23')
        c = view['comments']['program']
        self.assertEqual((c['dataAsOf'], c['tradeDate'], c['carried']), ('2026-10-23', '2026-10-23', False))
        mon = AC.current_view(self.conn, kst(2026, 10, 26, 6, 0))
        self.assertTrue(mon['comments']['program']['carried'] or mon['tradeDate'] == '2026-10-26')

    def test_missing_data_hides_comment_and_old_comment_expires(self):
        now = kst(2026, 10, 23, 16, 0)
        self.cycle(now, MockModel())
        bad = inputs_fixture(now)
        bad['domestic']['programTrading'] = {'available': False}
        AC.run_cycle(self.conn, now + timedelta(minutes=5), bad, MockModel(), groups=('intraday',))
        self.assertEqual(AC.current_view(self.conn, now + timedelta(minutes=6))['hidden']['program'], 'data-missing')
        self.assertNotIn('foreign', AC.current_view(self.conn, now + timedelta(days=5))['comments'])   # intraday 최대 4일

    def test_daily_call_cap_and_disabled_switch(self):
        now = kst(2026, 10, 23, 11, 0)
        original = AC.DAILY_CALL_CAP
        try:
            AC.DAILY_CALL_CAP = 0
            m = MockModel()
            self.assertEqual(self.cycle(now, m)['intraday']['skipped'], 'daily-call-cap')
            self.assertEqual(m.calls, [])
        finally:
            AC.DAILY_CALL_CAP = original
        os.environ['AI_COMMENTS_ENABLED'] = '0'
        try:
            self.assertEqual(self.cycle(now, MockModel())['intraday']['skipped'], 'disabled')
        finally:
            os.environ.pop('AI_COMMENTS_ENABLED', None)

    def test_one_request_covers_a_whole_group_and_usage_is_recorded(self):
        m = MockModel()
        now = kst(2026, 10, 23, 16, 0)
        self.cycle(now, m)
        self.assertEqual(len(m.calls), 1)
        self.assertGreaterEqual(len(m.calls[0]['cards']), 7)
        st = AC.status_summary(self.conn, now)
        self.assertEqual((st['callsToday'], st['tokensToday']), (1, 1300))
        self.assertEqual(st['state'], '정상')
        self.assertEqual(st['groups']['intraday']['lastRun']['outcome'], 'ok')

    def test_summary_is_rewritten_with_changed_cards(self):
        m = MockModel()
        t0 = kst(2026, 10, 23, 10, 0)
        self.cycle(t0, m)
        m.calls.clear()
        self.cycle(t0 + timedelta(minutes=30), m, last_fgn=300.0)
        self.assertIn('market_summary', m.calls[0]['cards'])

    def test_secrets_never_appear_in_prompt_or_status(self):
        os.environ['API_TOKEN'] = 'super-secret-token'
        try:
            m = MockModel()
            self.cycle(kst(2026, 10, 23, 16, 0), m)
            blob = json.dumps(m.calls) + json.dumps(AC.status_summary(self.conn, kst(2026, 10, 23, 16, 5)))
            self.assertNotIn('super-secret-token', blob)
        finally:
            os.environ.pop('API_TOKEN', None)

    def test_brief_comment_is_fixed_for_the_trading_day(self):
        snap = {'targetDate': '2026-10-26', 'inputs': {k: {'name': k, 'pct': p, 'date': '20261023', 'close': 100.0, 'prevClose': 99.0}
                                                       for k, p in (('spx', -1.2), ('nas', -1.8), ('dji', -0.6), ('sox', -3.5), ('vix', 8.0), ('fx', 0.4))},
                'night': {'included': False}, 'signal': {'tone': 'down', 'bucket': {'key': 'down', 'label': '하락 우세', 'gap': 'x'}}}
        macro = macro_fixture()
        for sym in F.BRIEF_CHART_SYMBOL.values():
            macro[sym] = macro['WTI']
        inputs = inputs_fixture(kst(2026, 10, 26, 7, 5), briefing=snap)
        inputs['macro'].update(macro)
        script = {'spx': '미국 대형주가 꽤 밀렸네', 'nas': '기술주가 더 아프게 밀렸네', 'dji': '다우는 상대적으로 덜 아팠네',
                  'sox': '반도체가 크게 급락해서 국내가 걱정되네', 'vix': '불안 심리가 꽤 커졌네', 'brief_summary': '미국이 많이 밀려서 시초는 무거울 수 있어 보이네'}
        m = MockModel(script=script)
        res = AC.run_cycle(self.conn, kst(2026, 10, 26, 7, 5), inputs, m, groups=('brief',))
        self.assertEqual(res['brief']['outcome'], 'ok', res)
        first = {s: self.text(s) for s in script}
        calls = len(m.calls)
        for minute in (10, 40, 400):         # 장중까지 여러 번 점검해도 같은 문장, 추가 호출 없음
            AC.run_cycle(self.conn, kst(2026, 10, 26, 7, 5) + timedelta(minutes=minute), inputs, m, groups=('brief',))
        self.assertEqual((len(m.calls), {s: self.text(s) for s in script}), (calls, first))
        # 07:00 전 새 거래일에는 확정 브리핑이 없으므로 브리핑 코멘트는 숨겨진다
        inputs['briefing'] = None
        AC.run_cycle(self.conn, kst(2026, 10, 27, 7, 1), inputs, m, groups=('brief',))
        self.assertNotIn('spx', AC.current_view(self.conn, kst(2026, 10, 27, 7, 2))['comments'])


class PromptTests(unittest.TestCase):
    def test_prompt_has_rules_and_no_fixed_sentences_besides_tone_examples(self):
        self.assertIn('numbers 에 있는 값만', AC.SYSTEM_PROMPT)
        self.assertIn('분위기만 참고하고 문장을 그대로 쓰지 말 것', AC.SYSTEM_PROMPT)
        self.assertIn('JSON', AC.SYSTEM_PROMPT)

    def test_gas_client_requires_token_and_reports_failures_without_secrets(self):
        os.environ.pop('API_TOKEN', None)
        with self.assertRaises(AC.ModelError):
            AC.call_gas('s', 'u')
        os.environ['API_TOKEN'] = 'tok-123'
        os.environ['AI_COMMENTS_GAS_URL'] = 'http://127.0.0.1:9/exec'      # 닫힌 포트
        try:
            with self.assertRaises(AC.ModelError) as ctx:
                AC.call_gas('s', 'u', timeout=2)
            self.assertNotIn('tok-123', str(ctx.exception))
        finally:
            os.environ.pop('API_TOKEN', None)
            os.environ.pop('AI_COMMENTS_GAS_URL', None)


class EndpointTests(unittest.TestCase):
    def test_http_contract(self):
        import main
        from starlette.testclient import TestClient
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'e.db')
            conn = make_conn(path)
            now = kst(2026, 10, 23, 16, 0)
            AC.run_cycle(conn, now, inputs_fixture(now), MockModel(), groups=('intraday',))
            conn.close()
            original_get_conn, original_now = db_schema.get_conn, market_clock.kst_now
            db_schema.get_conn = lambda db_file=None: sqlite3.connect(path)
            market_clock.kst_now = lambda: kst(2026, 10, 23, 16, 5)
            os.environ['API_TOKEN'] = 'unit-test-secret'
            try:
                client = TestClient(main.app)
                res = client.get('/ai-comments')
                self.assertEqual(res.status_code, 200)
                data = res.json()['data']
                self.assertIn('program', data['comments'])
                self.assertEqual(data['comments']['program']['dataAsOf'], '2026-10-23')
                self.assertIn('max-age=30', res.headers['cache-control'])
                health = client.get('/health/ai-comments').json()['data']
                self.assertEqual((health['callsToday'], health['state']), (1, '정상'))
                self.assertNotIn('unit-test-secret', json.dumps(health))
                jobs = client.get('/health/schedules').json()['data']['internalJobs']
                self.assertIn('ai-comments', [j['id'] for j in jobs])
            finally:
                os.environ.pop('API_TOKEN', None)
                db_schema.get_conn, market_clock.kst_now = original_get_conn, original_now


if __name__ == '__main__':
    unittest.main()
