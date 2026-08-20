# -*- coding: utf-8 -*-
import os
import sys
import unittest
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

try:
    import pandas  # noqa: F401
    PANDAS_AVAILABLE = True
except ImportError:
    PANDAS_AVAILABLE = False

if PANDAS_AVAILABLE:
    import accumulation_angle as aa
    import angle_momentum_scan as ams


def _flat_accelerate_rows(flat_days=40, accel_days=30, base=10000, accel_step=8):
    rows = []
    price = float(base)
    cursor = date(2024, 1, 1)
    for _ in range(flat_days):
        rows.append({
            'date': cursor.isoformat(), 'open': price - 5, 'high': price + 10,
            'low': price - 10, 'close': price, 'volume': 1000,
        })
        cursor += timedelta(days=1)
    for i in range(accel_days):
        price += (i + 1) * accel_step
        rows.append({
            'date': cursor.isoformat(), 'open': price - accel_step, 'high': price + 10,
            'low': price - accel_step - 10, 'close': price, 'volume': 1000,
        })
        cursor += timedelta(days=1)
    return rows


@unittest.skipUnless(PANDAS_AVAILABLE, 'pandas가 설치되지 않음 - accumulation_angle과 같은 '
                      '이유로 이 테스트만 독립적으로 스킵한다.')
class AngleMomentumScanTests(unittest.TestCase):
    def test_build_match_shape_matches_other_pattern_tabs(self):
        rows = _flat_accelerate_rows()
        df = aa.compute_accumulation_angle('005930', conn=object(), rows=rows)
        stock = {'code': '005930', 'name': '삼성전자', 'is_etf': False}
        match = ams._build_match(stock, df)
        for key in ('code', 'name', 'price', 'changeRate', 'date', 'miniChart',
                    'score', 'reasons', 'interpretation', 'patternDetail'):
            self.assertIn(key, match)
        self.assertEqual(match['code'], '005930')
        self.assertEqual(match['name'], '삼성전자')
        self.assertLessEqual(len(match['miniChart']), 20)
        self.assertIn('signal', match['patternDetail'])
        self.assertEqual(match['patternDetail']['signal']['date'], match['date'])

    def test_build_match_score_is_capped_and_non_negative(self):
        rows = _flat_accelerate_rows(accel_days=60, accel_step=40)  # 극단적 가속 -> 큰 각도
        df = aa.compute_accumulation_angle('005930', conn=object(), rows=rows)
        stock = {'code': '005930', 'name': '삼성전자', 'is_etf': False}
        match = ams._build_match(stock, df)
        self.assertGreaterEqual(match['score'], 0)
        self.assertLessEqual(match['score'], ams.SCORE_CAP)

    def test_rank_and_cap_sorts_by_score_desc_and_caps_length(self):
        items = [{'score': i, 'date': '2024-01-01'} for i in range(ams.MAX_MATCHES + 10)]
        ranked = ams._rank_and_cap(items)
        self.assertEqual(len(ranked), ams.MAX_MATCHES)
        self.assertEqual(ranked[0]['score'], ams.MAX_MATCHES + 9)
        scores = [it['score'] for it in ranked]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_rank_and_cap_keeps_all_when_under_cap(self):
        items = [{'score': 1, 'date': '2024-01-01'}, {'score': 2, 'date': '2024-01-02'}]
        ranked = ams._rank_and_cap(items)
        self.assertEqual(len(ranked), 2)


if __name__ == '__main__':
    unittest.main()
