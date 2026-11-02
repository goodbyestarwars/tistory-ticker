#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
종목 스토리 카드 자동 생성 (PC 로컬, 2주 1회 수준의 스냅샷).

키움 REST(ka10001 기본정보 / ka10014 공매도 / ka10059 투자자별 매매동향)로 종목마다 받아서
'서로 다른 자료를 겹쳐야 보이는 발견'만 카드로 만든다. 기준을 넘지 않는 종목은 카드를 만들지 않는다.
상태 라벨(차트 good 같은 것)은 만들지 않는다. 카드마다 '틀렸다면:' 반증 조건을 달고,
마지막에 '이 이야기가 틀려지는 때' 카드를 붙인다.

사용법 (저장소 루트에 .env: KIWOOM_APPKEY / KIWOOM_SECRETKEY, fetch_investor_flow.py와 동일):
  python scripts/build_stock_stories.py --codes 005930,000660,035420   # 소량 점검
  python scripts/build_stock_stories.py                                 # data/sectors-v3.js 종목 풀
  python scripts/build_stock_stories.py --all                           # data/company-profiles.js 전 종목

수기 작성 카드(한화오션 등, "auto" 표시가 없는 항목)는 덮어쓰지 않는다. 이전 실행의 auto 항목은
이번 실행 결과로 통째로 교체한다. 전송·인증·종목 풀은 fetch_investor_flow.py 것을 그대로 쓴다.

주의: 키움 응답 필드는 MCP 실응답(bus_pro=직전 결산 영업이익 억원, mac=시가총액 억원,
250hgst/250lwst=52주 고저, 투자자 금액=백만원, 공매도 shrts_qty는 일별 거래량)을 기준으로 했고
PC에서 소량(--codes)으로 먼저 확인할 것. 공매도 ovr_shrts_qty는 잔고가 아니라 조회 시작일부터의
거래량 누적이므로 쓰지 않는다.
"""

import json
import os
import re
import sys
import time
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_investor_flow as fif  # noqa: E402  (인증·전송·종목 풀 재사용)

REPO_ROOT = fif.REPO_ROOT
OUTPUT_FILE = os.path.join(REPO_ROOT, 'data', 'stock-stories.js')
PROFILES_FILE = os.path.join(REPO_ROOT, 'data', 'company-profiles.js')
LOOKBACK_DAYS = 45          # 20거래일 확보용
WINDOW = 20                 # 거래일
RECENT = 5

# 카드를 만들 기준(바꾸면 카드 수가 크게 달라진다)
DRAWDOWN_MIN = 35.0         # 흑자인데 52주 고점 대비 이만큼 이상 하락
LOW_NEAR = 1.05             # 52주 저가의 5% 이내를 '저가 근처'로
FLOW_MIN_PCT_OF_CAP = 0.3   # 순매도 쪽이 시가총액의 0.3% 이상
FLOW_OFFSET_RATIO = 0.6     # 반대편 순매수가 그 순매도의 60% 이상
SHORT_HIGH_PCT = 8.0        # 20거래일 평균 공매도 비중
SHORT_JUMP_RATIO = 3.0      # 최근 5거래일 평균이 이전 15거래일 평균의 3배 이상
SHORT_JUMP_MIN_PCT = 4.0    # 그리고 최근 평균이 이 값 이상
PCT_CUT = {'gap': 85, 'flow': 90, 'short': 90}   # 시장 전체가 같이 빠진 날 모든 종목에 카드가 붙지 않게, 이번 실행 분포의 상위 일부만 통과
TH0 = {'gap': DRAWDOWN_MIN, 'flow': FLOW_MIN_PCT_OF_CAP, 'short': SHORT_HIGH_PCT}
MAX_STORY_BYTES = 600_000   # 단일 파일 로드 한계 경고선(넘으면 분할 필요)

NOTE = '작성 시점 값이라 실시간으로 바뀌지 않는다. 사라는 말도 팔라는 말도 아니다.'


def num(v):
    try:
        return float(str(v).replace(',', '').replace('+', ''))
    except (TypeError, ValueError):
        return None


def absnum(v):
    n = num(v)
    return abs(n) if n is not None else None


def won_big(eok):
    """억원 단위 값 -> 표기. 1조 이상은 조원."""
    a = abs(eok)
    if a >= 10000:
        return '%s조원' % ('%.2f' % (a / 10000)).rstrip('0').rstrip('.')
    return '{:,.0f}억원'.format(a)


def fmt_date(dt):
    return '%s-%s-%s' % (dt[0:4], dt[4:6], dt[6:8])


def short_shares(short_rows):
    """공매도 행(최신 우선) -> 일별 거래량 대비 공매도 비중(%) 목록(최신 우선, 거래량 없는 날 제외)."""
    out = []
    for r in short_rows:
        vol, sh = absnum(r.get('trde_qty')), absnum(r.get('shrts_qty'))
        if vol and sh is not None:
            out.append((r.get('dt'), sh / vol * 100))
    return out


def card_profit_gap(b, th=TH0):
    """흑자인데 주가는 고점에서 크게 내려온 종목(영업이익은 직전 결산 1개 값이라 '증가'는 말하지 않는다)."""
    op, cur, hi = b.get('bus_pro'), b.get('cur'), b.get('hi')
    if op is None or not cur or not hi or op <= 0:
        return None
    dd = (cur / hi - 1) * 100
    if dd > -th['gap']:
        return None
    return {
        'title': '흑자인데 주가는 고점 대비 %d%%' % round(dd),
        'pair': [{'k': '직전 결산 영업이익', 'v': won_big(op), 't': 'up'},
                 {'k': '고점 대비 주가', 'v': '%d%%' % round(dd), 't': 'dn'}],
        'rows': [{'label': '영업이익 ' + won_big(op), 'val': '직전 결산 연간', 'w': 100, 't': 'up'},
                 {'label': '{:,.0f} → {:,.0f}원'.format(hi, cur), 'val': '52주 고점 대비',
                  'w': max(1, round(cur / hi * 100)), 't': 'dn'}],
        'sub': '직전 결산 영업이익은 흑자인데 주가는 52주 고점(%s원)보다 %.1f%% 낮다.' % ('{:,.0f}'.format(hi), abs(dd)),
        'detail': ['PER %s배. 영업이익은 직전 결산 한 해 값이라 이익이 늘었는지 줄었는지는 이 자료로 알 수 없다.'
                   % ('%.1f' % b['per'] if b.get('per') else '-'),
                   '틀렸다면: 다음 분기 영업이익이 적자로 돌아서면 이익은 나는데 주가만 빠졌다는 전제가 깨진다.'],
        'src': '키움증권(영업이익·52주 고점)', 'topics': ['earnings', 'position'],
    }


def card_below_book(b):
    pbr, cur, lo = b.get('pbr'), b.get('cur'), b.get('lo')
    if not pbr or pbr <= 0 or pbr >= 1 or not cur or not lo or cur > lo * LOW_NEAR:
        return None
    hi = b.get('hi')
    top = max(hi or 0, b.get('bps') or 0, cur)  # 주당순자산이 52주 고점보다 클 수 있어 가장 큰 값을 100으로 잡는다
    rows = []
    if hi:
        rows.append({'label': '52주 고점 {:,.0f}원'.format(hi), 'val': '', 'w': max(1, round(hi / top * 100)), 't': 'n'})
    if b.get('bps'):
        rows.append({'label': '주당순자산 {:,.0f}원'.format(b['bps']), 'val': '직전 결산 기준',
                     'w': max(1, round(b['bps'] / top * 100)), 't': 'n'})
    rows.append({'label': '현재 {:,.0f}원'.format(cur), 'val': '52주 저가 {:,.0f}원'.format(lo),
                 'w': max(1, round(cur / top * 100)), 't': 'dn'})
    return {
        'title': '순자산보다 싼데(PBR %.2f배) 52주 저가 근처다' % pbr,
        'pair': [{'k': 'PBR', 'v': '%.2f배' % pbr, 't': 'n'},
                 {'k': '52주 저가 대비', 'v': '+%.1f%%' % ((cur / lo - 1) * 100), 't': 'dn'}],
        'rows': rows,
        'sub': '현재가 %s원은 52주 저가(%s원)보다 %.1f%% 높은 자리다. PBR은 직전 결산 순자산 기준이다.'
               % ('{:,.0f}'.format(cur), '{:,.0f}'.format(lo), (cur / lo - 1) * 100),
        'detail': ['틀렸다면: 52주 저가(%s원)를 종가로 내주면 싸서 막힌다는 이야기는 틀린 것이다.' % '{:,.0f}'.format(lo)],
        'src': '키움증권(PBR·52주 저가)', 'topics': ['position'],
    }


def window_sums(invsr_rows, key):
    """투자자 행(최신 우선) -> (20거래일 합, 5거래일 합), 단위 억원(원자료 백만원)."""
    vals = [num(r.get(key)) for r in invsr_rows[:WINDOW]]
    vals = [v for v in vals if v is not None]
    if len(vals) < WINDOW // 2:
        return None
    return sum(vals) / 100.0, sum(vals[:RECENT]) / 100.0


GROUPS = (('외국인', 'frgnr_invsr'), ('기관', 'orgn'), ('개인', 'ind_invsr'))


def card_flow(b, invsr_rows, th=TH0):
    cap = b.get('mac')
    if not cap or cap <= 0:
        return None
    sums = {}
    for name, key in GROUPS:
        s = window_sums(invsr_rows, key)
        if s:
            sums[name] = s
    if len(sums) < 3:
        return None
    seller = min(sums, key=lambda k: sums[k][0])
    sell = -sums[seller][0]
    if sell <= 0 or sell < cap * th['flow'] / 100:
        return None
    buyers = [k for k in sums if k != seller and sums[k][0] > 0]
    if not buyers:
        return None
    buyer = max(buyers, key=lambda k: sums[k][0])
    if sums[buyer][0] < sell * FLOW_OFFSET_RATIO:
        return None
    top = max(abs(v[0]) for v in sums.values())
    rows = [{'label': name, 'val': ('+' if v[0] > 0 else '-') + won_big(v[0]),
             'w': max(1, round(abs(v[0]) / top * 100)), 't': 'up' if v[0] > 0 else 'dn'}
            for name, v in sorted(sums.items(), key=lambda kv: kv[1][0])]
    r5 = sums[seller][1]
    return {
        'title': '%s이 판 %s을 %s이 받았다' % (seller, won_big(sell), buyer),
        'rows': rows,
        'sub': '최근 %d거래일 순매수액이다. %s은 시가총액의 %.1f%%를 순매도했다.' % (WINDOW, seller, sell / cap * 100),
        'detail': ['최근 %d거래일 %s은 %s%s이다.' % (RECENT, seller, '+' if r5 > 0 else '-', won_big(r5)),
                   '틀렸다면: %s이 5거래일 연속 순매수로 돌아서면 이 쏠림은 일시적인 것이다.' % seller],
        'src': '키움증권 투자자별 매매동향(금액)', 'topics': ['flow'],
    }, {'seller': seller}


def card_short(b, short_rows, th=TH0):
    sh = short_shares(short_rows)[:WINDOW]
    if len(sh) < WINDOW // 2:
        return None
    recent = [v for _, v in sh[:RECENT]]
    prior = [v for _, v in sh[RECENT:]]
    avg20 = sum(v for _, v in sh) / len(sh)
    r5 = sum(recent) / len(recent)
    p = sum(prior) / len(prior) if prior else 0
    peak_dt, peak = max(sh, key=lambda x: x[1])
    cur, avg_pr = b.get('cur'), absnum(short_rows[0].get('shrts_avg_pric')) if short_rows else None
    base = ['공매도 비중은 거래량 기준이며 잔고가 아니다. 차입 공매도와 헤지 목적 공매도는 구분할 수 없다.']
    if avg_pr and cur:
        base.insert(0, '최근 거래일 공매도 평균단가 %s원은 종가(%s원)보다 %.1f%% %s.'
                    % ('{:,.0f}'.format(avg_pr), '{:,.0f}'.format(cur), abs(cur / avg_pr - 1) * 100,
                       '높다' if cur >= avg_pr else '낮다'))
    if p > 0 and r5 >= SHORT_JUMP_MIN_PCT and r5 / p >= SHORT_JUMP_RATIO:
        card = {
            'title': '공매도 비중이 %.1f배로 뛰었다' % (r5 / p),
            'rows': [{'label': '이전 %d거래일 평균' % len(prior), 'val': '%.1f%%' % p, 'w': max(1, round(p / r5 * 100)), 't': 'n'},
                     {'label': '최근 %d거래일 평균' % RECENT, 'val': '%.1f%%' % r5, 'w': 100, 't': 'dn'}],
            'sub': '거래량 중 공매도가 차지한 비중이 최근 %d거래일 평균 %.1f%%로, 이전 %d거래일 평균(%.1f%%)의 %.1f배다.'
                   % (RECENT, r5, len(prior), p, r5 / p),
            'detail': base + ['틀렸다면: 5거래일 평균 비중이 이전 평균(%.1f%%) 근처로 돌아오면 매도 압력 이야기는 틀린 것이다.' % p],
        }
        warn = max(p * 1.2, SHORT_JUMP_MIN_PCT)
    elif avg20 >= th['short']:
        card = {
            'title': '거래량의 %d%%가 공매도다' % round(avg20),
            'rows': [{'label': '%d거래일 평균' % len(sh), 'val': '%.1f%%' % avg20, 'w': 100, 't': 'dn'},
                     {'label': '최근 %d거래일 평균' % RECENT, 'val': '%.1f%%' % r5, 'w': max(1, min(100, round(r5 / avg20 * 100))), 't': 'dn' if r5 >= avg20 else 'n'},
                     {'label': '최고 %s' % fmt_date(peak_dt)[5:], 'val': '%.1f%%' % peak, 'w': max(1, min(100, round(peak / max(peak, avg20) * 100))), 't': 'n'}],
            'sub': '최근 %d거래일 거래량 대비 공매도 비중 평균이 %.1f%%다. 가장 높았던 날은 %s로 %.1f%%였다.'
                   % (len(sh), avg20, fmt_date(peak_dt)[5:], peak),
            'detail': base + ['틀렸다면: 5거래일 평균 비중이 %d%% 아래로 내려가면 공매도 압력 이야기는 틀린 것이다.' % round(avg20 * 0.7)],
        }
        warn = avg20 * 0.7
    else:
        return None
    card['src'] = '키움증권 공매도 추이'
    card['topics'] = ['short-credit']
    return card, {'r5': r5, 'warn': warn, 'rising': card['title'].startswith('공매도 비중이')}


def card_risk(b, short_meta):
    cur, lo, hi = b.get('cur'), b.get('lo'), b.get('hi')
    rows = []
    if cur and lo and hi:
        rows.append({'label': '종가 {:,.0f}원'.format(cur), 'val': '{:,.0f}원(52주 저가) 종가 이탈 경고'.format(lo),
                     'w': max(1, round(cur / hi * 100)), 't': 'n', 'm': max(1, round(lo / hi * 100))})
    if short_meta:
        r5, warn = short_meta['r5'], short_meta['warn']
        if short_meta['rising']:
            rows.append({'label': '공매도 비중 5일 평균', 'val': '%.1f%% / %.1f%% 초과 경고' % (r5, warn),
                         'w': max(1, min(100, round(r5 / (warn * 2) * 100))), 't': 'n', 'm': 50})
        else:
            rows.append({'label': '공매도 비중 5일 평균', 'val': '%.1f%% / %.1f%% 미만이면 이야기 수정' % (r5, warn),
                         'w': max(1, min(100, round(r5 / (warn * 2) * 100))), 't': 'n', 'm': 50})
    if not rows:
        return None
    return {'title': '이 이야기가 틀려지는 때', 'rows': rows, 'sub': '빨간 선을 넘으면 이야기를 다시 써야 한다.',
            'detail': [NOTE], 'src': '키움증권 일봉·수급·공매도', 'topics': ['risk']}


def parse_basic(basic):
    return {
        'name': basic.get('stk_nm') or '',
        'cur': absnum(basic.get('cur_prc')), 'hi': absnum(basic.get('250hgst')), 'lo': absnum(basic.get('250lwst')),
        'per': num(basic.get('per')), 'pbr': num(basic.get('pbr')), 'bps': num(basic.get('bps')),
        'mac': num(basic.get('mac')), 'bus_pro': num(basic.get('bus_pro')),
    }


def pctile(vals, pct):
    vals = sorted(vals)
    return vals[min(len(vals) - 1, int(len(vals) * pct / 100))] if vals else None


def derive_thresholds(raws):
    """raws: [(basic, short_rows, invsr_rows)] -> 이번 실행 분포 기준 임계값(절대 하한 이상)."""
    gaps, flows, shorts = [], [], []
    for basic, short_rows, invsr_rows in raws:
        b = parse_basic(basic)
        if b['bus_pro'] and b['bus_pro'] > 0 and b['cur'] and b['hi']:
            gaps.append(-(b['cur'] / b['hi'] - 1) * 100)
        sh = short_shares(sorted(short_rows, key=lambda r: r.get('dt', ''), reverse=True))[:WINDOW]
        if len(sh) >= WINDOW // 2:
            shorts.append(sum(v for _, v in sh) / len(sh))
        rows = sorted(invsr_rows, key=lambda r: r.get('dt', ''), reverse=True)
        sums = [window_sums(rows, k) for _, k in GROUPS]
        if b['mac'] and b['mac'] > 0 and all(sums):
            flows.append(max(0.0, -min(x[0] for x in sums)) / b['mac'] * 100)
    th = dict(TH0)
    for key, vals in (('gap', gaps), ('flow', flows), ('short', shorts)):
        cut = pctile(vals, PCT_CUT[key])
        if cut is not None:
            th[key] = max(TH0[key], cut)
    return th


def build_entry(code, basic, short_rows, invsr_rows, today, th=TH0):
    """종목 하나의 스토리 항목. 기준을 넘는 카드가 없으면 None."""
    b = parse_basic(basic)
    short_rows = sorted(short_rows, key=lambda r: r.get('dt', ''), reverse=True)
    invsr_rows = sorted(invsr_rows, key=lambda r: r.get('dt', ''), reverse=True)
    as_of = short_rows[0]['dt'] if short_rows else (invsr_rows[0]['dt'] if invsr_rows else None)
    if not b['name'] or not as_of or not b['cur']:
        return None
    cards = []
    for c in (card_profit_gap(b, th), card_below_book(b)):
        if c:
            cards.append(c)
    flow = card_flow(b, invsr_rows, th) if invsr_rows else None
    if flow:
        cards.append(flow[0])
    short = card_short(b, short_rows, th) if short_rows else None
    if short:
        cards.append(short[0])
    cards = cards[:3]
    if not cards:
        return None
    risk = card_risk(b, short[1] if short and short[0] in cards else None)
    if risk:
        cards.append(risk)
    d = fmt_date(as_of)
    for c in cards:
        c['asOf'] = d
    return {'name': b['name'], 'asOf': d, 'written': today, 'auto': True, 'cards': cards}


def load_existing():
    try:
        with open(OUTPUT_FILE, 'r', encoding='utf-8') as f:
            src = f.read()
    except OSError:
        return {}
    m = re.search(r'window\.STOCK_STORIES\s*=\s*(\{.*\})\s*;?\s*$', src, re.S)
    return json.loads(m.group(1)) if m else {}


def merge(existing, auto):
    """수기 항목(auto 아님)은 보존, 이전 auto 항목은 이번 결과로 교체. 같은 코드면 수기가 이긴다."""
    out = {c: v for c, v in existing.items() if not v.get('auto')}
    for c, v in auto.items():
        out.setdefault(c, v)
    return out


def write_output(data):
    text = 'window.STOCK_STORIES=' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n'
    with open(OUTPUT_FILE, 'w', encoding='utf-8', newline='') as f:
        f.write(text)
    size = len(text.encode('utf-8'))
    fif.log('저장 완료: %s (%d종목, %d바이트)' % (OUTPUT_FILE, len(data), size))
    if size > MAX_STORY_BYTES:
        fif.log('경고: %d바이트 - 모든 종목 페이지가 이 파일을 통째로 받는다. 파일 분할이 필요하다.' % size)


def universe(args):
    if '--codes' in args:
        raw = args[args.index('--codes') + 1]
        return {c: '' for c in raw.split(',') if c}
    if '--all' in args:
        with open(PROFILES_FILE, 'r', encoding='utf-8') as f:
            src = f.read()
        data = json.loads(re.search(r'window\.COMPANY_PROFILES\s*=\s*(\{.*\})\s*;?\s*$', src, re.S).group(1))
        return {c: '' for c in data.get('companies', {})}
    return fif.load_stock_codes()


def main():
    fif.load_dotenv()
    appkey, secret = os.environ.get('KIWOOM_APPKEY'), os.environ.get('KIWOOM_SECRETKEY')
    if not appkey or not secret:
        fif.log('KIWOOM_APPKEY / KIWOOM_SECRETKEY가 필요합니다(.env 또는 환경변수).')
        sys.exit(1)
    args = sys.argv[1:]
    codes = list(universe(args).keys())
    token = fif.get_token(appkey, secret)
    end = datetime.now()
    strt_dt, end_dt = (end - timedelta(days=LOOKBACK_DAYS)).strftime('%Y%m%d'), end.strftime('%Y%m%d')
    today = end.strftime('%Y-%m-%d')
    raws, failed = [], 0
    for i, code in enumerate(codes, 1):
        try:
            basic = fif.call_tr(token, 'ka10001', '/api/dostk/stkinfo', {'stk_cd': code})
            time.sleep(fif.THROTTLE_SEC)
            short = fif.call_tr(token, 'ka10014', '/api/dostk/shsa', {'stk_cd': code, 'strt_dt': strt_dt, 'end_dt': end_dt})
            time.sleep(fif.THROTTLE_SEC)
            invsr = fif.call_tr(token, 'ka10059', '/api/dostk/stkinfo',
                                {'stk_cd': code, 'dt': end_dt, 'amt_qty_tp': '1', 'trde_tp': '0', 'unit_tp': '1'})
            time.sleep(fif.THROTTLE_SEC)
            raws.append((code, basic, short.get('shrts_trnsn') or [], invsr.get('stk_invsr_orgn') or []))
        except Exception as e:  # 한 종목 실패가 전체를 멈추지 않게 - 실패는 집계해서 보고한다.
            failed += 1
            fif.log('%s 실패: %s' % (code, e))
        if i % 100 == 0:
            fif.log('%d/%d 수집, 실패 %d' % (i, len(codes), failed))
    th = derive_thresholds([(b, s_, v) for _, b, s_, v in raws])
    fif.log('이번 실행 임계값: 이익괴리 고점대비 -%.1f%%, 수급쏠림 시총의 %.2f%%, 공매도 20일평균 %.1f%%' % (th['gap'], th['flow'], th['short']))
    auto = {}
    for code, basic, short, invsr in raws:
        entry = build_entry(code, basic, short, invsr, today, th)
        if entry:
            auto[code] = entry
    kinds = {}
    for v in auto.values():
        for c in v['cards']:
            kinds[c['topics'][-1]] = kinds.get(c['topics'][-1], 0) + 1
    fif.log('대상 %d종목 / 카드 생성 %d종목 / 실패 %d / 카드 종류별 %s' % (len(codes), len(auto), failed, kinds))
    if failed > len(codes) * 0.2:
        fif.log('실패가 20%를 넘어 파일을 쓰지 않습니다. 키·호출 제한을 확인하세요.')
        sys.exit(2)
    write_output(merge(load_existing(), auto))


if __name__ == '__main__':
    main()
