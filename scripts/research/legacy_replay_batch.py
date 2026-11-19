# -*- coding: utf-8 -*-
"""연구용(2026-11-20): 자동매매가 실제로 사는 스윙 검색기 4개(pullback·doubleBottom·invHeadShoulders·maCloudBreakout)를
운영 scripts/cloud-vm/pattern_detect.py의 같은 판정 함수·같은 통과 조건으로 5년 일봉 캐시에 매일 재현해 신호 TSV로 낸다.
t일 판정에는 t일까지 최근 WIN봉만 쓴다(미래 비참조). 주문·VM과 무관. 설계: docs/SCANNER_MENU_SCORECARD_2026-11-20.md 3단계.
재현하지 않는 것: 공통 시총 3,000억 관문(과거 시총 없음), 후보 20개 초과 시 품질 게이트(전 종목 비교), 종목명 기준 제외는 universe.json 이름으로만.
실행: python legacy_replay_batch.py <작업 폴더> <out.tsv> [shard=0] [shards=1]
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'cloud-vm'))
import pattern_detect as pd_  # noqa: E402

WIN = 300
CUTOFF = os.environ.get('CUTOFF', '20261113')


def detect_all(daily):
    out = []
    if len(daily) >= pd_.PULLBACK_MIN_DAYS:
        pb = pd_.detect_pullback(daily)
        if pb and pd_.pattern_grade(pb['score'], pd_.PULLBACK_MIN_SCORE):
            out.append(('pullback', pb['score']))
    if len(daily) >= pd_.MA_CLOUD_MIN_DAYS:
        mc = pd_.detect_ma_cloud_breakout(daily)
        if mc:
            out.append(('maCloudBreakout', mc.get('score')))
    if len(daily) >= pd_.BOX_WINDOW:
        db = pd_.detect_double_bottom(daily)
        if db and not db['breakout'] and pd_.pattern_grade(db['score']):
            out.append(('doubleBottom', db['score']))
        ihs = pd_.detect_inv_head_shoulders(daily)
        if ihs and not ihs['breakout'] and pd_.pattern_grade(ihs['score'], pd_.IHS_MIN_SCORE):
            out.append(('invHeadShoulders', ihs['score']))
    return out


def main(lab, out, shard=0, shards=1):
    names = {}
    try:
        uni = json.load(open(os.path.join(lab, 'universe.json'), encoding='utf-8'))
        names = {str(k): str(v) for k, v in uni.items()} if isinstance(uni, dict) else {}
    except (OSError, ValueError):
        pass
    files = sorted(f for f in os.listdir(os.path.join(lab, 'cache')) if f.endswith('.json'))[shard::shards]
    n = hits = 0
    with open(out, 'w', encoding='utf-8') as fo:
        fo.write('code\td\tscanner\tscore\n')
        for f in files:
            code = f[:6]
            px = [r for r in json.load(open(os.path.join(lab, 'cache', f), encoding='utf-8'))['px']
                  if r[0] < CUTOFF and r[1] > 0 and r[2] > 0 and r[3] > 0 and r[4] > 0]
            bars = [{'date': r[0][:4] + '-' + r[0][4:6] + '-' + r[0][6:8], 'open': r[1], 'high': r[2], 'low': r[3],
                     'close': r[4], 'volume': r[5] or 0} for r in px]
            stock = {'code': code, 'name': names.get(code, code)}
            if bars and pd_.is_excluded_stock(stock, bars):
                n += 1
                continue
            for i in range(pd_.MA_CLOUD_MIN_DAYS - 1, len(bars)):
                window = bars[max(0, i - WIN + 1):i + 1]
                for key, score in detect_all(window):
                    fo.write('%s\t%s\t%s\t%s\n' % (code, px[i][0], key, '' if score is None else score))
                    hits += 1
            n += 1
            if n % 100 == 0:
                print(n, 'files', hits, 'signals', flush=True)
    print('DONE', n, hits)


if __name__ == '__main__':
    a = sys.argv[1:]
    main(a[0], a[1], int(a[2]) if len(a) > 2 else 0, int(a[3]) if len(a) > 3 else 1)
