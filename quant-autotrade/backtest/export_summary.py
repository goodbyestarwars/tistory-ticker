# -*- coding: utf-8 -*-
"""portfolio_sim.py 결과(portfolio.json)를 웹 화면용 정적 데이터(data/quant-backtest.js)로 내보낸다 (2026-10-11).

- 실제 백테스트 결과만 담는다. 가짜·예시 값은 만들지 않는다. 원본 JSON이 없으면 실패한다.
- 대상: 설정 A(동시 5종목·종목당 10%·투자 30%), 필터 없음(F0). 검색기별로 청산 4종을 모두 담고 화면이 정렬·선택한다.
- 파일 형식: `window.QUANT_BACKTEST = {...};` (data/ 규칙). 계좌·키·개인정보 없음.
사용: python export_summary.py --in portfolio.json --out ../../data/quant-backtest.js
"""
import argparse
import json
import os
import time

SCANNER_LABEL = {
    'maCloudBreakout': '이동평균 구름 돌파', 'doubleBottom': '쌍바닥', 'invHeadShoulders': '역헤드앤숄더',
    'pullback': '눌림목', 'shortTermMaBreakout': '단기이평 돌파(백테스트 전용)', 'BASELINE': '무작위 진입(대조군)',
}
EXIT_LABEL = {'fix3_5': '고정 −3% / +5%', 'fix5_10': '고정 −5% / +10%', 'trail_atr': 'ATR 추적 청산', 'time10': '10일 보유'}
CONFIG = 'A_spec'
FILTER = 'F0'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='src', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    data = json.load(open(a.src, encoding='utf-8'))
    rows = []
    for key, run in data['runs'].items():
        cfg, scanner, exit_, flt = key.split('|')
        if cfg != CONFIG or flt != FILTER or scanner == 'ALL':
            continue
        full, dev, val, trades = run['full'], run['dev'], run['val'], run['trades']
        rows.append({
            'scanner': scanner, 'scannerLabel': SCANNER_LABEL.get(scanner, scanner), 'exit': exit_, 'exitLabel': EXIT_LABEL.get(exit_, exit_),
            'ret': round(full['ret'], 4), 'cagr': None if full['cagr'] is None else round(full['cagr'], 4), 'mdd': round(full['mdd'], 4),
            'trades': trades.get('n', 0), 'win': None if not trades.get('n') else round(trades['win'], 4),
            'pf': None if trades.get('pf') is None else round(trades['pf'], 2),
            'devRet': round(dev['ret'], 4), 'valRet': round(val['ret'], 4), 'avgInvested': round(run['avgInvested'], 3),
        })
    b = data['bench']
    out = {
        'generatedAt': time.strftime('%Y-%m-%d'),
        'kind': 'backtest',
        'period': data['dates'], 'devValCut': data['cut'],
        'config': {'maxPositions': 5, 'perPosition': 0.10, 'totalExposure': 0.30, 'cost': '왕복 0.4% + 슬리피지(진입 0.2%·청산 0.3%) 반영', 'universe': '국내 234종목 일봉(생존편향 있음)'},
        'benchmark': {'KOSPI': {k: round(v, 4) for k, v in b['KOSPI'].items()}, 'KOSDAQ': {k: round(v, 4) for k, v in b['KOSDAQ'].items()}},
        'verdict': '통과 기준(검증 구간 신뢰하한 > 0)을 만족한 전략 없음 — 실거래 매수 비활성',
        'caveats': ['개발/검증 구간은 같은 기간을 둘로 나눈 것이라 독립 검증이 아닙니다.', '조합 약 100개 중 상위만 보면 승자 선택 효과가 있습니다.',
                    '과거 성과이며 수익을 보장하지 않습니다. 모의매매·실거래 성과와 합치지 않습니다.'],
        'rows': rows,
    }
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, 'w', encoding='utf-8', newline='\n') as f:
        f.write('/* 자동매매 백테스트 요약 - quant-autotrade/backtest/export_summary.py 로 생성(수정하지 말 것) */\n')
        f.write('window.QUANT_BACKTEST = ' + json.dumps(out, ensure_ascii=False, indent=1) + ';\n')
    print('rows', len(rows), '->', a.out)


if __name__ == '__main__':
    main()
