# -*- coding: utf-8 -*-
"""키움 미국 종목목록(usa10099) 호출 계약(2026-09-18).

이 호출은 **한 번도 성공한 적이 없었다.** `usa10099`를 `/api/us/mrkcond`로 보내고 있었는데
그 URI는 해당 API ID를 받지 않는다. 운영 VM 실측:

    stex_tp='%'  -> return_code=1
                    잘못된 요청입니다[1504:해당 URI에서는 지원하는 API ID가 아닙니다.
                    API ID=usa10099, URI=/api/us/mrkcond]

올바른 경로는 `/api/us/stkinfo`이고, 같은 토큰·같은 파라미터로 `return_code=0`과 19,222행이 온다.

겉으로는 멀쩡해 보였다. `search()`가 예외를 삼키고 야후로 폴백했기 때문이다. 대신 한글
종목명("엔비디아")과 거래소 코드를 잃었고, 로그에는 매번 "종목 목록이 비어 있습니다"가 남았다.

두 번째 원인도 같이 있었다: `_records()`가 `list` 포장을 못 읽었다. 주석에는 읽는다고 적혀
있었지만 키 목록에 `'list'`가 빠져 있어서, URI만 고쳤어도 여전히 빈 목록이었다.
"""

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                'scripts', 'cloud-vm'))

import us_stocks  # noqa: E402

# 운영 VM에서 실제로 받은 응답의 첫 행들(2026-09-18).
REAL_ROWS = [
    {'stex_tp': 'NY', 'stk_cd': 'A', 'stk_nm': '애질런트 테크놀로지스',
     'stk_enm': 'AGILENT TECHNOLOGIES INC', 'mkgb': 'NYSE', 'upgb': '바이오', 'isEtf': 'N'},
    {'stex_tp': 'ND', 'stk_cd': 'AAAP', 'stk_nm': 'PACER BARINGS CLO MARKET FLEX',
     'stk_enm': 'PACER BARINGS CLO MARKET FLEX ETF', 'mkgb': 'NASDAQ', 'upgb': '', 'isEtf': 'Y'},
    {'stex_tp': 'ND', 'stk_cd': 'NVDA', 'stk_nm': '엔비디아',
     'stk_enm': 'NVIDIA CORP', 'mkgb': 'NASDAQ', 'upgb': 'IT', 'isEtf': 'N'},
]
REAL_RESPONSE = {'return_code': 0, 'return_msg': '정상적으로 처리되었습니다', 'list': REAL_ROWS}


class RecordsUnwrapTest(unittest.TestCase):
    def test_list_wrapper_is_unwrapped(self):
        """URI를 고쳐도 이게 빠져 있으면 목록은 계속 비어 있다."""
        self.assertEqual(us_stocks._records(REAL_RESPONSE), REAL_ROWS)

    def test_existing_wrappers_still_win(self):
        payload = {'output': [{'stk_cd': 'AAPL'}], 'list': [{'stk_cd': 'WRONG'}]}
        self.assertEqual(us_stocks._records(payload), [{'stk_cd': 'AAPL'}])

    def test_error_response_yields_nothing(self):
        self.assertEqual(us_stocks._records({'return_code': 1, 'return_msg': '잘못된 요청입니다'}), [])


class SymbolListTest(unittest.TestCase):
    def setUp(self):
        us_stocks._symbol_cache.update(saved_at=0, rows=[])
        us_stocks._symbol_exchange.clear()
        us_stocks._search_cache.clear()
        os.environ.setdefault('KIWOOM_APPKEY', 'test-key')
        os.environ.setdefault('KIWOOM_SECRETKEY', 'test-secret')

    def _call(self, response=REAL_RESPONSE):
        calls = []

        def fake_call_tr(token, api_id, path, body):
            calls.append((api_id, path, body))
            return response

        with mock.patch.object(us_stocks.kiwoom_client, 'get_token', return_value='t'), \
                mock.patch.object(us_stocks.kiwoom_client, 'call_tr', side_effect=fake_call_tr):
            rows = us_stocks._records_from_kiwoom_symbol_list()
        return rows, calls

    def test_it_asks_the_uri_that_actually_serves_usa10099(self):
        """이게 이번 수정의 전부다. /api/us/mrkcond는 1504로 거절한다."""
        _, calls = self._call()
        self.assertEqual(calls, [('usa10099', '/api/us/stkinfo', {'stex_tp': '%'})])

    def test_rows_are_compact_tuples(self):
        """e2-micro(1GB)라 19,222행을 dict로 들면 7.1MB, 튜플이면 1.4MB다(VM 실측)."""
        rows, _ = self._call()
        self.assertEqual(rows[0], ('A', '애질런트 테크놀로지스', 'NY'))
        for entry in rows:
            self.assertIsInstance(entry, tuple)
            self.assertEqual(len(entry), 3)

    def test_korean_names_survive(self):
        """야후 폴백으로는 못 얻던 것. 이게 이 호출을 살리는 이유다."""
        rows, _ = self._call()
        self.assertIn(('NVDA', '엔비디아', 'ND'), rows)

    def test_exchange_hints_are_recorded(self):
        self._call()
        self.assertEqual(us_stocks._symbol_exchange['NVDA'], 'ND')
        self.assertEqual(us_stocks._symbol_exchange['A'], 'NY')

    def test_empty_list_still_raises_so_search_falls_back(self):
        with self.assertRaises(us_stocks.UsStockUnavailable):
            self._call({'return_code': 1, 'return_msg': '잘못된 요청입니다[1504:...]'})

    def test_second_call_within_the_ttl_reuses_the_cache(self):
        """19,222행(원시 11.2MB)을 10분마다 다시 받지 않는다."""
        self._call()
        _, calls = self._call()
        self.assertEqual(calls, [], '캐시가 살아 있으면 다시 부르지 않는다')

    def test_symbol_list_ttl_is_longer_than_the_search_result_ttl(self):
        self.assertGreater(us_stocks.SYMBOL_LIST_TTL_SEC, us_stocks.SEARCH_TTL_SEC)


class SearchThroughRealResponseTest(unittest.TestCase):
    """실제 응답 모양 그대로 search()까지 통과하는지."""

    def setUp(self):
        us_stocks._symbol_cache.update(saved_at=0, rows=[])
        us_stocks._symbol_exchange.clear()
        us_stocks._search_cache.clear()

    def test_korean_query_finds_the_stock(self):
        with mock.patch.object(us_stocks.kiwoom_client, 'get_token', return_value='t'), \
                mock.patch.object(us_stocks.kiwoom_client, 'call_tr', return_value=REAL_RESPONSE):
            rows = us_stocks.search('엔비디아')
        self.assertEqual([row['symbol'] for row in rows], ['NVDA'])
        self.assertEqual(rows[0]['name'], '엔비디아')
        self.assertEqual(rows[0]['exchange'], 'ND')

    def test_broken_upstream_still_returns_a_typed_ticker(self):
        """폴백은 그대로 둔다 - 키움이 죽어도 티커 직접 입력은 돼야 한다."""
        with mock.patch.object(us_stocks.kiwoom_client, 'get_token', return_value='t'), \
                mock.patch.object(us_stocks.kiwoom_client, 'call_tr',
                                  return_value={'return_code': 1, 'return_msg': '잘못된 요청입니다'}):
            rows = us_stocks.search('TSLA')
        self.assertEqual([row['symbol'] for row in rows], ['TSLA'])


class ExchangeHintTest(unittest.TestCase):
    """거래소 힌트는 증권사마다 코드가 다르다.

    종목목록이 살아나면 `_symbol_exchange`가 키움 코드(ND/NY/NA)로 19,000개 넘게 채워진다.
    그걸 KIS에 그대로 넘기면 종목마다 없는 거래소를 한 번씩 찔러 보고 버린다.
    """

    def setUp(self):
        us_stocks._symbol_exchange.clear()

    def test_kiwoom_hint_is_translated_for_kis(self):
        us_stocks._symbol_exchange['NVDA'] = 'ND'
        self.assertEqual(us_stocks._exchange_hint('NVDA', 'kiwoom'), 'ND')
        self.assertEqual(us_stocks._exchange_hint('NVDA', 'kis'), 'NAS')

    def test_kis_hint_is_translated_for_kiwoom(self):
        us_stocks._symbol_exchange['AAPL'] = 'NAS'
        self.assertEqual(us_stocks._exchange_hint('AAPL', 'kiwoom'), 'ND')
        self.assertEqual(us_stocks._exchange_hint('AAPL', 'kis'), 'NAS')

    def test_every_exchange_pair_round_trips(self):
        for stored, kiwoom, kis in (('ND', 'ND', 'NAS'), ('NAS', 'ND', 'NAS'), ('NMS', 'ND', 'NAS'),
                                    ('NY', 'NY', 'NYS'), ('NYS', 'NY', 'NYS'), ('NYQ', 'NY', 'NYS'),
                                    ('NA', 'NA', 'AMS'), ('AMS', 'NA', 'AMS'), ('ASE', 'NA', 'AMS')):
            us_stocks._symbol_exchange['X'] = stored
            self.assertEqual(us_stocks._exchange_hint('X', 'kiwoom'), kiwoom, stored)
            self.assertEqual(us_stocks._exchange_hint('X', 'kis'), kis, stored)

    def test_unknown_or_missing_hint_is_none(self):
        self.assertIsNone(us_stocks._exchange_hint('NOPE', 'kis'))
        us_stocks._symbol_exchange['TSE'] = 'TSE'
        self.assertIsNone(us_stocks._exchange_hint('TSE', 'kiwoom'))

    def test_kis_quote_does_not_try_a_kiwoom_code_first(self):
        """회귀 방지: 예전 코드는 저장된 'ND'를 KIS에 그대로 넘겼다."""
        us_stocks._symbol_exchange['NVDA'] = 'ND'
        tried = []

        def fake_fetch(token, appkey, appsecret, exchange, symbol):
            tried.append(exchange)
            raise RuntimeError('없음')

        os.environ.setdefault('KIS_APPKEY', 'k')
        os.environ.setdefault('KIS_APPSECRET', 's')
        with mock.patch.object(us_stocks.kis_client, 'get_token', return_value='t'), \
                mock.patch.object(us_stocks.kis_client, 'fetch_overseas_price', side_effect=fake_fetch):
            with self.assertRaises(us_stocks.UsStockUnavailable):
                us_stocks._kis_quote('NVDA')
        self.assertEqual(tried[0], 'NAS')
        self.assertNotIn('ND', tried)


if __name__ == '__main__':
    unittest.main()
