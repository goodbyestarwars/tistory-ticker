# -*- coding: utf-8 -*-
import os
import sys
import tempfile
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

    def test_caps_and_sorts_top_n_per_sector(self):
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

        self.assertEqual(len(sectors['IT']), strategy_scan.SECTOR_TOP_N)
        disparities = [m['disparity'] for m in sectors['IT']]
        self.assertEqual(disparities, sorted(disparities))  # 이격도 오름차순(가장 눌린 것부터)
        codes = [m['code'] for m in sectors['IT']]
        self.assertNotIn('000100', codes)  # last_price=8800(가장 안 눌림, 이격도 최고)은 컷됨

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


if __name__ == '__main__':
    unittest.main()
