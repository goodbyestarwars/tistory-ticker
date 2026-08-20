# -*- coding: utf-8 -*-
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

try:
    import pandas  # noqa: F401
    PANDAS_AVAILABLE = True
except ImportError:
    PANDAS_AVAILABLE = False

if PANDAS_AVAILABLE:
    import gongpasan_strategy as gp
    import gongpasan_scan as gs
    from test_gongpasan_strategy import _decline_gongguri_breakout_pullback_rows


@unittest.skipUnless(PANDAS_AVAILABLE, 'pandas가 설치되지 않음 - 관련 모듈과 같은 이유로 '
                      '이 테스트만 독립적으로 스킵한다.')
class GongpasanScanTests(unittest.TestCase):
    def test_score_from_retreat_is_capped_and_non_negative(self):
        self.assertEqual(gs._score_from_retreat(-38.5), 38)
        self.assertEqual(gs._score_from_retreat(-999), 89)
        self.assertEqual(gs._score_from_retreat(None), 0)
        self.assertEqual(gs._score_from_retreat(0), 0)

    def test_build_match_shape_matches_other_pattern_tabs(self):
        rows, _, _ = _decline_gongguri_breakout_pullback_rows()
        df = gp.calculate_gongpasan_signal('005930', rows=rows)
        stock = {'code': '005930', 'name': '삼성전자', 'is_etf': False}
        match = gs._build_match(stock, df)
        for key in ('code', 'name', 'price', 'changeRate', 'date', 'miniChart',
                    'score', 'reasons', 'interpretation', 'patternDetail'):
            self.assertIn(key, match)
        self.assertEqual(match['code'], '005930')
        self.assertLessEqual(len(match['miniChart']), 20)
        self.assertIn('signal', match['patternDetail'])
        self.assertEqual(match['patternDetail']['signal']['date'], match['date'])

    def test_rank_and_cap_sorts_by_score_desc_and_caps_length(self):
        items = [{'score': i, 'date': '2024-01-01'} for i in range(gs.MAX_MATCHES + 10)]
        ranked = gs._rank_and_cap(items)
        self.assertEqual(len(ranked), gs.MAX_MATCHES)
        self.assertEqual(ranked[0]['score'], gs.MAX_MATCHES + 9)

    def test_rank_and_cap_keeps_all_when_under_cap(self):
        items = [{'score': 1, 'date': '2024-01-01'}, {'score': 2, 'date': '2024-01-02'}]
        self.assertEqual(len(gs._rank_and_cap(items)), 2)


if __name__ == '__main__':
    unittest.main()
