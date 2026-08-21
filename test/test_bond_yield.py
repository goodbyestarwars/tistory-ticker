# -*- coding: utf-8 -*-
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import bond_yield


class FetchHistoryThrottleTests(unittest.TestCase):
    """fetch_history()가 최대 58페이지를 쉬는 시간 없이 순차 호출하던 문제(2026-08-21
    코드 감사) - 페이지 사이에 최소한의 쓰로틀을 넣었다."""

    def test_sleeps_between_pages_but_not_after_the_last_one(self):
        pages = [
            [{'date': '20260101', 'value': 3.0, 'change': 0.0, 'change_rate': 0.0}],
            [{'date': '20260102', 'value': 3.1, 'change': 0.1, 'change_rate': 3.2}],
            [],  # 세 번째 페이지가 비어서 여기서 멈춰야 함
        ]
        with mock.patch.object(bond_yield, '_fetch_page', side_effect=pages) as fetch_page, \
                mock.patch.object(bond_yield.time, 'sleep') as sleep:
            rows = bond_yield.fetch_history(days=bond_yield._ROWS_PER_PAGE * 3)

        self.assertEqual(len(rows), 2)
        self.assertEqual(fetch_page.call_count, 3)
        # 1페이지 뒤, 2페이지 뒤에는 쉬고(다음 페이지를 더 부를 예정이라), 3페이지는 빈
        # 값을 받고 바로 멈추므로 그 뒤엔 안 쉰다.
        self.assertEqual(sleep.call_count, 2)
        sleep.assert_called_with(bond_yield._PAGE_THROTTLE_SEC)


if __name__ == '__main__':
    unittest.main()
