"""!important 개수 래칫: 파일별 기준선(test/important_baseline.json)보다 늘면 실패한다.

프로젝트 정책은 새 !important 금지다. 기존 것을 정리해 줄이면 이 파일의 기준선도 함께 낮춘다
(python test/test_important_ratchet.py --update). 늘려야 한다면 이유를 작업이력에 남기고 기준선을 올린다.
"""
import glob
import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASELINE = os.path.join(ROOT, 'test', 'important_baseline.json')


def current_counts():
    files = ['style.css'] + sorted(os.path.relpath(p, ROOT).replace(os.sep, '/') for p in glob.glob(os.path.join(ROOT, 'css', '*.css')))
    out = {}
    for name in files:
        with open(os.path.join(ROOT, name), encoding='utf-8') as handle:
            count = handle.read().count('!important')
        if count:
            out[name] = count
    return out


class ImportantRatchet(unittest.TestCase):
    def test_no_new_important(self):
        with open(BASELINE, encoding='utf-8') as handle:
            base = json.load(handle)
        grown = {k: (base.get(k, 0), v) for k, v in current_counts().items() if v > base.get(k, 0)}
        self.assertEqual(grown, {}, '!important 가 늘었습니다(기준선, 현재): %s' % grown)


if __name__ == '__main__':
    if '--update' in sys.argv:
        with open(BASELINE, 'w', encoding='utf-8') as handle:
            json.dump(current_counts(), handle, indent=1, sort_keys=True)
    else:
        unittest.main()
