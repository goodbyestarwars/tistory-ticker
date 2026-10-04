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


def ma_cloud_breakout_daily(tail=None, volume=120_000, last_volume=None):
    """300봉 평탄(종가 10,000원, 고가 10,100·저가 9,900) - 224일선=10,000, 일목 구름도 상단=하단≈10,000으로 모두 한곳에 응축.
    tail={마지막에서 몇 번째(음수): (종가, 고가, 저가)}로 마지막 봉들을 바꿔 상태별 케이스를 만든다.
    기본 마지막 봉은 고가 10,250으로 구름 상단(10,000)을 2.5% 위까지 시도(종가 10,000)해 COMPRESSION_READY가 된다."""
    daily = []
    start = date(2025, 1, 1)
    for i in range(300):
        daily.append({
            "date": (start + timedelta(days=i)).isoformat(),
            "open": 10000.0, "high": 10100.0, "low": 9900.0, "close": 10000.0, "volume": volume,
        })
    tail = tail if tail is not None else {-1: (10000.0, 10250.0, 9950.0)}
    for k, (close, high, low) in tail.items():
        daily[k].update(open=close, close=close, high=high, low=low)
    if last_volume is not None:
        daily[-1]["volume"] = last_volume
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


def short_ma_breakout_daily(prev_close=91, final_close=96, final_volume=200_000, h2_idx=16, h1_idx=8,
                            h2_high=110, bounce=None):
    """30봉 - 하락 스윙 고점 H1(120@8)·H2(110@16)로 그은 추세선(기울기 -1.25/봉, x100 스케일)을 마지막 날 종가가
    처음 돌파하는 케이스. trend(28)=95.0, trend(29)=93.75. 기본: 어제 91(추세선 아래), 오늘 96(+2.4%), 5일선 상승.
    bounce={idx: close}로 중간 봉 종가를 덮어써 "이미 한 번 돌파한 이력" 같은 변형을 만든다."""
    scale = 100
    closes = [90, 94, 98, 102, 106, 110, 113, 116, 118,          # 0..8 상승(H1=120 고점)
              114, 112, 110, 108, 107, 106, 106, 108,            # 9..16 (H2=110 고점 @16)
              104, 100, 96, 92, 89, 87, 86, 87, 88, 89, 90,      # 17..27 하락 후 바닥
              prev_close, final_close]                           # 28, 29
    closes = closes[:30]
    for k, v in (bounce or {}).items():
        closes[k] = v
    daily = []
    for i, c in enumerate(closes):
        c *= scale
        high = c + 100
        if i == h1_idx:
            high = 120 * scale
        if i == h2_idx:
            high = h2_high * scale
        daily.append({
            'date': '2026-02-%02d' % (i + 1) if i < 28 else '2026-03-%02d' % (i - 27),
            'open': c - 100, 'high': high, 'low': c - 100, 'close': c,
            'volume': final_volume if i == 29 else 200_000,
        })
    return daily


class ShortMaBreakoutDetectionTest(unittest.TestCase):
    def test_detects_first_breakout_above_declining_trendline(self):  # CASE 1
        detail = detector.detect_short_ma_breakout(short_ma_breakout_daily())
        self.assertIsNotNone(detail)
        self.assertFalse(detail['breakout'])
        self.assertEqual(detail['status'], 'BREAKOUT_NEW')
        self.assertAlmostEqual(detail['resistance'], 9375.0, places=2)
        self.assertEqual(detail['signal']['price'], 9600)
        self.assertEqual(len(detail['trendline']), 2)
        self.assertEqual([p['price'] for p in detail['high_swings']], [12000, 11000])
        self.assertLessEqual(detail['breakoutPct'], 5.0)
        self.assertTrue(detail['ma5Rising'])

    def test_close_below_ma5_is_excluded(self):  # CASE 2
        daily = short_ma_breakout_daily(prev_close=104, final_close=94)  # 종가는 추세선 돌파(93.75)지만 5일선 아래
        for row in daily[-6:-2]:
            row['close'] = row['open'] = row['low'] = 9800
            row['high'] = 9900
        self.assertIsNone(detector.detect_short_ma_breakout(daily))

    def test_falling_ma5_is_excluded(self):  # CASE 3
        daily = short_ma_breakout_daily(prev_close=94, final_close=95)
        # 5일선이 어제보다 낮아지도록 4일 전 종가를 크게 올려 둔다(오늘 종가는 5일선 위, 추세선 위)
        for row in daily[-6:-1]:
            row['close'] = 9200
            row['open'] = row['low'] = 9100
            row['high'] = 9300
        daily[-6]['close'] = 9900
        daily[-6]['high'] = 10000
        self.assertIsNone(detector.detect_short_ma_breakout(daily))

    def test_close_swing_highs_are_excluded(self):  # CASE 4: 두 고점 간격 2봉
        daily = short_ma_breakout_daily(h1_idx=14)
        self.assertIsNone(detector.detect_short_ma_breakout(daily))

    def test_previous_breakout_is_not_first_breakout(self):  # CASE 5
        daily = short_ma_breakout_daily(bounce={22: 100, 23: 100})  # H2 이후 추세선(~100.6 @22) 허용오차 이상 위로 마감 - 아래에서 보강
        for i in (22, 23):
            daily[i]['close'] = 11500
            daily[i]['high'] = 11600
        self.assertIsNone(detector.detect_short_ma_breakout(daily))

    def test_already_too_far_above_trendline_is_excluded(self):  # CASE 6: 추세선 +8%
        self.assertIsNone(detector.detect_short_ma_breakout(short_ma_breakout_daily(final_close=101)))

    def test_strong_volume_scores_higher_and_low_volume_still_passes(self):  # CASE 7·8
        strong = detector.detect_short_ma_breakout(short_ma_breakout_daily(final_volume=320_000))  # 1.6배
        weak = detector.detect_short_ma_breakout(short_ma_breakout_daily(final_volume=160_000))    # 0.8배
        self.assertIsNotNone(strong)
        self.assertIsNotNone(weak)
        self.assertGreater(strong['score'], weak['score'])
        self.assertAlmostEqual(strong['volumeRatio'], 1.6, places=1)

    def test_returns_none_when_highs_are_not_declining_enough(self):
        self.assertIsNone(detector.detect_short_ma_breakout(short_ma_breakout_daily(h2_high=119)))  # 1% 하락뿐

    def test_returns_none_when_close_has_not_cleared_the_trendline(self):
        self.assertIsNone(detector.detect_short_ma_breakout(short_ma_breakout_daily(prev_close=80, final_close=82)))

    def test_illiquid_stock_is_excluded(self):
        daily = short_ma_breakout_daily()
        for row in daily:
            row['volume'] = 1_000
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
        self.assertGreaterEqual(detail["criteria"]["ma20Slope10Pct"], -3.0)
        self.assertLessEqual(detail["criteria"]["lowerPositionPct"], 35.0)
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


class BoxRangeLowRedesignTest(unittest.TestCase):
    """2026-10-04 박스권 하단 개선: 거래량은 최근 5봉/20봉 평균, 20일선 급락 제외, 투매봉 제외, 하단 접근/반등 두 상태."""

    def detect(self, daily):
        return detector.detect_box_range_low(daily, market_cap_eok=3000, require_market_cap=True)

    def test_default_fixture_is_bottom_approach_or_rebound(self):
        detail = self.detect(box_range_daily())
        self.assertIn(detail["status"], ("APPROACH", "REBOUND"))
        self.assertEqual(detail["support"], 98000.0)      # 박스 하단 = 최근 20봉 최저 종가
        self.assertEqual(detail["resistance"], 102000.0)

    def test_rebound_when_low_tests_box_bottom_and_close_recovers(self):
        daily = box_range_daily()
        daily[-1].update(open=98500.0, high=100500.0, low=97800.0, close=99000.0)  # 하단 테스트 + 양봉 회복
        self.assertEqual(self.detect(daily)["status"], "REBOUND")

    def test_volume_explosion_down_candle_is_excluded(self):
        daily = box_range_daily()
        daily[-1].update(volume=100 * 8)                  # 음봉(시가 101000 > 종가 98000) + 평균의 2배 이상
        self.assertIsNone(self.detect(daily))

    def test_dead_volume_is_excluded(self):
        daily = box_range_daily()
        for row in daily[-5:]:
            row["volume"] = 20                             # 최근 5봉 평균이 20일 평균의 50% 아래
        self.assertIsNone(self.detect(daily))

    def test_staircase_down_ma20_is_excluded(self):
        daily = box_range_daily()
        for i in range(len(daily) - 10, len(daily)):
            for f in ("open", "high", "low", "close"):
                daily[i][f] *= 0.93                        # 10봉 동안 20일선이 3% 넘게 내려가는 하락 계단
        self.assertIsNone(self.detect(daily))

    def test_not_in_bottom_zone_is_excluded(self):
        daily = box_range_daily()
        daily[-1].update(open=101000.0, high=102500.0, low=100500.0, close=102000.0)   # 박스 상단
        self.assertIsNone(self.detect(daily))


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
    def detect(self, **kw):
        return detector.detect_ma_cloud_breakout(ma_cloud_breakout_daily(**kw))

    def test_compression_ready_near_cloud_top(self):  # CASE 1
        detail = self.detect()
        self.assertIsNotNone(detail)
        self.assertEqual(detail["status"], "COMPRESSION_READY")
        self.assertLessEqual(abs(detail["ma224Distance"]), 3.0)
        self.assertLessEqual(detail["maCloudDistance"], 5.0)
        self.assertEqual(len(detail["reasons"]), 3)

    def test_new_breakout_today_above_cloud_top(self):  # CASE 2: 어제 구름 안, 오늘 +2% 돌파
        detail = self.detect(tail={-1: (10200.0, 10250.0, 10000.0)})
        self.assertEqual(detail["status"], "BREAKOUT_NEW")
        self.assertAlmostEqual(detail["cloudTopDistance"], 2.0, places=1)
        self.assertEqual(detail["breakoutDate"], detail["signal"]["date"])

    def test_breakout_two_days_ago_is_kept_while_within_five_percent(self):  # CASE 3
        detail = self.detect(tail={-3: (10250.0, 10300.0, 10000.0), -2: (10300.0, 10350.0, 10200.0),
                                   -1: (10400.0, 10450.0, 10300.0)})
        self.assertEqual(detail["status"], "BREAKOUT_NEW")
        self.assertNotEqual(detail["breakoutDate"], detail["signal"]["date"])

    def test_old_breakout_is_excluded(self):  # CASE 4: 5거래일 전 돌파, 현재 +12%
        self.assertIsNone(self.detect(tail={-5: (10250.0, 10300.0, 10000.0), -4: (10500.0, 10550.0, 10300.0),
                                            -3: (10800.0, 10850.0, 10500.0), -2: (11000.0, 11050.0, 10800.0),
                                            -1: (11200.0, 11250.0, 11000.0)}))

    def test_old_breakout_still_close_to_top_is_excluded(self):
        # 구름 상단 위에 오래 머문 종목(최초 돌파 4거래일 전)은 "응축 후 출발"이 아니다
        self.assertIsNone(self.detect(tail={-4: (10250.0, 10300.0, 10000.0), -3: (10250.0, 10300.0, 10200.0),
                                            -2: (10300.0, 10350.0, 10200.0), -1: (10300.0, 10350.0, 10250.0)}))

    def test_far_cloud_from_ma224_is_excluded(self):  # CASE 5: 구름이 224일선보다 12% 위
        daily = ma_cloud_breakout_daily()
        last = len(daily) - 1
        for i in range(last - 26 - 51, last - 26 + 1):
            daily[i].update(high=11300.0, low=11100.0)
        self.assertIsNone(detector.detect_ma_cloud_breakout(daily))

    def test_close_far_below_cloud_bottom_is_excluded(self):  # CASE 6
        self.assertIsNone(self.detect(tail={-1: (9400.0, 9500.0, 9350.0)}))

    def test_steep_ma224_decline_is_excluded(self):  # CASE 7: 224일선이 20일 동안 -8% 이상
        daily = ma_cloud_breakout_daily()
        last = len(daily) - 1
        for i in range(last - 243, last - 223):
            daily[i].update(open=20000.0, close=20000.0, high=20100.0, low=19900.0)
        self.assertIsNone(detector.detect_ma_cloud_breakout(daily))

    def test_breakout_with_strong_volume_scores_higher(self):  # CASE 9
        tail = {-1: (10200.0, 10250.0, 10000.0)}
        strong = self.detect(tail=tail, last_volume=216_000)  # 1.8배
        weak = self.detect(tail=tail, last_volume=96_000)     # 0.8배
        self.assertIsNotNone(strong)
        self.assertIsNotNone(weak)                            # 거래량이 적다고 제외하지 않는다
        self.assertGreater(strong["score"], weak["score"])

    def test_illiquid_stock_is_excluded(self):
        self.assertIsNone(self.detect(volume=1_000))

    def test_cloud_uses_no_future_data(self):
        # 마지막 봉을 바꿔도 같은 날짜의 구름(26봉 전 값으로 계산)은 변하지 않는다
        base = ma_cloud_breakout_daily()
        changed = ma_cloud_breakout_daily(tail={-1: (12000.0, 12500.0, 11500.0)})
        self.assertEqual(detector.ichimoku_cloud_at(base, len(base) - 1), detector.ichimoku_cloud_at(changed, len(changed) - 1))

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


class DoubleBottomStatusTest(unittest.TestCase):
    """2026-10-04 쌍바닥 개선: RECOVERY / NECKLINE_READY 두 상태, 넥라인 5% 초과 제외, L2 이후 바닥 훼손 제외, 3봉 평균 거래량."""

    def test_default_fixture_is_neckline_ready(self):
        detail = detector.detect_double_bottom(double_bottom_daily())
        self.assertEqual(detail["status"], "NECKLINE_READY")
        self.assertFalse(detail["breakout"])
        self.assertLessEqual(detail["bottomDiffPct"], 3.0)
        self.assertGreaterEqual(detail["reboundPct"], 8.0)

    def test_recovery_state_when_still_far_below_neckline(self):
        daily = double_bottom_daily()
        neck = max(r["high"] for r in daily[66:96])
        low2 = daily[96]["low"]
        c = low2 + 0.62 * (neck - low2)
        daily[-1].update(open=c * 0.99, close=c, high=c * 1.01, low=c * 0.985)
        detail = detector.detect_double_bottom(daily)
        self.assertIsNotNone(detail)
        self.assertEqual(detail["status"], "RECOVERY")

    def test_far_below_neckline_without_recovery_is_excluded(self):
        daily = double_bottom_daily()
        low2 = daily[96]["low"]
        daily[-1].update(open=low2 * 1.01, close=low2 * 1.002, high=low2 * 1.02, low=low2 * 1.001)
        self.assertIsNone(detector.detect_double_bottom(daily))

    def test_already_broken_far_above_neckline_is_excluded(self):
        daily = double_bottom_daily()
        neck = max(r["high"] for r in daily[66:96])
        daily[-1].update(open=neck * 1.07, close=neck * 1.08, high=neck * 1.09, low=neck * 1.06)
        self.assertIsNone(detector.detect_double_bottom(daily))

    def test_breaking_the_bottom_after_l2_is_excluded(self):
        daily = double_bottom_daily()
        low2 = daily[96]["low"]
        daily[-2].update(low=low2 * 0.95)
        self.assertIsNone(detector.detect_double_bottom(daily))

    def test_l2_volume_uses_three_bar_average(self):
        daily = double_bottom_daily()
        daily[96]["volume"] = 1000 * 1.2    # 하루 거래량은 L1(2,500)보다 낮고, 3봉 평균도 허용 범위
        self.assertIsNotNone(detector.detect_double_bottom(daily))
        daily[96]["volume"] = 4000          # L2 주변 거래량이 L1의 110% 초과
        self.assertIsNone(detector.detect_double_bottom(daily))


class InvHeadShouldersDetectionTest(unittest.TestCase):
    def test_detects_symmetric_shoulders_and_neckline(self):
        detail = detector.detect_inv_head_shoulders(inv_head_shoulders_daily())

        self.assertIsNotNone(detail)
        self.assertLess(detail["head"]["price"], detail["left_shoulder"]["price"])
        self.assertLess(detail["head"]["price"], detail["right_shoulder"]["price"])
        self.assertGreaterEqual(detail["score"], detector.IHS_MIN_SCORE)

    def test_neckline_is_sloped_line_through_both_peaks(self):
        """2026-10-04: 넥라인 = N1(좌어깨~헤드 최고점)과 N2(헤드~우어깨 최고점)를 잇는 기울어진 선. 수평 max(N1,N2)는 neckline 필드(호환)."""
        detail = detector.detect_inv_head_shoulders(inv_head_shoulders_daily())
        self.assertIsNotNone(detail)
        line = detail["neckline_line"]
        self.assertEqual(line[0]["price"], detail["left_peak"]["price"])
        self.assertLess(detail["neckline_today"], detail["left_peak"]["price"])   # peak1 > peak2라 오른쪽 아래로 기운 선
        self.assertAlmostEqual(detail["neckline"]["price"], detail["left_peak"]["price"], delta=1)
        self.assertEqual(detail["status"], "BREAKOUT_NEW")
        self.assertFalse(detail["breakout"])

    def test_neckline_ready_when_within_one_percent_below(self):
        daily = inv_head_shoulders_daily()
        detail = detector.detect_inv_head_shoulders(daily)
        neck = detail["neckline_today"]
        daily[-1].update(open=neck * 0.985, close=neck * 0.995, high=neck * 1.0, low=neck * 0.98)
        ready = detector.detect_inv_head_shoulders(daily)
        self.assertIsNotNone(ready)
        self.assertEqual(ready["status"], "NECKLINE_READY")

    def test_far_above_neckline_is_excluded(self):
        daily = inv_head_shoulders_daily()
        neck = detector.detect_inv_head_shoulders(daily)["neckline_today"]
        daily[-1].update(open=neck * 1.06, close=neck * 1.08, high=neck * 1.09, low=neck * 1.05)
        detail = detector.detect_inv_head_shoulders(daily)
        # 원래 조합은 넥라인 +8%라 제외된다(다른 저점 조합이 잡혀도 반드시 넥라인 +5% 이내여야 한다)
        self.assertTrue(detail is None or detail["necklineDistancePct"] <= 5.0)
        self.assertTrue(detail is None or detail["left_shoulder"]["date"] != detector.detect_inv_head_shoulders(inv_head_shoulders_daily())["left_shoulder"]["date"])

    def test_old_breakout_is_not_new(self):
        daily = inv_head_shoulders_daily()
        neck = detector.detect_inv_head_shoulders(daily)["neckline_today"]
        for k in (-4, -3, -2):                      # 4거래일 전부터 이미 넥라인 위에 머문 종목
            daily[k].update(open=neck * 1.01, close=neck * 1.02, high=neck * 1.03, low=neck * 1.0)
        daily[-1].update(open=neck * 1.01, close=neck * 1.03, high=neck * 1.04, low=neck * 1.0)
        self.assertIsNone(detector.detect_inv_head_shoulders(daily))

    def test_low_volume_is_not_a_hard_filter(self):
        daily = inv_head_shoulders_daily()
        for row in daily[-5:]:
            row["volume"] = 100
        strong = detector.detect_inv_head_shoulders(inv_head_shoulders_daily())
        weak = detector.detect_inv_head_shoulders(daily)
        self.assertIsNotNone(weak)
        self.assertLess(weak["score"], strong["score"])

    def test_right_shoulder_must_be_recent(self):
        daily = inv_head_shoulders_daily()
        for k in range(len(daily) - 14, len(daily)):      # 우어깨(마지막-4)를 15봉 전으로 밀어낸 효과: 뒤에 평탄 봉을 붙인다
            pass
        extra = []
        last = daily[-1]
        for i in range(8):
            extra.append(dict(last, date="2026-06-%02d" % (i + 1)))
        self.assertIsNone(detector.detect_inv_head_shoulders(daily + extra))

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

    def test_correction_volume_spike_only_lowers_score(self):
        """2026-10-04 개편: 조정구간 최고 거래량이 상승구간 최고의 70%를 넘는 것은 더 이상 제외 조건이 아니다(평균 비교가 주 조건).
        가산 5점만 빠진다."""
        daily = pullback_daily()
        base = detector.detect_pullback(daily)
        daily[250]["volume"] = 2000
        spiky = detector.detect_pullback(daily)
        self.assertIsNotNone(spiky)
        self.assertLess(spiky["score"], base["score"])

    def test_pullback_volume_average_must_be_below_rise_average(self):
        daily = pullback_daily()
        for row in daily[251:]:
            row["volume"] = 5000        # 조정구간 평균 거래량이 상승구간보다 큼
        self.assertIsNone(detector.detect_pullback(daily))

    def test_pullback_result_reports_status_and_support_kind(self):
        detail = detector.detect_pullback(pullback_daily())
        self.assertIn(detail["status"], ("PULLING_BACK", "SUPPORT_CONFIRMED"))
        self.assertIn(detail["supportKind"], ("MA20", "MA240", "MA20+MA240"))
        self.assertGreaterEqual(detail["risePct"], 15.0)
        self.assertTrue(5.0 <= detail["pullbackPct"] <= 15.0)

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
