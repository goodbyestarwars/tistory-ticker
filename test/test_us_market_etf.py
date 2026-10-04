import os
import sys
import unittest
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import us_market_etf as m


def series(start_close, daily_pct, days=40, volume=1000, start=date(2026, 8, 3), late_pct=None, late_days=0, late_volume=None):
    out, close, d = [], start_close, start
    for i in range(days):
        while d.weekday() >= 5:
            d += timedelta(days=1)
        pct = late_pct if (late_pct is not None and i >= days - late_days) else daily_pct
        close = close * (1 + pct / 100.0)
        vol = late_volume if (late_volume is not None and i >= days - late_days) else volume
        out.append({'time': d.isoformat(), 'close': close, 'volume': vol})
        d += timedelta(days=1)
    return out


class UsMarketEtfTests(unittest.TestCase):
    def setUp(self):
        self.data = {'SPY': series(100, 0.1)}
        for sym, _ in m.SECTOR_ETFS:
            self.data[sym] = series(50, 0.1)
        self.data['XLK'] = series(50, 0.4)                                  # 꾸준히 시장보다 강함 → 주도
        self.data['XLE'] = series(50, -0.3)                                 # 꾸준히 약함 → 이탈
        self.data['XLU'] = series(50, -0.3, late_pct=1.0, late_days=5, late_volume=3000)  # 약하다가 최근 급반등+거래 증가 → 유입
        self.now = datetime(2026, 10, 5, 12, tzinfo=timezone.utc)

    def test_rotation_classifies_leading_lagging_emerging(self):
        result = m.compute_rotation(self.data, now=self.now)
        self.assertTrue(result['available'])
        self.assertEqual(result['market'], 'us')
        phase = {}
        for key in ('emerging', 'leading', 'weakening', 'lagging', 'neutral'):
            for item in result[key]:
                phase[item['ticker']] = key
        self.assertEqual(phase['XLK'], 'leading')
        self.assertEqual(phase['XLE'], 'lagging')
        self.assertEqual(phase['XLU'], 'emerging')
        item = next(i for k in ('emerging', 'leading') for i in result[k] if i['ticker'] == 'XLK')
        self.assertEqual(item['sector'], '기술')
        self.assertIsNone(item['breadthUpRatio'])  # ETF는 구성종목 Breadth가 없다

    def test_rotation_needs_enough_history(self):
        short = {k: v[-10:] for k, v in self.data.items()}
        self.assertFalse(m.compute_rotation(short, now=self.now)['available'])

    def test_etf_returns_periods_and_ytd(self):
        data = {'SPY': [{'time': '2025-12-31', 'close': 100, 'volume': 1}] + [
            {'time': (date(2026, 1, 2) + timedelta(days=i)).isoformat(), 'close': 100 + i, 'volume': 1} for i in range(30)]}
        result = m.etf_returns(data, now=self.now)
        spy = result['items'][0]
        self.assertEqual(spy['symbol'], 'SPY')
        self.assertEqual(spy['returnYtd'], 29.0)
        self.assertAlmostEqual(spy['return1d'], (129 / 128 - 1) * 100, places=2)
        self.assertAlmostEqual(spy['return1w'], (129 / 124 - 1) * 100, places=2)


if __name__ == '__main__':
    unittest.main()
