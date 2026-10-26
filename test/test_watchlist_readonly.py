"""A concurrent scan writer must not block an authenticated watchlist GET."""
import ast
import pathlib
import sqlite3
import sys
import tempfile
import types
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/cloud-vm'))
import db_schema
import watchlist


class WatchlistReadOnlyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = pathlib.Path(self.tmp.name) / 'user state.db'
        self.writer = db_schema.get_conn(self.path)
        self.writer.executescript(db_schema.SCHEMA)
        self.user = {'sub': 'fixture-user', 'email': 'fixture@example.test', 'name': 'Fixture'}
        self.uid = db_schema.upsert_google_user(self.writer, self.user, '2026-10-26')
        config = watchlist.normalize_config({'items': [{'code': '005930', 'name': 'Fixture'}], 'groups': []})
        db_schema.save_watchlist_config(self.writer, self.uid, config, '2026-10-26')
        source = ast.parse((ROOT / 'scripts/cloud-vm/main.py').read_text(encoding='utf-8'))
        function = next(n for n in source.body if isinstance(n, ast.FunctionDef) and n.name == '_load_user_watchlist')
        proxy = types.SimpleNamespace(
            get_conn=lambda **kw: db_schema.get_conn(self.path, **kw),
            find_google_user_id=db_schema.find_google_user_id,
            load_watchlist_config=db_schema.load_watchlist_config,
        )
        # Python 3.12 evaluates the extracted route's Request annotation at exec.
        scope = {'db_schema': proxy, 'watchlist': watchlist, 'Request': object,
                 'require_google_user': lambda request: request}
        exec(compile(ast.Module(body=[function], type_ignores=[]), '<watchlist route>', 'exec'), scope)
        self.get_watchlist = scope['_load_user_watchlist']

    def tearDown(self):
        self.writer.rollback()
        self.writer.close()
        self.tmp.cleanup()

    def test_existing_user_reads_committed_list_during_another_write(self):
        self.writer.execute('BEGIN IMMEDIATE')
        self.writer.execute('UPDATE app_users SET name=? WHERE id=?', ('uncommitted', self.uid))
        result = self.get_watchlist(self.user)
        self.assertEqual(result['items'][0]['code'], '005930')
        self.assertTrue(self.writer.in_transaction)
        self.assertEqual(self.writer.execute('SELECT name FROM app_users WHERE id=?', (self.uid,)).fetchone()[0], 'uncommitted')

    def test_new_authenticated_user_gets_empty_state_without_a_write(self):
        self.writer.execute('BEGIN IMMEDIATE')
        result = self.get_watchlist({'sub': 'new-user', 'email': 'new@example.test'})
        self.assertEqual(result['items'], [])
        self.assertIsNone(db_schema.find_google_user_id(self.writer, {'sub': 'new-user'}))

    def test_read_only_connection_cannot_modify_user_data(self):
        conn = db_schema.get_conn(self.path, read_only=True)
        try:
            with self.assertRaises(sqlite3.OperationalError):
                conn.execute('DELETE FROM app_users')
        finally:
            conn.close()


if __name__ == '__main__':
    unittest.main()
