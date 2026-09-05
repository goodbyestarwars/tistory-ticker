"""시장 시간 단일 기준(js/skin-shell.js의 MarketHours) 경계 검증.

사용자가 준 한국거래소·미국 시간표를 그대로 못박는다. 소스 문자열을 훑는 게 아니라
node로 모듈을 실제 실행해 경계를 확인한다 - 경계는 문자열이 아니라 동작이라서다.
"""
import json
import os
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHELL = os.path.join(ROOT, "js", "skin-shell.js")

# KST 문자열을 넣고 (기대 phase, 기대 open)을 받는다.
KR_CASH = [
    ("2026-09-07T07:59", "closed", False),       # NXT 개장 전
    ("2026-09-07T08:00", "nxt", False),          # 대체거래소 08:00~20:00
    ("2026-09-07T08:30", "preAuction", False),   # 장 시작 동시호가 08:30~09:00
    ("2026-09-07T08:59", "preAuction", False),
    ("2026-09-07T09:00", "regular", True),       # 정규장 09:00~15:30
    ("2026-09-07T15:29", "regular", True),
    ("2026-09-07T15:30", "nxt", False),          # 정규장 종료
    ("2026-09-07T15:40", "afterClose", False),   # 시간외 종가 15:40~16:00
    ("2026-09-07T15:59", "afterClose", False),
    ("2026-09-07T16:00", "singlePrice", False),  # 시간외 단일가 16:00~18:00
    ("2026-09-07T17:59", "singlePrice", False),
    ("2026-09-07T18:00", "nxt", False),
    ("2026-09-07T20:00", "closed", False),       # NXT 종료
    ("2026-09-25T10:00", "closed", False),       # 추석 휴장일
]

KR_FUTURES = [
    ("2026-09-07T08:59", "closed"),
    ("2026-09-07T09:00", "regular"),
    ("2026-09-07T15:44", "regular"),             # 선물은 현물보다 15분 늦게 끝난다
    ("2026-09-07T15:45", "closed"),
    ("2026-09-07T18:00", "night"),               # 야간 18:00~익일 06:00
    ("2026-09-08T05:59", "night"),
    ("2026-09-08T06:00", "closed"),
]

# 9월은 서머타임(EDT), 1월은 표준시(EST).
US = [
    ("2026-09-07T16:59", "closed"),
    ("2026-09-07T17:00", "pre"),                 # EDT 프리마켓 17:00~22:30
    ("2026-09-07T22:30", "regular"),             # EDT 정규장 22:30~05:00
    ("2026-09-08T04:59", "regular"),
    ("2026-09-08T05:00", "after"),               # EDT 애프터 05:00~09:00
    ("2026-09-08T09:00", "closed"),
    ("2026-01-05T17:00", "closed"),              # EST는 한 시간 늦다
    ("2026-01-05T18:00", "pre"),
    ("2026-01-05T23:30", "regular"),
    ("2026-01-06T06:00", "after"),
    ("2026-01-06T10:00", "closed"),
]

HOME = [
    ("2026-09-05T08:59", "us"),                  # 토 - 미국 애프터마켓이 09:00에 끝난다
    ("2026-09-05T09:00", "closed"),
    ("2026-09-06T14:00", "closed"),              # 일
    ("2026-09-07T08:59", "closed"),              # 월 KOSPI 개장 전
    ("2026-09-07T09:00", "domestic"),
    ("2026-09-07T16:59", "domestic"),
    ("2026-09-07T17:00", "us"),                  # EDT 프리마켓
    ("2026-01-05T17:00", "domestic"),            # EST는 아직 국내
    ("2026-01-05T18:00", "us"),
    ("2026-01-03T09:00", "domestic"),            # 겨울 토요일 휴장은 10:00부터
    ("2026-01-03T10:00", "closed"),
]


def _run():
    source = open(SHELL, encoding="utf-8").read()
    module = source[: source.index("})(window);") + len("})(window);")]
    script = (
        "global.window = global;\n"
        + module
        + """
const MH = global.MarketHours;
const at = s => new Date(s + ':00+09:00');
const arg = JSON.parse(process.env.MH_CASES);
console.log(JSON.stringify({
  cash: arg.cash.map(t => { const c = MH.krCash(at(t)); return [c.phase, c.open]; }),
  futures: arg.futures.map(t => MH.krFutures(at(t)).phase),
  us: arg.us.map(t => MH.us(at(t)).phase),
  home: arg.home.map(t => MH.homeMarket(at(t))),
  dst: [MH.us(at('2026-09-07T12:00')).dst, MH.us(at('2026-01-05T12:00')).dst],
  windows: [MH.us(at('2026-09-07T12:00')).kst.regular, MH.us(at('2026-01-05T12:00')).kst.regular],
  auction: [MH.krCash(at('2026-09-07T15:20')).closeAuction, MH.krCash(at('2026-09-07T15:19')).closeAuction],
  preClose: [MH.krCash(at('2026-09-07T08:30')).preClosePrice, MH.krCash(at('2026-09-07T08:40')).preClosePrice],
  nxt: [MH.krCash(at('2026-09-07T08:00')).nxtOpen, MH.krCash(at('2026-09-07T07:59')).nxtOpen,
        MH.krCash(at('2026-09-07T19:59')).nxtOpen, MH.krCash(at('2026-09-07T20:00')).nxtOpen],
  weekend: [MH.isWeekendClosed(at('2026-09-05T07:30')), MH.isWeekendClosed(at('2026-09-05T09:00'))]
}));
"""
    )
    payload = json.dumps({
        "cash": [c[0] for c in KR_CASH],
        "futures": [c[0] for c in KR_FUTURES],
        "us": [c[0] for c in US],
        "home": [c[0] for c in HOME],
    })
    env = dict(os.environ, MH_CASES=payload)
    out = subprocess.run(["node", "-e", script],
                         capture_output=True, text=True, timeout=60, env=env)
    if out.returncode != 0:
        raise AssertionError(out.stderr)
    return json.loads(out.stdout)


@unittest.skipUnless(shutil.which("node"), "node 필요")
class MarketHoursTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = _run()

    def test_kr_cash_sessions(self):
        for (when, phase, open_), got in zip(KR_CASH, self.result["cash"]):
            with self.subTest(when=when):
                self.assertEqual([phase, open_], got)

    def test_kr_futures_close_15_minutes_after_cash(self):
        for (when, phase), got in zip(KR_FUTURES, self.result["futures"]):
            with self.subTest(when=when):
                self.assertEqual(phase, got)

    def test_us_sessions_follow_daylight_saving(self):
        for (when, phase), got in zip(US, self.result["us"]):
            with self.subTest(when=when):
                self.assertEqual(phase, got)
        self.assertEqual([True, False], self.result["dst"])
        self.assertEqual(["22:30~05:00", "23:30~06:00"], self.result["windows"])

    def test_home_market_has_one_boundary(self):
        for (when, market), got in zip(HOME, self.result["home"]):
            with self.subTest(when=when):
                self.assertEqual(market, got)

    def test_overlapping_rules_are_reported_as_flags(self):
        self.assertEqual([True, False], self.result["auction"])    # 마감 동시호가 15:20~15:30
        self.assertEqual([True, False], self.result["preClose"])   # 시간외 종가(전일) 08:30~08:40
        self.assertEqual([True, False, True, False], self.result["nxt"])  # NXT 08:00~20:00
        self.assertEqual([False, True], self.result["weekend"])

    def test_holiday_table_lives_in_one_place(self):
        """휴장일 표가 다시 여러 파일로 흩어지지 않게 막는다."""
        holders = []
        for name in os.listdir(os.path.join(ROOT, "js")):
            if not name.endswith(".js"):
                continue
            body = open(os.path.join(ROOT, "js", name), encoding="utf-8").read()
            if "'20260924'" in body:
                holders.append(name)
        self.assertEqual(["skin-shell.js"], holders)


if __name__ == "__main__":
    unittest.main()
