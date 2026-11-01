import os
import re
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def read(path):
    with open(os.path.join(ROOT, path), encoding='utf-8') as handle:
        return handle.read()


class NaverSourceNoteTests(unittest.TestCase):
    def test_common_helper_provides_the_text_without_a_new_element(self):
        shell = read('js/skin-shell.js')
        self.assertIn("naver: '네이버 검색결과'", shell)
        self.assertRegex(shell, r'global\.NineUI = \{[^}]*sourceNote: sourceNote')
        # 헤더 span 규칙(.hen-head span 등)에 걸려 줄이 어긋나지 않도록 별도 요소·전용 스타일을 두지 않는다.
        self.assertNotIn('ui-source-note', shell)
        self.assertNotIn('ui-source-note', read('style.css'))

    def test_every_naver_news_surface_uses_the_shared_helper(self):
        for path in ('js/main-news.js', 'js/home-economic-news.js', 'js/foreign-flow.js'):
            self.assertIn("sourceNote('naver')", read(path), path)

    def test_home_widget_appends_the_note_to_the_existing_session_line_for_domestic_only(self):
        source = read('js/home-economic-news.js')
        self.assertRegex(source, r"market !== 'us' && global\.NineUI && global\.NineUI\.sourceNote")
        self.assertIn("' · ' + sourceNote", source)
        self.assertNotIn('insertAdjacentHTML', source[source.index('function render('):source.index('function render(') + 900])

    def test_news_rows_keep_original_article_links(self):
        # 서버는 네이버 응답의 originallink(언론사 원문)를 우선 link로 내려준다.
        naver = read('scripts/cloud-vm/naver_news.py')
        self.assertIn("'link': it.get('originallink') or it.get('link', '')", naver)
        for path in ('js/main-news.js', 'js/home-economic-news.js'):
            source = read(path)
            self.assertIn('target="_blank" rel="noopener"', source, path)


class RemovedGroqNewsSummaryTests(unittest.TestCase):
    def test_gas_no_longer_builds_llm_prompts_from_naver_news(self):
        gas = read('gas/ticker-proxy.gs')
        self.assertNotIn('summarizeStockNews', gas)
        self.assertNotIn('summarizePriceMoveReason', gas)
        # 가격 이유 경로는 계약({reason})만 남기고 네이버 뉴스를 더 이상 조회하지 않는다.
        start = gas.index('function getPriceMoveReason(')
        end = gas.index('\n}\n', start)
        self.assertNotIn('fetchStockNews', gas[start:end])
        self.assertIn('callGroq(prompt, temperature) { return null; }', gas)


if __name__ == '__main__':
    unittest.main()
