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

    def test_broad_size_bucket_is_excluded(self):
        """`코스피 3대장`은 테마가 아니라 시가총액 묶음이라 매일 상단을 차지하면서
        "오늘 어디로 돈이 도는가"에는 정보가 없다(2026-09-01 사용자 지시 "3대장은 빼").
        """
        names = [r['industry'] for r in self.flow()]
        self.assertNotIn('코스피 3대장', names)
        self.assertEqual(names[0], '반도체')      # 제외 후 실제 테마가 1위로 올라온다

    def test_excluded_bucket_does_not_drop_its_stocks(self):
        """묶음만 빼고 종목은 본래 테마에 그대로 남아야 한다."""
        rows = {r['industry']: r for r in self.flow()}
        self.assertIn('005930', [s['code'] for s in rows['반도체']['stocks']])
        self.assertIn('005380', [s['code'] for s in rows['자동차']['stocks']])

    def test_multi_theme_stock_counts_in_each_theme(self):
        """한 종목이 여러 테마에 속하면 각 테마에 계상한다.

        막대가 '1위 대비 비율'이라 합이 100%일 필요가 없다. 어느 테마를 버릴지
        임의로 정하지 않으려는 선택이다(238개 중 14개, 6%가 복수 테마).
        """
        rows = {r['industry']: r for r in self.flow()}
        # 삼성전자는 반도체에, 현대차는 자동차에 들어간다(3대장 묶음은 제외 대상).
        self.assertIn('005930', [s['code'] for s in rows['반도체']['stocks']])
        self.assertIn('005380', [s['code'] for s in rows['자동차']['stocks']])

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
        # 픽스처의 실제 테마는 반도체·자동차·IT/플랫폼주 셋이다(코스피 3대장은 제외).
        self.assertEqual(len(self.flow(top_n=10)), 3)

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



class FlowMultipleTest(unittest.TestCase):
    """'평소 대비 배수' - 거래대금 절대액만 보면 매일 덩치 순서라 돈의 이동이 안 보인다.

    2026-09-02 사용자 요청. 반도체가 2위의 5배인 게 지표 특성 때문이었고, 오늘 값을
    그 테마의 평소값으로 나누면 대형주 편향 없이 "오늘 새로 들어온 곳"이 보인다.
    """

    def setUp(self):
        import sqlite3
        self.conn = sqlite3.connect(':memory:')
        self.conn.execute('CREATE TABLE daily_prices (code TEXT, date TEXT, open REAL,'
                          ' high REAL, low REAL, close REAL, volume INTEGER,'
                          ' PRIMARY KEY (code, date))')
        # 20거래일치를 넣는다. 삼성전자는 하루 100,000, SK하이닉스는 200,000.
        rows = []
        for i in range(1, 25):
            day = '2026-08-%02d' % i
            rows.append(('005930', day, 0, 0, 0, 100.0, 1000))
            rows.append(('000660', day, 0, 0, 0, 200.0, 1000))
        # 현대차는 이력이 3일뿐 - 기준선에서 빠져야 한다(신규 상장 등).
        for i in range(1, 4):
            rows.append(('005380', '2026-08-%02d' % i, 0, 0, 0, 50.0, 1000))
        self.conn.executemany('INSERT INTO daily_prices VALUES (?,?,?,?,?,?,?)', rows)
        self.conn.commit()

    def tearDown(self):
        self.conn.close()

    def test_baseline_is_per_stock_average(self):
        base = data.baseline_trade_amounts(self.conn, ['005930', '000660'], '2026-09-01')
        self.assertAlmostEqual(base['005930'], 100000)
        self.assertAlmostEqual(base['000660'], 200000)

    def test_today_is_excluded_from_baseline(self):
        """오늘은 장중이라 아직 안 끝났다 - 비교 대상은 마감된 날들이다."""
        self.conn.execute("INSERT INTO daily_prices VALUES ('005930','2026-09-01',0,0,0,999.0,9999)")
        self.conn.commit()
        base = data.baseline_trade_amounts(self.conn, ['005930'], '2026-09-01')
        self.assertAlmostEqual(base['005930'], 100000)   # 999*9999가 섞이지 않는다

    def test_short_history_stock_is_dropped(self):
        base = data.baseline_trade_amounts(self.conn, ['005380'], '2026-09-01')
        self.assertNotIn('005380', base)

    def test_multiple_is_today_over_baseline(self):
        rows = [{'industry': '반도체', 'trade_amount': 900000, 'stocks': [
            {'code': '005930', 'trade_amount': 300000},
            {'code': '000660', 'trade_amount': 600000},
        ]}]
        base = data.baseline_trade_amounts(self.conn, ['005930', '000660'], '2026-09-01')
        data.attach_flow_multiple(rows, base)
        # 오늘 900,000 / 평소 300,000 = 3배
        self.assertAlmostEqual(rows[0]['flow_multiple'], 3.0)
        self.assertAlmostEqual(rows[0]['baseline_trade_amount'], 300000)
        self.assertEqual(rows[0]['baseline_stock_count'], 2)

    def test_stock_without_baseline_excluded_from_both_sides(self):
        """분자에만 있고 분모에 없으면 배수가 부풀려진다 - 양쪽에서 같이 뺀다."""
        rows = [{'industry': '혼합', 'trade_amount': 1000000, 'stocks': [
            {'code': '005930', 'trade_amount': 300000},
            {'code': '005380', 'trade_amount': 700000},   # 기준선 없음
        ]}]
        base = data.baseline_trade_amounts(self.conn, ['005930', '005380'], '2026-09-01')
        data.attach_flow_multiple(rows, base)
        # 005380은 양쪽에서 빠져 300,000 / 100,000 = 3배
        self.assertAlmostEqual(rows[0]['flow_multiple'], 3.0)
        self.assertEqual(rows[0]['baseline_stock_count'], 1)

    def test_no_baseline_at_all_gives_none(self):
        rows = [{'industry': '신생', 'trade_amount': 500, 'stocks': [
            {'code': '999999', 'trade_amount': 500}]}]
        data.attach_flow_multiple(rows, {})
        self.assertIsNone(rows[0]['flow_multiple'])
        self.assertIsNone(rows[0]['baseline_trade_amount'])

    def test_empty_codes_does_not_query(self):
        self.assertEqual(data.baseline_trade_amounts(self.conn, [], '2026-09-01'), {})

if __name__ == '__main__':
    unittest.main(verbosity=2)
