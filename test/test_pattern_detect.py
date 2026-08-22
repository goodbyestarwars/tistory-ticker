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


def compact_higher_low_daily(second_low_close=100.4):
    """20일 안에서 4거래일 간격인 두 저점을 만든다. second_low_close로 상승폭을 조절한다
    (기본값 100.4는 첫 저점 100 대비 0.4%만 오른 박스권 노이즈 케이스)."""
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
    for i, close in ((8, 100), (9, 111), (10, 112), (11, 113), (12, second_low_close), (13, 114), (14, 115)):
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
    """2026-08-22: 저점 탐색이 "오늘 기준" 창에서 "고점 기준" PULLBACK_LOW_SEARCH_WINDOW
    (25봉)로 바뀌면서, 저점은 이제 고점(peak_idx) 직전 25봉 안에서 찾는다 - 평평한 구간
    (전부 동일가) 안에 있어도 상관없다(같은 값이면 가장 이른 날짜를 저점으로 잡음).
    드롭구간 거래량도 상승구간 최고 거래량의 70%(PULLBACK_MAX_VOL_RATIO) 이하로 낮춰서
    새로 추가된 조정구간 거래량 상한 조건을 통과하도록 뒀다."""
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
        vol = max(1400 - i * 130, 100)  # 조정구간 거래량 감소(상승구간 최고 거래량 2100의 70%=1470 이하로)
        daily.append({
            "date": (start + timedelta(days=len(daily))).isoformat(),
            "open": price * 1.001, "high": price * 1.006, "low": price * 0.995, "close": price, "volume": vol,
        })
    daily[-1]["close"] = daily[-1]["open"] * 1.002  # 최근 캔들 양봉
    return daily


class RisingLowsDetectionTest(unittest.TestCase):
    # 2026-08-22: 박스권 안에서 저점이 0.4%만 오른 기업은행 사례가 저점상승형으로 잡히는
    # 문제가 리포트됨(미원에쓰씨 같은 뚜렷한 V자 반등만 남기고 싶다는 요청) - WEDGE_MIN_LOW_RISE
    # 미만인 미세한 저점 상승은 이제 제외한다.
    def test_rise_below_min_threshold_is_excluded(self):
        detail = detector.detect_rising_lows(compact_higher_low_daily(second_low_close=100.4))
        self.assertIsNone(detail)

    def test_short_gap_with_sufficient_rise_is_valid(self):
        daily = compact_higher_low_daily(second_low_close=108)
        detail = detector.detect_rising_lows(daily)

        self.assertIsNotNone(detail)

        results = {"risingLows": [], "doubleBottom": [], "invHeadShoulders": [], "boxRangeLow": []}
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

    # 2026-08-22(3차) 신설: 사용자가 라이브 차트 스크린샷으로 "저점 상승형인데 하단 선이
    # 저-저-고로 꺾여 보인다"고 리포트 - 20봉 창 안에 스윙 저점이 3개 이상이면(판정에는
    # 마지막 두 개만 비교하지만) 예전엔 그 전부를 차트에 그려서, 판정에 안 쓰인 더 이전의
    # 저점까지 선에 포함돼 단조 상승이 아닌 지그재그로 보였다.
    # 2026-08-22(4차): 처음엔 "마지막 두 점만 그린다"로 고쳤는데, 사용자가 "2봉 이상 쭉
    # 올라가는 건 다 검출해야지"라고 지적 - 스윙 저점 3개 이상이 전부 계단식으로 오르는
    # 진짜 저점상승형까지 마지막 두 점으로 뭉개버리면 안 된다. 그래서 마지막 저점에서
    # 거꾸로 훑어 "직전 저점이 그보다 낮은 동안"만 포함시키고(=계단이 끊기지 않는 동안),
    # 계단이 끊기는 지점(그 저점이 다음 저점보다 낮지 않은 지점)에서 멈추는 방식으로
    # 다시 고쳤다. 이러면 진짜 계단식 다단 상승은 전부 표시되고, 원래 버그였던 "계단을
    # 끊는 더 이전 저점"만 정확히 제외된다.
    def _rising_lows_daily(self, dip1_low, dip2_low, dip3_low):
        daily = []
        for i in range(20):
            close = 200 + i
            daily.append({
                "date": "2026-03-%02d" % (i + 1),
                "open": close, "high": close + 1, "low": close - 1, "close": close,
                "volume": 100,
            })
        daily[3].update(open=dip1_low + 1, high=dip1_low + 2, low=dip1_low, close=dip1_low + 1)
        daily[10].update(open=dip2_low + 1, high=dip2_low + 2, low=dip2_low, close=dip2_low + 1)
        daily[17].update(open=dip3_low + 1, high=dip3_low + 2, low=dip3_low, close=dip3_low + 1)
        daily[19].update(open=96, high=100, low=95, close=max(98, dip3_low + 8))  # 현재가 - 마지막 저점 위
        return daily

    def test_rising_lows_chart_shows_the_full_monotonic_staircase(self):
        # dip1(50) < dip2(80) < dip3(90) - 전부 계단식으로 오르는 진짜 3단 저점상승형이라
        # 세 점 다 보여야 한다(마지막 두 점만 남기면 정보 손실).
        detail = detector.detect_rising_lows(self._rising_lows_daily(50, 80, 90))
        self.assertIsNotNone(detail)
        self.assertEqual([p["price"] for p in detail["low_swings"]], [50, 80, 90])

    def test_rising_lows_chart_excludes_earlier_low_that_breaks_the_staircase(self):
        # dip1(85)은 dip2(80)보다 낮지 않아(오히려 더 높아) 계단이 끊긴다 - 판정에는
        # 마지막 두 점(80->90)만 쓰이므로 차트에도 이 둘만 남고 dip1(85)은 제외돼야
        # 한다(그렸다가는 저-저-고/지그재그로 다시 보임 - 원래 사용자 리포트).
        detail = detector.detect_rising_lows(self._rising_lows_daily(85, 80, 90))
        self.assertIsNotNone(detail)
        self.assertEqual([p["price"] for p in detail["low_swings"]], [80, 90])

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

    def test_reason_labels_are_sequential_and_match_execution_order(self):
        """2026-08-22 추가: A,B,C,D,E,G,J로 흩어져 있던 라벨을 실행 순서에 맞춰 A~G
        연속 알파벳으로 재정렬했다 - 순서·문자 둘 다 확인."""
        detail = detector.detect_box_range_low(
            box_range_daily(), market_cap_eok=3000, require_market_cap=True)

        self.assertIsNotNone(detail)
        labels = [r.split(' ', 1)[0] for r in detail["reasons"]]
        self.assertEqual(labels, ['A', 'B', 'C', 'D', 'E', 'F', 'G'])

    def test_box_range_low_result_includes_entry_trigger(self):
        """2026-08-22 추가(작업지시서 3단계): detect_box_range_low 결과에 entryTrigger/
        entrySignal이 붙어야 한다."""
        detail = detector.detect_box_range_low(
            box_range_daily(), market_cap_eok=3000, require_market_cap=True)

        self.assertIsNotNone(detail)
        self.assertIn("entryTrigger", detail)
        self.assertIn("entrySignal", detail)
        self.assertIsInstance(detail["entrySignal"], bool)

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


def _entry_trigger_daily(last_open, last_close, last_low, last_high, last_volume):
    """check_box_range_low_entry_trigger 테스트용 - 앞 9봉은 종가/거래량 100으로
    평평하게 두고 마지막 1봉만 인자로 받은 값을 넣는다(ma5/거래량평균 기준선 고정용)."""
    daily = []
    start = date(2025, 1, 1)
    for i in range(9):
        daily.append({
            "date": (start + timedelta(days=i)).isoformat(),
            "open": 950.0, "high": 952.0, "low": 948.0, "close": 950.0, "volume": 100,
        })
    daily.append({
        "date": (start + timedelta(days=9)).isoformat(),
        "open": last_open, "high": last_high, "low": last_low, "close": last_close, "volume": last_volume,
    })
    return daily


class BoxRangeLowEntryTriggerTest(unittest.TestCase):
    """2026-08-22 신설(작업지시서 2단계) - support=900/resistance=1100(박스 높이 200)
    기준, Zone은 종가 896~970 사이(비율 -2%~35%)."""

    BOX_RESULT = {"support": 900.0, "resistance": 1100.0}

    def test_out_of_zone_returns_none(self):
        daily = _entry_trigger_daily(1040.0, 1050.0, 1035.0, 1055.0, 100)  # zone 75% 위치
        result = detector.check_box_range_low_entry_trigger(daily, self.BOX_RESULT)
        self.assertIsNone(result)

    def test_two_signals_trigger_entry(self):
        # 양봉(캔들) + 거래량 급증(300 >= 평균100*1.3) = 2신호, 5일선과는 멀리 둬서 3번째 신호는 꺼둠
        daily = _entry_trigger_daily(945.0, 960.0, 940.0, 975.0, 300)
        result = detector.check_box_range_low_entry_trigger(daily, self.BOX_RESULT)

        self.assertIsNotNone(result)
        self.assertTrue(result["candle_signal"])
        self.assertTrue(result["volume_signal"])
        self.assertFalse(result["ma5_signal"])
        self.assertEqual(result["signals_met"], 2)
        self.assertTrue(result["entry_signal"])
        self.assertAlmostEqual(result["zone_position_pct"], 30.0, delta=0.01)

    def test_single_signal_does_not_trigger_entry(self):
        # 양봉(캔들)만 충족, 거래량은 평소 수준, 5일선과도 멀리 둠
        daily = _entry_trigger_daily(945.0, 960.0, 940.0, 975.0, 100)
        result = detector.check_box_range_low_entry_trigger(daily, self.BOX_RESULT)

        self.assertIsNotNone(result)
        self.assertTrue(result["candle_signal"])
        self.assertFalse(result["volume_signal"])
        self.assertFalse(result["ma5_signal"])
        self.assertEqual(result["signals_met"], 1)
        self.assertFalse(result["entry_signal"])

    def test_missing_box_result_returns_none(self):
        daily = _entry_trigger_daily(945.0, 960.0, 940.0, 975.0, 300)
        self.assertIsNone(detector.check_box_range_low_entry_trigger(daily, None))
        self.assertIsNone(detector.check_box_range_low_entry_trigger(daily, {}))


class MaCloudBreakoutDetectionTest(unittest.TestCase):
    def test_detects_early_ma_cloud_breakout(self):
        detail = detector.detect_ma_cloud_breakout(ma_cloud_breakout_daily())

        self.assertIsNotNone(detail)
        self.assertLessEqual(abs(detail["ma224"] - 10000.0) / 10000.0, detector.MA_CLOUD_NEAR_TOL)
        # 2026-08-22: 골든크로스 요건이 완전히 제거돼 이제 조건이 224일선 근접 + 구름
        # 상단 시도 2개뿐이다(reasons도 2개).
        self.assertEqual(len(detail["reasons"]), 2)

    def test_below_cloud_bottom_is_still_included(self):
        """2026-08-22: 구름 하단을 뚫고 내려간 경우도 포함하라는 요청 - 상단만 안 넘었으면
        통과해야 한다(구름 아래에서 다시 올라오는 중인 케이스). 구름[bottom=10000, top=10200]
        기준으로 마지막 봉 종가만 하단 아래(9900, -2% 안)로 내리고 고가는 그대로 둔다
        (224일선과는 여전히 3% 이내)."""
        daily = ma_cloud_breakout_daily()
        daily[-1].update(high=10200.0, low=9850.0, close=9900.0)

        detail = detector.detect_ma_cloud_breakout(daily)
        self.assertIsNotNone(detail)
        self.assertLess(detail["signal"]["price"], 10000.0)  # 종가가 구름 하단 아래

    def test_far_below_cloud_bottom_is_excluded(self):
        """2026-08-22(4차) 추가: 종가가 구름 하단보다 2% 넘게 처진 역배열 약세 종목은
        저가만 하단에 닿았어도 이제 제외된다(최소 위치 조건)."""
        daily = ma_cloud_breakout_daily()
        # close=9750은 224일선(~10000.9)과는 여전히 2.5%로 근접 조건(3%)을 통과하지만,
        # 구름 하단(10000)의 -2.5%라 최소 위치 조건(-2% 이내)엔 못 미친다.
        daily[-1].update(high=9900.0, low=9500.0, close=9750.0)

        detail = detector.detect_ma_cloud_breakout(daily)
        self.assertIsNone(detail)

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

    def test_deeper_low_between_the_two_bottoms_is_excluded(self):
        """2026-08-22 추가: 두 저점 사이에 그보다 2% 넘게 더 낮은 저가가 끼어있으면
        W자 쌍바닥이 아니라 중간에 더 낮은 저점이 있는 잘못된 조합으로 보고 제외한다."""
        daily = double_bottom_daily()
        i1, i2 = 66, 96  # double_bottom_daily()와 동일한 계산(n=100, i2=n-4, i1=i2-30)
        dip_idx = 75  # i1<dip_idx<i2, 넥라인(mid=81)과 겹치지 않는 지점
        low1 = daily[i1]["low"]
        daily[dip_idx].update(low=low1 * 0.9, high=low1 * 0.95, open=low1 * 0.93, close=low1 * 0.93)

        detail = detector.detect_double_bottom(daily)
        self.assertIsNone(detail)


class InvHeadShouldersDetectionTest(unittest.TestCase):
    def test_detects_symmetric_shoulders_and_neckline(self):
        detail = detector.detect_inv_head_shoulders(inv_head_shoulders_daily())

        self.assertIsNotNone(detail)
        self.assertLess(detail["head"]["price"], detail["left_shoulder"]["price"])
        self.assertLess(detail["head"]["price"], detail["right_shoulder"]["price"])
        self.assertGreaterEqual(detail["score"], detector.IHS_MIN_SCORE)

    def test_neckline_uses_the_higher_of_the_two_peaks(self):
        """2026-08-22 추가: 넥라인 = max(좌어깨~헤드 고가, 헤드~우어깨 고가)로 변경(사용자
        요청) - inv_head_shoulders_daily()는 peak1(1.07*base) > peak2(1.06*base)이므로
        더 높은 peak1이 넥라인이어야 한다."""
        detail = detector.detect_inv_head_shoulders(inv_head_shoulders_daily())

        self.assertIsNotNone(detail)
        self.assertAlmostEqual(detail["neckline"]["price"], detail["left_peak"]["price"], delta=1)
        self.assertGreater(detail["neckline"]["price"], detail["right_peak"]["price"])

    def test_new_low_after_right_shoulder_is_excluded(self):
        """2026-08-22 추가: 우어깨 이후 최저가가 헤드 저점보다 1% 넘게 더 빠지면(새로운
        저점 재형성) 역헤드앤숄더 무효로 처리한다."""
        daily = inv_head_shoulders_daily()
        n = len(daily)
        i_r = n - 4
        head_price = daily[i_r - 20]["low"]
        dip_idx = i_r + 3  # 우어깨 이후, 마지막 봉 이전
        daily[dip_idx].update(low=head_price * 0.9, high=head_price * 0.95,
                               open=head_price * 0.93, close=head_price * 0.93)

        detail = detector.detect_inv_head_shoulders(daily)
        self.assertIsNone(detail)

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

    def test_result_includes_entry_trigger(self):
        """2026-08-22 추가(작업지시서 4단계): detect_pullback 결과에 entryTrigger/
        entrySignal이 붙어야 한다."""
        detail = detector.detect_pullback(pullback_daily())

        self.assertIsNotNone(detail)
        self.assertIn("entryTrigger", detail)
        self.assertIn("entrySignal", detail)
        self.assertIsInstance(detail["entrySignal"], bool)

    def test_correction_volume_spike_near_rise_max_is_excluded(self):
        """2026-08-22 추가: 조정구간 최대거래량이 상승구간 최대거래량의 70%를 넘으면
        (거래량 감소 방향 자체는 맞아도) 이제 제외된다."""
        daily = pullback_daily()
        # 조정구간 첫날 거래량을 상승구간 최고치(2100)의 70%(1470)보다 높게 올린다
        # (그 뒤로는 원래처럼 감소해 is_volume_declining 자체는 여전히 참이 되도록 유지).
        daily[250]["volume"] = 2000
        self.assertIsNone(detector.detect_pullback(daily))

    def test_trend_filter_version_b_tolerates_mild_ma20_decline(self):
        """PULLBACK_TREND_FILTER_VERSION='ma20_slope_tol'(기본값)은 20일선이 완만하게
        하락(-0.5% 이내)해도 통과시킨다."""
        self.assertEqual(detector.PULLBACK_TREND_FILTER_VERSION, 'ma20_slope_tol')
        detail = detector.detect_pullback(pullback_daily())
        self.assertIsNotNone(detail)


class PullbackEntryTriggerTest(unittest.TestCase):
    """2026-08-22 신설(작업지시서 4단계) - support_price=1000 기준, MA_TOL(3%) 이내 근접."""

    PULLBACK_RESULT = {"ma20": 1000.0, "ma240": 900.0}

    def _daily(self, last_open, last_close, last_low, last_high):
        daily = []
        start = date(2025, 1, 1)
        for i in range(9):
            daily.append({
                "date": (start + timedelta(days=i)).isoformat(),
                "open": 1000.0, "high": 1010.0, "low": 990.0, "close": 1000.0, "volume": 100,
            })
        daily.append({
            "date": (start + timedelta(days=9)).isoformat(),
            "open": last_open, "high": last_high, "low": last_low, "close": last_close, "volume": 100,
        })
        return daily

    def test_out_of_zone_returns_none(self):
        daily = self._daily(1100.0, 1110.0, 1095.0, 1115.0)  # ma20(1000) 대비 11% 이탈
        self.assertIsNone(detector.check_pullback_entry_trigger(daily, self.PULLBACK_RESULT))

    def test_wick_signal_triggers_entry(self):
        # 몸통 5, 아래꼬리 15(몸통의 3배) - 종가는 시가보다 낮아 양봉은 아님
        daily = self._daily(1005.0, 1000.0, 985.0, 1006.0)
        result = detector.check_pullback_entry_trigger(daily, self.PULLBACK_RESULT)

        self.assertIsNotNone(result)
        self.assertTrue(result["wick_signal"])
        self.assertFalse(result["bullish_signal"])
        self.assertTrue(result["entry_signal"])
        self.assertEqual(result["support_label"], "20일선")

    def test_bullish_flip_triggers_entry_without_wick(self):
        # 양봉이지만 아래꼬리는 몸통보다 작음
        daily = self._daily(998.0, 1005.0, 997.0, 1006.0)
        result = detector.check_pullback_entry_trigger(daily, self.PULLBACK_RESULT)

        self.assertIsNotNone(result)
        self.assertFalse(result["wick_signal"])
        self.assertTrue(result["bullish_signal"])
        self.assertTrue(result["entry_signal"])

    def test_neither_signal_does_not_trigger(self):
        # 음봉, 아래꼬리도 짧음
        daily = self._daily(1005.0, 1000.0, 998.0, 1006.0)
        result = detector.check_pullback_entry_trigger(daily, self.PULLBACK_RESULT)

        self.assertIsNotNone(result)
        self.assertFalse(result["wick_signal"])
        self.assertFalse(result["bullish_signal"])
        self.assertFalse(result["entry_signal"])


class MarketRegimeTest(unittest.TestCase):
    def test_above_ma_true_when_close_over_ma(self):
        daily = [{"date": "2025-01-%02d" % (i + 1), "close": 100.0 + i} for i in range(25)]
        result = detector.check_market_regime(daily, ma_period=20)

        self.assertIsNotNone(result)
        self.assertTrue(result["above_ma"])

    def test_returns_none_when_not_enough_days(self):
        daily = [{"date": "2025-01-01", "close": 100.0}]
        self.assertIsNone(detector.check_market_regime(daily, ma_period=20))


if __name__ == "__main__":
    unittest.main()
