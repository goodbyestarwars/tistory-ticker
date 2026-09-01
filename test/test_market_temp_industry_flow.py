# -*- coding: utf-8 -*-
"""테마별 자금 흐름 집계 - 증시온도 "오늘 업종 TOP"의 데이터원.

2026-09-01 사용자 요청("TOP 10으로, 대표 종목이 너무 적어, 돈이 도는 흐름을 보고싶어").
기존 소스(`/market-board?limit=40`)는 돌아오는 30종목 중 17개가 ETF라 업종이 없어
버려지고 개별종목이 13개뿐이었다 - 테마 8개, 테마당 1~3종목. 증시온도가 이미 3분마다
받아두는 238종목(37개 테마)을 재사용해 외부 호출 없이 채운다.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))

import market_temp_data as data  # noqa: E402


UNIVERSE = [
    {'code': '005930', 'name': '삼성전자', 'sectors': ['코스피 3대장', '반도체']},
    {'code': '000660', 'name': 'SK하이닉스', 'sectors': ['코스피 3대장', '반도체']},
    {'code': '005380', 'name': '현대차', 'sectors': ['코스피 3대장', '자동차']},
    {'code': '012330', 'name': '현대모비스', 'sectors': ['자동차']},
    {'code': '035420', 'name': 'NAVER', 'sectors': ['IT/플랫폼주']},
    {'code': '999999', 'name': '시세없음', 'sectors': ['반도체']},
]

QUOTES = [
    {'code': '005930', 'name': '삼성전자', 'price': 100, 'volume': 1000, 'changeRate': 1.0, 'change': 1},
    {'code': '000660', 'name': 'SK하이닉스', 'price': 200, 'volume': 1000, 'changeRate': 3.0, 'change': 5},
    {'code': '005380', 'name': '현대차', 'price': 50, 'volume': 1000, 'changeRate': -2.0, 'change': -1},
    {'code': '012330', 'name': '현대모비스', 'price': 10, 'volume': 1000, 'changeRate': -1.0, 'change': -1},
    {'code': '035420', 'name': 'NAVER', 'price': 30, 'volume': 100, 'changeRate': 0.5, 'change': 1},
    # 시세는 있는데 유니버스에 없는 종목 - 무시돼야 한다
    {'code': '111111', 'name': '무관종목', 'price': 999, 'volume': 9999, 'changeRate': 9.0, 'change': 9},
]


class IndustryFlowTest(unittest.TestCase):
    def flow(self, **kw):
        return data.build_industry_flow(QUOTES, UNIVERSE, **kw)

    def test_sorted_by_trade_amount(self):
        rows = self.flow()
        amounts = [r['trade_amount'] for r in rows]
        self.assertEqual(amounts, sorted(amounts, reverse=True))
        by_name = {r['industry']: r['trade_amount'] for r in rows}
        self.assertAlmostEqual(by_name['반도체'], 300000)          # 100*1000 + 200*1000
        self.assertAlmostEqual(by_name['자동차'], 60000)           # 50*1000 + 10*1000
        self.assertAlmostEqual(by_name['코스피 3대장'], 350000)     # 위 셋 중 대형주 3종목

    def test_broad_size_bucket_can_outrank_real_themes(self):
        """`코스피 3대장` 같은 대형주 묶음은 거래대금 상위 종목이 모여 있어 상단을
        차지한다. 지금은 이걸 걸러내지 않는다 - 어떤 테마를 '진짜'로 볼지는 임의
        규칙으로 정할 문제가 아니라서, 동작을 시험으로 못박아 두고 판단은 남겨둔다.
        """
        rows = self.flow()
        self.assertEqual(rows[0]['industry'], '코스피 3대장')

    def test_multi_theme_stock_counts_in_each_theme(self):
        """한 종목이 여러 테마에 속하면 각 테마에 계상한다.

        막대가 '1위 대비 비율'이라 합이 100%일 필요가 없다. 어느 테마를 버릴지
        임의로 정하지 않으려는 선택이다(238개 중 14개, 6%가 복수 테마).
        """
        rows = {r['industry']: r for r in self.flow()}
        self.assertIn('코스피 3대장', rows)
        self.assertIn('반도체', rows)
        # 삼성전자는 두 테마 모두에 들어간다
        self.assertIn('005930', [s['code'] for s in rows['반도체']['stocks']])
        self.assertIn('005930', [s['code'] for s in rows['코스피 3대장']['stocks']])

    def test_quote_missing_stock_is_skipped(self):
        rows = {r['industry']: r for r in self.flow()}
        self.assertNotIn('999999', [s['code'] for s in rows['반도체']['stocks']])
        self.assertEqual(rows['반도체']['stock_count'], 2)

    def test_stock_outside_universe_is_ignored(self):
        for row in self.flow():
            self.assertNotIn('111111', [s['code'] for s in row['stocks']])

    def test_representative_stocks_sorted_and_capped(self):
        rows = {r['industry']: r for r in self.flow(stocks_per=1)}
        semi = rows['반도체']['stocks']
        self.assertEqual(len(semi), 1)
        # 거래대금이 큰 SK하이닉스(200,000)가 삼성전자(100,000)보다 먼저다
        self.assertEqual(semi[0]['code'], '000660')

    def test_top_n_limits_rows(self):
        self.assertEqual(len(self.flow(top_n=2)), 2)
        self.assertGreaterEqual(len(self.flow(top_n=10)), 4)

    def test_avg_change_rate_is_mean_of_members(self):
        rows = {r['industry']: r for r in self.flow()}
        self.assertAlmostEqual(rows['반도체']['avg_change_rate'], 2.0)      # (1.0+3.0)/2
        self.assertAlmostEqual(rows['자동차']['avg_change_rate'], -1.5)     # (-2.0+-1.0)/2

    def test_zero_amount_stock_is_skipped(self):
        quotes = [dict(q) for q in QUOTES]
        for q in quotes:
            if q['code'] == '035420':
                q['volume'] = 0
        rows = {r['industry']: r for r in data.build_industry_flow(quotes, UNIVERSE)}
        self.assertNotIn('IT/플랫폼주', rows)

    def test_empty_inputs_do_not_raise(self):
        self.assertEqual(data.build_industry_flow([], UNIVERSE), [])
        self.assertEqual(data.build_industry_flow(QUOTES, []), [])
        self.assertEqual(data.build_industry_flow(None, None), [])

    def test_default_top_n_is_ten(self):
        """화면이 TOP 10을 보여주려면 기본값이 10이어야 한다(예전엔 8개만 나왔다)."""
        many_universe = [{'code': '%06d' % i, 'name': 'S%d' % i, 'sectors': ['T%02d' % i]}
                         for i in range(20)]
        many_quotes = [{'code': '%06d' % i, 'price': 100 + i, 'volume': 1000, 'changeRate': 0.1}
                       for i in range(20)]
        self.assertEqual(len(data.build_industry_flow(many_quotes, many_universe)), 10)


if __name__ == '__main__':
    unittest.main(verbosity=2)
