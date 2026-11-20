#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""신규 상장 종목을 data/krx_map.js에 자동 등록한다 (추가 전용, 키 없음, 새 상시 프로세스 없음).

소스
- 주 소스: 한국투자증권 공개 종목 마스터(scripts/kis_master.py). 일반주·스팩·ETF·리츠 등.
- 교차 확인: 네이버 시총 JSON(m.stock.naver.com/api/stocks/marketValue/{KOSPI|KOSDAQ}).
  market_board.py가 이미 쓰는 경로다. KIS 마스터에 있는 코드는 네이버 목록에도 있을 때만 추가하고,
  한쪽에만 보이는 코드는 추가하지 않고 로그로만 남긴다(상장 직후 한쪽 반영 지연·형식 변경 오탐 방지).
- ETN: KIS 마스터에 없어서 네이버 `stockEndType == "etn"`만 쓴다(교차 확인 불가임을 로그에 명시).
  ETN은 krx_map.js의 별도 쌍 배열(KRX_ETN)에 둔다 — 이유는 scripts/krx_map_io.py 머리말 참고.

안전장치
- 삭제하지 않는다(상장폐지 의심 코드는 보고만). 같은 이름이 다른 코드로 이미 있으면 건너뛰고 로그.
- 소스 행 수·통제 종목(삼성전자 등)·네이버 시장 구분이 어긋나면 파일을 쓰지 않고 실패한다.
- 한 번에 추가가 MAX_ADDITIONS를 넘으면 파서 오류로 보고 중단한다(최초 대량 등록은 --allow-bulk).
- 파일은 임시 파일에 쓴 뒤 교체한다.

사용: python scripts/sync_listings.py [--dry-run] [--allow-bulk]
"""
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kis_master  # noqa: E402
import krx_map_io  # noqa: E402

# KIS 종목군 중 등록 대상. 기존 krx_map.js가 이미 담고 있는 종류(주권·ETF·리츠·인프라·투자회사·
# 예탁증서·외국주권·우선주)와 같다. ETN은 KIS 마스터에 없다.
KIS_GROUPS = {'ST', 'EF', 'RT', 'IF', 'MF', 'DR', 'FS', 'PF'}
ETF_GROUPS = {'EF'}
NAVER_URL = 'https://m.stock.naver.com/api/stocks/marketValue/%s?page=%d&pageSize=100'
MIN_KIS = {'KOSPI': 1500, 'KOSDAQ': 1500}
MIN_NAVER = {'KOSPI': 1800, 'KOSDAQ': 1500}
MIN_ETN = 200
MAX_ADDITIONS = 600
NAVER_PAGE_LIMIT = 40
NAVER_GAP_SEC = 0.3


def log(msg):
    print('[sync_listings] ' + msg, flush=True)


def fetch_naver_market(exchange, getter=None, sleep=time.sleep):
    """{code: {'name', 'type'}}. 시장 구분이 다르거나 응답이 비면 예외."""
    rows = {}
    for page in range(1, NAVER_PAGE_LIMIT + 1):
        data = (getter or _get_json)(NAVER_URL % (exchange, page))
        if data.get('stockListCategoryType') != exchange:
            raise ValueError('네이버 시장 구분 불일치: %s' % exchange)
        stocks = data.get('stocks')
        if not isinstance(stocks, list) or (not stocks and page == 1):
            raise ValueError('네이버 목록 비어 있음: %s p%d' % (exchange, page))
        for item in stocks:
            code = str(item.get('itemCode') or '')
            name = str(item.get('stockName') or '').strip()
            if code and name:
                rows[code] = {'name': name, 'type': str(item.get('stockEndType') or '')}
        if len(stocks) < 100:
            return rows
        sleep(NAVER_GAP_SEC)
    raise ValueError('네이버 페이지 상한 초과: %s' % exchange)


def _get_json(url, timeout=20, retries=2):
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return json.loads(response.read().decode('utf-8'))
        except Exception as exc:  # 일시 오류만 재시도
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise last


def validate_sources(kis_rows, naver):
    for market, minimum in MIN_KIS.items():
        count = sum(1 for r in kis_rows if r['market'] == market)
        if count < minimum:
            raise ValueError('KIS 마스터 행 수 부족: %s %d < %d' % (market, count, minimum))
    by_code = {r['code']: r for r in kis_rows}
    control = by_code.get('005930')
    if not control or control['group'] != 'ST' or control['name'] != '삼성전자' or control['market'] != 'KOSPI':
        raise ValueError('KIS 통제 종목(삼성전자) 검증 실패')
    for market, minimum in MIN_NAVER.items():
        if len(naver.get(market) or {}) < minimum:
            raise ValueError('네이버 목록 수 부족: %s %d < %d' % (market, len(naver.get(market) or {}), minimum))
    if (naver['KOSPI'].get('005930') or {}).get('name') != '삼성전자':
        raise ValueError('네이버 통제 종목(삼성전자) 검증 실패')


def plan(data, kis_rows, naver):
    """등록 계획을 계산한다. data는 수정하지 않는다."""
    naver_all = {}
    for market, rows in naver.items():
        for code, row in rows.items():
            naver_all[code] = dict(row, market=market)
    known_codes = set(data.map.values()) | {r[1] for r in data.etn}
    names_taken = dict(data.map)
    names_taken.update({r[0]: r[1] for r in data.etn})

    result = {'add_map': [], 'add_etf': [], 'add_etn': [], 'single_source': [],
              'name_conflict': [], 'name_mismatch': [], 'stale': []}
    claimed = set()

    def conflicts(name, code):
        owner = names_taken.get(name)
        return owner is not None and owner != code

    for row in kis_rows:
        code, name = row['code'], row['name']
        if row['group'] not in KIS_GROUPS or code in known_codes or code in claimed:
            continue
        counterpart = naver_all.get(code)
        if counterpart is None:
            result['single_source'].append({'code': code, 'name': name, 'only': 'KIS'})
            continue
        if counterpart['name'] != name:
            result['name_mismatch'].append({'code': code, 'kis': name, 'naver': counterpart['name']})
        if conflicts(name, code):
            result['name_conflict'].append({'code': code, 'name': name, 'owner': names_taken[name]})
            continue
        claimed.add(code)
        names_taken[name] = code
        result['add_map'].append({'code': code, 'name': name, 'market': row['market'], 'group': row['group']})
        if row['group'] in ETF_GROUPS:
            result['add_etf'].append(name)

    kis_codes = {r['code'] for r in kis_rows}
    for code, row in sorted(naver_all.items()):
        if code in known_codes or code in claimed:
            continue
        if row['type'] == 'etn':
            name = row['name']
            if conflicts(name, code):
                result['name_conflict'].append({'code': code, 'name': name, 'owner': names_taken[name]})
                continue
            claimed.add(code)
            names_taken[name] = code
            result['add_etn'].append({'code': code, 'name': name, 'market': row['market']})
        elif code not in kis_codes:
            result['single_source'].append({'code': code, 'name': row['name'], 'only': 'NAVER:' + row['type']})

    live = set(kis_codes) | set(naver_all)
    result['stale'] = sorted(c for c in known_codes if c not in live)
    return result


def apply(data, result):
    for item in result['add_map']:
        data.map[item['name']] = item['code']
    data.etf_names = list(data.etf_names) + list(result['add_etf'])
    data.etn = list(data.etn) + [[i['name'], i['code']] for i in result['add_etn']]
    return data


def etn_count_ok(naver):
    seen = sum(1 for rows in naver.values() for r in rows.values() if r['type'] == 'etn')
    return seen >= MIN_ETN, seen


def summarize(result):
    parts = ['등록 %d(ETF %d)' % (len(result['add_map']), len(result['add_etf'])),
             'ETN %d' % len(result['add_etn']),
             '한쪽 소스만 %d' % len(result['single_source']),
             '이름 충돌 %d' % len(result['name_conflict']),
             '상장폐지 의심 코드 %d' % len(result['stale'])]
    return ' / '.join(parts)


def write_step_summary(result, changed):
    path = os.environ.get('GITHUB_STEP_SUMMARY')
    if not path:
        return
    lines = ['### 신규 상장 종목 동기화', '', '- ' + summarize(result), '- 파일 변경: %s' % ('예' if changed else '아니오'), '']
    for key, title in (('add_map', '등록(주식·ETF)'), ('add_etn', '등록(ETN, 네이버 단독 출처)'),
                       ('single_source', '한쪽 소스만 있어 보류'), ('name_conflict', '이름 충돌로 건너뜀'),
                       ('name_mismatch', '두 소스 이름 불일치(KIS 이름 사용)')):
        if result[key]:
            lines.append('**%s**' % title)
            lines.extend('- `%s`' % json.dumps(i, ensure_ascii=False) for i in result[key][:60])
            lines.append('')
    if result['stale']:
        lines.append('**상장폐지 의심(두 소스에 없음, 삭제하지 않음)**: ' + ', '.join(result['stale'][:80]))
    with open(path, 'a', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')


def run(dry_run=False, allow_bulk=False, kis_rows=None, naver=None, path=krx_map_io.KRX_MAP_FILE):
    kis_rows = kis_rows if kis_rows is not None else kis_master.fetch_all()
    if naver is None:
        naver = {m: fetch_naver_market(m) for m in ('KOSPI', 'KOSDAQ')}
    validate_sources(kis_rows, naver)
    ok, etn_seen = etn_count_ok(naver)
    if not ok:
        raise ValueError('네이버 ETN 수 부족: %d < %d' % (etn_seen, MIN_ETN))

    data = krx_map_io.load(path)
    before = len(data.map) + len(data.etn)
    result = plan(data, kis_rows, naver)
    total = len(result['add_map']) + len(result['add_etn'])
    log(summarize(result))
    for item in result['single_source'][:40]:
        log('보류(한쪽 소스만): %s' % json.dumps(item, ensure_ascii=False))
    for item in result['name_conflict']:
        log('이름 충돌 건너뜀: %s' % json.dumps(item, ensure_ascii=False))
    if total > MAX_ADDITIONS and not allow_bulk:
        raise ValueError('추가 %d건이 상한 %d 초과 - 파서 오류 의심(최초 대량 등록은 --allow-bulk)' % (total, MAX_ADDITIONS))

    changed = total > 0
    if changed and not dry_run:
        apply(data, result)
        krx_map_io.write(data, path)
        log('krx_map.js 갱신: %d -> %d개(ETN %d개 별도)' % (before, len(data.map) + len(data.etn), len(data.etn)))
    elif not changed:
        log('변경 없음')
    write_step_summary(result, changed and not dry_run)
    return result


def main(argv):
    try:
        run(dry_run='--dry-run' in argv, allow_bulk='--allow-bulk' in argv)
    except Exception as exc:
        log('중단(파일 미변경): %s' % exc)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
