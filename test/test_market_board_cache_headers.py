# -*- coding: utf-8 -*-
"""/market-board 응답의 브라우저 캐시 계약을 고정한다.

FastAPI 런타임 의존성 없이 소스 텍스트로 검사한다(test_market_board_singleflight.py와
동일 패턴).

배경(2026-09-12 실측): 이 응답에는 cache-control이 전혀 없었다. 서버 캐시가 적중해
0.36~1.0초에 끝나도 브라우저는 매번 200KB 본문을 다시 받았다 - 탭 전환·재방문·
새로고침이 전부 왕복이 된다.
"""
import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class MarketBoardCacheHeaderTest(unittest.TestCase):
    def read(self):
        return (ROOT / 'scripts' / 'cloud-vm' / 'main.py').read_text(encoding='utf-8')

    def test_market_board_sets_cache_control(self):
        src = self.read()
        # 헤더를 걸려면 주입된 Response를 받아야 한다.
        self.assertIn('def market_board_endpoint(request: Request,\n                          response: Response,', src)
        self.assertIn("response.headers['Cache-Control'] = ", src)
        self.assertIn("'public, max-age=15, stale-while-revalidate=30'", src)

    def test_fresh_requests_are_not_stored(self):
        """fresh=1은 캐시를 일부러 우회하려는 요청(워머 루프백, WebSocket 틱)이다.
        이걸 브라우저가 저장하면 우회의 의미가 없어진다."""
        src = self.read()
        self.assertIn("'no-store' if fresh", src)

    def test_browser_max_age_stays_within_server_ttl(self):
        """브라우저 max-age가 서버 공유 캐시 TTL보다 길면, 서버가 새 데이터를 갖고
        있는데도 브라우저가 옛 본문을 계속 쓰는 구간이 생긴다."""
        src = self.read()
        max_age = int(re.search(r'public, max-age=(\d+)', src).group(1))
        ttl = int(re.search(r'_MARKET_BOARD_TTL = (\d+)', src).group(1))
        self.assertLess(max_age, ttl)


if __name__ == '__main__':
    unittest.main()
