# -*- coding: utf-8 -*-
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import db_schema
import migrate_fundamentals


class MigrateFundamentalsDividendTests(unittest.TestCase):
    """fundamentals.fetch_stock()의 dividend 키가 SQLite 이관 과정에서 통째로 빠지던
    문제(2026-08-21 코드 감사) - dividend_json 컬럼을 추가하고 이관 INSERT에 포함했다."""

    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.db_file = os.path.join(self.tmp_dir.name, 'test.sqlite')
        self.cache_file = os.path.join(self.tmp_dir.name, 'fundamentals_cache.json')
        self.corp_map_file = os.path.join(self.tmp_dir.name, 'dart_corp_code_map.json')
        self._patches = [
            mock.patch.object(db_schema, 'DB_FILE', self.db_file),
            mock.patch.object(migrate_fundamentals, 'CACHE_FILE', self.cache_file),
            mock.patch.object(migrate_fundamentals, 'CORP_CODE_MAP_FILE', self.corp_map_file),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self):
        for p in self._patches:
            p.stop()
        self.tmp_dir.cleanup()

    def test_dividend_json_is_migrated_into_sqlite(self):
        cache = {
            'data': {
                '005930': {
                    'annual': {'per': 10.5},
                    'latest_quarter': {'revenue': 1000},
                    'dividend': {'dps': 1500, 'yieldPct': 2.1},
                },
            },
            'fetchedAt': {'005930': '2026-08-21T00:00:00+00:00'},
        }
        with open(self.cache_file, 'w', encoding='utf-8') as f:
            json.dump(cache, f, ensure_ascii=False)

        migrate_fundamentals.main()

        conn = db_schema.get_conn()
        row = conn.execute('SELECT dividend_json FROM fundamentals WHERE code=?', ('005930',)).fetchone()
        conn.close()
        self.assertIsNotNone(row)
        self.assertEqual(json.loads(row[0]), {'dps': 1500, 'yieldPct': 2.1})


if __name__ == '__main__':
    unittest.main()
