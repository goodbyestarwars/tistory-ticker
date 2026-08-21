# -*- coding: utf-8 -*-
"""daily_scan_cache.json을 여러 스캔 스크립트(daily_scan.py, rescan_patterns.py,
angle_momentum_scan.py, gongpasan_scan.py)가 나눠서 쓴다. 각자 자기 소관 키만 갱신하고
나머지는 보존해야 하는데, 잠금 없이 개별 read-modify-write를 하면 동시 실행(또는 한쪽이
예정보다 오래 걸려 실행 시간이 겹칠 때) 서로의 결과를 덮어쓸 수 있다(2026-08-21 코드
감사 - daily_scan.py가 API 지연으로 예정보다 늦게 끝나면 먼저 끝난 angle_momentum_scan.py/
gongpasan_scan.py가 써둔 섹션을 뒤늦게 통째로 덮어쓰는 시나리오가 실제로 가능했음).

파일 잠금(fcntl.flock)으로 read-modify-write 전체를 직렬화하고, 쓰기는 tmp파일+
os.replace로 원자화해 main.py의 /daily-scan-batch가 쓰기 도중 손상된 JSON을 읽는 것도
막는다."""

import fcntl
import json
import os

OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'daily_scan_cache.json')
_LOCK_FILE = OUTPUT_FILE + '.lock'


def update(mutate):
    """OUTPUT_FILE에 대한 배타 잠금을 잡은 채로 최신 내용을 읽어 mutate(existing)를
    호출한다(existing dict를 제자리에서 수정하면 됨, 반환값은 무시). 잠금을 쥔 채로 읽고
    쓰기 때문에 다른 스크립트가 그 사이 쓴 내용을 덮어쓰지 않는다."""
    with open(_LOCK_FILE, 'a'):
        pass  # 잠금 대상 파일이 없으면 flock이 실패하므로 미리 만들어둠
    with open(_LOCK_FILE, 'r+') as lock_f:
        fcntl.flock(lock_f, fcntl.LOCK_EX)
        try:
            existing = {}
            if os.path.exists(OUTPUT_FILE):
                with open(OUTPUT_FILE, 'r', encoding='utf-8') as f:
                    existing = json.load(f)
            mutate(existing)
            tmp_path = OUTPUT_FILE + '.tmp'
            with open(tmp_path, 'w', encoding='utf-8') as f:
                json.dump(existing, f, ensure_ascii=False)
            os.replace(tmp_path, OUTPUT_FILE)
        finally:
            fcntl.flock(lock_f, fcntl.LOCK_UN)
