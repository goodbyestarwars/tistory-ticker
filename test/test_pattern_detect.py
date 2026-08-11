import pathlib
import sys
import unittest


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
    return daily


class RisingLowsDetectionTest(unittest.TestCase):
    def test_small_rise_and_short_gap_are_valid(self):
        detail = detector.detect_rising_lows(compact_higher_low_daily())

        self.assertIsNotNone(detail)
        self.assertLess(detail["score"], 70)

        results = {"risingLows": [], "doubleBottom": [], "invHeadShoulders": [], "boxRangeLow": []}
        detector.scan_stock({"code": "000001", "name": "테스트"}, compact_higher_low_daily(), results, [])
        self.assertEqual([row["code"] for row in results["risingLows"]], ["000001"])

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

    def test_finalize_pattern_results_keeps_only_top_15_candidates(self):
        results = {
            "risingLows": [
                {"code": "%06d" % i, "score": 70, "date": "2026-08-%02d" % ((i % 9) + 1)}
                for i in range(16)
            ] + [{"code": "399720", "score": 100, "date": "2026-08-11"}],
        }

        detector.finalize_pattern_results(results)

        self.assertEqual(len(results["risingLows"]), detector.RISING_LOWS_DISPLAY_LIMIT)
        self.assertEqual(results["risingLows"][0]["code"], "399720")


if __name__ == "__main__":
    unittest.main()
