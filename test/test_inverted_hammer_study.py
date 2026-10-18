# -*- coding: utf-8 -*-
"""역망치·세력 탈출 일봉 연구(scripts/research/inverted_hammer_study.py)의 정의 계약."""
import importlib.util
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('ih', os.path.join(ROOT, 'scripts', 'research', 'inverted_hammer_study.py'))
ih = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ih)


class ShapeTests(unittest.TestCase):
    def test_inverted_hammer_shape(self):
        self.assertTrue(ih.shape_inverted_hammer(100, 110, 99.5, 100.5))        # 윗꼬리 큼, 몸통 작음, 아랫꼬리 거의 없음
        self.assertFalse(ih.shape_inverted_hammer(100, 110, 90, 105))           # 아랫꼬리가 큼(별/망치 아님)
        self.assertFalse(ih.shape_inverted_hammer(100, 101, 99.9, 100.2))       # 범위 2% 미만
        self.assertFalse(ih.shape_inverted_hammer(100, 110, 100, 108))          # 몸통이 큼

    def test_pierce_back_needs_one_to_one_and_close_below(self):
        self.assertTrue(ih.pierce_back(h=110, l=100, c=101, ma=104))            # 위 6 >= 아래 4, 종가는 이평선 아래
        self.assertFalse(ih.pierce_back(h=110, l=100, c=101, ma=106))           # 위 4 < 아래 6
        self.assertFalse(ih.pierce_back(h=110, l=100, c=107, ma=104))           # 종가가 이평선 위(뚫고 빠지지 않음)
        self.assertFalse(ih.pierce_back(h=110, l=105, c=106, ma=104))           # 이평선이 봉 밖


def rows(n=300, price=10000.0, vol=1000000):
    return [['d%04d' % i, price, price * 1.005, price * 0.995, price, vol] for i in range(n)]


class TagTests(unittest.TestCase):
    def test_hammer_above_224_with_volume_is_exit_and_no_volume_is_contrast(self):
        r = rows()
        r[270] = ['d0270', 10000.0, 11000.0, 9950.0, 10050.0, 5000000]               # 대량 역망치, 224선(≈10000) 위
        ev, _ = ih.analyze_stock(r)
        self.assertEqual(len(ev['EXIT_224선 위']), 1)
        r2 = rows()
        r2[270] = ['d0270', 10000.0, 11000.0, 9950.0, 10050.0, 500000]               # 거래량 적은 역망치
        ev2, _ = ih.analyze_stock(r2)
        self.assertNotIn('EXIT_224선 위', ev2)
        self.assertEqual(len(ev2['CONTRAST_고점 무거래량(224선 위)']), 1)

    def test_tags_use_only_data_through_signal_day(self):
        a = rows()
        a[270] = ['d0270', 10000.0, 11000.0, 9950.0, 10050.0, 5000000]
        b = [list(x) for x in a]
        for k in range(271, 300):
            b[k] = ['d%04d' % k, 1.0, 2.0, 0.5, 1.5, 1]                    # 신호 뒤 봉만 바꾼다
        ea, _ = ih.analyze_stock(a)
        eb, _ = ih.analyze_stock(b)
        self.assertEqual([d for d, g, m in ea['EXIT_224선 위']], [d for d, g, m in eb['EXIT_224선 위']])

    def test_t_stat(self):
        self.assertIsNone(ih.t_stat([1.0, 2.0]))
        self.assertGreater(ih.t_stat([1.0, 1.1, 0.9, 1.2]), 5)


if __name__ == '__main__':
    unittest.main()
