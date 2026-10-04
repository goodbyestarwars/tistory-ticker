import pathlib
import sys
import unittest
from datetime import date, timedelta


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "cloud-vm"))

import pattern_detect as detector


def base_building_daily(lows=(100.0, 104.0, 108.0, 112.0, 114.0), end_close=117.0, decline=True, spacing=15,
                        volume_base=500_000):
    """하락(앞 120봉) 뒤 바닥을 다지며 스윙 저점이 계단식으로 오르는 일봉 200개.

    2026-10-04 저점상승형 정교화용 픽스처 - lows는 계단 저점(종가 기준), spacing은 저점 간 간격(봉),
    decline=False면 앞 구간을 평평하게(하락 없이) 만든다.
    """
    n = 200
    first_idx = 125
    turns = [(0, 200.0 if decline else lows[0] + 3.0), (119, lows[0] + 0.5)]
    idx = first_idx
    peaks = []
    for k, low in enumerate(lows):
        turns.append((idx, low))
        peak_idx = idx + max(2, spacing // 2)
        peaks.append((peak_idx, low + 11.0 + k))
        turns.append((peak_idx, low + 11.0 + k))
        idx += spacing
    turns.append((n - 1, end_close))
    turns = sorted(set(turns))
    close = []
    for k in range(len(turns) - 1):
        (x0, y0), (x1, y1) = turns[k], turns[k + 1]
        for x in range(x0, x1):
            close.append(y0 + (y1 - y0) * (x - x0) / (x1 - x0))
    close.append(turns[-1][1])
    start = date(2025, 1, 1)
    daily = []
    for i, c in enumerate(close[:n]):
        daily.append({
            "date": (start + timedelta(days=i)).isoformat(),
            "open": c * 100, "high": (c + 0.5) * 100, "low": (c - 0.5) * 100, "close": c * 100,
            "volume": volume_base * (1.0 if i < 150 else 0.8),
        })
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
    # 2026-10-04 정교화: 하락 뒤 바닥을 다지며 스윙 저점이 계단식으로 오르고(3개 이상, 15거래일 이상),
    # 첫 저점 아래로 다시 내려가지 않았으며, 아직 많이 오르지 않은 종목만 남긴다.
    def test_base_with_stepping_lows_is_detected(self):
        detail = detector.detect_rising_lows(base_building_daily())
        self.assertIsNotNone(detail)
        self.assertGreaterEqual(len(detail["low_swings"]), 3)
        prices = [p["price"] for p in detail["low_swings"]]
        self.assertEqual(prices, sorted(prices))
        self.assertTrue(any("하방 막힘" in reason for reason in detail["reasons"]))

    def test_two_lows_only_is_excluded(self):
        # 저점이 2개뿐인 하락 파동 속 반등은 더 이상 저점상승형이 아니다(로보티즈류).
        self.assertIsNone(detector.detect_rising_lows(base_building_daily(lows=(100.0, 104.0), end_close=108.0)))

    def test_short_span_between_lows_is_excluded(self):
        self.assertIsNone(detector.detect_rising_lows(base_building_daily(spacing=6)))

    def test_already_rallied_is_excluded(self):
        # 마지막 저점(114) 대비 +10%를 넘어 이미 오른 상태
        self.assertIsNone(detector.detect_rising_lows(base_building_daily(end_close=130.0)))

    def test_no_prior_decline_is_excluded(self):
        self.assertIsNone(detector.detect_rising_lows(base_building_daily(decline=False)))

    def test_break_below_first_low_is_excluded(self):
        daily = base_building_daily()
        # 마지막 즈음 첫 저점(100) 아래로 내려간 봉이 있으면 하방이 막힌 게 아니다(마지막 저점이 계단을 끊는다)
        daily[-3].update(low=9800.0, close=9900.0)
        self.assertIsNone(detector.detect_rising_lows(daily))

    # 2026-10-04 유동성 필터(거래대금): 거래가 죽은 종목만 뺀다. 거래량이 "많아야" 한다는 조건은 쓰지 않는다.
    def test_low_average_trading_value_is_excluded(self):
        # 종가(약 1만 원대) x 거래량 5천 주 = 약 5천만 원 - 20일 평균 30억원 미달
        self.assertIsNone(detector.detect_rising_lows(base_building_daily(volume_base=5_000)))

    def test_recent_liquidity_collapse_is_excluded(self):
        daily = base_building_daily()
        for row in daily[-5:]:
            row["volume"] = 20_000        # 최근 5일 거래대금이 20일 평균의 60% 아래로 급감
        self.assertIsNone(detector.detect_rising_lows(daily))

    def test_repeated_zero_volume_days_are_excluded(self):
        daily = base_building_daily()
        for k in (-18, -12, -6):
            daily[k]["volume"] = 0
        self.assertIsNone(detector.detect_rising_lows(daily))

    def test_shrinking_volume_during_convergence_is_still_allowed(self):
        # 수렴 중 거래량 감소는 정상 - 마지막 구간 거래량이 줄어도(평균의 60% 이상) 통과한다.
        daily = base_building_daily()
        for row in daily[-5:]:
            row["volume"] = 330_000
        self.assertIsNotNone(detector.detect_rising_lows(daily))

    def test_median_shortfall_only_lowers_the_score(self):
        normal = detector.detect_rising_lows(base_building_daily())
        daily = base_building_daily()
        # 하루 대량거래로 평균은 충분하지만 중앙값은 15억원에 못 미치는 모양
        for k, row in enumerate(daily[-20:]):
            row["volume"] = 40_000 if k != 17 else 6_000_000
        spiky = detector.detect_rising_lows(daily)
        self.assertIsNotNone(spiky)       # hard filter가 아니라 감점
        self.assertLess(spiky["score"], normal["score"])
        self.assertTrue(any("중앙값 부족" in reason for reason in spiky["reasons"]))

    def test_not_enough_history_returns_none(self):
        self.assertIsNone(detector.detect_rising_lows(base_building_daily()[-100:]))

    def test_scan_exposes_pattern_detail_and_mini_chart(self):
        daily = base_building_daily()
        results = {"risingLows": [], "doubleBottom": [], "invHeadShoulders": [], "boxRangeLow": []}
        detector.scan_stock({"code": "000001", "name": "테스트"}, daily, results, [])
        self.assertEqual([row["code"] for row in results["risingLows"]], ["000001"])
        row = results["risingLows"][0]
        self.assertEqual(len(row["miniChart"]), 20)
        self.assertNotIn("closes_20d", row["patternDetail"])
        self.assertEqual(row["patternDetail"]["latest_low"]["price"], row["patternDetail"]["pivot_lows"][-1]["price"])
        self.assertIsNotNone(row["patternDetail"]["low_rise_pct"])

    def test_rising_lows_are_collected_after_other_pattern_limits(self):
        results = {
            "risingLows": [{} for _ in range(detector.PATTERN_MAX_MATCHES)],
            "doubleBottom": [],
            "invHeadShoulders": [],
            "boxRangeLow": [],
        }
        detector.scan_stock({"code": "399720", "name": "가온칩스"}, base_building_daily(), results, [])
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


def short_ma_breakout_daily(prev_close=90, final_close=95):
    """20봉 - 하락 스윙고점 2개(110@day2, 100@day10, PATTERN_SWING=2라 각각의 좌우
    2봉보다 높아야 스윙으로 잡힌다)로 그은 추세선을 마지막 날 종가+5일선이 함께
    돌파하는 케이스. trend_at(18)=90.0, trend_at(19)=88.75(직접 계산 - 아래 테스트에서
    재확인). prev_close=90(<=90*1.01, "아직 안 뚫은 상태")이고 final_close=95(>88.75)면
    "막 돌파" 케이스, prev_close를 더 올리면 "이미 돌파 완료"(breakout=True) 케이스가 된다."""
    # 2026-08-23: 원래 95~110 스케일이 동전주 제외 기준(PENNY_STOCK_MAX_PRICE=1,000원)에
    # 걸려 scan_stock() 통합 테스트가 조용히 빈 결과를 냈다 - x100 스케일(9,500~11,000원대)로
    # 올려서 비율(추세선 기울기·돌파폭 %)은 그대로 두고 절대가만 정상 범위로 맞춘다.
    scale = 100
    highs = [95, 105, 110, 95, 90, 85, 88, 92, 97, 99, 100, 98, 96, 90, 85, 80, 82, 84, 89, 95]
    closes = [90, 100, 105, 90, 85, 80, 83, 87, 92, 94, 95, 93, 91, 88, 84, 85, 87, 89,
              prev_close, final_close]
    daily = []
    for i in range(20):
        c = closes[i] * scale
        h = max(highs[i] * scale, c + 1)
        daily.append({
            'date': '2026-01-%02d' % (i + 1),
            'open': c - 1,
            'high': h,
            'low': c - 500,
            'close': c,
            'volume': 1000,
        })
    return daily


class ShortMaBreakoutDetectionTest(unittest.TestCase):
    def test_detects_fresh_breakout_above_declining_trendline(self):
        detail = detector.detect_short_ma_breakout(short_ma_breakout_daily())
        self.assertIsNotNone(detail)
        self.assertFalse(detail['breakout'])
        # trend_at(19) = 11000 + slope*(19-2), slope = (10000-11000)/(10-2) = -125 (x100 스케일)
        self.assertAlmostEqual(detail['resistance'], 8875.0, places=2)
        self.assertEqual(detail['signal']['price'], 9500)
        self.assertEqual(len(detail['trendline']), 2)

    def test_already_broken_out_is_flagged_and_excluded_by_caller(self):
        # 어제(prev_close=95)도 이미 추세선(90.0) 위였으면 "막 돌파"가 아니라 완료된
        # 돌파 - breakout=True로 표시돼 scan_stock에서 제외된다(다른 돌파형 패턴과 동일).
        detail = detector.detect_short_ma_breakout(short_ma_breakout_daily(prev_close=95, final_close=97))
        self.assertIsNotNone(detail)
        self.assertTrue(detail['breakout'])

    def test_returns_none_when_highs_are_not_declining(self):
        daily = short_ma_breakout_daily()
        daily[10]['high'] = 12000  # 두 번째 스윙 고점(원래 10000)을 첫 번째(11000)보다 높여 우상향으로 만든다
        self.assertIsNone(detector.detect_short_ma_breakout(daily))

    def test_returns_none_when_close_has_not_cleared_the_trendline(self):
        daily = short_ma_breakout_daily(prev_close=80, final_close=82)  # 여전히 추세선 아래
        self.assertIsNone(detector.detect_short_ma_breakout(daily))

    def test_scan_exposes_short_term_ma_breakout_bucket(self):
        results = {'risingLows': []}
        detector.scan_stock({'code': '000001', 'name': '테스트'}, short_ma_breakout_daily(), results, [])
        self.assertEqual([row['code'] for row in results['shortTermMaBreakout']], ['000001'])


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

    # 2026-08-22(5차) 신설(사용자 요청: "구름대를 뚫고 하락하면서 상단선 터치하는 건
    # 제외") - 어제 종가가 이미 구름 하단 아래(뚫고 하락한 상태)였다가 오늘 하루 만에
    # 구름 상단까지 튀어오른 경우는 급락 후 되돌림(휩쏘)으로 보고 제외해야 한다.
    def test_bounce_from_below_cloud_to_top_touch_is_excluded(self):
        daily = ma_cloud_breakout_daily()
        # 어제(마지막에서 두 번째 봉) 종가를 구름 하단(10000)보다 뚜렷이 낮게(9700, -3%)
        # 만들고, 오늘(마지막 봉)은 기존처럼 구름 상단(10200)을 고가로 시도하게 둔다.
        daily[-2].update(open=9750.0, high=9800.0, low=9650.0, close=9700.0)
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
