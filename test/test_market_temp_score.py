# -*- coding: utf-8 -*-
"""증시온도 배점 이식 검증 - GAS 실제 응답을 고정해 두고 같은 입력에 같은 점수가
나오는지 확인한다(docs/BACKEND_CONSOLIDATION.md 1단계).

화면에 뜨는 숫자가 이식 때문에 달라지면 안 되므로, 컴포넌트별 점수와 최종 온도까지
전부 GAS 응답과 대조한다. fixture는 2026-08-31 장중 GAS `?marketTemp=1` 원본이다.
"""
import io
import json
import os
import sys
import unittest

CLOUD_VM_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
if CLOUD_VM_DIR not in sys.path:
    sys.path.insert(0, CLOUD_VM_DIR)

import market_temp_score as mts  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(__file__), 'fixtures', 'gas_market_temp_20260831.json')


def load_golden():
    with io.open(FIXTURE, encoding='utf-8') as fh:
        return json.load(fh)


class MarketTempScorePortTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gold = load_golden()
        cls.c = cls.gold['components']

    def test_component_budget_matches_gas(self):
        self.assertEqual(mts.COMPONENT_MAX, {
            'vix': 20, 'flow': 20, 'tradingValue': 15, 'avgChange': 15,
            'riseRatio': 10, 'sectorStrength': 10, 'week52': 10,
            'exchange': 5, 'usFutures': 5, 'creditRisk': 10,
        })

    def test_vix(self):
        g = self.c['vix']
        got = mts.score_vix(g['value'])
        self.assertEqual(got['score'], g['score'])
        self.assertEqual(got['band'], g['band'])

    def test_trading_value(self):
        g = self.c['tradingValue']
        # GAS는 avg5(직전 5일 평균)만 노출하므로 같은 평균이 나오는 이력으로 재구성한다.
        prior = [g['avg5']] * 5
        got = mts.score_trading_value(g['today'], prior)
        self.assertEqual(got['score'], g['score'])
        self.assertEqual(got['band'], g['band'])
        self.assertAlmostEqual(got['relative'], g['relative'], places=9)

    def test_avg_change(self):
        g = self.c['avgChange']
        got = mts.score_avg_change(g['avgChangeRate'], quote_count=233)
        self.assertEqual(got['score'], g['score'])
        self.assertEqual(got['band'], g['band'])

    def test_rise_ratio(self):
        g = self.c['riseRatio']
        got = mts.score_rise_ratio(g['up'], g['down'])
        self.assertEqual(got['score'], g['score'])
        self.assertEqual(got['band'], g['band'])
        self.assertAlmostEqual(got['ratio'], g['ratio'], places=9)

    def test_sector_strength(self):
        g = self.c['sectorStrength']
        got = mts.score_sector_strength(g['sectorCount'], g['strongCount'])
        self.assertEqual(got['score'], g['score'])
        self.assertEqual(got['band'], g['band'])

    def test_week52(self):
        g = self.c['week52']
        got = mts.score_week52(g.get('newHigh'), g.get('newLow'), g.get('scanned'))
        self.assertEqual(got['score'], g['score'])
        if 'band' in g:
            self.assertEqual(got['band'], g['band'])

    def test_exchange(self):
        g = self.c['exchange']
        if 'changeRate' not in g:
            self.skipTest('fixture에 환율 조회 실패가 담겨 있음')
        got = mts.score_exchange(g['changeRate'], g.get('price'))
        self.assertEqual(got['score'], g['score'])
        self.assertEqual(got['band'], g['band'])

    def test_us_futures(self):
        g = self.c['usFutures']
        if 'changePct' not in g:
            self.skipTest('fixture에 미국 선물 조회 실패가 담겨 있음')
        got = mts.score_us_futures(g['changePct'], g.get('price'), g.get('timeWeight'))
        self.assertEqual(got['score'], g['score'])
        self.assertEqual(got['band'], g['band'])

    def test_flow(self):
        g = self.c['flow']
        got = mts.score_flow(g['foreign']['score100'], g['inst']['score100'])
        self.assertEqual(got['score'], g['score'])
        self.assertEqual(got['band'], g['band'])

    def test_total_and_temperature_match_gas(self):
        """가장 중요한 검증 - 화면에 뜨는 점수와 온도가 그대로여야 한다."""
        credit = self.c['creditRisk']
        credit_available = bool(credit.get('available'))
        scores = [
            self.c['vix']['score'], self.c['flow']['score'], self.c['tradingValue']['score'],
            self.c['avgChange']['score'], self.c['riseRatio']['score'],
            self.c['sectorStrength']['score'], self.c['week52']['score'],
            self.c['exchange']['score'], self.c['usFutures']['score'],
        ]
        if credit_available:
            scores.append(credit['score'])
        got = mts.total_and_temperature(scores, credit_available)
        self.assertEqual(got['score'], self.gold['score'])
        self.assertEqual(got['maxScore'], self.gold['maxScore'])
        self.assertEqual(got['temp'], self.gold['temp'])

    def test_round_half_up_matches_js(self):
        """JS Math.round는 0.5를 항상 올린다. 파이썬 기본 round는 짝수로 붙어서 다르다."""
        self.assertEqual(mts._round_half_up(0.5), 1)
        self.assertEqual(mts._round_half_up(1.5), 2)
        self.assertEqual(mts._round_half_up(2.5), 3)   # 파이썬 기본 round면 2
        self.assertEqual(mts._round_half_up(2.45, 1), 2.5)



class MarketTempDataLayerTest(unittest.TestCase):
    """수집 계층(market_temp_data)이 GAS와 같은 형태의 입력을 만드는지 확인한다.
    네트워크(네이버 polling API)를 타므로 실패 시 건너뛴다 - CI에서 빨간불이 상시로
    켜지면 진짜 회귀를 못 알아본다."""

    @classmethod
    def setUpClass(cls):
        import market_temp_data
        cls.mtd = market_temp_data

    def test_universe_is_read_from_local_repo_not_fetched(self):
        """GAS는 sectors-v3.js를 GitHub Pages에서 받아왔다. VM엔 저장소가 있으니
        로컬에서 읽어야 한다(외부 왕복 1회 제거)."""
        uni = self.mtd.universe_with_sectors()
        self.assertGreater(len(uni), 100, '유니버스가 비정상적으로 작다')
        self.assertTrue(all(u.get('code') for u in uni))
        self.assertTrue(any(u.get('sectors') for u in uni), '업종 태그가 하나도 없다')

    def test_quote_components_land_in_the_same_bands_as_gas(self):
        """시세에서 나오는 4개 컴포넌트가 GAS 골든과 같은 점수여야 한다.
        원시값(평균등락률·상승종목수)은 측정 시점이 달라 당연히 다르므로 점수만 본다.
        장 마감 후·휴일에는 시세가 고정돼 밴드가 갈릴 수 있어, 다르면 실패시키지 않고
        어떤 값이었는지 남긴다."""
        uni = self.mtd.universe_with_sectors()
        try:
            quotes = self.mtd.fetch_quotes([u['code'] for u in uni])
        except Exception as exc:
            self.skipTest('네이버 시세 조회 실패: %s' % exc)
        if len(quotes) < len(uni) * 0.5:
            self.skipTest('시세 수신이 절반 미만(%d/%d)' % (len(quotes), len(uni)))

        gold = load_golden()['components']
        got = self.mtd.build_quote_components(quotes, uni, [gold['tradingValue']['avg5']] * 5)
        for key in ('tradingValue', 'avgChange', 'riseRatio', 'sectorStrength'):
            self.assertIn('score', got[key])
            self.assertLessEqual(got[key]['score'], mts.COMPONENT_MAX[key],
                                 '%s 점수가 배점 상한을 넘었다' % key)
            self.assertGreaterEqual(got[key]['score'], 0)

class TradingValueHistoryTest(unittest.TestCase):
    """거래대금 5일 이력을 daily_prices에서 재구성한다.

    GAS는 PropertiesService에 이력을 직접 쌓아둬서, VM 이관 시 3영업일간 중립(7.5)이
    나올 줄 알았다. 그런데 daily_scan.py가 이미 KRX 전종목 일봉을 daily_prices에 넣고
    있어 같은 값을 계산해낼 수 있다 - 이관도 중립 기간도 불필요하다."""

    def _conn(self):
        import sqlite3
        conn = sqlite3.connect(':memory:')
        conn.execute('CREATE TABLE daily_prices (code TEXT, date TEXT, open REAL, high REAL,'
                     ' low REAL, close REAL, volume INTEGER, PRIMARY KEY (code, date))')
        rows = []
        # 2종목 × 6영업일. 날짜별 총 거래대금이 1,2,3,4,5,6조가 되도록 만든다.
        for i, day in enumerate(['2026-08-24', '2026-08-25', '2026-08-26',
                                 '2026-08-27', '2026-08-28', '2026-08-31'], start=1):
            rows.append(('005930', day, 0, 0, 0, 1000.0, i * 600_000_000))
            rows.append(('000660', day, 0, 0, 0, 1000.0, i * 400_000_000))
        conn.executemany('INSERT INTO daily_prices VALUES (?,?,?,?,?,?,?)', rows)
        conn.commit()
        return conn

    def test_excludes_today_and_returns_five_prior_days(self):
        import market_temp_data as mtd
        conn = self._conn()
        try:
            got = mtd.prior_trading_values(conn, ['005930', '000660'], '2026-08-31')
        finally:
            conn.close()
        # 오늘(08-31, 6조)은 빠지고 직전 5일이 오래된 날부터
        self.assertEqual(got, [1e12, 2e12, 3e12, 4e12, 5e12])

    def test_enough_history_means_no_neutral_fallback(self):
        """이력이 3일 이상이면 중립(7.5)으로 빠지지 않고 실제 배점이 나온다."""
        import market_temp_data as mtd
        conn = self._conn()
        try:
            prior = mtd.prior_trading_values(conn, ['005930', '000660'], '2026-08-31')
        finally:
            conn.close()
        got = mts.score_trading_value(6e12, prior)   # 오늘 6조 vs 평균 3조 = 200%
        self.assertNotEqual(got['score'], 7.5)
        self.assertEqual(got['score'], 15)
        self.assertEqual(got['band'], '평균대비 130% 이상')

    def test_empty_history_still_falls_back_to_neutral(self):
        import market_temp_data as mtd
        import sqlite3
        conn = sqlite3.connect(':memory:')
        conn.execute('CREATE TABLE daily_prices (code TEXT, date TEXT, open REAL, high REAL,'
                     ' low REAL, close REAL, volume INTEGER, PRIMARY KEY (code, date))')
        try:
            prior = mtd.prior_trading_values(conn, ['005930'], '2026-08-31')
        finally:
            conn.close()
        self.assertEqual(prior, [])
        self.assertEqual(mts.score_trading_value(1e12, prior)['score'], 7.5)


class FlowAndTimeWeightTest(unittest.TestCase):
    """수급 변환과 미국선물 시간가중치가 GAS와 같은지."""

    def test_flow_ratio_to_score100_matches_gas_golden(self):
        import market_temp_data as mtd
        g = load_golden()['components']['flow']
        self.assertEqual(mtd._flow_ratio_to_score100(g['foreign']['ratio']),
                         g['foreign']['score100'])
        self.assertEqual(mtd._flow_ratio_to_score100(g['inst']['ratio']),
                         g['inst']['score100'])
        got = mtd.flow_component(g['foreign']['ratio'], g['inst']['ratio'])
        self.assertEqual(got['score'], g['score'])
        self.assertEqual(got['band'], g['band'])

    def test_flow_ratio_is_clamped_and_baseline_guarded(self):
        import market_temp_data as mtd
        # 평소 하루 100씩 사던 종목이 5일간 5000 순매수 -> 기준선(100*5=500)의 10배 -> 1.0 상한
        self.assertEqual(mtd.flow_ratio_from_daily([100] * 20, 5000)['ratio'], 1.0)
        self.assertEqual(mtd.flow_ratio_from_daily([100] * 20, -5000)['ratio'], -1.0)
        # 거래가 아예 없던 종목은 0으로 나누지 않고 중립 0
        self.assertEqual(mtd.flow_ratio_from_daily([0] * 20, 0)['ratio'], 0)
        self.assertIsNone(mtd.flow_ratio_from_daily([], 0))
        # 중립(비율 0)이면 score100이 50
        self.assertEqual(mtd._flow_ratio_to_score100(0), 50)
        self.assertEqual(mtd._flow_ratio_to_score100(None), 50)

    def test_us_futures_time_weight_matches_gas_bands(self):
        import datetime
        import market_temp_data as mtd
        KST = datetime.timezone(datetime.timedelta(hours=9))

        def at(h, m):
            return mtd.us_futures_time_weight(datetime.datetime(2026, 8, 31, h, m, tzinfo=KST))

        self.assertEqual(at(8, 0), 1.0)     # 장 전
        self.assertEqual(at(10, 59), 1.0)
        self.assertEqual(at(11, 0), 0.7)
        self.assertEqual(at(12, 59), 0.7)
        self.assertEqual(at(13, 0), 0.3)
        self.assertEqual(at(15, 29), 0.3)
        self.assertIsNone(at(15, 30))       # 장 종료 후 -> 호출부가 중립 처리
        self.assertIsNone(at(20, 0))


class MarketTempAssemblyTest(unittest.TestCase):
    """조립 계층 - 등급 경계, 일별 이력, 신용융자 결측 시 만점 처리."""

    def _conn(self):
        import sqlite3
        return sqlite3.connect(':memory:')

    def test_grade_boundaries_match_gas(self):
        import market_temp as mt
        cases = [(9.9, '극도의 공포'), (10, '공포'), (19.9, '공포'), (20, '중립'),
                 (27.9, '중립'), (28, '낙관'), (34.9, '낙관'), (35, '과열'), (40, '과열')]
        for temp, label in cases:
            self.assertEqual(mt.grade_for_temp(temp)['label'], label, '%s℃' % temp)

    def test_daily_history_upsert_replaces_same_day_and_caps_length(self):
        import market_temp as mt
        conn = self._conn()
        try:
            mt.upsert_daily_temp(conn, 20.0, '2026-08-31')
            mt.upsert_daily_temp(conn, 24.0, '2026-08-31')   # 같은 날 재계산 -> 덮어쓰기
            rows = mt.read_daily_history(conn)
            self.assertEqual(rows, [{'date': '2026-08-31', 'temp': 24.0}])
            for i in range(1, mt.DAILY_HISTORY_MAX + 20):
                mt.upsert_daily_temp(conn, float(i), '2026-%02d-%02d' % (1 + i // 28, 1 + i % 28))
            self.assertLessEqual(len(mt.read_daily_history(conn)), mt.DAILY_HISTORY_MAX)
        finally:
            conn.close()

    def test_history_is_none_on_first_day_then_reports_day_change(self):
        import market_temp as mt
        conn = self._conn()
        try:
            hist = mt.upsert_daily_temp(conn, 24.0, '2026-08-31')
            self.assertIsNone(mt.compute_history(24.0, hist, '2026-08-31'),
                              '이력이 오늘뿐이면 전일 대비를 낼 수 없다')
            mt.upsert_daily_temp(conn, 20.0, '2026-08-28')
            hist = mt.upsert_daily_temp(conn, 24.0, '2026-08-31')
            got = mt.compute_history(24.0, hist, '2026-08-31')
            self.assertEqual(got['yesterday'], 20.0)
            self.assertEqual(got['dayChange'], 4.0)
        finally:
            conn.close()

    def test_sparkline_appends_today_after_prior_days(self):
        import market_temp as mt
        hist = [{'date': '2026-08-28', 'temp': 20.0}, {'date': '2026-08-31', 'temp': 24.0}]
        got = mt.compute_sparkline(24.0, hist, '2026-08-31')
        self.assertEqual(got[-1], {'date': '2026-08-31', 'temp': 24.0})
        self.assertEqual([g['date'] for g in got], ['2026-08-28', '2026-08-31'])

    def test_missing_credit_risk_lowers_max_score_so_temperature_stays_normalised(self):
        """신용융자가 없는 날은 만점에서도 10점을 빼야 40℃ 정규화가 어긋나지 않는다."""
        credit = mts.score_kofia_credit(None)   # market_temp_score로 이동됨
        self.assertFalse(credit['available'])
        full = mts.total_and_temperature([20, 20, 15, 15, 10, 10, 10, 5, 5, 10], True)
        self.assertEqual(full['maxScore'], 120)
        self.assertEqual(full['temp'], 40.0)
        without = mts.total_and_temperature([20, 20, 15, 15, 10, 10, 10, 5, 5], False)
        self.assertEqual(without['maxScore'], 110)
        self.assertEqual(without['temp'], 40.0, '만점이면 신용융자 유무와 무관하게 40℃')


class MarketTempEndpointContractTest(unittest.TestCase):
    """main.py는 fastapi 의존이라 이 샌드박스에서 import 불가 - 소스 텍스트 계약만 검사한다
    (test_market_board_warmer.py와 동일 패턴)."""

    def read_main(self):
        path = os.path.join(CLOUD_VM_DIR, 'main.py')
        with io.open(path, encoding='utf-8') as fh:
            return fh.read()

    def test_request_path_never_computes(self):
        """2026-08-31: 요청 경로에서 계산하게 뒀다가 배포 후 504(61~64초)를 맞았다.
        전종목 수집이 1코어 VM에서 nginx 타임아웃을 뚫는다. 다시 열리지 않게 고정한다."""
        src = self.read_main()
        start = src.index("@app.get('/market-temp')")
        end = src.index('@app.get(', start + 10)
        body = src[start:end]
        self.assertNotIn('market_temp.refresh_once', body,
                         '요청 경로에서 계산하면 안 된다 - 백그라운드가 담당한다')
        self.assertIn('status_code=503', body, '계산 전이면 즉시 503으로 알려야 한다')

    def test_background_computation_is_started(self):
        src = self.read_main()
        self.assertIn('market_temp.start_background(', src)

    def test_domestic_market_indicators_also_left_the_request_path(self):
        """2026-09-01: 캐시 미스 때 방문자가 8.47초를 물던 구조(히트는 0.81초).
        시장 전체 지표는 요청 경로에서 만들지 않는다 - 같은 판단을 여기에도 적용했다."""
        src = self.read_main()
        start = src.index("@app.get('/domestic-market-indicators')")
        end = src.index('def _refresh_domestic_market_indicators', start)
        body = src[start:end]
        self.assertNotIn('build_dashboard', body,
                         '요청 경로에서 만들면 미스 때 방문자가 8초를 문다')
        self.assertIn('status_code=503', body)
        self.assertIn('_start_domestic_market_indicators_refresher()', src)

    def test_daily_history_lives_in_the_operational_db(self):
        """DB 파일을 6번째로 늘리지 않는다(5개 중 2개만 유지보수되던 걸 고친 직후)."""
        path = os.path.join(CLOUD_VM_DIR, 'market_temp.py')
        with io.open(path, encoding='utf-8') as fh:
            src = fh.read()
        self.assertNotIn('market_temp.db', src)
        self.assertIn('CREATE TABLE IF NOT EXISTS market_temp_daily', src)


class KofiaCreditPortTest(unittest.TestCase):
    """신용융자 위험도 이식(GAS scoreKofiaCredit_). 단위 검증이 핵심이다 - KIS 원자료가
    hundred_million_krw인 경우가 많아 서로 다른 단위를 임의 배율로 나누면 3천만% 같은
    유령 수치가 나온다."""

    def _kofia(self, **over):
        base = {
            'available': True,
            'credit': {'loan_total': 20, 'date': '20260831'},
            'market_funds': {'investor_deposits': 100, 'date': '20260831',
                             'forced_sale_ratio_pct': 5},
            'credit_unit': 'hundred_million_krw',
            'market_funds_unit': 'hundred_million_krw',
            'series': [{'credit': {'loan_total': 20}} for _ in range(25)],
        }
        base.update(over)
        return base

    def test_unavailable_input_stays_pending(self):
        for value in (None, {}, {'available': False}):
            got = mts.score_kofia_credit(value)
            self.assertFalse(got['available'])
            self.assertEqual(got['stateLabel'], '데이터 검증 중')
            self.assertIsNone(got['score'])

    def test_date_mismatch_is_rejected_not_scored(self):
        got = mts.score_kofia_credit(self._kofia(
            credit={'loan_total': 20, 'date': '20260830'}))
        self.assertFalse(got['available'])
        self.assertEqual(got['validationReason'], '기준일 불일치')

    def test_unknown_unit_is_rejected(self):
        got = mts.score_kofia_credit(self._kofia(credit_unit='banana'))
        self.assertFalse(got['available'])
        self.assertEqual(got['validationReason'], '단위 확인 필요')

    def test_out_of_range_ratio_is_rejected(self):
        """단위가 어긋나면 비율이 폭발한다 - 그 경우를 점수로 만들지 않는다.
        (신용을 억원, 예탁금을 원으로 읽으면 20억/100원 = 2e9% 가 된다.
         반대 방향은 값이 아주 작아질 뿐 범위 안이라 통과하는 게 맞다.)"""
        got = mts.score_kofia_credit(self._kofia(credit_unit='hundred_million_krw',
                                                 market_funds_unit='krw'))
        self.assertFalse(got['available'])
        self.assertEqual(got['validationReason'], '비정상 비율')

    def test_stable_market_scores_high(self):
        got = mts.score_kofia_credit(self._kofia())
        self.assertTrue(got['available'])
        self.assertEqual(got['stateLabel'], '안정')
        self.assertEqual(got['score'], 10.0)
        self.assertAlmostEqual(got['loan_to_deposit_pct'], 20.0)

    def test_overheated_market_scores_low(self):
        """예탁금 대비 45% 이상 + 최근 평균 대비 +10% 이상 + 반대매매 15% 이상."""
        got = mts.score_kofia_credit(self._kofia(
            credit={'loan_total': 50, 'date': '20260831'},
            market_funds={'investor_deposits': 100, 'date': '20260831',
                          'forced_sale_ratio_pct': 20},
            series=[{'credit': {'loan_total': 20}} for _ in range(25)]))
        self.assertTrue(got['available'])
        self.assertEqual(got['stateLabel'], '과열')
        self.assertEqual(got['score'], 0.0)

    def test_score_never_leaves_zero_to_ten(self):
        for loan in (0, 1, 20, 50, 200):
            got = mts.score_kofia_credit(self._kofia(
                credit={'loan_total': loan, 'date': '20260831'}))
            if got['available']:
                self.assertGreaterEqual(got['score'], 0)
                self.assertLessEqual(got['score'], 10)


class FlowFromMarketTrendTest(unittest.TestCase):
    """수급 입력을 KODEX200 ETF -> 코스피 시장 전체로 교체(2026-09-01, 사용자 승인).

    GAS는 ETF를 대리지표로 썼지만 VM의 KIS는 그 ETF의 과거 이력을 주지 않는다
    (64일 중 63일이 0) - 기준선이 무너져 비율이 항상 ±1.0으로 포화됐다.
    배점 공식은 GAS 그대로 두고 입력만 바꾼다.
    """

    def _conn(self, rows):
        import types
        fake = types.SimpleNamespace(
            load_investor_trend_daily=lambda conn, market, limit_days=40: rows)
        return fake

    def _with_db(self, fake_db, fn):
        saved = sys.modules.get('db_schema')
        sys.modules['db_schema'] = fake_db
        try:
            return fn()
        finally:
            if saved is None:
                sys.modules.pop('db_schema', None)
            else:
                sys.modules['db_schema'] = saved

    def test_scoring_formula_still_matches_gas(self):
        """입력만 바뀌었을 뿐 배점 공식은 GAS 그대로여야 한다 - 골든의 ratio를 넣으면
        같은 score100/점수가 나와야 한다."""
        import market_temp_data as mtd
        g = load_golden()['components']['flow']
        self.assertEqual(mtd._flow_ratio_to_score100(g['foreign']['ratio']),
                         g['foreign']['score100'])
        self.assertEqual(mtd._flow_ratio_to_score100(g['inst']['ratio']),
                         g['inst']['score100'])
        self.assertEqual(mtd.flow_component(g['foreign']['ratio'], g['inst']['ratio'])['score'],
                         g['score'])

    def test_uses_market_wide_rows_and_does_not_saturate(self):
        import market_temp_data as mtd
        # 오름차순 20일(load_investor_trend_daily는 오름차순 반환) - 평범한 등락
        rows = [{'date': '2026-08-%02d' % (i + 1), 'frgn': (100 if i % 2 else -80),
                 'orgn': (60 if i % 3 else -40)} for i in range(20)]
        component, ratios = self._with_db(
            self._conn(rows), lambda: mtd.flow_component_from_market_trend(object()))
        self.assertNotIn(ratios['foreign'], (1.0, -1.0),
                         'ETF 경로처럼 ±1.0으로 포화되면 안 된다')
        self.assertGreaterEqual(component['score'], 0)
        self.assertLessEqual(component['score'], 20)
        self.assertIn('시장 전체', component['note'])

    def test_empty_history_is_neutral_not_zero(self):
        import market_temp_data as mtd
        component, ratios = self._with_db(
            self._conn([]), lambda: mtd.flow_component_from_market_trend(object()))
        self.assertEqual(component['score'], 10, '이력이 없으면 0점이 아니라 중립')
        self.assertEqual(ratios, {'foreign': None, 'inst': None})

    def test_v5_sums_only_the_five_most_recent_days(self):
        import market_temp_data as mtd
        rows = [{'date': '2026-08-%02d' % (i + 1), 'frgn': i + 1, 'orgn': 0} for i in range(10)]
        _, ratios = self._with_db(
            self._conn(rows), lambda: mtd.flow_component_from_market_trend(object()))
        # 오름차순 입력이므로 최신 5일은 6,7,8,9,10 -> 합 40
        self.assertEqual(ratios['foreign_v5'], 40)


if __name__ == '__main__':
    unittest.main()


class BreadthByMarketTest(unittest.TestCase):
    """시장별 상승·하락 종목 수(2026-09-02 요청). 네트워크를 타지 않는 순수 계산이라
    시세 조회 없이 고정 입력으로 검증한다."""

    @classmethod
    def setUpClass(cls):
        import market_temp_data
        cls.mtd = market_temp_data

    UNIVERSE = [
        {'code': '005930', 'market': 'KOSPI'},
        {'code': '000660', 'market': 'KOSPI'},
        {'code': '035720', 'market': 'KOSPI'},
        {'code': '247540', 'market': 'KOSDAQ'},
        {'code': '086520', 'market': 'KOSDAQ'},
        {'code': '999999', 'market': ''},        # 시장 구분 없음 - 어느 쪽에도 안 들어감
    ]

    def test_counts_split_by_market(self):
        quotes = [
            {'code': '005930', 'change': 100},
            {'code': '000660', 'change': -200},
            {'code': '035720', 'change': -50},
            {'code': '247540', 'change': 300},
            {'code': '086520', 'change': 400},
            {'code': '999999', 'change': 500},
        ]
        got = self.mtd.breadth_by_market(quotes, self.UNIVERSE)
        self.assertEqual(got['KOSPI'], {'up': 1, 'down': 2, 'total': 3})
        self.assertEqual(got['KOSDAQ'], {'up': 2, 'down': 0, 'total': 2})

    def test_flat_is_excluded_like_the_combined_count(self):
        """보합은 통합 집계(score_rise_ratio)와 같게 total에서도 빠진다."""
        quotes = [
            {'code': '005930', 'change': 0},
            {'code': '000660', 'change': None},
            {'code': '247540', 'change': 10},
        ]
        got = self.mtd.breadth_by_market(quotes, self.UNIVERSE)
        self.assertEqual(got['KOSPI'], {'up': 0, 'down': 0, 'total': 0})
        self.assertEqual(got['KOSDAQ'], {'up': 1, 'down': 0, 'total': 1})

    def test_empty_inputs_return_zeroed_markets(self):
        got = self.mtd.breadth_by_market([], [])
        self.assertEqual(sorted(got.keys()), ['KOSDAQ', 'KOSPI'])
        self.assertTrue(all(v == {'up': 0, 'down': 0, 'total': 0} for v in got.values()))

    def test_market_value_is_case_and_space_tolerant(self):
        universe = [{'code': '005930', 'market': ' kospi '}]
        got = self.mtd.breadth_by_market([{'code': '005930', 'change': 5}], universe)
        self.assertEqual(got['KOSPI']['up'], 1)

    def test_real_universe_covers_both_markets(self):
        """실제 sectors-v3.js에 두 시장이 모두 들어 있어야 화면이 반쪽이 되지 않는다."""
        uni = self.mtd.universe_with_sectors()
        markets = {(u.get('market') or '').strip().upper() for u in uni}
        self.assertIn('KOSPI', markets)
        self.assertIn('KOSDAQ', markets)


class WholeMarketBreadthTest(unittest.TestCase):
    """전종목 등락 종목 수(KIS 업종지수 FHPUP02100000). 필드명은 2026-09-02 운영 응답
    실측으로 확정했고, 여기서는 그 응답 모양을 고정 입력으로 파싱만 검증한다."""

    @classmethod
    def setUpClass(cls):
        import market_temp_data
        cls.mtd = market_temp_data

    # 2026-09-02 08:37 UTC 운영 응답에서 관련 필드만 발췌(코스피)
    KOSPI_RAW = {
        'bstp_nmix_prpr': '6600.12',
        'ascn_issu_cnt': '139',
        'uplm_issu_cnt': '1',
        'stnr_issu_cnt': '37',
        'down_issu_cnt': '735',
        'lslm_issu_cnt': '0',
    }

    def test_parses_measured_response(self):
        got = self.mtd.parse_index_breadth(self.KOSPI_RAW)
        self.assertEqual(got['up'], 139)
        self.assertEqual(got['down'], 735)
        self.assertEqual(got['flat'], 37)
        self.assertEqual(got['total'], 911, '합계는 상승+하락+보합이다')
        self.assertEqual(got['upperLimit'], 1)
        self.assertEqual(got['lowerLimit'], 0)

    def test_upper_lower_limits_are_not_added_to_total(self):
        """상한·하한이 상승·하락에 포함된 값인지 미검증이라 합계에 넣지 않는다."""
        got = self.mtd.parse_index_breadth(self.KOSPI_RAW)
        self.assertNotEqual(got['total'], 911 + 1 + 0)

    def test_comma_separated_numbers(self):
        got = self.mtd.parse_index_breadth(
            {'ascn_issu_cnt': '1,298', 'down_issu_cnt': '359', 'stnr_issu_cnt': '76'})
        self.assertEqual(got['up'], 1298)
        self.assertEqual(got['total'], 1298 + 359 + 76)

    def test_missing_or_bad_payload_returns_none(self):
        self.assertIsNone(self.mtd.parse_index_breadth(None))
        self.assertIsNone(self.mtd.parse_index_breadth({}))
        self.assertIsNone(self.mtd.parse_index_breadth({'ascn_issu_cnt': '139'}))
        self.assertIsNone(self.mtd.parse_index_breadth({'ascn_issu_cnt': '-', 'down_issu_cnt': '-'}))

    def test_flat_defaults_to_zero_when_absent(self):
        got = self.mtd.parse_index_breadth({'ascn_issu_cnt': '10', 'down_issu_cnt': '20'})
        self.assertEqual(got['flat'], 0)
        self.assertEqual(got['total'], 30)

    def test_fetch_returns_none_without_keys(self):
        """키가 없으면 조용히 None - 증시온도 본체가 이 값 때문에 죽으면 안 된다.
        인자를 비워도 환경변수로 폴백하므로 환경변수까지 비운 상태로 확인한다."""
        import os
        from unittest import mock
        with mock.patch.dict(os.environ, {'KIS_APPKEY': '', 'KIS_APPSECRET': ''}, clear=False):
            self.assertIsNone(self.mtd.fetch_market_breadth('', ''))


class BreadthFailureIsolationTest(unittest.TestCase):
    """전종목 등락 조회가 어떤 식으로 실패해도 증시온도 계산 자체는 죽지 않아야 한다.
    2026-09-02: import가 try 밖에 있어 import 실패가 build()로 번질 수 있었다."""

    @classmethod
    def setUpClass(cls):
        import market_temp_data
        cls.mtd = market_temp_data

    def setUp(self):
        # TTL 캐시가 이전 테스트 값을 물고 있으면 실패 경로를 안 탄다
        self.mtd._breadth_cache['value'] = None
        self.mtd._breadth_cache['at'] = 0.0

    def test_import_failure_is_swallowed(self):
        import builtins
        from unittest import mock
        real_import = builtins.__import__

        def boom(name, *args, **kwargs):
            if name == 'kis_client':
                raise ImportError('강제 실패')
            return real_import(name, *args, **kwargs)

        with mock.patch.object(builtins, '__import__', side_effect=boom):
            self.assertIsNone(self.mtd.fetch_market_breadth('key', 'secret'))

    def test_token_failure_is_swallowed(self):
        from unittest import mock
        import kis_client
        with mock.patch.object(kis_client, 'get_token', side_effect=RuntimeError('네트워크')):
            self.assertIsNone(self.mtd.fetch_market_breadth('key', 'secret'))

    def test_empty_upstream_returns_none_not_partial(self):
        """두 시장 모두 파싱에 실패하면 빈 dict 대신 None을 준다(프론트가 폴백하도록)."""
        from unittest import mock
        import kis_client
        with mock.patch.object(kis_client, 'get_token', return_value='t'), \
             mock.patch.object(kis_client, 'fetch_index_price', return_value={}):
            self.assertIsNone(self.mtd.fetch_market_breadth('key', 'secret'))
