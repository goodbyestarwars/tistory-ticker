# -*- coding: utf-8 -*-
import os
import sys
import tempfile
import time
import unittest
from datetime import date, timedelta
from unittest.mock import patch

CLOUD_VM_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
if CLOUD_VM_DIR not in sys.path:
    sys.path.insert(0, CLOUD_VM_DIR)

import db_schema  # noqa: E402
import strategy_scan  # noqa: E402

GOOD_ANNUAL = {'latest_roe_pct': 18.0, 'latest_debt_ratio_pct': 40.0}  # fundamentalScore 100
BAD_ANNUAL = {'latest_roe_pct': -5.0, 'latest_debt_ratio_pct': 250.0}  # fundamentalScore 20


def _insert_flat_then_drop(conn, code, n=125, base_price=10000.0, last_price=None, volume=200000):
    """마지막 하루만 빼고 base_price로 평평하게 깔아서 120일 SMA가 사실상 base_price가
    되게 만들고, 마지막 날 종가를 last_price로 떨어뜨려 이격도(disparity)를
    last_price/base_price*100으로 정확히 통제한다. volume 기본값(20만주, 종가 1만원 기준
    거래대금 약 20억원)은 MIN_AVG_TURNOVER(10억원) 유동성 필터를 통과하도록 넉넉히 잡았다."""
    if last_price is None:
        last_price = base_price
    rows = []
    for i in range(n):
        price = last_price if i == n - 1 else base_price
        rows.append((code, '2026-%04d' % i, price, price, price, price, volume))
    conn.executemany(
        'INSERT INTO daily_prices (code, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)',
        rows,
    )
    conn.commit()


class SmaLastTests(unittest.TestCase):
    def test_returns_none_when_not_enough_bars(self):
        daily = [{'close': 100}] * 10
        self.assertIsNone(strategy_scan.sma_last(daily, 20))

    def test_averages_last_n_bars(self):
        daily = [{'close': v} for v in [1, 2, 3, 4, 5]]
        self.assertAlmostEqual(strategy_scan.sma_last(daily, 3), (3 + 4 + 5) / 3)


class EnvelopeTests(unittest.TestCase):
    def test_weekly_bars_aggregates_ohlc(self):
        daily = [
            {'date': '2026-01-05', 'open': 100, 'high': 105, 'low': 99, 'close': 104, 'volume': 10},
            {'date': '2026-01-06', 'open': 104, 'high': 106, 'low': 98, 'close': 101, 'volume': 20},
            {'date': '2026-01-12', 'open': 101, 'high': 103, 'low': 100, 'close': 102, 'volume': 30},
        ]

        bars = strategy_scan.weekly_bars(daily)

        self.assertEqual(len(bars), 2)
        self.assertEqual(bars[0]['open'], 100)
        self.assertEqual(bars[0]['high'], 106)
        self.assertEqual(bars[0]['low'], 98)
        self.assertEqual(bars[0]['close'], 101)
        self.assertEqual(bars[0]['volume'], 30)

    def test_envelope_signal_requires_lower_touch_and_close_near_lower(self):
        daily = []
        start = date(2026, 1, 2)
        for i in range(15):
            day = start + timedelta(days=i * 7)
            daily.append({
                'date': day.isoformat(), 'open': 100, 'high': 100,
                'low': 100, 'close': 100, 'volume': 100,
            })
        day = start + timedelta(days=15 * 7)
        daily.append({
            'date': day.isoformat(), 'open': 90, 'high': 101,
            'low': 84.1, 'close': 84.5, 'volume': 100,
        })

        signal = strategy_scan.envelope_signal(daily)

        self.assertIsNotNone(signal)
        self.assertEqual(signal['period'], 15)
        self.assertEqual(signal['percent'], 15.0)
        self.assertAlmostEqual(signal['lower'], 84.1216666667)
        self.assertAlmostEqual(signal['upper'], 113.8116666667)


class DividendTests(unittest.TestCase):
    def _annual(self):
        return {
            'years': [
                {'year': 2022, 'net_income': 100},
                {'year': 2023, 'net_income': 110},
                {'year': 2024, 'net_income': 121},
                {'year': 2025, 'net_income': 133},
            ]
        }

    def _dividend(self):
        return {
            'reportYear': 2025,
            'years': [
                {'year': 2023, 'cashDividendPerShare': 5, 'dividendYieldPct': 5.0, 'payoutRatioPct': 35},
                {'year': 2024, 'cashDividendPerShare': 5, 'dividendYieldPct': 5.0, 'payoutRatioPct': 36},
                {'year': 2025, 'cashDividendPerShare': 6, 'dividendYieldPct': 5.5, 'payoutRatioPct': 40},
            ],
        }

    def test_accepts_dart_dividend_without_profit_growth_gate(self):
        daily = [{'close': 100}, {'close': 100}]
        annual = {'years': [
            {'year': 2022, 'net_income': 100},
            {'year': 2023, 'net_income': 90},
            {'year': 2024, 'net_income': 80},
            {'year': 2025, 'net_income': 70},
        ]}
        signal = strategy_scan.dividend_signal(daily, annual, self._dividend())

        self.assertIsNotNone(signal)
        self.assertEqual(signal['dividendStreak'], 3)
        self.assertEqual(signal['profitGrowthStreak'], 0)
        self.assertEqual(signal['payoutRatioPct'], 40)
        self.assertEqual(signal['dividendYieldPct'], 6.0)

    def test_dividend_match_preserves_report_year_for_display(self):
        match = strategy_scan.build_dividend_match(
            {'code': '005930', 'name': '테스트'},
            [{'close': 100}, {'close': 110}],
            'IT',
            strategy_scan.dividend_signal([{'close': 100}, {'close': 110}], self._annual(), self._dividend()),
            self._annual(),
        )
        self.assertEqual(match['reportYear'], 2025)

    def test_dividend_match_includes_roe_from_annual(self):
        """2026-08-20 리포트: 배당 정보 모달의 ROE가 항상 "—"였다 - annual에 이미 있는
        latest_roe_pct를 match에 담지 않던 버그. build_match()(저평가 전략)는 이미 하고
        있어 배당주만 빠져 있었다."""
        annual = dict(self._annual(), latest_roe_pct=12.5)
        match = strategy_scan.build_dividend_match(
            {'code': '005930', 'name': '테스트'},
            [{'close': 100}, {'close': 110}],
            'IT',
            strategy_scan.dividend_signal([{'close': 100}, {'close': 110}], annual, self._dividend()),
            annual,
        )
        self.assertEqual(match['roe'], 12.5)

    def test_dividend_match_without_valuation_leaves_per_pbr_none(self):
        """valuation을 안 넘기면(키움 토큰 미설정 등) per/pbr은 조용히 None - 기존과
        동일하게 프론트에서 "—"로 표시된다(회귀 없음)."""
        match = strategy_scan.build_dividend_match(
            {'code': '005930', 'name': '테스트'},
            [{'close': 100}, {'close': 110}],
            'IT',
            strategy_scan.dividend_signal([{'close': 100}, {'close': 110}], self._annual(), self._dividend()),
            self._annual(),
        )
        self.assertIsNone(match['per'])
        self.assertIsNone(match['pbr'])

    def test_dividend_match_includes_per_pbr_from_valuation(self):
        match = strategy_scan.build_dividend_match(
            {'code': '005930', 'name': '테스트'},
            [{'close': 100}, {'close': 110}],
            'IT',
            strategy_scan.dividend_signal([{'close': 100}, {'close': 110}], self._annual(), self._dividend()),
            self._annual(),
            {'per': 18.88, 'pbr': 3.44},
        )
        self.assertEqual(match['per'], 18.88)
        self.assertEqual(match['pbr'], 3.44)

    def test_fetch_dividend_valuation_returns_none_without_token(self):
        """토큰이 없으면(KIWOOM_APPKEY 미설정) 호출 자체를 안 하고 조용히 None."""
        with patch.object(strategy_scan.kiwoom_client, 'call_tr') as call_tr:
            self.assertIsNone(strategy_scan.fetch_dividend_valuation(None, '005930'))
            call_tr.assert_not_called()

    def test_fetch_dividend_valuation_parses_ka10001_response(self):
        """main.py /quote가 이미 같은 TR(ka10001)의 per/pbr을 읽어 쓰고 있는 필드명
        (gas/ticker-proxy.gs getFundamentals_() quote.per/quote.pbr)과 동일하게 파싱한다."""
        with patch.object(strategy_scan.kiwoom_client, 'call_tr',
                           return_value={'per': '18.88', 'pbr': '3.44', 'mac': '1000000'}):
            valuation = strategy_scan.fetch_dividend_valuation('token', '005930')
        self.assertEqual(valuation, {'per': 18.88, 'pbr': 3.44})

    def test_fetch_dividend_valuation_survives_call_failure(self):
        """개별 종목의 키움 호출 실패가 전체 배당주 스캔을 죽이지 않는다."""
        with patch.object(strategy_scan.kiwoom_client, 'call_tr', side_effect=RuntimeError('ka10001 실패')):
            self.assertIsNone(strategy_scan.fetch_dividend_valuation('token', '005930'))

    def test_rejects_missing_current_cash_dividend(self):
        dividend = self._dividend()
        dividend['years'][-1]['cashDividendPerShare'] = 0

        self.assertIsNone(strategy_scan.dividend_signal(
            [{'close': 100}], self._annual(), dividend))


class EtfReturnTests(unittest.TestCase):
    def _daily(self, start=100, end=120, n=253, volume=1000):
        rows = []
        for index in range(n):
            price = start + (end - start) * index / (n - 1)
            rows.append({
                'date': '2026-01-%02d' % ((index % 28) + 1),
                'open': price,
                'high': price,
                'low': price,
                'close': price,
                'volume': volume,
            })
        return rows

    def test_uses_close_to_close_trading_day_return(self):
        daily = self._daily(start=100, end=120, n=253)

        signal = strategy_scan.etf_return_signal(daily, 252)

        self.assertAlmostEqual(signal['returnRatePct'], 20.0)
        self.assertEqual(signal['lookbackBars'], 252)

    def test_ranks_etfs_and_excludes_non_etf_products_and_penny_funds(self):
        daily = self._daily(start=10_000, end=12_000, n=253)
        universe = [
            {'code': '100001', 'name': 'KODEX 상승 ETF', 'is_etf': True},
            {'code': '100002', 'name': 'TIGER ETN', 'is_etf': True},
            {'code': '100003', 'name': '일반주식', 'is_etf': False},
            {'code': '100004', 'name': 'KODEX 동전 ETF', 'is_etf': True},
        ]

        def load_daily(conn, code):
            if code == '100004':
                return [dict(row, close=500, open=500, high=500, low=500) for row in daily]
            return daily

        with patch.object(strategy_scan.db_schema, 'load_daily_prices', side_effect=load_daily):
            result, scanned = strategy_scan.scan_etf_returns(universe, object())

        self.assertEqual(scanned, 1)
        self.assertEqual([row['code'] for row in result['ETF']], ['100001'])
        self.assertEqual(result['ETF'][0]['strategy'], 'etfReturn')
        self.assertAlmostEqual(result['ETF'][0]['returnRate1mPct'], 1.41, places=2)
        self.assertAlmostEqual(result['ETF'][0]['returnRate3mPct'], 4.35, places=2)
        self.assertAlmostEqual(result['ETF'][0]['returnRate6mPct'], 9.09, places=2)
        self.assertAlmostEqual(result['ETF'][0]['returnRate12mPct'], 20.0, places=2)

    def test_returns_all_eligible_etfs_without_top_n_cap(self):
        daily = self._daily(start=10_000, end=12_000, n=253)
        universe = [
            {'code': '200%03d' % index, 'name': 'KODEX ETF %03d' % index, 'is_etf': True}
            for index in range(20)
        ]

        with patch.object(strategy_scan.db_schema, 'load_daily_prices', return_value=daily):
            result, scanned = strategy_scan.scan_etf_returns(universe, object())

        self.assertEqual(scanned, 20)
        self.assertEqual(len(result['ETF']), 20)
        self.assertIsNone(strategy_scan.ETF_RETURN_TOP_N)


class OpeningGapTests(unittest.TestCase):
    def _daily(self, open_price=10_500, close_price=11_000, previous_close=10_000, volume=300_000):
        return [
            {'date': '2026-08-10', 'open': previous_close, 'high': previous_close,
             'low': previous_close, 'close': previous_close, 'volume': volume},
            {'date': '2026-08-11', 'open': open_price, 'high': close_price,
             'low': open_price, 'close': close_price, 'volume': volume},
        ]

    def test_requires_b_k_g_l_conditions(self):
        signal = strategy_scan.opening_gap_signal(self._daily())

        self.assertIsNotNone(signal)
        self.assertAlmostEqual(signal['gapRatePct'], 5.0)
        self.assertAlmostEqual(signal['intradayRatePct'], 4.7619, places=3)
        self.assertAlmostEqual(signal['turnoverMillion'], 3300.0)

    def test_rejects_when_opening_gap_direction_is_not_up(self):
        self.assertIsNone(strategy_scan.opening_gap_signal(self._daily(open_price=9_900)))

    def test_rejects_when_close_is_not_three_percent_above_open(self):
        self.assertIsNone(strategy_scan.opening_gap_signal(self._daily(close_price=10_700)))

    def test_rejects_open_price_outside_range(self):
        self.assertIsNone(strategy_scan.opening_gap_signal(self._daily(open_price=900, close_price=1_000)))

    def test_rejects_turnover_outside_range(self):
        self.assertIsNone(strategy_scan.opening_gap_signal(self._daily(volume=100_000)))

    def test_scan_excludes_non_common_stock_categories(self):
        daily = self._daily()
        universe = [
            {'code': '000001', 'name': '일반 종목'},
            {'code': '000002', 'name': 'KODEX 코스닥150', 'is_etf': True},
            {'code': '000003', 'name': '테스트우'},
            {'code': '000004', 'name': '테스트스팩'},
            {'code': '000005', 'name': '테스트 ETN'},
        ]
        with patch.object(strategy_scan.db_schema, 'load_daily_prices', return_value=daily):
            sectors, scanned = strategy_scan.scan_opening_gap(universe, {}, object())

        self.assertEqual(scanned, 1)
        self.assertEqual([row['code'] for rows in sectors.values() for row in rows], ['000001'])


class BuildMatchTests(unittest.TestCase):
    def test_fields_reflect_actual_per_stock_values(self):
        """이전 kisyaml 배지가 "항상 100%"였던 문제의 재발 방지 확인 - 종목마다 실제로
        달라지는 값(disparity/fundamentalScore/roe/debtRatio)이 그대로 담기는지 확인."""
        daily = [
            {'date': '2026-01-01', 'open': 100, 'high': 105, 'low': 95, 'close': 100, 'volume': 1},
            {'date': '2026-01-02', 'open': 100, 'high': 92, 'low': 88, 'close': 90, 'volume': 1},
        ]
        match = strategy_scan.build_match(
            {'code': '005930', 'name': '삼성전자'}, daily, disparity=87.3,
            fundamental_score=72, annual=GOOD_ANNUAL,
        )
        self.assertEqual(match['code'], '005930')
        self.assertEqual(match['price'], 90)
        self.assertAlmostEqual(match['changeRate'], -10.0)
        self.assertEqual(match['disparity'], 87.3)
        self.assertEqual(match['fundamentalScore'], 72)
        self.assertEqual(match['roe'], GOOD_ANNUAL['latest_roe_pct'])
        self.assertEqual(match['debtRatio'], GOOD_ANNUAL['latest_debt_ratio_pct'])

    def test_change_rate_none_with_single_bar(self):
        daily = [{'date': '2026-01-01', 'open': 100, 'high': 105, 'low': 95, 'close': 100, 'volume': 1}]
        match = strategy_scan.build_match(
            {'code': '000660', 'name': 'SK하이닉스'}, daily, disparity=95.0,
            fundamental_score=60, annual=GOOD_ANNUAL,
        )
        self.assertIsNone(match['changeRate'])


    def test_strategy_quality_gates_reduce_large_results_without_order_cut(self):
        matches = [
            {'code': '%06d' % i, 'fundamentalScore': 60 if i < 8 else 80,
             'disparity': 60 + i}
            for i in range(21)
        ]

        filtered = strategy_scan.apply_strategy_quality_gates(matches)

        self.assertEqual(len(filtered), 13)
        self.assertTrue(all(item['fundamentalScore'] >= 70 for item in filtered))


class ScanTests(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        db_path = os.path.join(self.tmp_dir, 'test_ohlc.db')
        self.conn = db_schema.get_conn(db_path)
        db_schema.create_schema(self.conn)

    def tearDown(self):
        self.conn.close()

    def test_skips_codes_with_too_few_bars(self):
        _insert_flat_then_drop(self.conn, '000001', n=50, last_price=8000)  # MIN_BARS(120) 미만
        universe = [{'code': '000001', 'name': '데이터부족종목'}]
        wics_map = {'000001': {'name': '데이터부족종목', 'sector': 'IT', 'industry': 'IT'}}
        fundamentals_cache = {'000001': {'annual': GOOD_ANNUAL}}

        sectors, scanned, no_data, illiquid, no_sector, no_fund = strategy_scan.scan(
            universe, wics_map, fundamentals_cache, self.conn)

        self.assertEqual(scanned, 0)
        self.assertEqual(no_data, 1)
        self.assertEqual(illiquid, 0)
        self.assertEqual(sectors, {})

    def test_skips_illiquid_codes(self):
        _insert_flat_then_drop(self.conn, '000009', last_price=8000, volume=100)  # 거래대금 부족
        universe = [{'code': '000009', 'name': '품절주'}]
        wics_map = {'000009': {'name': '품절주', 'sector': 'IT', 'industry': 'IT'}}
        fundamentals_cache = {'000009': {'annual': GOOD_ANNUAL}}

        sectors, scanned, no_data, illiquid, no_sector, no_fund = strategy_scan.scan(
            universe, wics_map, fundamentals_cache, self.conn)

        self.assertEqual(scanned, 0)
        self.assertEqual(illiquid, 1)
        self.assertEqual(sectors, {})

    def test_skips_codes_without_volume(self):
        _insert_flat_then_drop(self.conn, '000010', last_price=8000, volume=0)
        universe = [{'code': '000010', 'name': '무거래종목'}]
        wics_map = {'000010': {'name': '무거래종목', 'sector': 'IT', 'industry': 'IT'}}
        fundamentals_cache = {'000010': {'annual': GOOD_ANNUAL}}

        sectors, scanned, _, filtered, *_ = strategy_scan.scan(
            universe, wics_map, fundamentals_cache, self.conn)

        self.assertEqual(scanned, 0)
        self.assertEqual(filtered, 1)
        self.assertEqual(sectors, {})

    def test_skips_stocks_below_1000_won(self):
        _insert_flat_then_drop(self.conn, '000008', base_price=1100, last_price=900, volume=2000000)
        universe = [{'code': '000008', 'name': '초저가주'}]
        wics_map = {'000008': {'name': '초저가주', 'sector': 'IT', 'industry': 'IT'}}
        fundamentals_cache = {'000008': {'annual': GOOD_ANNUAL}}

        sectors, scanned, _, filtered, *_ = strategy_scan.scan(
            universe, wics_map, fundamentals_cache, self.conn)

        self.assertEqual(scanned, 0)
        self.assertEqual(filtered, 1)
        self.assertEqual(sectors, {})

    def test_skips_curated_theme_stocks(self):
        _insert_flat_then_drop(self.conn, '000007', last_price=8000)
        universe = [{'code': '000007', 'name': '테마후보'}]
        wics_map = {'000007': {'name': '테마후보', 'sector': 'IT', 'industry': 'IT'}}
        fundamentals_cache = {'000007': {'annual': GOOD_ANNUAL}}

        sectors, scanned, _, filtered, *_ = strategy_scan.scan(
            universe, wics_map, fundamentals_cache, self.conn, theme_codes={'000007'})

        self.assertEqual(scanned, 0)
        self.assertEqual(filtered, 1)
        self.assertEqual(sectors, {})

    def test_skips_codes_without_wics_sector(self):
        _insert_flat_then_drop(self.conn, '000002', last_price=8000)
        universe = [{'code': '000002', 'name': '미분류종목'}]
        fundamentals_cache = {'000002': {'annual': GOOD_ANNUAL}}

        sectors, scanned, no_data, illiquid, no_sector, no_fund = strategy_scan.scan(
            universe, {}, fundamentals_cache, self.conn)  # wics_map 비어있음

        self.assertEqual(no_sector, 1)
        self.assertEqual(scanned, 0)
        self.assertEqual(sectors, {})

    def test_skips_codes_without_fundamentals(self):
        _insert_flat_then_drop(self.conn, '000003', last_price=8000)
        universe = [{'code': '000003', 'name': '재무없음'}]
        wics_map = {'000003': {'name': '재무없음', 'sector': 'IT', 'industry': 'IT'}}

        sectors, scanned, no_data, illiquid, no_sector, no_fund = strategy_scan.scan(
            universe, wics_map, {}, self.conn)  # fundamentals_cache 비어있음

        self.assertEqual(no_fund, 1)
        self.assertEqual(scanned, 0)
        self.assertEqual(sectors, {})

    def test_filters_out_low_fundamental_score(self):
        # 가격은 크게 눌려있지만(품질 게이트 없이는 통과할 상황) 재무가 나쁨 -> 제외돼야 함.
        _insert_flat_then_drop(self.conn, '000004', last_price=8000)
        universe = [{'code': '000004', 'name': '부실저가주'}]
        wics_map = {'000004': {'name': '부실저가주', 'sector': 'IT', 'industry': 'IT'}}
        fundamentals_cache = {'000004': {'annual': BAD_ANNUAL}}

        sectors, scanned, *_ = strategy_scan.scan(universe, wics_map, fundamentals_cache, self.conn)

        self.assertEqual(scanned, 1)  # 판정 시도는 됐지만
        self.assertEqual(sectors, {})  # 품질 게이트 탈락으로 후보엔 없음

    def test_filters_out_high_disparity_not_depressed_enough(self):
        # 재무는 좋지만 가격이 안 눌려있음(120일 평균과 거의 동일) -> 제외돼야 함.
        _insert_flat_then_drop(self.conn, '000005', last_price=10000)  # base_price와 동일 = disparity 100
        universe = [{'code': '000005', 'name': '안눌린우량주'}]
        wics_map = {'000005': {'name': '안눌린우량주', 'sector': 'IT', 'industry': 'IT'}}
        fundamentals_cache = {'000005': {'annual': GOOD_ANNUAL}}

        sectors, *_ = strategy_scan.scan(universe, wics_map, fundamentals_cache, self.conn)

        self.assertEqual(sectors, {})

    def test_includes_stock_passing_both_gates(self):
        _insert_flat_then_drop(self.conn, '000006', last_price=8000)  # disparity 80 < 90
        universe = [{'code': '000006', 'name': '저평가후보'}]
        wics_map = {'000006': {'name': '저평가후보', 'sector': 'IT', 'industry': 'IT'}}
        fundamentals_cache = {'000006': {'annual': GOOD_ANNUAL}}

        sectors, *_ = strategy_scan.scan(universe, wics_map, fundamentals_cache, self.conn)

        self.assertIn('IT', sectors)
        codes = [m['code'] for m in sectors['IT']]
        self.assertEqual(codes, ['000006'])

    def test_keeps_all_small_sector_results_and_sorts_by_quality(self):
        # SECTOR_TOP_N(5)보다 많은 6종목을 같은 섹터에 넣고, 이격도가 제일 낮은(가장 많이
        # 눌린) 5개만, 낮은 순으로 남는지 확인. 전부 90(DISPARITY_MAX)에 여유 있게 못 미치는
        # 값으로 잡아 게이트가 아니라 컷(SECTOR_TOP_N)이 걸러내는 상황을 테스트한다 - sma_last가
        # 마지막 날 값도 120일 평균에 포함시켜(자기참조) 실제 이격도가 last_price/base_price
        # 보다 살짝 높게 나오는 걸 감안(kisyaml_strategy.py의 _disparity 독스트링과 동일 특성).
        drops = [8800, 8700, 8600, 8500, 8400, 8300]  # 6개
        universe = []
        wics_map = {}
        fundamentals_cache = {}
        for i, last_price in enumerate(drops):
            code = '0001%02d' % i
            _insert_flat_then_drop(self.conn, code, last_price=last_price)
            universe.append({'code': code, 'name': '종목' + code})
            wics_map[code] = {'name': '종목' + code, 'sector': 'IT', 'industry': 'IT'}
            fundamentals_cache[code] = {'annual': GOOD_ANNUAL}

        sectors, *_ = strategy_scan.scan(universe, wics_map, fundamentals_cache, self.conn)

        self.assertEqual(len(sectors['IT']), 6)
        disparities = [m['disparity'] for m in sectors['IT']]
        self.assertEqual(disparities, sorted(disparities))  # 이격도 오름차순(가장 눌린 것부터)
        codes = [m['code'] for m in sectors['IT']]
        self.assertIn('000100', codes)

    def test_separates_sectors(self):
        _insert_flat_then_drop(self.conn, '000020', last_price=8000)
        _insert_flat_then_drop(self.conn, '000021', last_price=8000)
        universe = [{'code': '000020', 'name': 'IT종목'}, {'code': '000021', 'name': '금융종목'}]
        wics_map = {
            '000020': {'name': 'IT종목', 'sector': 'IT', 'industry': 'IT'},
            '000021': {'name': '금융종목', 'sector': '금융', 'industry': '금융'},
        }
        fundamentals_cache = {'000020': {'annual': GOOD_ANNUAL}, '000021': {'annual': GOOD_ANNUAL}}

        sectors, *_ = strategy_scan.scan(universe, wics_map, fundamentals_cache, self.conn)

        self.assertEqual(set(sectors), {'IT', '금융'})


class NpsHoldingsTests(unittest.TestCase):
    """전략검색 "국민연금 보유종목" 카테고리 - public_data.fetch_nps_holdings_by_code()가
    이미 이름 매칭까지 끝낸 결과를 받아 가격·섹터만 붙이는지 확인한다."""

    def _daily(self):
        return [{'date': '2026-08-19', 'close': 100}, {'date': '2026-08-20', 'close': 110}]

    def test_scan_attaches_price_and_sector_to_matched_holdings(self):
        universe = [
            {'code': '005930', 'name': '삼성전자'},
            {'code': '000660', 'name': 'SK하이닉스'},
        ]
        wics_map = {
            '005930': {'name': '삼성전자', 'sector': 'IT', 'industry': 'IT'},
            '000660': {'name': 'SK하이닉스', 'sector': 'IT', 'industry': 'IT'},
        }
        holdings = {
            '005930': {'holding_pct': 8.5, 'weight_pct': 5.0, 'evaluation_amount_eok': 1000.0,
                       'as_of': '2024-12-31', 'source': '국민연금공단 국내주식 투자정보'},
            '000660': {'holding_pct': 7.1, 'weight_pct': 2.0, 'evaluation_amount_eok': 500.0,
                       'as_of': '2024-12-31', 'source': '국민연금공단 국내주식 투자정보'},
        }
        with patch.object(strategy_scan.public_data, 'fetch_nps_holdings_by_code', return_value=holdings), \
                patch.object(strategy_scan.db_schema, 'load_daily_prices', return_value=self._daily()):
            sectors, scanned = strategy_scan.scan_nps_holdings(universe, wics_map, object())

        self.assertEqual(scanned, 2)
        matches = sectors['IT']
        # 보유 지분율(holdingPct) 내림차순 - 삼성전자(8.5%)가 SK하이닉스(7.1%)보다 먼저.
        self.assertEqual([m['code'] for m in matches], ['005930', '000660'])
        self.assertEqual(matches[0]['holdingPct'], 8.5)
        self.assertEqual(matches[0]['price'], 110)
        self.assertAlmostEqual(matches[0]['changeRate'], 10.0)
        self.assertEqual(matches[0]['asOf'], '2024-12-31')
        self.assertEqual(matches[0]['strategy'], 'nationalPension')

    def test_scan_skips_universe_stocks_without_nps_holding(self):
        universe = [{'code': '005930', 'name': '삼성전자'}, {'code': '999999', 'name': '미보유종목'}]
        wics_map = {
            '005930': {'name': '삼성전자', 'sector': 'IT', 'industry': 'IT'},
            '999999': {'name': '미보유종목', 'sector': 'IT', 'industry': 'IT'},
        }
        holdings = {'005930': {'holding_pct': 8.5, 'weight_pct': 5.0, 'evaluation_amount_eok': 1000.0,
                                'as_of': '2024-12-31', 'source': '국민연금공단 국내주식 투자정보'}}
        with patch.object(strategy_scan.public_data, 'fetch_nps_holdings_by_code', return_value=holdings), \
                patch.object(strategy_scan.db_schema, 'load_daily_prices', return_value=self._daily()):
            sectors, scanned = strategy_scan.scan_nps_holdings(universe, wics_map, object())

        self.assertEqual([m['code'] for sector_matches in sectors.values() for m in sector_matches], ['005930'])

    def test_scan_returns_empty_when_nps_data_unavailable(self):
        """공공데이터 조회 실패 시(서비스키 미설정 등) 빈 결과 - 임의로 채우지 않는다."""
        universe = [{'code': '005930', 'name': '삼성전자'}]
        wics_map = {'005930': {'name': '삼성전자', 'sector': 'IT', 'industry': 'IT'}}
        with patch.object(strategy_scan.public_data, 'fetch_nps_holdings_by_code', return_value={}):
            sectors, scanned = strategy_scan.scan_nps_holdings(universe, wics_map, object())

        self.assertEqual(sectors, {})
        self.assertEqual(scanned, 0)


class TargetPriceGapTests(unittest.TestCase):
    """전략검색 "목표주가 괴리 저평가주" - 같은 업종 오늘 평균 PER/PBR 대비 목표가 계산
    (2026-08-23: daily_prices가 2024-06-24부터만 있어(완결 회계연도 2개뿐) 원래 설계였던
    "종목 자체 과거 5개년 밴드"가 항상 후보 0건이었던 것을 발견 - 과거 주가 이력이 필요
    없는 "업종 평균 대비" 방식으로 교체)."""

    def test_compute_eps_bps_returns_latest_year_eps_bps(self):
        annual = {'years': [
            {'year': 2024, 'net_income': 900, 'equity': 9000},
            {'year': 2025, 'net_income': 1000, 'equity': 10000},
        ]}
        result = strategy_scan.compute_eps_bps(annual, shares_outstanding=100)
        self.assertEqual(result, {'eps': 10.0, 'bps': 100.0})

    def test_compute_eps_bps_excludes_latest_year_loss(self):
        annual = {'years': [
            {'year': 2024, 'net_income': 1000, 'equity': 10000},
            {'year': 2025, 'net_income': -100, 'equity': 9800},
        ]}
        self.assertIsNone(strategy_scan.compute_eps_bps(annual, shares_outstanding=100))

    def test_compute_eps_bps_returns_none_without_shares_outstanding(self):
        annual = {'years': [{'year': 2025, 'net_income': 1000, 'equity': 10000}]}
        self.assertIsNone(strategy_scan.compute_eps_bps(annual, shares_outstanding=None))
        self.assertIsNone(strategy_scan.compute_eps_bps(annual, shares_outstanding=0))

    def test_build_target_price_match_combines_per_and_pbr_targets(self):
        # 2026-08-23(3차): "섹터 중앙값까지 완전히 수렴"이 아니라 TARGET_PRICE_REVERSION_FACTOR
        # (35%)만큼만 부분수렴한다고 가정하도록 계산식을 바꿨다(사용자 리포트 - KG스틸처럼
        # 완전수렴 가정이 실제 애널리스트 목표가보다 훨씬 높은 목표가를 냈던 문제).
        # 업종 평균 PER 10배, PBR 1배. EPS 40, BPS 400 -> 완전수렴 목표가는 PER/PBR 둘 다
        # 400인데, 현재가(100)에서 그 방향으로 35%만 이동한 205가 실제 목표가가 된다.
        record = {
            'code': '000010', 'name': '테스트종목', 'sector': 'IT', 'price': 100,
            'date': '2026-08-20', 'changeRate': 1.5, 'eps': 40, 'bps': 400,
        }
        sector_avg = {'perAvg': 10.0, 'pbrAvg': 1.0}
        match = strategy_scan.build_target_price_match(record, sector_avg, annual=None)
        self.assertIsNotNone(match)
        self.assertEqual(match['targetPrice'], 205)
        self.assertAlmostEqual(match['targetGapPct'], (205 - 100) / 100 * 100, places=1)
        self.assertEqual(match['sectorPerAvg'], 10.0)
        self.assertEqual(match['sectorPbrAvg'], 1.0)

    def test_build_target_price_match_returns_none_when_below_min_gap(self):
        # PER 목표가 = 10 * 40 = 400, 현재가 390 -> 괴리 2.6%로 20% 미달, 후보 제외.
        record = {
            'code': '000020', 'name': '고평가종목', 'sector': 'IT', 'price': 390,
            'date': '2026-08-20', 'changeRate': 0.0, 'eps': 40, 'bps': None,
        }
        sector_avg = {'perAvg': 10.0, 'pbrAvg': None}
        self.assertIsNone(strategy_scan.build_target_price_match(record, sector_avg, annual=None))

    def test_build_target_price_match_returns_none_without_any_sector_average(self):
        record = {
            'code': '000030', 'name': '표본부족업종', 'sector': '소재', 'price': 300,
            'date': '2026-08-20', 'changeRate': 0.0, 'eps': 40, 'bps': 400,
        }
        # 섹터 표본이 부족해 perAvg/pbrAvg가 둘 다 None인 경우(scan_target_price_gap에서
        # TARGET_PRICE_MIN_SECTOR_PEERS 미만이면 이렇게 넘어온다).
        sector_avg = {'perAvg': None, 'pbrAvg': None}
        self.assertIsNone(strategy_scan.build_target_price_match(record, sector_avg, annual=None))

    def test_scan_flags_stock_priced_below_sector_average_multiple(self):
        # IT 섹터 5종목, 상장주식수 100주(시가총액/가격으로 역산)로 고정.
        # 000020~000050(피어 4종목): eps=500/bps=5000, 가격도 5000 -> PER=10/PBR=1로
        # 통일해 섹터 평균이 정확히 10배/1배가 되도록 설계.
        # 000010(저평가 대상): eps=400/bps=4000 -> 완전수렴 목표가(PER/PBR 둘 다 4000)인데
        # 2026-08-23(3차)부터 부분수렴(35%)만 반영해 실제 가격 2000에서 2700으로만
        # 이동한다(2000 + 0.35*(4000-2000)=2700, 괴리 35%로 기준(20%) 통과).
        universe = [{'code': c, 'name': c} for c in
                    ['000010', '000020', '000030', '000040', '000050']]
        wics_map = {c: {'name': c, 'sector': 'IT', 'industry': 'IT'} for c in
                    ['000010', '000020', '000030', '000040', '000050']}
        fundamentals_cache = {
            '000010': {'annual': {'years': [{'year': 2025, 'net_income': 40000, 'equity': 400000}]}},
            '000020': {'annual': {'years': [{'year': 2025, 'net_income': 50000, 'equity': 500000}]}},
            '000030': {'annual': {'years': [{'year': 2025, 'net_income': 50000, 'equity': 500000}]}},
            '000040': {'annual': {'years': [{'year': 2025, 'net_income': 50000, 'equity': 500000}]}},
            '000050': {'annual': {'years': [{'year': 2025, 'net_income': 50000, 'equity': 500000}]}},
        }
        prices = {'000010': 2000, '000020': 5000, '000030': 5000, '000040': 5000, '000050': 5000}

        def daily_for(price):
            rows = []
            for i in range(strategy_scan.MIN_BARS):
                rows.append({'date': '2026-%04d' % i, 'close': price, 'open': price,
                             'high': price, 'low': price, 'volume': 1000000})
            return rows

        daily_cache = {code: daily_for(price) for code, price in prices.items()}
        # fetch_market_cap()은 "억원" 단위(ka10001 mac)를 반환 - 상장주식수 100주가 되도록
        # (시가총액=가격*100) 역산해 억원 단위로 넘긴다.
        market_caps = {code: (100 * price) / 100_000_000 for code, price in prices.items()}

        with patch.object(strategy_scan, 'fetch_market_cap', side_effect=lambda token, code: market_caps[code]), \
                patch.object(time, 'sleep'):
            sectors, scanned = strategy_scan.scan_target_price_gap(
                universe, wics_map, fundamentals_cache, object(), kiwoom_token='tok', daily_cache=daily_cache,
            )

        self.assertEqual(scanned, 5)
        codes = [m['code'] for sector_matches in sectors.values() for m in sector_matches]
        self.assertEqual(codes, ['000010'])

    def test_scan_uses_sector_median_so_one_outlier_peer_cannot_skew_it(self):
        # 2026-08-23 실측 버그 회귀 테스트: 효성화학이 목표가 13,466,334원(괴리 +17831%)로
        # 나온 사건 - 섹터 안에 이익이 거의 0에 가까운(그러나 양수인) 종목 하나가 있으면
        # 그 종목의 PER(=주가/EPS)이 수천 배로 튀어서, 산술평균을 쓰면 섹터 평균 전체가
        # 그 한 종목에 끌려간다. IT 섹터 6종목 중 000050 하나만 eps=1(거의 0)로 극단적
        # PER(5000배)을 갖게 하고, 나머지 5종목(000010 포함)은 PER=10으로 통일했다.
        # 000050은 TARGET_PRICE_PER_CAP(80)을 넘어 애초에 섹터 표본에서 제외되므로(2026-08-23
        # 2차 수정), 남은 5개 표본([7.5, 10, 10, 10, 10])의 중앙값 10이 그대로 쓰여야 한다 -
        # 이 종목 하나를 빼도 여전히 TARGET_PRICE_MIN_SECTOR_PEERS(5) 문턱을 채우도록
        # 정상 종목을 하나 더 늘렸다(예전엔 5종목 중 하나가 걸러지면 4개로 줄어 문턱을
        # 못 채우는 부작용이 있었음).
        universe = [{'code': c, 'name': c} for c in
                    ['000010', '000020', '000030', '000040', '000050', '000060']]
        wics_map = {c: {'name': c, 'sector': 'IT', 'industry': 'IT'} for c in
                    ['000010', '000020', '000030', '000040', '000050', '000060']}
        fundamentals_cache = {
            '000010': {'annual': {'years': [{'year': 2025, 'net_income': 40000, 'equity': 400000}]}},
            '000020': {'annual': {'years': [{'year': 2025, 'net_income': 50000, 'equity': 500000}]}},
            '000030': {'annual': {'years': [{'year': 2025, 'net_income': 50000, 'equity': 500000}]}},
            '000040': {'annual': {'years': [{'year': 2025, 'net_income': 50000, 'equity': 500000}]}},
            # 상장주식수 100주 기준 eps=1(net_income=100) - 거의 0에 가까운 흑자, PER 폭주 유발.
            '000050': {'annual': {'years': [{'year': 2025, 'net_income': 100, 'equity': 500000}]}},
            '000060': {'annual': {'years': [{'year': 2025, 'net_income': 50000, 'equity': 500000}]}},
        }
        prices = {'000010': 2000, '000020': 5000, '000030': 5000, '000040': 5000, '000050': 5000, '000060': 5000}

        def daily_for(price):
            rows = []
            for i in range(strategy_scan.MIN_BARS):
                rows.append({'date': '2026-%04d' % i, 'close': price, 'open': price,
                             'high': price, 'low': price, 'volume': 1000000})
            return rows

        daily_cache = {code: daily_for(price) for code, price in prices.items()}
        market_caps = {code: (100 * price) / 100_000_000 for code, price in prices.items()}

        with patch.object(strategy_scan, 'fetch_market_cap', side_effect=lambda token, code: market_caps[code]), \
                patch.object(time, 'sleep'):
            sectors, scanned = strategy_scan.scan_target_price_gap(
                universe, wics_map, fundamentals_cache, object(), kiwoom_token='tok', daily_cache=daily_cache,
            )

        matches = [m for sector_matches in sectors.values() for m in sector_matches]
        target = next(m for m in matches if m['code'] == '000010')
        # 중앙값(10)을 썼으면 목표가는 이전 정상 케이스와 동일하게 4000원 근처여야 한다.
        # 이상치를 산술평균했다면 403,000원 근처(1007.5배)로 나왔을 것이다.
        self.assertLess(target['targetPrice'], 5000)
        self.assertEqual(target['sectorPerAvg'], 10.0)

    def test_extreme_per_peer_is_excluded_from_the_sector_pool_entirely(self):
        # 2026-08-23(2차): 중앙값만으로는 표본 절반 가까이가 극단치일 때 여전히 오염될 수
        # 있어(효성화학이 median 적용 후에도 여전히 괴리 +1717%로 비정상이었음, 실측),
        # TARGET_PRICE_PER_CAP(80)을 넘는 개별 PER은 애초에 섹터 표본에 안 들어가게 했다.
        # 5종목(000010 후보 + 4피어)에서 000050 하나만 PER=5000(cap 초과)이면, 표본에서
        # 빠져 유효 PER 표본이 4개로 줄어 TARGET_PRICE_MIN_SECTOR_PEERS(5) 문턱을 못
        # 채운다 - perAvg가 None이 돼야 하고(sectorPerAvg 필드에 반영), PBR은 모든 종목이
        # cap(10) 이내라 정상적으로 표본 5개를 채워 그대로 살아있어야 한다.
        universe = [{'code': c, 'name': c} for c in
                    ['000010', '000020', '000030', '000040', '000050']]
        wics_map = {c: {'name': c, 'sector': 'IT', 'industry': 'IT'} for c in
                    ['000010', '000020', '000030', '000040', '000050']}
        fundamentals_cache = {
            '000010': {'annual': {'years': [{'year': 2025, 'net_income': 40000, 'equity': 400000}]}},
            '000020': {'annual': {'years': [{'year': 2025, 'net_income': 50000, 'equity': 500000}]}},
            '000030': {'annual': {'years': [{'year': 2025, 'net_income': 50000, 'equity': 500000}]}},
            '000040': {'annual': {'years': [{'year': 2025, 'net_income': 50000, 'equity': 500000}]}},
            '000050': {'annual': {'years': [{'year': 2025, 'net_income': 100, 'equity': 500000}]}},
        }
        prices = {'000010': 2000, '000020': 5000, '000030': 5000, '000040': 5000, '000050': 5000}

        def daily_for(price):
            rows = []
            for i in range(strategy_scan.MIN_BARS):
                rows.append({'date': '2026-%04d' % i, 'close': price, 'open': price,
                             'high': price, 'low': price, 'volume': 1000000})
            return rows

        daily_cache = {code: daily_for(price) for code, price in prices.items()}
        market_caps = {code: (100 * price) / 100_000_000 for code, price in prices.items()}

        with patch.object(strategy_scan, 'fetch_market_cap', side_effect=lambda token, code: market_caps[code]), \
                patch.object(time, 'sleep'):
            sectors, scanned = strategy_scan.scan_target_price_gap(
                universe, wics_map, fundamentals_cache, object(), kiwoom_token='tok', daily_cache=daily_cache,
            )

        matches = [m for sector_matches in sectors.values() for m in sector_matches]
        target = next(m for m in matches if m['code'] == '000010')
        self.assertIsNone(target['sectorPerAvg'])  # PER 표본이 4개로 줄어 문턱 미달
        self.assertEqual(target['sectorPbrAvg'], 1.0)  # PBR은 전부 cap 이내라 그대로 유지
        # PBR 목표가만으로 계산: 완전수렴 목표가 4000에서 부분수렴(35%)만 반영해
        # 2000 + 0.35*(4000-2000) = 2700.
        self.assertEqual(target['targetPrice'], 2700)

    def test_scan_excludes_sector_with_too_few_peers(self):
        # 섹터에 종목이 2개뿐(TARGET_PRICE_MIN_SECTOR_PEERS=5 미만)이면 섹터 평균을
        # 못 믿고 아예 후보에서 제외한다 - 000010은 위 테스트와 동일하게 저평가 조건이지만
        # 섹터 표본 부족으로 여기서는 후보에 안 남아야 한다.
        universe = [{'code': '000010', 'name': 'A'}, {'code': '000020', 'name': 'B'}]
        wics_map = {
            '000010': {'name': 'A', 'sector': '소재', 'industry': '소재'},
            '000020': {'name': 'B', 'sector': '소재', 'industry': '소재'},
        }
        fundamentals_cache = {
            '000010': {'annual': {'years': [{'year': 2025, 'net_income': 4000, 'equity': 40000}]}},
            '000020': {'annual': {'years': [{'year': 2025, 'net_income': 5000, 'equity': 50000}]}},
        }
        prices = {'000010': 3000, '000020': 5000}

        def daily_for(price):
            rows = []
            for i in range(strategy_scan.MIN_BARS):
                rows.append({'date': '2026-%04d' % i, 'close': price, 'open': price,
                             'high': price, 'low': price, 'volume': 400000})
            return rows

        daily_cache = {code: daily_for(price) for code, price in prices.items()}
        market_caps = {code: (100 * price) / 100_000_000 for code, price in prices.items()}

        with patch.object(strategy_scan, 'fetch_market_cap', side_effect=lambda token, code: market_caps[code]), \
                patch.object(time, 'sleep'):
            sectors, scanned = strategy_scan.scan_target_price_gap(
                universe, wics_map, fundamentals_cache, object(), kiwoom_token='tok', daily_cache=daily_cache,
            )

        codes = [m['code'] for sector_matches in sectors.values() for m in sector_matches]
        self.assertEqual(codes, [])


class ApplyAnalystTargetPriceAnchorTests(unittest.TestCase):
    """애널리스트 목표가를 그대로 복사하지 않는 보수적 앵커 회귀 테스트."""

    def test_calculated_target_above_analyst_target_is_softly_adjusted(self):
        sectors = {'소재': {'matches': [
            {'code': '000010', 'price': 5290, 'targetPrice': 19957, 'targetGapPct': 277.3,
             'analystTargetPrice': 7550},
        ]}}
        strategy_scan.apply_analyst_target_price_anchor(sectors)
        match = sectors['소재']['matches'][0]
        expected = round(5290 + 0.8 * (7550 - 5290))
        self.assertEqual(match['targetPrice'], expected)
        self.assertAlmostEqual(match['targetGapPct'], (expected - 5290) / 5290 * 100, places=1)
        self.assertTrue(match['targetPriceAdjustedToAnalyst'])
        self.assertNotEqual(match['targetPrice'], match['analystTargetPrice'])

    def test_calculated_target_already_below_analyst_target_is_left_untouched(self):
        sectors = {'소재': {'matches': [
            {'code': '000020', 'price': 5000, 'targetPrice': 6000, 'targetGapPct': 20.0,
             'analystTargetPrice': 7550},
        ]}}
        strategy_scan.apply_analyst_target_price_anchor(sectors)
        match = sectors['소재']['matches'][0]
        self.assertEqual(match['targetPrice'], 6000)
        self.assertEqual(match['targetGapPct'], 20.0)
        self.assertNotIn('targetPriceCappedByAnalyst', match)

    def test_equal_targets_are_also_softly_adjusted(self):
        sectors = {'소재': {'matches': [
            {'code': '000025', 'price': 5000, 'targetPrice': 7550, 'targetGapPct': 51.0,
             'analystTargetPrice': 7550},
        ]}}
        strategy_scan.apply_analyst_target_price_anchor(sectors)
        match = sectors['소재']['matches'][0]
        self.assertLess(match['targetPrice'], match['analystTargetPrice'])
        self.assertTrue(match['targetPriceAdjustedToAnalyst'])

    def test_stock_without_analyst_coverage_is_left_untouched(self):
        sectors = {'소재': {'matches': [
            {'code': '000030', 'price': 5000, 'targetPrice': 9000, 'targetGapPct': 80.0},
        ]}}
        strategy_scan.apply_analyst_target_price_anchor(sectors)
        match = sectors['소재']['matches'][0]
        self.assertEqual(match['targetPrice'], 9000)
        self.assertNotIn('targetPriceCappedByAnalyst', match)

    def test_clamped_match_below_min_gap_is_dropped_from_the_list(self):
        # 클램프 이후 괴리율이 최소 기준(20%) 아래로 떨어지면 더 이상 "저평가 후보"가
        # 아니므로 목록에서도 빠져야 한다.
        sectors = {'소재': {'matches': [
            {'code': '000040', 'price': 5000, 'targetPrice': 9000, 'targetGapPct': 80.0,
             'analystTargetPrice': 5500},  # 클램프 후 괴리 10% -> 20% 미달
        ]}}
        strategy_scan.apply_analyst_target_price_anchor(sectors)
        self.assertEqual(sectors['소재']['matches'], [])


if __name__ == '__main__':
    unittest.main()
