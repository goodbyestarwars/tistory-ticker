# -*- coding: utf-8 -*-
"""지지·저항 청산 연구 - 한 번에 실행(읽기 전용, 2026-10-21). 로컬(Windows) Claude/Codex 가 이 파일 하나만 실행하면 된다.

    python exit_sr_run_all.py [--autotrader C:\\Users\\goodb\\autotrader] [--work C:\\Users\\goodb\\exit_sr_study] [--allow-market-hours]

순서: 사전점검(필요 조건 전부 확인, 부족하면 정확한 원인만 보고하고 중단) -> 장부 스냅샷·엔진 해시 -> 일봉 캐시 자동 확보(필요 종목만)
      -> 키움 1분봉 조회 전용 수집 -> 분석 -> RESULT.md (하이브·파인엠텍·제주항공 + A/B/C 비교만).
쓰기는 작업 폴더에만 한다. autotrader 폴더는 읽기만 하고(원장은 mode=ro), 주문·예약 작업·엔진 파일에는 손대지 않는다.
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import exit_ledger_adapter as la  # noqa: E402
import exit_sr_local as loc  # noqa: E402
import exit_sr_universe as uni  # noqa: E402

KST = timezone(timedelta(hours=9))
REPO_ENGINE = os.path.join(HERE, '..', '..', 'quant-autotrade', 'local_bot', 'live_engine.py')
CASES = loc.CASES
PAT = re.compile(r'\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*(\d+)')


def inside(child, parent):
    c, p = os.path.normcase(os.path.abspath(child)), os.path.normcase(os.path.abspath(parent))
    return c == p or c.startswith(p + os.sep)


def market_open_now(now=None):
    now = now or datetime.now(KST)
    return now.weekday() < 5 and '0850' <= now.strftime('%H%M') <= '1540'


def preflight(autotrader, work, allow_market_hours=False, now=None):
    """부족한 조건을 [(코드, 설명)] 로 돌려준다. 비어 있으면 실행 가능. 키 값은 읽지도 출력하지도 않는다(이름 존재만 확인)."""
    problems = []
    if sys.version_info < (3, 8):
        problems.append(('PYTHON_TOO_OLD', 'Python 3.8 이상 필요(현재 %s)' % sys.version.split()[0]))
    if inside(work, autotrader):
        problems.append(('WORK_INSIDE_AUTOTRADER', '작업 폴더가 운영 폴더 안입니다. 별도 폴더를 지정하세요: %s' % work))
    if not os.path.isdir(autotrader):
        problems.append(('NO_AUTOTRADER_DIR', '운영 폴더가 없습니다: %s' % autotrader))
        return problems
    if not os.path.exists(os.path.join(autotrader, 'live_orders.db')):
        problems.append(('NO_LEDGER', 'live_orders.db 가 없습니다: %s' % autotrader))
    env = os.path.join(autotrader, '.env')
    if not os.path.exists(env):
        problems.append(('NO_ENV', '.env 가 없습니다(키움 분봉 조회에 필요)'))
    else:
        names = {l.split('=', 1)[0].strip() for l in open(env, encoding='utf-8') if '=' in l and not l.strip().startswith('#')}
        miss = [k for k in ('KIWOOM_APPKEY', 'KIWOOM_SECRETKEY') if k not in names]
        if miss:
            problems.append(('ENV_KEY_NAMES_MISSING', '.env 에 변수 이름이 없습니다: %s' % ', '.join(miss)))
    if not os.path.exists(os.path.join(HERE, '..', '..', 'quant-autotrade', 'local_bot', 'kiwoom.py')):
        problems.append(('NO_KIWOOM_CLIENT', '저장소에 quant-autotrade/local_bot/kiwoom.py 가 없습니다(브랜치 확인)'))
    if market_open_now(now) and not allow_market_hours:
        problems.append(('MARKET_HOURS', '장중(평일 08:50~15:40)에는 실행하지 않습니다. 키움 토큰 발급이 가동 중인 실계좌 엔진과 겹칠 수 있어서입니다. 장 마감 후 실행하거나 --allow-market-hours 를 명시하세요'))
    return problems


def fetch_daily(code, out_dir, end=None):
    """네이버 일봉(2020-01~오늘)을 종목 하나만 받아 저장. 이미 있으면 건너뜀. 실패 시 (False, 원인)."""
    path = os.path.join(out_dir, code + '.json')
    if os.path.exists(path):
        return True, 'cached'
    end = end or datetime.now(KST).strftime('%Y%m%d')
    url = 'https://fchart.stock.naver.com/siseJson.naver?symbol=%s&requestType=1&startTime=20200101&endTime=%s&timeframe=day' % (code, end)
    last = None
    for attempt in range(3):
        try:
            text = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=30).read().decode('utf-8', 'ignore')
            rows = [[d[:4] + '-' + d[4:6] + '-' + d[6:], float(o), float(h), float(l), float(c), float(v)] for d, o, h, l, c, v in PAT.findall(text)]
            if not rows:
                return False, 'EMPTY_RESPONSE'
            json.dump(rows, open(path, 'w'))
            time.sleep(0.12)
            return True, len(rows)
        except Exception as exc:
            last = type(exc).__name__
            time.sleep(1.5 * (attempt + 1))
    return False, last


def ensure_daily_cache(work, trades):
    """005930(거래일 달력)·069500(국면 대용)과 거래 종목만 받는다. 전 종목 5년 캐시는 필요 없다."""
    out = os.path.join(work, 'naver')
    os.makedirs(out, exist_ok=True)
    codes = ['005930', '069500'] + sorted({t['code'] for t in trades})
    report = {}
    for c in codes:
        ok, info = fetch_daily(c, out)
        report[c] = info if ok else 'FAIL:%s' % info
    return out, report


def probe_minute_window(client, out_dir, calendar, ensure_bars, probe_code='005930', stop_after=3):
    """유동성 큰 종목(기본 삼성전자)으로 키움 1분봉이 실제로 거슬러 올라가는 가장 이른 날을 찾는다. 연속 빈 날 stop_after 번이면 멈춘다."""
    earliest, empties = None, 0
    for d in reversed(calendar):
        try:
            ensure_bars(client, out_dir, probe_code, d)
        except Exception:
            empties += 1
            if empties >= stop_after:
                break
            continue
        import exit_strategy_study as xs
        if xs.load_day(out_dir, probe_code, d):
            earliest, empties = d, 0
        else:
            empties += 1
            if empties >= stop_after:
                break
    return earliest


def run_universe(work, autotrader, cache, api, hits_file, hold_days, kiwoom_factory=None, ensure_bars=None):
    """검색기 포착 이력 전체 가상 백테스트(실제 매수 여부와 무관). 실제 원장 결과와 섞지 않고 out_universe 에 따로 쓴다."""
    out = os.path.join(work, 'out_universe')
    os.makedirs(out, exist_ok=True)
    rdb = os.path.join(work, 'snapshots', 'research.db')
    hits, rep = uni.collect_hits(api=api, hits_file=hits_file, research_db=rdb if os.path.exists(rdb) else None)
    json.dump(rep, open(os.path.join(out, 'hits_report.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    if not hits:
        return 'NO_HITS', rep
    calendar = loc.calendar_from(cache)
    plans, plan_ex = uni.plan_entries(hits, calendar, hold_days)
    codes = sorted({e['code'] for e in plans})
    for c in codes:
        ensure_daily_cache_one(cache, c)
    minbars = os.path.join(work, 'minbars')
    os.makedirs(minbars, exist_ok=True)
    if kiwoom_factory:
        client = kiwoom_factory()
        earliest = probe_minute_window(client, minbars, calendar, ensure_bars)
        rep['minute_window_earliest_day'] = earliest
        keep = []
        for e in plans:
            if earliest is None or e['entry_day'] < earliest:
                plan_ex['BEYOND_MINUTE_DATA_WINDOW'] = plan_ex.get('BEYOND_MINUTE_DATA_WINDOW', 0) + 1
            else:
                keep.append(e)
        need = sorted({(e['code'], d) for e in keep for d in e['days'] if d <= calendar[-1]})
        for i, (code, day) in enumerate(need, 1):
            try:
                ensure_bars(client, minbars, code, day)
            except Exception as exc:
                print('fail', code, day, type(exc).__name__)
            if i % 100 == 0:
                print('bars %d/%d' % (i, len(need)), flush=True)
        plans = keep
    entries, path_ex = uni.attach_paths(plans, minbars, cache, calendar)
    if not entries:
        json.dump({'hits': rep, 'plan_exclusions': plan_ex, 'path_exclusions': path_ex}, open(os.path.join(out, 'summary.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        return 'NO_ENTRIES', {'plan': plan_ex, 'path': path_ex}
    S, res = uni.analyze(entries, cache, plan_ex, path_ex, rep, hold_days)
    json.dump(S, open(os.path.join(out, 'summary.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    import csv
    rows = uni_rows(entries, res)
    with open(os.path.join(out, 'trades_abc.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    text = uni.render(S)
    open(os.path.join(out, 'RESULT_UNIVERSE.md'), 'w', encoding='utf-8').write(text)
    return 'OK', text


def uni_rows(entries, res):
    import exit_sr_study as sr
    sel = [dict(e, scanner='+'.join(e['scanners'])) for e in entries]
    return sr.trade_diff_rows(res, sel)


def ensure_daily_cache_one(cache, code):
    ok, info = fetch_daily(code, cache)
    return ok


def pct(x):
    return '-' if x is None else '%+.2f%%' % x


def render_result(out_dir, engine_path=None):
    summ = json.load(open(os.path.join(out_dir, 'summary.json'), encoding='utf-8'))
    cases = json.load(open(os.path.join(out_dir, 'cases.json'), encoding='utf-8'))
    cov = json.load(open(os.path.join(out_dir, 'coverage.json'), encoding='utf-8'))
    L = ['# 지지·저항 청산 연구 결과 (읽기 전용 실행)', '',
         '- 기준: 실제 진입에 매도 규칙만 바꾼 시뮬레이션이며 실제 체결 순수익이 아니다. 거래 %d건 중 분석 %d건(체결가 확인 %d건), 제외 %d건.' % (
             cov['trades'], summ['entries'], summ['fill_confirmed'], len(cov['excluded'])), '']
    for e in cov['excluded']:
        L.append('  - 제외: %s %s %s' % (e.get('code'), e.get('buy_ts'), e.get('reason')))
    L += ['', '## 하이브·파인엠텍·제주항공', '']
    for c in cases:
        name = CASES.get(c['code'], c['code'])
        a = c['actual']
        L += ['### %s (%s) - 검색기 %s, 순위 %s' % (name, c['code'], c['scanner'], c.get('rank')),
              '- 진입 %s @ %s (체결가 확인: %s). 원장 매도: %s, 사유 %s, 판정가 %s, 최고 %s, 확인 %s' % (
                  c['entry'], c['entry_fill'], c['fill_confirmed'], a.get('sell_ts'), a.get('sell_reason'), a.get('sell_decision_price'), a.get('sell_peak'), a.get('sell_hits')),
              '- 일봉 구조(진입 전): 지지 %s / 저항 %s' % (c['daily_structure_before_entry']['supports'], c['daily_structure_before_entry']['resistances']),
              '- A 매도 시점 구조: %s' % json.dumps(c['structure_at_A_exit'], ensure_ascii=False),
              '- A 매도 이후: 최고 %s, 최저 %s (분봉 확보 일수 %s)' % (pct(c['after_A_exit']['high_pct']), pct(c['after_A_exit']['low_pct']), len(c['after_A_exit']['days_covered'])),
              '', '| 규칙 | 청산 | 사유 | 순수익 | MFE | MAE |', '|---|---|---|---:|---:|---:|']
        for r, v in c['rules'].items():
            L.append('| %s | %s | %s | %s | %s | %s |' % (r, v['exit'], v['reason'], pct(v['net_pct']), pct(v['mfe_pct']), pct(v['mae_pct'])))
        L.append('')
    L += ['## A / B_SR / C_SR 비교 (전체 %d건, 검증 구간 분리일 %s)' % (summ['entries'], summ['split_day']), '',
          '| 규칙 | 건수 | 평균 | 중앙값 | 승률 | MDD(%p) | 최악 | 검증 평균 | A_cycle 대비 평균차 [95%] |', '|---|---:|---:|---:|---:|---:|---:|---:|---|']
    for r, v in summ['rules'].items():
        a = v['all']
        if not a.get('n'):
            continue
        d = summ['paired_vs_A_cycle'].get(r)
        L.append('| %s | %d | %s | %s | %.0f%% | %.1f | %s | %s | %s |' % (
            r, a['n'], pct(a['mean']), pct(a['median']), a['win'], a['mdd'], pct(a['worst']), pct(v['valid'].get('mean')),
            '기준' if r == 'A_cycle' else ('-' if not d else '%+.2f [%+.2f, %+.2f]' % (d['mean_diff'], d['lo'], d['hi']))))
    ac = summ['adoption_check']
    L += ['', '## 채택 판단', '- 검증 구간 %d건 (기준 %d건 이상): %s' % (ac['valid_trades'], ac['min_valid_trades'], '충족' if ac['sufficient'] else '**부족 - 기존 A 유지**'),
          '- ' + ac['note'], '- 검색기별: ' + '; '.join('%s %d건%s' % (k, v['n'], ' (표본 부족)' if 'status' in v else '') for k, v in summ['by_scanner'].items()), '']
    open(os.path.join(out_dir, 'RESULT.md'), 'w', encoding='utf-8').write('\n'.join(L))
    return '\n'.join(L)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--autotrader', default=r'C:\Users\goodb\autotrader')
    ap.add_argument('--work', default=r'C:\Users\goodb\exit_sr_study')
    ap.add_argument('--allow-market-hours', action='store_true')
    ap.add_argument('--mode', choices=('all', 'universe', 'ledger'), default='all', help='universe=검색기 포착 이력 전체 가상 백테스트(우선), ledger=실제 원장 거래, all=둘 다(결과는 따로)')
    ap.add_argument('--api', default='https://goodbyestar.cloud', help='공개 /scan-performance-public 로 포착 이력을 받는다(검색기당 최대 1500건)')
    ap.add_argument('--hits-file', default=None, help='전체 포착 이력 JSON(예: VM scan_hits 덤프). 있으면 API 상한을 넘는 이력까지 쓴다')
    ap.add_argument('--hold-days', type=int, default=4)
    a = ap.parse_args(argv)
    problems = preflight(a.autotrader, a.work, a.allow_market_hours)
    if problems:
        print('실행 불가 - 아래 조건이 충족되지 않았습니다(아무것도 변경하지 않았습니다):')
        for code, msg in problems:
            print(' [%s] %s' % (code, msg))
        return 2
    os.makedirs(a.work, exist_ok=True)
    loc.cmd_extract(a.autotrader, a.work, REPO_ENGINE)
    trades = json.load(open(os.path.join(a.work, 'trades.json'), encoding='utf-8'))
    cache, rep = ensure_daily_cache(a.work, trades)
    fails = {k: v for k, v in rep.items() if str(v).startswith('FAIL')}
    json.dump(rep, open(os.path.join(a.work, 'daily_cache_report.json'), 'w'))
    if '005930' in fails:
        print('실행 불가 - 일봉 캐시(거래일 달력) 확보 실패:', fails['005930'], '(네이버 fchart 접속 확인)')
        return 3
    if a.mode in ('all', 'universe'):
        sys.path.insert(0, os.path.join(HERE, '..', '..', 'quant-autotrade', 'local_bot'))
        from kiwoom import KiwoomClient
        import exit_strategy_calibrate as cal
        keys = loc.xc.read_env_keys(os.path.join(a.autotrader, '.env'))
        status, payload = run_universe(a.work, a.autotrader, cache, a.api, a.hits_file, a.hold_days,
                                       lambda: KiwoomClient(keys.get('KIWOOM_APPKEY'), keys.get('KIWOOM_SECRETKEY')), cal.ensure_bars)
        print('=== 검색기 포착 이력 전체 가상 백테스트 ===')
        print(payload if status == 'OK' else '결과 없음(%s): %s' % (status, json.dumps(payload, ensure_ascii=False)))
    if a.mode in ('all', 'ledger'):
        loc.cmd_bars(a.work, os.path.join(a.autotrader, '.env'), cache)
        loc.cmd_analyze(a.work, cache, list(CASES))
        print('=== 실제 원장 거래 ===')
        print(render_result(os.path.join(a.work, 'out')))
    print('\n결과 폴더: %s (out_universe\\RESULT_UNIVERSE.md, out\\RESULT.md)' % a.work)
    return 0


if __name__ == '__main__':
    sys.exit(main())
