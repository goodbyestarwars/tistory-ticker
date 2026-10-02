import os
import sqlite3
import sys
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts' / 'cloud-vm'))

import db_schema  # noqa: E402
from google_auth import GoogleAuthService  # noqa: E402


class SectorCardPreferenceTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        db_schema.create_schema(self.conn)
        self.default = {
            '반도체': [{'name': '삼성전자', 'code': '005930', 'market': 'KOSPI'}],
        }
        db_schema.save_sector_cards_config(self.conn, self.default, '2026-08-16T00:00:00Z')

    def tearDown(self):
        self.conn.close()

    def test_personal_cards_do_not_change_shared_default(self):
        first_user = db_schema.upsert_google_user(
            self.conn,
            {'sub': 'user-1', 'email': 'first@example.com', 'name': 'First'},
            '2026-08-16T00:00:00Z',
        )
        second_user = db_schema.upsert_google_user(
            self.conn,
            {'sub': 'user-2', 'email': 'second@example.com', 'name': 'Second'},
            '2026-08-16T00:00:00Z',
        )
        personal = {
            '내 반도체': [{'name': 'SK하이닉스', 'code': '000660', 'market': 'KOSPI'}],
        }

        saved = db_schema.save_user_sector_cards_config(
            self.conn, first_user, personal, '2026-08-16T01:00:00Z', expected_revision=0,
        )

        self.assertTrue(saved['customized'])
        self.assertEqual(db_schema.load_user_sector_cards_config(self.conn, first_user)['sectors'], personal)
        self.assertIsNone(db_schema.load_user_sector_cards_config(self.conn, second_user))
        self.assertEqual(db_schema.load_sector_cards_config(self.conn)['sectors'], self.default)

    def test_reset_deletes_only_personal_override(self):
        user_id = db_schema.upsert_google_user(
            self.conn,
            {'sub': 'user-1', 'email': 'first@example.com', 'name': 'First'},
            '2026-08-16T00:00:00Z',
        )
        db_schema.save_user_sector_cards_config(
            self.conn, user_id, self.default, '2026-08-16T01:00:00Z', expected_revision=0,
        )
        db_schema.delete_user_sector_cards_config(self.conn, user_id)
        self.assertIsNone(db_schema.load_user_sector_cards_config(self.conn, user_id))
        self.assertEqual(db_schema.load_sector_cards_config(self.conn)['sectors'], self.default)

    def test_personal_revision_conflict_is_rejected(self):
        user_id = db_schema.upsert_google_user(
            self.conn,
            {'sub': 'user-1', 'email': 'first@example.com', 'name': 'First'},
            '2026-08-16T00:00:00Z',
        )
        db_schema.save_user_sector_cards_config(
            self.conn, user_id, self.default, '2026-08-16T01:00:00Z', expected_revision=0,
        )
        with self.assertRaisesRegex(RuntimeError, 'USER_SECTOR_CONFIG_REVISION_CONFLICT'):
            db_schema.save_user_sector_cards_config(
                self.conn, user_id, self.default, '2026-08-16T02:00:00Z', expected_revision=0,
            )


class GoogleUserSessionTests(unittest.TestCase):
    def test_signed_session_accepts_non_admin_google_user(self):
        env = {
            'AUTH_SESSION_SECRET': 'unit-test-secret',
            'GOOGLE_OAUTH_CLIENT_ID': 'client-id',
            'GOOGLE_OAUTH_CLIENT_SECRET': 'client-secret',
            'GOOGLE_ADMIN_EMAIL': 'owner@example.com',
        }
        with mock.patch.dict(os.environ, env, clear=False):
            auth = GoogleAuthService()
            cookie = auth.make_session({
                'sub': 'google-user-2',
                'email': 'member@example.com',
                'name': 'Member',
            })
            session = auth.read_session(cookie)
            status = auth.status(cookie)

        self.assertEqual(session['sub'], 'google-user-2')
        self.assertTrue(status['authenticated'])
        self.assertFalse(status['isAdmin'])
        self.assertEqual(status['email'], 'member@example.com')


if __name__ == '__main__':
    unittest.main()


class TopPicksSyncTests(unittest.TestCase):
    """국내 주요종목 '추가 종목' 계정 동기화(2026-10-02)."""

    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        db_schema.create_schema(self.conn)
        self.user = db_schema.upsert_google_user(
            self.conn, {'sub': 'user-1', 'email': 'first@example.com', 'name': 'First'}, '2026-10-02T00:00:00Z',
        )

    def tearDown(self):
        self.conn.close()

    def test_no_row_means_not_synced_and_empty_list_is_distinct(self):
        self.assertIsNone(db_schema.load_user_top_picks(self.conn, self.user))
        db_schema.save_user_top_picks(self.conn, self.user, [], '2026-10-02T01:00:00Z')
        self.assertEqual(db_schema.load_user_top_picks(self.conn, self.user), [])

    def test_save_replaces_list_per_user(self):
        other = db_schema.upsert_google_user(
            self.conn, {'sub': 'user-2', 'email': 'second@example.com', 'name': 'Second'}, '2026-10-02T00:00:00Z',
        )
        db_schema.save_user_top_picks(self.conn, self.user, [{'code': '005930', 'name': '삼성전자'}], '2026-10-02T01:00:00Z')
        db_schema.save_user_top_picks(self.conn, self.user, [{'code': '000660', 'name': 'SK하이닉스'}], '2026-10-02T02:00:00Z')
        self.assertEqual(db_schema.load_user_top_picks(self.conn, self.user), [{'code': '000660', 'name': 'SK하이닉스'}])
        self.assertIsNone(db_schema.load_user_top_picks(self.conn, other))

    def test_endpoints_are_wired(self):
        main = (ROOT / 'scripts' / 'cloud-vm' / 'main.py').read_text(encoding='utf-8')
        self.assertIn("@app.get('/top-picks/me')", main)
        self.assertIn("@app.put('/top-picks/me')", main)
        self.assertIn('def _normalize_top_picks', main)
        self.assertRegex(main, r'(?m)^import re$')
        # 2026-10-02: 추가 종목 UI는 '내 카테고리 편입'으로 대체돼 프론트는 더 이상 이 API를 부르지 않는다.


class SectorMarketOptionalTests(unittest.TestCase):
    def test_theme_stocks_without_market_are_accepted(self):
        import sector_cards
        result = sector_cards.normalize_sector_map({'화장품': [{'name': 'A', 'code': '000001', 'market': ''}]})
        self.assertEqual(result['화장품'][0]['market'], '')
        with self.assertRaises(sector_cards.SectorConfigError):
            sector_cards.normalize_sector_map({'화장품': [{'name': 'A', 'code': '000001', 'market': 'NYSE'}]})
