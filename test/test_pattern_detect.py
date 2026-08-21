import pathlib
import sys
import unittest
from datetime import date, timedelta


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "cloud-vm"))

import pattern_detect as detector


def early_higher_low_daily():
    """Higher Low is present while the latest High and MA20 are still falling."""
    daily = []
    for i in range(60):
        close = 60000 - i * 150
        daily.append({
            "date": "2026-01-%02d" % (i + 1),
            "open": close,
            "high": close + 500,
            "low": close - 500,
            "close": close,
            "volume": 1000 if i < 55 else 500,
        })

    # First recent swing low and a lower rebound high.
    daily[48].update(open=48000, high=50500, low=47500, close=49000)
    daily[49].update(open=47500, high=48000, low=46500, close=47000)
    daily[50].update(open=40500, high=41000, low=39950, close=40000)
    daily[51].update(open=43000, high=44500, low=42500, close=44000)
    daily[52].update(open=45000, high=46500, low=44500, close=46000)
    daily[53].update(open=46000, high=47500, low=45500, close=47000)
    daily[54].update(open=49000, high=50000, low=48000, close=49000)
    daily[55].update(open=45500, high=46000, low=44500, close=45000)
    daily[56].update(open=45000, high=45500, low=44000, close=44500)
    daily[57].update(open=43000, high=44000, low=42800, close=43500)
    daily[58].update(open=44500, high=46000, low=44000, close=45500)
    daily[59].update(open=46000, high=46850, low=45500, close=46850)
    return daily


def compact_higher_low_daily():
    """20일 안에서 0.4% 상승·4거래일 간격인 두 저점을 만든다."""
    daily = []
    for i in range(20):
        close = 100 + i
        daily.append({
            "date": "2026-02-%02d" % (i + 1),
            "open": close,
            "high": close + 1,
            "low": close - 1,
            "close": close,
            "volume": 100,
        })
    for i, close in ((8, 100), (9, 111), (10, 112), (11, 113), (12, 100.4), (13, 114), (14, 115)):
        daily[i].update(open=close, high=close + 1, low=close - 1, close=close)
    for row in daily:
        for field in ("open", "high", "low", "close"):
            row[field] *= 100
    return daily


def ma_cloud_breakout_daily():
    """224일선 근처에서 구름 상단을 고가로 시도하며 5일선이 20일선을 넘는 예시."""
    daily = []
    start = date(2025, 1, 1)
    for i in range(300):
        close = 100.0
        daily.append({
            "date": (start + timedelta(days=i)).isoformat(),
            "open": close,
            "high": close + 1,
            "low": close - 1,
            "close": close,
            "volume": 1000,
        })
    # 최근 52봉의 구름을 100~102 근처로 만들어 현재가가 구름 안에서 상단을 시도하게 한다.
    for i in range(222, 248):
        daily[i].update(high=106.0, low=98.0)
    for i in range(248, 274):
        daily[i].update(high=101.0, low=99.0)
    for i, close in enumerate((100.1, 100.2, 100.4, 100.6, 100.8), start=295):
        daily[i].update(open=close - 0.2, high=102.0 if i == 299 else close + 0.5,
                        low=close - 0.5, close=close)
    for row in daily:
        for field in ("open", "high", "low", "close"):
            row[field] *= 100
    return daily


def ma_cloud_breakout_daily():
    """224일선 근처에서 구름 상단을 고가로 시도하며 5일선이 20일선을 넘는 예시."""
    daily = []
    start = date(2025, 1, 1)
    for i in range(300):
        close = 100.0
        daily.append({
            "date": (start + timedelta(days=i)).isoformat(),
            "open": close,
            "high": close + 1,
            "low": close - 1,
            "close": close,
            "volume": 1000,
        })
    # 최근 52봉의 구름을 100~102 근처로 만들어 현재가가 구름 안에서 상단을 시도하게 한다.
    for i in range(222, 248):
        daily[i].update(high=106.0, low=98.0)
    for i in range(248, 274):
        daily[i].update(high=101.0, low=99.0)
    for i, close in enumerate((100.1, 100.2, 100.4, 100.6, 100.8), start=295):
        daily[i].update(open=close - 0.2, high=102.0 if i == 299 else close + 0.5,
                        low=close - 0.5, close=close)
    for row in daily:
        for field in ("open", "high", "low", "close"):
            row[field] *= 100
    return daily


def box_range_daily():
    daily = []
    start = date(2025, 1, 1)
    values = [100, 102, 98, 101, 99] * 8
    for i, close in enumerate(values):
        open_price = 100 if i < 35 else 101
        daily.append({
            "date": (start + timedelta(days=i)).isoformat(),
            "open": open_price * 1000,
            "high": (close + 1) * 1000,
            "low": (close - 1) * 1000,
            "close": close * 1000,
            "volume": 100,
        })
    daily[-1].update(open=101000, high=99000, low=97000, close=98000)
    return daily


def double_bottom_daily():
    """2026-08-21: 넥라인(중간 반등 고점)은 반드시 평평한 기준선(base+300)보다 확실히
    높게 잡아야 한다 - 그보다 낮으면 max_high_between이 진짜 넥라인 대신 평평한 구간의
    고가를 집어 마지막 봉 근접도 조건이 항상 실패한다(pandas 전환 회귀 테스트 중 확인)."""
    n = 100
    daily = []
    start = date(2025, 1, 1)
    base = 30000.0
    for i in range(n):
        daily.append({
            "date": (start + timedelta(days=i)).isoformat(),
            "open": base, "high": base + 300, "low": base - 300, "close": base, "volume": 1000,
        })
    i2 = n - 4  # DB_RECENCY_MAX_GAP(5) 이내
    i1 = i2 - 30  # DB_MIN/MAX_GAP_DAYS(10~45) 범위 안
    low1 = base * 0.80
    low2 = low1 * 1.003  # DB_LOW_TOL(3%) 이내로 비슷한 저점
    daily[i1].update(low=low1, close=low1 + 50, open=low1 + 80, high=low1 + 300, volume=2500)
    mid = (i1 + i2) // 2
    neck = base * 1.08
    daily[mid].update(high=neck, close=neck - 30, open=neck - 60, low=neck - 250, volume=1200)
    daily[i2].update(low=low2, close=low2 + 40, open=low2 + 70, high=low2 + 300,
                      volume=900)  # 2번째 저점 거래량 <= 1번째
    tail = n - 1 - i2
    for k in range(i2 + 1, n):
        frac = (k - i2) / tail
        c = low2 + (neck - low2) * frac
        lo = max(low2 * 1.002, c * 0.99)
        daily[k].update(open=c * 0.995, close=c, high=c * 1.01, low=lo, volume=600)
    daily[-1].update(open=neck * 0.995, close=neck * 1.006, low=neck * 0.99, high=neck * 1.015)
    return daily


def inv_head_shoulders_daily():
    """double_bottom_daily와 같은 이유로 두 넥라인(peak1/peak2)을 기준선(base)보다
    확실히 높게 잡는다."""
    n = 90
    daily = []
    start = date(2025, 1, 1)
    base = 30000.0
    for i in range(n):
        daily.append({
            "date": (start + timedelta(days=i)).isoformat(),
            "open": base, "high": base + 300, "low": base - 300, "close": base, "volume": 500,
        })
    i_r = n - 4  # IHS_RECENCY_MAX_GAP(5) 이내
    i_h = i_r - 20  # IHS_MIN/MAX_SHOULDER_GAP(4~40) 범위 안
    i_l = i_h - 20
    left = base * 0.88
    head = base * 0.79  # 헤드가 양 어깨보다 확실히 낮음
    right = left * 1.0  # IHS_SHOULDER_TOL(4%) 이내 대칭
    daily[i_l].update(low=left, close=left + 60, open=left + 100, high=left + 350, volume=1500)
    daily[i_h].update(low=head, close=head + 60, open=head + 100, high=head + 350, volume=1500)
    daily[i_r].update(low=right, close=right + 60, open=right + 100, high=right + 350, volume=1500)
    peak1 = base * 1.07
    peak2 = base * 1.06
    daily[(i_l + i_h) // 2].update(high=peak1, close=peak1 - 30, open=peak1 - 60, low=peak1 - 250, volume=1000)
    daily[(i_h + i_r) // 2].update(high=peak2, close=peak2 - 30, open=peak2 - 60, low=peak2 - 250, volume=1000)
    neckline_price = min(peak1, peak2)
    tail = n - 1 - i_r
    for k in range(i_r + 1, n):
        frac = (k - i_r) / tail
        c = right + (neckline_price - right) * frac
        lo = max(right * 1.002, c * 0.99)
        # 우어깨 이후 거래량 급증(20일 평균 대비 1.2배 이상) 조건을 충족시키는 고거래량 구간
        daily[k].update(open=c * 0.995, close=c, high=c * 1.01, low=lo, volume=5000)
    daily[-1].update(open=neckline_price * 0.995, close=neckline_price * 1.006,
                      low=neckline_price * 0.99, high=neckline_price * 1.015, volume=5000)
    return daily


def pullback_daily():
    """전체 rise+pullback 구간을 recent_start(=n-25) 이후에 담아야 detect_pullback의
    peak/low 탐색 창(PULLBACK_LOOKBACK+5=25일) 안에서 정확히 잡힌다."""
    n = 260
    daily = []
    start = date(2024, 1, 1)
    price = 20000.0
    flat_days = n - 25
    for i in range(flat_days):
        daily.append({
            "date": (start + timedelta(days=i)).isoformat(),
            "open": price, "high": price * 1.003, "low": price * 0.997, "close": price, "volume": 1000,
        })
    low_price = price
    rise_days = 15
    rise_total = 0.28
    for i in range(rise_days):
        price = low_price * (1 + rise_total * (i + 1) / rise_days)
        vol = 800 + i * 100  # 상승구간 거래량 증가
        daily.append({
            "date": (start + timedelta(days=flat_days + i)).isoformat(),
            "open": price * 0.999, "high": price * 1.008, "low": price * 0.995, "close": price, "volume": vol,
        })
    peak = price
    drop_days = n - len(daily)
    drop_total = 0.08
    for i in range(drop_days):
        price = peak * (1 - drop_total * (i + 1) / drop_days)
        vol = max(1800 - i * 130, 100)  # 조정구간 거래량 감소
        daily.append({
            "date": (start + timedelta(days=len(daily))).isoformat(),
            "open": price * 1.001, "high": price * 1.006, "low": price * 0.995, "close": price, "volume": vol,
        })
    daily[-1]["close"] = daily[-1]["open"] * 1.002  # 최근 캔들 양봉
    return daily


class RisingLowsDetectionTest(unittest.TestCase):
    def test_small_rise_and_short_gap_are_valid(self):
        detail = detector.detect_rising_lows(compact_higher_low_daily())

        self.assertIsNotNone(detail)
        self.assertLess(detail["score"], 70)

        results = {"risingLows": [], "doubleBottom": [], "invHeadShoulders": [], "boxRangeLow": []}
        daily = compact_higher_low_daily()
        detector.scan_stock({"code": "000001", "name": "테스트"}, daily, results, [])
        self.assertEqual([row["code"] for row in results["risingLows"]], ["000001"])
        self.assertEqual(len(results["risingLows"][0]["miniChart"]), min(20, len(daily)))
        self.assertEqual(results["risingLows"][0]["miniChart"][-1]["close"], daily[-1]["close"])
        detail_snapshot = results["risingLows"][0]["patternDetail"]
        self.assertEqual(len(detail_snapshot["closes_20d"]), min(20, len(daily)))
        self.assertEqual(detail_snapshot["previous_low"]["price"], detail_snapshot["pivot_lows"][-2]["price"])
        self.assertEqual(detail_snapshot["latest_low"]["price"], detail_snapshot["pivot_lows"][-1]["price"])
        self.assertIsNotNone(detail_snapshot["low_rise_pct"])
        self.assertIsNotNone(detail_snapshot["from_latest_low_pct"])

    def test_higher_low_does_not_use_a_fixed_rebound_cap(self):
        daily = early_higher_low_daily()
        # 현재가가 마지막 스윙 저점 42,800원보다 16% 이상 높아도
        # 저점상승형 판정 자체는 유지한다. 완성된 돌파는 scan_stock의
        # breakout 필터가 검색 결과에서 제외한다.
        daily[-1].update(open=48000, high=51000, low=47000, close=50000, volume=450)

        detail = detector.detect_rising_lows(daily)

        self.assertIsNotNone(detail)
        self.assertGreaterEqual(detail["score"], 70)

    def test_early_higher_low_is_not_blocked_by_confirmation_signals(self):
        detail = detector.detect_rising_lows(early_higher_low_daily())

        self.assertIsNotNone(detail)
        self.assertGreaterEqual(detail["score"], 70)
        self.assertTrue(any("스윙 저점 순차 상승" in reason for reason in detail["reasons"]))

    def test_scan_includes_early_higher_low(self):
        results = {
            "risingLows": [],
            "doubleBottom": [],
            "invHeadShoulders": [],
            "boxRangeLow": [],
        }

        detector.scan_stock(
            {"code": "399720", "name": "가온칩스"},
            early_higher_low_daily(),
            results,
            [],
        )

        self.assertEqual([row["code"] for row in results["risingLows"]], ["399720"])

    def test_rising_lows_are_collected_after_other_pattern_limits(self):
        results = {
            "risingLows": [{} for _ in range(detector.PATTERN_MAX_MATCHES)],
            "doubleBottom": [],
            "invHeadShoulders": [],
            "boxRangeLow": [],
        }

        detector.scan_stock(
            {"code": "399720", "name": "가온칩스"},
            early_higher_low_daily(),
            results,
            [],
        )

        self.assertEqual(len(results["risingLows"]), detector.PATTERN_MAX_MATCHES + 1)

    def test_finalize_pattern_results_keeps_all_candidates_under_quality_limit(self):
        results = {
            "risingLows": [
                {"code": "%06d" % i, "score": 70, "date": "2026-08-%02d" % ((i % 9) + 1)}
                for i in range(16)
            ] + [{"code": "399720", "score": 100, "date": "2026-08-11"}],
        }

        detector.finalize_pattern_results(results)

        self.assertEqual(len(results["risingLows"]), 17)
        self.assertEqual(results["risingLows"][0]["code"], "399720")

    def test_finalize_pattern_results_strengthens_large_bucket_without_order_cut(self):
        results = {
            "risingLows": [
                {"code": "%06d" % i, "score": 60 if i < 8 else 80,
                 "date": "2026-08-01"}
                for i in range(21)
            ]
        }

        detector.finalize_pattern_results(results)

        self.assertEqual(len(results["risingLows"]), 13)
        self.assertTrue(all(row["score"] >= 80 for row in results["risingLows"]))

    def test_all_pattern_buckets_rank_before_the_display_cap(self):
        results = {
            key: [
                {"code": "%06d" % i, "score": 70 + (i % 3), "date": "2026-08-01"}
                for i in range(15)
            ] + [{"code": "999999", "score": 99, "date": "2026-08-01"}]
            for key in ("risingLows", "maCloudBreakout", "doubleBottom", "invHeadShoulders", "boxRangeLow")
        }
        pullback = list(results["boxRangeLow"])

        detector.finalize_pattern_results(results, pullback)

        for key in results:
            self.assertEqual(len(results[key]), 16)
            self.assertEqual(results[key][0]["code"], "999999")
        self.assertEqual(len(pullback), 16)
        self.assertEqual(pullback[0]["code"], "999999")


class ChartScanFilterTest(unittest.TestCase):
    def daily(self, volume=100):
        return [{
            "date": "2026-08-11", "open": 1000, "high": 1100,
            "low": 990, "close": 1050, "volume": volume,
        }]

    def test_excludes_products_and_non_common_stock_statuses(self):
        self.assertTrue(detector.is_excluded_stock({"name": "KODEX 200"}, self.daily()))
        self.assertTrue(detector.is_excluded_stock({"name": "삼성전자우"}, self.daily()))
        self.assertTrue(detector.is_excluded_stock({"name": "OO스팩"}, self.daily()))
        self.assertTrue(detector.is_excluded_stock({"name": "OO ETN"}, self.daily()))
        self.assertTrue(detector.is_excluded_stock({"name": "일반주", "is_trading_halted": True}, self.daily()))
        self.assertTrue(detector.is_excluded_stock({"name": "일반주"}, self.daily(volume=0)))
        self.assertFalse(detector.is_excluded_stock({"name": "삼성전자"}, self.daily()))


class OpeningGapDetectionTest(unittest.TestCase):
    def daily(self, open_price=10500, close_price=11000, volume=300000):
        return [
            {"date": "2026-08-10", "open": 10000, "high": 10000, "low": 10000,
             "close": 10000, "volume": volume},
            {"date": "2026-08-11", "open": open_price, "high": close_price,
             "low": open_price, "close": close_price, "volume": volume},
        ]

    def test_detects_b_k_g_l_conditions(self):
        detail = detector.detect_opening_gap(self.daily())

        self.assertIsNotNone(detail)
        self.assertAlmostEqual(detail["gapRatePct"], 5.0)
        self.assertAlmostEqual(detail["intradayRatePct"], 4.7619, places=3)
        self.assertAlmostEqual(detail["turnoverMillion"], 3300.0)

    def test_scan_exposes_opening_gap_bucket(self):
        results = {"risingLows": [], "maCloudBreakout": [], "doubleBottom": [],
                   "invHeadShoulders": [], "boxRangeLow": [], "openingGap": []}

        detector.scan_stock({"code": "000001", "name": "테스트"}, self.daily(), results, [])

        self.assertEqual([row["code"] for row in results["openingGap"]], ["000001"])

    def test_common_market_cap_filter_applies_to_all_pattern_results(self):
        results = {"risingLows": [], "maCloudBreakout": [], "doubleBottom": [],
                   "invHeadShoulders": [], "boxRangeLow": [], "openingGap": []}
        calls = []

        detector.scan_stock(
            {"code": "000001", "name": "테스트"}, self.daily(), results, [],
            market_cap_getter=lambda code: calls.append(code) or 2999,
            require_common_market_cap=True,
        )

        self.assertEqual(calls, ["000001"])
        self.assertEqual(results["openingGap"], [])


class BoxRangeLowerFilterTest(unittest.TestCase):
    def test_box_range_requires_all_screener_conditions_and_market_cap(self):
        detail = detector.detect_box_range_low(
            box_range_daily(), market_cap_eok=3000, require_market_cap=True)

        self.assertIsNotNone(detail)
        self.assertEqual(detail["criteria"]["closeMaNearCount"], 20)
        self.assertEqual(detail["criteria"]["openMaAboveCount"], 20)
        self.assertGreaterEqual(detail["criteria"]["rsi14"], 35)
        self.assertLessEqual(detail["criteria"]["rsi14"], 65)
        self.assertLessEqual(detail["criteria"]["closeRangePct"], 10)
        self.assertEqual(detail["criteria"]["marketCapEok"], 3000)

    def test_box_range_rejects_below_300_billion_market_cap(self):
        detail = detector.detect_box_range_low(
            box_range_daily(), market_cap_eok=2999.99, require_market_cap=True)

        self.assertIsNone(detail)

    def test_scan_fetches_market_cap_only_after_technical_prefilter(self):
        results = {"risingLows": [], "maCloudBreakout": [], "doubleBottom": [],
                   "invHeadShoulders": [], "boxRangeLow": []}
        calls = []

        detector.scan_stock(
            {"code": "000001", "name": "테스트"}, box_range_daily(), results, [],
            market_cap_getter=lambda code: calls.append(code) or 3000,
        )

        self.assertEqual(calls, ["000001"])
        self.assertEqual([row["code"] for row in results["boxRangeLow"]], ["000001"])


class MaCloudBreakoutDetectionTest(unittest.TestCase):
    def test_detects_early_ma_cloud_breakout(self):
        detail = detector.detect_ma_cloud_breakout(ma_cloud_breakout_daily())

        self.assertIsNotNone(detail)
        self.assertLessEqual(abs(detail["ma224"] - 10000.0) / 10000.0, detector.MA_CLOUD_NEAR_TOL)
        self.assertIn("5일선이 20일선 상향돌파", detail["reasons"][2])

    def test_scan_exposes_ma_cloud_breakout_bucket(self):
        results = {"risingLows": [], "doubleBottom": [], "invHeadShoulders": [], "boxRangeLow": []}

        detector.scan_stock({"code": "000001", "name": "테스트"}, ma_cloud_breakout_daily(), results, [])

        self.assertEqual([row["code"] for row in results["maCloudBreakout"]], ["000001"])

    def test_scan_excludes_penny_stocks(self):
        results = {"risingLows": [], "doubleBottom": [], "invHeadShoulders": [], "boxRangeLow": []}
        daily = ma_cloud_breakout_daily()
        for row in daily:
            for field in ("open", "high", "low", "close"):
                row[field] *= 0.05

        detector.scan_stock({"code": "000002", "name": "일반 종목"}, daily, results, [])

        self.assertEqual(results["maCloudBreakout"], [])

    def test_scan_excludes_etfs_even_when_price_is_large(self):
        results = {"risingLows": [], "doubleBottom": [], "invHeadShoulders": [], "boxRangeLow": []}

        detector.scan_stock({"code": "000003", "name": "KODEX 코스닥150", "is_etf": True},
                            ma_cloud_breakout_daily(), results, [])

        self.assertEqual(results["maCloudBreakout"], [])


class DoubleBottomDetectionTest(unittest.TestCase):
    """2026-08-21: pattern_detect.py를 pandas/numpy 기반으로 전환하면서 이 패턴에
    직접적인 단위 테스트가 없었다는 걸 발견해 같이 추가했다(기존에는 scan_stock을
    거치는 간접 테스트조차 없었음)."""

    def test_detects_double_bottom_and_neckline(self):
        detail = detector.detect_double_bottom(double_bottom_daily())

        self.assertIsNotNone(detail)
        self.assertAlmostEqual(detail["low1"]["price"], detail["low2"]["price"], delta=detail["low1"]["price"] * 0.01)
        self.assertGreater(detail["neckline"]["price"], detail["low1"]["price"])
        self.assertGreaterEqual(detail["score"], 70)

    def test_scan_exposes_double_bottom_bucket(self):
        results = {"risingLows": [], "maCloudBreakout": [], "doubleBottom": [],
                   "invHeadShoulders": [], "boxRangeLow": []}

        detector.scan_stock({"code": "000004", "name": "테스트"}, double_bottom_daily(), results, [])

        self.assertEqual([row["code"] for row in results["doubleBottom"]], ["000004"])


class InvHeadShouldersDetectionTest(unittest.TestCase):
    def test_detects_symmetric_shoulders_and_neckline(self):
        detail = detector.detect_inv_head_shoulders(inv_head_shoulders_daily())

        self.assertIsNotNone(detail)
        self.assertLess(detail["head"]["price"], detail["left_shoulder"]["price"])
        self.assertLess(detail["head"]["price"], detail["right_shoulder"]["price"])
        self.assertGreaterEqual(detail["score"], detector.IHS_MIN_SCORE)

    def test_scan_exposes_inv_head_shoulders_bucket(self):
        results = {"risingLows": [], "maCloudBreakout": [], "doubleBottom": [],
                   "invHeadShoulders": [], "boxRangeLow": []}

        detector.scan_stock({"code": "000005", "name": "테스트"}, inv_head_shoulders_daily(), results, [])

        self.assertEqual([row["code"] for row in results["invHeadShoulders"]], ["000005"])


class PullbackDetectionTest(unittest.TestCase):
    def test_detects_rise_then_pullback_near_ma20(self):
        detail = detector.detect_pullback(pullback_daily())

        self.assertIsNotNone(detail)
        self.assertGreater(detail["peak"]["price"], detail["rise_start"]["price"])
        self.assertGreaterEqual(detail["score"], detector.PULLBACK_MIN_SCORE)

    def test_scan_exposes_pullback_bucket(self):
        results = {"risingLows": [], "maCloudBreakout": [], "doubleBottom": [],
                   "invHeadShoulders": [], "boxRangeLow": []}
        pullback_matches = []

        detector.scan_stock({"code": "000006", "name": "테스트"}, pullback_daily(), results, pullback_matches)

        self.assertEqual([row["code"] for row in pullback_matches], ["000006"])


if __name__ == "__main__":
    unittest.main()
