# -*- coding: utf-8 -*-
"""GAS 환율 보강이 캐시를 거치는지(2026-09-21 검토에서 발견).

`getMarketTemp()`·`getMarketRibbon()`은 캐시가 적중해도 환율만은 최신값을 보여 주려고
`fetchExchange('FX_USDKRW')`를 다시 불렀다. 그런데 그 함수는 캐시 없는 `UrlFetchApp.fetch`다.
결과적으로 **캐시 히트마다 네트워크를 한 번씩 탔다** - 캐시의 이점(0ms)이 사라지고
GAS URL Fetch 할당량을 방문 수만큼 썼다(.claude/rules/backend.md: GAS 실행 제한 고려).

같은 이유로 리본의 장외 TTL을 30분에서 60초로 줄여 놨었다. 환율 하나 때문에 지수·코인까지
30배로 다시 받는다. 환율만 따로 60초 캐시로 묶고, 리본 TTL은 되돌린다.
"""

import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class GasFxCacheTest(unittest.TestCase):
    def setUp(self):
        self.src = (ROOT / 'gas' / 'ticker-proxy.gs').read_text(encoding='utf-8')

    def test_a_cached_fx_helper_exists(self):
        self.assertIn('function fetchExchangeCached_()', self.src)
        self.assertIn("var key = CACHE_PREFIX + 'fx_usdkrw_v1';", self.src)
        self.assertIn('cache.put(key, JSON.stringify(fresh), FX_CACHE_TTL_SEC);', self.src)

    def test_the_fx_ttl_is_short_but_not_zero(self):
        ttl = int(re.search(r'var FX_CACHE_TTL_SEC = (\d+);', self.src).group(1))
        self.assertGreaterEqual(ttl, 30, '너무 짧으면 캐시를 둔 의미가 없다')
        self.assertLessEqual(ttl, 300, '너무 길면 환율을 최신으로 보이려던 의도가 죽는다')

    def test_no_uncached_fetch_on_a_cache_hit(self):
        """이게 핵심이다. 캐시 히트 경로에서 날것의 fetchExchange를 부르면 안 된다."""
        self.assertNotIn("safeCall(function () { return fetchExchange('FX_USDKRW'); });\n      if (freshFx_",
                         self.src)
        for marker in ('var freshFx_ = fetchExchangeCached_();',
                       'var ribbonFx_ = fetchExchangeCached_();'):
            self.assertIn(marker, self.src)

    def test_fetch_exchange_itself_is_still_uncached(self):
        """헬퍼가 감싸는 대상이 바뀌면 이 테스트의 전제가 깨진다."""
        body = self.src[self.src.index('function fetchExchange(marketIndexCd)'):]
        body = body[:body.index('\n}\n')]
        self.assertIn('UrlFetchApp.fetch(url', body)
        self.assertNotIn('CacheService', body)

    def test_the_ribbon_keeps_its_off_hours_ttl(self):
        """환율 때문에 리본 전체를 60초로 줄이면 장외 호출량이 30배가 된다."""
        self.assertIn(
            'var ttl = capTtlToSessionBoundary_(result.btc ? '
            '(isMarketOpenNow() ? CACHE_TTL_OPEN : CACHE_TTL_CLOSED) : 120);',
            self.src)


if __name__ == '__main__':
    unittest.main()
