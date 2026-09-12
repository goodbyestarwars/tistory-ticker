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
        # 실패해도 온디맨드 경로가 그대로 동작하도록 조용히 삼킨다. 어느 시장에서
        # 실패했는지는 로그로 구분할 수 있어야 한다.
        self.assertIn("log.debug('market-board 캐시 워머 갱신 실패(%s)', market, exc_info=True)", src)

    def test_warmer_warms_both_markets_in_parallel(self):
        """2026-09-12: 예전에는 _economic_news_market()이 고른 한쪽 시장만 데웠다.
        홈에서 시장 탭을 반대쪽으로 바꾼 방문자는 캐시 미스(실측 7.6~8.4초)를 그대로
        맞았다. 두 시장을 동시에 데워야 한다 - 순차로 돌리면 두 조회 시간이 더해져
        주기가 _MARKET_BOARD_TTL을 넘긴다."""
        src = self.read()
        self.assertIn("futures = {m: pool.submit(warm, m) for m in ('domestic', 'us')}", src)
        self.assertIn('with ThreadPoolExecutor(max_workers=2) as pool:', src)
        # 한쪽 시장만 고르던 옛 경로가 워머에 남아 있으면 안 된다.
        self.assertNotIn('market = _economic_news_market()', src)

    def test_warmer_interval_stays_under_shared_cache_ttl(self):
        src = self.read()
        # 워머 주기(20s) < 공유 캐시 TTL(30s) 이어야 일반 요청이 항상 캐시 히트가 된다.
        self.assertIn("_MARKET_BOARD_WARM_INTERVAL_SEC = 20", src)
        self.assertIn("_MARKET_BOARD_TTL = 30", src)
        # 주기는 "조회가 끝난 뒤 20초"가 아니라 "20초마다"여야 한다. 조회에 8초가
        # 걸리는 상황에서 고정 sleep(20)이면 실제 주기가 28초가 돼 TTL 30초에
        # 육박한다 - 걸린 시간을 빼고 재운다.
        self.assertIn(
            "time.sleep(max(1.0, _MARKET_BOARD_WARM_INTERVAL_SEC - (time.time() - started)))",
            src,
        )


if __name__ == '__main__':
    unittest.main()
