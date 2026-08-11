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


class RisingLowsDetectionTest(unittest.TestCase):
    def test_early_higher_low_is_not_blocked_by_confirmation_signals(self):
        detail = detector.detect_rising_lows(early_higher_low_daily())

        self.assertIsNotNone(detail)
        self.assertGreaterEqual(detail["score"], 70)
        self.assertTrue(any("저점 7.1% 상승" in reason for reason in detail["reasons"]))

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


if __name__ == "__main__":
    unittest.main()
