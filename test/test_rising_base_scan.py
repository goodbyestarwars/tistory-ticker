# -*- coding: utf-8 -*-
"""장기 바닥·상승 수렴형 연구 검색기 회귀 검사. 표준 라이브러리만 사용."""
import json
import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import rising_base_scan as scan


def fixture():
    rows = []
    d = date(2024, 1, 1)
    for i in range(330):
        if i < 145:
            o = c = 10500.0
            h = 15500.0 if i == 20 else 10800.0
            l = 10200.0
        else:
            # 반복적인 저항 터치 + 상승하는 저점 (약 30봉 주기)
            k = (i - 145) // 30
            t = (i - 145) % 30
            bottom = 7000 + k * 250
            level = 10300
            if t == 6:
                o, c, h, l = bottom + 100, bottom + 150, bottom + 260, bottom
            elif t == 18:
                o, c, h, l = level - 200, level - 150, level, level - 350
            else:
                q = t / 18 if t < 18 else (30 - t) / 12
                q = max(0, min(1, q))
                o = c = bottom + (level - bottom - 280) * q
                h, l = c + 90, c - 90
        v = 300_000
        rows.append([(d + timedelta(days=i)).isoformat(), o, h, l, c, v])
    return rows


class BaseStudyTests(unittest.TestCase):
    def test_short_history_not_signal(self):
        self.assertEqual(scan.assess(fixture()[:220])["stage"], 0)

    def test_future_bars_never_affect_asof(self):
        rows = fixture()
        first = scan.assess(rows, 305)
        changed = rows[:306] + [[x[0], x[1] * 5, x[2] * 5, x[3] * 5, x[4] * 5, x[5]] for x in rows[306:]]
        self.assertEqual(first, scan.assess(changed, 305))

    def test_future_path_only_when_evaluate(self):
        rows = fixture()
        p = scan.forward_check(rows, 300)
        self.assertIn("d5", p)
        self.assertIn("d20", p)
        self.assertEqual(p["d60"], None)

    def test_invalid_input_rejected_not_fabricated(self):
        with tempfile.TemporaryDirectory() as folder:
            p = Path(folder) / "441270.json"
            rows = fixture()
            p.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
            self.assertEqual(len(scan.load_rows(p)), 330)
            rows[50][3] = 0
            p.write_text(json.dumps(rows), encoding="utf-8")
            with self.assertRaises(ValueError):
                scan.load_rows(p)

    def test_case_registry_kept_when_price_missing(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            case = root / "cases.json"
            case.write_text(json.dumps({"cases": [{"code": "441270", "name": "파인엠텍", "observedAt": "2026-10-21"}]}, ensure_ascii=False), encoding="utf-8")
            x = scan.run(root, case, "2026-10-21")
            self.assertEqual(x["cases"][0]["code"], "441270")
            self.assertFalse(x["cases"][0]["matched"])
            self.assertIn("일봉 캐시 없음", x["cases"][0]["scan"]["reason"])

    def test_three_stages_and_flags_defined(self):
        x = scan.assess(fixture())
        self.assertIn(x["stage"], (0, 1, 2, 3))
        self.assertIn("risingLows", x["flags"])
        self.assertIn("ma224Recovered", x["flags"])
        self.assertIn("converging", x["flags"])
        self.assertIn("resistanceGapPct", x)


if __name__ == "__main__":
    unittest.main()
