# -*- coding: utf-8 -*-
"""증시온도 결과의 디스크 캐시 - 재시작이 503 구멍을 만들지 않아야 한다.

2026-09-01 프론트 전환 점검에서 나온 것. 결과가 메모리에만 있어서 FastAPI가 재시작하면
백그라운드 첫 계산(전종목 시세, 수 초)이 끝날 때까지 /market-temp가 503을 냈다. GAS는
그 상황에서 직접 계산해줬으므로 그대로 넘기면 배포마다 증시온도가 잠깐 깨진다.

요청 경로에서 계산하지 않는다는 원칙(2026-08-31 504 사고)은 유지하고, 재시작이 값을
잃지 않게만 만든 변경이다.
"""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))

import market_temp  # noqa: E402


SAMPLE = {'temp': 22.2, 'score': 66.6, 'maxScore': 120,
          'updatedAt': '2026-09-01 06:30:31',
          'components': {'flow': {'score': 5}}}


class CacheFileTest(unittest.TestCase):
    def setUp(self):
        self._orig_file = market_temp.CACHE_FILE
        self._dir = tempfile.mkdtemp()
        market_temp.CACHE_FILE = os.path.join(self._dir, 'market_temp_cache.json')
        market_temp._state = {'result': None, 'computed_at': 0.0, 'error': None}

    def tearDown(self):
        market_temp.CACHE_FILE = self._orig_file
        market_temp._state = {'result': None, 'computed_at': 0.0, 'error': None}

    def test_missing_file_is_silent(self):
        """최초 기동 - 캐시가 없으면 조용히 넘어가고 503 경로를 유지한다."""
        self.assertIsNone(market_temp.load_cache())
        self.assertIsNone(market_temp._state['result'])

    def test_round_trip_restores_after_restart(self):
        market_temp._save_cache(SAMPLE, 1756000000.0)
        market_temp._state = {'result': None, 'computed_at': 0.0, 'error': None}  # 재시작
        restored = market_temp.load_cache()
        self.assertEqual(restored['temp'], 22.2)
        self.assertEqual(market_temp._state['result']['temp'], 22.2)
        self.assertEqual(market_temp._state['computed_at'], 1756000000.0)

    def test_corrupt_file_does_not_crash(self):
        with open(market_temp.CACHE_FILE, 'w', encoding='utf-8') as f:
            f.write('{not json')
        self.assertIsNone(market_temp.load_cache())
        self.assertIsNone(market_temp._state['result'])

    def test_empty_result_is_ignored(self):
        with open(market_temp.CACHE_FILE, 'w', encoding='utf-8') as f:
            json.dump({'result': None, 'computed_at': 1.0}, f)
        self.assertIsNone(market_temp.load_cache())
        self.assertIsNone(market_temp._state['result'])

    def test_does_not_overwrite_fresher_in_memory_value(self):
        """이미 새로 계산된 값이 있으면 낡은 파일이 덮어쓰면 안 된다."""
        market_temp._save_cache(SAMPLE, 1756000000.0)
        fresh = dict(SAMPLE, temp=99.9)
        market_temp._state = {'result': fresh, 'computed_at': 1756009999.0, 'error': None}
        market_temp.load_cache()
        self.assertEqual(market_temp._state['result']['temp'], 99.9)

    def test_save_is_atomic_no_temp_left_behind(self):
        market_temp._save_cache(SAMPLE, 1756000000.0)
        leftovers = [n for n in os.listdir(self._dir) if n.endswith('.tmp')]
        self.assertEqual(leftovers, [], '임시 파일이 남으면 반쪽 파일을 읽을 위험이 있다')

    def test_save_failure_is_not_fatal(self):
        """디스크에 못 써도 메모리 값으로 계속 서비스해야 한다."""
        market_temp.CACHE_FILE = os.path.join(self._dir, 'no-such-dir', 'x.json')
        market_temp._save_cache(SAMPLE, 1.0)   # 예외가 새어나오면 실패

    def test_cache_filename_is_gitignored_pattern(self):
        """*_cache.json 관례를 지켜야 .gitignore가 잡는다."""
        self.assertTrue(os.path.basename(market_temp.CACHE_FILE).endswith('_cache.json'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
