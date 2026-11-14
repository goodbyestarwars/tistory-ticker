import os
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/cloud-vm'))
import access_policy as ap
from google_auth import GoogleAuthService


class MembersTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.paths = patch.multiple(ap, MEMBERS_PATH=self.tmp.name + '/members.json', STATE_PATH=self.tmp.name + '/policy.json')
        self.paths.start()
        self.user = dict(sub='google-user', provider='google', email='user@example.com', email_verified=True)

    def tearDown(self):
        self.paths.stop()
        self.tmp.cleanup()

    def test_add_normalize_duplicate_remove_revoke_existing_session(self):
        self.assertFalse(ap.is_member(self.user))
        first = ap.update_member(' USER@EXAMPLE.COM ', 'add', 'admin')
        self.assertEqual(first['emails'], ['user@example.com'])
        self.assertEqual(ap.update_member('user@example.com', 'add', 'admin')['revision'], 1)
        self.assertTrue(ap.is_member(self.user))
        ap.update_member('USER@example.com', 'remove', 'admin')
        self.assertFalse(ap.is_member(self.user))
        self.assertEqual(ap.members_view()['audit'][-1]['action'], 'remove')

    def test_verified_google_only_and_signed_session_marker(self):
        ap.update_member(self.user['email'], 'add', 'admin')
        for changes in ({'provider': 'naver'}, {'email_verified': False}, {'email': 'other@example.com'}):
            self.assertFalse(ap.is_member(dict(self.user, **changes)))
        self.assertFalse(ap.is_member({k:v for k,v in self.user.items() if k != 'email_verified'}))
        with patch.dict(os.environ, AUTH_SESSION_SECRET='test-only-secret'):
            auth=GoogleAuthService()
            self.assertTrue(ap.is_member(auth.read_session(auth.make_session(self.user))))
            self.assertFalse(auth.read_session(auth.make_session(self.user) + 'tampered'))

    def test_invalid_emails_and_corruption_fail_closed(self):
        for email in ('a', 'a@b', 'x\n@y.com', 'a..b@example.com', 'a@example.com, b@example.com', '<x>@example.com', None):
            with self.assertRaises(ValueError): ap.update_member(email, 'add', 'admin')
        Path(ap.MEMBERS_PATH).write_text('{bad')
        self.assertFalse(ap.is_member(self.user))
        with self.assertRaises(ValueError): ap.update_member('user@example.com', 'add', 'admin')
        self.assertEqual(Path(ap.MEMBERS_PATH).read_text(), '{bad')

    def test_role_matrix_and_private_data_guard_unchanged(self):
        screens=ap.view(True, False, True)['screens']
        for key in ('home','stocks','tools','my','market-temp','indicators'):
            self.assertTrue(screens[key]['allowed'], key)
        for key in ('scanner','strategy','autotrader','kis'):
            self.assertFalse(screens[key]['allowed'], key)
        self.assertFalse(ap.view(True, False)['screens']['stocks']['allowed'])
        for p in ('/pattern-scan','/strategy-scan','/quote','/futures','/market-atlas-rs'):
            self.assertTrue(ap.is_restricted_path(p))

    def test_migrate_old_matrix_and_preserve_new_opt_out(self):
        Path(ap.STATE_PATH).write_text('{"roles":{"stocks":{"member":false,"admin":false}}}')
        self.assertTrue(ap.view(True,False,True)['screens']['stocks']['allowed'])
        self.assertFalse(ap.view(True,True)['screens']['stocks']['allowed'])
        self.assertFalse(ap.view(True,True)['screens']['scanner']['allowed'])
        ap.update(None,'admin',roles={'stocks':{'member':False}})
        self.assertFalse(ap.view(True,False,True)['screens']['stocks']['allowed'])

    def test_failed_write_preserves_allowlist(self):
        ap.update_member('user@example.com','add','admin')
        with patch.object(ap.snapshot_io,'atomic_json',side_effect=OSError('disk')):
            with self.assertRaises(OSError): ap.update_member('user@example.com','remove','admin')
        self.assertTrue(ap.is_member(self.user))

if __name__ == '__main__': unittest.main()
