import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts' / 'cloud-vm'))

import memo  # noqa: E402


class MemoConfigTests(unittest.TestCase):
    def test_normalizes_free_memo(self):
        result = memo.normalize_items([
            {'id': 'm1', 'body': '오늘의 생각', 'createdAt': '2026-09-23T00:00:00Z'},
        ])
        self.assertEqual(result[0]['code'], None)
        self.assertEqual(result[0]['body'], '오늘의 생각')
        # createdAt이 있고 updatedAt이 없으면 createdAt으로 채운다.
        self.assertEqual(result[0]['updatedAt'], '2026-09-23T00:00:00Z')

    def test_normalizes_stock_memo(self):
        result = memo.normalize_items([{
            'id': 'm2', 'code': '005930', 'name': '삼성전자',
            'body': '매수 이유', 'createdAt': '2026-09-23T00:00:00Z',
        }])
        self.assertEqual(result[0]['code'], '005930')
        self.assertEqual(result[0]['name'], '삼성전자')

    def test_drops_name_when_code_missing(self):
        # code 없는 메모에 name만 남아있으면 혼란스러우니 비운다.
        result = memo.normalize_items([{
            'id': 'm3', 'name': '삼성전자', 'body': '자유 메모',
            'createdAt': '2026-09-23T00:00:00Z',
        }])
        self.assertIsNone(result[0]['code'])
        self.assertIsNone(result[0]['name'])

    def test_rejects_duplicate_ids(self):
        with self.assertRaises(memo.MemoConfigError):
            memo.normalize_items([
                {'id': 'dup', 'body': 'a', 'createdAt': '2026-09-23T00:00:00Z'},
                {'id': 'dup', 'body': 'b', 'createdAt': '2026-09-23T00:00:00Z'},
            ])

    def test_rejects_empty_body(self):
        with self.assertRaises(memo.MemoConfigError):
            memo.normalize_items([{'id': 'm4', 'body': '  ', 'createdAt': '2026-09-23T00:00:00Z'}])

    def test_rejects_missing_created_at(self):
        with self.assertRaises(memo.MemoConfigError):
            memo.normalize_items([{'id': 'm5', 'body': 'no timestamp'}])

    def test_rejects_too_many_items(self):
        items = [
            {'id': 'm%d' % i, 'body': 'x', 'createdAt': '2026-09-23T00:00:00Z'}
            for i in range(memo.MAX_ITEMS + 1)
        ]
        with self.assertRaises(memo.MemoConfigError):
            memo.normalize_items(items)

    def test_rejects_non_list_payload(self):
        with self.assertRaises(memo.MemoConfigError):
            memo.normalize_items({'id': 'm1'})


if __name__ == '__main__':
    unittest.main()
