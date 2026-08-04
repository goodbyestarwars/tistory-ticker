# -*- coding: utf-8 -*-
import os
import random
import sys
import tempfile
import unittest

CLOUD_VM_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
if CLOUD_VM_DIR not in sys.path:
    sys.path.insert(0, CLOUD_VM_DIR)

import db_schema  # noqa: E402
import strategy_scan  # noqa: E402

EXPECTED_PRESET_IDS = {
    'golden_cross', 'momentum', 'trend_filter', 'week52_high', 'consecutive',
    'disparity', 'breakout_fail', 'strong_close', 'volatility', 'mean_reversion',
}


def _insert_synthetic_daily(conn, code, n, seed):
    rnd = random.Random(seed)
    price = 10000.0
    rows = []
    for i in range(n):
        price = max(100.0, price * (1 + rnd.uniform(-0.03, 0.032)))
        high = price * (1 + rnd.uniform(0, 0.02))
        low = price * (1 - rnd.uniform(0, 0.02))
        rows.append((code, '2026-%04d' % i, price, high, low, price, 1000 + i))
    conn.executemany(
        'INSERT INTO daily_prices (code, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)',
        rows,
    )
    conn.commit()


class LoadPresetsTests(unittest.TestCase):
    def test_loads_all_ten_bundled_presets(self):
        presets = strategy_scan.load_presets()
        self.assertEqual(set(presets), EXPECTED_PRESET_IDS)
        for preset_id, strategy in presets.items():
            self.assertEqual(strategy['strategy']['id'], preset_id)


class BuildMatchTests(unittest.TestCase):
    def test_change_rate_computed_from_last_two_bars(self):
        daily = [
            {'date': '2026-01-01', 'open': 100, 'high': 105, 'low': 95, 'close': 100, 'volume': 1},
            {'date': '2026-01-02', 'open': 100, 'high': 112, 'low': 99, 'close': 110, 'volume': 1},
        ]
        result = {'date': '2026-01-02', 'confidence': 1.0}
        match = strategy_scan.build_match({'code': '005930', 'name': '삼성전자'}, daily, result)
        self.assertEqual(match['code'], '005930')
        self.assertEqual(match['price'], 110)
        self.assertAlmostEqual(match['changeRate'], 10.0)
        self.assertEqual(match['confidence'], 1.0)

    def test_change_rate_none_with_single_bar(self):
        daily = [{'date': '2026-01-01', 'open': 100, 'high': 105, 'low': 95, 'close': 100, 'volume': 1}]
        match = strategy_scan.build_match({'code': '000660', 'name': 'SK하이닉스'}, daily, {'date': '2026-01-01', 'confidence': 0.5})
        self.assertIsNone(match['changeRate'])


class ScanTests(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        db_path = os.path.join(self.tmp_dir, 'test_ohlc.db')
        self.conn = db_schema.get_conn(db_path)
        db_schema.create_schema(self.conn)

    def tearDown(self):
        self.conn.close()

    def test_skips_codes_with_too_few_bars(self):
        _insert_synthetic_daily(self.conn, '000001', n=10, seed=1)  # MIN_BARS(60) 미만
        universe = [{'code': '000001', 'name': '데이터부족종목'}]
        presets = strategy_scan.load_presets()
        matches, scanned, skipped = strategy_scan.scan(universe, presets, self.conn)
        self.assertEqual(scanned, 0)
        self.assertEqual(skipped, 1)
        for preset_id in EXPECTED_PRESET_IDS:
            self.assertEqual(matches[preset_id], [])

    def test_scans_full_universe_without_error_and_sorts_by_confidence(self):
        codes = ['000001', '000002', '000003']
        for i, code in enumerate(codes):
            _insert_synthetic_daily(self.conn, code, n=300, seed=i)
        universe = [{'code': c, 'name': '종목' + c} for c in codes]
        presets = strategy_scan.load_presets()

        matches, scanned, skipped = strategy_scan.scan(universe, presets, self.conn)

        self.assertEqual(scanned, 3)
        self.assertEqual(skipped, 0)
        self.assertEqual(set(matches), EXPECTED_PRESET_IDS)
        for preset_id, items in matches.items():
            codes_seen = set()
            confidences = [m['confidence'] for m in items]
            self.assertEqual(confidences, sorted(confidences, reverse=True))
            for m in items:
                self.assertIn(m['code'], codes)
                self.assertNotIn(m['code'], codes_seen)  # 종목당 프리셋 하나에 최대 1건
                codes_seen.add(m['code'])


if __name__ == '__main__':
    unittest.main()
