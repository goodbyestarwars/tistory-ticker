/**
 * 공매도/대차거래/연기금 캐시 - 키움증권 REST API 기반, PC 로컬에서 하루 1회
 * scripts/fetch_investor_flow.py 실행 -> git push로 갱신 (서버 실시간 크롤링 아님)
 * 커버리지: data/sectors-v3.js 종목 풀만 포함(전체 종목 아님) - js/foreign-flow.js가
 * 이 캐시에 없는 종목은 공매도/대차/연기금 섹션을 생략하고 안내 문구만 표시한다.
 * 초기 시딩(2026-07-11, 3종목 샘플): 실제 fetch_investor_flow.py --all 실행 전까지
 * 대표 종목 3개만 채워둔 상태 - 전체 커버리지는 스크립트 실행 후 갱신됨.
 */
window.INVESTOR_FLOW_CACHE = {
  "005930": {
    "name": "삼성전자",
    "as_of": "2026-07-10",
    "short": {
      "balance_qty": 23182309,
      "avg_price": 289355,
      "today_ratio_pct": 1.12,
      "avg_volume_20d": 31110606,
      "days_to_cover": 0.7451577362136498,
      "balance_change_pct": 0.9803439427781613,
      "short_squeeze_index": 382.534435261708,
      "pressure": {
        "score": 8,
        "grade": {
          "emoji": "🟢",
          "label": "매우 약함"
        },
        "breakdown": {
          "short_ratio": 0,
          "loan_increase": 0,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 78736716,
      "balance_change_pct": -5.188769999965079
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": 72046,
      "net_20d": -277883,
      "net_60d": null,
      "net_cumulative": -277883,
      "cumulative_window_days": 20,
      "current_price": 285000,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "000660": {
    "name": "SK하이닉스",
    "as_of": "2026-07-10",
    "short": {
      "balance_qty": 4555211,
      "avg_price": 2218426,
      "today_ratio_pct": 5.27,
      "avg_volume_20d": 5934339,
      "days_to_cover": 0.7676021255746659,
      "balance_change_pct": 5.920877165609561,
      "short_squeeze_index": -493.5369474378711,
      "pressure": {
        "score": 50,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 5,
          "balance_increase": 20,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 14140221,
      "balance_change_pct": -1.9420442156800264
    },
    "pension": {
      "streak": {
        "days": 4,
        "direction": "buy"
      },
      "net_5d": 110902,
      "net_20d": -59355,
      "net_60d": null,
      "net_cumulative": -59355,
      "cumulative_window_days": 20,
      "current_price": 2180000,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(4일)."
      }
    }
  },
  "035420": {
    "name": "NAVER",
    "as_of": "2026-07-10",
    "short": {
      "balance_qty": 1755468,
      "avg_price": 192335,
      "today_ratio_pct": 6.09,
      "avg_volume_20d": 1278411,
      "days_to_cover": 1.3731645664675,
      "balance_change_pct": 2.582520391240678,
      "short_squeeze_index": 91.27935918903019,
      "pressure": {
        "score": 41,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 4884741,
      "balance_change_pct": 1.1164384922770685
    },
    "pension": {
      "streak": {
        "days": 3,
        "direction": "sell"
      },
      "net_5d": -8256,
      "net_20d": -32931,
      "net_60d": null,
      "net_cumulative": -32931,
      "cumulative_window_days": 20,
      "current_price": 191300,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  }
};
