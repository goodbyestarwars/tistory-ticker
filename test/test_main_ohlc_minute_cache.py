# -*- coding: utf-8 -*-
"""main.py는 fastapi가 필요해 이 샌드박스에서 import할 수 없다(다른 VM 테스트와 동일한
제약) - test_ui_ia.py의 JS 계약 테스트와 같은 패턴으로 소스 텍스트만 검사한다."""
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class OhlcMinuteCacheTtlTest(unittest.TestCase):
    def read(self):
        return (ROOT / 'scripts' / 'cloud-vm' / 'main.py').read_text(encoding='utf-8')

    def test_ohlc_minute_uses_dedicated_short_ttl(self):
        # 2026-08-05 사용자 리포트: 분봉 탭이 60초마다 재조회해도 화면이 최대 5분
        # (_LIVE_CACHE_TTL)까지 그대로였음 - /ohlc-minute만 프론트 폴링 주기(60초)에 맞춘
        # 전용 TTL을 쓰도록 고쳤다. 다른 엔드포인트(_ohlc_cache/_pbar_tratio_cache/
        # _investor_flow_cache_mem/_foreign_flow_cache_mem)는 기존 5분 TTL 그대로여야 한다.
        source = self.read()
        self.assertIn('_OHLC_MINUTE_CACHE_TTL = 60', source)
        self.assertIn('def _live_cache_get(cache, code, ttl=_LIVE_CACHE_TTL):', source)
        self.assertIn(
            "cached = _live_cache_get(_ohlc_minute_cache, cache_key, ttl=_OHLC_MINUTE_CACHE_TTL)",
            source,
        )
        # 다른 캐시 조회는 기본 TTL(파라미터 생략)을 그대로 써야 한다 - 회귀 방지.
        self.assertIn('cached = _live_cache_get(_ohlc_cache, code)', source)
        self.assertIn('cached = _live_cache_get(_pbar_tratio_cache, cache_key)', source)
        self.assertIn('cached = _live_cache_get(_investor_flow_cache_mem, code)', source)
        self.assertIn('cached = _live_cache_get(_foreign_flow_cache_mem, cache_key)', source)


if __name__ == '__main__':
    unittest.main()
