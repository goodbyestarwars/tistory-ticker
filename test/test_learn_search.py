# -*- coding: utf-8 -*-
"""이야기 시리즈 전체 검색 계약.

- 모든 learn/*.html이 같은 검색창(#learn-search)과 js/learn-search.js를 쓴다.
- data/learn-search.js 색인은 learn/ 본문과 data/glossary.js에서 만든 최신본이어야 한다
  (본문을 고치면 `node scripts/build_learn_search.js`를 다시 실행한다).
- 색인에 모든 페이지와 용어사전 용어가 들어 있다.
"""
import json
import os
import re
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEARN = os.path.join(ROOT, 'learn')
INDEX = os.path.join(ROOT, 'data', 'learn-search.js')


def pages():
    return sorted(n for n in os.listdir(LEARN) if n.endswith('.html'))


def load_index():
    text = open(INDEX, encoding='utf-8').read()
    return json.loads(text[text.index('{', text.index('window.NINE_LEARN_SEARCH')):text.rindex('}') + 1])


class LearnSearchContract(unittest.TestCase):
    def test_every_story_mounts_the_shared_search(self):
        for name in pages():
            with self.subTest(page=name):
                html = open(os.path.join(LEARN, name), encoding='utf-8').read()
                self.assertEqual(html.count('id="learn-search"'), 1)
                self.assertIn('defer src="../js/learn-search.js"', html)

    def test_index_covers_every_page_and_glossary_term(self):
        data = load_index()
        indexed = {e['u'] for e in data['s']}
        self.assertEqual(indexed, set(pages()))
        glossary = open(os.path.join(ROOT, 'data', 'glossary.js'), encoding='utf-8').read()
        self.assertEqual(len(data['g']), len(re.findall(r"\{\s*t:\s*'", glossary)))

    def test_hedge_fund_story_is_searchable(self):
        data = load_index()
        hits = [e for e in data['s'] if e['u'] == 'hedge-fund.html' and '롱숏' in e['x']]
        self.assertTrue(hits)
        self.assertTrue(all(e['i'] for e in hits if e['h']))

    @unittest.skipUnless(shutil.which('node'), 'node 필요')
    def test_index_is_up_to_date(self):
        result = subprocess.run(['node', os.path.join(ROOT, 'scripts', 'build_learn_search.js'), '--check'],
                                capture_output=True, text=True, encoding='utf-8')
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
