/**
 * 공매도/대차거래/연기금 캐시 - 키움증권 REST API 기반, PC 로컬에서 하루 1회
 * scripts/fetch_investor_flow.py 실행 -> git push로 갱신 (서버 실시간 크롤링 아님)
 * 커버리지: data/sectors-v3.js 종목 풀만 포함(전체 종목 아님) - js/foreign-flow.js가
 * 이 캐시에 없는 종목은 공매도/대차/연기금 섹션을 생략하고 안내 문구만 표시한다.
 * 생성: 2026-07-11 17:06
 */
window.INVESTOR_FLOW_CACHE = {
  "000660": {
    "name": "SK하이닉스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 4555211.0,
      "avg_price": 2218426.0,
      "today_ratio_pct": 5.27,
      "avg_volume_20d": 5934338.7,
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
      "balance_qty": 14140221.0,
      "balance_change_pct": -1.9420442156800264
    },
    "pension": {
      "streak": {
        "days": 4,
        "direction": "buy"
      },
      "net_5d": 110902.0,
      "net_20d": -59355.0,
      "net_60d": -312021.0,
      "net_cumulative": -907118.0,
      "cumulative_window_days": 100,
      "current_price": 2180000.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(4일)."
      }
    }
  },
  "005380": {
    "name": "현대차",
    "as_of": "20260710",
    "short": {
      "balance_qty": 3865128.0,
      "avg_price": 462043.0,
      "today_ratio_pct": 10.82,
      "avg_volume_20d": 1112648.55,
      "days_to_cover": 3.4738085085357815,
      "balance_change_pct": 1.8651108131834655,
      "short_squeeze_index": 70.75131766734022,
      "pressure": {
        "score": 47,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 5,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 9144513.0,
      "balance_change_pct": -1.6838385963682474
    },
    "pension": {
      "streak": {
        "days": 3,
        "direction": "sell"
      },
      "net_5d": -4180.0,
      "net_20d": -132337.0,
      "net_60d": -39063.0,
      "net_cumulative": -314761.0,
      "cumulative_window_days": 100,
      "current_price": 457500.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "005930": {
    "name": "삼성전자",
    "as_of": "20260710",
    "short": {
      "balance_qty": 23182309.0,
      "avg_price": 289355.0,
      "today_ratio_pct": 1.12,
      "avg_volume_20d": 31110606.35,
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
      "balance_qty": 78736716.0,
      "balance_change_pct": -5.188769999965079
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": 72046.0,
      "net_20d": -277883.0,
      "net_60d": 20502.0,
      "net_cumulative": -320119.0,
      "cumulative_window_days": 100,
      "current_price": 285000.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "035420": {
    "name": "NAVER",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1755468.0,
      "avg_price": 192335.0,
      "today_ratio_pct": 6.09,
      "avg_volume_20d": 1278410.5,
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
      "balance_qty": 4884741.0,
      "balance_change_pct": 1.1164384922770685
    },
    "pension": {
      "streak": {
        "days": 3,
        "direction": "sell"
      },
      "net_5d": -8256.0,
      "net_20d": -32931.0,
      "net_60d": 265329.0,
      "net_cumulative": -25744.0,
      "cumulative_window_days": 100,
      "current_price": 191300.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "035720": {
    "name": "카카오",
    "as_of": "20260710",
    "short": {
      "balance_qty": 4914780.0,
      "avg_price": 35693.0,
      "today_ratio_pct": 3.61,
      "avg_volume_20d": 1721017.5,
      "days_to_cover": 2.855740862600177,
      "balance_change_pct": 1.6184417504875421,
      "short_squeeze_index": 38.37319229393428,
      "pressure": {
        "score": 21,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 5,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 11701666.0,
      "balance_change_pct": -1.4970070717604937
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": 238.0,
      "net_20d": -30941.0,
      "net_60d": -146783.0,
      "net_cumulative": -199674.0,
      "cumulative_window_days": 100,
      "current_price": 35350.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "377300": {
    "name": "카카오페이",
    "as_of": "20260710",
    "short": {
      "balance_qty": 637928.0,
      "avg_price": 39030.0,
      "today_ratio_pct": 5.82,
      "avg_volume_20d": 232935.75,
      "days_to_cover": 2.7386435959272033,
      "balance_change_pct": 1.5118701137920554,
      "short_squeeze_index": 30.44942637617093,
      "pressure": {
        "score": 28,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 5,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 2494874.0,
      "balance_change_pct": -2.8052332772730795
    },
    "pension": {
      "streak": {
        "days": 8,
        "direction": "sell"
      },
      "net_5d": -3519.0,
      "net_20d": -4033.0,
      "net_60d": -5739.0,
      "net_cumulative": 5514.0,
      "cumulative_window_days": 100,
      "current_price": 38850.0,
      "interpretation": {
        "tone": "caution",
        "label": "비중 축소 가능성",
        "text": "연기금이 8일 연속 순매도 중입니다."
      }
    }
  },
  "060250": {
    "name": "NHN KCP",
    "as_of": "20260710",
    "short": {
      "balance_qty": 205386.0,
      "avg_price": 12954.0,
      "today_ratio_pct": 6.55,
      "avg_volume_20d": 233769.7,
      "days_to_cover": 0.8785826392385325,
      "balance_change_pct": 5.79218197083563,
      "short_squeeze_index": 7.407736771898622,
      "pressure": {
        "score": 47,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 12,
          "balance_increase": 20,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1998403.0,
      "balance_change_pct": 0.04505625273153532
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": 111.0,
      "net_20d": -942.0,
      "net_60d": 2578.0,
      "net_cumulative": 8776.0,
      "cumulative_window_days": 100,
      "current_price": 12910.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "064260": {
    "name": "다날",
    "as_of": "20260710",
    "short": {
      "balance_qty": 675564.0,
      "avg_price": 4337.0,
      "today_ratio_pct": 2.63,
      "avg_volume_20d": 625954.25,
      "days_to_cover": 1.0792545940857499,
      "balance_change_pct": 2.698331139197402,
      "short_squeeze_index": 3.971830985915493,
      "pressure": {
        "score": 44,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 7282772.0,
      "balance_change_pct": 0.01785353291202658
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": 0.0,
      "net_20d": -5.0,
      "net_60d": -136.0,
      "net_cumulative": -775.0,
      "cumulative_window_days": 100,
      "current_price": 4370.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "214450": {
    "name": "파마리서치",
    "as_of": "20260710",
    "short": {
      "balance_qty": 335455.0,
      "avg_price": 321793.0,
      "today_ratio_pct": 16.81,
      "avg_volume_20d": 170724.7,
      "days_to_cover": 1.9648885017809372,
      "balance_change_pct": 5.338935415901248,
      "short_squeeze_index": 28.114339489471828,
      "pressure": {
        "score": 72,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 22,
          "balance_increase": 20,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 923958.0,
      "balance_change_pct": 3.5941168424333614
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": 42173.0,
      "net_20d": 95363.0,
      "net_60d": 134120.0,
      "net_cumulative": 96105.0,
      "cumulative_window_days": 100,
      "current_price": 319500.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "009420": {
    "name": "한올바이오파마",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1979840.0,
      "avg_price": 58312.0,
      "today_ratio_pct": 22.2,
      "avg_volume_20d": 620726.25,
      "days_to_cover": 3.1895541714241986,
      "balance_change_pct": 4.954296131803563,
      "short_squeeze_index": 2.178542003274233,
      "pressure": {
        "score": 56,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 3499737.0,
      "balance_change_pct": 1.1375360004438828
    },
    "pension": {
      "streak": {
        "days": 14,
        "direction": "buy"
      },
      "net_5d": 2337.0,
      "net_20d": 20943.0,
      "net_60d": 26192.0,
      "net_cumulative": 80901.0,
      "cumulative_window_days": 100,
      "current_price": 57400.0,
      "interpretation": {
        "tone": "very_positive",
        "label": "매우 긍정",
        "text": "연기금이 14일 연속 순매수 중이고 외국인도 최근 5일 순매수를 동반하고 있습니다."
      }
    }
  },
  "141080": {
    "name": "리가켐바이오",
    "as_of": "20260710",
    "short": {
      "balance_qty": 966252.0,
      "avg_price": 122039.0,
      "today_ratio_pct": 14.31,
      "avg_volume_20d": 492341.2,
      "days_to_cover": 1.9625657978653828,
      "balance_change_pct": 6.926853883719154,
      "short_squeeze_index": -5.107436696221742,
      "pressure": {
        "score": 66,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 12,
          "balance_increase": 20,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 2068771.0,
      "balance_change_pct": 1.041689561076914
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "sell"
      },
      "net_5d": -5776.0,
      "net_20d": 7817.0,
      "net_60d": 7730.0,
      "net_cumulative": 32197.0,
      "cumulative_window_days": 100,
      "current_price": 120300.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "298380": {
    "name": "에이비엘바이오",
    "as_of": "20260710",
    "short": {
      "balance_qty": 455964.0,
      "avg_price": 82650.0,
      "today_ratio_pct": 3.8,
      "avg_volume_20d": 454109.95,
      "days_to_cover": 1.0040828217923874,
      "balance_change_pct": 3.052958938289909,
      "short_squeeze_index": 49.518803671898134,
      "pressure": {
        "score": 27,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1874388.0,
      "balance_change_pct": -0.3636982187186043
    },
    "pension": {
      "streak": {
        "days": 6,
        "direction": "sell"
      },
      "net_5d": -9427.0,
      "net_20d": 17838.0,
      "net_60d": -11400.0,
      "net_cumulative": 10875.0,
      "cumulative_window_days": 100,
      "current_price": 81800.0,
      "interpretation": {
        "tone": "caution",
        "label": "비중 축소 가능성",
        "text": "연기금이 6일 연속 순매도 중입니다."
      }
    }
  },
  "0126Z0": {
    "name": "삼성에피스홀딩스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 311886.0,
      "avg_price": 385526.0,
      "today_ratio_pct": 28.64,
      "avg_volume_20d": 58034.65,
      "days_to_cover": 5.374134245661859,
      "balance_change_pct": 3.3405786536957764,
      "short_squeeze_index": 22.25748859353303,
      "pressure": {
        "score": 59,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 908894.0,
      "balance_change_pct": -1.7084607631514062
    },
    "pension": {
      "streak": {
        "days": 4,
        "direction": "sell"
      },
      "net_5d": -2809.0,
      "net_20d": 1662.0,
      "net_60d": -26432.0,
      "net_cumulative": -42900.0,
      "cumulative_window_days": 100,
      "current_price": 384500.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "196170": {
    "name": "알테오젠",
    "as_of": "20260710",
    "short": {
      "balance_qty": 676473.0,
      "avg_price": 320682.0,
      "today_ratio_pct": 4.62,
      "avg_volume_20d": 494950.05,
      "days_to_cover": 1.366750038716028,
      "balance_change_pct": 3.7680105658918652,
      "short_squeeze_index": 183.18270639960917,
      "pressure": {
        "score": 34,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 2873116.0,
      "balance_change_pct": 0.272606232146316
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": 9101.0,
      "net_20d": 56982.0,
      "net_60d": 89000.0,
      "net_cumulative": 127548.0,
      "cumulative_window_days": 100,
      "current_price": 324000.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "128940": {
    "name": "한미약품",
    "as_of": "20260710",
    "short": {
      "balance_qty": 122221.0,
      "avg_price": 394244.0,
      "today_ratio_pct": 4.82,
      "avg_volume_20d": 109457.9,
      "days_to_cover": 1.1166028217241515,
      "balance_change_pct": 4.625143385437176,
      "short_squeeze_index": -231.29742735517306,
      "pressure": {
        "score": 37,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 399437.0,
      "balance_change_pct": -0.19389674998063533
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": 9165.0,
      "net_20d": 38033.0,
      "net_60d": 35632.0,
      "net_cumulative": -9197.0,
      "cumulative_window_days": 100,
      "current_price": 389000.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "145020": {
    "name": "휴젤",
    "as_of": "20260710",
    "short": {
      "balance_qty": 97980.0,
      "avg_price": 243613.0,
      "today_ratio_pct": 8.57,
      "avg_volume_20d": 59935.35,
      "days_to_cover": 1.634761455468267,
      "balance_change_pct": 3.2966801260898446,
      "short_squeeze_index": -1.5669971218420211,
      "pressure": {
        "score": 69,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 30,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 466125.0,
      "balance_change_pct": 8.454128760557483
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": 1867.0,
      "net_20d": 4693.0,
      "net_60d": 3682.0,
      "net_cumulative": -5389.0,
      "cumulative_window_days": 100,
      "current_price": 240500.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "068270": {
    "name": "셀트리온",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1060864.0,
      "avg_price": 176949.0,
      "today_ratio_pct": 8.13,
      "avg_volume_20d": 621442.95,
      "days_to_cover": 1.70709797254921,
      "balance_change_pct": 3.4492711791023236,
      "short_squeeze_index": 40.34547099400656,
      "pressure": {
        "score": 34,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 6685968.0,
      "balance_change_pct": -2.3227172939143372
    },
    "pension": {
      "streak": {
        "days": 4,
        "direction": "buy"
      },
      "net_5d": 18354.0,
      "net_20d": 66420.0,
      "net_60d": 7065.0,
      "net_cumulative": -13761.0,
      "cumulative_window_days": 100,
      "current_price": 175200.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(4일)."
      }
    }
  },
  "000100": {
    "name": "유한양행",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1849462.0,
      "avg_price": 68882.0,
      "today_ratio_pct": 31.54,
      "avg_volume_20d": 307365.95,
      "days_to_cover": 6.017133648017941,
      "balance_change_pct": 4.400313856540466,
      "short_squeeze_index": 3.6830357142857144,
      "pressure": {
        "score": 59,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 10229738.0,
      "balance_change_pct": -1.2306989415290073
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": 347.0,
      "net_20d": -1610.0,
      "net_60d": -31726.0,
      "net_cumulative": -79790.0,
      "cumulative_window_days": 100,
      "current_price": 68500.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "326030": {
    "name": "SK바이오팜",
    "as_of": "20260710",
    "short": {
      "balance_qty": 342781.0,
      "avg_price": 82420.0,
      "today_ratio_pct": 4.46,
      "avg_volume_20d": 175394.5,
      "days_to_cover": 1.954342924093971,
      "balance_change_pct": 1.1830931036416716,
      "short_squeeze_index": 66.79141716566866,
      "pressure": {
        "score": 21,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 5,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1353749.0,
      "balance_change_pct": -1.5979129656066733
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -1664.0,
      "net_20d": 716.0,
      "net_60d": -11137.0,
      "net_cumulative": -68773.0,
      "cumulative_window_days": 100,
      "current_price": 82400.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "207940": {
    "name": "삼성바이오로직스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 151137.0,
      "avg_price": 1396919.0,
      "today_ratio_pct": 9.39,
      "avg_volume_20d": 62290.0,
      "days_to_cover": 2.4263445175790657,
      "balance_change_pct": 2.789112870317473,
      "short_squeeze_index": 467.59326993416244,
      "pressure": {
        "score": 34,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 469090.0,
      "balance_change_pct": -0.1770506594711463
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": 13410.0,
      "net_20d": -39767.0,
      "net_60d": -367005.0,
      "net_cumulative": -443619.0,
      "cumulative_window_days": 100,
      "current_price": 1395000.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "115180": {
    "name": "큐리언트",
    "as_of": "20260710",
    "short": {
      "balance_qty": 278868.0,
      "avg_price": 18904.0,
      "today_ratio_pct": 8.06,
      "avg_volume_20d": 121600.35,
      "days_to_cover": 2.293315767594419,
      "balance_change_pct": 2.061595330027266,
      "short_squeeze_index": 0.514823362329132,
      "pressure": {
        "score": 44,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1426793.0,
      "balance_change_pct": -0.42307142034609224
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": 0.0,
      "net_20d": -49.0,
      "net_60d": -684.0,
      "net_cumulative": -27559.0,
      "cumulative_window_days": 100,
      "current_price": 18500.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "475830": {
    "name": "오름테라퓨틱",
    "as_of": "20260710",
    "short": {
      "balance_qty": 420460.0,
      "avg_price": 48571.0,
      "today_ratio_pct": 9.06,
      "avg_volume_20d": 159486.25,
      "days_to_cover": 2.636340123364867,
      "balance_change_pct": 2.070244603478244,
      "short_squeeze_index": 14.892120075046906,
      "pressure": {
        "score": 59,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 30,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1846303.0,
      "balance_change_pct": 11.411061676962152
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": -716.0,
      "net_20d": 5978.0,
      "net_60d": 10955.0,
      "net_cumulative": 6561.0,
      "cumulative_window_days": 100,
      "current_price": 48700.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "000250": {
    "name": "삼천당제약",
    "as_of": "20260710",
    "short": {
      "balance_qty": 298627.0,
      "avg_price": 201370.0,
      "today_ratio_pct": 24.28,
      "avg_volume_20d": 140279.5,
      "days_to_cover": 2.12880000285145,
      "balance_change_pct": 11.679263417315825,
      "short_squeeze_index": -0.8965738072366315,
      "pressure": {
        "score": 72,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 12,
          "balance_increase": 20,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1014107.0,
      "balance_change_pct": 0.39828370709762756
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": 921.0,
      "net_20d": 3355.0,
      "net_60d": -28405.0,
      "net_cumulative": -83971.0,
      "cumulative_window_days": 100,
      "current_price": 199600.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "004310": {
    "name": "현대약품",
    "as_of": "20260710",
    "short": {
      "balance_qty": 177308.0,
      "avg_price": 4883.0,
      "today_ratio_pct": 0.04,
      "avg_volume_20d": 6858565.25,
      "days_to_cover": 0.025852054115837127,
      "balance_change_pct": 0.08354030255136599,
      "short_squeeze_index": 165.54054054054055,
      "pressure": {
        "score": 30,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 0,
          "loan_increase": 12,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 952547.0,
      "balance_change_pct": 0.0
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": -76.0,
      "net_20d": -77.0,
      "net_60d": -14.0,
      "net_cumulative": -77.0,
      "cumulative_window_days": 100,
      "current_price": 4885.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "476830": {
    "name": "알지노믹스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 504799.0,
      "avg_price": 32005.0,
      "today_ratio_pct": 7.55,
      "avg_volume_20d": 337387.85,
      "days_to_cover": 1.4961979217686707,
      "balance_change_pct": 3.7436572999878743,
      "short_squeeze_index": 4.479578392621871,
      "pressure": {
        "score": 69,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 30,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1340378.0,
      "balance_change_pct": 8.201630962125579
    },
    "pension": {
      "streak": {
        "days": 3,
        "direction": "sell"
      },
      "net_5d": -3634.0,
      "net_20d": 1617.0,
      "net_60d": -20975.0,
      "net_cumulative": -13925.0,
      "cumulative_window_days": 100,
      "current_price": 33150.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "042700": {
    "name": "한미반도체",
    "as_of": "20260710",
    "short": {
      "balance_qty": 5228938.0,
      "avg_price": 222727.0,
      "today_ratio_pct": 13.93,
      "avg_volume_20d": 1118493.55,
      "days_to_cover": 4.674982703297663,
      "balance_change_pct": 2.1595004382223686,
      "short_squeeze_index": -2.9276589584916586,
      "pressure": {
        "score": 60,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 17750038.0,
      "balance_change_pct": 1.31999984017161
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": 3102.0,
      "net_20d": -5485.0,
      "net_60d": 10401.0,
      "net_cumulative": 11106.0,
      "cumulative_window_days": 100,
      "current_price": 222000.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "403870": {
    "name": "HPSP",
    "as_of": "20260710",
    "short": {
      "balance_qty": 8355227.0,
      "avg_price": 43323.0,
      "today_ratio_pct": 8.58,
      "avg_volume_20d": 7700364.8,
      "days_to_cover": 1.0850430099103876,
      "balance_change_pct": 4.220601389545317,
      "short_squeeze_index": 4.008156992552311,
      "pressure": {
        "score": 51,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 9655140.0,
      "balance_change_pct": 0.5148932178780453
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": 1837.0,
      "net_20d": -14564.0,
      "net_60d": -20328.0,
      "net_cumulative": -28442.0,
      "cumulative_window_days": 100,
      "current_price": 44400.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "007660": {
    "name": "이수페타시스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 4172876.0,
      "avg_price": 104526.0,
      "today_ratio_pct": 13.69,
      "avg_volume_20d": 1225872.65,
      "days_to_cover": 3.404004486110364,
      "balance_change_pct": 5.727520959273299,
      "short_squeeze_index": 20.901992877839465,
      "pressure": {
        "score": 54,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 0,
          "balance_increase": 20,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 3554141.0,
      "balance_change_pct": -3.5441897449884454
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": 85.0,
      "net_20d": -37107.0,
      "net_60d": -116827.0,
      "net_cumulative": -83973.0,
      "cumulative_window_days": 100,
      "current_price": 103800.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "058470": {
    "name": "리노공업",
    "as_of": "20260710",
    "short": {
      "balance_qty": 3440391.0,
      "avg_price": 75495.0,
      "today_ratio_pct": 4.55,
      "avg_volume_20d": 1313462.55,
      "days_to_cover": 2.6193293444110757,
      "balance_change_pct": 1.5227568086289258,
      "short_squeeze_index": 13.107765052419431,
      "pressure": {
        "score": 31,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 5,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 6446255.0,
      "balance_change_pct": -1.5811884906760796
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": -1698.0,
      "net_20d": 3235.0,
      "net_60d": -36266.0,
      "net_cumulative": -91295.0,
      "cumulative_window_days": 100,
      "current_price": 73800.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "357780": {
    "name": "솔브레인",
    "as_of": "20260710",
    "short": {
      "balance_qty": 278543.0,
      "avg_price": 313902.0,
      "today_ratio_pct": 17.42,
      "avg_volume_20d": 106219.3,
      "days_to_cover": 2.6223388781511456,
      "balance_change_pct": 3.6562493022424993,
      "short_squeeze_index": 3.521628498727735,
      "pressure": {
        "score": 76,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 22,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 677889.0,
      "balance_change_pct": 4.6373675225285025
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": -264.0,
      "net_20d": -5608.0,
      "net_60d": -32464.0,
      "net_cumulative": -45870.0,
      "cumulative_window_days": 100,
      "current_price": 311500.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "005290": {
    "name": "동진쎄미켐",
    "as_of": "20260710",
    "short": {
      "balance_qty": 683814.0,
      "avg_price": 46714.0,
      "today_ratio_pct": 3.95,
      "avg_volume_20d": 773557.6,
      "days_to_cover": 0.8839858854725233,
      "balance_change_pct": 2.0022643502075654,
      "short_squeeze_index": 11.294047530358341,
      "pressure": {
        "score": 44,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 2071264.0,
      "balance_change_pct": 0.2744002215341238
    },
    "pension": {
      "streak": {
        "days": 5,
        "direction": "buy"
      },
      "net_5d": 2870.0,
      "net_20d": 10103.0,
      "net_60d": -1826.0,
      "net_cumulative": 4234.0,
      "cumulative_window_days": 100,
      "current_price": 47150.0,
      "interpretation": {
        "tone": "very_positive",
        "label": "매우 긍정",
        "text": "연기금이 5일 연속 순매수 중이고 외국인도 최근 5일 순매수를 동반하고 있습니다."
      }
    }
  },
  "240810": {
    "name": "원익IPS",
    "as_of": "20260710",
    "short": {
      "balance_qty": 2236282.0,
      "avg_price": 122443.0,
      "today_ratio_pct": 5.06,
      "avg_volume_20d": 2108186.55,
      "days_to_cover": 1.0607609653898988,
      "balance_change_pct": 7.219940010432968,
      "short_squeeze_index": 18.63320627415563,
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
      "balance_qty": 4112164.0,
      "balance_change_pct": -2.179418437968477
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": 3184.0,
      "net_20d": 31037.0,
      "net_60d": 31234.0,
      "net_cumulative": -875.0,
      "cumulative_window_days": 100,
      "current_price": 125000.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "089030": {
    "name": "테크윙",
    "as_of": "20260710",
    "short": {
      "balance_qty": 2081163.0,
      "avg_price": 42743.0,
      "today_ratio_pct": 2.68,
      "avg_volume_20d": 2137604.35,
      "days_to_cover": 0.9735959790688112,
      "balance_change_pct": 2.0249458663033733,
      "short_squeeze_index": 11.218709146370989,
      "pressure": {
        "score": 44,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 5611447.0,
      "balance_change_pct": 1.0935647208501345
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": -3849.0,
      "net_20d": -14664.0,
      "net_60d": 3689.0,
      "net_cumulative": 3977.0,
      "cumulative_window_days": 100,
      "current_price": 43900.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "353200": {
    "name": "대덕전자",
    "as_of": "20260710",
    "short": {
      "balance_qty": 866749.0,
      "avg_price": 117735.0,
      "today_ratio_pct": 3.06,
      "avg_volume_20d": 1055804.25,
      "days_to_cover": 0.8209372144505006,
      "balance_change_pct": 10.053722277032234,
      "short_squeeze_index": -38.04496084869917,
      "pressure": {
        "score": 50,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 12,
          "balance_increase": 20,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1288392.0,
      "balance_change_pct": 1.453301583701856
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": -20788.0,
      "net_20d": -46301.0,
      "net_60d": -93986.0,
      "net_cumulative": -55343.0,
      "cumulative_window_days": 100,
      "current_price": 120900.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "009150": {
    "name": "삼성전기",
    "as_of": "20260710",
    "short": {
      "balance_qty": 955563.0,
      "avg_price": 1587994.0,
      "today_ratio_pct": 5.95,
      "avg_volume_20d": 1101644.55,
      "days_to_cover": 0.8673968386627066,
      "balance_change_pct": 5.768807176972588,
      "short_squeeze_index": -42.3577266971104,
      "pressure": {
        "score": 57,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 12,
          "balance_increase": 20,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 2185105.0,
      "balance_change_pct": 1.3161189213249749
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": -169417.0,
      "net_20d": -386084.0,
      "net_60d": -1379459.0,
      "net_cumulative": -1511991.0,
      "cumulative_window_days": 100,
      "current_price": 1584000.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "095340": {
    "name": "ISC",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1066432.0,
      "avg_price": 150302.0,
      "today_ratio_pct": 9.04,
      "avg_volume_20d": 364315.25,
      "days_to_cover": 2.927223057503083,
      "balance_change_pct": 3.8581401146846175,
      "short_squeeze_index": -1.3327948303715669,
      "pressure": {
        "score": 44,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1535708.0,
      "balance_change_pct": -0.6296592748079995
    },
    "pension": {
      "streak": {
        "days": 8,
        "direction": "sell"
      },
      "net_5d": -3426.0,
      "net_20d": -26923.0,
      "net_60d": -54272.0,
      "net_cumulative": -148241.0,
      "cumulative_window_days": 100,
      "current_price": 151200.0,
      "interpretation": {
        "tone": "caution",
        "label": "비중 축소 가능성",
        "text": "연기금이 8일 연속 순매도 중입니다."
      }
    }
  },
  "098460": {
    "name": "고영",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1481602.0,
      "avg_price": 28041.0,
      "today_ratio_pct": 4.74,
      "avg_volume_20d": 1465244.5,
      "days_to_cover": 1.0111636658591792,
      "balance_change_pct": 4.310401878936452,
      "short_squeeze_index": 8.694302887756436,
      "pressure": {
        "score": 34,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 5159966.0,
      "balance_change_pct": 1.4438145012922377
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -1725.0,
      "net_20d": -10739.0,
      "net_60d": -1186.0,
      "net_cumulative": -30004.0,
      "cumulative_window_days": 100,
      "current_price": 28800.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "078600": {
    "name": "대주전자재료",
    "as_of": "20260710",
    "short": {
      "balance_qty": 376572.0,
      "avg_price": 79392.0,
      "today_ratio_pct": 3.34,
      "avg_volume_20d": 197125.7,
      "days_to_cover": 1.9103140787832331,
      "balance_change_pct": 1.5369183977221252,
      "short_squeeze_index": -22.228070175438596,
      "pressure": {
        "score": 38,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 12,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1294378.0,
      "balance_change_pct": 0.6056338247112902
    },
    "pension": {
      "streak": {
        "days": 9,
        "direction": "sell"
      },
      "net_5d": -12768.0,
      "net_20d": -38909.0,
      "net_60d": -58785.0,
      "net_cumulative": 52328.0,
      "cumulative_window_days": 100,
      "current_price": 81600.0,
      "interpretation": {
        "tone": "caution",
        "label": "비중 축소 가능성",
        "text": "연기금이 9일 연속 순매도 중입니다."
      }
    }
  },
  "080220": {
    "name": "제주반도체",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1902092.0,
      "avg_price": 87273.0,
      "today_ratio_pct": 4.07,
      "avg_volume_20d": 3832553.25,
      "days_to_cover": 0.49629890987163716,
      "balance_change_pct": 5.696146611579892,
      "short_squeeze_index": 11.450925302662258,
      "pressure": {
        "score": 43,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 5,
          "balance_increase": 20,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 5877951.0,
      "balance_change_pct": -0.16378507077763854
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": 1796.0,
      "net_20d": 4655.0,
      "net_60d": 18136.0,
      "net_cumulative": 19336.0,
      "cumulative_window_days": 100,
      "current_price": 89100.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "039030": {
    "name": "이오테크닉스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 520823.0,
      "avg_price": 379200.0,
      "today_ratio_pct": 12.24,
      "avg_volume_20d": 194861.8,
      "days_to_cover": 2.6727814276579607,
      "balance_change_pct": 4.901216341147538,
      "short_squeeze_index": 13.31881318320046,
      "pressure": {
        "score": 60,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1043164.0,
      "balance_change_pct": 0.5608543340409082
    },
    "pension": {
      "streak": {
        "days": 3,
        "direction": "sell"
      },
      "net_5d": -4667.0,
      "net_20d": -17818.0,
      "net_60d": -15736.0,
      "net_cumulative": -31632.0,
      "cumulative_window_days": 100,
      "current_price": 378500.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "036930": {
    "name": "주성엔지니어링",
    "as_of": "20260710",
    "short": {
      "balance_qty": 3113032.0,
      "avg_price": 189564.0,
      "today_ratio_pct": 1.55,
      "avg_volume_20d": 2506725.9,
      "days_to_cover": 1.2418717180047487,
      "balance_change_pct": 1.1142592376654377,
      "short_squeeze_index": 41.67614050429967,
      "pressure": {
        "score": 20,
        "grade": {
          "emoji": "🟢",
          "label": "매우 약함"
        },
        "breakdown": {
          "short_ratio": 0,
          "loan_increase": 12,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 6626957.0,
      "balance_change_pct": 0.23234938014200807
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -1148.0,
      "net_20d": -24921.0,
      "net_60d": -26693.0,
      "net_cumulative": -26241.0,
      "cumulative_window_days": 100,
      "current_price": 191900.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "373220": {
    "name": "LG에너지솔루션",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1960244.0,
      "avg_price": 327082.0,
      "today_ratio_pct": 25.58,
      "avg_volume_20d": 444175.1,
      "days_to_cover": 4.4132235237860025,
      "balance_change_pct": 3.555691499505795,
      "short_squeeze_index": 1.5570445867443208,
      "pressure": {
        "score": 56,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 8341468.0,
      "balance_change_pct": 0.5517923577933754
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -37345.0,
      "net_20d": -100520.0,
      "net_60d": 17525.0,
      "net_cumulative": 81846.0,
      "cumulative_window_days": 100,
      "current_price": 326000.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "006400": {
    "name": "삼성SDI",
    "as_of": "20260710",
    "short": {
      "balance_qty": 504703.0,
      "avg_price": 432454.0,
      "today_ratio_pct": 2.06,
      "avg_volume_20d": 522396.05,
      "days_to_cover": 0.9661309651939367,
      "balance_change_pct": 2.0065686423121623,
      "short_squeeze_index": 439.9274778404513,
      "pressure": {
        "score": 27,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 2599528.0,
      "balance_change_pct": -0.04437297601167693
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": -9896.0,
      "net_20d": 2533.0,
      "net_60d": -53095.0,
      "net_cumulative": 280594.0,
      "cumulative_window_days": 100,
      "current_price": 434000.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "096770": {
    "name": "SK이노베이션",
    "as_of": "20260710",
    "short": {
      "balance_qty": 696772.0,
      "avg_price": 104582.0,
      "today_ratio_pct": 6.03,
      "avg_volume_20d": 433102.95,
      "days_to_cover": 1.6087907043810252,
      "balance_change_pct": 4.027960877465127,
      "short_squeeze_index": 40.38696764149894,
      "pressure": {
        "score": 29,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 0,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 2870993.0,
      "balance_change_pct": -3.312636372116926
    },
    "pension": {
      "streak": {
        "days": 4,
        "direction": "buy"
      },
      "net_5d": 35042.0,
      "net_20d": -21876.0,
      "net_60d": -23648.0,
      "net_cumulative": 150561.0,
      "cumulative_window_days": 100,
      "current_price": 102900.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(4일)."
      }
    }
  },
  "051910": {
    "name": "LG화학",
    "as_of": "20260710",
    "short": {
      "balance_qty": 387096.0,
      "avg_price": 267203.0,
      "today_ratio_pct": 11.93,
      "avg_volume_20d": 259565.15,
      "days_to_cover": 1.4913250103105136,
      "balance_change_pct": 7.274571423820688,
      "short_squeeze_index": 28.224761904761902,
      "pressure": {
        "score": 59,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 5,
          "balance_increase": 20,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1646747.0,
      "balance_change_pct": -0.8471734092317215
    },
    "pension": {
      "streak": {
        "days": 9,
        "direction": "sell"
      },
      "net_5d": -22300.0,
      "net_20d": -43558.0,
      "net_60d": -65105.0,
      "net_cumulative": -88302.0,
      "cumulative_window_days": 100,
      "current_price": 264000.0,
      "interpretation": {
        "tone": "caution",
        "label": "비중 축소 가능성",
        "text": "연기금이 9일 연속 순매도 중입니다."
      }
    }
  },
  "003670": {
    "name": "포스코퓨처엠",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1118393.0,
      "avg_price": 152928.0,
      "today_ratio_pct": 29.46,
      "avg_volume_20d": 314536.15,
      "days_to_cover": 3.5556898626755618,
      "balance_change_pct": 8.77944304654377,
      "short_squeeze_index": 0.5129398209696003,
      "pressure": {
        "score": 72,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 12,
          "balance_increase": 20,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 6983067.0,
      "balance_change_pct": 1.4777270660430126
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": -19078.0,
      "net_20d": -46836.0,
      "net_60d": 5685.0,
      "net_cumulative": -83258.0,
      "cumulative_window_days": 100,
      "current_price": 151800.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "247540": {
    "name": "에코프로비엠",
    "as_of": "20260710",
    "short": {
      "balance_qty": 2571954.0,
      "avg_price": 120490.0,
      "today_ratio_pct": 14.77,
      "avg_volume_20d": 660574.0,
      "days_to_cover": 3.8935138228268142,
      "balance_change_pct": 3.3557046979865772,
      "short_squeeze_index": 17.17741452607628,
      "pressure": {
        "score": 53,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 9819117.0,
      "balance_change_pct": -2.5345286599565613
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": -2717.0,
      "net_20d": -25916.0,
      "net_60d": -50382.0,
      "net_cumulative": -19537.0,
      "cumulative_window_days": 100,
      "current_price": 121600.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "086520": {
    "name": "에코프로",
    "as_of": "20260710",
    "short": {
      "balance_qty": 3471581.0,
      "avg_price": 84693.0,
      "today_ratio_pct": 13.0,
      "avg_volume_20d": 1345397.35,
      "days_to_cover": 2.5803388121732214,
      "balance_change_pct": 4.795896528126393,
      "short_squeeze_index": 9.078892707428528,
      "pressure": {
        "score": 60,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 18574940.0,
      "balance_change_pct": 0.06983091995906901
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": -92.0,
      "net_20d": -31470.0,
      "net_60d": -60662.0,
      "net_cumulative": -36759.0,
      "cumulative_window_days": 100,
      "current_price": 85800.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "450080": {
    "name": "에코프로머티",
    "as_of": "20260710",
    "short": {
      "balance_qty": 757427.0,
      "avg_price": 37901.0,
      "today_ratio_pct": 6.38,
      "avg_volume_20d": 445137.3,
      "days_to_cover": 1.7015581484634068,
      "balance_change_pct": 3.289772440587315,
      "short_squeeze_index": 7.196153208423148,
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
      "balance_qty": 3468789.0,
      "balance_change_pct": 1.1589219051696258
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": -6102.0,
      "net_20d": -22854.0,
      "net_60d": 4766.0,
      "net_cumulative": 30321.0,
      "cumulative_window_days": 100,
      "current_price": 38100.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "066970": {
    "name": "엘앤에프",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1136718.0,
      "avg_price": 100500.0,
      "today_ratio_pct": 2.85,
      "avg_volume_20d": 384285.8,
      "days_to_cover": 2.9580015707059695,
      "balance_change_pct": 0.9202266074667533,
      "short_squeeze_index": 22.38301977809937,
      "pressure": {
        "score": 56,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 30,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 4189803.0,
      "balance_change_pct": 7.825237696343162
    },
    "pension": {
      "streak": {
        "days": 4,
        "direction": "sell"
      },
      "net_5d": -14763.0,
      "net_20d": -52325.0,
      "net_60d": -22257.0,
      "net_cumulative": 36185.0,
      "cumulative_window_days": 100,
      "current_price": 100500.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "015760": {
    "name": "한국전력",
    "as_of": "20260710",
    "short": {
      "balance_qty": 2502779.0,
      "avg_price": 36285.0,
      "today_ratio_pct": 3.69,
      "avg_volume_20d": 2375220.05,
      "days_to_cover": 1.053704055756855,
      "balance_change_pct": 2.0361328682390507,
      "short_squeeze_index": 18.418997657329356,
      "pressure": {
        "score": 27,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 6922922.0,
      "balance_change_pct": -1.4509072512052221
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": 12191.0,
      "net_20d": 79140.0,
      "net_60d": -761.0,
      "net_cumulative": -274207.0,
      "cumulative_window_days": 100,
      "current_price": 36200.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "267260": {
    "name": "HD현대일렉트릭",
    "as_of": "20260710",
    "short": {
      "balance_qty": 514382.0,
      "avg_price": 853275.0,
      "today_ratio_pct": 10.38,
      "avg_volume_20d": 189378.8,
      "days_to_cover": 2.7161540784924187,
      "balance_change_pct": 2.0659959918249102,
      "short_squeeze_index": 124.75028812908182,
      "pressure": {
        "score": 38,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 0,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 808839.0,
      "balance_change_pct": -4.818955271302322
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": 513.0,
      "net_20d": 63232.0,
      "net_60d": 40957.0,
      "net_cumulative": 20234.0,
      "cumulative_window_days": 100,
      "current_price": 851000.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "010120": {
    "name": "LS ELECTRIC",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1881103.0,
      "avg_price": 201605.0,
      "today_ratio_pct": 10.34,
      "avg_volume_20d": 1192322.8,
      "days_to_cover": 1.5776792995990683,
      "balance_change_pct": 3.6731690783182827,
      "short_squeeze_index": 26.438902892809985,
      "pressure": {
        "score": 38,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 0,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 3460409.0,
      "balance_change_pct": -3.2118132522049576
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": -24267.0,
      "net_20d": 5975.0,
      "net_60d": -247417.0,
      "net_cumulative": -295947.0,
      "cumulative_window_days": 100,
      "current_price": 202500.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "298040": {
    "name": "효성중공업",
    "as_of": "20260710",
    "short": {
      "balance_qty": 73677.0,
      "avg_price": 2925034.0,
      "today_ratio_pct": 6.23,
      "avg_volume_20d": 59894.15,
      "days_to_cover": 1.2301201369415877,
      "balance_change_pct": 4.144462506184183,
      "short_squeeze_index": 326.19372442019096,
      "pressure": {
        "score": 44,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 127389.0,
      "balance_change_pct": -0.8290905693867066
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -21828.0,
      "net_20d": 16472.0,
      "net_60d": -193772.0,
      "net_cumulative": -262004.0,
      "cumulative_window_days": 100,
      "current_price": 2924000.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "034020": {
    "name": "두산에너빌리티",
    "as_of": "20260710",
    "short": {
      "balance_qty": 7047376.0,
      "avg_price": 78618.0,
      "today_ratio_pct": 3.9,
      "avg_volume_20d": 3188974.0,
      "days_to_cover": 2.20991955406347,
      "balance_change_pct": 1.6903036751717184,
      "short_squeeze_index": 32.04828328012157,
      "pressure": {
        "score": 38,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 22,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 17559749.0,
      "balance_change_pct": 3.598488290017612
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": -8207.0,
      "net_20d": 2035.0,
      "net_60d": -85566.0,
      "net_cumulative": -76566.0,
      "cumulative_window_days": 100,
      "current_price": 78100.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "052690": {
    "name": "한전기술",
    "as_of": "20260710",
    "short": {
      "balance_qty": 766069.0,
      "avg_price": 103371.0,
      "today_ratio_pct": 13.03,
      "avg_volume_20d": 203461.3,
      "days_to_cover": 3.765182862785208,
      "balance_change_pct": 2.2764472949915757,
      "short_squeeze_index": 10.216409594745176,
      "pressure": {
        "score": 60,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1451718.0,
      "balance_change_pct": 1.0545967890138164
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": 3616.0,
      "net_20d": 12016.0,
      "net_60d": -33300.0,
      "net_cumulative": 10988.0,
      "cumulative_window_days": 100,
      "current_price": 102200.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "006260": {
    "name": "LS",
    "as_of": "20260710",
    "short": {
      "balance_qty": 184245.0,
      "avg_price": 333311.0,
      "today_ratio_pct": 3.18,
      "avg_volume_20d": 201687.95,
      "days_to_cover": 0.9135151604248047,
      "balance_change_pct": 2.007540734917146,
      "short_squeeze_index": -19.52564809707667,
      "pressure": {
        "score": 44,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 453223.0,
      "balance_change_pct": 1.271640910594103
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": 17496.0,
      "net_20d": 77712.0,
      "net_60d": 47088.0,
      "net_cumulative": -19709.0,
      "cumulative_window_days": 100,
      "current_price": 329000.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "103590": {
    "name": "일진전기",
    "as_of": "20260710",
    "short": {
      "balance_qty": 774513.0,
      "avg_price": 66138.0,
      "today_ratio_pct": 4.99,
      "avg_volume_20d": 378892.2,
      "days_to_cover": 2.0441513443665507,
      "balance_change_pct": 1.894321114990646,
      "short_squeeze_index": -5.722619626362942,
      "pressure": {
        "score": 58,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 22,
          "balance_increase": 8,
          "foreign_sell": 10,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1248479.0,
      "balance_change_pct": 3.4026119019774788
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": 2424.0,
      "net_20d": 1648.0,
      "net_60d": -49804.0,
      "net_cumulative": -64334.0,
      "cumulative_window_days": 100,
      "current_price": 66200.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "062040": {
    "name": "산일전기",
    "as_of": "20260710",
    "short": {
      "balance_qty": 673180.0,
      "avg_price": 189885.0,
      "today_ratio_pct": 8.02,
      "avg_volume_20d": 321438.85,
      "days_to_cover": 2.0942708076512844,
      "balance_change_pct": 2.3334296094735723,
      "short_squeeze_index": 32.729641693811075,
      "pressure": {
        "score": 51,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1202299.0,
      "balance_change_pct": 0.061253550583698066
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -1799.0,
      "net_20d": 5109.0,
      "net_60d": -41563.0,
      "net_cumulative": 10532.0,
      "cumulative_window_days": 100,
      "current_price": 189100.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "033100": {
    "name": "제룡전기",
    "as_of": "20260710",
    "short": {
      "balance_qty": 944783.0,
      "avg_price": 45332.0,
      "today_ratio_pct": 14.54,
      "avg_volume_20d": 251827.5,
      "days_to_cover": 3.7517070216715807,
      "balance_change_pct": 2.409284639631632,
      "short_squeeze_index": 4.215593647365816,
      "pressure": {
        "score": 50,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 2512525.0,
      "balance_change_pct": 0.17818581403286052
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": 0.0,
      "net_20d": 510.0,
      "net_60d": -661.0,
      "net_cumulative": -2836.0,
      "cumulative_window_days": 100,
      "current_price": 45200.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "001440": {
    "name": "대한전선",
    "as_of": "20260710",
    "short": {
      "balance_qty": 2997802.0,
      "avg_price": 30274.0,
      "today_ratio_pct": 3.6,
      "avg_volume_20d": 3555990.1,
      "days_to_cover": 0.8430287812106113,
      "balance_change_pct": 2.752143267473474,
      "short_squeeze_index": 3.2318728672129917,
      "pressure": {
        "score": 32,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 0,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 4703177.0,
      "balance_change_pct": -3.063614504913416
    },
    "pension": {
      "streak": {
        "days": 7,
        "direction": "sell"
      },
      "net_5d": -5702.0,
      "net_20d": -35829.0,
      "net_60d": 18480.0,
      "net_cumulative": -24155.0,
      "cumulative_window_days": 100,
      "current_price": 30250.0,
      "interpretation": {
        "tone": "caution",
        "label": "비중 축소 가능성",
        "text": "연기금이 7일 연속 순매도 중입니다."
      }
    }
  },
  "000500": {
    "name": "가온전선",
    "as_of": "20260710",
    "short": {
      "balance_qty": 275885.0,
      "avg_price": 263802.0,
      "today_ratio_pct": 2.82,
      "avg_volume_20d": 243049.5,
      "days_to_cover": 1.1350979944414614,
      "balance_change_pct": 2.1508760497045274,
      "short_squeeze_index": -78.05129970735067,
      "pressure": {
        "score": 42,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 0,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 564952.0,
      "balance_change_pct": -6.669331910401555
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -3926.0,
      "net_20d": -3483.0,
      "net_60d": -56742.0,
      "net_cumulative": -60773.0,
      "cumulative_window_days": 100,
      "current_price": 254500.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "229640": {
    "name": "LS에코에너지",
    "as_of": "20260710",
    "short": {
      "balance_qty": 410338.0,
      "avg_price": 45817.0,
      "today_ratio_pct": 4.29,
      "avg_volume_20d": 163308.35,
      "days_to_cover": 2.5126578034742253,
      "balance_change_pct": 1.3603207264265829,
      "short_squeeze_index": -7.6811331033230426,
      "pressure": {
        "score": 31,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 5,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 724644.0,
      "balance_change_pct": -0.3875111174039092
    },
    "pension": {
      "streak": {
        "days": 17,
        "direction": "sell"
      },
      "net_5d": -1657.0,
      "net_20d": -12448.0,
      "net_60d": -24257.0,
      "net_cumulative": -27122.0,
      "cumulative_window_days": 100,
      "current_price": 45850.0,
      "interpretation": {
        "tone": "caution",
        "label": "비중 축소 가능성",
        "text": "연기금이 17일 연속 순매도 중입니다."
      }
    }
  },
  "322000": {
    "name": "HD현대에너지솔루션",
    "as_of": "20260710",
    "short": {
      "balance_qty": 197830.0,
      "avg_price": 113363.0,
      "today_ratio_pct": 2.73,
      "avg_volume_20d": 234223.0,
      "days_to_cover": 0.8446224324682033,
      "balance_change_pct": 1.1230211671854953,
      "short_squeeze_index": -6.372325898953118,
      "pressure": {
        "score": 56,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 30,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 531276.0,
      "balance_change_pct": 5.733721286614418
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -3661.0,
      "net_20d": 12308.0,
      "net_60d": 10785.0,
      "net_cumulative": 23940.0,
      "cumulative_window_days": 100,
      "current_price": 114000.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "051600": {
    "name": "한전KPS",
    "as_of": "20260710",
    "short": {
      "balance_qty": 912932.0,
      "avg_price": 46021.0,
      "today_ratio_pct": 11.72,
      "avg_volume_20d": 156428.45,
      "days_to_cover": 5.836099507474503,
      "balance_change_pct": 1.6310041067327485,
      "short_squeeze_index": 15.350488021295474,
      "pressure": {
        "score": 44,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 12,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 2858541.0,
      "balance_change_pct": 0.3818211954483458
    },
    "pension": {
      "streak": {
        "days": 4,
        "direction": "buy"
      },
      "net_5d": 303.0,
      "net_20d": -6797.0,
      "net_60d": -18968.0,
      "net_cumulative": -3881.0,
      "cumulative_window_days": 100,
      "current_price": 45950.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(4일)."
      }
    }
  },
  "004690": {
    "name": "삼천리",
    "as_of": "20260710",
    "short": {
      "balance_qty": 24111.0,
      "avg_price": 114657.0,
      "today_ratio_pct": 3.09,
      "avg_volume_20d": 12089.25,
      "days_to_cover": 1.9944165270798437,
      "balance_change_pct": 2.683020314296665,
      "short_squeeze_index": 31.587301587301585,
      "pressure": {
        "score": 37,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 66953.0,
      "balance_change_pct": -0.014933620058838463
    },
    "pension": {
      "streak": {
        "days": 4,
        "direction": "buy"
      },
      "net_5d": 393.0,
      "net_20d": 1030.0,
      "net_60d": 1301.0,
      "net_cumulative": 2602.0,
      "cumulative_window_days": 100,
      "current_price": 113400.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(4일)."
      }
    }
  },
  "071320": {
    "name": "지역난방공사",
    "as_of": "20260710",
    "short": {
      "balance_qty": 18875.0,
      "avg_price": 67627.0,
      "today_ratio_pct": 2.44,
      "avg_volume_20d": 12332.0,
      "days_to_cover": 1.5305708725267597,
      "balance_change_pct": 2.010484786250878,
      "short_squeeze_index": 29.838709677419356,
      "pressure": {
        "score": 37,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 149124.0,
      "balance_change_pct": -0.131930538906115
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": 16.0,
      "net_20d": 284.0,
      "net_60d": -479.0,
      "net_cumulative": -3978.0,
      "cumulative_window_days": 100,
      "current_price": 67400.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "105840": {
    "name": "우진",
    "as_of": "20260710",
    "short": {
      "balance_qty": 278871.0,
      "avg_price": 15262.0,
      "today_ratio_pct": 1.19,
      "avg_volume_20d": 234596.55,
      "days_to_cover": 1.1887259211612446,
      "balance_change_pct": 0.6667292364560471,
      "short_squeeze_index": 25.17596101786681,
      "pressure": {
        "score": 18,
        "grade": {
          "emoji": "🟢",
          "label": "매우 약함"
        },
        "breakdown": {
          "short_ratio": 0,
          "loan_increase": 0,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 979187.0,
      "balance_change_pct": -4.716832415390304
    },
    "pension": {
      "streak": {
        "days": 3,
        "direction": "sell"
      },
      "net_5d": -192.0,
      "net_20d": 2318.0,
      "net_60d": 1199.0,
      "net_cumulative": -2300.0,
      "cumulative_window_days": 100,
      "current_price": 15410.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "032820": {
    "name": "우리기술",
    "as_of": "20260710",
    "short": {
      "balance_qty": 5878346.0,
      "avg_price": 11350.0,
      "today_ratio_pct": 4.82,
      "avg_volume_20d": 4512141.6,
      "days_to_cover": 1.3027840261041455,
      "balance_change_pct": 4.291045371918158,
      "short_squeeze_index": 2.1623722422518443,
      "pressure": {
        "score": 44,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 22,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 29034163.0,
      "balance_change_pct": 2.638658449492582
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": -150.0,
      "net_20d": 48.0,
      "net_60d": 14.0,
      "net_cumulative": 9745.0,
      "cumulative_window_days": 100,
      "current_price": 11210.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "112610": {
    "name": "씨에스윈드",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1372361.0,
      "avg_price": 39914.0,
      "today_ratio_pct": 13.71,
      "avg_volume_20d": 741767.75,
      "days_to_cover": 1.850122224914739,
      "balance_change_pct": 4.332776582084571,
      "short_squeeze_index": -1.2949185850645706,
      "pressure": {
        "score": 60,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 2741212.0,
      "balance_change_pct": 1.3456747857708515
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": -412.0,
      "net_20d": 9873.0,
      "net_60d": -24174.0,
      "net_cumulative": 61451.0,
      "cumulative_window_days": 100,
      "current_price": 39850.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "456040": {
    "name": "OCI",
    "as_of": "20260710",
    "short": {
      "balance_qty": 113656.0,
      "avg_price": 89816.0,
      "today_ratio_pct": 8.57,
      "avg_volume_20d": 61437.1,
      "days_to_cover": 1.8499571106058066,
      "balance_change_pct": 1.8441190702342336,
      "short_squeeze_index": 6.2682215743440235,
      "pressure": {
        "score": 38,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 5,
          "balance_increase": 8,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 225481.0,
      "balance_change_pct": -0.15011956425471615
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": -373.0,
      "net_20d": -12053.0,
      "net_60d": 8926.0,
      "net_cumulative": 23866.0,
      "cumulative_window_days": 100,
      "current_price": 89400.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "009830": {
    "name": "한화솔루션",
    "as_of": "20260710",
    "short": {
      "balance_qty": 6587214.0,
      "avg_price": 31992.0,
      "today_ratio_pct": 30.15,
      "avg_volume_20d": 2055410.1,
      "days_to_cover": 3.2048173744013417,
      "balance_change_pct": 15.21933816887839,
      "short_squeeze_index": -1.370177886372465,
      "pressure": {
        "score": 100,
        "grade": {
          "emoji": "🔴",
          "label": "매우 강함"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 30,
          "balance_increase": 20,
          "foreign_sell": 10,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 19087031.0,
      "balance_change_pct": 11.647323249974773
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": 5830.0,
      "net_20d": -3301.0,
      "net_60d": 24105.0,
      "net_cumulative": 47166.0,
      "cumulative_window_days": 100,
      "current_price": 31900.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "336260": {
    "name": "두산퓨얼셀",
    "as_of": "20260710",
    "short": {
      "balance_qty": 759519.0,
      "avg_price": 45845.0,
      "today_ratio_pct": 3.65,
      "avg_volume_20d": 568979.65,
      "days_to_cover": 1.3348790242322375,
      "balance_change_pct": 1.4957384883058988,
      "short_squeeze_index": 11.194496560350219,
      "pressure": {
        "score": 31,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 5,
          "balance_increase": 8,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 2154146.0,
      "balance_change_pct": -0.15855822785572823
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -6347.0,
      "net_20d": 2919.0,
      "net_60d": 46256.0,
      "net_cumulative": 78460.0,
      "cumulative_window_days": 100,
      "current_price": 47050.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "083650": {
    "name": "비에이치아이",
    "as_of": "20260710",
    "short": {
      "balance_qty": 555863.0,
      "avg_price": 48110.0,
      "today_ratio_pct": 6.09,
      "avg_volume_20d": 293926.2,
      "days_to_cover": 1.891165197250194,
      "balance_change_pct": 1.9638379402630801,
      "short_squeeze_index": 8.35979824397534,
      "pressure": {
        "score": 55,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 22,
          "balance_increase": 8,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1236752.0,
      "balance_change_pct": 3.221197222066891
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": 210.0,
      "net_20d": -5580.0,
      "net_60d": -21562.0,
      "net_cumulative": -177.0,
      "cumulative_window_days": 100,
      "current_price": 48350.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "475150": {
    "name": "SK이터닉스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1116532.0,
      "avg_price": 43368.0,
      "today_ratio_pct": 2.56,
      "avg_volume_20d": 6014737.95,
      "days_to_cover": 0.18563269244340064,
      "balance_change_pct": 3.838520615517392,
      "short_squeeze_index": -13.550903716625479,
      "pressure": {
        "score": 37,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 2065234.0,
      "balance_change_pct": -0.2406512170710689
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": 1765.0,
      "net_20d": 39914.0,
      "net_60d": 49358.0,
      "net_cumulative": 36025.0,
      "cumulative_window_days": 100,
      "current_price": 42850.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "094820": {
    "name": "일진파워",
    "as_of": "20260710",
    "short": {
      "balance_qty": 151166.0,
      "avg_price": 11852.0,
      "today_ratio_pct": 3.01,
      "avg_volume_20d": 169423.45,
      "days_to_cover": 0.8922377628362543,
      "balance_change_pct": 2.164730371782135,
      "short_squeeze_index": 13.050265376209802,
      "pressure": {
        "score": 44,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 587800.0,
      "balance_change_pct": 0.0
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": 0.0,
      "net_20d": 0.0,
      "net_60d": 0.0,
      "net_cumulative": 0.0,
      "cumulative_window_days": 100,
      "current_price": 11920.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "277810": {
    "name": "레인보우로보틱스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 285984.0,
      "avg_price": 454841.0,
      "today_ratio_pct": 14.69,
      "avg_volume_20d": 91343.2,
      "days_to_cover": 3.13087345308682,
      "balance_change_pct": 3.6718565913251524,
      "short_squeeze_index": 68.44703327080659,
      "pressure": {
        "score": 53,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 940436.0,
      "balance_change_pct": -1.6970306406277602
    },
    "pension": {
      "streak": {
        "days": 3,
        "direction": "sell"
      },
      "net_5d": -1540.0,
      "net_20d": -11908.0,
      "net_60d": -16147.0,
      "net_cumulative": -68569.0,
      "cumulative_window_days": 100,
      "current_price": 453500.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "454910": {
    "name": "두산로보틱스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1090980.0,
      "avg_price": 74506.0,
      "today_ratio_pct": 5.08,
      "avg_volume_20d": 609830.35,
      "days_to_cover": 1.788989347611184,
      "balance_change_pct": 1.7934069133079358,
      "short_squeeze_index": 17.53290671661204,
      "pressure": {
        "score": 53,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 30,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 4963831.0,
      "balance_change_pct": 9.202541311491496
    },
    "pension": {
      "streak": {
        "days": 4,
        "direction": "sell"
      },
      "net_5d": -2402.0,
      "net_20d": -12699.0,
      "net_60d": 1500.0,
      "net_cumulative": -8952.0,
      "cumulative_window_days": 100,
      "current_price": 74500.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "108490": {
    "name": "로보티즈",
    "as_of": "20260710",
    "short": {
      "balance_qty": 326812.0,
      "avg_price": 216731.0,
      "today_ratio_pct": 9.28,
      "avg_volume_20d": 174661.85,
      "days_to_cover": 1.8711126671336642,
      "balance_change_pct": 3.4696520216683076,
      "short_squeeze_index": 40.78839310156036,
      "pressure": {
        "score": 69,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 30,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1124167.0,
      "balance_change_pct": 9.985255946784436
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": -954.0,
      "net_20d": -3152.0,
      "net_60d": 2133.0,
      "net_cumulative": 12102.0,
      "cumulative_window_days": 100,
      "current_price": 218000.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "022100": {
    "name": "포스코DX",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1368652.0,
      "avg_price": 20380.0,
      "today_ratio_pct": 27.4,
      "avg_volume_20d": 385697.15,
      "days_to_cover": 3.5485146830874945,
      "balance_change_pct": 5.659509226134874,
      "short_squeeze_index": 1.792388487245942,
      "pressure": {
        "score": 80,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 30,
          "balance_increase": 20,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 7098491.0,
      "balance_change_pct": 5.277543159991368
    },
    "pension": {
      "streak": {
        "days": 4,
        "direction": "sell"
      },
      "net_5d": -1108.0,
      "net_20d": -12212.0,
      "net_60d": -9674.0,
      "net_cumulative": -55277.0,
      "cumulative_window_days": 100,
      "current_price": 20200.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "455900": {
    "name": "엔젤로보틱스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 167431.0,
      "avg_price": 18098.0,
      "today_ratio_pct": 3.32,
      "avg_volume_20d": 58593.9,
      "days_to_cover": 2.8574817515133826,
      "balance_change_pct": 1.4370618990785113,
      "short_squeeze_index": 1.5598650927487352,
      "pressure": {
        "score": 38,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 12,
          "balance_increase": 8,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 765101.0,
      "balance_change_pct": 0.0
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": 18.0,
      "net_20d": 2.0,
      "net_60d": 318.0,
      "net_cumulative": 318.0,
      "cumulative_window_days": 100,
      "current_price": 18240.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "388720": {
    "name": "유일로보틱스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 158382.0,
      "avg_price": 69850.0,
      "today_ratio_pct": 11.41,
      "avg_volume_20d": 48666.95,
      "days_to_cover": 3.254405710651685,
      "balance_change_pct": 1.945815820132725,
      "short_squeeze_index": 10.585511081706914,
      "pressure": {
        "score": 47,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 5,
          "balance_increase": 8,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 699118.0,
      "balance_change_pct": -0.8128005084791451
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": -15.0,
      "net_20d": -304.0,
      "net_60d": -570.0,
      "net_cumulative": -1431.0,
      "cumulative_window_days": 100,
      "current_price": 69000.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "058610": {
    "name": "에스피지",
    "as_of": "20260710",
    "short": {
      "balance_qty": 422981.0,
      "avg_price": 72810.0,
      "today_ratio_pct": 19.61,
      "avg_volume_20d": 178170.85,
      "days_to_cover": 2.3740190945937565,
      "balance_change_pct": 7.4584056317847285,
      "short_squeeze_index": 3.9410041555964304,
      "pressure": {
        "score": 72,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 22,
          "balance_increase": 20,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1418932.0,
      "balance_change_pct": 2.431918131390571
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -367.0,
      "net_20d": -897.0,
      "net_60d": -13334.0,
      "net_cumulative": -21447.0,
      "cumulative_window_days": 100,
      "current_price": 74000.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "348340": {
    "name": "뉴로메카",
    "as_of": "20260710",
    "short": {
      "balance_qty": 140980.0,
      "avg_price": 33177.0,
      "today_ratio_pct": 1.18,
      "avg_volume_20d": 140964.55,
      "days_to_cover": 1.000109602024055,
      "balance_change_pct": 0.6439269549822242,
      "short_squeeze_index": 3.436807095343681,
      "pressure": {
        "score": 30,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 0,
          "loan_increase": 12,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1923620.0,
      "balance_change_pct": 0.0
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": 0.0,
      "net_20d": 0.0,
      "net_60d": 0.0,
      "net_cumulative": 0.0,
      "cumulative_window_days": 100,
      "current_price": 32950.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "000270": {
    "name": "기아",
    "as_of": "20260710",
    "short": {
      "balance_qty": 3251542.0,
      "avg_price": 148914.0,
      "today_ratio_pct": 6.29,
      "avg_volume_20d": 1146573.15,
      "days_to_cover": 2.835878373743533,
      "balance_change_pct": 1.9840767008208804,
      "short_squeeze_index": 16.769420468557335,
      "pressure": {
        "score": 38,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 5,
          "balance_increase": 8,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 5532890.0,
      "balance_change_pct": -2.0242583763575746
    },
    "pension": {
      "streak": {
        "days": 7,
        "direction": "buy"
      },
      "net_5d": 51490.0,
      "net_20d": 15837.0,
      "net_60d": -52357.0,
      "net_cumulative": 12646.0,
      "cumulative_window_days": 100,
      "current_price": 147500.0,
      "interpretation": {
        "tone": "very_positive",
        "label": "매우 긍정",
        "text": "연기금이 7일 연속 순매수 중이고 외국인도 최근 5일 순매수를 동반하고 있습니다."
      }
    }
  },
  "012330": {
    "name": "현대모비스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1150078.0,
      "avg_price": 489920.0,
      "today_ratio_pct": 7.0,
      "avg_volume_20d": 457809.35,
      "days_to_cover": 2.512133052765305,
      "balance_change_pct": 1.6891634997798357,
      "short_squeeze_index": 194.5822864321608,
      "pressure": {
        "score": 23,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 0,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1396940.0,
      "balance_change_pct": -7.407517878009965
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": 27286.0,
      "net_20d": 1514.0,
      "net_60d": 223198.0,
      "net_cumulative": 150443.0,
      "cumulative_window_days": 100,
      "current_price": 488000.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "011210": {
    "name": "현대위아",
    "as_of": "20260710",
    "short": {
      "balance_qty": 387414.0,
      "avg_price": 62076.0,
      "today_ratio_pct": 5.91,
      "avg_volume_20d": 144859.25,
      "days_to_cover": 2.674416718297244,
      "balance_change_pct": 1.3724294749181645,
      "short_squeeze_index": 17.54051477597712,
      "pressure": {
        "score": 35,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 12,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1259590.0,
      "balance_change_pct": 0.3538225342170531
    },
    "pension": {
      "streak": {
        "days": 8,
        "direction": "sell"
      },
      "net_5d": -4590.0,
      "net_20d": -11447.0,
      "net_60d": -43958.0,
      "net_cumulative": -49762.0,
      "cumulative_window_days": 100,
      "current_price": 61900.0,
      "interpretation": {
        "tone": "caution",
        "label": "비중 축소 가능성",
        "text": "연기금이 8일 연속 순매도 중입니다."
      }
    }
  },
  "204320": {
    "name": "HL만도",
    "as_of": "20260710",
    "short": {
      "balance_qty": 2100865.0,
      "avg_price": 49923.0,
      "today_ratio_pct": 8.06,
      "avg_volume_20d": 1565382.6,
      "days_to_cover": 1.3420776492596762,
      "balance_change_pct": 3.099818422731511,
      "short_squeeze_index": 14.542863927808122,
      "pressure": {
        "score": 51,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 22,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 3078196.0,
      "balance_change_pct": 2.545108813154254
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": 2845.0,
      "net_20d": 7237.0,
      "net_60d": 25676.0,
      "net_cumulative": -39984.0,
      "cumulative_window_days": 100,
      "current_price": 49550.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "018880": {
    "name": "한온시스템",
    "as_of": "20260710",
    "short": {
      "balance_qty": 15086282.0,
      "avg_price": 3606.0,
      "today_ratio_pct": 6.02,
      "avg_volume_20d": 12970121.4,
      "days_to_cover": 1.1631565761597267,
      "balance_change_pct": 2.5187501291144003,
      "short_squeeze_index": -0.5126129772022123,
      "pressure": {
        "score": 49,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 0,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 12523470.0,
      "balance_change_pct": -21.733150369642775
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": 831.0,
      "net_20d": -2691.0,
      "net_60d": 8419.0,
      "net_cumulative": 19692.0,
      "cumulative_window_days": 100,
      "current_price": 3605.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "086280": {
    "name": "현대글로비스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 620843.0,
      "avg_price": 194840.0,
      "today_ratio_pct": 11.75,
      "avg_volume_20d": 251629.2,
      "days_to_cover": 2.467293144038927,
      "balance_change_pct": 4.118849606646508,
      "short_squeeze_index": 22.93159609120521,
      "pressure": {
        "score": 53,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1214052.0,
      "balance_change_pct": -1.076460383797116
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -396.0,
      "net_20d": -12208.0,
      "net_60d": 47862.0,
      "net_cumulative": -32246.0,
      "cumulative_window_days": 100,
      "current_price": 191600.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "161390": {
    "name": "한국타이어앤테크놀로지",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1953085.0,
      "avg_price": 71177.0,
      "today_ratio_pct": 10.52,
      "avg_volume_20d": 420629.9,
      "days_to_cover": 4.643238628542574,
      "balance_change_pct": 2.3406858571117914,
      "short_squeeze_index": 2.191627490485785,
      "pressure": {
        "score": 53,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 4185505.0,
      "balance_change_pct": -0.5107449693272533
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": 698.0,
      "net_20d": -6037.0,
      "net_60d": -16812.0,
      "net_cumulative": -18818.0,
      "cumulative_window_days": 100,
      "current_price": 71500.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "009540": {
    "name": "HD한국조선해양",
    "as_of": "20260710",
    "short": {
      "balance_qty": 656929.0,
      "avg_price": 342866.0,
      "today_ratio_pct": 7.05,
      "avg_volume_20d": 236393.5,
      "days_to_cover": 2.7789638886009977,
      "balance_change_pct": 2.367165416416045,
      "short_squeeze_index": 3.745638865117504,
      "pressure": {
        "score": 44,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1767470.0,
      "balance_change_pct": -1.093169856827485
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -9394.0,
      "net_20d": -38507.0,
      "net_60d": 76384.0,
      "net_cumulative": 65891.0,
      "cumulative_window_days": 100,
      "current_price": 340500.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "329180": {
    "name": "HD현대중공업",
    "as_of": "20260710",
    "short": {
      "balance_qty": 736072.0,
      "avg_price": 515856.0,
      "today_ratio_pct": 4.15,
      "avg_volume_20d": 327007.65,
      "days_to_cover": 2.2509320500606025,
      "balance_change_pct": 1.4583206982296153,
      "short_squeeze_index": -302.6181474480151,
      "pressure": {
        "score": 41,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 5,
          "balance_increase": 8,
          "foreign_sell": 10,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 7281166.0,
      "balance_change_pct": -0.2424077516773512
    },
    "pension": {
      "streak": {
        "days": 5,
        "direction": "sell"
      },
      "net_5d": -45405.0,
      "net_20d": -16116.0,
      "net_60d": 366570.0,
      "net_cumulative": 325820.0,
      "cumulative_window_days": 100,
      "current_price": 504000.0,
      "interpretation": {
        "tone": "caution",
        "label": "비중 축소 가능성",
        "text": "연기금이 5일 연속 순매도 중입니다."
      }
    }
  },
  "010140": {
    "name": "삼성중공업",
    "as_of": "20260710",
    "short": {
      "balance_qty": 11210756.0,
      "avg_price": 22370.0,
      "today_ratio_pct": 17.23,
      "avg_volume_20d": 4627540.15,
      "days_to_cover": 2.4226166897763166,
      "balance_change_pct": 6.960502941883338,
      "short_squeeze_index": 1.624711292655011,
      "pressure": {
        "score": 72,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 12,
          "balance_increase": 20,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 40928838.0,
      "balance_change_pct": 0.3899695677060165
    },
    "pension": {
      "streak": {
        "days": 17,
        "direction": "sell"
      },
      "net_5d": -20309.0,
      "net_20d": -46339.0,
      "net_60d": -27883.0,
      "net_cumulative": -40619.0,
      "cumulative_window_days": 100,
      "current_price": 22350.0,
      "interpretation": {
        "tone": "caution",
        "label": "비중 축소 가능성",
        "text": "연기금이 17일 연속 순매도 중입니다."
      }
    }
  },
  "042660": {
    "name": "한화오션",
    "as_of": "20260710",
    "short": {
      "balance_qty": 6287509.0,
      "avg_price": 82346.0,
      "today_ratio_pct": 9.01,
      "avg_volume_20d": 2602694.65,
      "days_to_cover": 2.415768980045354,
      "balance_change_pct": 2.740852400619304,
      "short_squeeze_index": 14.242192996053275,
      "pressure": {
        "score": 34,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 12913974.0,
      "balance_change_pct": -1.231858564103819
    },
    "pension": {
      "streak": {
        "days": 4,
        "direction": "sell"
      },
      "net_5d": -51261.0,
      "net_20d": -53944.0,
      "net_60d": -23068.0,
      "net_cumulative": 12274.0,
      "cumulative_window_days": 100,
      "current_price": 81300.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "443060": {
    "name": "HD현대마린솔루션",
    "as_of": "20260710",
    "short": {
      "balance_qty": 308549.0,
      "avg_price": 197811.0,
      "today_ratio_pct": 6.65,
      "avg_volume_20d": 181107.1,
      "days_to_cover": 1.7036825171404102,
      "balance_change_pct": 3.5378482312436663,
      "short_squeeze_index": 1.6219292421511904,
      "pressure": {
        "score": 69,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 30,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 880611.0,
      "balance_change_pct": 17.825303356895425
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -3719.0,
      "net_20d": 6461.0,
      "net_60d": 82914.0,
      "net_cumulative": 48236.0,
      "cumulative_window_days": 100,
      "current_price": 197200.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "100090": {
    "name": "SK오션플랜트",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1872678.0,
      "avg_price": 13875.0,
      "today_ratio_pct": 10.18,
      "avg_volume_20d": 1621322.65,
      "days_to_cover": 1.1550310482617387,
      "balance_change_pct": 2.5916375356023513,
      "short_squeeze_index": 0.5157799057221976,
      "pressure": {
        "score": 60,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 5690549.0,
      "balance_change_pct": 0.18053642998056085
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -165.0,
      "net_20d": 2680.0,
      "net_60d": -26322.0,
      "net_cumulative": -5658.0,
      "cumulative_window_days": 100,
      "current_price": 13850.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "460930": {
    "name": "현대힘스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 147575.0,
      "avg_price": 11563.0,
      "today_ratio_pct": 2.31,
      "avg_volume_20d": 146370.15,
      "days_to_cover": 1.0082315280813745,
      "balance_change_pct": 1.1598335652543477,
      "short_squeeze_index": 34.63356973995272,
      "pressure": {
        "score": 31,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 5,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1027709.0,
      "balance_change_pct": -0.2136111054471803
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": 0.0,
      "net_20d": -118.0,
      "net_60d": -2295.0,
      "net_cumulative": -353.0,
      "cumulative_window_days": 100,
      "current_price": 11640.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "097230": {
    "name": "HJ중공업",
    "as_of": "20260710",
    "short": {
      "balance_qty": 998164.0,
      "avg_price": 17554.0,
      "today_ratio_pct": 3.83,
      "avg_volume_20d": 751967.1,
      "days_to_cover": 1.3274038185979147,
      "balance_change_pct": 1.6718088395122592,
      "short_squeeze_index": 13.489307256443064,
      "pressure": {
        "score": 46,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 30,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 3798723.0,
      "balance_change_pct": 19.9735653601996
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": 889.0,
      "net_20d": 42299.0,
      "net_60d": 66134.0,
      "net_cumulative": 72933.0,
      "cumulative_window_days": 100,
      "current_price": 17730.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "075580": {
    "name": "세진중공업",
    "as_of": "20260710",
    "short": {
      "balance_qty": 386554.0,
      "avg_price": 12005.0,
      "today_ratio_pct": 9.85,
      "avg_volume_20d": 149556.75,
      "days_to_cover": 2.584664349820386,
      "balance_change_pct": 2.172143280047365,
      "short_squeeze_index": 2.3241664638598203,
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
      "balance_qty": 1833114.0,
      "balance_change_pct": 0.06676161409166811
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": 416.0,
      "net_20d": 7442.0,
      "net_60d": 12061.0,
      "net_cumulative": 10740.0,
      "cumulative_window_days": 100,
      "current_price": 12000.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "017960": {
    "name": "한국카본",
    "as_of": "20260710",
    "short": {
      "balance_qty": 643277.0,
      "avg_price": 24524.0,
      "today_ratio_pct": 16.09,
      "avg_volume_20d": 326935.05,
      "days_to_cover": 1.9675987631182401,
      "balance_change_pct": 4.898937601408922,
      "short_squeeze_index": 0.6457625990280275,
      "pressure": {
        "score": 49,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1879633.0,
      "balance_change_pct": -0.4735313802568708
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -1050.0,
      "net_20d": -1110.0,
      "net_60d": -56714.0,
      "net_cumulative": -5871.0,
      "cumulative_window_days": 100,
      "current_price": 24450.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "033500": {
    "name": "동성화인텍",
    "as_of": "20260710",
    "short": {
      "balance_qty": 339836.0,
      "avg_price": 16741.0,
      "today_ratio_pct": 9.15,
      "avg_volume_20d": 154799.75,
      "days_to_cover": 2.195326542840024,
      "balance_change_pct": 3.0255626697710514,
      "short_squeeze_index": 6.012024048096192,
      "pressure": {
        "score": 51,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1032199.0,
      "balance_change_pct": 0.004456703608864189
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": 456.0,
      "net_20d": 545.0,
      "net_60d": -4555.0,
      "net_cumulative": -4104.0,
      "cumulative_window_days": 100,
      "current_price": 16670.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "108380": {
    "name": "대양전기공업",
    "as_of": "20260710",
    "short": {
      "balance_qty": 95415.0,
      "avg_price": 17272.0,
      "today_ratio_pct": 1.49,
      "avg_volume_20d": 88115.9,
      "days_to_cover": 1.082835220431273,
      "balance_change_pct": 0.8988526410405542,
      "short_squeeze_index": 38.82352941176471,
      "pressure": {
        "score": 13,
        "grade": {
          "emoji": "🟢",
          "label": "매우 약함"
        },
        "breakdown": {
          "short_ratio": 0,
          "loan_increase": 5,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 188002.0,
      "balance_change_pct": -2.3853039523146897
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": 0.0,
      "net_20d": -3699.0,
      "net_60d": -3971.0,
      "net_cumulative": -5816.0,
      "cumulative_window_days": 100,
      "current_price": 17420.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "047810": {
    "name": "한국항공우주",
    "as_of": "20260710",
    "short": {
      "balance_qty": 2848212.0,
      "avg_price": 148495.0,
      "today_ratio_pct": 20.36,
      "avg_volume_20d": 476523.45,
      "days_to_cover": 5.977065766648,
      "balance_change_pct": 3.853941470554239,
      "short_squeeze_index": -16.722645347462038,
      "pressure": {
        "score": 86,
        "grade": {
          "emoji": "🔴",
          "label": "매우 강함"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 22,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 8742369.0,
      "balance_change_pct": 2.6938796702187866
    },
    "pension": {
      "streak": {
        "days": 8,
        "direction": "sell"
      },
      "net_5d": -15344.0,
      "net_20d": -6073.0,
      "net_60d": -201793.0,
      "net_cumulative": -203278.0,
      "cumulative_window_days": 100,
      "current_price": 144300.0,
      "interpretation": {
        "tone": "caution",
        "label": "비중 축소 가능성",
        "text": "연기금이 8일 연속 순매도 중입니다."
      }
    }
  },
  "012450": {
    "name": "한화에어로스페이스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 570964.0,
      "avg_price": 958926.0,
      "today_ratio_pct": 3.44,
      "avg_volume_20d": 246439.75,
      "days_to_cover": 2.3168502646184312,
      "balance_change_pct": 1.796981555933926,
      "short_squeeze_index": 10.437543407084036,
      "pressure": {
        "score": 31,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 5,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1201096.0,
      "balance_change_pct": -0.4857662936354922
    },
    "pension": {
      "streak": {
        "days": 4,
        "direction": "sell"
      },
      "net_5d": -31558.0,
      "net_20d": 39377.0,
      "net_60d": -49231.0,
      "net_cumulative": -104621.0,
      "cumulative_window_days": 100,
      "current_price": 967000.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "099320": {
    "name": "쎄트렉아이",
    "as_of": "20260710",
    "short": {
      "balance_qty": 192572.0,
      "avg_price": 87679.0,
      "today_ratio_pct": 7.77,
      "avg_volume_20d": 86378.65,
      "days_to_cover": 2.2293934901737873,
      "balance_change_pct": 3.3045082934575025,
      "short_squeeze_index": 9.39935064935065,
      "pressure": {
        "score": 44,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 603145.0,
      "balance_change_pct": -1.6001226847735472
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": 168.0,
      "net_20d": 1819.0,
      "net_60d": -5610.0,
      "net_cumulative": -22967.0,
      "cumulative_window_days": 100,
      "current_price": 88100.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "295310": {
    "name": "에이치브이엠",
    "as_of": "20260710",
    "short": {
      "balance_qty": 309092.0,
      "avg_price": 47639.0,
      "today_ratio_pct": 20.06,
      "avg_volume_20d": 260139.75,
      "days_to_cover": 1.18817673961784,
      "balance_change_pct": 5.468392785242915,
      "short_squeeze_index": 2.751778360164732,
      "pressure": {
        "score": 72,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 22,
          "balance_increase": 20,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 860957.0,
      "balance_change_pct": 2.8725702459984035
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": -684.0,
      "net_20d": -70.0,
      "net_60d": 5516.0,
      "net_cumulative": 14219.0,
      "cumulative_window_days": 100,
      "current_price": 47400.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "478340": {
    "name": "나라스페이스테크놀로지",
    "as_of": "20260710",
    "short": {
      "balance_qty": 58056.0,
      "avg_price": 11743.0,
      "today_ratio_pct": 1.24,
      "avg_volume_20d": 143746.05,
      "days_to_cover": 0.40387892397738934,
      "balance_change_pct": 1.2486920125566796,
      "short_squeeze_index": 33.659217877094974,
      "pressure": {
        "score": 23,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 0,
          "loan_increase": 5,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 299595.0,
      "balance_change_pct": -0.7947151442904685
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": -470.0,
      "net_20d": -952.0,
      "net_60d": -952.0,
      "net_cumulative": -952.0,
      "cumulative_window_days": 100,
      "current_price": 12260.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "462350": {
    "name": "이노스페이스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 550585.0,
      "avg_price": 7064.0,
      "today_ratio_pct": 1.27,
      "avg_volume_20d": 411457.7,
      "days_to_cover": 1.3381326926194357,
      "balance_change_pct": 0.7001282105213102,
      "short_squeeze_index": -1.2539184952978055,
      "pressure": {
        "score": 18,
        "grade": {
          "emoji": "🟢",
          "label": "매우 약함"
        },
        "breakdown": {
          "short_ratio": 0,
          "loan_increase": 0,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1020373.0,
      "balance_change_pct": -7.067992254853922
    },
    "pension": {
      "streak": {
        "days": 3,
        "direction": "sell"
      },
      "net_5d": -908.0,
      "net_20d": -1198.0,
      "net_60d": -1211.0,
      "net_cumulative": -1260.0,
      "cumulative_window_days": 100,
      "current_price": 7020.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "079550": {
    "name": "LIG디펜스앤에어로스페이스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 327441.0,
      "avg_price": 733731.0,
      "today_ratio_pct": 7.55,
      "avg_volume_20d": 219192.9,
      "days_to_cover": 1.4938485690001821,
      "balance_change_pct": 2.974372843831274,
      "short_squeeze_index": 192.74688094734614,
      "pressure": {
        "score": 69,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 30,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 683282.0,
      "balance_change_pct": 9.024735049990266
    },
    "pension": {
      "streak": {
        "days": 3,
        "direction": "sell"
      },
      "net_5d": -8866.0,
      "net_20d": 34630.0,
      "net_60d": 124396.0,
      "net_cumulative": 188657.0,
      "cumulative_window_days": 100,
      "current_price": 749000.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "272210": {
    "name": "한화시스템",
    "as_of": "20260710",
    "short": {
      "balance_qty": 2724537.0,
      "avg_price": 70736.0,
      "today_ratio_pct": 15.27,
      "avg_volume_20d": 833614.15,
      "days_to_cover": 3.268343033764482,
      "balance_change_pct": 5.066694946300831,
      "short_squeeze_index": 12.857436428261549,
      "pressure": {
        "score": 72,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 12,
          "balance_increase": 20,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 7442445.0,
      "balance_change_pct": 1.775633837485983
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": -14425.0,
      "net_20d": -25120.0,
      "net_60d": -124476.0,
      "net_cumulative": -155629.0,
      "cumulative_window_days": 100,
      "current_price": 71700.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "064350": {
    "name": "현대로템",
    "as_of": "20260710",
    "short": {
      "balance_qty": 2098152.0,
      "avg_price": 177799.0,
      "today_ratio_pct": 7.33,
      "avg_volume_20d": 577177.6,
      "days_to_cover": 3.635193049764925,
      "balance_change_pct": 2.5290791571723377,
      "short_squeeze_index": 28.934402473190996,
      "pressure": {
        "score": 39,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 0,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 2969718.0,
      "balance_change_pct": -6.785089094608936
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -47317.0,
      "net_20d": -54859.0,
      "net_60d": -70652.0,
      "net_cumulative": -96812.0,
      "cumulative_window_days": 100,
      "current_price": 178900.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "103140": {
    "name": "풍산",
    "as_of": "20260710",
    "short": {
      "balance_qty": 325525.0,
      "avg_price": 65174.0,
      "today_ratio_pct": 10.14,
      "avg_volume_20d": 117083.05,
      "days_to_cover": 2.7802914256162614,
      "balance_change_pct": 4.828165857302951,
      "short_squeeze_index": 20.16941239244981,
      "pressure": {
        "score": 50,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1208660.0,
      "balance_change_pct": 0.3382907806422959
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": 1062.0,
      "net_20d": 1258.0,
      "net_60d": -27255.0,
      "net_cumulative": -65159.0,
      "cumulative_window_days": 100,
      "current_price": 65100.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "000720": {
    "name": "현대건설",
    "as_of": "20260710",
    "short": {
      "balance_qty": 3636867.0,
      "avg_price": 107411.0,
      "today_ratio_pct": 18.01,
      "avg_volume_20d": 868106.8,
      "days_to_cover": 4.189423467250803,
      "balance_change_pct": 2.779267728164471,
      "short_squeeze_index": 16.904774009863235,
      "pressure": {
        "score": 49,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 6347804.0,
      "balance_change_pct": -1.9230050186441656
    },
    "pension": {
      "streak": {
        "days": 5,
        "direction": "sell"
      },
      "net_5d": -27400.0,
      "net_20d": -29511.0,
      "net_60d": -135925.0,
      "net_cumulative": -296985.0,
      "cumulative_window_days": 100,
      "current_price": 107200.0,
      "interpretation": {
        "tone": "caution",
        "label": "비중 축소 가능성",
        "text": "연기금이 5일 연속 순매도 중입니다."
      }
    }
  },
  "028260": {
    "name": "삼성물산",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1256836.0,
      "avg_price": 392423.0,
      "today_ratio_pct": 6.7,
      "avg_volume_20d": 750943.5,
      "days_to_cover": 1.6736758491151464,
      "balance_change_pct": 2.7465605658419983,
      "short_squeeze_index": 42.55439473762539,
      "pressure": {
        "score": 61,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 22,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 2609738.0,
      "balance_change_pct": 2.39193525669018
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": 2980.0,
      "net_20d": -36633.0,
      "net_60d": -12717.0,
      "net_cumulative": -135348.0,
      "cumulative_window_days": 100,
      "current_price": 391500.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "047040": {
    "name": "대우건설",
    "as_of": "20260710",
    "short": {
      "balance_qty": 13550522.0,
      "avg_price": 17628.0,
      "today_ratio_pct": 6.61,
      "avg_volume_20d": 9906608.95,
      "days_to_cover": 1.3678264750724818,
      "balance_change_pct": 3.7460688071016843,
      "short_squeeze_index": 2.834964631920586,
      "pressure": {
        "score": 51,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 22,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 31234252.0,
      "balance_change_pct": 3.9786441026551294
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": 11587.0,
      "net_20d": 9509.0,
      "net_60d": -109640.0,
      "net_cumulative": -76478.0,
      "cumulative_window_days": 100,
      "current_price": 17450.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "006360": {
    "name": "GS건설",
    "as_of": "20260710",
    "short": {
      "balance_qty": 4870739.0,
      "avg_price": 31776.0,
      "today_ratio_pct": 9.44,
      "avg_volume_20d": 2247671.3,
      "days_to_cover": 2.1670157019845386,
      "balance_change_pct": 8.857706123870214,
      "short_squeeze_index": 8.248429339187041,
      "pressure": {
        "score": 40,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 5,
          "balance_increase": 20,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 6706915.0,
      "balance_change_pct": -0.7577398698218618
    },
    "pension": {
      "streak": {
        "days": 8,
        "direction": "buy"
      },
      "net_5d": 16613.0,
      "net_20d": 26798.0,
      "net_60d": -11776.0,
      "net_cumulative": 43025.0,
      "cumulative_window_days": 100,
      "current_price": 31850.0,
      "interpretation": {
        "tone": "very_positive",
        "label": "매우 긍정",
        "text": "연기금이 8일 연속 순매수 중이고 외국인도 최근 5일 순매수를 동반하고 있습니다."
      }
    }
  },
  "375500": {
    "name": "DL이앤씨",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1539515.0,
      "avg_price": 64113.0,
      "today_ratio_pct": 9.3,
      "avg_volume_20d": 681492.75,
      "days_to_cover": 2.2590335700563213,
      "balance_change_pct": 2.2128077143194798,
      "short_squeeze_index": 5.439707161931051,
      "pressure": {
        "score": 61,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 22,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 2764474.0,
      "balance_change_pct": 2.8893399760760032
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "sell"
      },
      "net_5d": 2304.0,
      "net_20d": 13523.0,
      "net_60d": 53349.0,
      "net_cumulative": 148664.0,
      "cumulative_window_days": 100,
      "current_price": 63300.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "294870": {
    "name": "HDC현대산업개발",
    "as_of": "20260710",
    "short": {
      "balance_qty": 649240.0,
      "avg_price": 17978.0,
      "today_ratio_pct": 38.81,
      "avg_volume_20d": 181911.15,
      "days_to_cover": 3.568995083588884,
      "balance_change_pct": 9.945267835369984,
      "short_squeeze_index": 0.4376106797439041,
      "pressure": {
        "score": 72,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 12,
          "balance_increase": 20,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1447979.0,
      "balance_change_pct": 1.1173348212508702
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": 1686.0,
      "net_20d": -103.0,
      "net_60d": 9596.0,
      "net_cumulative": 9307.0,
      "cumulative_window_days": 100,
      "current_price": 17800.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "267270": {
    "name": "HD현대건설기계",
    "as_of": "20260710",
    "short": {
      "balance_qty": 303066.0,
      "avg_price": 129810.0,
      "today_ratio_pct": 5.13,
      "avg_volume_20d": 344223.9,
      "days_to_cover": 0.8804327648370726,
      "balance_change_pct": 5.047417020214624,
      "short_squeeze_index": 48.97678890262326,
      "pressure": {
        "score": 57,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 12,
          "balance_increase": 20,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 908451.0,
      "balance_change_pct": 1.357720003302532
    },
    "pension": {
      "streak": {
        "days": 4,
        "direction": "buy"
      },
      "net_5d": 24341.0,
      "net_20d": 12065.0,
      "net_60d": 10400.0,
      "net_cumulative": 39804.0,
      "cumulative_window_days": 100,
      "current_price": 130300.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(4일)."
      }
    }
  },
  "241560": {
    "name": "두산밥캣",
    "as_of": "20260710",
    "short": {
      "balance_qty": 755545.0,
      "avg_price": 63033.0,
      "today_ratio_pct": 13.14,
      "avg_volume_20d": 262998.85,
      "days_to_cover": 2.872807238510739,
      "balance_change_pct": 2.1887789743048733,
      "short_squeeze_index": 13.643947352159675,
      "pressure": {
        "score": 50,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1390617.0,
      "balance_change_pct": 1.3887744619483233
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": -1221.0,
      "net_20d": -13365.0,
      "net_60d": -41345.0,
      "net_cumulative": -47746.0,
      "cumulative_window_days": 100,
      "current_price": 62900.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "105560": {
    "name": "KB금융",
    "as_of": "20260710",
    "short": {
      "balance_qty": 3069674.0,
      "avg_price": 185297.0,
      "today_ratio_pct": 8.2,
      "avg_volume_20d": 1592782.65,
      "days_to_cover": 1.9272397272785462,
      "balance_change_pct": 6.103243543865216,
      "short_squeeze_index": 36.145956629835815,
      "pressure": {
        "score": 35,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 0,
          "balance_increase": 20,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 3694271.0,
      "balance_change_pct": -3.2889552779571014
    },
    "pension": {
      "streak": {
        "days": 3,
        "direction": "sell"
      },
      "net_5d": -9818.0,
      "net_20d": -51236.0,
      "net_60d": -137673.0,
      "net_cumulative": -183753.0,
      "cumulative_window_days": 100,
      "current_price": 184400.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "055550": {
    "name": "신한지주",
    "as_of": "20260710",
    "short": {
      "balance_qty": 3791777.0,
      "avg_price": 110306.0,
      "today_ratio_pct": 7.6,
      "avg_volume_20d": 1521839.35,
      "days_to_cover": 2.491575079853205,
      "balance_change_pct": 3.3101235162600404,
      "short_squeeze_index": 47.01006658929468,
      "pressure": {
        "score": 34,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 6999945.0,
      "balance_change_pct": -1.2340479388300967
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": 47381.0,
      "net_20d": 157573.0,
      "net_60d": 186578.0,
      "net_cumulative": 93154.0,
      "cumulative_window_days": 100,
      "current_price": 109200.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "086790": {
    "name": "하나금융지주",
    "as_of": "20260710",
    "short": {
      "balance_qty": 2464884.0,
      "avg_price": 129200.0,
      "today_ratio_pct": 5.56,
      "avg_volume_20d": 874389.3,
      "days_to_cover": 2.818977771114079,
      "balance_change_pct": 2.7559055118110236,
      "short_squeeze_index": 19.056695104979728,
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
      "balance_qty": 5533210.0,
      "balance_change_pct": 0.8298971439234297
    },
    "pension": {
      "streak": {
        "days": 7,
        "direction": "buy"
      },
      "net_5d": 33734.0,
      "net_20d": 49360.0,
      "net_60d": 5019.0,
      "net_cumulative": -10239.0,
      "cumulative_window_days": 100,
      "current_price": 128500.0,
      "interpretation": {
        "tone": "very_positive",
        "label": "매우 긍정",
        "text": "연기금이 7일 연속 순매수 중이고 외국인도 최근 5일 순매수를 동반하고 있습니다."
      }
    }
  },
  "316140": {
    "name": "우리금융지주",
    "as_of": "20260710",
    "short": {
      "balance_qty": 5020952.0,
      "avg_price": 32030.0,
      "today_ratio_pct": 10.86,
      "avg_volume_20d": 2215104.2,
      "days_to_cover": 2.2666888537342844,
      "balance_change_pct": 5.030179992197445,
      "short_squeeze_index": 9.259898447604037,
      "pressure": {
        "score": 56,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 12,
          "balance_increase": 20,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 12542681.0,
      "balance_change_pct": 0.6908856495582268
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": 14143.0,
      "net_20d": 15047.0,
      "net_60d": -63926.0,
      "net_cumulative": -132285.0,
      "cumulative_window_days": 100,
      "current_price": 31450.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "138040": {
    "name": "메리츠금융지주",
    "as_of": "20260710",
    "short": {
      "balance_qty": 951552.0,
      "avg_price": 115754.0,
      "today_ratio_pct": 15.15,
      "avg_volume_20d": 307550.2,
      "days_to_cover": 3.0939729514076073,
      "balance_change_pct": 4.7644003267722,
      "short_squeeze_index": 28.797892498960113,
      "pressure": {
        "score": 49,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 3775781.0,
      "balance_change_pct": -0.16129539771346588
    },
    "pension": {
      "streak": {
        "days": 5,
        "direction": "sell"
      },
      "net_5d": -7605.0,
      "net_20d": -49146.0,
      "net_60d": -92170.0,
      "net_cumulative": -89573.0,
      "cumulative_window_days": 100,
      "current_price": 115000.0,
      "interpretation": {
        "tone": "caution",
        "label": "비중 축소 가능성",
        "text": "연기금이 5일 연속 순매도 중입니다."
      }
    }
  },
  "323410": {
    "name": "카카오뱅크",
    "as_of": "20260710",
    "short": {
      "balance_qty": 5398612.0,
      "avg_price": 22673.0,
      "today_ratio_pct": 14.97,
      "avg_volume_20d": 938108.4,
      "days_to_cover": 5.75478484149593,
      "balance_change_pct": 3.8175249423231916,
      "short_squeeze_index": 5.50084376495479,
      "pressure": {
        "score": 53,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 19822263.0,
      "balance_change_pct": -0.2636321961549126
    },
    "pension": {
      "streak": {
        "days": 3,
        "direction": "sell"
      },
      "net_5d": -4744.0,
      "net_20d": -8100.0,
      "net_60d": 5282.0,
      "net_cumulative": 26290.0,
      "cumulative_window_days": 100,
      "current_price": 22900.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "039490": {
    "name": "키움증권",
    "as_of": "20260710",
    "short": {
      "balance_qty": 389943.0,
      "avg_price": 337709.0,
      "today_ratio_pct": 3.03,
      "avg_volume_20d": 137126.9,
      "days_to_cover": 2.8436652473001285,
      "balance_change_pct": 0.7852056706426642,
      "short_squeeze_index": 160.00658327847268,
      "pressure": {
        "score": 26,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 0,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 468858.0,
      "balance_change_pct": -5.214958334512609
    },
    "pension": {
      "streak": {
        "days": 7,
        "direction": "sell"
      },
      "net_5d": -12688.0,
      "net_20d": -49917.0,
      "net_60d": -67900.0,
      "net_cumulative": -109325.0,
      "cumulative_window_days": 100,
      "current_price": 336000.0,
      "interpretation": {
        "tone": "caution",
        "label": "비중 축소 가능성",
        "text": "연기금이 7일 연속 순매도 중입니다."
      }
    }
  },
  "006800": {
    "name": "미래에셋증권",
    "as_of": "20260710",
    "short": {
      "balance_qty": 7969593.0,
      "avg_price": 42495.0,
      "today_ratio_pct": 12.65,
      "avg_volume_20d": 3052051.65,
      "days_to_cover": 2.611224813315332,
      "balance_change_pct": 2.7610877397569555,
      "short_squeeze_index": 7.9879515259065546,
      "pressure": {
        "score": 53,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 29496415.0,
      "balance_change_pct": -0.14880313626382227
    },
    "pension": {
      "streak": {
        "days": 4,
        "direction": "sell"
      },
      "net_5d": -4516.0,
      "net_20d": -175201.0,
      "net_60d": -394548.0,
      "net_cumulative": -503858.0,
      "cumulative_window_days": 100,
      "current_price": 42200.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "005940": {
    "name": "NH투자증권",
    "as_of": "20260710",
    "short": {
      "balance_qty": 2747052.0,
      "avg_price": 31721.0,
      "today_ratio_pct": 12.1,
      "avg_volume_20d": 793115.75,
      "days_to_cover": 3.463620537103191,
      "balance_change_pct": 4.124534679788056,
      "short_squeeze_index": 9.78082065891651,
      "pressure": {
        "score": 43,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 6344790.0,
      "balance_change_pct": -1.2334013696088308
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": 9010.0,
      "net_20d": 3120.0,
      "net_60d": -77721.0,
      "net_cumulative": -66509.0,
      "cumulative_window_days": 100,
      "current_price": 31600.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "016360": {
    "name": "삼성증권",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1089668.0,
      "avg_price": 113968.0,
      "today_ratio_pct": 3.79,
      "avg_volume_20d": 541322.75,
      "days_to_cover": 2.0129728521478176,
      "balance_change_pct": 2.1747345226095316,
      "short_squeeze_index": 101.33229853835208,
      "pressure": {
        "score": 22,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 0,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1933903.0,
      "balance_change_pct": -4.659354549909437
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": 3610.0,
      "net_20d": 7922.0,
      "net_60d": -14519.0,
      "net_cumulative": 17368.0,
      "cumulative_window_days": 100,
      "current_price": 112000.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "071050": {
    "name": "한국금융지주",
    "as_of": "20260710",
    "short": {
      "balance_qty": 789534.0,
      "avg_price": 240991.0,
      "today_ratio_pct": 13.11,
      "avg_volume_20d": 268149.9,
      "days_to_cover": 2.9443755153367572,
      "balance_change_pct": 3.4510138942028,
      "short_squeeze_index": 39.43731490621915,
      "pressure": {
        "score": 60,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1568530.0,
      "balance_change_pct": 1.115961060301608
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "sell"
      },
      "net_5d": -2071.0,
      "net_20d": -9395.0,
      "net_60d": 12045.0,
      "net_cumulative": -60030.0,
      "cumulative_window_days": 100,
      "current_price": 239000.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "003540": {
    "name": "대신증권",
    "as_of": "20260710",
    "short": {
      "balance_qty": 237674.0,
      "avg_price": 27883.0,
      "today_ratio_pct": 13.08,
      "avg_volume_20d": 113802.7,
      "days_to_cover": 2.0884741750415414,
      "balance_change_pct": 4.701280164932467,
      "short_squeeze_index": 9.145427286356822,
      "pressure": {
        "score": 53,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1008685.0,
      "balance_change_pct": -0.16242282194064095
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": 86.0,
      "net_20d": 1956.0,
      "net_60d": -621.0,
      "net_cumulative": -839.0,
      "cumulative_window_days": 100,
      "current_price": 27750.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "000810": {
    "name": "삼성화재",
    "as_of": "20260710",
    "short": {
      "balance_qty": 400542.0,
      "avg_price": 656443.0,
      "today_ratio_pct": 28.12,
      "avg_volume_20d": 148564.55,
      "days_to_cover": 2.6960805925774354,
      "balance_change_pct": 7.74672893173797,
      "short_squeeze_index": 16.730328495034378,
      "pressure": {
        "score": 90,
        "grade": {
          "emoji": "🔴",
          "label": "매우 강함"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 30,
          "balance_increase": 20,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 951763.0,
      "balance_change_pct": 6.80214016558454
    },
    "pension": {
      "streak": {
        "days": 3,
        "direction": "buy"
      },
      "net_5d": 25057.0,
      "net_20d": 5853.0,
      "net_60d": -46638.0,
      "net_cumulative": -55988.0,
      "cumulative_window_days": 100,
      "current_price": 648000.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(3일)."
      }
    }
  },
  "005830": {
    "name": "DB손해보험",
    "as_of": "20260710",
    "short": {
      "balance_qty": 955360.0,
      "avg_price": 158624.0,
      "today_ratio_pct": 15.14,
      "avg_volume_20d": 225854.6,
      "days_to_cover": 4.229978047823688,
      "balance_change_pct": 5.622295485049297,
      "short_squeeze_index": 12.303850237936052,
      "pressure": {
        "score": 82,
        "grade": {
          "emoji": "🔴",
          "label": "매우 강함"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 22,
          "balance_increase": 20,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1485226.0,
      "balance_change_pct": 2.838606039204282
    },
    "pension": {
      "streak": {
        "days": 7,
        "direction": "buy"
      },
      "net_5d": 34013.0,
      "net_20d": 28515.0,
      "net_60d": -43102.0,
      "net_cumulative": -508.0,
      "cumulative_window_days": 100,
      "current_price": 155800.0,
      "interpretation": {
        "tone": "very_positive",
        "label": "매우 긍정",
        "text": "연기금이 7일 연속 순매수 중이고 외국인도 최근 5일 순매수를 동반하고 있습니다."
      }
    }
  },
  "001450": {
    "name": "현대해상",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1140279.0,
      "avg_price": 38097.0,
      "today_ratio_pct": 8.69,
      "avg_volume_20d": 479954.5,
      "days_to_cover": 2.3758064566537036,
      "balance_change_pct": 3.783153562395275,
      "short_squeeze_index": 10.527835249963912,
      "pressure": {
        "score": 34,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 2158280.0,
      "balance_change_pct": -0.20082094752529683
    },
    "pension": {
      "streak": {
        "days": 7,
        "direction": "buy"
      },
      "net_5d": 15246.0,
      "net_20d": 23264.0,
      "net_60d": 60422.0,
      "net_cumulative": 18509.0,
      "cumulative_window_days": 100,
      "current_price": 38150.0,
      "interpretation": {
        "tone": "very_positive",
        "label": "매우 긍정",
        "text": "연기금이 7일 연속 순매수 중이고 외국인도 최근 5일 순매수를 동반하고 있습니다."
      }
    }
  },
  "000370": {
    "name": "한화손해보험",
    "as_of": "20260710",
    "short": {
      "balance_qty": 851999.0,
      "avg_price": 6081.0,
      "today_ratio_pct": 2.82,
      "avg_volume_20d": 513843.5,
      "days_to_cover": 1.65809044971864,
      "balance_change_pct": 2.368167787871761,
      "short_squeeze_index": 12.054794520547945,
      "pressure": {
        "score": 34,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1481184.0,
      "balance_change_pct": 0.0
    },
    "pension": {
      "streak": {
        "days": 3,
        "direction": "buy"
      },
      "net_5d": 1044.0,
      "net_20d": 3298.0,
      "net_60d": 8425.0,
      "net_cumulative": 9323.0,
      "cumulative_window_days": 100,
      "current_price": 6150.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(3일)."
      }
    }
  },
  "032830": {
    "name": "삼성생명",
    "as_of": "20260710",
    "short": {
      "balance_qty": 826952.0,
      "avg_price": 338029.0,
      "today_ratio_pct": 2.91,
      "avg_volume_20d": 522705.2,
      "days_to_cover": 1.5820619347196085,
      "balance_change_pct": 2.956145855120965,
      "short_squeeze_index": 12.651617250673855,
      "pressure": {
        "score": 37,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 2141317.0,
      "balance_change_pct": -2.844981967050223
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -15469.0,
      "net_20d": 55899.0,
      "net_60d": 225180.0,
      "net_cumulative": 186191.0,
      "cumulative_window_days": 100,
      "current_price": 340500.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "088350": {
    "name": "한화생명",
    "as_of": "20260710",
    "short": {
      "balance_qty": 5874823.0,
      "avg_price": 4666.0,
      "today_ratio_pct": 2.44,
      "avg_volume_20d": 5662910.4,
      "days_to_cover": 1.0374211465538992,
      "balance_change_pct": 2.0189950331315583,
      "short_squeeze_index": 8.383434395561864,
      "pressure": {
        "score": 27,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 18354812.0,
      "balance_change_pct": -0.08576762569344618
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": 1022.0,
      "net_20d": 4755.0,
      "net_60d": 20331.0,
      "net_cumulative": 13603.0,
      "cumulative_window_days": 100,
      "current_price": 4650.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "082640": {
    "name": "동양생명",
    "as_of": "20260710",
    "short": {
      "balance_qty": 106758.0,
      "avg_price": 7747.0,
      "today_ratio_pct": 1.51,
      "avg_volume_20d": 127905.5,
      "days_to_cover": 0.8346630911102337,
      "balance_change_pct": 2.2850737259636116,
      "short_squeeze_index": 28.259958071278824,
      "pressure": {
        "score": 26,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 0,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 2165953.0,
      "balance_change_pct": 0.007387594289943684
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": -257.0,
      "net_20d": -132.0,
      "net_60d": -12310.0,
      "net_cumulative": -12726.0,
      "cumulative_window_days": 100,
      "current_price": 7770.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "085620": {
    "name": "미래에셋생명",
    "as_of": "20260710",
    "short": {
      "balance_qty": 414717.0,
      "avg_price": 17950.0,
      "today_ratio_pct": 3.78,
      "avg_volume_20d": 1543645.15,
      "days_to_cover": 0.2686608382762062,
      "balance_change_pct": 2.444284154517294,
      "short_squeeze_index": 11.01566447700859,
      "pressure": {
        "score": 27,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1201047.0,
      "balance_change_pct": -0.016649365201328287
    },
    "pension": {
      "streak": {
        "days": 4,
        "direction": "buy"
      },
      "net_5d": 2397.0,
      "net_20d": 25551.0,
      "net_60d": 45384.0,
      "net_cumulative": 34071.0,
      "cumulative_window_days": 100,
      "current_price": 18320.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(4일)."
      }
    }
  },
  "278470": {
    "name": "에이피알",
    "as_of": "20260710",
    "short": {
      "balance_qty": 975877.0,
      "avg_price": 374609.0,
      "today_ratio_pct": 2.8,
      "avg_volume_20d": 293144.15,
      "days_to_cover": 3.329000425217423,
      "balance_change_pct": 0.5111678274285879,
      "short_squeeze_index": 53.49586943381019,
      "pressure": {
        "score": 38,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 12,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 4256687.0,
      "balance_change_pct": 0.35536001154277597
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "sell"
      },
      "net_5d": 2629.0,
      "net_20d": 28289.0,
      "net_60d": -5269.0,
      "net_cumulative": 48406.0,
      "cumulative_window_days": 100,
      "current_price": 375000.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "051900": {
    "name": "LG생활건강",
    "as_of": "20260710",
    "short": {
      "balance_qty": 187019.0,
      "avg_price": 247494.0,
      "today_ratio_pct": 21.42,
      "avg_volume_20d": 56146.0,
      "days_to_cover": 3.3309407615858655,
      "balance_change_pct": 4.408144124428466,
      "short_squeeze_index": 0.8358662613981762,
      "pressure": {
        "score": 84,
        "grade": {
          "emoji": "🔴",
          "label": "매우 강함"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 30,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 937262.0,
      "balance_change_pct": 7.449672123630028
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "sell"
      },
      "net_5d": 9214.0,
      "net_20d": 9874.0,
      "net_60d": 20914.0,
      "net_cumulative": 8932.0,
      "cumulative_window_days": 100,
      "current_price": 245000.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "090430": {
    "name": "아모레퍼시픽",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1864616.0,
      "avg_price": 124594.0,
      "today_ratio_pct": 29.16,
      "avg_volume_20d": 362438.4,
      "days_to_cover": 5.144642510285886,
      "balance_change_pct": 6.7816595511956,
      "short_squeeze_index": 11.134849393266396,
      "pressure": {
        "score": 82,
        "grade": {
          "emoji": "🔴",
          "label": "매우 강함"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 22,
          "balance_increase": 20,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 3973519.0,
      "balance_change_pct": 4.730827115231033
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "sell"
      },
      "net_5d": 8360.0,
      "net_20d": 52192.0,
      "net_60d": 22528.0,
      "net_cumulative": 30787.0,
      "cumulative_window_days": 100,
      "current_price": 123100.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "483650": {
    "name": "달바글로벌",
    "as_of": "20260710",
    "short": {
      "balance_qty": 139471.0,
      "avg_price": 198099.0,
      "today_ratio_pct": 6.17,
      "avg_volume_20d": 173849.0,
      "days_to_cover": 0.8022536799176296,
      "balance_change_pct": 7.228471042292937,
      "short_squeeze_index": -37.96000850882791,
      "pressure": {
        "score": 57,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 12,
          "balance_increase": 20,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1347262.0,
      "balance_change_pct": 0.044480319129581794
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": 1221.0,
      "net_20d": 10057.0,
      "net_60d": 53143.0,
      "net_cumulative": 65151.0,
      "cumulative_window_days": 100,
      "current_price": 197900.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "257720": {
    "name": "실리콘투",
    "as_of": "20260710",
    "short": {
      "balance_qty": 887620.0,
      "avg_price": 37423.0,
      "today_ratio_pct": 6.75,
      "avg_volume_20d": 582887.45,
      "days_to_cover": 1.5227982692027424,
      "balance_change_pct": 5.502504379990634,
      "short_squeeze_index": 10.81781656370156,
      "pressure": {
        "score": 57,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 12,
          "balance_increase": 20,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 6857114.0,
      "balance_change_pct": 0.9764081093148268
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": 8988.0,
      "net_20d": 5237.0,
      "net_60d": -3852.0,
      "net_cumulative": -12308.0,
      "cumulative_window_days": 100,
      "current_price": 37600.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "192820": {
    "name": "코스맥스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 268139.0,
      "avg_price": 176804.0,
      "today_ratio_pct": 5.55,
      "avg_volume_20d": 88344.25,
      "days_to_cover": 3.0351607490017742,
      "balance_change_pct": 3.2133522716337364,
      "short_squeeze_index": 5.390512697652132,
      "pressure": {
        "score": 44,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1071454.0,
      "balance_change_pct": -0.20760317523887406
    },
    "pension": {
      "streak": {
        "days": 8,
        "direction": "buy"
      },
      "net_5d": 12995.0,
      "net_20d": 10328.0,
      "net_60d": 33468.0,
      "net_cumulative": 30270.0,
      "cumulative_window_days": 100,
      "current_price": 172700.0,
      "interpretation": {
        "tone": "very_positive",
        "label": "매우 긍정",
        "text": "연기금이 8일 연속 순매수 중이고 외국인도 최근 5일 순매수를 동반하고 있습니다."
      }
    }
  },
  "161890": {
    "name": "한국콜마",
    "as_of": "20260710",
    "short": {
      "balance_qty": 696262.0,
      "avg_price": 105301.0,
      "today_ratio_pct": 7.23,
      "avg_volume_20d": 415171.65,
      "days_to_cover": 1.6770461085192112,
      "balance_change_pct": 3.4912169614164634,
      "short_squeeze_index": 20.92132152588556,
      "pressure": {
        "score": 34,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1383485.0,
      "balance_change_pct": -0.306972822816872
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": -2679.0,
      "net_20d": 5353.0,
      "net_60d": 39101.0,
      "net_cumulative": 91933.0,
      "cumulative_window_days": 100,
      "current_price": 106500.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "018290": {
    "name": "브이티",
    "as_of": "20260710",
    "short": {
      "balance_qty": 288747.0,
      "avg_price": 12217.0,
      "today_ratio_pct": 8.43,
      "avg_volume_20d": 164397.95,
      "days_to_cover": 1.7563905146019156,
      "balance_change_pct": 5.570911484040804,
      "short_squeeze_index": 4.981295530616263,
      "pressure": {
        "score": 47,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 12,
          "balance_increase": 20,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 2061724.0,
      "balance_change_pct": 0.47936339605280603
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": 0.0,
      "net_20d": 36.0,
      "net_60d": -111.0,
      "net_cumulative": -699.0,
      "cumulative_window_days": 100,
      "current_price": 12230.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "251970": {
    "name": "펌텍코리아",
    "as_of": "20260710",
    "short": {
      "balance_qty": 108621.0,
      "avg_price": 44182.0,
      "today_ratio_pct": 6.91,
      "avg_volume_20d": 65706.1,
      "days_to_cover": 1.653134183888558,
      "balance_change_pct": 5.319241770494982,
      "short_squeeze_index": -6.252278527160043,
      "pressure": {
        "score": 67,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 12,
          "balance_increase": 20,
          "foreign_sell": 10,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 424257.0,
      "balance_change_pct": 0.0233403590171587
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": 2454.0,
      "net_20d": 3984.0,
      "net_60d": 3101.0,
      "net_cumulative": 1010.0,
      "cumulative_window_days": 100,
      "current_price": 43700.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "003490": {
    "name": "대한항공",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1261795.0,
      "avg_price": 27298.0,
      "today_ratio_pct": 0.03,
      "avg_volume_20d": 3638291.25,
      "days_to_cover": 0.3468097833014331,
      "balance_change_pct": 0.09725766697419976,
      "short_squeeze_index": 53.752039151712886,
      "pressure": {
        "score": 23,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 0,
          "loan_increase": 5,
          "balance_increase": 8,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 6725065.0,
      "balance_change_pct": -2.066386552541495
    },
    "pension": {
      "streak": {
        "days": 14,
        "direction": "buy"
      },
      "net_5d": 49689.0,
      "net_20d": 176343.0,
      "net_60d": 205067.0,
      "net_cumulative": 195597.0,
      "cumulative_window_days": 100,
      "current_price": 26750.0,
      "interpretation": {
        "tone": "very_positive",
        "label": "매우 긍정",
        "text": "연기금이 14일 연속 순매수 중이고 외국인도 최근 5일 순매수를 동반하고 있습니다."
      }
    }
  },
  "272450": {
    "name": "진에어",
    "as_of": "20260710",
    "short": {
      "balance_qty": 65376.0,
      "avg_price": 5420.0,
      "today_ratio_pct": 0.53,
      "avg_volume_20d": 278406.45,
      "days_to_cover": 0.23482214582313016,
      "balance_change_pct": 0.7846825042009034,
      "short_squeeze_index": 34.9705304518664,
      "pressure": {
        "score": 30,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 0,
          "loan_increase": 12,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 116683.0,
      "balance_change_pct": 0.0
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": -126.0,
      "net_20d": 5.0,
      "net_60d": -1265.0,
      "net_cumulative": 25.0,
      "cumulative_window_days": 100,
      "current_price": 5420.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "089590": {
    "name": "제주항공",
    "as_of": "20260710",
    "short": {
      "balance_qty": 321160.0,
      "avg_price": 4435.0,
      "today_ratio_pct": 0.77,
      "avg_volume_20d": 618005.85,
      "days_to_cover": 0.5196714561844358,
      "balance_change_pct": 0.2948010093187099,
      "short_squeeze_index": 17.902542372881356,
      "pressure": {
        "score": 30,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 0,
          "loan_increase": 12,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 726514.0,
      "balance_change_pct": 0.0
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": 48.0,
      "net_20d": 175.0,
      "net_60d": -1451.0,
      "net_cumulative": -7798.0,
      "cumulative_window_days": 100,
      "current_price": 4435.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "020560": {
    "name": "아시아나항공",
    "as_of": "20260710",
    "short": {
      "balance_qty": 56679.0,
      "avg_price": 7165.0,
      "today_ratio_pct": 3.61,
      "avg_volume_20d": 224993.05,
      "days_to_cover": 0.2519144480240612,
      "balance_change_pct": 3.705126797672632,
      "short_squeeze_index": -3.802469135802469,
      "pressure": {
        "score": 44,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1173820.0,
      "balance_change_pct": 0.0
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": 82.0,
      "net_20d": 787.0,
      "net_60d": 529.0,
      "net_cumulative": -1458.0,
      "cumulative_window_days": 100,
      "current_price": 7160.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "011200": {
    "name": "HMM",
    "as_of": "20260710",
    "short": {
      "balance_qty": 4462814.0,
      "avg_price": 19899.0,
      "today_ratio_pct": 13.9,
      "avg_volume_20d": 1529181.65,
      "days_to_cover": 2.9184328755187456,
      "balance_change_pct": 3.7004936144741527,
      "short_squeeze_index": 2.943115671290337,
      "pressure": {
        "score": 60,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 19328594.0,
      "balance_change_pct": 0.8800006430067329
    },
    "pension": {
      "streak": {
        "days": 3,
        "direction": "buy"
      },
      "net_5d": 11880.0,
      "net_20d": 10100.0,
      "net_60d": -28182.0,
      "net_cumulative": -22448.0,
      "cumulative_window_days": 100,
      "current_price": 19740.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(3일)."
      }
    }
  },
  "028670": {
    "name": "팬오션",
    "as_of": "20260710",
    "short": {
      "balance_qty": 8949974.0,
      "avg_price": 5287.0,
      "today_ratio_pct": 10.08,
      "avg_volume_20d": 2305054.7,
      "days_to_cover": 3.8827599188860895,
      "balance_change_pct": 2.7195864210509884,
      "short_squeeze_index": 1.342009976451523,
      "pressure": {
        "score": 60,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 22,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 14854027.0,
      "balance_change_pct": 2.5518547326000114
    },
    "pension": {
      "streak": {
        "days": 4,
        "direction": "buy"
      },
      "net_5d": 655.0,
      "net_20d": -859.0,
      "net_60d": -943.0,
      "net_cumulative": 38565.0,
      "cumulative_window_days": 100,
      "current_price": 5250.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(4일)."
      }
    }
  },
  "005880": {
    "name": "대한해운",
    "as_of": "20260710",
    "short": {
      "balance_qty": 6000993.0,
      "avg_price": 1928.0,
      "today_ratio_pct": 2.85,
      "avg_volume_20d": 3062559.55,
      "days_to_cover": 1.9594698166767077,
      "balance_change_pct": 1.60192957544024,
      "short_squeeze_index": 2.4488458611651307,
      "pressure": {
        "score": 31,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 5,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 11896514.0,
      "balance_change_pct": -0.014287858665174452
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": 556.0,
      "net_20d": -1874.0,
      "net_60d": 3380.0,
      "net_cumulative": 1705.0,
      "cumulative_window_days": 100,
      "current_price": 1929.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "003280": {
    "name": "흥아해운",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1637345.0,
      "avg_price": 1720.0,
      "today_ratio_pct": 0.49,
      "avg_volume_20d": 8536036.05,
      "days_to_cover": 0.1918156144619375,
      "balance_change_pct": 3.9403963630431043,
      "short_squeeze_index": 5.889934269880139,
      "pressure": {
        "score": 29,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 0,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 4813009.0,
      "balance_change_pct": -0.06229224239406529
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": 0.0,
      "net_20d": -1.0,
      "net_60d": -13.0,
      "net_cumulative": 673.0,
      "cumulative_window_days": 100,
      "current_price": 1732.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "044450": {
    "name": "KSS해운",
    "as_of": "20260710",
    "short": {
      "balance_qty": 53002.0,
      "avg_price": 9529.0,
      "today_ratio_pct": 7.07,
      "avg_volume_20d": 59662.75,
      "days_to_cover": 0.8883599901110827,
      "balance_change_pct": 3.7099362110124052,
      "short_squeeze_index": -1.9514767932489452,
      "pressure": {
        "score": 54,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 826524.0,
      "balance_change_pct": -1.489826274337802
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": 305.0,
      "net_20d": 194.0,
      "net_60d": -123.0,
      "net_cumulative": 1718.0,
      "cumulative_window_days": 100,
      "current_price": 9510.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "465770": {
    "name": "STX그린로지스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 25062.0,
      "avg_price": 1980.0,
      "today_ratio_pct": 0.05,
      "avg_volume_20d": 100670.1,
      "days_to_cover": 0.2489517741613448,
      "balance_change_pct": 0.0878594249201278,
      "short_squeeze_index": 186.36363636363635,
      "pressure": {
        "score": 13,
        "grade": {
          "emoji": "🟢",
          "label": "매우 약함"
        },
        "breakdown": {
          "short_ratio": 0,
          "loan_increase": 5,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 277745.0,
      "balance_change_pct": -0.07519229800614491
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": 0.0,
      "net_20d": -18.0,
      "net_60d": -18.0,
      "net_cumulative": -18.0,
      "cumulative_window_days": 100,
      "current_price": 1954.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "124560": {
    "name": "태웅로직스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 49948.0,
      "avg_price": 1874.0,
      "today_ratio_pct": 4.59,
      "avg_volume_20d": 65362.6,
      "days_to_cover": 0.7641678880583086,
      "balance_change_pct": 1.9055779981229852,
      "short_squeeze_index": 0.32119914346895073,
      "pressure": {
        "score": 28,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 12,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1194387.0,
      "balance_change_pct": 0.0
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": 0.0,
      "net_20d": -11.0,
      "net_60d": -1.0,
      "net_cumulative": -1.0,
      "cumulative_window_days": 100,
      "current_price": 1887.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "004360": {
    "name": "세방",
    "as_of": "20260710",
    "short": {
      "balance_qty": 54383.0,
      "avg_price": 12831.0,
      "today_ratio_pct": 5.82,
      "avg_volume_20d": 31715.15,
      "days_to_cover": 1.71473254895531,
      "balance_change_pct": 1.7284273929553489,
      "short_squeeze_index": 7.142857142857142,
      "pressure": {
        "score": 35,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 12,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 247191.0,
      "balance_change_pct": 0.0
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": 48.0,
      "net_20d": 389.0,
      "net_60d": 560.0,
      "net_cumulative": 736.0,
      "cumulative_window_days": 100,
      "current_price": 12950.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "000120": {
    "name": "CJ대한통운",
    "as_of": "20260710",
    "short": {
      "balance_qty": 192500.0,
      "avg_price": 74562.0,
      "today_ratio_pct": 7.43,
      "avg_volume_20d": 54502.6,
      "days_to_cover": 3.5319415954468227,
      "balance_change_pct": 2.2304832713754648,
      "short_squeeze_index": 30.928571428571427,
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
      "balance_qty": 569651.0,
      "balance_change_pct": 0.6230083868551766
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": 292.0,
      "net_20d": -2882.0,
      "net_60d": -36192.0,
      "net_cumulative": -70169.0,
      "cumulative_window_days": 100,
      "current_price": 73900.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "002320": {
    "name": "한진",
    "as_of": "20260710",
    "short": {
      "balance_qty": 74875.0,
      "avg_price": 15874.0,
      "today_ratio_pct": 11.12,
      "avg_volume_20d": 28675.5,
      "days_to_cover": 2.6111140171923766,
      "balance_change_pct": 6.046228365861258,
      "short_squeeze_index": 2.3424689622862496,
      "pressure": {
        "score": 66,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 12,
          "balance_increase": 20,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 387101.0,
      "balance_change_pct": 1.5949126564205929
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": 0.0,
      "net_20d": -5.0,
      "net_60d": -198.0,
      "net_cumulative": -307.0,
      "cumulative_window_days": 100,
      "current_price": 15820.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "018260": {
    "name": "삼성에스디에스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 936072.0,
      "avg_price": 200648.0,
      "today_ratio_pct": 11.18,
      "avg_volume_20d": 395530.1,
      "days_to_cover": 2.366626459022967,
      "balance_change_pct": 3.247069100727637,
      "short_squeeze_index": 55.86466931621319,
      "pressure": {
        "score": 43,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 2642681.0,
      "balance_change_pct": -0.644777807311818
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": 20385.0,
      "net_20d": 10231.0,
      "net_60d": 62592.0,
      "net_cumulative": -100112.0,
      "cumulative_window_days": 100,
      "current_price": 199600.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "064400": {
    "name": "LG씨엔에스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1688476.0,
      "avg_price": 72157.0,
      "today_ratio_pct": 4.09,
      "avg_volume_20d": 1286414.85,
      "days_to_cover": 1.3125439278005846,
      "balance_change_pct": 2.338081095823989,
      "short_squeeze_index": 39.776026545002075,
      "pressure": {
        "score": 44,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 22,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 2779303.0,
      "balance_change_pct": 2.0881903195390334
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": 1367.0,
      "net_20d": -2538.0,
      "net_60d": 73430.0,
      "net_cumulative": 67121.0,
      "cumulative_window_days": 100,
      "current_price": 71100.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "307950": {
    "name": "현대오토에버",
    "as_of": "20260710",
    "short": {
      "balance_qty": 170746.0,
      "avg_price": 456869.0,
      "today_ratio_pct": 5.76,
      "avg_volume_20d": 103232.45,
      "days_to_cover": 1.6539954248882014,
      "balance_change_pct": 2.0854009972617154,
      "short_squeeze_index": 46.98967889908257,
      "pressure": {
        "score": 59,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 30,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1122267.0,
      "balance_change_pct": 8.742798230297721
    },
    "pension": {
      "streak": {
        "days": 5,
        "direction": "sell"
      },
      "net_5d": -8360.0,
      "net_20d": -29591.0,
      "net_60d": -22713.0,
      "net_cumulative": -27757.0,
      "cumulative_window_days": 100,
      "current_price": 452000.0,
      "interpretation": {
        "tone": "caution",
        "label": "비중 축소 가능성",
        "text": "연기금이 5일 연속 순매도 중입니다."
      }
    }
  },
  "286940": {
    "name": "롯데이노베이트",
    "as_of": "20260710",
    "short": {
      "balance_qty": 38589.0,
      "avg_price": 17263.0,
      "today_ratio_pct": 6.69,
      "avg_volume_20d": 23923.0,
      "days_to_cover": 1.6130502027337708,
      "balance_change_pct": 4.002263906856403,
      "short_squeeze_index": 11.851851851851853,
      "pressure": {
        "score": 51,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 181193.0,
      "balance_change_pct": 0.0
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": 0.0,
      "net_20d": -116.0,
      "net_60d": -474.0,
      "net_cumulative": 358.0,
      "cumulative_window_days": 100,
      "current_price": 17220.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "035510": {
    "name": "신세계I&C",
    "as_of": "20260710",
    "short": {
      "balance_qty": 64368.0,
      "avg_price": 12958.0,
      "today_ratio_pct": 2.53,
      "avg_volume_20d": 82299.8,
      "days_to_cover": 0.7821161169285952,
      "balance_change_pct": 2.195760895451298,
      "short_squeeze_index": 15.328994938539406,
      "pressure": {
        "score": 27,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 628001.0,
      "balance_change_pct": -1.982203867326569
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": 48.0,
      "net_20d": -80.0,
      "net_60d": -1410.0,
      "net_cumulative": -168.0,
      "cumulative_window_days": 100,
      "current_price": 13040.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "017670": {
    "name": "SK텔레콤",
    "as_of": "20260710",
    "short": {
      "balance_qty": 573740.0,
      "avg_price": 88940.0,
      "today_ratio_pct": 2.67,
      "avg_volume_20d": 1088197.3,
      "days_to_cover": 0.527238948304687,
      "balance_change_pct": 3.176173126791565,
      "short_squeeze_index": 49.06579096365078,
      "pressure": {
        "score": 37,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1797527.0,
      "balance_change_pct": -2.850241911424532
    },
    "pension": {
      "streak": {
        "days": 3,
        "direction": "buy"
      },
      "net_5d": -3805.0,
      "net_20d": -65885.0,
      "net_60d": -50444.0,
      "net_cumulative": 12663.0,
      "cumulative_window_days": 100,
      "current_price": 88700.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(3일)."
      }
    }
  },
  "030200": {
    "name": "KT",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1639622.0,
      "avg_price": 55433.0,
      "today_ratio_pct": 42.15,
      "avg_volume_20d": 377175.45,
      "days_to_cover": 4.347106896803596,
      "balance_change_pct": 16.58622258881083,
      "short_squeeze_index": -6.72891426807624,
      "pressure": {
        "score": 100,
        "grade": {
          "emoji": "🔴",
          "label": "매우 강함"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 30,
          "balance_increase": 20,
          "foreign_sell": 10,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 4095098.0,
      "balance_change_pct": 7.478712113020282
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -3302.0,
      "net_20d": -15046.0,
      "net_60d": -40597.0,
      "net_cumulative": -51136.0,
      "cumulative_window_days": 100,
      "current_price": 54200.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "032640": {
    "name": "LG유플러스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1839882.0,
      "avg_price": 14907.0,
      "today_ratio_pct": 2.46,
      "avg_volume_20d": 1105981.0,
      "days_to_cover": 1.6635746907044515,
      "balance_change_pct": 1.4350115472422518,
      "short_squeeze_index": -10.907065196511583,
      "pressure": {
        "score": 41,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 5,
          "balance_increase": 8,
          "foreign_sell": 10,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 7881898.0,
      "balance_change_pct": -1.6611152262927795
    },
    "pension": {
      "streak": {
        "days": 4,
        "direction": "buy"
      },
      "net_5d": 8315.0,
      "net_20d": 1313.0,
      "net_60d": -24931.0,
      "net_cumulative": -18281.0,
      "cumulative_window_days": 100,
      "current_price": 14960.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(4일)."
      }
    }
  },
  "178320": {
    "name": "서진시스템",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1813842.0,
      "avg_price": 46913.0,
      "today_ratio_pct": 5.02,
      "avg_volume_20d": 1426393.65,
      "days_to_cover": 1.271627926834924,
      "balance_change_pct": 3.2357611597106413,
      "short_squeeze_index": 4.161682966298459,
      "pressure": {
        "score": 51,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 3982434.0,
      "balance_change_pct": 0.48014282672167663
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": -700.0,
      "net_20d": -10812.0,
      "net_60d": -36127.0,
      "net_cumulative": 3509.0,
      "cumulative_window_days": 100,
      "current_price": 47350.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "218410": {
    "name": "RFHIC",
    "as_of": "20260710",
    "short": {
      "balance_qty": 598144.0,
      "avg_price": 52330.0,
      "today_ratio_pct": 8.0,
      "avg_volume_20d": 296151.85,
      "days_to_cover": 2.0197206264286383,
      "balance_change_pct": 10.77745943613402,
      "short_squeeze_index": -3.4093447665526777,
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
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1598582.0,
      "balance_change_pct": -2.8953145520171346
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": -1718.0,
      "net_20d": -3110.0,
      "net_60d": -34059.0,
      "net_cumulative": -34407.0,
      "cumulative_window_days": 100,
      "current_price": 52100.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "032500": {
    "name": "케이엠더블유",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1074257.0,
      "avg_price": 17262.0,
      "today_ratio_pct": 14.54,
      "avg_volume_20d": 277002.65,
      "days_to_cover": 3.8781470141170127,
      "balance_change_pct": 4.205540390842195,
      "short_squeeze_index": 0.6250720793449429,
      "pressure": {
        "score": 53,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 3957559.0,
      "balance_change_pct": -2.290913696572814
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -780.0,
      "net_20d": -2431.0,
      "net_60d": -5091.0,
      "net_cumulative": -2731.0,
      "cumulative_window_days": 100,
      "current_price": 17560.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "034220": {
    "name": "LG디스플레이",
    "as_of": "20260710",
    "short": {
      "balance_qty": 18486130.0,
      "avg_price": 11087.0,
      "today_ratio_pct": 24.86,
      "avg_volume_20d": 4976179.05,
      "days_to_cover": 3.7149246066618122,
      "balance_change_pct": 5.374782964586889,
      "short_squeeze_index": 0.7258380969551708,
      "pressure": {
        "score": 82,
        "grade": {
          "emoji": "🔴",
          "label": "매우 강함"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 22,
          "balance_increase": 20,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 43979904.0,
      "balance_change_pct": 2.602512101313833
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -3383.0,
      "net_20d": -14293.0,
      "net_60d": -43697.0,
      "net_cumulative": -33157.0,
      "cumulative_window_days": 100,
      "current_price": 11010.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "011070": {
    "name": "LG이노텍",
    "as_of": "20260710",
    "short": {
      "balance_qty": 505502.0,
      "avg_price": 738068.0,
      "today_ratio_pct": 6.22,
      "avg_volume_20d": 390854.75,
      "days_to_cover": 1.2933244382983704,
      "balance_change_pct": 5.790738167389375,
      "short_squeeze_index": -213.46946151066138,
      "pressure": {
        "score": 45,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 0,
          "balance_increase": 20,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 679509.0,
      "balance_change_pct": -9.463624045183648
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -26924.0,
      "net_20d": -165669.0,
      "net_60d": -204929.0,
      "net_cumulative": -102768.0,
      "cumulative_window_days": 100,
      "current_price": 742000.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "108320": {
    "name": "LX세미콘",
    "as_of": "20260710",
    "short": {
      "balance_qty": 464691.0,
      "avg_price": 40191.0,
      "today_ratio_pct": 11.76,
      "avg_volume_20d": 122237.0,
      "days_to_cover": 3.801557629850209,
      "balance_change_pct": 1.5041338561177795,
      "short_squeeze_index": 15.800174266627941,
      "pressure": {
        "score": 37,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 5,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1145973.0,
      "balance_change_pct": -0.15604253139147073
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": 27.0,
      "net_20d": 53.0,
      "net_60d": -1890.0,
      "net_cumulative": -2762.0,
      "cumulative_window_days": 100,
      "current_price": 40400.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "259960": {
    "name": "크래프톤",
    "as_of": "20260710",
    "short": {
      "balance_qty": 460753.0,
      "avg_price": 242382.0,
      "today_ratio_pct": 5.96,
      "avg_volume_20d": 128113.15,
      "days_to_cover": 3.596453603708909,
      "balance_change_pct": 1.315164522002234,
      "short_squeeze_index": 23.725129576993815,
      "pressure": {
        "score": 38,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 5,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1185811.0,
      "balance_change_pct": -1.081272267560247
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": 6176.0,
      "net_20d": -5865.0,
      "net_60d": -24826.0,
      "net_cumulative": 1932.0,
      "cumulative_window_days": 100,
      "current_price": 238000.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "462870": {
    "name": "시프트업",
    "as_of": "20260710",
    "short": {
      "balance_qty": 368516.0,
      "avg_price": 35465.0,
      "today_ratio_pct": 4.8,
      "avg_volume_20d": 138678.4,
      "days_to_cover": 2.657342455638369,
      "balance_change_pct": 1.038859201539782,
      "short_squeeze_index": 8.445500131960939,
      "pressure": {
        "score": 38,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 12,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1234743.0,
      "balance_change_pct": 0.4312529027419779
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": 1881.0,
      "net_20d": 4700.0,
      "net_60d": 1067.0,
      "net_cumulative": -159.0,
      "cumulative_window_days": 100,
      "current_price": 35150.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "251270": {
    "name": "넷마블",
    "as_of": "20260710",
    "short": {
      "balance_qty": 903749.0,
      "avg_price": 37989.0,
      "today_ratio_pct": 14.72,
      "avg_volume_20d": 203731.9,
      "days_to_cover": 4.435971980823818,
      "balance_change_pct": 2.8625117943453158,
      "short_squeeze_index": -1.6620278330019882,
      "pressure": {
        "score": 60,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 3020352.0,
      "balance_change_pct": 0.5777886853850531
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": 63.0,
      "net_20d": -7402.0,
      "net_60d": -39731.0,
      "net_cumulative": -9399.0,
      "cumulative_window_days": 100,
      "current_price": 37550.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "036570": {
    "name": "NC",
    "as_of": "20260710",
    "short": {
      "balance_qty": 385112.0,
      "avg_price": 251701.0,
      "today_ratio_pct": 9.49,
      "avg_volume_20d": 107969.7,
      "days_to_cover": 3.5668525521512056,
      "balance_change_pct": 1.9961597033701914,
      "short_squeeze_index": -9.59267613108664,
      "pressure": {
        "score": 38,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 5,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 548374.0,
      "balance_change_pct": -2.6630480122546714
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "sell"
      },
      "net_5d": -2524.0,
      "net_20d": 21117.0,
      "net_60d": 151325.0,
      "net_cumulative": 240143.0,
      "cumulative_window_days": 100,
      "current_price": 248500.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "263750": {
    "name": "펄어비스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 713423.0,
      "avg_price": 37508.0,
      "today_ratio_pct": 7.14,
      "avg_volume_20d": 337090.45,
      "days_to_cover": 2.1164141553105407,
      "balance_change_pct": 2.5609214371866957,
      "short_squeeze_index": 8.605591108117212,
      "pressure": {
        "score": 51,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 5345454.0,
      "balance_change_pct": 0.15682721126367882
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -156.0,
      "net_20d": -1262.0,
      "net_60d": -10726.0,
      "net_cumulative": -9073.0,
      "cumulative_window_days": 100,
      "current_price": 37050.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "293490": {
    "name": "카카오게임즈",
    "as_of": "20260710",
    "short": {
      "balance_qty": 2410199.0,
      "avg_price": 8502.0,
      "today_ratio_pct": 29.13,
      "avg_volume_20d": 811533.75,
      "days_to_cover": 2.9699307022043135,
      "balance_change_pct": 5.580729296715177,
      "short_squeeze_index": -0.23783919558545336,
      "pressure": {
        "score": 72,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 12,
          "balance_increase": 20,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 8068133.0,
      "balance_change_pct": 1.397408702991677
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": 0.0,
      "net_20d": 153.0,
      "net_60d": -203.0,
      "net_cumulative": 21.0,
      "cumulative_window_days": 100,
      "current_price": 8340.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "352820": {
    "name": "하이브",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1014202.0,
      "avg_price": 222931.0,
      "today_ratio_pct": 16.54,
      "avg_volume_20d": 305696.45,
      "days_to_cover": 3.317676734551546,
      "balance_change_pct": 3.1768897244484595,
      "short_squeeze_index": 25.403484052773152,
      "pressure": {
        "score": 49,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 2249927.0,
      "balance_change_pct": -0.9270447119745661
    },
    "pension": {
      "streak": {
        "days": 12,
        "direction": "buy"
      },
      "net_5d": 45295.0,
      "net_20d": 82220.0,
      "net_60d": -6509.0,
      "net_cumulative": -88427.0,
      "cumulative_window_days": 100,
      "current_price": 220500.0,
      "interpretation": {
        "tone": "very_positive",
        "label": "매우 긍정",
        "text": "연기금이 12일 연속 순매수 중이고 외국인도 최근 5일 순매수를 동반하고 있습니다."
      }
    }
  },
  "035900": {
    "name": "JYP Ent.",
    "as_of": "20260710",
    "short": {
      "balance_qty": 410644.0,
      "avg_price": 51006.0,
      "today_ratio_pct": 13.76,
      "avg_volume_20d": 207541.65,
      "days_to_cover": 1.9786100765798094,
      "balance_change_pct": 6.781150699749848,
      "short_squeeze_index": 3.343814709717003,
      "pressure": {
        "score": 66,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 12,
          "balance_increase": 20,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 2163154.0,
      "balance_change_pct": 0.6315190090710785
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "sell"
      },
      "net_5d": 1805.0,
      "net_20d": -1500.0,
      "net_60d": -9245.0,
      "net_cumulative": -30995.0,
      "cumulative_window_days": 100,
      "current_price": 50700.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "041510": {
    "name": "에스엠",
    "as_of": "20260710",
    "short": {
      "balance_qty": 448154.0,
      "avg_price": 77450.0,
      "today_ratio_pct": 32.26,
      "avg_volume_20d": 111762.0,
      "days_to_cover": 4.009896029061756,
      "balance_change_pct": 5.319138935890205,
      "short_squeeze_index": -0.9145533268534064,
      "pressure": {
        "score": 72,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 12,
          "balance_increase": 20,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1763013.0,
      "balance_change_pct": 0.921625747819153
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": 7589.0,
      "net_20d": 13287.0,
      "net_60d": 13719.0,
      "net_cumulative": -9927.0,
      "cumulative_window_days": 100,
      "current_price": 77500.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "122870": {
    "name": "와이지엔터테인먼트",
    "as_of": "20260710",
    "short": {
      "balance_qty": 408126.0,
      "avg_price": 42359.0,
      "today_ratio_pct": 24.49,
      "avg_volume_20d": 117326.25,
      "days_to_cover": 3.4785565889986256,
      "balance_change_pct": 5.627591347423016,
      "short_squeeze_index": 0.8186166298749081,
      "pressure": {
        "score": 62,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 12,
          "balance_increase": 20,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1382055.0,
      "balance_change_pct": 1.1751812954885863
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -275.0,
      "net_20d": -423.0,
      "net_60d": -6641.0,
      "net_cumulative": -28970.0,
      "cumulative_window_days": 100,
      "current_price": 42200.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "097950": {
    "name": "CJ제일제당",
    "as_of": "20260710",
    "short": {
      "balance_qty": 264693.0,
      "avg_price": 193103.0,
      "today_ratio_pct": 6.59,
      "avg_volume_20d": 69899.2,
      "days_to_cover": 3.7867815368416236,
      "balance_change_pct": 1.0116698849802703,
      "short_squeeze_index": -5.733685401735195,
      "pressure": {
        "score": 38,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 5,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 476314.0,
      "balance_change_pct": -0.15009538184181287
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": 7004.0,
      "net_20d": -8343.0,
      "net_60d": -24973.0,
      "net_cumulative": 24428.0,
      "cumulative_window_days": 100,
      "current_price": 191000.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "003230": {
    "name": "삼양식품",
    "as_of": "20260710",
    "short": {
      "balance_qty": 150165.0,
      "avg_price": 1132247.0,
      "today_ratio_pct": 7.41,
      "avg_volume_20d": 52355.4,
      "days_to_cover": 2.868185516680228,
      "balance_change_pct": 1.6696118457132412,
      "short_squeeze_index": -138.19951338199513,
      "pressure": {
        "score": 45,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 12,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 933855.0,
      "balance_change_pct": 1.0391116698818827
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": 19597.0,
      "net_20d": 18364.0,
      "net_60d": 50217.0,
      "net_cumulative": 118090.0,
      "cumulative_window_days": 100,
      "current_price": 1139000.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "033780": {
    "name": "KT&G",
    "as_of": "20260710",
    "short": {
      "balance_qty": 472311.0,
      "avg_price": 176343.0,
      "today_ratio_pct": 2.49,
      "avg_volume_20d": 285613.7,
      "days_to_cover": 1.6536706747610495,
      "balance_change_pct": 1.7900669173823558,
      "short_squeeze_index": -32.687214062123765,
      "pressure": {
        "score": 48,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 22,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1536571.0,
      "balance_change_pct": 2.631012971052245
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "sell"
      },
      "net_5d": 9022.0,
      "net_20d": -19698.0,
      "net_60d": -98280.0,
      "net_cumulative": -143585.0,
      "cumulative_window_days": 100,
      "current_price": 173500.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "004370": {
    "name": "농심",
    "as_of": "20260710",
    "short": {
      "balance_qty": 101101.0,
      "avg_price": 358362.0,
      "today_ratio_pct": 14.1,
      "avg_volume_20d": 26409.2,
      "days_to_cover": 3.828249246474713,
      "balance_change_pct": 3.0696299316953817,
      "short_squeeze_index": 58.253072069080034,
      "pressure": {
        "score": 50,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 321233.0,
      "balance_change_pct": 0.8182006490368018
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "sell"
      },
      "net_5d": 3251.0,
      "net_20d": -1114.0,
      "net_60d": -2132.0,
      "net_cumulative": -20932.0,
      "cumulative_window_days": 100,
      "current_price": 356000.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "271560": {
    "name": "오리온",
    "as_of": "20260710",
    "short": {
      "balance_qty": 370798.0,
      "avg_price": 139181.0,
      "today_ratio_pct": 9.14,
      "avg_volume_20d": 140017.25,
      "days_to_cover": 2.6482308429854178,
      "balance_change_pct": 3.616248948602375,
      "short_squeeze_index": 10.02240939649177,
      "pressure": {
        "score": 61,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 22,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 927241.0,
      "balance_change_pct": 4.088947661469933
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "sell"
      },
      "net_5d": -474.0,
      "net_20d": 1554.0,
      "net_60d": -15178.0,
      "net_cumulative": -52711.0,
      "cumulative_window_days": 100,
      "current_price": 137100.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "007310": {
    "name": "오뚜기",
    "as_of": "20260710",
    "short": {
      "balance_qty": 32105.0,
      "avg_price": 316923.0,
      "today_ratio_pct": 37.1,
      "avg_volume_20d": 4742.1,
      "days_to_cover": 6.770207292127959,
      "balance_change_pct": 9.839542919703034,
      "short_squeeze_index": -34.87482614742698,
      "pressure": {
        "score": 82,
        "grade": {
          "emoji": "🔴",
          "label": "매우 강함"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 12,
          "balance_increase": 20,
          "foreign_sell": 10,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 143998.0,
      "balance_change_pct": 0.35962699153900834
    },
    "pension": {
      "streak": {
        "days": 4,
        "direction": "buy"
      },
      "net_5d": 143.0,
      "net_20d": 151.0,
      "net_60d": -3114.0,
      "net_cumulative": -4564.0,
      "cumulative_window_days": 100,
      "current_price": 312500.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(4일)."
      }
    }
  },
  "280360": {
    "name": "롯데웰푸드",
    "as_of": "20260710",
    "short": {
      "balance_qty": 52748.0,
      "avg_price": 106619.0,
      "today_ratio_pct": 5.75,
      "avg_volume_20d": 18948.6,
      "days_to_cover": 2.7837412790390847,
      "balance_change_pct": 2.2129209781808314,
      "short_squeeze_index": 36.952714535901926,
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
      "balance_qty": 185827.0,
      "balance_change_pct": 0.7083243008887925
    },
    "pension": {
      "streak": {
        "days": 7,
        "direction": "buy"
      },
      "net_5d": 1951.0,
      "net_20d": 1210.0,
      "net_60d": -3762.0,
      "net_cumulative": -8088.0,
      "cumulative_window_days": 100,
      "current_price": 106500.0,
      "interpretation": {
        "tone": "very_positive",
        "label": "매우 긍정",
        "text": "연기금이 7일 연속 순매수 중이고 외국인도 최근 5일 순매수를 동반하고 있습니다."
      }
    }
  },
  "001680": {
    "name": "대상",
    "as_of": "20260710",
    "short": {
      "balance_qty": 354426.0,
      "avg_price": 17542.0,
      "today_ratio_pct": 13.22,
      "avg_volume_20d": 84378.75,
      "days_to_cover": 4.200417759210702,
      "balance_change_pct": 2.4133566809410705,
      "short_squeeze_index": -0.44300766283524906,
      "pressure": {
        "score": 53,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1658964.0,
      "balance_change_pct": -0.13381997330824286
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -7.0,
      "net_20d": -1189.0,
      "net_60d": -6434.0,
      "net_cumulative": -7431.0,
      "cumulative_window_days": 100,
      "current_price": 17440.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "010950": {
    "name": "S-Oil",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1262068.0,
      "avg_price": 132870.0,
      "today_ratio_pct": 9.43,
      "avg_volume_20d": 423132.0,
      "days_to_cover": 2.9826815272775398,
      "balance_change_pct": 2.738041065324686,
      "short_squeeze_index": 36.71473167831129,
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
      "balance_qty": 2206308.0,
      "balance_change_pct": 1.0158319983187745
    },
    "pension": {
      "streak": {
        "days": 5,
        "direction": "buy"
      },
      "net_5d": 79294.0,
      "net_20d": 57629.0,
      "net_60d": 25085.0,
      "net_cumulative": -23005.0,
      "cumulative_window_days": 100,
      "current_price": 132100.0,
      "interpretation": {
        "tone": "very_positive",
        "label": "매우 긍정",
        "text": "연기금이 5일 연속 순매수 중이고 외국인도 최근 5일 순매수를 동반하고 있습니다."
      }
    }
  },
  "078930": {
    "name": "GS",
    "as_of": "20260710",
    "short": {
      "balance_qty": 767597.0,
      "avg_price": 80906.0,
      "today_ratio_pct": 9.26,
      "avg_volume_20d": 352021.05,
      "days_to_cover": 2.1805428965114446,
      "balance_change_pct": 3.9805638488672628,
      "short_squeeze_index": 26.33316317849243,
      "pressure": {
        "score": 34,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 976896.0,
      "balance_change_pct": -1.6923397399450344
    },
    "pension": {
      "streak": {
        "days": 5,
        "direction": "buy"
      },
      "net_5d": 11764.0,
      "net_20d": 23536.0,
      "net_60d": -6082.0,
      "net_cumulative": -31529.0,
      "cumulative_window_days": 100,
      "current_price": 80200.0,
      "interpretation": {
        "tone": "very_positive",
        "label": "매우 긍정",
        "text": "연기금이 5일 연속 순매수 중이고 외국인도 최근 5일 순매수를 동반하고 있습니다."
      }
    }
  },
  "011170": {
    "name": "롯데케미칼",
    "as_of": "20260710",
    "short": {
      "balance_qty": 544274.0,
      "avg_price": 62089.0,
      "today_ratio_pct": 12.54,
      "avg_volume_20d": 148966.1,
      "days_to_cover": 3.6536769103843088,
      "balance_change_pct": 2.2931063970545393,
      "short_squeeze_index": -1.409720514711909,
      "pressure": {
        "score": 53,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1419474.0,
      "balance_change_pct": -1.6606117036753762
    },
    "pension": {
      "streak": {
        "days": 12,
        "direction": "sell"
      },
      "net_5d": -3902.0,
      "net_20d": 3509.0,
      "net_60d": 687.0,
      "net_cumulative": 21704.0,
      "cumulative_window_days": 100,
      "current_price": 61800.0,
      "interpretation": {
        "tone": "caution",
        "label": "비중 축소 가능성",
        "text": "연기금이 12일 연속 순매도 중입니다."
      }
    }
  },
  "011780": {
    "name": "금호석유화학",
    "as_of": "20260710",
    "short": {
      "balance_qty": 154886.0,
      "avg_price": 118089.0,
      "today_ratio_pct": 6.72,
      "avg_volume_20d": 86562.35,
      "days_to_cover": 1.7892998514943275,
      "balance_change_pct": 3.5105892416779723,
      "short_squeeze_index": 43.86065105653912,
      "pressure": {
        "score": 51,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 696385.0,
      "balance_change_pct": 0.6882342309777697
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": 3654.0,
      "net_20d": 3688.0,
      "net_60d": -18413.0,
      "net_cumulative": -70769.0,
      "cumulative_window_days": 100,
      "current_price": 117400.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "014680": {
    "name": "한솔케미칼",
    "as_of": "20260710",
    "short": {
      "balance_qty": 267844.0,
      "avg_price": 249842.0,
      "today_ratio_pct": 23.25,
      "avg_volume_20d": 63432.6,
      "days_to_cover": 4.222497580108651,
      "balance_change_pct": 3.92506828904892,
      "short_squeeze_index": -0.5733491498616055,
      "pressure": {
        "score": 76,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 22,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 564420.0,
      "balance_change_pct": 2.4383603909362326
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -60.0,
      "net_20d": -5268.0,
      "net_60d": -48323.0,
      "net_cumulative": -87621.0,
      "cumulative_window_days": 100,
      "current_price": 248500.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "011790": {
    "name": "SKC",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1332581.0,
      "avg_price": 95451.0,
      "today_ratio_pct": 29.72,
      "avg_volume_20d": 476197.2,
      "days_to_cover": 2.7983805868661134,
      "balance_change_pct": 5.377775141846075,
      "short_squeeze_index": -1.1851895420992264,
      "pressure": {
        "score": 65,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 5,
          "balance_increase": 20,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 4141519.0,
      "balance_change_pct": -0.5379786355165326
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": -2584.0,
      "net_20d": -20873.0,
      "net_60d": 18614.0,
      "net_cumulative": -1139.0,
      "cumulative_window_days": 100,
      "current_price": 94600.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "005490": {
    "name": "POSCO홀딩스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 728986.0,
      "avg_price": 315469.0,
      "today_ratio_pct": 8.44,
      "avg_volume_20d": 375169.3,
      "days_to_cover": 1.943085428365274,
      "balance_change_pct": 3.5756301327043847,
      "short_squeeze_index": 89.17587220853532,
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
      "balance_qty": 2653246.0,
      "balance_change_pct": 0.18365930594604554
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": -9393.0,
      "net_20d": -117365.0,
      "net_60d": -91740.0,
      "net_cumulative": -76919.0,
      "cumulative_window_days": 100,
      "current_price": 313500.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "004020": {
    "name": "현대제철",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1649702.0,
      "avg_price": 27170.0,
      "today_ratio_pct": 3.53,
      "avg_volume_20d": 645549.55,
      "days_to_cover": 2.555500193594744,
      "balance_change_pct": 1.3632439639573215,
      "short_squeeze_index": 6.341551358903863,
      "pressure": {
        "score": 21,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 5,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 3355347.0,
      "balance_change_pct": -0.7920147457197142
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "sell"
      },
      "net_5d": -585.0,
      "net_20d": -18720.0,
      "net_60d": -47323.0,
      "net_cumulative": -5442.0,
      "cumulative_window_days": 100,
      "current_price": 26900.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "010130": {
    "name": "고려아연",
    "as_of": "20260710",
    "short": {
      "balance_qty": 37623.0,
      "avg_price": 1065190.0,
      "today_ratio_pct": 7.48,
      "avg_volume_20d": 20275.15,
      "days_to_cover": 1.8556212901014295,
      "balance_change_pct": 3.317314293560346,
      "short_squeeze_index": 313.74172185430467,
      "pressure": {
        "score": 59,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 30,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 296426.0,
      "balance_change_pct": 16.052978784212854
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": 422.0,
      "net_20d": 8790.0,
      "net_60d": -32800.0,
      "net_cumulative": 247.0,
      "cumulative_window_days": 100,
      "current_price": 1043000.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "460860": {
    "name": "동국제강",
    "as_of": "20260710",
    "short": {
      "balance_qty": 500690.0,
      "avg_price": 8450.0,
      "today_ratio_pct": 5.41,
      "avg_volume_20d": 246036.6,
      "days_to_cover": 2.035022431621962,
      "balance_change_pct": 1.8936271965973726,
      "short_squeeze_index": 3.5679742074153684,
      "pressure": {
        "score": 45,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 22,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1283100.0,
      "balance_change_pct": 4.0332231731957355
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": 304.0,
      "net_20d": 3215.0,
      "net_60d": -10949.0,
      "net_cumulative": -1030.0,
      "cumulative_window_days": 100,
      "current_price": 8520.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "000670": {
    "name": "영풍",
    "as_of": "20260710",
    "short": {
      "balance_qty": 118693.0,
      "avg_price": 37199.0,
      "today_ratio_pct": 15.63,
      "avg_volume_20d": 30198.8,
      "days_to_cover": 3.9303879624355935,
      "balance_change_pct": 4.303314703504517,
      "short_squeeze_index": 0.44925464570144985,
      "pressure": {
        "score": 59,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 644830.0,
      "balance_change_pct": -0.04340345057432066
    },
    "pension": {
      "streak": {
        "days": 4,
        "direction": "sell"
      },
      "net_5d": -416.0,
      "net_20d": -2804.0,
      "net_60d": -3686.0,
      "net_cumulative": 3974.0,
      "cumulative_window_days": 100,
      "current_price": 36750.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "066570": {
    "name": "LG전자",
    "as_of": "20260710",
    "short": {
      "balance_qty": 3488728.0,
      "avg_price": 181894.0,
      "today_ratio_pct": 11.09,
      "avg_volume_20d": 1871392.15,
      "days_to_cover": 1.86424208309306,
      "balance_change_pct": 4.379493470163209,
      "short_squeeze_index": 45.332631952889095,
      "pressure": {
        "score": 60,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 22,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 5528980.0,
      "balance_change_pct": 3.55349534110596
    },
    "pension": {
      "streak": {
        "days": 4,
        "direction": "buy"
      },
      "net_5d": 19879.0,
      "net_20d": 54731.0,
      "net_60d": -4364.0,
      "net_cumulative": -24209.0,
      "cumulative_window_days": 100,
      "current_price": 182400.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(4일)."
      }
    }
  },
  "021240": {
    "name": "코웨이",
    "as_of": "20260710",
    "short": {
      "balance_qty": 484163.0,
      "avg_price": 90993.0,
      "today_ratio_pct": 10.45,
      "avg_volume_20d": 212985.45,
      "days_to_cover": 2.273221011106627,
      "balance_change_pct": 3.732913399322964,
      "short_squeeze_index": 13.545313665844,
      "pressure": {
        "score": 60,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 759057.0,
      "balance_change_pct": 0.9498414049460379
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "sell"
      },
      "net_5d": -2008.0,
      "net_20d": -28733.0,
      "net_60d": -49210.0,
      "net_cumulative": -9376.0,
      "cumulative_window_days": 100,
      "current_price": 89900.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "009450": {
    "name": "경동나비엔",
    "as_of": "20260710",
    "short": {
      "balance_qty": 108834.0,
      "avg_price": 63875.0,
      "today_ratio_pct": 24.5,
      "avg_volume_20d": 43027.4,
      "days_to_cover": 2.529411491282299,
      "balance_change_pct": 4.932605719354403,
      "short_squeeze_index": 8.95230648944488,
      "pressure": {
        "score": 49,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 432162.0,
      "balance_change_pct": -0.09339615226346962
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": 2057.0,
      "net_20d": 61.0,
      "net_60d": 4405.0,
      "net_cumulative": 6562.0,
      "cumulative_window_days": 100,
      "current_price": 63400.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "192400": {
    "name": "쿠쿠홀딩스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 37545.0,
      "avg_price": 25281.0,
      "today_ratio_pct": 11.51,
      "avg_volume_20d": 17628.05,
      "days_to_cover": 2.1298441971743896,
      "balance_change_pct": 3.879036051240904,
      "short_squeeze_index": 0.6419400855920114,
      "pressure": {
        "score": 60,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 235853.0,
      "balance_change_pct": 0.0
    },
    "pension": {
      "streak": {
        "days": 3,
        "direction": "buy"
      },
      "net_5d": 76.0,
      "net_20d": 52.0,
      "net_60d": -597.0,
      "net_cumulative": 156.0,
      "cumulative_window_days": 100,
      "current_price": 25200.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(3일)."
      }
    }
  },
  "023530": {
    "name": "롯데쇼핑",
    "as_of": "20260710",
    "short": {
      "balance_qty": 427701.0,
      "avg_price": 157735.0,
      "today_ratio_pct": 8.04,
      "avg_volume_20d": 165518.1,
      "days_to_cover": 2.584013470430122,
      "balance_change_pct": 2.354605108863692,
      "short_squeeze_index": -6.006707998780364,
      "pressure": {
        "score": 51,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 726839.0,
      "balance_change_pct": 0.17337829959715043
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "sell"
      },
      "net_5d": 4361.0,
      "net_20d": 11874.0,
      "net_60d": 82207.0,
      "net_cumulative": 122475.0,
      "cumulative_window_days": 100,
      "current_price": 155300.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "004170": {
    "name": "신세계",
    "as_of": "20260710",
    "short": {
      "balance_qty": 249206.0,
      "avg_price": 635794.0,
      "today_ratio_pct": 8.08,
      "avg_volume_20d": 90982.8,
      "days_to_cover": 2.7390451821662993,
      "balance_change_pct": 1.8880730043992346,
      "short_squeeze_index": 30.424426158510176,
      "pressure": {
        "score": 63,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 30,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 535793.0,
      "balance_change_pct": 7.514257162694192
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "sell"
      },
      "net_5d": 414.0,
      "net_20d": -19584.0,
      "net_60d": -49991.0,
      "net_cumulative": -69264.0,
      "cumulative_window_days": 100,
      "current_price": 629000.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "069960": {
    "name": "현대백화점",
    "as_of": "20260710",
    "short": {
      "balance_qty": 475303.0,
      "avg_price": 168708.0,
      "today_ratio_pct": 4.22,
      "avg_volume_20d": 173788.2,
      "days_to_cover": 2.734955537832833,
      "balance_change_pct": 0.9333033203937925,
      "short_squeeze_index": -1.001137656427759,
      "pressure": {
        "score": 31,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 5,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 679522.0,
      "balance_change_pct": -0.1118652090380033
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "buy"
      },
      "net_5d": -5159.0,
      "net_20d": -14664.0,
      "net_60d": -3088.0,
      "net_cumulative": -28574.0,
      "cumulative_window_days": 100,
      "current_price": 167100.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(1일)."
      }
    }
  },
  "139480": {
    "name": "이마트",
    "as_of": "20260710",
    "short": {
      "balance_qty": 351498.0,
      "avg_price": 82287.0,
      "today_ratio_pct": 9.48,
      "avg_volume_20d": 132966.85,
      "days_to_cover": 2.6435009929166555,
      "balance_change_pct": 2.715023363052188,
      "short_squeeze_index": 31.43902701539124,
      "pressure": {
        "score": 34,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1344959.0,
      "balance_change_pct": -0.5220348560705967
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -500.0,
      "net_20d": -18197.0,
      "net_60d": -3824.0,
      "net_cumulative": -24212.0,
      "cumulative_window_days": 100,
      "current_price": 81800.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "008770": {
    "name": "호텔신라",
    "as_of": "20260710",
    "short": {
      "balance_qty": 756404.0,
      "avg_price": 50620.0,
      "today_ratio_pct": 6.18,
      "avg_volume_20d": 316454.1,
      "days_to_cover": 2.390248696414425,
      "balance_change_pct": 1.3586326573000207,
      "short_squeeze_index": 18.078705986783707,
      "pressure": {
        "score": 35,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 12,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 2873749.0,
      "balance_change_pct": 0.7004090391592008
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": 11240.0,
      "net_20d": 15425.0,
      "net_60d": 45127.0,
      "net_cumulative": 53673.0,
      "cumulative_window_days": 100,
      "current_price": 50400.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "034230": {
    "name": "파라다이스",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1733494.0,
      "avg_price": 12745.0,
      "today_ratio_pct": 11.27,
      "avg_volume_20d": 666331.7,
      "days_to_cover": 2.601548147866896,
      "balance_change_pct": 4.159734176948984,
      "short_squeeze_index": 2.3978390558869838,
      "pressure": {
        "score": 60,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 5100216.0,
      "balance_change_pct": 0.6746097543643556
    },
    "pension": {
      "streak": {
        "days": 3,
        "direction": "sell"
      },
      "net_5d": -4615.0,
      "net_20d": -2722.0,
      "net_60d": -174.0,
      "net_cumulative": 29128.0,
      "cumulative_window_days": 100,
      "current_price": 12660.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "088980": {
    "name": "맥쿼리인프라",
    "as_of": "20260710",
    "short": {
      "balance_qty": 3017652.0,
      "avg_price": 10194.0,
      "today_ratio_pct": 2.47,
      "avg_volume_20d": 2264330.9,
      "days_to_cover": 1.332690376658288,
      "balance_change_pct": 1.0294609500208074,
      "short_squeeze_index": 17.64610231227032,
      "pressure": {
        "score": 16,
        "grade": {
          "emoji": "🟢",
          "label": "매우 약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 0,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 8871173.0,
      "balance_change_pct": -17.30550206447901
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": -3227.0,
      "net_20d": -4278.0,
      "net_60d": -5124.0,
      "net_cumulative": -5801.0,
      "cumulative_window_days": 100,
      "current_price": 10230.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "395400": {
    "name": "SK리츠",
    "as_of": "20260710",
    "short": {
      "balance_qty": 940312.0,
      "avg_price": 5753.0,
      "today_ratio_pct": 13.78,
      "avg_volume_20d": 334415.7,
      "days_to_cover": 2.811805785434117,
      "balance_change_pct": 1.3034723711044771,
      "short_squeeze_index": -0.8347797338623026,
      "pressure": {
        "score": 57,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 5,
          "balance_increase": 8,
          "foreign_sell": 10,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 6154811.0,
      "balance_change_pct": -2.6629267839839774
    },
    "pension": {
      "streak": {
        "days": 58,
        "direction": "sell"
      },
      "net_5d": -924.0,
      "net_20d": -4285.0,
      "net_60d": -20158.0,
      "net_cumulative": -23692.0,
      "cumulative_window_days": 100,
      "current_price": 5710.0,
      "interpretation": {
        "tone": "caution",
        "label": "비중 축소 가능성",
        "text": "연기금이 58일 연속 순매도 중입니다."
      }
    }
  },
  "330590": {
    "name": "롯데리츠",
    "as_of": "20260710",
    "short": {
      "balance_qty": 583805.0,
      "avg_price": 3545.0,
      "today_ratio_pct": 20.8,
      "avg_volume_20d": 272045.2,
      "days_to_cover": 2.1459852995017004,
      "balance_change_pct": 4.6954747122602765,
      "short_squeeze_index": 0.13749379368292403,
      "pressure": {
        "score": 66,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 6881522.0,
      "balance_change_pct": 0.0
    },
    "pension": {
      "streak": {
        "days": 58,
        "direction": "sell"
      },
      "net_5d": -579.0,
      "net_20d": -2467.0,
      "net_60d": -11449.0,
      "net_cumulative": -12012.0,
      "cumulative_window_days": 100,
      "current_price": 3510.0,
      "interpretation": {
        "tone": "caution",
        "label": "비중 축소 가능성",
        "text": "연기금이 58일 연속 순매도 중입니다."
      }
    }
  },
  "451800": {
    "name": "한화리츠",
    "as_of": "20260710",
    "short": {
      "balance_qty": 260695.0,
      "avg_price": 4734.0,
      "today_ratio_pct": 4.74,
      "avg_volume_20d": 161942.75,
      "days_to_cover": 1.6097972894742123,
      "balance_change_pct": 0.972562203699687,
      "short_squeeze_index": -0.27877339705296694,
      "pressure": {
        "score": 38,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 12,
          "balance_increase": 8,
          "foreign_sell": 10,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 2760607.0,
      "balance_change_pct": 0.0
    },
    "pension": {
      "streak": {
        "days": 37,
        "direction": "sell"
      },
      "net_5d": -395.0,
      "net_20d": -1776.0,
      "net_60d": -3656.0,
      "net_cumulative": -2530.0,
      "cumulative_window_days": 100,
      "current_price": 4740.0,
      "interpretation": {
        "tone": "caution",
        "label": "비중 축소 가능성",
        "text": "연기금이 37일 연속 순매도 중입니다."
      }
    }
  },
  "448730": {
    "name": "삼성FN리츠",
    "as_of": "20260710",
    "short": {
      "balance_qty": 50342.0,
      "avg_price": 5341.0,
      "today_ratio_pct": 2.22,
      "avg_volume_20d": 75857.25,
      "days_to_cover": 0.6636412472110444,
      "balance_change_pct": 0.8049659591509812,
      "short_squeeze_index": -1.7412935323383085,
      "pressure": {
        "score": 38,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 12,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 897446.0,
      "balance_change_pct": 0.0
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": 0.0,
      "net_20d": -46.0,
      "net_60d": -190.0,
      "net_cumulative": -268.0,
      "cumulative_window_days": 100,
      "current_price": 5340.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "034730": {
    "name": "SK",
    "as_of": "20260710",
    "short": {
      "balance_qty": 448402.0,
      "avg_price": 657880.0,
      "today_ratio_pct": 5.06,
      "avg_volume_20d": 373682.35,
      "days_to_cover": 1.1999549885082879,
      "balance_change_pct": 3.068598696247805,
      "short_squeeze_index": 107.34082397003746,
      "pressure": {
        "score": 39,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 0,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 593754.0,
      "balance_change_pct": -5.444602455955398
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": -6188.0,
      "net_20d": 56693.0,
      "net_60d": 55729.0,
      "net_cumulative": -5763.0,
      "cumulative_window_days": 100,
      "current_price": 657000.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "003550": {
    "name": "LG",
    "as_of": "20260710",
    "short": {
      "balance_qty": 1244296.0,
      "avg_price": 104551.0,
      "today_ratio_pct": 9.44,
      "avg_volume_20d": 520819.6,
      "days_to_cover": 2.389111316087183,
      "balance_change_pct": 2.5342344970343014,
      "short_squeeze_index": 20.91110099499252,
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
      "balance_qty": 3931111.0,
      "balance_change_pct": 0.13803935713754414
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "sell"
      },
      "net_5d": 3980.0,
      "net_20d": -25835.0,
      "net_60d": 17426.0,
      "net_cumulative": -24498.0,
      "cumulative_window_days": 100,
      "current_price": 101300.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "267250": {
    "name": "HD현대",
    "as_of": "20260710",
    "short": {
      "balance_qty": 286596.0,
      "avg_price": 202084.0,
      "today_ratio_pct": 5.04,
      "avg_volume_20d": 191633.55,
      "days_to_cover": 1.495541881888636,
      "balance_change_pct": 2.10155434507672,
      "short_squeeze_index": 58.874385489065936,
      "pressure": {
        "score": 44,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 684754.0,
      "balance_change_pct": -1.8601671412990357
    },
    "pension": {
      "streak": {
        "days": 4,
        "direction": "sell"
      },
      "net_5d": -8751.0,
      "net_20d": -27333.0,
      "net_60d": -24685.0,
      "net_cumulative": 3100.0,
      "cumulative_window_days": 100,
      "current_price": 199500.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "000880": {
    "name": "한화",
    "as_of": "20260710",
    "short": {
      "balance_qty": 751693.0,
      "avg_price": 94811.0,
      "today_ratio_pct": 14.0,
      "avg_volume_20d": 197441.7,
      "days_to_cover": 3.8071643426895125,
      "balance_change_pct": 2.9891378809551212,
      "short_squeeze_index": 4.611083100334602,
      "pressure": {
        "score": 43,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 0
        }
      }
    },
    "loan": {
      "balance_qty": 1305993.0,
      "balance_change_pct": -1.352296555016406
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "buy"
      },
      "net_5d": -780.0,
      "net_20d": -3494.0,
      "net_60d": -46126.0,
      "net_cumulative": -45224.0,
      "cumulative_window_days": 100,
      "current_price": 93600.0,
      "interpretation": {
        "tone": "neutral_positive",
        "label": "중립~긍정",
        "text": "연기금이 순매수 중이나 연속성은 아직 짧습니다(2일)."
      }
    }
  },
  "000150": {
    "name": "두산",
    "as_of": "20260710",
    "short": {
      "balance_qty": 156146.0,
      "avg_price": 1402187.0,
      "today_ratio_pct": 7.9,
      "avg_volume_20d": 87936.7,
      "days_to_cover": 1.7756636307707705,
      "balance_change_pct": 5.505479803781132,
      "short_squeeze_index": 22.876779577810506,
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
      "balance_qty": 635963.0,
      "balance_change_pct": -2.324234828658139
    },
    "pension": {
      "streak": {
        "days": 12,
        "direction": "sell"
      },
      "net_5d": -34892.0,
      "net_20d": -114848.0,
      "net_60d": -343341.0,
      "net_cumulative": -251174.0,
      "cumulative_window_days": 100,
      "current_price": 1382000.0,
      "interpretation": {
        "tone": "caution",
        "label": "비중 축소 가능성",
        "text": "연기금이 12일 연속 순매도 중입니다."
      }
    }
  },
  "001040": {
    "name": "CJ",
    "as_of": "20260710",
    "short": {
      "balance_qty": 330235.0,
      "avg_price": 143327.0,
      "today_ratio_pct": 7.62,
      "avg_volume_20d": 124595.0,
      "days_to_cover": 2.650467514747783,
      "balance_change_pct": 3.5005296709771647,
      "short_squeeze_index": 27.191333154266275,
      "pressure": {
        "score": 44,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1887191.0,
      "balance_change_pct": -0.5420882571962664
    },
    "pension": {
      "streak": {
        "days": 4,
        "direction": "sell"
      },
      "net_5d": -4421.0,
      "net_20d": -5952.0,
      "net_60d": -8082.0,
      "net_cumulative": -41975.0,
      "cumulative_window_days": 100,
      "current_price": 142200.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "004800": {
    "name": "효성",
    "as_of": "20260710",
    "short": {
      "balance_qty": 124813.0,
      "avg_price": 156358.0,
      "today_ratio_pct": 31.73,
      "avg_volume_20d": 33161.8,
      "days_to_cover": 3.763758300212895,
      "balance_change_pct": 3.302351373496768,
      "short_squeeze_index": 11.37844611528822,
      "pressure": {
        "score": 59,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 211533.0,
      "balance_change_pct": -2.0657885599203683
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": -370.0,
      "net_20d": 1508.0,
      "net_60d": -7597.0,
      "net_cumulative": -8581.0,
      "cumulative_window_days": 100,
      "current_price": 155500.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "004990": {
    "name": "롯데지주",
    "as_of": "20260710",
    "short": {
      "balance_qty": 593955.0,
      "avg_price": 23678.0,
      "today_ratio_pct": 8.86,
      "avg_volume_20d": 260836.75,
      "days_to_cover": 2.277113941957949,
      "balance_change_pct": 2.7116903059795185,
      "short_squeeze_index": 2.9207320961673364,
      "pressure": {
        "score": 44,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 2060470.0,
      "balance_change_pct": -0.3240663922494968
    },
    "pension": {
      "streak": {
        "days": 3,
        "direction": "sell"
      },
      "net_5d": -1262.0,
      "net_20d": -1519.0,
      "net_60d": -18497.0,
      "net_cumulative": -27509.0,
      "cumulative_window_days": 100,
      "current_price": 23400.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "180640": {
    "name": "한진칼",
    "as_of": "20260710",
    "short": {
      "balance_qty": 293705.0,
      "avg_price": 133949.0,
      "today_ratio_pct": 12.96,
      "avg_volume_20d": 114284.5,
      "days_to_cover": 2.5699460556768416,
      "balance_change_pct": 4.469303549832823,
      "short_squeeze_index": -7.703939514524473,
      "pressure": {
        "score": 88,
        "grade": {
          "emoji": "🔴",
          "label": "매우 강함"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 30,
          "balance_increase": 14,
          "foreign_sell": 10,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1889698.0,
      "balance_change_pct": 35.90412984442604
    },
    "pension": {
      "streak": {
        "days": 1,
        "direction": "sell"
      },
      "net_5d": 3658.0,
      "net_20d": 6406.0,
      "net_60d": -21325.0,
      "net_cumulative": -25871.0,
      "cumulative_window_days": 100,
      "current_price": 134700.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "002380": {
    "name": "KCC",
    "as_of": "20260710",
    "short": {
      "balance_qty": 49284.0,
      "avg_price": 459828.0,
      "today_ratio_pct": 3.7,
      "avg_volume_20d": 37794.45,
      "days_to_cover": 1.3040009842715004,
      "balance_change_pct": 1.3094332641272843,
      "short_squeeze_index": 121.8210361067504,
      "pressure": {
        "score": 38,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 12,
          "balance_increase": 8,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 110287.0,
      "balance_change_pct": 1.3546175548877433
    },
    "pension": {
      "streak": {
        "days": 3,
        "direction": "sell"
      },
      "net_5d": -490.0,
      "net_20d": -23798.0,
      "net_60d": -73294.0,
      "net_cumulative": -142728.0,
      "cumulative_window_days": 100,
      "current_price": 453500.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "002020": {
    "name": "코오롱",
    "as_of": "20260710",
    "short": {
      "balance_qty": 81187.0,
      "avg_price": 43425.0,
      "today_ratio_pct": 2.68,
      "avg_volume_20d": 46732.2,
      "days_to_cover": 1.7372817885740455,
      "balance_change_pct": 2.0219156048154012,
      "short_squeeze_index": 49.844623990055936,
      "pressure": {
        "score": 37,
        "grade": {
          "emoji": "🟢",
          "label": "약함"
        },
        "breakdown": {
          "short_ratio": 8,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 343955.0,
      "balance_change_pct": -0.000290734861435765
    },
    "pension": {
      "streak": {
        "days": 2,
        "direction": "sell"
      },
      "net_5d": -47.0,
      "net_20d": -425.0,
      "net_60d": 5698.0,
      "net_cumulative": 13401.0,
      "cumulative_window_days": 100,
      "current_price": 43900.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "012630": {
    "name": "HDC",
    "as_of": "20260710",
    "short": {
      "balance_qty": 235192.0,
      "avg_price": 20605.0,
      "today_ratio_pct": 5.99,
      "avg_volume_20d": 83960.0,
      "days_to_cover": 2.801238685088137,
      "balance_change_pct": 7.027076222980661,
      "short_squeeze_index": 13.087682942624014,
      "pressure": {
        "score": 57,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 12,
          "balance_increase": 20,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1005693.0,
      "balance_change_pct": 1.3196735019554822
    },
    "pension": {
      "streak": {
        "days": 0,
        "direction": "flat"
      },
      "net_5d": -2.0,
      "net_20d": -438.0,
      "net_60d": -3725.0,
      "net_cumulative": -2713.0,
      "cumulative_window_days": 100,
      "current_price": 20300.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  },
  "000240": {
    "name": "한국앤컴퍼니",
    "as_of": "20260710",
    "short": {
      "balance_qty": 866768.0,
      "avg_price": 25593.0,
      "today_ratio_pct": 21.25,
      "avg_volume_20d": 171192.4,
      "days_to_cover": 5.0631219610216345,
      "balance_change_pct": 2.448670352023696,
      "short_squeeze_index": 1.4529130665636916,
      "pressure": {
        "score": 66,
        "grade": {
          "emoji": "🟠",
          "label": "강함"
        },
        "breakdown": {
          "short_ratio": 30,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 2405155.0,
      "balance_change_pct": 0.33192919400066245
    },
    "pension": {
      "streak": {
        "days": 9,
        "direction": "buy"
      },
      "net_5d": 1461.0,
      "net_20d": 6213.0,
      "net_60d": 8368.0,
      "net_cumulative": 7387.0,
      "cumulative_window_days": 100,
      "current_price": 25050.0,
      "interpretation": {
        "tone": "very_positive",
        "label": "매우 긍정",
        "text": "연기금이 9일 연속 순매수 중이고 외국인도 최근 5일 순매수를 동반하고 있습니다."
      }
    }
  },
  "003090": {
    "name": "대웅",
    "as_of": "20260710",
    "short": {
      "balance_qty": 238875.0,
      "avg_price": 17233.0,
      "today_ratio_pct": 13.08,
      "avg_volume_20d": 68960.0,
      "days_to_cover": 3.4639646171693736,
      "balance_change_pct": 4.67929026236103,
      "short_squeeze_index": 2.088406068552163,
      "pressure": {
        "score": 53,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 24,
          "loan_increase": 5,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1110519.0,
      "balance_change_pct": -0.34629183275333864
    },
    "pension": {
      "streak": {
        "days": 7,
        "direction": "buy"
      },
      "net_5d": 369.0,
      "net_20d": 546.0,
      "net_60d": 3817.0,
      "net_cumulative": 8636.0,
      "cumulative_window_days": 100,
      "current_price": 17030.0,
      "interpretation": {
        "tone": "very_positive",
        "label": "매우 긍정",
        "text": "연기금이 7일 연속 순매수 중이고 외국인도 최근 5일 순매수를 동반하고 있습니다."
      }
    }
  },
  "017800": {
    "name": "현대엘리베이터",
    "as_of": "20260710",
    "short": {
      "balance_qty": 296334.0,
      "avg_price": 69992.0,
      "today_ratio_pct": 5.76,
      "avg_volume_20d": 185356.1,
      "days_to_cover": 1.5987280699151525,
      "balance_change_pct": 2.1954146664459526,
      "short_squeeze_index": 3.3301916431039897,
      "pressure": {
        "score": 51,
        "grade": {
          "emoji": "🟡",
          "label": "보통"
        },
        "breakdown": {
          "short_ratio": 15,
          "loan_increase": 12,
          "balance_increase": 14,
          "foreign_sell": 0,
          "inst_sell": 10
        }
      }
    },
    "loan": {
      "balance_qty": 1064206.0,
      "balance_change_pct": 0.947815149485778
    },
    "pension": {
      "streak": {
        "days": 3,
        "direction": "sell"
      },
      "net_5d": -2687.0,
      "net_20d": 2786.0,
      "net_60d": -6199.0,
      "net_cumulative": -46704.0,
      "cumulative_window_days": 100,
      "current_price": 69500.0,
      "interpretation": {
        "tone": "neutral",
        "label": "중립",
        "text": "연기금 매매 방향성이 뚜렷하지 않습니다."
      }
    }
  }
};
