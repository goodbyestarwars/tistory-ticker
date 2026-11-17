"""마켓 브리핑 검색 색인 파서 회귀: 원문 URL/날짜/종목/분류 보존."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import build_briefing_index as b


class BriefingIndexTest(unittest.TestCase):
    def test_category_cards_and_pagination_link(self):
        html = '''
        <section class="feed"><article class="post-card" data-cat="마켓 브리핑" data-url="/1234">
        <div class="post-header"><span class="post-date">2026. 11. 7.</span></div>
        <a href="/1234"><div class="post-title">한화오션·방산 해운</div></a>
        <div class="post-excerpt">본문 검색<img src="/logo.png"> 샘플</div></article>
        </section>'''
        parser = b.CardParser()
        parser.feed(html)
        self.assertEqual(len(parser.cards), 1)
        self.assertEqual(parser.cards[0]["url"], "https://ghlee.tistory.com/1234")
        self.assertEqual(parser.cards[0]["title"], "한화오션·방산 해운")
        self.assertIn("본문 검색", parser.cards[0]["summary"])

    def test_post_body_date_and_stock_identity(self):
        card = {"url":"https://ghlee.tistory.com/1234", "title":"한화오션 방산 해운",
                "date":"2026. 11. 7.", "summary":"방산과 해운을 다룬 글"}
        html = '''
        <article class="post-single card">
          <h1 class="post-single-title">한화오션 방산 해운</h1>
          <div class="post-single-meta"><span class="post-date">2026. 11. 7. 09:32</span></div>
          <div class="post-single-body"><p>작성 기준 2026.11.6. 한국 해운 이야기와
          <b>대우조선해양</b> 사명 변경이 포함돼 있다.</p>
          <script>NOT_IN_SEARCH</script><style>NOT_INDEXED</style>
          <div>방산 수주와 잠수함 프로젝트를 다룬 공개 뉴스이다.</div></div>
        </article>'''
        catalog = [{"name":"한화오션","code":"042660","market":"KOSPI"}]
        result = b.entry(card, html, catalog)
        self.assertEqual(result["publishedAt"], "2026-11-07T09:32:00+09:00")
        self.assertEqual(result["referenceDate"], "2026-11-06")
        self.assertEqual(result["stocks"][0]["role"], "primary")
        self.assertIn("방산", result["industries"])
        self.assertIn("해운", result["industries"])
        self.assertNotIn("not_in_search", result["terms"])
        self.assertNotIn("NOT_INDEXED", result["summary"])

    def test_faceted_topics_nuclear_and_verified_themes(self):
        # Every document has a truthfully grounded subject or neutral fallback.
        topics, industries, themes = b.classify_facets(
            "AI 데이터센터 전력 수요 증가와 원전 SMR 수출", "송배전 변압기와 핵연료를 다룬 원전 건설 분석")
        self.assertIn("원자력·원전", industries)
        self.assertIn("전력·전력기기", industries)
        self.assertNotIn("신재생에너지", industries)
        self.assertIn("AI 데이터센터", themes)
        self.assertIn("SMR", themes)
        self.assertIn("전력 수요", themes)
        self.assertIn("핵연료·우라늄", themes)
        self.assertIn("원전 건설", themes)
        self.assertLessEqual(len(topics), 2)

        budget, _, bitcoin = b.classify_facets("미국 부채 40조 vs 비트코인 7만달러", "")
        self.assertEqual(budget, ["재정·부채", "가상자산"])
        self.assertIn("비트코인", bitcoin)
        rates, _, _ = b.classify_facets("국채금리 다시 5%: 과거 데이터 분석", "")
        self.assertEqual(rates, ["금리·환율"])
        medical, sectors, _ = b.classify_facets("모더나 mRNA 암백신 임상 3상 성공", "")
        self.assertEqual(medical, ["연구·임상"])
        self.assertIn("제약·바이오", sectors)
        neutral, no_industry, no_theme = b.classify_facets("트럼프 CNBC 인터뷰", "")
        self.assertEqual(neutral, ["브리핑·해설"])
        self.assertEqual(no_industry, [])
        self.assertEqual(no_theme, [])
        # '전력 수요' does not automatically imply grid-equipment manufacturers.
        _, no_grid, _ = b.classify_facets("원전 전력 수요 증가", "")
        self.assertIn("원자력·원전", no_grid)
        self.assertNotIn("전력·전력기기", no_grid)
        self.assertEqual(b.INDUSTRY_GROUPS["에너지·전력"][0], "원자력·원전")

    def test_alias_and_market_content_separation(self):
        self.assertTrue(b.mentioned("대우조선해양 방산", "대우조선해양"))
        self.assertFalse(b.mentioned("HMMW", "HMM"))
        self.assertFalse(b.mentioned("한화오션", "한화"))
        self.assertFalse(b.mentioned("우선협상대상자", "대상"))
        self.assertFalse(b.mentioned("SK하이닉스", "SK"))
        self.assertTrue(b.mentioned("$한화 결산 발표", "한화"))
        self.assertTrue(b.mentioned("한화오션은 해군 잠수함 수주", "한화오션"))
        self.assertTrue(b.mentioned("삼성전자는 외국인 매수", "삼성전자"))
        self.assertEqual(b.canonical_url("https://other.test/1234"), "")
        self.assertEqual(b.canonical_url("/1234?x=1"), "https://ghlee.tistory.com/1234")
        self.assertEqual(b.extract_reference_date("시장에 대해 이야기했다."), None)
        terms = b.tokenize("주가 8,051.33원 +5.5% 반도체 관련 2차전지")
        self.assertIn("반도체", terms)
        self.assertIn("2차전지", terms)
        self.assertNotIn("8,051.33", terms)


if __name__ == "__main__":
    unittest.main()
