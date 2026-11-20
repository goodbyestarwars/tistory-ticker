# -*- coding: utf-8 -*-
"""data/krx_map.js 읽기·쓰기 공통 모듈 (fetch_etf_list.py, sync_listings.py가 함께 쓴다).

파일 형식(한 문장 = 한 줄, 압축 JSON):
  window.KRX_MAP={"이름":"코드",...};          # 일반주·스팩·ETF. VM 스캔이 정규식으로 읽는다.
  window.KRX_ETF_NAMES=["ETF 이름",...];       # ETF 이름 목록(검색 자동완성 순위·ETF 판별)
  window.KRX_ETN=[["ETN 이름","코드"],...];    # ETN. 의도적으로 쌍 배열이다(아래 참고).
  (function(w){...})(window);                  # ETN을 브라우저에서만 KRX_MAP/KRX_ETF_NAMES에 합친다.

ETN을 {"이름":"코드"} 객체가 아니라 [이름,코드] 배열로 두는 이유:
  VM의 daily_scan/batch_scan/strategy_scan 등은 파일 전체를 `"이름":"코드"` 정규식으로 읽어
  전 종목 유니버스를 만든다. ETN을 같은 형태로 넣으면 ETN 수백 종이 ETF 검색기·일일 수급/재무
  수집에 섞인다. 배열 형태는 그 정규식에 걸리지 않으므로 검색 화면(브라우저)에서만 보인다.

과거 수동 등록은 `window.KRX_MAP["이름"]="코드";` 줄을 파일 끝에 덧붙이는 방식이었다. 이 줄은
VM 정규식에 걸리지 않아 VM 유니버스에서 빠지는 문제가 있었다. 읽을 때 본 맵으로 합치고
쓸 때는 본 맵 안에 기록한다.
"""
import json
import os
import re

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KRX_MAP_FILE = os.path.join(REPO_ROOT, 'data', 'krx_map.js')

_MERGE_JS = ('(function(w){var m=w.KRX_MAP,e=w.KRX_ETF_NAMES,n=w.KRX_ETN||[];'
             'n.forEach(function(r){if(!m[r[0]])m[r[0]]=r[1];if(e.indexOf(r[0])<0)e.push(r[0]);});})(window);')

_APPENDED = re.compile(r'^window\.KRX_MAP\[("(?:[^"\\]|\\.)*")\]\s*=\s*("(?:[^"\\]|\\.)*");?\s*$')


class KrxMap(object):
    def __init__(self, mapping=None, etf_names=None, etn=None):
        self.map = dict(mapping or {})          # 이름 -> 코드 (일반주·스팩·ETF)
        self.etf_names = list(etf_names or [])
        self.etn = [list(r) for r in (etn or [])]  # [이름, 코드]


def _statement_json(line, prefix):
    body = line[len(prefix):].rstrip()
    if body.endswith(';'):
        body = body[:-1]
    return json.loads(body)


def parse(text):
    data = KrxMap()
    found_main = False
    for raw in text.replace('\r\n', '\n').split('\n'):
        line = raw.strip()
        if not line:
            continue
        if line.startswith('window.KRX_MAP='):
            data.map.update(_statement_json(line, 'window.KRX_MAP='))
            found_main = True
        elif line.startswith('window.KRX_ETF_NAMES='):
            data.etf_names = list(_statement_json(line, 'window.KRX_ETF_NAMES='))
        elif line.startswith('window.KRX_ETN='):
            data.etn = [list(r) for r in _statement_json(line, 'window.KRX_ETN=')]
        else:
            m = _APPENDED.match(line)
            if m:  # 과거 수동 덧붙임 줄: 본 맵으로 합친다(이미 있으면 본 맵 우선).
                data.map.setdefault(json.loads(m.group(1)), json.loads(m.group(2)))
    if not found_main or not data.map:
        raise ValueError('krx_map.js 형식을 인식하지 못했습니다(KRX_MAP 없음).')
    return data


def load(path=KRX_MAP_FILE):
    with open(path, 'r', encoding='utf-8') as f:
        return parse(f.read())


def _dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def render(data):
    lines = ['window.KRX_MAP=' + _dumps(data.map) + ';',
             'window.KRX_ETF_NAMES=' + _dumps(sorted(set(data.etf_names))) + ';']
    if data.etn:
        lines.append('window.KRX_ETN=' + _dumps(sorted(data.etn, key=lambda r: (r[1], r[0]))) + ';')
        lines.append(_MERGE_JS)
    return '\n'.join(lines) + '\n'


def write(data, path=KRX_MAP_FILE):
    """임시 파일에 쓴 뒤 교체한다(읽는 쪽이 반쯤 쓴 파일을 보지 않도록)."""
    text = render(data)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    os.replace(tmp, path)
    return text
