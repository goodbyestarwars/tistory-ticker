#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""장기 바닥·상승 수렴 탐색 (오프라인 연구 전용).
입력: <cache-dir>/<6자리종목코드>.json = [[YYYY-MM-DD,시가,고가,저가,종가,거래량], ...]
미래 비참조: --asof의 봉까지로만 신호를 계산. 과거 성과는 --evaluate에서 별도로 계산.
운영 VM/검색기/자동매매에 연결하지 않으며 HTTP/DB 쓰기 없음.
"""
import argparse
import csv
import json
import math
import re
from pathlib import Path
from statistics import median

MIN_BARS = 280
PIVOT_RADIUS = 3
LOOKBACK = 135
STAGES = {0: "조건 미충족", 1: "바닥 형성", 2: "돌파 대기", 3: "돌파 확인"}


def load_rows(path):
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError("OHLCV list expected")
    out = []
    for x in raw:
        if not isinstance(x, list) or len(x) < 6:
            raise ValueError("invalid row")
        day = str(x[0])
        from datetime import date
        date.fromisoformat(day)
        o, h, l, c, v = [float(y) for y in x[1:6]]
        if not all(math.isfinite(y) for y in (o, h, l, c, v)):
            raise ValueError("nonfinite value")
        if min(o, h, l, c) <= 0 or v < 0 or l > min(o, c) or h < max(o, c):
            raise ValueError("invalid price")
        if out and day <= out[-1][0]:
            raise ValueError("unordered or duplicate date")
        out.append([day, o, h, l, c, v])
    return out


def sma(rows, end, size, col=4):
    if end < size - 1:
        return None
    return sum(row[col] for row in rows[end - size + 1:end + 1]) / size


def swing_points(rows, end, col, low):
    # j+PIVOT_RADIUS <= end 이어야 확정. 임박한 미확정 스윙을 사후 정보로 쓰지 않음.
    start = max(PIVOT_RADIUS, end - LOOKBACK)
    points = []
    for j in range(start, end - PIVOT_RADIUS + 1):
        v = rows[j][col]
        neighbors = [rows[k][col] for k in range(j - PIVOT_RADIUS, j + PIVOT_RADIUS + 1) if k != j]
        if (v < min(neighbors)) if low else (v > max(neighbors)):
            if points and j - points[-1][0] < 10:
                # 가까운 피벗은 더 극단적인 한 점만 인정.
                if (v < points[-1][1]) if low else (v > points[-1][1]):
                    points[-1] = (j, v)
            else:
                points.append((j, v))
    return points


def assess(rows, end=None, min_amount=1_000_000_000):
    if end is None:
        end = len(rows) - 1
    if end < MIN_BARS - 1:
        return {"stage": 0, "reason": "일봉 280개 미만", "asof": rows[end][0] if end >= 0 else None}
    c = rows[end][4]
    ma5, ma20, ma224 = [sma(rows, end, p) for p in (5, 20, 224)]
    ma20_old = sma(rows, end - 5, 20)
    amount = sum(x[4] * x[5] for x in rows[end - 19:end + 1]) / 20
    lows = swing_points(rows, end, 3, True)
    highs = swing_points(rows, end, 2, False)
    low3, high3 = lows[-3:], highs[-3:]
    rising = len(low3) == 3 and low3[0][1] < low3[1][1] * .99 and low3[1][1] < low3[2][1] * .99
    # 과거 1~3년 큰 고점 대비 조정. 고점 봉을 포함한 40봉은 제외해 근래 급등을 과거 추세로 착각하지 않는다.
    old_highs = [x[2] for x in rows[max(0, end - 750):end - 39]]
    old_peak = max(old_highs) if old_highs else c
    old_drawdown = (1 - c / old_peak) * 100 if old_peak > c else 0
    base = rising and old_drawdown >= 22 and amount >= min_amount

    resistance = median(v for _, v in high3) if high3 else None
    touches = len(high3) == 3 and (max(v for _, v in high3) - min(v for _, v in high3)) / resistance <= .075 if resistance else False
    # 초기 저점~저항 간격과 최근 간격 비교. 수평/완만한 저항 + 높아진 저점이면 간격 축소.
    converge = bool(touches and rising and resistance > low3[-1][1] and
                    (resistance - low3[-1][1]) / max(1, resistance - low3[0][1]) <= .8)
    recovered224 = c >= ma224 * .98
    ma_good = ma5 > ma20 and ma20 >= ma20_old * .995
    near = bool(resistance and .93 <= c / resistance <= 1.01)
    prev = rows[end - 1][4]
    vol_avg = sma(rows, end - 1, 20, 5)
    breakout = bool(resistance and c > resistance * 1.01 and prev <= resistance * 1.01
                    and vol_avg and rows[end][5] >= vol_avg * 1.25)
    stage = 0
    if base:
        stage = 1
        if converge and recovered224 and ma_good and (near or breakout):
            stage = 3 if breakout else 2
    flags = {
        "longBase": old_drawdown >= 22, "risingLows": bool(rising),
        "converging": bool(converge), "resistanceTouches": bool(touches),
        "ma224Recovered": bool(recovered224), "shortTrend": bool(ma_good),
        "nearResistance": bool(near), "volumeBreakout": bool(breakout),
        "liquidity": amount >= min_amount,
    }
    return {
        "asof": rows[end][0], "stage": stage, "stageName": STAGES[stage],
        "close": c, "resistance": round(resistance, 2) if resistance else None,
        "resistanceGapPct": round((resistance / c - 1) * 100, 2) if resistance else None,
        "ma224": round(ma224, 2), "ma5": round(ma5, 2), "ma20": round(ma20, 2),
        "pastPeakDrawdownPct": round(old_drawdown, 2),
        "avgTurnover20": round(amount), "lowPivots": low3, "highPivots": high3,
        "flags": flags,
        "reason": "초기 연구 가설. 미래 성과/매집 여부를 보장하지 않음",
    }


def forward_check(rows, end):
    """신호 당일 종가 이후 t+1 시가만 가정한 기술적 사후 경로. 실체결 아님."""
    if end + 1 >= len(rows):
        return {}
    entry = rows[end + 1][1]
    ret = {"entryDate": rows[end + 1][0], "entryOpen": entry}
    for horizon in (5, 20, 60):
        pos = end + horizon
        if pos >= len(rows):
            ret[f"d{horizon}"] = None
            continue
        window = rows[end + 1:pos + 1]
        ret[f"d{horizon}"] = {
            "closeReturnPct": round((rows[pos][4] / entry - 1) * 100, 2),
            "mfePct": round((max(x[2] for x in window) / entry - 1) * 100, 2),
            "maePct": round((min(x[3] for x in window) / entry - 1) * 100, 2),
        }
    return ret


def run(cache_dir, cases_file, asof=None, min_amount=1_000_000_000, evaluate=False):
    cases = json.loads(Path(cases_file).read_text(encoding="utf-8"))["cases"]
    names = {str(c["code"]): c["name"] for c in cases}
    files = sorted(Path(cache_dir).glob("*.json"))
    found = []
    invalid = []
    by_code = {}
    for file in files:
        if not re.fullmatch(r"\d{6}", file.stem):
            continue
        try:
            rows = load_rows(file)
            eligible = [i for i, r in enumerate(rows) if asof is None or r[0] <= asof]
            end = eligible[-1] if eligible else -1
            result = assess(rows, end, min_amount)
            result.update({"code": file.stem, "name": names.get(file.stem, "")})
            if evaluate and end >= 0 and result["stage"] > 0:
                result["forward"] = forward_check(rows, end)
            by_code[file.stem] = result
            if result["stage"] > 0:
                found.append(result)
        except (ValueError, TypeError, KeyError, json.JSONDecodeError) as ex:
            invalid.append({"code": file.stem, "error": str(ex)})
    found.sort(key=lambda x: (-x["stage"], abs(x.get("resistanceGapPct") or 0), x["code"]))
    case_reviews = []
    for case in cases:
        row = by_code.get(str(case["code"]))
        case_reviews.append({
            **case, "matched": bool(row and row["stage"] > 0),
            "scan": row or {"reason": "해당 종목의 일봉 캐시 없음; 스크린샷만으로 자동 판정 불가"},
        })
    return {
        "pattern": "long_base_rising_convergence_v0", "researchOnly": True,
        "asofRequested": asof, "note": "캐시별 마지막 날짜가 다를 수 있음; 시장 전체 동시점·수익성 보장 없음",
        "scannedFiles": len(files), "matches": found, "cases": case_reviews, "invalid": invalid,
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--cache-dir", type=Path, required=True, help="기존 연구용 네이버 일봉 JSON 캐시")
    p.add_argument("--out-dir", type=Path, required=True, help="연구 결과 디렉터리(저장소 외부 권장)")
    p.add_argument("--cases", type=Path, default=Path(__file__).resolve().parents[2] / "research_data/rising_base_2026-10-22/cases.json")
    p.add_argument("--asof", help="YYYY-MM-DD까지 데이터만 보고 검색(미래 누수 금지)")
    p.add_argument("--min-amount", type=float, default=1_000_000_000)
    p.add_argument("--evaluate", action="store_true", help="사후 D5/20/60 결과도 별도로 표시")
    args = p.parse_args()
    if not args.cache_dir.is_dir():
        p.error("캐시 폴더가 없습니다. 운영 API 호출이나 다운로드는 자동으로 하지 않습니다.")
    if args.asof:
        from datetime import date
        date.fromisoformat(args.asof)
    result = run(args.cache_dir, args.cases, args.asof, args.min_amount, args.evaluate)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "results.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    with (args.out_dir / "candidates.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["code", "name", "asof", "stageName", "close", "resistance", "resistanceGapPct", "ma224", "pastPeakDrawdownPct"])
        writer.writeheader()
        for r in result["matches"]:
            writer.writerow({k: r.get(k) for k in writer.fieldnames})
    print("스캔 %d개 파일 / 후보 %d개 / 사례 %d개 / 잘못된 입력 %d개" %
          (result["scannedFiles"], len(result["matches"]), len(result["cases"]), len(result["invalid"])))
    print(args.out_dir / "results.json")


if __name__ == "__main__":
    main()
