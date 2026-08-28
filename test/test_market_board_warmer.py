# -*- coding: utf-8 -*-
"""main.py는 fastapi 의존이라 이 샌드박스에서 import 불가 - 소스 텍스트 계약만 검사한다
(test_ui_ia.py / test_main_ohlc_minute_cache.py와 동일 패턴)."""
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class MarketBoardWarmerTest(unittest.TestCase):
    def read(self):
        return (ROOT / 'scripts' / 'cloud-vm' / 'main.py').read_text(encoding='utf-8')

    def test_warmer_only_runs_on_recent_real_traffic_and_reuses_endpoint(self):
        src = self.read()
        # 루프백으로 기존 엔드포인트 경로를 그대로 태운다(조회/폴백 로직 중복 방지).
        self.assertIn("http://127.0.0.1:%s/market-board?market=%s&limit=40&fresh=1", src)
        # 트래픽이 있을 때만(마지막 실제 방문 3분 이내) 데운다.
        self.assertIn("_MARKET_BOARD_WARM_ACTIVE_WINDOW_SEC = 180", src)
        self.assertIn(
            "if time.time() - _market_board_last_real_hit <= _MARKET_BOARD_WARM_ACTIVE_WINDOW_SEC:",
            src,
        )
        # 워머 자신의 루프백 호출은 "실제 방문"으로 세지 않는다.
        self.assertIn("if ip not in ('127.0.0.1', '::1', 'localhost'):", src)
        self.assertIn("_note_market_board_real_hit(request)", src)
        # 시작 시 기동.
        self.assertIn("_start_market_board_warmer()", src)
        # 실패해도 온디맨드 경로가 그대로 동작하도록 조용히 삼킨다.
        self.assertIn("log.debug('market-board 캐시 워머 갱신 실패', exc_info=True)", src)

    def test_warmer_interval_stays_under_shared_cache_ttl(self):
        src = self.read()
        # 워머 주기(20s) < 공유 캐시 TTL(30s) 이어야 일반 요청이 항상 캐시 히트가 된다.
        self.assertIn("_MARKET_BOARD_WARM_INTERVAL_SEC = 20", src)
        self.assertIn("_MARKET_BOARD_TTL = 30", src)


if __name__ == '__main__':
    unittest.main()
