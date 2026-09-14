# -*- coding: utf-8 -*-
"""/health를 실제로 호출하는 런타임 테스트(2026-09-15).

#444에서 `/health`에 배포 커밋을 붙이며 `re.fullmatch`를 썼는데 main.py에 `import re`가 없어,
배포 뒤 `/health`가 500을 냈다. 소스 문자열만 보는 계약 테스트로는 잡히지 않아 함수를 직접 부른다.
"""

import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))


class HealthRuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import main  # noqa: E402 - FastAPI 앱 모듈(다른 라우트 테스트와 같은 방식으로 import)
        cls.main = main

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.original = self.main._DEPLOYED_SHA_FILE
        self.addCleanup(setattr, self.main, '_DEPLOYED_SHA_FILE', self.original)

    def use_sha_file(self, text):
        path = os.path.join(self.tmp, '.last_deployed_sha')
        with open(path, 'w', encoding='utf-8') as handle:
            handle.write(text)
        self.main._DEPLOYED_SHA_FILE = path

    def test_health_runs_and_reports_the_deployed_commit(self):
        sha = 'b43f0c3c62d4ebd8828f1f8164209bae2a0460b6'
        self.use_sha_file(sha + '\n')
        found, recorded = self.main._deployed_commit()
        self.assertEqual(found, sha)
        self.assertTrue(recorded)
        self.main.health()  # 예외 없이 끝나야 한다(예전엔 NameError: re)

    def test_health_runs_without_a_sha_file(self):
        self.main._DEPLOYED_SHA_FILE = os.path.join(self.tmp, 'missing')
        self.assertEqual(self.main._deployed_commit(), (None, None))
        self.main.health()

    def test_non_sha_content_is_not_exposed(self):
        self.use_sha_file('not-a-sha; rm -rf /\n')
        self.assertEqual(self.main._deployed_commit(), (None, None))


if __name__ == '__main__':
    unittest.main()
