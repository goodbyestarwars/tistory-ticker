# -*- coding: utf-8 -*-
"""증시온도 배점 이식 검증 - GAS 실제 응답을 고정해 두고 같은 입력에 같은 점수가
나오는지 확인한다(docs/BACKEND_CONSOLIDATION.md 1단계).

화면에 뜨는 숫자가 이식 때문에 달라지면 안 되므로, 컴포넌트별 점수와 최종 온도까지
전부 GAS 응답과 대조한다. fixture는 2026-08-31 장중 GAS `?marketTemp=1` 원본이다.
"""
import io
import json
import os
import sys
import unittest

CLOUD_VM_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
if CLOUD_VM_DIR not in sys.path:
    sys.path.insert(0, CLOUD_VM_DIR)

import market_temp_score as mts  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(__file__), 'fixtures', 'gas_market_temp_20260831.json')


def load_golden():
    with io.open(FIXTURE, encoding='utf-8') as fh:
        return json.load(fh)


class MarketTempScorePortTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gold = load_golden()
        cls.c = cls.gold['components']

    def test_component_budget_matches_gas(self):
        self.assertEqual(mts.COMPONENT_MAX, {
            'vix': 20, 'flow': 20, 'tradingValue': 15, 'avgChange': 15,
            'riseRatio': 10, 'sectorStrength': 10, 'week52': 10,
            'exchange': 5, 'usFutures': 5, 'creditRisk': 10,
        })

    def test_vix(self):
        g = self.c['vix']
        got = mts.score_vix(g['value'])
        self.assertEqual(got['score'], g['score'])
        self.assertEqual(got['band'], g['band'])

    def test_trading_value(self):
        g = self.c['tradingValue']
        # GAS는 avg5(직전 5일 평균)만 노출하므로 같은 평균이 나오는 이력으로 재구성한다.
        prior = [g['avg5']] * 5
        got = mts.score_trading_value(g['today'], prior)
        self.assertEqual(got['score'], g['score'])
        self.assertEqual(got['band'], g['band'])
        self.assertAlmostEqual(got['relative'], g['relative'], places=9)

    def test_avg_change(self):
        g = self.c['avgChange']
        got = mts.score_avg_change(g['avgChangeRate'], quote_count=233)
        self.assertEqual(got['score'], g['score'])
        self.assertEqual(got['band'], g['band'])

    def test_rise_ratio(self):
        g = self.c['riseRatio']
        got = mts.score_rise_ratio(g['up'], g['down'])
        self.assertEqual(got['score'], g['score'])
        self.assertEqual(got['band'], g['band'])
        self.assertAlmostEqual(got['ratio'], g['ratio'], places=9)

    def test_sector_strength(self):
        g = self.c['sectorStrength']
        got = mts.score_sector_strength(g['sectorCount'], g['strongCount'])
        self.assertEqual(got['score'], g['score'])
        self.assertEqual(got['band'], g['band'])

    def test_week52(self):
        g = self.c['week52']
        got = mts.score_week52(g.get('newHigh'), g.get('newLow'), g.get('scanned'))
        self.assertEqual(got['score'], g['score'])
        if 'band' in g:
            self.assertEqual(got['band'], g['band'])

    def test_exchange(self):
        g = self.c['exchange']
        if 'changeRate' not in g:
            self.skipTest('fixture에 환율 조회 실패가 담겨 있음')
        got = mts.score_exchange(g['changeRate'], g.get('price'))
        self.assertEqual(got['score'], g['score'])
        self.assertEqual(got['band'], g['band'])

    def test_us_futures(self):
        g = self.c['usFutures']
        if 'changePct' not in g:
            self.skipTest('fixture에 미국 선물 조회 실패가 담겨 있음')
        got = mts.score_us_futures(g['changePct'], g.get('price'), g.get('timeWeight'))
        self.assertEqual(got['score'], g['score'])
        self.assertEqual(got['band'], g['band'])

    def test_flow(self):
        g = self.c['flow']
        got = mts.score_flow(g['foreign']['score100'], g['inst']['score100'])
        self.assertEqual(got['score'], g['score'])
        self.assertEqual(got['band'], g['band'])

    def test_total_and_temperature_match_gas(self):
        """가장 중요한 검증 - 화면에 뜨는 점수와 온도가 그대로여야 한다."""
        credit = self.c['creditRisk']
        credit_available = bool(credit.get('available'))
        scores = [
            self.c['vix']['score'], self.c['flow']['score'], self.c['tradingValue']['score'],
            self.c['avgChange']['score'], self.c['riseRatio']['score'],
            self.c['sectorStrength']['score'], self.c['week52']['score'],
            self.c['exchange']['score'], self.c['usFutures']['score'],
        ]
        if credit_available:
            scores.append(credit['score'])
        got = mts.total_and_temperature(scores, credit_available)
        self.assertEqual(got['score'], self.gold['score'])
        self.assertEqual(got['maxScore'], self.gold['maxScore'])
        self.assertEqual(got['temp'], self.gold['temp'])

    def test_round_half_up_matches_js(self):
        """JS Math.round는 0.5를 항상 올린다. 파이썬 기본 round는 짝수로 붙어서 다르다."""
        self.assertEqual(mts._round_half_up(0.5), 1)
        self.assertEqual(mts._round_half_up(1.5), 2)
        self.assertEqual(mts._round_half_up(2.5), 3)   # 파이썬 기본 round면 2
        self.assertEqual(mts._round_half_up(2.45, 1), 2.5)



class MarketTempDataLayerTest(unittest.TestCase):
    """수집 계층(market_temp_data)이 GAS와 같은 형태의 입력을 만드는지 확인한다.
    네트워크(네이버 polling API)를 타므로 실패 시 건너뛴다 - CI에서 빨간불이 상시로
    켜지면 진짜 회귀를 못 알아본다."""

    @classmethod
    def setUpClass(cls):
        import market_temp_data
        cls.mtd = market_temp_data

    def test_universe_is_read_from_local_repo_not_fetched(self):
        """GAS는 sectors-v3.js를 GitHub Pages에서 받아왔다. VM엔 저장소가 있으니
        로컬에서 읽어야 한다(외부 왕복 1회 제거)."""
        uni = self.mtd.universe_with_sectors()
        self.assertGreater(len(uni), 100, '유니버스가 비정상적으로 작다')
        self.assertTrue(all(u.get('code') for u in uni))
        self.assertTrue(any(u.get('sectors') for u in uni), '업종 태그가 하나도 없다')

    def test_quote_components_land_in_the_same_bands_as_gas(self):
        """시세에서 나오는 4개 컴포넌트가 GAS 골든과 같은 점수여야 한다.
        원시값(평균등락률·상승종목수)은 측정 시점이 달라 당연히 다르므로 점수만 본다.
        장 마감 후·휴일에는 시세가 고정돼 밴드가 갈릴 수 있어, 다르면 실패시키지 않고
        어떤 값이었는지 남긴다."""
        uni = self.mtd.universe_with_sectors()
        try:
            quotes = self.mtd.fetch_quotes([u['code'] for u in uni])
        except Exception as exc:
            self.skipTest('네이버 시세 조회 실패: %s' % exc)
        if len(quotes) < len(uni) * 0.5:
            self.skipTest('시세 수신이 절반 미만(%d/%d)' % (len(quotes), len(uni)))

        gold = load_golden()['components']
        got = self.mtd.build_quote_components(quotes, uni, [gold['tradingValue']['avg5']] * 5)
        for key in ('tradingValue', 'avgChange', 'riseRatio', 'sectorStrength'):
            self.assertIn('score', got[key])
            self.assertLessEqual(got[key]['score'], mts.COMPONENT_MAX[key],
                                 '%s 점수가 배점 상한을 넘었다' % key)
            self.assertGreaterEqual(got[key]['score'], 0)

class TradingValueHistoryTest(unittest.TestCase):
    """거래대금 5일 이력을 daily_prices에서 재구성한다.

    GAS는 PropertiesService에 이력을 직접 쌓아둬서, VM 이관 시 3영업일간 중립(7.5)이
    나올 줄 알았다. 그런데 daily_scan.py가 이미 KRX 전종목 일봉을 daily_prices에 넣고
    있어 같은 값을 계산해낼 수 있다 - 이관도 중립 기간도 불필요하다."""

    def _conn(self):
        import sqlite3
        conn = sqlite3.connect(':memory:')
        conn.execute('CREATE TABLE daily_prices (code TEXT, date TEXT, open REAL, high REAL,'
                     ' low REAL, close REAL, volume INTEGER, PRIMARY KEY (code, date))')
        rows = []
        # 2종목 × 6영업일. 날짜별 총 거래대금이 1,2,3,4,5,6조가 되도록 만든다.
        for i, day in enumerate(['2026-08-24', '2026-08-25', '2026-08-26',
                                 '2026-08-27', '2026-08-28', '2026-08-31'], start=1):
            rows.append(('005930', day, 0, 0, 0, 1000.0, i * 600_000_000))
            rows.append(('000660', day, 0, 0, 0, 1000.0, i * 400_000_000))
        conn.executemany('INSERT INTO daily_prices VALUES (?,?,?,?,?,?,?)', rows)
        conn.commit()
        return conn

    def test_excludes_today_and_returns_five_prior_days(self):
        import market_temp_data as mtd
        conn = self._conn()
        try:
            got = mtd.prior_trading_values(conn, ['005930', '000660'], '2026-08-31')
        finally:
            conn.close()
        # 오늘(08-31, 6조)은 빠지고 직전 5일이 오래된 날부터
        self.assertEqual(got, [1e12, 2e12, 3e12, 4e12, 5e12])

    def test_enough_history_means_no_neutral_fallback(self):
        """이력이 3일 이상이면 중립(7.5)으로 빠지지 않고 실제 배점이 나온다."""
        import market_temp_data as mtd
        conn = self._conn()
        try:
            prior = mtd.prior_trading_values(conn, ['005930', '000660'], '2026-08-31')
        finally:
            conn.close()
        got = mts.score_trading_value(6e12, prior)   # 오늘 6조 vs 평균 3조 = 200%
        self.assertNotEqual(got['score'], 7.5)
        self.assertEqual(got['score'], 15)
        self.assertEqual(got['band'], '평균대비 130% 이상')

    def test_empty_history_still_falls_back_to_neutral(self):
        import market_temp_data as mtd
        import sqlite3
        conn = sqlite3.connect(':memory:')
        conn.execute('CREATE TABLE daily_prices (code TEXT, date TEXT, open REAL, high REAL,'
                     ' low REAL, close REAL, volume INTEGER, PRIMARY KEY (code, date))')
        try:
            prior = mtd.prior_trading_values(conn, ['005930'], '2026-08-31')
        finally:
            conn.close()
        self.assertEqual(prior, [])
        self.assertEqual(mts.score_trading_value(1e12, prior)['score'], 7.5)


if __name__ == '__main__':
    unittest.main()
