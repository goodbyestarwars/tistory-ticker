/* 검색기 6개 전략의 검증 결과 모음 (2026-11-27 기준, 고정 연구값).
 * 화면(js/scanner-terminal.js '자동매매 검색기')은 이 값을 그대로 보여 주고, 아래 네 종류를 서로 섞지 않는다.
 *   backtest    과거 5년 일봉 재현(연구 전용)             · 고정값(원문 docs 표기)
 *   dailyPaper  일봉 모의: 서버가 쌓는 포착 추적 기록          · 화면이 /pattern-scan 응답으로 채운다(여기엔 없음)
 *   intraday    장중 모의: 실시간 신호 분봉 전진 검증          · 고정값(해당하는 전략만)
 *   real        실계좌 전략별 체결·손익                        · 장부 연동 전이라 전부 미집계
 * 값이 없으면 null(화면 '미집계'). 숫자를 추정해서 채우지 않는다. 승격은 사용자 승인 없이 하지 않는다.
 */
window.SCANNER_VALIDATION = {
  version: 'scanner-validation-v1',
  asOf: '2026-11-27',
  periods: { train: '2021-01~2023-12', valid: '2024-01~2025-06', test: '2025-07~2026-08' },
  // 승격 검토 요건(docs/SCANNER_MONITORING_2026-11-20.md): exit-v2 기준 끝난 매매 100건 이상 · PF 1.3 이상 · 1건 평균 +1.0% 이상. 통과해도 사용자 승인 전에는 켜지 않는다.
  promotionRule: { minClosed: 100, minPf: 1.3, minAvgPct: 1.0, rule: 'exit-v2' },
  strategies: [
    {
      key: 'leaderPullback', label: '주도주 조용한 눌림', horizon: 'swing', adopted: true, monitorKey: 'pattern:edge:quietLeaderPullback',
      buy: '거래대금 상위 15% 대형 주도주가 120봉 상승 뒤 저점을 높이며 쉬는 중이고 조용함이 그날 상위 30%. KOSPI 종가가 60일선 위일 때만 매수후보, 같은 WICS 업종은 가장 조용한 1종목. 실계좌 칸은 전 거래일 확정 후보를 다음 거래일 지정가로 매수(기준가 +2% 이상이면 추격 안 함).',
      sell: '손절 -10% · +10% 도달 뒤 종가가 60일선 아래면 다음 거래일 시가 매도 · 최대 250거래일(exit-v2).',
      backtest: {
        exitRule: 'exit-v2 (손절 -10% · +10% 뒤 60일선 이탈 · 최대 250거래일)', cost: '왕복 0.7%',
        source: 'docs/RALLY_ANATOMY_STUDY_2026-11-19.md 7단계(학습에서 선정한 규칙을 검증·시험에 적용)',
        rows: [
          { period: '학습 2021~2023', n: 274, avg: 1.19, pf: 1.18, win: null, mdd: 787 },
          { period: '검증 2024-01~2025-06', n: 234, avg: 10.28, pf: 3.49, win: null, mdd: 116 },
          { period: '시험 2025-07~', n: 426, avg: 9.56, pf: 3.27, win: null, mdd: 426 }
        ],
        note: '누적 낙폭은 진입일 순 매매 수익 단순 합의 %p. 학습(하락장) PF는 1.2 미만으로 거의 본전. 2024~2026 상승 구간에서 기준을 넘었다.'
      },
      intraday: null,
      real: { note: '채택 전략이지만 전략별 체결·손익 집계 없음. 실계좌 주문 스위치는 자동매매 화면에서 따로 확인.' }
    },
    {
      key: 'liveFlow', label: '거래량·가격 회복', horizon: 'short', adopted: false, monitorKey: 'pattern:shape-v2:liveFlow',
      buy: '일봉 모양(눌림 뒤 회복) 후보 + 장중 9Pay A/B 신호(첫 1% 눌림 뒤 재돌파·갭 후 시가 지지, 전일 거래량 70% 이상 유입)와 장중 거래량 급증 감시.',
      sell: '실계좌 9Pay 경로 기준: -5% 즉시·-3% 손절, +3% 뒤 고점 대비 -2.5% 추적, 14:00 규칙. 현재 9Pay 신규 매수는 중지(NINEPAY_ENTRIES=False, 2026-11-20 문서).',
      backtest: {
        exitRule: '20거래일 보유 뒤 종가(E20, 매도 규칙 영향을 뺀 중립 기준)', cost: '왕복 0.7%',
        source: 'docs/SCANNER_MENU_SCORECARD_2026-11-20.md · 일봉 모양 부분만 재현(9Pay 장중 신호는 재현 불가)',
        rows: [
          { period: '학습 2021~2023', n: 12622, avg: -2.01, pf: 0.67, win: null, mdd: null, excess: -0.91 },
          { period: '검증 2024-01~2025-06', n: 9358, avg: -0.67, pf: 0.87, win: null, mdd: null, excess: -0.33 },
          { period: '시험 2025-07~', n: 8128, avg: -0.44, pf: 0.93, win: null, mdd: null, excess: 0.06 }
        ],
        note: '초과는 같은 기간 아무 종목 대비 %p. 판정: 숨김 후보(사용자 승인 대상, 숨기지 않음).'
      },
      intraday: {
        exitRule: '+2.5% 익절 / 진입 전 저가 이탈 손절(X2), 신호 직후 다음 분 시가 매수', cost: '왕복 0.4%',
        source: 'docs/SIGNAL_FORWARD_MINUTE_STUDY_2026-11-26.md · 장중 거래량 급증 신호만(9Pay A/B 신호는 포함되지 않음)',
        rows: [{ period: '2026-10-16~11-26 (30거래일)', n: 1388, avg: -0.78, pf: 0.53, win: 44.8, mdd: null, ci: '[-1.06, -0.48]' }],
        note: '판정 신호 없음. 약 30거래일 한 구간·호가 슬리피지 미반영.'
      },
      real: { note: '2026-10-14 이후 9Pay 단타 실주문 0건(docs/NINEPAY_DAYTRADE_VALIDATION_2026-11-20.md). 장중 A/B 모의 결과는 신호 100건 누적 전이라 미집계.' }
    },
    {
      key: 'trendBreakout', label: '추세 돌파', horizon: 'short', adopted: false, monitorKey: 'pattern:shape-v2:trendBreakout',
      buy: '하락추세선 돌파(두 스윙 고점 연결선을 종가가 처음 돌파, 상승 5일선 위) 또는 이평선 기울기 전환 후보. 일봉 확정 스캔.',
      sell: '자동매매 미사용. 참고 판정용 매도: 20거래일 보유 · exit-v1/v2(손절 -10%).',
      backtest: {
        exitRule: '20거래일 보유 뒤 종가(E20)', cost: '왕복 0.7%', source: 'docs/SCANNER_MENU_SCORECARD_2026-11-20.md',
        rows: [
          { period: '학습 2021~2023', n: 3475, avg: -0.99, pf: 0.83, win: null, mdd: null, excess: 0.11 },
          { period: '검증 2024-01~2025-06', n: 2624, avg: -0.55, pf: 0.90, win: null, mdd: null, excess: -0.21 },
          { period: '시험 2025-07~', n: 2187, avg: 0.30, pf: 1.04, win: null, mdd: null, excess: 0.80 }
        ],
        note: '판정: 고침(차이가 작음).'
      },
      intraday: null, real: { note: '신규 매수 중지 상태(2026-11-20 문서). 실계좌 결과 미집계.' }
    },
    {
      key: 'bottomFormation', label: '바닥 형성', horizon: 'swing', adopted: false, monitorKey: 'pattern:shape-v2:bottomFormation',
      buy: '저점상승·쌍바닥·역헤드앤숄더·박스권 하단 반등 중 하나 이상의 바닥 모양 후보. 일봉 확정 스캔.',
      sell: '스윙 검색기 4개(눌림목·쌍바닥·역헤드앤숄더·구름대) 신규 매수 중지. 참고 매도: exit-v2.',
      backtest: {
        exitRule: '20거래일 보유 뒤 종가(E20)', cost: '왕복 0.7%', source: 'docs/SCANNER_MENU_SCORECARD_2026-11-20.md',
        rows: [
          { period: '학습 2021~2023', n: 1304, avg: -2.02, pf: 0.69, win: null, mdd: null, excess: -0.92 },
          { period: '검증 2024-01~2025-06', n: 1055, avg: -1.15, pf: 0.80, win: null, mdd: null, excess: -0.81 },
          { period: '시험 2025-07~', n: 648, avg: -0.77, pf: 0.90, win: null, mdd: null, excess: -0.27 }
        ],
        note: '판정: 숨김 후보(사용자 승인 대상, 숨기지 않음).'
      },
      intraday: null, real: { note: '신규 매수 중지 상태(2026-11-20 문서). 실계좌 결과 미집계.' }
    },
    {
      key: 'pullbackRebreak', label: '눌림·재돌파', horizon: 'swing', adopted: false, monitorKey: 'pattern:shape-v2:pullbackRebreak',
      buy: '이동평균 눌림목·첫 눌림목 재돌파·급락 후 첫 눌림목 후보. 일봉 확정 스캔.',
      sell: '스윙 신규 매수 중지. 참고 매도: exit-v2.',
      backtest: {
        exitRule: '20거래일 보유 뒤 종가(E20)', cost: '왕복 0.7%', source: 'docs/SCANNER_MENU_SCORECARD_2026-11-20.md',
        rows: [
          { period: '학습 2021~2023', n: 3076, avg: -3.32, pf: 0.53, win: null, mdd: null, excess: -2.22 },
          { period: '검증 2024-01~2025-06', n: 2429, avg: -0.58, pf: 0.90, win: null, mdd: null, excess: -0.24 },
          { period: '시험 2025-07~', n: 1766, avg: -1.53, pf: 0.79, win: null, mdd: null, excess: -1.03 }
        ],
        note: '판정: 숨김 후보(사용자 승인 대상, 숨기지 않음). 매도를 exit-v2로 바꾸면 시험 기간이 좋아지나 학습 기간은 음수.'
      },
      intraday: null, real: { note: '신규 매수 중지 상태(2026-11-20 문서). 실계좌 결과 미집계.' }
    },
    {
      key: 'longTermQuality', label: '224일선·구름대 + 재무', horizon: 'long', adopted: false, monitorKey: 'pattern:shape-v2:longTermQuality',
      buy: '224일선과 일목균형표 구름대가 가까워지며 응축·돌파한 종목 + DART 장기 재무 관문 통과.',
      sell: '스윙 신규 매수 중지(구름대 돌파 포함). 참고 매도: exit-v2.',
      backtest: {
        exitRule: '20거래일 보유 뒤 종가(E20)', cost: '왕복 0.7%', source: 'docs/SCANNER_MENU_SCORECARD_2026-11-20.md · 재무 관문 제외 근사',
        rows: [
          { period: '학습 2021~2023', n: 21940, avg: -1.68, pf: 0.70, win: null, mdd: null, excess: -0.58 },
          { period: '검증 2024-01~2025-06', n: 15899, avg: -0.07, pf: 0.99, win: null, mdd: null, excess: 0.27 },
          { period: '시험 2025-07~', n: 12254, avg: 0.53, pf: 1.10, win: null, mdd: null, excess: 1.03 }
        ],
        note: '판정: 고침. 과거 시점 재무·유동성 자료가 없어 재무 관문을 뺀 근사.'
      },
      intraday: null, real: { note: '신규 매수 중지 상태(2026-11-20 문서). 실계좌 결과 미집계.' }
    }
  ]
};
