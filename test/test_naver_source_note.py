import os
import re
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def read(path):
    with open(os.path.join(ROOT, path), encoding='utf-8') as handle:
        return handle.read()


class NaverSourceNoteTests(unittest.TestCase):
    def test_common_helper_and_global_style_exist(self):
        shell = read('js/skin-shell.js')
        self.assertIn("naver: '네이버 검색결과'", shell)
        self.assertRegex(shell, r'global\.NineUI = \{[^}]*sourceNote: sourceNote')
        css = read('style.css')
        rule = re.search(r'\.ui-source-note\s*\{([^}]*)\}', css)
        self.assertIsNotNone(rule)
        self.assertIn('var(--text-sub)', rule.group(1))
        self.assertNotIn('!important', rule.group(1))

    def test_every_naver_news_surface_uses_the_shared_helper(self):
        for path in ('js/main-news.js', 'js/home-economic-news.js', 'js/foreign-flow.js'):
            self.assertIn("sourceNote('naver'", read(path), path)

    def test_home_widget_labels_only_the_domestic_market(self):
        source = read('js/home-economic-news.js')
        self.assertRegex(source, r"market !== 'us' && global\.NineUI && global\.NineUI\.sourceNote")

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
