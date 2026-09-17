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
import time
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

# "엔비디아"로 찾으면 실제로 같이 나오는 행들. 전부 이름에 "엔비디아"가 들어간다.
# NVC가 두 번 들어 있는 것도 실제 응답 그대로다.
NVDA_FAMILY = [
    {'stex_tp': 'NA', 'stk_cd': 'NVC', 'stk_nm': '코기 엔비디아(NVDA) 2X', 'isEtf': 'Y'},
    {'stex_tp': 'NA', 'stk_cd': 'NVC', 'stk_nm': '코기 엔비디아(NVDA) 2X', 'isEtf': 'Y'},
    {'stex_tp': 'ND', 'stk_cd': 'NVD', 'stk_nm': '엔비디아 인버스 2배 그래닛셰어즈 ETF', 'isEtf': 'Y'},
    {'stex_tp': 'ND', 'stk_cd': 'NVDL', 'stk_nm': '엔비디아 2배 그래닛셰어즈 ETF', 'isEtf': 'Y'},
    {'stex_tp': 'ND', 'stk_cd': 'NVDA', 'stk_nm': '엔비디아', 'isEtf': 'N'},
    {'stex_tp': 'NY', 'stk_cd': 'NVDY', 'stk_nm': '엔비디아 옵션배당 일드맥스 ETF', 'isEtf': 'Y'},
]
REAL_RESPONSE = {'return_code': 0, 'return_msg': '정상적으로 처리되었습니다', 'list': REAL_ROWS}


def load(payload):
    """응답을 목록으로 바꾼다(네트워크 없이)."""
    with mock.patch.object(us_stocks.kiwoom_client, 'get_token', return_value='t'), \
            mock.patch.object(us_stocks.kiwoom_client, 'call_tr', return_value=payload):
        return us_stocks._records_from_kiwoom_symbol_list()


def seed(payload):
    """검색 테스트용으로 목록 캐시를 채운다.

    실제 적재는 백그라운드 스레드에서 돈다(사용자 요청이 13초를 물지 않게). 검색 자체를 보는
    테스트는 그 타이밍이 아니라 목록이 있을 때의 동작이 관심사라 직접 앉힌다.
    """
    rows = load(payload)
    us_stocks._symbol_cache.update(saved_at=time.time(), rows=rows, loading=False)
    return rows


def reset():
    us_stocks._symbol_cache.update(saved_at=0, rows=[], loading=False)
    us_stocks._symbol_exchange.clear()
    us_stocks._search_cache.clear()


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
        reset()
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
        self.assertEqual(rows[0][:4], ('A', '애질런트 테크놀로지스', 'NY', False))
        self.assertIn('agilenttechnologiesinc', rows[0][4])
        for entry in rows:
            self.assertIsInstance(entry, tuple)
            self.assertEqual(len(entry), 5)

    def test_korean_names_survive(self):
        """야후 폴백으로는 못 얻던 것. 이게 이 호출을 살리는 이유다."""
        rows, _ = self._call()
        self.assertIn(('NVDA', '엔비디아', 'ND', False), [entry[:4] for entry in rows])

    def test_exchange_hints_are_recorded(self):
        self._call()
        self.assertEqual(us_stocks._symbol_exchange['NVDA'], 'ND')
        self.assertEqual(us_stocks._symbol_exchange['A'], 'NY')

    def test_empty_list_still_raises_so_search_falls_back(self):
        with self.assertRaises(us_stocks.UsStockUnavailable):
            self._call({'return_code': 1, 'return_msg': '잘못된 요청입니다[1504:...]'})

    def test_a_fresh_cache_is_served_without_refetching(self):
        """19,222행(원시 11.2MB)을 10분마다 다시 받지 않는다."""
        seed(REAL_RESPONSE)
        started = []
        with mock.patch.object(us_stocks, '_start_symbol_list_refresh',
                               side_effect=lambda: started.append(1)):
            rows = us_stocks.symbol_list_for_search()
        self.assertTrue(rows)
        self.assertEqual(started, [], '신선하면 다시 받지 않는다')

    def test_a_stale_cache_is_served_immediately_while_refreshing(self):
        """오래됐다고 사용자를 13초 기다리게 하지 않는다. 지금 것을 주고 뒤에서 받는다."""
        rows = seed(REAL_RESPONSE)
        us_stocks._symbol_cache['saved_at'] = time.time() - us_stocks.SYMBOL_LIST_TTL_SEC - 1
        started = []
        with mock.patch.object(us_stocks, '_start_symbol_list_refresh',
                               side_effect=lambda: started.append(1)):
            served = us_stocks.symbol_list_for_search()
        self.assertEqual(served, rows, '낡아도 있는 것을 먼저 준다')
        self.assertEqual(started, [1], '뒤에서 새로 받기 시작한다')

    def test_an_empty_cache_raises_so_search_falls_back(self):
        reset()
        started = []
        with mock.patch.object(us_stocks, '_start_symbol_list_refresh',
                               side_effect=lambda: started.append(1)):
            with self.assertRaises(us_stocks.UsStockUnavailable):
                us_stocks.symbol_list_for_search()
        self.assertEqual(started, [1], '없으면 적재를 시작은 해 둔다')

    def test_refresh_is_not_started_twice_at_once(self):
        """11.2MB를 동시에 두 번 받으면 e2-micro가 흔들린다."""
        reset()
        us_stocks._symbol_cache['loading'] = True
        self.addCleanup(lambda: us_stocks._symbol_cache.update(loading=False))
        self.assertFalse(us_stocks._start_symbol_list_refresh())

    def test_symbol_list_ttl_is_longer_than_the_search_result_ttl(self):
        self.assertGreater(us_stocks.SYMBOL_LIST_TTL_SEC, us_stocks.SEARCH_TTL_SEC)


class RankingTest(unittest.TestCase):
    """원종목이 자기를 따라가는 레버리지 ETF에 밀리지 않아야 한다.

    라이브에서 처음 확인했을 때 "엔비디아"를 치면 이렇게 나왔다:
        NVC 코기 엔비디아(NVDA) 2X | NVC (중복) | NVD 엔비디아 인버스 2배 ...
    정작 NVDA가 없었다. 이름에 "엔비디아"가 들어가는 건 다 똑같아서 심볼 알파벳순으로
    밀렸기 때문이다. 목록에는 이런 파생 ETF가 원종목 하나당 열 개 넘게 있다.
    """

    def setUp(self):
        reset()
        seed({'return_code': 0, 'list': NVDA_FAMILY})

    def _search(self, query, limit=8):
        return us_stocks.search(query, limit=limit)

    def test_the_real_stock_comes_first(self):
        rows = self._search('엔비디아')
        self.assertEqual(rows[0]['symbol'], 'NVDA')
        self.assertEqual(rows[0]['name'], '엔비디아')

    def test_duplicate_rows_are_dropped(self):
        """응답에 같은 종목이 두 번 들어 있다(실측). 결과에 두 번 나오면 안 된다."""
        rows = self._search('엔비디아', limit=20)
        symbols = [row['symbol'] for row in rows]
        self.assertEqual(len(symbols), len(set(symbols)), symbols)
        self.assertEqual(symbols.count('NVC'), 1)

    def test_derivatives_still_show_up_below(self):
        """ETF를 숨기는 게 아니라 뒤로 보내는 것이다."""
        symbols = [row['symbol'] for row in self._search('엔비디아', limit=20)]
        self.assertIn('NVDL', symbols)
        self.assertGreater(symbols.index('NVDL'), symbols.index('NVDA'))

    def test_ticker_query_still_wins_on_exact_symbol(self):
        self.assertEqual(self._search('NVDA')[0]['symbol'], 'NVDA')

    def test_etf_is_labelled(self):
        rows = self._search('엔비디아', limit=20)
        kinds = {row['symbol']: row['quote_type'] for row in rows}
        self.assertEqual(kinds['NVDA'], 'EQUITY')
        self.assertEqual(kinds['NVDL'], 'ETF')

    def test_an_etf_query_is_not_penalised_into_uselessness(self):
        """ETF만 걸리는 검색이면 ETF가 1등이어야 한다 - 감점은 동점일 때만 작동한다."""
        self.assertEqual(self._search('일드맥스')[0]['symbol'], 'NVDY')


class NameMatchingTest(unittest.TestCase):
    """영문 회사명과 띄어쓰기.

    #489·#490 배포 뒤 라이브에서 확인하니 둘 다 안 됐다:
      - "apple"/"tesla"/"microsoft" -> 없음. 키움 목록은 한글명(`stk_nm`)을 주는데 영문명
        (`stk_enm`)을 안 들고 왔다. 야후로 폴백하던 시절보다 오히려 못해진 것이다.
      - "일라이릴리" -> 없음. 목록의 한글명은 "일라이 릴리"로 띄어져 있다.
    """

    ROWS = [
        {'stex_tp': 'ND', 'stk_cd': 'AAPL', 'stk_nm': '애플', 'stk_enm': 'APPLE INC', 'isEtf': 'N'},
        {'stex_tp': 'NY', 'stk_cd': 'LLY', 'stk_nm': '일라이 릴리', 'stk_enm': 'ELI LILLY & CO', 'isEtf': 'N'},
        {'stex_tp': 'ND', 'stk_cd': 'MSFT', 'stk_nm': '마이크로소프트', 'stk_enm': 'MICROSOFT CORP', 'isEtf': 'N'},
        {'stex_tp': 'NY', 'stk_cd': 'AAAC', 'stk_nm': 'COLUMBIA AAA CLO', 'stk_enm': 'COLUMBIA AAA CLO', 'isEtf': 'Y'},
    ]

    def setUp(self):
        reset()
        seed({'return_code': 0, 'list': self.ROWS})

    def _search(self, query, limit=5):
        return [row['symbol'] for row in us_stocks.search(query, limit=limit)]

    def test_english_company_name_finds_the_stock(self):
        self.assertEqual(self._search('apple')[0], 'AAPL')
        self.assertEqual(self._search('microsoft')[0], 'MSFT')

    def test_english_name_is_case_insensitive(self):
        self.assertEqual(self._search('APPLE')[0], 'AAPL')

    def test_spacing_in_the_korean_name_is_ignored(self):
        """목록은 "일라이 릴리", 사용자는 "일라이릴리"라고 친다."""
        self.assertEqual(self._search('일라이릴리')[0], 'LLY')
        self.assertEqual(self._search('일라이 릴리')[0], 'LLY')

    def test_alias_and_raw_text_are_both_tried(self):
        """별칭표는 영문명으로 옮겨 준다. 원문도 같이 찾아야 한글명에 걸린다."""
        self.assertEqual(self._search('릴리')[0], 'LLY')

    def test_duplicate_english_name_is_not_stored_twice(self):
        """한글명 자리에 영문이 그대로 들어온 행은 같은 문자열을 두 번 들지 않는다."""
        rows = load({'return_code': 0, 'list': self.ROWS})
        by_symbol = {entry[0]: entry for entry in rows}
        self.assertEqual(by_symbol['AAAC'][4], 'aaac|columbiaaaaclo|',
                         '한글명과 같으면 영문명 자리는 비운다')
        self.assertEqual(by_symbol['AAPL'][4], 'aapl|애플|appleinc')

    def test_korean_query_still_wins_over_english(self):
        self.assertEqual(self._search('애플')[0], 'AAPL')


class SearchThroughRealResponseTest(unittest.TestCase):
    """실제 응답 모양 그대로 search()까지 통과하는지."""

    def setUp(self):
        reset()

    def test_korean_query_finds_the_stock(self):
        seed(REAL_RESPONSE)
        rows = us_stocks.search('엔비디아')
        self.assertEqual([row['symbol'] for row in rows], ['NVDA'])
        self.assertEqual(rows[0]['name'], '엔비디아')
        self.assertEqual(rows[0]['exchange'], 'ND')

    def test_broken_upstream_still_returns_a_typed_ticker(self):
        """폴백은 그대로 둔다 - 목록이 아직 없어도 티커 직접 입력은 돼야 한다."""
        with mock.patch.object(us_stocks, '_start_symbol_list_refresh', return_value=False):
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
