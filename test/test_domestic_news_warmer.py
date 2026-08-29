# -*- coding: utf-8 -*-
"""main.py는 fastapi 의존이라 이 샌드박스에서 import 불가 - 소스 텍스트 계약만 검사한다
(test_market_board_warmer.py와 동일 패턴)."""
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class DomesticNewsWarmerTest(unittest.TestCase):
    def read(self):
        return (ROOT / 'scripts' / 'cloud-vm' / 'main.py').read_text(encoding='utf-8')

    def test_warmer_only_runs_on_recent_real_traffic_and_reuses_endpoint(self):
        src = self.read()
        # 홈이 실제로 부르는 것과 같은 쿼리를 루프백으로 태워 같은 캐시를 데운다.
        self.assertIn("http://127.0.0.1:%s/domestic-news?kind=news&limit=50", src)
        # 트래픽이 있을 때만(마지막 실제 방문 3분 이내) 데운다.
        self.assertIn("_DOMESTIC_NEWS_WARM_ACTIVE_WINDOW_SEC = 180", src)
        self.assertIn(
            "if time.time() - _domestic_news_last_real_hit <= _DOMESTIC_NEWS_WARM_ACTIVE_WINDOW_SEC:",
            src,
        )
        # 워머 자신의 루프백 호출은 "실제 방문"으로 세지 않는다.
        self.assertIn("_note_domestic_news_real_hit(request)", src)
        # 시작 시 기동.
        self.assertIn("_start_domestic_news_warmer()", src)
        # 실패해도 온디맨드 경로가 그대로 동작하도록 조용히 삼킨다.
        self.assertIn("log.debug('domestic-news 캐시 워머 갱신 실패', exc_info=True)", src)

    def test_warm_interval_stays_below_the_dart_cache_ttl(self):
        """주기가 DART 캐시 TTL보다 길어지면 방문자가 다시 DART 호출을 맞는다."""
        src = self.read()
        self.assertIn('_DOMESTIC_NEWS_WARM_INTERVAL_SEC = 45', src)
        news_src = (ROOT / 'scripts' / 'cloud-vm' / 'domestic_news.py').read_text(encoding='utf-8')
        self.assertIn('DART_CACHE_TTL_SEC = 60', news_src)

    def test_warmer_thread_is_a_daemon_so_it_never_blocks_shutdown(self):
        src = self.read()
        self.assertIn(
            "threading.Thread(target=_domestic_news_warm_loop, name='domestic-news-warmer', daemon=True)",
            src,
        )


if __name__ == '__main__':
    unittest.main()
