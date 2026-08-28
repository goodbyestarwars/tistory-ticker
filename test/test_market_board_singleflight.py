# -*- coding: utf-8 -*-
"""FastAPI 런타임 의존성 없이 시장 종목판 캐시 미스 합류 계약을 고정한다."""
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class MarketBoardSingleFlightTest(unittest.TestCase):
    def test_same_market_board_cache_miss_is_coalesced(self):
        source = (ROOT / 'scripts' / 'cloud-vm' / 'main.py').read_text(encoding='utf-8')
        self.assertIn('import threading', source)
        self.assertIn('_market_board_inflight = {}', source)
        self.assertIn('_market_board_inflight_lock = threading.Lock()', source)
        self.assertIn("completion = _market_board_inflight.get(key)", source)
        self.assertIn('completion.wait(timeout=25)', source)
        self.assertIn('_market_board_inflight.pop(key, None)', source)
        self.assertIn('completion.set()', source)


if __name__ == '__main__':
    unittest.main()
