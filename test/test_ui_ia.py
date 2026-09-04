import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class UiInformationArchitectureTest(unittest.TestCase):
    def read(self, relative):
        return (ROOT / relative).read_text(encoding="utf-8")

    def test_primary_navigation_has_my_item(self):
        source = self.read("js/skin-menu.js")
        primary_labels = re.findall(
            r"^\s{4}(?:\{ href: '[^']+', label: '([^']+)' \}|\{\s*$)",
            source,
            re.MULTILINE,
        )
        self.assertEqual(source.count("      label: '시장',"), 1)
        self.assertNotIn("{ href: '/page/stock-search', label: '종목' }", source)
        self.assertEqual(source.count("      label: '종목',"), 1)
        self.assertIn("{ href: '/page/foreign-flow', label: '종목분석' }", source)
        self.assertIn("{ href: '/page/stock-search', label: '실시간 시세 (US. Include)' }", source)
        self.assertEqual(source.count("      label: '종목검색',"), 1)
        self.assertNotIn("label: '종목뉴스'", source)
        self.assertIn("{ href: '/page/watchlist', label: 'MY' }", source)
        self.assertNotIn("label: '미국주식'", source)
        self.assertEqual(len(primary_labels), 7)

    def test_write_button_uses_top_level_tistory_auth_navigation(self):
        skin = self.read("skin.html")
        shell = self.read("js/skin-shell.js")
        self.assertIn('href="[##_blog_link_##]manage/newpost/" class="nav-icon-btn nav-write-btn"', skin)
        self.assertNotIn("onclick=\"openArticleModal('[##_blog_link_##]manage/newpost/'", skin)
        self.assertIn("function initWriteButton()", shell)
        self.assertIn("writeLink.removeAttribute('onclick')", shell)
        self.assertIn("event.stopImmediatePropagation()", shell)
        self.assertIn("(window.top || window).location.href = writeUrl", shell)

    def test_legacy_font_toggle_is_removed_from_the_live_skin(self):
        menu = self.read("js/skin-menu.js")
        style = self.read("style.css")
        self.assertIn("function removeLegacyFontToggle()", menu)
        self.assertIn("#fontModeBtn, .nav-font-btn", menu)
        self.assertIn("localStorage.removeItem('bolt-font')", menu)
        self.assertIn(".nav-font-btn { display: none !important; }", style)

    def test_market_briefing_category_uses_stable_newspaper_layout(self):
        source = self.read("js/skin-main.js")
        style = self.read("style.css")
        start = source.index("function buildCategoryFeedBlocks()")
        end = source.index("/* ── 데스크톱 사이드바 토글", start)
        category_source = source[start:end]
        self.assertIn("category-masthead", category_source)
        self.assertIn("var BLOCK_SEQUENCE", category_source)
        self.assertIn("sequenceIndex % BLOCK_SEQUENCE.length", category_source)
        self.assertIn("var isMarketBriefing = decodeURIComponent(location.pathname) === '/category/마켓 브리핑';", category_source)
        self.assertIn("var heroTake = Math.min(4, cards.length);", category_source)
        self.assertIn("renderBlock('briefingHero', cards.slice(0, heroTake)", category_source)
        self.assertIn("renderBlock('briefingCards', briefingSlice, briefingBefore);", category_source)
        self.assertIn("feed-block-briefing-hero", category_source)
        self.assertIn("feed-block-briefing-cards", category_source)
        self.assertNotIn("Math.random()", category_source)
        self.assertIn(".category-masthead", style)
        self.assertIn("font: 700 30px/1.15 var(--font-title)", style)
        self.assertIn(".feed-block-briefing-hero .post-card.feed-headline-item .post-title", style)
        self.assertIn("-webkit-line-clamp: 3;", style)

    def test_stock_menu_opens_analysis_and_search_submenu(self):
        source = self.read("js/skin-menu.js")
        group = re.search(
            r"\{\n\s+label: '종목',\n\s+children: \[(?P<body>.*?)\n\s+\]\n\s+\},",
            source,
            re.DOTALL,
        )
        self.assertIsNotNone(group)
        body = group.group("body")
        self.assertIn("{ href: '/page/foreign-flow', label: '종목분석' }", body)
        self.assertIn("{ href: '/page/market-temp?view=stocks', label: '국내 주요종목' }", body)
        self.assertIn("{ href: '/page/stock-search', label: '실시간 시세 (US. Include)' }", body)
        search_group = re.search(
            r"\{\n\s+label: '종목검색',\n\s+children: \[(?P<body>.*?)\n\s+\]\n\s+\},",
            source,
            re.DOTALL,
        )
        self.assertIsNotNone(search_group)
        search_body = search_group.group("body")
        self.assertIn("{ href: '/page/pattern-scan', label: '차트검색' }", search_body)
        self.assertIn("{ href: '/page/strategy-search', label: '전략검색' }", search_body)

    def test_domestic_market_indicators_is_separate_from_temperature_and_combined_with_futures(self):
        menu = self.read("js/skin-menu.js")
        market_temp = self.read("js/market-temp.js")
        futures = self.read("js/kospi-futures.js")
        self.assertIn("{ href: '/page/market-temp', label: '증시온도' }", menu)
        self.assertIn("{ href: '/pages/kospi-futures', label: '국내시장지표' }", menu)
        self.assertNotIn("domestic-market-indicators", market_temp)
        self.assertIn("function loadDomesticMarketIndicators(container)", futures)
        self.assertIn("/pages/kospi-futures", futures)
        self.assertIn("container.parentNode.insertBefore(mount, container)", futures)

    def test_domestic_major_stocks_has_independent_market_temperature_view(self):
        menu = self.read("js/skin-menu.js")
        source = self.read("js/market-temp.js")
        style = self.read("css/market-temp.css")
        self.assertIn("{ href: '/page/market-temp?view=stocks', label: '국내 주요종목' }", menu)
        self.assertIn("query.get('view') === 'stocks'", menu)
        self.assertIn("if (!parts[1]) return query.get('view') !== 'stocks';", menu)
        market_group = re.search(
            r"\{\n\s+label: '시장',\n\s+children: \[(?P<body>.*?)\n\s+\]\n\s+\},",
            menu,
            re.DOTALL,
        )
        self.assertIsNotNone(market_group)
        self.assertNotIn("label: '국내 주요종목'", market_group.group("body"))
        self.assertIn("function isStocksView()", source)
        self.assertIn("buildStocksOnlyPage", source)
        self.assertIn("container.innerHTML = buildCard(data);", source)
        self.assertIn("mt-stocks-only-heading", style)
        self.assertIn("#market-temp .mt-view-btn", style)
        self.assertIn("border-radius: 4px;", style)
        self.assertIn(".sector-view-btn", self.read("css/sector-dashboard-v3.css"))

    def test_domestic_market_indicators_labels_and_provider_contract(self):
        frontend = self.read("js/domestic-market-indicators.js")
        loader = self.read("js/kospi-futures.js")
        backend = self.read("scripts/cloud-vm/domestic_market_indicators.py")
        style = self.read("css/domestic-market-indicators.css")
        self.assertIn("KOSPI · KOSDAQ 현물 (09:00~15:45)", frontend)
        market_temp = self.read("js/market-temp.js")
        self.assertIn("row.change_rate != null ? row.change_rate : row.changeRate", market_temp)
        self.assertNotIn("현물 기준 · 키움 → KIS → 네이버 fallback", frontend)
        self.assertNotIn("kiwoom/kis/naver background collector", backend)
        self.assertIn("'source': 'KIS'", backend)
        # 2026-08-12: 신용잔고/고객예탁금(_fetch_kis_funds)은 KIS 전용으로 고정하고 KOFIA
        # fallback을 제거했다 - 이 함수 본문에는 KOFIA 호출이 없어야 한다.
        kis_funds_fn = re.search(r"def _fetch_kis_funds\(.*?\n(?=def )", backend, re.DOTALL)
        self.assertIsNotNone(kis_funds_fn)
        self.assertNotIn("public_data.fetch_kofia_market", kis_funds_fn.group(0))
        # 2026-08-14: 신용대주잔고/예탁증권담보융자는 KIS에 없는 필드라 별도로 KOFIA를
        # 쓴다 - 위 KIS 전용 방침은 credit/deposits 한정이지 전체 파일 금지가 아니다.
        self.assertIn("def fetch_leverage_detail():", backend)
        self.assertIn("public_data.fetch_kofia_market", backend)
        self.assertNotIn("naver fallback", backend)
        for token in ("color: #000;", "textColor: '#000'"):
            self.assertIn(token, style if token == "color: #000;" else frontend)
        self.assertIn(".dmi-flow-table td.dmi-positive { color: #d24f45 !important; }", style)
        self.assertIn(".dmi-flow-table td.dmi-negative { color: #1261c4 !important; }", style)
        # 2026-08-21 코드 감사: .dmi-fund-card *(유니버설 자손 선택자)가 .dmi-fund-value.
        # dmi-positive/negative의 상승/하락 색을 가리고 있었다(2026-08-14 발견 당시 !important로
        # 임시 대응) - 근본 원인인 유니버설 선택자 자체를 없앴으니 더는 존재하면 안 된다.
        self.assertNotIn(".dmi-fund-card *", style)
        self.assertIn(".dmi-shell .dmi-fund-card,", style)  # 컨테이너 자체의 color:#000은 유지
        self.assertIn("domestic-market-indicators.css?v=20260827-dmi-chart-controls-v6", frontend)
        self.assertIn("domestic-market-indicators.js?v=20260827-dmi-funds-live-v5", loader)
        self.assertIn("kospi-futures.css?v=20260827-kf-chart-controls-v2", loader)
        self.assertIn("function installKospiFuturesStyle()", loader)
        self.assertIn("installKospiFuturesStyle();", loader)
        self.assertIn(".kf-option-profile-scroll { max-height: 390px; overflow-y: auto;", self.read("css/kospi-futures.css"))
        self.assertIn(".dmi-mini-chart-avg { stroke: #c9701f; stroke-width: 1; stroke-dasharray: none; }", style)
        self.assertIn("function fundSeriesValues(funds, field)", frontend)
        self.assertIn("function miniAverageChart(values, average)", frontend)
        self.assertIn("function chartValuesWithFallback(values, current, average)", frontend)
        self.assertIn("<td class=\"dmi-spot-price ' + cls + '\">", frontend)
        self.assertNotIn("dmi-above", frontend)
        self.assertNotIn("dmi-below", frontend)
        self.assertIn("var anchor = Number(average) === Number(current) ? 0 : Number(average);", frontend)
        self.assertIn("#domestic-market-indicators .dmi-spot-section .dmi-panel", style)
        self.assertIn("#domestic-market-indicators .dmi-spot-section {", style)
        self.assertIn("border-top: 0 !important;", style)
        self.assertIn("border-bottom: 0 !important;", style)
        self.assertIn("rightPriceScale: { borderVisible: false }", frontend)
        self.assertIn("secondsVisible: false, borderVisible: false", frontend)
        self.assertIn(".dmi-mini-chart.dmi-positive .dmi-mini-chart-line { stroke: #d24f45; }", style)
        self.assertIn(".dmi-mini-chart.dmi-negative .dmi-mini-chart-line { stroke: #1261c4; }", style)
        self.assertIn(".dmi-mini-chart-line { stroke-width: 1.2;", style)
        self.assertIn("function normalizeProgramTrading(programTrading)", frontend)
        self.assertIn("programTrading = normalizeProgramTrading(programTrading || {});", frontend)
        self.assertIn("chartPanel('KOSPI', { name: 'KOSPI' })", frontend)
        self.assertIn("chartPanel('KOSDAQ', { name: 'KOSDAQ' })", frontend)
        self.assertIn("#domestic-market-indicators .dmi-tab.is-active", style)
        self.assertIn(".dmi-mini-chart-line { stroke-width: 1;", style)
        self.assertIn("kf-interval-tabs", loader)
        self.assertIn("kf-draw-buttons", loader)
        self.assertIn("신용잔고 (빚투)", frontend)
        self.assertIn("신용대주잔고", frontend)
        self.assertIn("예탁증권담보융자", frontend)
        self.assertIn("최근 평균", frontend)
        self.assertIn("1년 평균", frontend)
        self.assertIn("투자자가 증권사에서 돈을 빌려 주식을 산 금액이에요.", frontend)
        self.assertIn("dmi-draw-toggle", frontend)
        self.assertIn(".dmi-tabs .dmi-draw-toggle", style)
        self.assertIn("dmi-collapse-btn", frontend)
        self.assertIn("dmi-collapsed", frontend)
        self.assertIn("coordinateToTime", frontend)
        self.assertIn("localStorage.setItem(drawingStorageKey", frontend)
        self.assertIn(".dmi-drawing-layer.is-active", style)
        self.assertIn("var CHART_HEIGHT = 330;", frontend)
        self.assertIn("addSeries(LWC.CandlestickSeries", frontend)
        self.assertNotIn("addSeries(LWC.LineSeries", frontend)
        self.assertIn("return point ? point : null;", frontend)
        self.assertIn("open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close)", frontend)
        self.assertIn("priceLineVisible: true", frontend)
        self.assertIn("dmi-chart-section", frontend)
        self.assertIn(".dmi-chart-section { border-top: 1px solid #d8d8d8;", style)
        self.assertIn(".dmi-panel + .dmi-panel { border-left: 1px solid #d8d8d8;", style)
        self.assertIn(".dmi-fund-card:nth-child(3n + 2)", style)
        self.assertIn("border-radius: 0", style)
        self.assertIn(".dmi-chart-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));", style)
        self.assertIn(".dmi-panel { border: none;", style)
        # 2026-08-14 요청: 증시자금 6개 카드를 2열 대신 3열로.
        self.assertIn(".dmi-fund-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));", style)
        self.assertIn(".dmi-spot-quotes {", style)
        self.assertIn(".dmi-spot-card + .dmi-spot-card", style)
        self.assertIn("dmi-spot-table", frontend)
        self.assertIn("dmi-spot-collapse", frontend)
        self.assertIn("dmi-spot-section", frontend)
        self.assertIn("dmi-interval-tabs", frontend)
        self.assertIn("dmi-draw-buttons", frontend)
        self.assertIn("dmi-fund-empty", frontend)
        self.assertIn("dmi-mini-chart-area", frontend)
        self.assertIn(".dmi-ai { border-bottom: 0 !important; }", style)
        self.assertIn(".dmi-mini-chart-guide", style)
        self.assertIn(".dmi-spot-section.dmi-collapsed .dmi-spot-body", style)
        self.assertIn(".dmi-chart-tools .dmi-collapse-btn { display: inline-flex", style)
        self.assertIn(".dmi-spot-section .dmi-chart-tools .dmi-collapse-btn { display: none !important; }", style)
        self.assertIn("dmi-funds-collapse", frontend)
        self.assertIn(".dmi-funds-section.dmi-collapsed .dmi-funds-body", style)
        self.assertIn("▲ ", frontend)
        self.assertNotIn("next >= value ? 'dmi-above' : 'dmi-below'", frontend)
        self.assertIn("border-radius: 4px;", style)
        self.assertIn(".dmi-chart { position: relative; height: 330px;", style)
        self.assertIn(".dmi-chart-grid { grid-template-columns: 1fr; gap: 14px; }", style)
        self.assertIn(".dmi-chart { height: 330px; min-height: 330px;", style)
        self.assertIn(".dmi-subheading h3,", style)
        self.assertNotIn("dmi-funds-provider", frontend)
        self.assertNotIn("dmi-funds-provider", style)
        self.assertNotIn('class="dmi-provider"', frontend)
        self.assertNotIn("분봉 · 일봉 · 주봉", frontend)
        backend = self.read("scripts/cloud-vm/domestic_market_indicators.py")
        self.assertIn("CHART_LOOKBACK_DAYS = 370", backend)
        self.assertIn("CHART_MINUTE_MAX_BARS = 1500", backend)
        enhancements = self.read("js/dashboard-enhancements.js")
        self.assertIn("modalTarget.classList.contains('dmi-chart')", enhancements)
        self.assertIn("#domestic-market-indicators .dmi-chart", enhancements)
        self.assertIn("de-chart-control-row", enhancements)
        self.assertIn("var modalTarget = target && target.id === 'ssChart' ? target.parentElement : target", enhancements)
        self.assertIn("var chartTarget = modalTarget.querySelector ? modalTarget.querySelector('#ssChart') : null", enhancements)
        self.assertIn("stockScope.className = 'de-stock-search-scope'", enhancements)
        self.assertIn("stockRoot.id = 'stock-search-original'", enhancements)
        self.assertIn("if (chartTarget) chartTarget.dispatchEvent(new Event('resize'))", enhancements)
        self.assertIn("dmiPanel.querySelector('.dmi-tabs')", enhancements)
        self.assertIn("futuresSection.querySelector('.kf-interval-toggle')", enhancements)
        self.assertIn("moveDrawingControlsBelowFullscreen", enhancements)
        self.assertIn("className = 'de-draw-controls'", enhancements)
        futures_style = self.read("css/dashboard-enhancements.css")
        futures_script = self.read("js/kospi-futures.js")
        futures_css = self.read("css/kospi-futures.css")
        self.assertIn("border-radius: 4px;", futures_css)
        self.assertIn("#kospi-futures .kf-chart { height: 330px !important; }", futures_style)
        self.assertIn("var CHART_HEIGHT = 330;", futures_script)
        self.assertIn('data-section-key="ai"]', futures_css)
        self.assertIn(".kf-chart-grid", futures_css)
        self.assertIn("grid-template-columns: repeat(2, minmax(0, 1fr));", futures_css)
        self.assertIn("min-width: 68px;", futures_css)
        self.assertIn("function fmtDirection(v, digits)", futures_script)
        self.assertIn("fmtDirection(item.change, 2)", futures_script)
        self.assertIn('data-section-key="option"', futures_script)
        self.assertIn('data-chart-key="option"', futures_script)
        self.assertIn(".de-chart-control-row .de-expand-button.de-expand-inline", futures_style)
        self.assertIn("de-stock-search-scope", futures_style)
        self.assertIn("stockScope.style.flex = '1 1 100%'", enhancements)
        self.assertIn("dmi-draw-toggle", frontend)
        overnight = self.read("js/overnight-market.js")
        self.assertIn('class="om-ai-icon"', overnight)
        self.assertIn('class="kf-ai-icon"', futures_script)
        self.assertIn('class="kf-quote-table"', futures_script)
        self.assertIn('function buildQuoteRow(item, symbol)', futures_script)
        self.assertIn('class="kf-draw-toggle"', futures_script)
        self.assertIn("function setupKfDrawing", futures_script)
        self.assertIn(".kf-drawing-layer.is-active", futures_css)
        self.assertNotIn('💬 참고의견', futures_script)
        # 2026-08-14 요청: 사이트 곳곳의 Groq AI 요약 상자 제목·아이콘을 "참고의견" + 말풍선
        # 아이콘으로 통일(예전엔 "종합 요약"/"요약"/이모지 등으로 제각각이었음).
        self.assertIn('class="dmi-ai-icon"', frontend)
        self.assertIn("'참고의견", frontend)
        market_temp_script = self.read("js/market-temp.js")
        self.assertIn('class="mt-ai-icon"', market_temp_script)
        self.assertIn("참고의견", market_temp_script)
        stock_news = self.read("js/stock-news.js")
        sector_dashboard = self.read("js/sector-dashboard-v4.js")
        self.assertIn('class="sn-ai-badge-icon"', stock_news)
        self.assertIn("참고의견", stock_news)
        self.assertIn('class="sn-ai-badge-icon"', sector_dashboard)
        self.assertIn("참고의견", sector_dashboard)
        self.assertNotIn("개인 · 외국인 · 기관</span>", frontend)

    def test_navigation_accessibility_contract(self):
        source = self.read("js/skin-menu.js")
        for token in ("aria-expanded", "aria-current", "nav-secondary-row", "nav-secondary-separator"):
            self.assertIn(token, source)
        self.assertNotIn("nav-dropdown", source)
        self.assertNotIn("nav-chevron", source)

    def test_home_market_switch_includes_weekend_closed_tab(self):
        source = self.read("js/skin-main.js")
        self.assertNotIn("<span>시장</span><button type=\"button\" data-home-market-switch", source)
        self.assertIn('data-home-market-switch="domestic"', source)
        self.assertIn('data-home-market-switch="us"', source)
        self.assertIn('data-home-market-switch="closed"', source)
        self.assertIn("if (isClosedWindowKst()) return 'closed';", source)
        self.assertIn("market === 'us' || market === 'closed'", source)
        self.assertIn('data-home-closed-page', source)

    def test_home_closed_switch_applies_page_without_waiting_for_market_api(self):
        source = self.read("js/skin-main.js")
        self.assertIn("window.addEventListener('home-market-change', function ()", source)
        self.assertIn("applyHomeMarketSession(homeMarketSession());", source)
        self.assertIn("if (session.closed) return;", source)
        self.assertIn("try {\n          window.HomeMarketSelection.set(market);", source)
        self.assertIn("catch (error) {", source)

    def test_home_widgets_preserve_closed_page_when_rebuilding_registry(self):
        source = self.read("js/home-widgets.js")
        self.assertIn("var closedPage = dashboard.querySelector('.home-closed-page');", source)
        self.assertIn("if (closedPage) dashboard.appendChild(closedPage);", source)
        self.assertIn("home-widgets.js?v=20260825-ws-fallback-v1", self.read("js/skin-main.js"))

    def test_home_closed_state_hides_market_content_without_body_id_dependency(self):
        main = self.read("js/skin-main.js")
        style = self.read("style.css")
        self.assertIn("var overviewGrid = dashboardSection.querySelector('.home-overview-grid');", main)
        self.assertIn("var widgetGrid = dashboardSection.querySelector('.home-widget-grid');", main)
        self.assertIn("if (overviewGrid) overviewGrid.hidden = isClosed;", main)
        self.assertIn("if (widgetGrid) widgetGrid.hidden = isClosed;", main)
        self.assertIn("if (realtimeBoard) realtimeBoard.hidden = isClosed;", main)
        self.assertIn("다음 주 시장을 준비하는 시간입니다.", main)
        self.assertIn(".home-editorial-page.is-market-closed .home-overview-grid", style)
        self.assertIn(".home-editorial-page.is-market-closed .home-widget-grid", style)
        self.assertNotIn("body#tt-body-index .home-editorial-page.is-market-closed", style)

    def test_home_index_charts_use_live_futures_data_with_sample_toggle_retained(self):
        # 2026-08-29: 운영 전환 - 기본은 /futures 실데이터. 레이아웃 작업용 고정 샘플
        # 토글(HOME_USE_SAMPLE_CHARTS)과 기구(HOME_SAMPLE_CHARTS/homeChartRows)는 유지.
        main = self.read("js/skin-main.js")
        self.assertIn("var HOME_USE_SAMPLE_CHARTS = false;", main)
        self.assertIn("var HOME_SAMPLE_CHARTS = {", main)
        self.assertIn("function homeChartRows(rows, key)", main)
        self.assertIn("return HOME_SAMPLE_CHARTS[key].map", main)
        self.assertIn("homeChartRows(rows, key)", main)
        self.assertIn("skin-main.js?v=20260904-us-index-session-v1", self.read("skin.html"))

    def test_global_newspaper_design_system_contract(self):
        style = self.read("style.css")
        skin = self.read("skin.html")

        for token in (
            '--font-title: "MaruBuri"',
            '--font-ui: "Pretendard"',
            '--font-data: "Pretendard"',
            "--page-bg: rgb(255, 254, 252)",
            "--surface: #FFFEFC",
            "--text-main: #171717",
            "--text-sub: #6F7480",
            "--rule: #D8D8D8",
            "--up: #B42318",
            "--down: #245B9E",
            "--neutral: #777777",
            "--accent-dark: #26364A",
            "font-variant-numeric: tabular-nums",
            "box-shadow: none !important",
            "background: transparent !important",
            ".app-news-type",
        ):
            self.assertIn(token, style)

        # The New newspaper system has one fixed UI font and no header toggle.
        self.assertIn("html body,\nhtml body * { font-family: var(--font-ui) !important; }", style)
        self.assertIn("html body .site-footer-version", style)
        self.assertIn("color: #d24f45", style)
        # (2026-08-30: 여기 있던 skin.html의 DOMContentLoaded 리스너 검사는 초기 페인트
        #  가드의 reveal 스크립트를 가리키던 것으로, 가드 제거와 함께 사라져 뺐다.
        #  가드 자체는 test_initial_paint_guard_no_longer_hides_the_page가 고정한다.)
        self.assertIn("<span>NEW</span>", skin)
        self.assertNotIn("fontModeBtn", skin)
        self.assertNotIn("bolt-font", skin)
        self.assertIn("style.css?v=20260830-no-paint-guard-v1", skin)
        self.assertIn("ui-system.css?v=20260827-ui-system-v1", skin)
        self.assertIn(".ui-btn-a", self.read("css/ui-system.css"))
        self.assertIn(".ui-btn-tab", self.read("css/ui-system.css"))
        self.assertIn(".ui-module", self.read("css/ui-system.css"))
        self.assertIn(".home-briefing-featured .post-excerpt", style)
        self.assertIn("min-height: 6.4em", style)
        self.assertIn(".home-briefing-small .post-title", style)
        self.assertIn("border: 1px solid var(--up)", style)
        self.assertIn("border-radius: 999px", style)
        self.assertIn(
            'html:not(.font-gothic) body .om-title {\n  font-family: var(--font-ui) !important;',
            style,
        )
        self.assertIn(".navbar .nav-search-icon { display: inline-flex; order: 2;", style)
        self.assertIn(".navbar .nav-search-input { order: 1; font-size: 13px;", style)
        # 2026-08-30: 모바일 종목검색 입력창은 16px 미만이면 iOS 사파리가 탭 순간 페이지를
        # 자동 확대한다(되돌아가지 않음). 모바일에서 .nav-search-btn이 숨겨져 이 입력창이
        # 유일한 검색 진입점이라 16px 아래로 다시 내려가지 않게 고정한다.
        self.assertIn(".navbar .nav-search-input { font-size: 16px; }", style)
        self.assertIn("skin-main.js?v=20260904-us-index-session-v1", skin)

    def test_crypto_benchmark_lines_share_the_visible_one_year_chart_range(self):
        source = self.read("js/overnight-market.js")
        # /futures 기본값은 90일이지만 BTC/ETH 평균선은 365일·180일로 계산된다.
        # 차트도 365일을 요청해야 52주 평균선이 현재 차트 범위 밖으로 밀리지 않는다.
        self.assertIn("var FUTURES_HISTORY_DAYS = 365;", source)
        self.assertIn("var FUTURES_CACHE_KEY = 'overnight_market_futures_v2_365d';", source)
        self.assertIn("function futuresRequestUrl()", source)
        self.assertIn("'?days=' + FUTURES_HISTORY_DAYS", source)
        self.assertIn("encodeURIComponent(SYMBOL_ORDER.join(','))", source)
        self.assertIn("var BENCHMARK_52W_COLOR = '#c9701f';", source)
        self.assertIn("color: BENCHMARK_52W_COLOR", source)
        self.assertIn("color: BENCHMARK_6M_COLOR", source)

    def test_navbar_search_underline_fits_inside_navbar_height(self):
        # 2026-08-20: .nav-search-input-wrap의 min-height(64px)가 .navbar 자체 높이
        # (56px)보다 커서 검색창 하단 실선이 navbar 밖으로 흘러넘쳐, 바로 아래 있는
        # 상단 메뉴바(.sidebar-left)의 border-top과 겹쳐 두꺼운 검은 줄처럼 보이던
        # 문제를 고정한다(사용자 리포트: "상위 종목검색 하단 검은색 줄이 뒤에
        # 구분선과 겹쳐"). navbar 높이(56px)보다 작아야 한다.
        style = self.read("style.css")
        match = re.search(r"\.navbar \{[^}]*height:\s*(\d+)px", style)
        self.assertIsNotNone(match)
        navbar_height = int(match.group(1))
        search_match = re.search(r"\.navbar \.nav-search-input-wrap \{[^}]*min-height:\s*(\d+)px", style)
        self.assertIsNotNone(search_match)
        self.assertLess(int(search_match.group(1)), navbar_height)

    def test_realtime_industry_table_prioritizes_industry_width(self):
        style = self.read("style.css")
        for token in (
            '.home-realtime-board:has(.hrt-tabs [data-hrt-tab="industry"].active)',
            "min-width: 100%;",
            ".hrt-table-wrap th:nth-child(1) { width: 34%; }",
            ".hrt-table-wrap th:nth-child(6) { width: 14%; }",
        ):
            self.assertIn(token, style)

    def test_global_search_routes_to_realtime_then_analysis(self):
        panel = self.read("js/stock-search-panel.js")
        realtime = self.read("js/stock-search.js")
        self.assertIn("var TARGET_PAGE = '/page/stock-search';", panel)
        self.assertIn("var US_API_BASE = 'https://goodbyestar.cloud';", panel)
        self.assertIn('function fetchUsSearch(query)', panel)
        self.assertIn('class="ss-analysis-link"', realtime)
        self.assertIn('/page/foreign-flow?code=', realtime)
        self.assertIn("US_STOCKS_SCRIPT", realtime)
        self.assertIn("id=\"ssUsModule\"", realtime)
        self.assertIn("function setMarketMode(container, isUs)", realtime)
        self.assertIn("if (results) results.hidden = !!isUs;", realtime)
        self.assertIn("if (detail && isUs) detail.hidden = true;", realtime)
        self.assertIn("target.innerHTML = '<div class=\"ss-hint ss-error\">미국주식 시세 모듈을 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>';", realtime)
        self.assertIn("한국·미국 종목명 또는 코드", realtime)
        for source in (panel, realtime, self.read("js/us-stocks.js")):
            self.assertIn("symbol: 'TSLA'", source)
            self.assertIn("aliases: '테슬라 tesla'", source)
            self.assertIn("symbol: 'SPCX'", source)
            self.assertIn("aliases: '스페이스X spacex'", source)
        self.assertIn("return localRows.concat(rows)", panel)
        self.assertIn("return localRows.concat(rows)", realtime)
        self.assertIn("return localRows.concat(rows)", self.read("js/us-stocks.js"))

    def test_us_stock_page_links_to_congress_disclosures_without_paid_api(self):
        source = self.read("js/us-stocks.js")
        self.assertIn("function renderCongressLinks()", source)
        self.assertIn("https://www.quiverquant.com/congresstrading/stock/", source)
        self.assertIn("https://disclosures-clerk.house.gov/FinancialDisclosure/ViewReport", source)
        self.assertNotIn("/us-congress-trades/", source)
        self.assertNotIn("QUIVER_API_KEY", source)
        self.assertIn("미국 의회 거래 공시", source)
        self.assertIn("거래일과 신고일이 다를 수 있음", source)
        self.assertIn("최대 45일 지연 가능", source)
        self.assertIn("복사매매 신호 아님", source)
        style = self.read("css/us-stocks.css")
        self.assertIn(".us-stocks-congress-links", style)
        self.assertIn(".us-stocks-congress-link", style)
        self.assertIn("@media (max-width: 700px)", style)

    def test_stock_name_renderers_put_shared_logo_before_names(self):
        stock_news = self.read("js/stock-news.js")
        stock_search = self.read("js/stock-search.js")
        pattern = self.read("js/pattern-scan.js")
        strategy = self.read("js/strategy-search.js")
        for source in (stock_news, stock_search, pattern, strategy):
            self.assertIn("STOCK_ICON_BASE", source)
            self.assertIn("data-icon-code", source)
            self.assertIn("window.StockIconFallback", source)
        self.assertIn("sn-wl-name-text", stock_news)
        self.assertIn("stockIconHtml(s.code)", stock_news)
        self.assertIn("stockIconHtml(it.code)", pattern)
        self.assertIn("stockIconHtml(item.code)", strategy)

    def test_domestic_name_search_wins_over_us_ticker_detection(self):
        source = self.read("js/stock-search.js")
        self.assertIn("function resolveDomesticName(query)", source)
        self.assertIn("var domesticMatch = resolveDomesticName(query);", source)
        self.assertIn("if (domesticMatch) {", source)
        self.assertIn("runDomesticSearch(container, domesticMatch.name);", source)

    def test_community_stock_selector_supports_us_search(self):
        source = self.read("js/stock-discussion.js")
        self.assertIn("var US_API_BASE = 'https://goodbyestar.cloud';", source)
        self.assertIn("function findUsSuggestions(value)", source)
        self.assertIn("/us-search?q=", source)
        self.assertIn("'US:' + symbol", source)
        self.assertIn("US:[A-Z]", source)
        self.assertIn("symbol: 'TSLA'", source)
        self.assertIn("symbol: 'LLY'", source)
        self.assertIn("일라이릴리", source)
        for token in ("function localizedUsName", "INTC: '인텔'", "GOOGL: '알파벳 A'", "MSTR: '스트래티지'", "CRWD: '크라우드스트라이크'"):
            self.assertIn(token, source)

    def test_pattern_detail_uses_scan_date_snapshot(self):
        pattern = self.read("js/pattern-scan.js")
        gas = self.read("gas/ticker-proxy.gs")
        self.assertIn("&scanDate=", pattern)
        self.assertIn("snapshotFallback", pattern)
        self.assertIn("evaluationDaily", gas)
        self.assertIn("row.date <= scanDate", gas)
        self.assertIn("lineWidth: 4", pattern)
        self.assertIn("item.patternDetail", pattern)
        self.assertIn("2년 일봉 · 1D", pattern)
        self.assertIn("setVisibleLogicalRange", pattern)
        self.assertIn("Math.min(500, daily.length)", pattern)
        self.assertIn("addMaLine(chart, daily, 240", pattern)

    def test_home_dashboard_contract(self):
        main = self.read("js/skin-main.js")
        widgets = self.read("js/home-widgets.js")
        rank = self.read("js/sidebar-rank.js")
        indices = self.read("js/quick-indices.js")
        for token in ("오늘의 시장판", "home-overview-grid", "home-top-disclosures"):
            self.assertIn(token, main)
        self.assertNotIn("home-card-grid", main)
        self.assertIn("slice(0, 8)", main)
        self.assertIn("마켓브리핑 전체보기", main)
        self.assertIn("home-briefing-left-more", main)
        self.assertIn("selectedCards.slice(4, 8)", main)
        self.assertNotIn("homePatternList", main)
        self.assertNotIn("patternScan=1", main)
        for token in (
            "market-summary",
            "briefing",
            "home_dashboard_layout_v2",
            "dragstart",
            "pointerdown",
            "data-widget-action=\"hide\"",
        ):
            self.assertIn(token, widgets)
        self.assertIn("실시간 랭킹", rank)
        self.assertIn("DEFAULT_SELECTED", indices)
        self.assertNotIn("id=\"qiNews\"", indices)
        self.assertNotIn("loadDisclosures(container);", indices)

    def test_watchlist_reorder_works_on_touch_not_just_mouse_drag(self):
        """2026-08-31: 순서 변경·그룹 이동이 HTML5 드래그앤드롭으로만 돼 있어 터치
        기기에서는 아예 동작하지 않았다(모바일 브라우저는 터치 제스처로 drag 이벤트를
        만들지 않는다). 사용자 리포트: "모바일에서 관심종목간 이동이 불편해".
        동작 검증은 test/watchlist-touch-drag.html이 실제 watchlist.js를 띄워서 한다."""
        js = self.read("js/watchlist.js")
        css = self.read("css/watchlist.css")
        for handler in ("'pointerdown'", "'pointermove'", "'pointerup'", "'pointercancel'"):
            self.assertIn(handler, js, "%s 핸들러가 없으면 터치에서 다시 못 옮긴다" % handler)
        # 마우스는 기존 HTML5 경로가 처리한다 - 한 입력이 두 경로를 타면 안 된다.
        self.assertIn("if (event.pointerType === 'mouse') return;", js)
        # 좌표가 뷰포트 밖이면 elementFromPoint가 null이라 사각형 판정 폴백이 필요하다.
        self.assertIn("function groupItemsAtPoint", js)
        # 손잡이가 보여야 어디를 잡는지 알 수 있고, touch-action:none이라야 스크롤과 안 싸운다.
        self.assertIn("touch-action: none;", css)
        self.assertIn("#watchlist .wl-card.is-touch-dragging", css)
        # 옮길 그룹이 화면 밖이면 손가락을 끌어도 닿을 방법이 없다 - 가장자리 자동 스크롤.
        self.assertIn("function autoScrollStep", js)
        # 빈 그룹은 <p class="wl-group-empty">를 담고 있어 :empty로는 안 잡힌다.
        self.assertIn("#watchlist.is-reordering .wl-group-empty", css)
        self.assertNotIn(".wl-group-items:empty", css)

    def test_floating_scroll_top_button_does_not_cover_mobile_body_text(self):
        """2026-08-31: 떠 있는 "맨 위로" 버튼이 본문 글자를 덮고 있었다(실측 30x24px).
        고정 버튼이 전체폭 본문 위에 있으면 스크롤 위치에 따라 항상 뭔가를 가리므로
        모바일에서는 숨겼다.

        2026-09-04: 당시 대체 수단이던 "현재 탭 재탭 = 맨 위로"는 하단 탭바를 걷어내며
        함께 사라졌다. 그래도 버튼을 되살리지는 않는다 - 되살리면 본문을 가리던 원래
        문제가 그대로 돌아온다. 맨 위로 가는 수단은 본문을 가리지 않는 형태로 따로
        설계한다. 이 테스트가 지키는 것은 "버튼이 모바일 본문을 덮지 않는다" 하나다.
        """
        style = self.read("style.css")
        self.assertIn('.scroll-top-btn { display: none !important; }', style)
        # 기본 규칙은 남겨둔다(이 버튼은 원래부터 모바일 전용 - 기본 display:none,
        # 720px 블록에서만 flex로 켰었다. 721px 이상은 예전에도 안 보였다).
        self.assertIn('.scroll-top-btn {\n  position: fixed;', style)

    def test_interest_band_opacity_is_not_multiplied_by_a_presentation_attribute(self):
        """2026-08-30 FOUC 수정에서 넣은 fill-opacity가 CSS의 rgba 알파와 곱해져
        매수 관심 구간이 불투명도 1%로 사실상 안 보였다(사용자 리포트). CSS는 fill만
        정의하므로 fill-opacity 속성은 살아남는다 - fill 하나로만 최종색을 넣어야 한다."""
        weekly = self.read("js/home-weekly-report.js")
        band_line = [ln for ln in weekly.splitlines()
                     if 'hwr-fx-interest-band' in ln and '<rect' in ln
                     and not ln.strip().startswith('//')]
        self.assertTrue(band_line, "interest band 렌더 코드를 찾지 못했다")
        self.assertNotIn('fill-opacity', band_line[0])
        self.assertIn('fill="rgba(37, 99, 235, 0.1)"', band_line[0])

    def test_usd_range_card_does_not_print_the_dollar_sign_twice(self):
        """formatPrice()가 US 심볼이면 '$'를 앞에 붙이는데 단위를 또 붙여서
        "$4,504.3$"가 나오고 있었다(금 선물 카드 전부)."""
        weekly = self.read("js/home-weekly-report.js")
        self.assertIn("formatPrice(value, symbol) + (isUsd ? '' : '원')", weekly)
        self.assertNotIn("formatPrice(value, symbol) + unit", weekly)

    def test_numbers_never_break_mid_value_on_narrow_screens(self):
        """사용자 요구: 숫자 잘림 허용 안 됨. 좁은 폭에서 "1,411원"이 "1,"/"411원"으로
        쪼개지던 문제 - 값을 .hwr-fx-num으로 감싸 nowrap하고, 모바일에서는 환율·금
        카드를 1열로 내려 폭을 확보한다."""
        weekly = self.read("js/home-weekly-report.js")
        style = self.read("css/home-weekly-report.css")
        self.assertIn('class="hwr-fx-num"', weekly)
        self.assertIn('.hwr-fx-num { white-space: nowrap;', style)
        self.assertIn('.hwr-summary-row.hwr-asset-row { grid-template-columns: minmax(0, 1fr); }', style)

    def test_weekly_stock_sections_fit_four_items_per_market_row(self):
        script = self.read("js/home-weekly-report.js")
        style = self.read("css/home-weekly-report.css")
        self.assertIn('hwr-stock-list hwr-stock-list--four', script)
        self.assertIn("items.slice(0, 4)", script)
        self.assertIn(".hwr-stock-list--four { display: grid; grid-template-columns: repeat(4", style)
        self.assertIn(".hwr-stock-list--four { grid-template-columns: repeat(2", style)
        self.assertIn("home-weekly-report.css?v=20260831-mobile-legibility-v1", script)
        self.assertIn("home-weekly-report.js?v=20260831-mobile-legibility-v1", self.read("js/skin-main.js"))
        self.assertIn("var closedSelected = window.HomeMarketSelection", script)
        self.assertIn("&& !closedSelected", script)

    def test_market_briefing_share_button_is_visible_in_every_card_layout(self):
        skin = self.read("skin.html")
        style = self.read("style.css")
        self.assertIn('class="btn-share" type="button" onclick="sharePost(this)"', skin)
        for hidden_rule in (
            ".home-briefing-featured .btn-share { display: none; }",
            ".home-briefing-small .btn-share { display: none; }",
            ".post-card.feed-cards-item .btn-share { display: none; }",
            ".post-card.feed-duo-item .btn-share { display: none; }",
        ):
            self.assertNotIn(hidden_rule, style)
        self.assertIn(".post-card.feed-headline-item .post-footer {", style)
        self.assertIn(".post-card.feed-headline-item .btn-share { padding: 4px 9px; font-size: 10.5px; }", style)
        self.assertIn(".post-card.feed-headline-item .btn-read { display: none; }", style)

    def test_discontinued_market_ribbon_is_fully_removed(self):
        """2026-08-21 코드 감사: 폐기된 리본을 display:none !important로만 숨겨두면서
        css/market-ribbon.css·js/market-ribbon.js를 매 페이지 계속 다운로드하고 있었다
        (이미 숨겨진 걸 또 숨기는 인라인 <style>도 중복) - 아예 걷어냈다. 오프셋은
        style.css가 이미 리본 없는 값으로 고정돼 있어(2026-07-16) 영향 없음."""
        skin = self.read("skin.html")
        self.assertNotIn("market-ribbon", skin)
        import os
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.assertFalse(os.path.exists(os.path.join(repo_root, "css", "market-ribbon.css")))
        self.assertFalse(os.path.exists(os.path.join(repo_root, "js", "market-ribbon.js")))

    def test_home_domestic_summary_includes_foreign_investor_trend(self):
        main = self.read("js/skin-main.js")
        style = self.read("style.css")
        for token in (
            "data-home-investor-trend",
            "investor-trend?period=day&market=kospi",
            "investor-trend?period=day&market=kosdaq",
            "외국인 순매수 추이",
            "function investorSparkline",
        ):
            self.assertIn(token, main)
        for token in (".hmb-investor-trend", ".hmb-investor-spark", ".hmb-investor-zero"):
            self.assertIn(token, style)

    def test_home_market_switch_refreshes_index_cards_with_selected_market(self):
        main = self.read("js/skin-main.js")
        self.assertIn("loadHomeIndices();\n      loadSummaryForSession(homeMarketSession());", main)
        self.assertIn("applyHomeMarketSession(session);", main)
        self.assertIn("keys: ['KOSPI', 'KOSDAQ']", main)
        self.assertIn("keys: ['NASDAQ_INDEX', 'SP500_INDEX']", main)

    def test_us_home_cards_use_spot_index_products_explicitly(self):
        main = self.read("js/skin-main.js")
        indices = self.read("js/quick-indices.js")
        self.assertIn("keys: ['NASDAQ_INDEX', 'SP500_INDEX']", main)
        self.assertIn("labels: ['나스닥', 'S&P500']", main)
        self.assertIn("미국 현물 · 본장 개장 전", main)
        self.assertNotIn("live: '나스닥100 선물 · S&P500 선물'", main)
        self.assertIn("label: '나스닥100 선물'", indices)

        self.assertIn(".concat(['NASDAQ_INDEX', 'SP500_INDEX'])", indices)
        self.assertIn("quick_indices_futures_v2", indices)

    def test_home_realtime_table_fills_missing_stock_icons(self):
        source = self.read("js/home-realtime-table.js")
        main = self.read("js/skin-main.js")
        for token in (
            "NAVER_ICON_BASE = 'https://ssl.pstatic.net/imgstock/fn/real/logo/stock/Stock'",
            "ICONIFY_BASE = 'https://api.iconify.design/'",
            "FAVICON_BASE = 'https://icons.duckduckgo.com/ip3/'",
            "SPCX: ['simple-icons', 'spacex']",
            "SNDK: ['thesvg-color', 'sandisk']",
            "MRVL: 'marvell.com'",
            "STOCK_ICON_BASE + encodeURIComponent(code)",
            "data-icon-stage=\"local\"",
            "data-icon-naver-code",
            "window.HomeRealtimeTableIconFallback(this)",
            "image.style.display = 'none'",
        ):
            self.assertIn(token, source)
        self.assertIn("LIMIT = 40", source)
        self.assertIn("HOME_ROW_LIMIT = 20", source)
        self.assertIn("rowsForActive().slice(0, HOME_ROW_LIMIT)", source)
        self.assertNotIn("전체 순위 보기 →", source)
        self.assertIn("object-fit: contain", self.read("style.css"))
        self.assertIn("home-realtime-table.js?v=20260830-idle-wics-v1", main)
        for token in (
            "function localizedUsName(item)",
            "name_ko || item.display_name",
            "US_DISPLAY_NAMES",
            "state.pendingMarket = currentMarket()",
            "if (currentMarket() !== market) return;",
        ):
            self.assertIn(token, source)

    def test_home_realtime_table_can_include_or_exclude_etfs(self):
        source = self.read("js/home-realtime-table.js")
        style = self.read("style.css")
        for token in (
            "ETF_FILTER_KEY = 'home_hrt_etf_v1'",
            "data-hrt-etf-toggle",
            "ETF 제외",
            "ETF 포함",
            "function isEtf(item)",
            "function visibleRows(rows)",
            "state.includeEtf || !isEtf(item)",
            "state.realtimeCodes",
            "saveEtfPreference();",
        ):
            self.assertIn(token, source)
        for token in (
            ".hrt-etf-toggle",
            ".hrt-etf-toggle[aria-pressed=\"true\"]",
        ):
            self.assertIn(token, style)

    def test_mobile_home_realtime_table_stays_readable_and_header_scrolls_with_body(self):
        source = self.read("js/home-realtime-table.js")
        style = self.read("style.css")
        for token in (
            "data-hrt-active",
            "data-field=\"' + escapeHtml(column[0]) + '\"",
            "state.mount.setAttribute('data-hrt-active', state.active)",
        ):
            self.assertIn(token, source)
        for token in (
            ".navbar {\n    position: relative !important;",
            ".page-wrap {\n    padding-top: 0 !important;",
            ".home-realtime-board .hrt-table-wrap table {",
            "min-width: 0;",
            ".home-realtime-board[data-hrt-active=\"tradeAmount\"]",
            ".home-realtime-board[data-hrt-active=\"industry\"]",
            "2026-08-25 모바일 메인화면 최종 보정",
            "grid-template-columns: minmax(0, 1fr) auto;",
            "padding: 8px 4px !important;",
        ):
            self.assertIn(token, style)

    def test_home_realtime_table_uses_correct_won_trillion_unit(self):
        source = self.read("js/home-realtime-table.js")
        self.assertIn("1조 = 1,000,000,000,000원(10^12)", source)
        self.assertIn("parsed >= 1000000000000", source)
        self.assertIn("parsed / 1000000000000", source)
        self.assertNotIn("parsed / 100000000000).toFixed", source)

    def test_home_realtime_table_reconnects_after_websocket_disconnect(self):
        source = self.read("js/home-realtime-table.js")
        main = self.read("scripts/cloud-vm/main.py")
        self.assertIn("미국시장 · 정규장 22:30~05:00", source)
        self.assertIn("미국시장 · 정규장 23:30~06:00", source)
        self.assertIn("미국시장 · 정규장 ' + hours", self.read("scripts/cloud-vm/market_board.py"))
        self.assertIn("America/New_York", source)
        self.assertIn("function isUsRegularSessionOpen()", source)
        self.assertIn("function isMarketLive(market)", source)
        self.assertIn("최근 장마감 · ", source)
        self.assertIn("국내시장 · 오전 08:00~오후 08:00", source)
        for token in (
            "['amount', '거래대금']",
            "['cap', '시가총액']",
            "['volumeGrowth', '거래증가율']",
            "['turnover', '거래회전율']",
            "['amountTurnover', '거래대금회전율']",
            "국내시장 휴장 또는 해당 순위 데이터가 없습니다.",
            "['industry', '업종 TOP']",
            "평균등락률 → 상승비율 → 거래대금 순",
            "function industryRowHtml(item, rank)",
        ):
            self.assertIn(token, source)
        self.assertLess(source.index("['amount', '거래대금']"), source.index("['cap', '시가총액']"))
        self.assertIn("item.marketCap != null ? item.marketCap : item.market_cap_eok", source)
        for token in (
            "def _industry_top(rows):",
            "'avg_change_rate'",
            "'rise_ratio'",
            "load_wics_map()",
        ):
            self.assertIn(token, self.read("scripts/cloud-vm/market_board.py"))
        for token in (
            "reconnectTimer",
            "WS_RECONNECT_MIN_MS = 1500",
            "WS_RECONNECT_MAX_MS = 30000",
            "function scheduleRealtimeReconnect(generation)",
            "function connectRealtime(generation)",
            "socket.onerror",
            "socket.onopen",
            "visibilitychange",
            "data-hrt-connection",
            "재연결 중",
        ):
            self.assertIn(token, source)
        for token in (
            "RANK_REFRESH_DEBOUNCE_MS = 5000",
            "function scheduleRankRefresh()",
            "scheduleRankRefresh();",
            "fetchBoard(true)",
            "&fresh=1",
        ):
            self.assertIn(token, source)
        for token in (
            "_MARKET_BOARD_LIVE_TTL = 5",
            "fresh: bool = Query(False)",
            "cache_ttl = _MARKET_BOARD_LIVE_TTL if fresh else _MARKET_BOARD_TTL",
        ):
            self.assertIn(token, main)

    def test_home_switches_summary_to_us_market_and_supports_schedule_drag(self):
        main = self.read("js/skin-main.js")
        widgets = self.read("js/home-widgets.js")
        style = self.read("style.css")
        for token in (
            "data-home-summary-field=\"title\"",
            "미국 시장 요약",
            "상승 종목 비율",
            "window.HomeMarketBoard.fetch('us')",
            "market-board?market=us&limit=40",
            "function summarizeUsMarket(data, indexItems)",
            "상대적으로 덜 하락한 상위 업종을 주도 업종으로 표시",
            "renderUsMarketSummary",
            "element.title = fullText",
            "element.setAttribute('aria-label', fullText)",
        ):
            self.assertIn(token, main)
        for token in (
            "items: todayItems,",
            "function enableScheduleDrag(list)",
            "function disclosureHref(item)",
            "data-disclosure-modal",
            "title=\"DART 원문 보기\"",
            "function scheduleSymbol(item)",
            "function scheduleIconHtml(item)",
            "STOCK_ICON_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/img/stock-icons/'",
            "home-us-schedule-icon",
            "HomeUsScheduleIconFallback",
            "list.scrollLeft = startScroll - delta",
            "draggable=\"false\"",
            "list.addEventListener('dragstart'",
            "data-drag-ready",
        ):
            self.assertIn(token, widgets)
        self.assertGreaterEqual(widgets.count("startDisclosureTicker("), 2)
        self.assertIn("home-scoreboard-list", widgets)
        self.assertIn("home-scoreboard-flip", style)
        self.assertIn("overflow-x: auto", style)
        self.assertIn("flex-direction: row", style)
        self.assertIn("scrollbar-color: transparent transparent", style)
        self.assertIn("home-top-disclosures .home-disclosure-list::-webkit-scrollbar", style)
        self.assertIn("touch-action: pan-x", style)
        self.assertIn("-webkit-overflow-scrolling: touch", style)
        self.assertIn("list.addEventListener('touchstart'", widgets)
        self.assertIn("list.addEventListener('touchmove'", widgets)
        self.assertIn("list.addEventListener('touchend'", widgets)
        self.assertIn("-webkit-user-drag: none", style)
        self.assertIn(".home-us-schedule-icon", style)

    def test_home_economic_news_keeps_time_visible_on_mobile(self):
        news = self.read("js/home-economic-news.js")
        main = self.read("js/skin-main.js")
        vm = self.read("scripts/cloud-vm/main.py")
        style = self.read("style.css")
        self.assertIn('class="app-news-event hen-row', news)
        self.assertIn('function dateLabel(value)', news)
        self.assertIn('app-news-timeline', news)
        self.assertIn("function periodKey(value)", news)
        self.assertIn("limit=50", news)
        self.assertIn("slice(0, 10)", news)
        self.assertIn("24 * 60 * 60 * 1000", news)
        self.assertIn("hen-period", news)
        self.assertNotIn("hen-featured", news)
        self.assertNotIn("home-news-more", news)
        self.assertIn("is-latest", news)
        self.assertNotIn("hen-zigzag", news)
        self.assertIn(".app-news-event", style)
        self.assertIn(".app-news-date", style)
        self.assertIn("home-economic-news.js?v=20260828-free-translation-fallback-v3", main)
        self.assertIn(".hen-breaking { flex: 0 0 auto", style)
        self.assertIn(".home-economic-news .hen-breaking-list { height: 62px", style)
        self.assertNotIn("data-hen-breaking-form", main)
        self.assertNotIn("ECONOMIC_FLASH_API_URL", news)
        self.assertIn("syncEconomicHeight", self.read("js/home-widgets.js"))
        self.assertIn("Math.abs(marketRect.top - economicRect.top) > 2", self.read("js/home-widgets.js"))
        self.assertIn(".home-widget--summary.home-economic-news { align-self: start; }", style)
        self.assertIn(".home-economic-news .hen-periods { min-height: 0; height: auto;", style)
        self.assertIn(".home-economic-news .hen-list { min-height: 0; flex: 1 1 0; display: flex; flex-direction: column; overflow-y: auto;", style)
        self.assertIn("hen-breaking-scoreboard", style)
        self.assertIn('data-hen-breaking-list', main)
        self.assertIn('data-hen-breaking aria-label="중요 경제 속보" hidden', main)
        self.assertIn('list.innerHTML = \'\';', news)
        self.assertIn('if (breaking) breaking.hidden = true;', news)
        self.assertIn('if (breaking) breaking.hidden = false;', news)
        self.assertIn('.home-editorial-page .hen-breaking[hidden]', style)
        self.assertIn('function renderFlash(items)', news)
        self.assertIn("flashTimer", news)
        self.assertIn("function startFlashTicker()", news)
        self.assertIn("setInterval(function ()", news)
        self.assertIn('isWatchlistDisclosure(item)', news)
        self.assertIn(".hen-periods", style)
        self.assertIn("max-height: 340px", style)
        self.assertNotIn(".hen-periods { display: grid", style)
        self.assertIn(".hen-period-list", style)
        self.assertIn("overflow-y: auto", style)
        self.assertIn("scrollbar-width: none", style)
        self.assertIn(".hen-periods::-webkit-scrollbar", style)
        self.assertIn(".home-economic-news .hen-row .hen-time", style)
        self.assertIn(".hen-rail::before", style)
        self.assertIn("mobile flow safety", style)
        self.assertIn(".home-widget--summary.home-economic-news {\n  height: auto !important;", style)
        self.assertIn(".home-economic-news .hen-list {\n  flex: none !important;", style)
        self.assertIn(".home-economic-news .hen-periods {\n  display: block !important;", style)
        self.assertIn("scrollbar-width: none !important", style)
        self.assertIn("align-items: stretch !important", style)
        self.assertIn("height: 360px !important", style)
        self.assertIn("[data-home-night-futures]", style)
        self.assertIn("home density follow-up", style)
        self.assertIn(".home-index-strip {\n  margin-top: 10px !important;", style)
        self.assertIn(".home-economic-news .hen-list {\n  height: 450px !important;", style)
        self.assertIn("height: 350px !important", style)
        self.assertIn(".home-widget--full.home-briefing-section {\n    grid-column: 1 / -1;", style)
        self.assertIn(".home-widget--full.home-briefing-section .home-briefing-grid {\n    width: 100%;", style)
        self.assertIn("var ECONOMIC_NEWS_WS_URL = 'wss://goodbyestar.cloud/ws/economic-news';", news)
        self.assertIn("function connectNewsSocket()", news)
        self.assertIn("function applyNewsPayload(payload)", news)
        self.assertIn("@app.websocket('/ws/economic-news')", vm)
        self.assertIn("async def _economic_news_broadcast_loop():", vm)
        self.assertIn("asyncio.to_thread(_fetch_economic_news_snapshot, market)", vm)
        self.assertIn("_DOMESTIC_DART_LIMIT = 30", vm)
        self.assertIn("domestic_news.get_disclosures(limit=_DOMESTIC_DART_LIMIT)", vm)
        self.assertNotIn("domestic_news.get_disclosures(limit=100)", vm)
        self.assertIn("_FLASH_MACRO_RULES", vm)
        self.assertIn("transform: translateX(-50%)", style)
        self.assertIn("display: block !important", style)
        self.assertIn("visibility: visible !important", style)
        self.assertIn('.hmb-list dd[title] { cursor: help; }', style)

    def test_home_economic_news_follows_selected_market(self):
        news = self.read("js/home-economic-news.js")
        vm = self.read("scripts/cloud-vm/main.py")
        self.assertIn("var DOMESTIC_API_URL =", news)
        self.assertIn("var DOMESTIC_MARKET_API_URL =", news)
        self.assertIn("global.HomeMarketSelection.get()", news)
        self.assertIn("if (market !== currentMarket()) return false;", news)
        self.assertIn("var newsUrl = market === 'us' ? US_API_URL : DOMESTIC_API_URL;", news)
        self.assertIn("var marketUrl = market === 'us' ? US_MARKET_API_URL : DOMESTIC_MARKET_API_URL;", news)
        self.assertIn("item.title_ko || item.title", news)
        self.assertIn("# WebSocket의 기본 시장은 시간대 기준이다.", vm)
        self.assertIn("def _economic_news_market():", vm)
        self.assertIn("minutes >= 17 * 60 or minutes < 9 * 60", vm)

    def test_home_economic_news_has_keyless_browser_translation_fallback(self):
        news = self.read("js/home-economic-news.js")
        for token in (
            "CLIENT_TRANSLATION_URL = 'https://api.mymemory.translated.net/get'",
            "CLIENT_TRANSLATION_CACHE_KEY = 'hen_translation_cache_v1'",
            "function translateMissingTitles(items)",
            "function ensureClientTranslations(market)",
            "validKoreanTranslation(title, item.title_ko)",
            "localStorage.setItem(CLIENT_TRANSLATION_CACHE_KEY",
            "&langpair=en%7Cko",
        ):
            self.assertIn(token, news)

    def test_home_auto_switches_to_us_at_premarket_start(self):
        main = self.read("js/skin-main.js")
        board = self.read("js/home-realtime-table.js")
        news = self.read("js/home-economic-news.js")
        self.assertIn("minutes >= 17 * 60 || minutes < 9 * 60", main)
        self.assertIn("hour >= 17 || hour < 9 ? 'us' : 'domestic'", board)
        self.assertIn("hour >= 17 || hour < 9 ? 'us' : 'domestic'", news)

    def test_visible_provider_labels_are_removed_from_content_pages(self):
        sources = (
            self.read("js/domestic-market-indicators.js"),
            self.read("js/home-economic-news.js"),
            self.read("js/home-realtime-table.js"),
            self.read("js/stock-news.js"),
            self.read("js/stock-search.js"),
            self.read("js/us-stocks.js"),
            self.read("js/ticker-tooltip-v5.js"),
        )
        combined = "\n".join(sources)
        for token in (
            "출처:", "자료: 네이버 금융", "data-hrt-source", "data-us-source",
            "sn-news-press", "us-stocks-news-source", "네이버 뉴스에서 원문 보기",
            "네이버 금융에서 보기", "키움 10호가",
        ):
            self.assertNotIn(token, combined)
        terms = self.read("legal/terms.html")
        for provider in (
            "키움증권", "한국투자증권(KIS)", "Finnhub", "Alpha Vantage", "Yahoo Finance", "DART",
            "NAVER API HUB", "네이버 모바일 증권 뉴스", "Google News RSS", "뉴스 출처 및 원문 권리",
        ):
            self.assertIn(provider, terms)

    def test_open_source_license_matches_the_gothic_font(self):
        # 2026-08-20: 고딕 모드 폰트를 나눔고딕에서 프리텐다드로 교체 - 라이선스 표기도 같이 바꼈다.
        license_page = self.read("legal/opensource-license.html")
        self.assertIn("프리텐다드 (Pretendard)", license_page)
        self.assertIn("github.com/orioncactus/pretendard", license_page)
        self.assertNotIn("나눔고딕", license_page)
        self.assertNotIn("NanumGothic", license_page)

    def test_mobile_navigation_is_the_top_menu_not_a_bottom_tab_bar(self):
        """2026-09-04: 모바일 하단 탭바를 걷어내고 상단 2단 메뉴로 되돌렸다.

        2026-09-03에는 중복(상단 38px + 하단 65px)을 줄이려고 상단을 감췄는데, 사용자
        판단은 "모바일인데 메뉴가 사라졌다"였다. 이 사이트는 1차 7개·2차까지 12개
        목적지라 5칸 탭바에 안 들어가고, 못 담은 항목이 더보기 시트로 밀려 길찾기가
        오히려 어려워졌다. 탭바가 되살아나면 같은 문제가 재발하므로 여기서 막는다.
        """
        menu = self.read("js/skin-menu.js")
        style = self.read("style.css")

        # 하단 탭바의 흔적이 남아 있으면 안 된다 - CSS만 지우고 DOM 주입이 남거나
        # 그 반대면 빈 바가 뜨거나 죽은 규칙이 쌓인다.
        for token in ("mobileAppBottomNav", "mobileAppSheet", "mobileBottomActiveKey",
                      "mobileBottomIcon", "data-bottom-action"):
            self.assertNotIn(token, menu)
        for token in (".mobile-app-bottom-nav", ".mobile-app-bottom-item", ".mobile-app-sheet"):
            self.assertNotIn(token, style)
        # 탭바 높이만큼 띄워두던 보정도 함께 빠져야 한다(안 빼면 아래가 휑하게 남는다).
        self.assertNotIn("calc(78px + env(safe-area-inset-bottom))", style)
        self.assertNotIn("calc(78px + env(safe-area-inset-bottom) + 10px)",
                         self.read("css/stock-search-panel.css"))

        # 모바일에서 상단 메뉴가 다시 보여야 한다.
        self.assertIn(":root { --topbar-height: 40px; }", style)
        self.assertIn("html.nav-secondary-open { --topbar-height: 76px; }", style)
        self.assertIn(".sidebar-left { display: flex !important; }", style)
        self.assertIn("body { word-break: keep-all; overflow-wrap: normal; }", style)

        # 상단 메뉴가 모든 목적지를 담는지 - 탭바를 없앤 전제다.
        for token in ("/page/foreign-flow", "/page/pattern-scan", "/page/strategy-search",
                      "/page/stock-calendar", "/pages/overnight-market", "/pages/kospi-futures",
                      "/page/market-temp", "/page/watchlist", "/guestbook"):
            self.assertIn(token, menu)

    def test_mobile_logo_is_not_clipped_by_the_narrow_breakpoint(self):
        # 2026-09-04 Chromium 360px 실측: .nav-logo max-width가 34vw(=122px)라
        # 브랜드 표기 "ㄱㅖ조 ㅏ심폐소생술"이 "ㄱㅖ조 ㅏ심폐소…"로 잘렸다. 34vw는 로고와
        # 검색창이 한 줄을 나눠 쓰던 시절 값인데, 2026-08-20에 navbar가 두 줄로 갈라지며
        # 로고가 검색창과 경쟁하지 않게 됐다.
        style = self.read("style.css")
        self.assertNotIn(".navbar .nav-logo { max-width: 34vw; }", style)
        self.assertIn(".navbar .nav-logo { max-width: calc(100% - 44px); }", style)

    def test_home_market_direction_uses_fast_temperature_breadth_strength(self):
        source = self.read("js/skin-main.js")
        for token in (
            "resolveMarketDirection",
            "label: '급락'",
            "label: '강한 약세'",
            "label: '상승 우위'",
            "riseRatio <= 0.15",
            "averageRate <= -1",
        ):
            self.assertIn(token, source)
        self.assertNotIn("?market=1", source)

    def test_home_us_market_direction_respects_both_index_changes(self):
        source = self.read("js/skin-main.js")
        for token in (
            "function resolveMarketDirection(marketTemp, indexRates)",
            "var indexDown = validIndexRates.every",
            "return { label: '약세 우위', tone: 'home-negative' }",
            "direction: usSession.open ? resolveMarketDirection({ components:",
            "latestHomeIndices = items || [];",
        ):
            self.assertIn(token, source)

    def test_home_us_market_does_not_call_stale_close_a_live_direction_before_open(self):
        source = self.read("js/skin-main.js")
        for token in (
            "function usRegularSessionState(now)",
            "label: '본장 개장 전'",
            "subtitle: '미국 현물 · 본장 개장 전'",
            "var sessionOpen = !summary.sessionState || summary.sessionState.open;",
            "direction: usSession.open ? resolveMarketDirection",
            "if (labels[0]) labels[0].textContent = isUs && usSession && !usSession.open ? '시장 상태'",
        ):
            self.assertIn(token, source)

    def test_home_disclosure_strip_after_widget_cleanup(self):
        main = self.read("js/skin-main.js")
        style = self.read("style.css")
        self.assertNotIn("}).slice(0, 4);", main)
        self.assertNotIn("home-pattern-stock-list", main)
        self.assertIn("home-top-disclosures", main)
        self.assertNotIn("home-schedule-card", main)
        self.assertIn("grid-column: 1 / -1", style)
        self.assertIn("home-top-disclosures .home-disclosure-list", style)
        self.assertIn("text-overflow: ellipsis", style)
        self.assertIn("white-space: nowrap", style)

    def test_home_disclosure_separator_stays_inside_each_row(self):
        style = self.read("style.css")
        self.assertIn(".home-disclosure-row:not(:last-child)::after", style)
        self.assertIn("top: 9px;", style)
        self.assertIn("bottom: 9px;", style)
        self.assertIn("border: 0 !important;", style)

    def test_home_disclosure_rail_has_no_duplicate_bottom_rule(self):
        style = self.read("style.css")
        self.assertIn(
            "/* 2026-08-18 home disclosure cleanup: the weekly disclosure rail should flow\n"
            "   into the index strip without a duplicate bottom rule. */\n"
            "body#tt-body-index .home-editorial-page .home-top-disclosures {\n"
            "  border-bottom: 0 !important;\n"
            "}",
            style,
        )

    def test_home_news_rows_match_breaking_news_base_height(self):
        style = self.read("style.css")
        self.assertIn(
            "body#tt-body-index .home-editorial-page .home-economic-news .hen-list .app-news-event {\n"
            "  padding-top: 8px !important;\n"
            "  padding-bottom: 8px !important;\n"
            "}",
            style,
        )
        self.assertIn(
            "body#tt-body-index .home-editorial-page .home-economic-news .hen-list .app-news-rail {\n"
            "  min-height: 42px !important;\n"
            "}",
            style,
        )

    def test_watchlist_search_supports_keyboard_selection(self):
        source = self.read("js/watchlist.js")
        style = self.read("css/watchlist.css")
        for token in (
            'role="combobox"',
            'role="listbox"',
            'role="option"',
            "aria-activedescendant",
            "e.key === 'ArrowDown'",
            "e.key === 'ArrowUp'",
            "getActiveSuggestion",
            "setActiveSuggestion",
            "scrollIntoView({ block: 'nearest' })",
        ):
            self.assertIn(token, source)
        self.assertIn(".wl-suggest-item.active", style)

    def test_watchlist_is_global_right_drawer_with_groups_drag_and_realtime_row_links(self):
        source = self.read("js/watchlist.js")
        bootstrap = self.read("js/stock-search-panel.js")
        style = self.read("css/watchlist.css")
        for token in (
            "wl_groups_v1",
            "+ 그룹 만들기",
            "wl-group-toggle",
            "location.href = STOCK_SEARCH_PAGE_URL",
            'draggable="true"',
            "persistDraggedOrder",
            "getDragBeforeElement",
        ):
            self.assertIn(token, source)
        for token in ("global-watchlist-drawer", "bootGlobalWatchlist", "WATCHLIST_OPEN_KEY"):
            self.assertIn(token, bootstrap)
        self.assertNotIn("차트 보기", source)
        self.assertNotIn("wl-group-select", source)
        self.assertLess(source.find('data-field="change"'), source.find('data-field="price"'))
        self.assertIn("position: fixed", style)
        self.assertIn("right: 0", style)
        self.assertIn("transform: translateX(100%)", style)
        self.assertIn("width: min(330px, calc(100vw - 32px))", style)
        self.assertIn("자동 닫지 않는다", bootstrap)
        self.assertNotIn("setWatchlistDrawerOpen(drawer, false);", bootstrap)
        self.assertIn(".wl-card.is-dragging", style)
        self.assertIn("display: flex", style)
        self.assertIn("gap: 10px; min-height: 42px", style)
        self.assertIn("padding: 4px 2px 4px 6px", style)
        self.assertIn('grid-template-areas: "handle name quote remove"', style)
        self.assertIn("@media (max-width: 640px)", style)

    def test_my_page_reuses_watchlist_and_stores_only_holding_metadata(self):
        menu = self.read("js/skin-menu.js")
        main = self.read("js/skin-main.js")
        watchlist = self.read("js/watchlist.js")
        bootstrap = self.read("js/stock-search-panel.js")
        my = self.read("js/my-dashboard.js")
        my_style = self.read("css/my-dashboard.css")
        # 2026-09-04: 하단 탭바를 걷어내 MY 진입점은 상단 메뉴 하나로 모였다.
        for token in ("/page/watchlist", "label: 'MY'"):
            self.assertIn(token, menu)
        for token in ("loadMyDashboard", "my-dashboard.js", "my-dashboard.css"):
            self.assertIn(token, main)
        for token in ("updateHolding", "setGroupCollapsed", "holding", "quantity", "averagePrice", "horizon"):
            self.assertIn(token, watchlist)
        for token in ("localizedUsName", "name: '인텔'", "name: '스트래티지'", "name: '크라우드스트라이크'", "name: '씨게이트 테크놀로지'"):
            self.assertIn(token, watchlist)
        self.assertIn("/page/watchlist", bootstrap)
        for token in ("flowAiSummary", "MY_VOLUME_LOOKBACK_DAYS", "MY_VOLUME_BIN_COUNT", "buildDailyVolumeProfile", "buildMyFlowMiniChart", "myStockInput", "myStockOptions", "data-my-calc=\"budget\"", "data-my-group-toggle", "groupedWatchlist", "my-volume-chart", "차트 모양 분석", "5일 변화", "20일 변화", "60일 변화", "112일 변화", "224일 변화", "data-my-watchlist-add", "data-my-watchlist-modal", "data-my-watchlist-add-confirm", "addFromWatchlistModal", "물타기 계산기", "my-position-advice", "data-my-calc-recovery", "chartNote", "arrangeAnalysisSections", "modestProfit", "보유 · 추세 확인", "매수 당일이나 초기 수익만으로 분할 익절", "단타 · 5·20일선", "중장기 · 60·224일선", "watchlistCollapsed", "data-my-watchlist-show", "updateWatchlistVisibility", "function localizedUsName", "US_NAME_ALIASES", "INTC: '인텔'", "MSTR: '스트래티지'", "CRWD: '크라우드스트라이크'", "STX: '씨게이트 테크놀로지'"):
            self.assertIn(token, my)
        self.assertNotIn("Google 계정에 저장", my)
        self.assertNotIn("Groq ·", my)
        for token in ("#my-dashboard", ".my-analysis-grid", ".my-watchlist-group-toggle", ".my-watchlist-wrap", ".my-watchlist-show", ".my-watchlist-add", ".my-watchlist-modal", ".my-flow-chart", ".my-flow-svg", "#my-dashboard .is-up { color: #d24f45; }"):
            self.assertIn(token, my_style)
        self.assertIn("grid-template-columns: repeat(5, minmax(0, 1fr));", my_style)

    def test_my_watchlist_groups_use_compact_multi_column_layout(self):
        style = self.read("css/my-dashboard.css")
        self.assertIn("#my-dashboard .my-watchlist-groups", style)
        self.assertIn("grid-template-columns: repeat(2, minmax(0, 1fr));", style)
        self.assertIn("align-items: start;", style)
        self.assertIn("max-height: 560px;", style)
        self.assertNotIn("@media (min-width: 1200px) {\n  #my-dashboard .my-watchlist-groups { grid-template-columns: repeat(3", style)
        self.assertIn("@media (max-width: 720px)", style)
        self.assertIn("grid-template-columns: 1fr;", style)
        self.assertIn("#my-dashboard .my-watchlist-table { min-width: 0; }", style)

    def test_watchlist_refreshes_us_quotes_without_reopening_drawer(self):
        source = self.read("js/watchlist.js")
        bootstrap = self.read("js/stock-search-panel.js")
        self.assertIn("watchlist.js?v=20260831-touch-reorder-v1", bootstrap)
        for token in (
            "var domesticCodes = codes.filter",
            "var canUseSocket = codes.length",
            "var REALTIME_FALLBACK_MS = 60000;",
            "var REALTIME_DOMESTIC_FALLBACK_MS = 10000;",
            "var encodedCodes = codes.map(encodeURIComponent).join(',');",
            "NXT 장 전환",
            "if (usCodes.length) refreshQuotesOnce(container, usCodes);",
            "var realtimeKickoffTimer = null;",
            "function scheduleRealtimeKickoff(container, codes, generation)",
            "function isDomesticSessionTime(now)",
            "realtimeDomesticFallbackTimer = setInterval",
            "[8, 0], [9, 0], [15, 30], [17, 0], [22, 30]",
            "var QUOTES_CACHE_KEY = 'watchlist_quotes_v2';",
            "function readQuoteCache(codes)",
            "var remoteDataPromise = fetchRemoteWatchlistState()",
            "API_BASE_URL + '/us-quotes?symbols='",
            "function publishQuote(code, quote)",
            "watchlist:quote",
            "getCachedQuotes: function (codes)",
        ):
            self.assertIn(token, source)
        my = self.read("js/my-dashboard.js")
        self.assertIn("function applyWatchlistQuote(code, quote)", my)
        self.assertIn("function updateSelectedQuote(code)", my)
        self.assertIn("data-my-live-price", my)
        self.assertIn("global.addEventListener('watchlist:quote'", my)
        self.assertNotIn("refreshWatchlistQuotes(items);", my)

    def test_stock_search_keeps_result_row_in_sync_with_realtime_summary(self):
        source = self.read("js/stock-search.js")
        for token in (
            "state.lastResults || []",
            "resultRow = container.querySelector('.ss-result-row[data-idx=\"' + resultIndex + '\"]')",
            "resultPrice.textContent = fmtPrice(quote.price)",
            "resultRate.textContent = fmtSignedPct(quote.changeRate)",
        ):
            self.assertIn(token, source)

    def test_home_my_scrolls_all_quotes_and_rank_keeps_price_line(self):
        widgets = self.read("js/home-widgets.js")
        rank = self.read("js/sidebar-rank.js")
        style = self.read("style.css")
        rank_style = self.read("css/sidebar-rank.css")
        self.assertNotIn("}).slice(0, 5) : [];", widgets)
        for token in ("home-my-name", "home-my-quote", "현재가 확인 중", "formatPrice(quote.price)"):
            self.assertIn(token, widgets)
        self.assertIn(".home-my-list", style)
        self.assertIn("myRealtimeFallbackTimer", widgets)
        self.assertIn("REALTIME_FALLBACK_MS = 15000", widgets)
        self.assertIn("scrollbar-color: transparent transparent", style)
        self.assertIn("scrollbar-width: none", style)
        self.assertIn("sr-details", rank)
        self.assertIn("grid-template-rows: minmax(16px, auto) minmax(18px, auto)", style)
        self.assertIn("line-height: 1.35", rank_style)

    def test_investor_table_fills_card_height(self):
        source = self.read("css/investor-trend-widget.css")
        card_rule = re.search(
            r"#investor-trend-widget \.itw-card \{(?P<body>.*?)\}",
            source,
            re.DOTALL,
        )
        table_wrap_rule = re.search(
            r"#investor-trend-widget \.itw-table-wrap \{(?P<body>.*?)\}",
            source,
            re.DOTALL,
        )
        body_rule = re.search(
            r"#investor-trend-widget \.itw-body \{(?P<body>.*?)\}",
            source,
            re.DOTALL,
        )
        table_rule = re.search(
            r"#investor-trend-widget \.itw-table \{(?P<body>.*?)\}",
            source,
            re.DOTALL,
        )
        self.assertIsNotNone(card_rule)
        self.assertIn("display: flex", card_rule.group("body"))
        self.assertIn("flex-direction: column", card_rule.group("body"))
        self.assertIsNotNone(body_rule)
        self.assertIn("flex: 1 1 auto", body_rule.group("body"))
        self.assertIsNotNone(table_wrap_rule)
        self.assertIn("flex: 1 1 auto", table_wrap_rule.group("body"))
        self.assertIsNotNone(table_rule)
        self.assertIn("height: 100%", table_rule.group("body"))

    def test_pattern_buttons_reset_native_border(self):
        source = self.read("style.css")
        row_rule = re.search(
            r"\.home-pattern-row \{(?P<body>.*?)\}",
            source,
            re.DOTALL,
        )
        self.assertIsNotNone(row_rule)
        self.assertIn("appearance: none", row_rule.group("body"))
        self.assertIn("border: 0", row_rule.group("body"))
        self.assertIn("border-bottom: 1px solid #f0f1f2", row_rule.group("body"))
        self.assertIn("box-shadow: none", row_rule.group("body"))

    def test_market_temperature_history_self_records_without_manual_trigger(self):
        gas = self.read("gas/ticker-proxy.gs")
        source = self.read("js/market-temp.js")
        style = self.read("css/market-temp.css")
        for token in (
            "market_temp_v8",
            "upsertDailyMarketTemp_(temp)",
            "readDailyMarketTempHistory_",
            "computeMarketTempHistory_(temp, dailyHistory)",
            "computeMarketTempSparkline_(temp, dailyHistory)",
        ):
            self.assertIn(token, gas)
        self.assertIn("if (shown.length === 1)", source)
        self.assertIn("오늘부터 일별 기록을 시작했습니다.", source)
        self.assertNotIn("추이 데이터 수집 중 (며칠 후부터 표시됩니다)", source)
        self.assertNotIn("며칠 후부터 표시됩니다", source)
        self.assertIn(".mt-spark-single", style)

    def test_home_us_schedule_title_follows_the_market_label(self):
        style = self.read("style.css")
        selector = "body#tt-body-index .home-editorial-page .home-scoreboard-list .home-disclosure-row"
        start = style.index(selector)
        end = style.index("}", start)
        rule = style[start:end]
        self.assertIn("grid-template-columns: max-content minmax(0, 1fr) max-content", rule)

    def test_market_temperature_short_flow_has_period_switches_and_zero_centered_wave(self):
        gas = self.read("gas/ticker-proxy.gs")
        source = self.read("js/market-temp.js")
        style = self.read("css/market-temp.css")
        for period in (5, 10, 20, 40):
            self.assertIn(str(period), source)
        self.assertIn("var HISTORY_PERIODS = [5, 10, 20, 40];", source)
        self.assertIn("최근 단기흐름", source)
        self.assertIn("smoothSegment_", source)
        self.assertIn("30일 평균", source)
        self.assertIn("computeMarketTempSparkline_(temp, dailyHistory)", gas)
        self.assertIn("slice(-40)", gas)
        self.assertIn(".mt-wave-zero", style)
        self.assertIn(".mt-wave-segment-pos", style)
        self.assertIn(".mt-wave-segment-neg", style)

    def test_market_temperature_industry_flow_uses_reader_friendly_parent_labels(self):
        source = self.read("js/market-temp.js")
        for token in (
            "var INDUSTRY_DISPLAY_MAP_",
            "var INDUSTRY_TOP_LIMIT_ = 10;",
            "내구소비재와의류': '소비재'",
            "기술하드웨어와장비': 'IT하드웨어'",
            "제약과생물공학': '제약·바이오'",
            "var INDUSTRY_THEME_CODE_MAP_",
            "var INDUSTRY_THEME_KEYWORDS_",
            "'반도체 소부장'",
            "'자동차 부품'",
            "'원전'",
            "function industryThemeName_(row)",
            "function aggregateIndustryFlow_(rows)",
            "stocks: group.stocks.sort",
            "function representativeStocksHtml_(row, index)",
            "data-industry-index",
            "mt-industry-flow-detail",
            "aria-expanded",
            "대표 종목",
            "/page/stock-search?code=",
            # 2026-09-01 직관성 개선으로 문구가 바뀌었다(제목은 실제 개수를 쓰고,
            # 부제는 정렬 기준만 밝힌다). 세부 계약은
            # test_market_temp_industry_top_is_readable_at_a_glance에서 본다.
            "거래대금이 많이 몰린 순서",
            "Number(b.trade_amount) - Number(a.trade_amount)",
            "sections.tradeAmount",
        ):
            self.assertIn(token, source)

    def test_market_temperature_components_prioritize_action_and_driver_graphs(self):
        source = self.read("js/market-temp.js")
        style = self.read("css/market-temp.css")
        self.assertIn("오늘 시장 판단", source)
        self.assertIn("오늘 행동", source)
        self.assertIn("점수를 올린 요인", source)
        self.assertIn("점수를 내린 요인", source)
        self.assertIn("function buildDriverRow", source)
        self.assertIn("점수·계산 기준·데이터 출처 보기", source)
        self.assertIn("function score100(data)", source)
        self.assertIn("mt-market-decision", style)
        self.assertIn("mt-driver-grid", style)
        self.assertIn("grid-template-columns: minmax(0, 1.25fr) minmax(260px, .75fr)", style)
        self.assertIn("mt-driver-legend", style)
        self.assertNotIn("<table class=\"mt-comp-table\"", source)

    def test_market_temperature_includes_kofia_credit_risk_component(self):
        gas = self.read("gas/ticker-proxy.gs")
        source = self.read("js/market-temp.js")
        self.assertIn("creditRisk: 10", gas)
        self.assertIn("function scoreKofiaCredit_(kofia)", gas)
        self.assertIn("예탁금 대비 35% 미만", gas)
        self.assertIn("key: 'creditRisk'", source)
        self.assertIn("unit: 'creditRisk'", source)
        self.assertIn("신용/예탁", source)
        self.assertIn("comp.loan_total / 1000000000000", source)
        self.assertIn("데이터 검증 중", gas)
        self.assertIn("unitFactor", gas)
        self.assertIn("market_temp_v8", gas)
        self.assertIn("normalizedLoan / normalizedDeposits * 100", gas)

    def test_stock_search_minute_chart_shows_time_of_day(self):
        # 2026-08-05(3차) 사용자 리포트: 분봉 X축이 날짜만 반복 표시됨 - 분봉일 때만
        # timeVisible을 켜서 시:분(HH:mm)이 보이게 했다(일/주/월봉은 날짜 문자열이라 그대로).
        source = self.read("js/stock-search.js")
        self.assertIn("function lwcThemeOptions(LWC, timeframe)", source)
        self.assertIn("timeVisible: timeframe === 'minute'", source)
        self.assertIn("lwcThemeOptions(LWC, timeframe)", source)

    def test_stock_search_minute_chart_supports_scopes_and_live_candle_sync(self):
        source = self.read("js/stock-search.js")
        us_source = self.read("js/us-stocks.js")
        backend = self.read("scripts/cloud-vm/main.py")
        us_backend = self.read("scripts/cloud-vm/us_stocks.py")
        self.assertIn("var MINUTE_SCOPES = ['1', '3', '5', '30', '60'];", source)
        self.assertIn("data-minute-scope", source)
        self.assertIn("tic_scope=' + encodeURIComponent(scope)", source)
        self.assertIn("function updateLiveChartQuote(code, quote)", source)
        self.assertIn("lwcCandleSeries.update", source)
        self.assertIn("global.StockSearchChart.updateQuote", us_source)
        self.assertIn("REALTIME_QUOTES_URL", us_source)
        self.assertIn("tic_scope: str = Query('1')", backend)
        self.assertIn("us_stocks.chart(symbol, timeframe=timeframe, tic_scope=tic_scope)", backend)
        self.assertIn("US_MINUTE_SCOPES = ('1', '3', '5', '30', '60')", us_backend)
        self.assertIn("body['tic_scope'] = tic_scope", us_backend)

    def test_stock_search_minute_chart_keeps_only_latest_date(self):
        # 2026-08-05(5차) 사용자 리포트: 분봉 차트가 8/3~8/5 여러 날짜가 이어붙어 그려지고
        # 새로고침마다 그 전체 구간에 맞춰 줌아웃된 것처럼 보였음 - API_REFERENCE.md에 이미
        # 문서화된 대로 /ohlc-minute(ka10080)는 "최근 며칠치가 한 번에" 온다. 시간만 걸러선
        # 안 되고 응답에 포함된 날짜 중 가장 최근 날짜만 남겨야 한다.
        source = self.read("js/stock-search.js")
        self.assertIn(
            "var latestDate = rows.reduce(function (max, r) { return r.date > max ? r.date : max; }, '');",
            source,
        )
        self.assertIn("r.date === latestDate && r.time >= '09:00' && r.time <= '15:20'", source)

    def test_stock_search_minute_chart_time_matches_kst_not_utc(self):
        # 2026-08-05(4차) 사용자 리포트: timeVisible을 켠 뒤 시:분이 09:30이 아니라
        # 00:30처럼 9시간 이르게 나왔음 - Lightweight Charts가 UNIX 타임스탬프를 항상
        # UTC 기준으로 표시하기 때문에, 실제 KST를 정확히 UTC로 환산해 넣으면(+09:00)
        # 표시는 9시간 밀려 보인다. 'Z'로 넣어 "KST 시:분 숫자를 UTC인 척" 만들어야
        # 화면에 09:30이 그대로 찍힌다.
        source = self.read("js/stock-search.js")
        self.assertIn("new Date(r.date + 'T' + r.time + ':00Z')", source)
        self.assertNotIn("new Date(r.date + 'T' + r.time + ':00+09:00')", source)

    def test_stock_search_reuses_order_book_realtime_socket(self):
        # 2026-08-05(3차) 사용자 리포트: 상단 요약과 호가창이 서로 다른 가격을 보여줬음 -
        # 원인은 같은 코드에 WebSocket을 2개(order-book.js 것 + stock-search.js 자체 것)
        # 열어서 수신 타이밍이 어긋난 것. stock-search.js가 자체 소켓을 열지 않고
        # order-book.js의 onQuote 콜백을 그대로 받아쓰는지 확인한다.
        stock_search = self.read("js/stock-search.js")
        order_book = self.read("js/order-book.js")
        self.assertNotIn("var REALTIME_QUOTES_URL", stock_search)  # 자체 소켓 상수는 없어야 함(주석의 경위 설명 문구는 남아있어도 됨)
        self.assertNotIn("new WebSocket(", stock_search)
        self.assertIn("onQuote: function (quote) { applyRealtimeQuote(container, quote); }", stock_search)
        self.assertIn("state.onQuote = (opts && opts.onQuote) || null;", order_book)
        self.assertIn("if (state.onQuote) state.onQuote(quote);", order_book)

    def test_stock_search_volume_uses_compact_overlay_study(self):
        source = self.read("js/stock-search.js")
        style = self.read("css/stock-search.css")
        volume_series = re.search(
            r"var volumeSeries = chart\.addSeries\(LWC\.HistogramSeries, \{(?P<body>.*?)\}\);",
            source,
            re.DOTALL,
        )
        self.assertIsNotNone(volume_series)
        self.assertIn("priceFormat: { type: 'volume' }", volume_series.group("body"))
        self.assertIn("priceScaleId: 'volume'", volume_series.group("body"))
        # 2026-08-05 사용자 리포트(거래량 Y축이 가격과 겹쳐 보임): 라이브러리 네이티브
        # 마지막값 배지/점선은 .ss-volume-study-label 커스텀 범례와 같은 값을 중복 표시하며
        # 가격축 배지와 같은 여백에 그려져 겹쳤다 - 다른 보조지표 시리즈와 동일하게 끈다.
        self.assertIn("lastValueVisible: false", volume_series.group("body"))
        self.assertIn("priceLineVisible: false", volume_series.group("body"))
        self.assertNotIn("localization: { priceFormatter:", source)
        self.assertIn("movingAveragePoints(bars, 'volume', 20)", source)
        self.assertIn("var valueBars = bars.map(function (bar)", source)
        self.assertIn("var latestTradingValue = Math.max(0, Number(latestBar.close) || 0) * latestVolume", source)
        self.assertIn("ratioPercent(latestVolume, latestVolumeMa)", source)
        self.assertIn("compactTradingValue(latestTradingValue, isUsChart)", source)
        self.assertIn("5일평균 ' + compactVolume(latestVolumeMa5)", source)
        self.assertIn("20일평균 ' + compactVolume(latestVolumeMa)", source)
        self.assertIn("function ratioPercent(value, basis)", source)
        self.assertIn("function compactTradingValue(value, isUsChart)", source)
        self.assertIn("querySelectorAll('.ss-volume-study-label, .ss-price-study-label, .ss-lwc-pane-labels, .ss-ichimoku-cloud')", source)
        self.assertIn("paneLabels.style.visibility = 'hidden'", source)
        self.assertIn("paneLabels.style.visibility = 'visible'", source)
        self.assertIn("var renderId = ++lwcRenderId", source)
        self.assertIn("renderId !== lwcRenderId", source)
        self.assertIn("ss-volume-study-label", source)
        self.assertIn("전일 대비", source)
        self.assertIn("formatSignedPercent", source)
        self.assertIn("drawTicks: false", source)
        self.assertIn("chart.priceScale('right').applyOptions", source)
        self.assertIn("ticksVisible: false", source)
        self.assertIn(".ss-volume-study-label", style)
        self.assertIn(".ss-volume-current-label", style)
        self.assertIn(".ss-volume-amount-label", style)
        self.assertIn(".ss-volume-study-label em", style)
        self.assertIn("top: 70%", style)
        self.assertIn("panes[0].getHeight", source)
        self.assertIn("panes[1].getHeight", source)
        self.assertIn("actualMainHeight + actualVolumeHeight + 6", source)
        self.assertIn("actualMainHeight + 6", source)
        self.assertIn("function installRsiZoneCanvas", source)
        self.assertIn("SUB_PANE_MIN_HEIGHT = 82", source)
        self.assertIn("SUB_PANE_RATIO = 0.20", source)
        self.assertIn("function sizeStockChartPanes(panes, totalHeight)", source)
        self.assertIn("panes.slice(1).forEach(function (pane) { if (pane.setHeight) pane.setHeight(subHeight); })", source)
        self.assertIn("panes: { enableResize: false", source)
        self.assertIn("rsiSeries.priceToCoordinate(70)", source)
        self.assertIn("rsiSeries.priceToCoordinate(30)", source)
        self.assertIn("function stockRsi(bars)", source)
        self.assertNotIn("function stockRsiMacd", source)
        self.assertIn("color: '#333333', lineWidth: 2", source)
        self.assertIn("lastValueVisible: false, priceLineVisible: false", source)
        self.assertNotIn("title: 'RSI(14)'", source)
        self.assertNotIn("price: 50", source)
        self.assertIn("fillThresholdSegment", source)
        self.assertIn("subscribeVisibleLogicalRangeChange(scheduleDraw)", source)
        self.assertIn("pane.subscribeSizeChange(scheduleDraw)", source)
        self.assertIn("unsubscribeSizeChange(scheduleDraw)", source)
        self.assertIn("lwcRsiZonesCleanup = installRsiZoneCanvas", source)
        self.assertIn(".ss-rsi-zones", style)

    def test_stock_search_related_news_keeps_timeline_body_column(self):
        source = self.read("js/stock-search.js")
        style = self.read("css/stock-search.css")
        self.assertIn('class="app-news-event ss-news-item"', source)
        self.assertIn("grid-template-columns: 56px 13px minmax(0, 1fr);", style)
        self.assertIn("#stock-search .ss-news-timeline .ss-news-item", style)
        self.assertIn("grid-template-columns: 48px 11px minmax(0, 1fr);", style)
        self.assertIn("#stock-search .ss-news-timeline .app-news-body > strong", style)
        self.assertIn("overflow-wrap: normal;", style)

    def test_order_book_renders_quote_summary_and_volume_comparison(self):
        source = self.read("js/order-book.js")
        style = self.read("css/order-book.css")
        stock_search_style = self.read("css/stock-search.css")
        self.assertIn("fetchSummary(code)", source)
        self.assertIn("?action=flowChart&code=", source)
        self.assertIn("summaryItemHtml('시가'", source)
        self.assertIn("summaryItemHtml('고가'", source)
        self.assertIn("summaryItemHtml('저가'", source)
        self.assertIn("전일 거래량 대비", source)
        self.assertIn("grid-template-columns: repeat(3, minmax(0, 1fr))", style)
        self.assertIn("ob-summary-volume-change", style)
        self.assertIn("ob-summary-high", source)
        self.assertIn("ob-summary-low", source)
        self.assertIn("state.summary.high", source)
        self.assertIn("state.summary.low", source)
        self.assertIn("ob-summary-high", style)
        self.assertIn("ob-summary-low", style)
        self.assertIn("grid-template-columns: minmax(300px, var(--ss-left-width)) 16px minmax(0, 1fr);", stock_search_style)
        self.assertIn("grid-template-columns: 56px minmax(80px, 1fr) 72px;", style)
        self.assertIn("white-space: nowrap;", style)

    def test_stock_search_keeps_two_panel_default_and_allows_manual_resize(self):
        source = self.read("js/stock-search.js")
        style = self.read("css/stock-search.css")
        self.assertIn('class="ss-resize-handle"', source)
        self.assertIn('role="separator"', source)
        self.assertIn('aria-label="호가창과 차트 폭 조절"', source)
        self.assertIn("function wirePanelResize(container)", source)
        self.assertIn("setProperty('--ss-left-width'", source)
        self.assertIn("pointerdown", source)
        self.assertIn("ArrowLeft", source)
        self.assertIn("#stock-search .ss-panel-left { grid-column: 1; grid-row: 1; }", style)
        self.assertIn("#stock-search .ss-panel-right { grid-column: 3; grid-row: 1; }", style)
        self.assertIn("#stock-search .ss-resize-handle { display: none; }", style)

    def test_stock_search_renders_requested_price_studies_without_resizing_chart(self):
        source = self.read("js/stock-search.js")
        style = self.read("css/stock-search.css")
        self.assertIn("{ period: 5, label: '5'", source)
        self.assertIn("{ period: 20, label: '20'", source)
        self.assertIn("{ period: 60, label: '60'", source)
        self.assertIn("{ period: 224, label: '224'", source)
        self.assertIn("function chartPriceText(value, isUsChart)", source)
        self.assertIn("'$' + parsed.toLocaleString('en-US'", source)
        self.assertIn("var priceMinMove = isUsChart ? 0.01 : 1", source)
        self.assertIn("fontFamily: fontFamily", source)
        self.assertIn("font-family: inherit", style)
        self.assertIn("color: '#d24f45'", source)
        self.assertIn("color: '#1261c4'", source)
        self.assertIn("color: '#0ca678'", source)
        self.assertIn("study.period === 224 ? 3 : 1", source)
        self.assertIn("id=\"ssMovingAverageToggle\"", source)
        self.assertIn("id=\"ssIchimokuToggle\"", source)
        self.assertIn("ichimokuCloudPoints(bars, timeframe)", source)
        self.assertIn("rollingMidpointValues(bars, 9)", source)
        self.assertIn("rollingMidpointValues(bars, 26)", source)
        self.assertIn("rollingMidpointValues(bars, 52)", source)
        self.assertIn("installIchimokuCloudCanvas", source)
        self.assertIn("spanASeries.setData", source)
        self.assertIn("spanBSeries.setData", source)
        self.assertIn("ICHIMOKU_CLOUD_FILL = 'rgba(90,170,215,0.4)'", source)
        self.assertIn("ICHIMOKU_BORDER_COLOR = 'rgba(0,0,0,0)'", source)
        self.assertIn("color: ICHIMOKU_BORDER_COLOR", source)
        self.assertIn("ctx.fillStyle = ICHIMOKU_CLOUD_FILL", source)
        self.assertIn(".ss-ichimoku-cloud", style)
        self.assertIn(".ss-price-study-label", style)
        self.assertIn(".ss-chart { position: relative; height: 420px; }", style)
        self.assertIn("function setupStockDrawing", source)
        self.assertIn("stockDrawingStorageKey", source)
        self.assertIn(".ss-drawing-layer.is-active", style)

    def test_us_stock_detail_uses_site_font_and_consistent_type_scale(self):
        source = self.read("js/us-stocks.js")
        search = self.read("js/stock-search.js")
        style = self.read("css/us-stocks.css")
        self.assertIn("us-stocks.css?v=20260828-domestic-layout-parity-v2", source)
        self.assertIn("us-stocks.js?v=20260828-us-detail-request-budget-v6", search)
        for token in (
            'id="usStocksInput"',
            'id="usStocksSearchBtn"',
            'id="usStocksResults"',
            'class="us-stocks-results-head"',
            'function toggleFavorite(button)',
            'function buildShell(isEmbedded)',
            'class="us-stocks-shell us-stocks-embedded"',
            'class="us-stocks-detail ss-detail"',
            'class="ss-panels us-stocks-market-grid"',
            'class="ss-panel-left us-stocks-panel us-stocks-orderbook-panel"',
            'class="ss-panel-right us-stocks-panel us-stocks-chart-panel"',
            'class="ss-news-panel us-stocks-panel us-stocks-news-panel"',
            'applyTone(priceWrap, quote.change_rate)',
            "var apiTimeframe = timeframe === 'minute' ? 'minute' : 'daily';",
            "'?timeframe=' + apiTimeframe",
            "function localizedUsName(symbol, fallback)",
            "name: '인텔'",
            "aliases: '인텔 intel intel corporation'",
            "function exchangeLabel(value)",
            "US: '미국'",
            "'십억 달러'",
        ):
            self.assertIn(token, source)
        self.assertIn("item.title_ko || item.title || ''", source)
        self.assertIn("font-family: inherit", style)
        self.assertIn(".us-stocks-search > button", style)
        self.assertNotIn(".us-stocks-search button {", style)
        self.assertIn("flex: 0 1 33%; min-width: 220px", style)
        self.assertIn("background: #333; color: #fff; font-size: 14px", style)
        for token in (
            ".us-stocks-metric span { color: #8b95a1; font-size: 12px;",
            ".us-stocks-metric b { margin-top: 4px; font-size: 15px;",
            ".us-stocks-panel-head h4 { margin: 0; font-size: 16px;",
            ".us-stocks-news-time { display: block; margin-bottom: 3px; color: #f97316; font-size: 12px;",
        ):
            self.assertIn(token, style)
        self.assertIn("function isRecentNews(item)", source)
        self.assertIn("최근 24시간", source)
        self.assertIn("function domesticNewsWithin24Hours(item)", search)
        self.assertIn("최근 24시간", search)
        self.assertIn('class="ss-draw-toggle"', search)
        self.assertIn('class="ss-draw-clear"', search)
        self.assertIn("function setupStockDrawing", search)
        self.assertIn("if (!drawing.pending)", search)
        self.assertIn("drawing.lines.push({ start: drawing.pending, end: point })", search)
        self.assertIn(".us-stocks-market-grid > *", style)
        self.assertIn(".us-stocks-market-grid > .us-stocks-panel { padding: 0; border: 0;", style)
        self.assertIn("us-stocks-level-summary", source)
        self.assertIn("us-book-ask-fill", source)
        self.assertIn("us-book-bid-fill", source)
        self.assertIn("us-stocks-book-current", source)
        self.assertIn(".us-book-ask-fill { background: #1261c4;", style)
        self.assertIn(".us-book-bid-fill { background: #d24f45;", style)
        self.assertIn("저항(매도벽)", source)
        self.assertIn("지지(매수벽)", source)
        self.assertIn("실제 체결강도와는 다를 수 있습니다", source)
        self.assertIn(".us-native-chart-mount .ss-chart-tabs", style)
        self.assertIn(".us-stocks-news-item { position: relative; display: grid; grid-template-columns: 56px 13px minmax(0, 1fr);", style)
        self.assertIn(".us-stocks-news-item { grid-template-columns: 48px 11px minmax(0, 1fr); gap: 8px; }", style)
        self.assertIn(".us-stocks-shell.us-stocks-embedded { margin: 0; }", style)
        self.assertIn("#stock-search .us-stocks-embedded .us-stocks-market-grid { margin-top: 0; }", style)

    def test_us_detail_survives_watchlist_quote_rate_limit(self):
        us_source = self.read("js/us-stocks.js")
        search_source = self.read("js/stock-search.js")
        watchlist_source = self.read("js/watchlist.js")
        self.assertIn("function fetchQuoteWithRetry(symbol, attempt)", us_source)
        self.assertIn("error.status !== 429", us_source)
        self.assertIn("function loadDetailData(quote, symbol)", us_source)
        self.assertIn("state.detailLoadedSymbol = null", us_source)
        self.assertIn("if (updatedNode) updatedNode.textContent", us_source)
        self.assertIn("function isClosedOnStockSearchPage()", watchlist_source)
        self.assertIn("if (isClosedOnStockSearchPage()) usCodes = [];", watchlist_source)
        self.assertNotIn("var pending = target.getAttribute('data-us-symbol')", search_source)

    def test_strategy_dividend_warning_cell_uses_full_mobile_width(self):
        style = self.read("css/strategy-search.css")
        self.assertIn("tr.ss-warning-row td { display: block; width: 100% !important;", style)

    def test_stock_analysis_chart_matches_price_studies_and_replaces_volume_profile_with_volume(self):
        source = self.read("js/foreign-flow.js")
        self.assertIn('class="ui-btn ui-btn-tab ff-view-tab active"', source)
        style = self.read("css/foreign-flow.css")
        self.assertIn("#foreign-flow .ff-view-tab.ui-btn-tab", style)
        self.assertIn("padding: 8px 14px !important;", style)
        self.assertIn("font-size: 13px !important;", style)
        self.assertIn("border: 1px solid #dbe3ed !important;", style)
        self.assertIn("background: #111827 !important;", style)
        chart_card = re.search(
            r"function buildFlowChartCard\(chartData, techScore\) \{(?P<body>.*?)\n  \}",
            source,
            re.DOTALL,
        )
        self.assertIsNotNone(chart_card)
        body = chart_card.group("body")
        self.assertIn('id="ffMovingAverageToggle"', body)
        self.assertIn('id="ffIchimokuToggle"', body)
        self.assertLess(body.index('id="ffMovingAverageToggle"'), body.index('id="ffIchimokuToggle"'))
        self.assertNotIn('id="ffVolumeProfileToggle"', body)
        self.assertNotIn("buildVpLegend()", body)
        self.assertIn("var MA_COLORS = { ma5: '#d24f45', ma20: '#1261c4', ma60: '#0ca678' };", source)
        self.assertIn("var MA_WIDTHS = { ma5: 1, ma20: 1, ma60: 1, ma224: 3 };", source)
        self.assertIn("['ma5', 'ma20', 'ma60', 'ma224'].forEach(function (key)", source)
        self.assertIn("function ma224Color()", source)
        self.assertIn(">224일선</span>", source)
        self.assertIn("movingAverageOverlaySeries.push(lineSeries)", source)
        self.assertIn("function createIchimokuCloudPrimitive(bandPts, cloudColor)", source)
        self.assertIn("ctx.fillStyle = cloudColor", source)
        self.assertIn("ICHIMOKU_CLOUD_FILL = 'rgba(90,170,215,0.4)'", source)
        self.assertIn("ICHIMOKU_BORDER_COLOR = 'rgba(0,0,0,0)'", source)
        self.assertIn("color: ICHIMOKU_BORDER_COLOR", source)
        self.assertIn("createIchimokuCloudPrimitive(bandPts, ICHIMOKU_CLOUD_FILL)", source)
        self.assertIn("var volumeSeries = chart.addSeries(LWC.HistogramSeries", source)
        self.assertIn("priceFormat: { type: 'volume' }", source)
        self.assertIn("movingAverageChartPoints(daily, 'volume', 20)", source)
        self.assertNotIn("chart.subscribeClick", source)
        self.assertNotIn("ff-chart-news-detail", source)
        self.assertNotIn("fetchChartEvents", source)
        self.assertNotIn("computeRsiMacd", source)
        self.assertNotIn("var macdHistogram = chart.addSeries", source)
        self.assertNotIn("var rsiSeries = chart.addSeries", source)
        self.assertNotIn(">뉴스</span>", source)
        self.assertNotIn(">패턴·거래</span>", source)
        self.assertNotIn("pattern-volume", source)
        self.assertNotIn("pattern-up", source)
        self.assertNotIn("pattern-down", source)
        self.assertIn("var foreignSeries = chart.addSeries(LWC.LineSeries", source)
        self.assertIn("title: '외국인' }, 2)", source)
        self.assertIn("<span>거래량</span><span>외국인·기관 순매수</span>", source)
        self.assertIn(".ff-volume-study-label", style)
        self.assertIn(".ff-chart-candle::after", style)
        self.assertNotIn(".ff-chart-news-detail", style)
        self.assertIn('.ff-chart-row .ff-chart-title { font-family: "Pretendard", "Malgun Gothic", sans-serif; }', style)

    def test_stock_analysis_volume_profile_uses_compact_price_bars(self):
        source = self.read("js/foreign-flow.js")
        style = self.read("css/foreign-flow.css")
        dynamic = re.search(
            r"function buildAptDynamicHtml\(profile, currentPrice, stepIndex, daysIncluded, avgPrice\) \{(?P<body>.*?)\n  \}",
            source,
            re.DOTALL,
        )
        self.assertIsNotNone(dynamic)
        body = dynamic.group("body")
        self.assertIn("buildSimpleVolumeProfileHtml", body)
        self.assertNotIn("buildAptIllustratedLineArtHtml", body)
        self.assertNotIn("buildAptZoomButtons", body)
        self.assertNotIn("건물의 높이", body)
        self.assertIn("function compactAptProfileBins(profile, rowCount)", source)
        self.assertIn("compactAptProfileBins(profile, 12)", source)
        self.assertIn("function buildAptOrderBookRows(rows, currentPrice)", source)
        self.assertIn("현재가 위 · 저항 후보", source)
        self.assertIn("현재가 아래 · 지지 후보", source)
        self.assertIn("확인된 거래 없음", source)
        self.assertIn("synthetic: true", source)
        self.assertIn('class="ff-apt-chart-wrap ff-apt-simple"', source)
        self.assertIn('data-apt-simple-current', source)
        self.assertIn("row.volume > 0 && maxVolume > 0", source)
        self.assertNotIn("Math.max(3, Math.round(row.volume / maxVolume", source)
        self.assertIn("function attachAptPriceLimits(profile, openPrice)", source)
        self.assertIn("lowerLimit: Math.round(base * 0.7)", source)
        self.assertIn("upperLimit: Math.round(base * 1.3)", source)
        self.assertIn("시가 기준 참고 가격 범위", source)
        self.assertIn('class="basis">시가 기준 ±30%', source)
        self.assertIn('class="lower">하한가', source)
        self.assertIn('class="upper">상한가', source)
        self.assertIn('<div class="ff-extra-card-title">매물대</div>', source)
        self.assertNotIn('<div class="ff-extra-card-title">🏢 매물대</div>', source)
        self.assertIn("#foreign-flow .ff-apt-simple-row", style)
        self.assertIn("grid-template-columns: 112px minmax(100px, 1fr) 64px 94px;", style)
        self.assertIn("@media (max-width: 640px)", style)
        self.assertIn(".ff-apt-simple-limits", style)
        self.assertIn("매물대 돌파 중", source)
        self.assertIn("돌파 후 밀림", source)
        self.assertIn("매물대에 밀리는 중", source)
        self.assertIn('class="ff-apt-simple-signal ', source)
        self.assertIn(".ff-apt-simple-signal.up", style)
        self.assertIn(".ff-apt-simple-signal.down", style)
        self.assertIn(".ff-apt-simple-side-heading", style)
        self.assertIn(".ff-apt-simple-row.is-empty", style)

    def test_stock_simulation_shows_price_before_valuation(self):
        source = self.read("js/foreign-flow.js")
        card = re.search(
            r"function buildSimulationCard\(chartData\) \{(?P<body>.*?)\n  \}",
            source,
            re.DOTALL,
        )
        self.assertIsNotNone(card)
        body = card.group("body")
        date_pos = body.index('id="ffSimDate"')
        price_pos = body.index('id="ffSimPrice"')
        value_pos = body.index('id="ffSimValue"')
        rate_pos = body.index('id="ffSimRate"')
        self.assertLess(date_pos, price_pos)
        self.assertLess(price_pos, value_pos)
        self.assertLess(value_pos, rate_pos)
        self.assertIn("if (priceEl) priceEl.textContent = fmtWon(d.close);", source)
        self.assertIn("if (priceEl) priceEl.textContent = fmtWon(daily[0].close);", source)

    def test_signal_banner_ignores_late_responses_from_previous_selection(self):
        source = self.read("js/foreign-flow.js")
        self.assertIn("var signalRequestSeq = 0;", source)
        self.assertIn("var requestId = ++signalRequestSeq;", source)
        self.assertIn("signalRequestSeq !== requestId", source)
        self.assertIn("bannerBox.innerHTML = '';", source)

    def test_pattern_scan_includes_ma_cloud_breakout_search(self):
        source = self.read("js/pattern-scan.js")
        self.assertIn("key: 'maCloudBreakout'", source)
        self.assertIn("label: '장기이평 응축기'", source)
        self.assertIn("고가가 구름 상단 3% 이내로 접근했거나 저가가 구름 하단 3% 이내로 접근", source)
        self.assertIn("{ key: 'ma224', period: 224, label: '224일선', color: ma224Color() }", source)
        self.assertIn("standardMovingAverageStudies().forEach(function (study)", source)
        self.assertIn("psIchimokuEnabled = activeTab === 'maCloudBreakout'", source)
        self.assertIn("ICHIMOKU_COLORS = { senkouA: '#87ceeb', senkouB: '#87ceeb' }", source)
        self.assertIn("ICHIMOKU_BORDER_COLOR = 'rgba(0,0,0,0)'", source)
        self.assertIn("createIchimokuCloudPrimitive(bandPts, ICHIMOKU_CLOUD_FILL)", source)

    def test_box_range_detail_prefers_vm_snapshot_with_market_cap_filter(self):
        source = self.read("js/pattern-scan.js")
        self.assertIn("최근 20봉 종가 변동폭 10% 이하", source)
        self.assertIn("시가총액 3,000억원 이상", source)
        self.assertIn("activeTab === 'boxRangeLow' || activeTab === 'openingGap'", source)
        self.assertNotIn("slice(0, 12)", source)
        self.assertIn("data.detail = item.patternDetail", source)

    def test_chart_search_opening_gap_tab_removed(self):
        """2026-08-22: "시초 갭상승" 탭 삭제 요청 - TABS 목록에서만 빠졌는지 확인
        (백엔드 detect_opening_gap/GAS는 그대로 유지, 되돌리기 쉽게)."""
        source = self.read("js/pattern-scan.js")
        style = self.read("css/pattern-scan.css")
        self.assertNotIn("key: 'openingGap'", source)
        self.assertNotIn("label: '시초 갭상승'", source)
        self.assertIn("miniChartRows", source)
        self.assertIn("ps-list-head", source)
        self.assertIn("ps-signal", source)
        self.assertIn("#pattern-scan .ps-name", style)

    def test_chart_search_result_is_scanner_list_without_score_badges(self):
        source = self.read("js/pattern-scan.js")
        style = self.read("css/pattern-scan.css")
        backend = self.read("scripts/cloud-vm/pattern_detect.py")
        fixture = self.read("test/pattern-scan.html")
        for token in ("miniChartHtml", "최근 20거래일 종가 흐름", "scannerSignal", "scannerInterpretation", "risingLowsObservation", "개별 관측", "ps-pivot-marker", "tabindex=\"0\"", "ps-rank"):
            self.assertIn(token, source)
        self.assertNotIn("ps-score-badge", source)
        self.assertNotIn("patternIcon(activeTab)", source)
        for token in ("grid-template-columns: 34px", ".ps-mini-chart", ".ps-mobile-signal", "@media (max-width: 480px)"):
            self.assertIn(token, style)
        self.assertIn("'miniChart': mini_chart", backend)
        self.assertIn("'closes_20d'", backend)
        self.assertIn("'previous_low'", backend)
        self.assertIn("annotate_pattern_scan_details", backend)
        self.assertIn("miniChart: daily.slice(-20)", fixture)
        self.assertIn("patternDetail:", fixture)

    def test_chart_search_scan_snapshot_bypasses_stale_empty_cache(self):
        source = self.read("js/pattern-scan.js")
        # 2026-09-03: 목록이 VM 직접 호출 → GAS 폴백 2단계가 되면서 캐시버스터를 변수로
        # 뽑았다. 두 경로 다 같은 스탬프를 달아야 stale한 빈 응답을 피하는 원래 의도가 산다.
        self.assertIn("var stamp = encodeURIComponent(Date.now());", source)
        self.assertIn("'?patternScan=1&_=' + stamp", source)
        self.assertIn("'/pattern-scan?_=' + stamp", source)
        self.assertIn("var FETCH_RETRY_COUNT = 2;", source)
        self.assertIn("function fetchWithRetry(url, isValid)", source)
        self.assertIn("_retry=' + encodeURIComponent(attempt)", source)
        self.assertIn("id=\"psRetry\"", source)
        self.assertIn("Array.isArray(data.daily)", source)
        self.assertIn(".ps-retry", self.read("css/pattern-scan.css"))
        self.assertIn("VM 일일 스캔이 한 번 완료되면 표시됩니다.", source)
        self.assertNotIn("GAS에서 scanChartPatterns를 한 번 실행해야 함", source)
        self.assertIn("최근 20봉에서 좌우 2봉보다 낮은 스윙 저점이 2개 이상이고", source)
        self.assertNotIn("최근 20거래일 안에서 최근 두 스윙 저점이 높아지고 현재가가 마지막 저점 위에 있는 상승 구간으로 추정됩니다", source)

    def test_strategy_search_renders_weekly_envelope_metric(self):
        source = self.read("js/strategy-search.js")
        style = self.read("css/strategy-search.css")
        self.assertIn("it.envelope", source)
        self.assertIn("엔벨로프 하단", source)
        self.assertIn("columns: 1;", style)
        self.assertIn("#strategy-search .ss-row-name", style)

    def test_strategy_search_renders_opening_gap_metric(self):
        source = self.read("js/strategy-search.js")
        self.assertIn("it.gapRatePct", source)
        self.assertIn("시초갭", source)
        self.assertIn("fmtMillion(it.turnoverMillion)", source)

    def test_strategy_search_discloses_reference_target_price_basis(self):
        source = self.read("js/strategy-search.js")
        style = self.read("css/strategy-search.css")
        scan = self.read("scripts/cloud-vm/strategy_scan.py")
        for token in ("6~12개월 참고 목표주가", "targetPriceCellHtml", "참고 목표주가", "70% 지점", "최대 30종목"):
            self.assertIn(token, source)
        self.assertIn("ss-target-price-note", style)
        self.assertIn("ss-target-price-table-wrap", style)
        self.assertIn("6~12개월 참고 목표주가", scan)
        self.assertIn("백테스트가 끝난 확정 예측값이 아니라", scan)
        self.assertIn("최대 {top_n}종목", scan)

    def test_strategy_search_mobile_table_uses_compact_aligned_rows(self):
        style = self.read("css/strategy-search.css")
        self.assertIn("모바일 전략표 재배치", style)
        self.assertIn("grid-template-areas", style)
        self.assertIn('"watch rank product price"', style)
        self.assertIn('"code code change change"', style)
        self.assertIn("content: attr(data-label) ' ';", style)
        self.assertIn("#strategy-search .ss-strategy-table td::before { display: none; }", style)

    def test_strategy_search_uses_one_flattened_etf_ranking_table(self):
        source = self.read("js/strategy-search.js")
        style = self.read("css/strategy-search.css")
        self.assertIn("normalizeScanData", source)
        self.assertIn("data.categories.etfReturn", source)
        self.assertIn("returnRate1mPct", source)
        self.assertIn("returnRate3mPct", source)
        self.assertIn("returnRate6mPct", source)
        self.assertIn("returnRate12mPct", source)
        for token in (
            "normalizeEtfItem", "providerFromName", "ss-col-provider", "ss-col-code",
            "신규상장", "ss-comparison-table",
        ):
            self.assertIn(token, source)
        self.assertNotIn("ETF_ISSUER_GROUPS", source)
        self.assertNotIn("groupEtfMatches", source)
        self.assertNotIn("ss-cards-grid", source[source.index("function renderEtfProductView"):source.index("function dividendSortOptions")])
        self.assertNotIn('ss-col-volume', source)
        self.assertNotIn('ss-col-turnover', source)
        self.assertNotIn('ss-col-aum', source)
        self.assertIn("ss-col-provider", style)
        self.assertNotIn("ss-etf-components-btn", source)
        self.assertNotIn("ss-etf-components-btn", style)

    def test_strategy_search_explains_candidates_without_recommendation_language(self):
        source = self.read("js/strategy-search.js")
        style = self.read("css/strategy-search.css")
        fixture = self.read("test/strategy-search.html")
        for token in (
            "전략은 두뇌다.",
            "전략 조건으로 후보군을 찾고",
            "categoryLabel",
            "재무건전 장기 눌림",
            "120일선 대비",
            "배당수익률",
            "주당 현금배당",
            "상위 10종목 비중",
            "ss-etf-comp-row",
            "stockIconHtml(item.code, 'ss-etf-comp-icon')",
            "tabindex=\"0\"",
        ):
            self.assertIn(token, source)
        self.assertIn("dividendMatch", fixture)
        self.assertIn("etfMatch", fixture)
        self.assertNotIn("'이격도 '", source)
        for token in (".ss-intro", ".ss-methodology-full", ".ss-row-primary", ".ss-row-secondary", "columns: 1;"):
            self.assertIn(token, style)
        self.assertIn(".ss-etf-comp-name .ss-etf-comp-icon", style)

    def test_strategy_search_uses_etf_etn_and_dividend_comparison_tables(self):
        source = self.read("js/strategy-search.js")
        style = self.read("css/strategy-search.css")
        fixture = self.read("test/strategy-search.html")
        for token in (
            "ss-comparison-table",
            "activeEtfFilters",
            "data-etf-filter=\"major\"",
            "data-etf-filter=\"middle\"",
            "data-etf-filter=\"leverage\"",
            "activeDividendMarket",
            "data-dividend-filter=\"market\"",
            "배당성향",
            "dividendHistory",
            "ss-dividend-basis",
            "fmtWon",
            "배당 데이터 ",
            "ss-strategy-table",
            "cleanIndustryLabel",
            "openDividendInfoModal",
            "ss-dividend-modal",
        ):
            self.assertIn(token, source)
        self.assertIn("—", source)
        self.assertNotIn("ROE순", source)
        self.assertNotIn("PER 낮은 순", source)
        self.assertNotIn("PBR 낮은 순", source)
        self.assertNotIn("1년 전 배당금", source)
        self.assertIn("ss-warning-row", style)
        self.assertIn("width: 100%;", style)
        self.assertIn("gap: 9px;", style)
        self.assertIn("display: inline-flex;", style)
        self.assertIn("ss-dividend-modal-overlay", style)
        self.assertIn("market: code === '105560' ? 'KOSPI' : 'KOSDAQ'", fixture)
        self.assertNotIn("ss-score", source)
        self.assertNotIn("별점", source)

    def test_strategy_search_national_pension_category(self):
        """2026-08-20: "국민연금이 가진 종목 조회" 요청 - public_data.py에 이미 있던
        (하지만 어디서도 안 쓰이던) fetch_nps_holding()/data.go.kr 연동을
        전략검색의 새 카테고리(nationalPension)로 노출."""
        source = self.read("js/strategy-search.js")
        scan = self.read("scripts/cloud-vm/strategy_scan.py")
        public_data = self.read("scripts/cloud-vm/public_data.py")
        for token in (
            "activeKey === 'nationalPension'",
            "renderNpsTable",
            "holdingPct",
            "evaluationAmountEok",
            "activeNpsRangeIndex",
            "ss-nps-filter-select",
            "보유 지분율",
        ):
            self.assertIn(token, source)
        for token in (
            "def scan_nps_holdings(universe, wics_map, conn, theme_codes=None, daily_cache=None)",
            "def build_nps_match(stock, daily, sector, info)",
            "'nationalPension'",
            "NPS_METHODOLOGY_NOTE",
        ):
            self.assertIn(token, scan)
        for token in (
            "def fetch_nps_holding(name)",
            "def fetch_nps_holdings_by_code(universe)",
        ):
            self.assertIn(token, public_data)

    def test_strategy_search_tabs_match_chart_search_control_size(self):
        style = self.read("css/strategy-search.css")
        self.assertIn("#strategy-search .ss-tabs", style)
        self.assertIn("#strategy-search .ss-product-tabs", style)
        self.assertIn("border-radius: 4px !important;", style)
        self.assertIn("min-height: 0 !important;", style)
        self.assertIn("padding: 8px 14px !important;", style)
        self.assertIn("font-size: 13px !important;", style)
        self.assertIn("#strategy-search .ss-tab.active", style)
        self.assertIn("#strategy-search .ss-product-tab.active", style)

    def test_home_widgets_render_cached_data_without_waiting_for_slowest_endpoint(self):
        home = self.read("js/skin-main.js")
        widgets = self.read("js/home-widgets.js")
        ranking = self.read("js/sidebar-rank.js")
        self.assertNotIn("GAS_TICKER_URL + '?market=1'", home)
        self.assertIn("home_market_temp_v1", home)
        self.assertIn("home_market_sectors_v1", home)
        self.assertNotIn("home_pattern_scan_v1", home)
        self.assertIn("readHomeDataCache", home)
        self.assertIn("writeHomeDataCache", home)
        self.assertIn("스크립트 로드 시간 초과", home)
        self.assertIn("최신 마켓브리핑을 확인하는 중입니다.", home)
        self.assertIn("home_market_rank_v1", ranking)
        self.assertIn("readRankCache", ranking)
        self.assertIn("home_watchlist_quotes_v1", widgets)
        self.assertIn("WATCHLIST_DISCLOSURES_URL", widgets)
        self.assertIn("readTimedCache", widgets)

    def test_home_shares_earnings_calendar_and_market_board_requests(self):
        # 홈 1회 로드에서 /earnings-calendar(월별, 수백 KB)와 /market-board를 여러 위젯이
        # 제각각 호출하던 것을 skin-main.js의 공유 로더로 합친다. 세 소비자가 전역 로더를
        # 우선 쓰고, 없을 때만 기존 직접 호출로 폴백해야 한다.
        home = self.read("js/skin-main.js")
        widgets = self.read("js/home-widgets.js")
        weekly = self.read("js/home-weekly-report.js")
        calendar = self.read("js/stock-calendar.js")
        self.assertIn("window.EarningsCalendarFeed = { month: month }", home)
        self.assertIn("window.HomeMarketBoard = { fetch: fetchBoard }", home)
        self.assertIn("window.__homeMarketBoardRequests", home)
        for consumer in (widgets, weekly):
            self.assertIn("window.EarningsCalendarFeed", consumer)
            self.assertIn("window.EarningsCalendarFeed.month(period.year, period.month)", consumer)
        self.assertIn("global.EarningsCalendarFeed.month(year, month + 1)", calendar)

    def test_home_prioritizes_weekly_watchlist_disclosures(self):
        widgets = self.read("js/home-widgets.js")
        home = self.read("js/skin-main.js")
        backend = self.read("scripts/cloud-vm/main.py")
        self.assertIn("https://goodbyestar.cloud/watchlist/disclosures", widgets)
        self.assertIn("credentials: 'include'", widgets)
        self.assertIn("최근 7일 · ' + items.length + '건", widgets)
        self.assertIn("관심종목 주간 공시", widgets)
        self.assertNotIn("DISC_GAS_URL", widgets)
        self.assertNotIn("result.length < 5", widgets)
        self.assertIn("startDisclosureTicker(items", widgets)
        self.assertNotIn("home-disclosure-more", widgets)
        self.assertIn("startDisclosureTicker(selection.items", widgets)
        self.assertIn("관심종목 주간 공시", home)
        self.assertIn("@app.get('/watchlist/disclosures')", backend)
        self.assertIn("get_watchlist_disclosures(domestic_codes, days=7", backend)

    def test_market_temperature_cards_use_personal_overrides_and_keep_shared_default(self):
        source = self.read("js/market-temp.js")
        style = self.read("css/market-temp.css")
        backend = self.read("scripts/cloud-vm/main.py")
        for token in (
            "USER_SECTOR_CARDS_API_URL",
            "market_temp_sector_cards_v1",
            "편집 대기 · 기본 카드",
            "기본 카드로 되돌리기",
            "credentials: 'include'",
        ):
            self.assertIn(token, source)
        self.assertIn("@app.get('/sector-cards/me')", backend)
        self.assertIn("@app.put('/sector-cards/me')", backend)
        self.assertIn("@app.delete('/sector-cards/me')", backend)
        self.assertIn("#market-temp > .mt-wrap + .mt-explore-card { margin-top: 18px; }", style)
        self.assertIn("function invalidatePersonalHeatmap_(panel)", source)
        self.assertIn("heatmapPanel.__mtLoaded = false", source)
        self.assertIn("전체 고정 종목 풀", source)

    def test_major_stock_cards_open_line_lists_with_shaded_pending_recommendations(self):
        dashboard = self.read("js/sector-dashboard-v4.js")
        dashboard_style = self.read("css/sector-dashboard-v3.css")
        market_temp = self.read("js/market-temp.js")
        for token in (
            "RELATED_SECTOR_RECOMMENDATIONS",
            "renderSectorDetailHtml",
            "wireSectorCardSelection",
            "data-sector-detail-back",
            "data-sector=\"' + escapeHTML(sector) + '\"",
            "롯데로지스틱",
            "로젠",
        ):
            self.assertIn(token, dashboard)
        self.assertIn("SD.wireSectorCardSelection(panel, sectorMap, krxMap, byCode, wireEditor)", market_temp)
        for token in (".sector-detail-line-list", ".sector-detail-row.is-listed", ".sector-detail-row.is-pending",
                      ".sector-detail-back", ".mt-sector-config-status.is-edited", ".mt-sector-config-status.is-pending"):
            self.assertIn(token, dashboard_style + self.read("css/market-temp.css"))
        for token in ("function renderSectorLineList", "sector-detail-line-list", "sector-detail-row is-pending",
                      "function renderSectorMappingHtml", "sector-detail-mapping-route", "sector-detail-mapping-target",
                      "검은색: 현재 카드 · 옅은색: 편집 대기", "현재 카드에 편집된 종목은 검은색 선",
                      "is-sector-detail", "classList.add('is-sector-detail')"):
            self.assertIn(token, dashboard)
        market_temp_style = self.read("css/market-temp.css")
        self.assertIn('.mt-explore-card.is-sector-detail .mt-view-btn[data-view="heatmap"]', market_temp_style)
        self.assertIn('.mt-explore-card.is-sector-detail .mt-view-btn[data-view="marketcap"]', market_temp_style)

    def test_my_dashboard_selected_stock_uses_daily_change_color(self):
        source = self.read("js/my-dashboard.js")
        style = self.read("css/my-dashboard.css")
        self.assertIn("var dailyChangeRate = quoteField(quote, ['changeRate', 'change_rate', 'change_rate_pct']);", source)
        self.assertIn("var dailyChangeClass = signClass(dailyChangeRate);", source)
        self.assertIn('class="my-selected-title \' + dailyChangeClass', source)
        self.assertNotIn("metrics.rate > 0 ? ' is-profit'", source)
        self.assertIn(".my-selected-title.is-up .my-selected-name { color: #d24f45; }", style)
        self.assertIn(".my-selected-title.is-down .my-selected-name { color: #1261c4; }", style)

    def test_weekly_report_uses_recognizable_bull_and_bear_labels(self):
        source = self.read("js/home-weekly-report.js")
        self.assertNotIn("FORCE_BEAR_PREVIEW", source)
        self.assertIn("return values.length ? values.reduce(function (sum, value) { return sum + value; }, 0) >= 0 : true;", source)
        self.assertIn('aria-label="황소장 상승"', source)
        self.assertIn('<strong>황소장 · 상승</strong>', source)
        self.assertIn('aria-label="곰장 하락"', source)
        self.assertIn('<strong>곰장 · 하락</strong>', source)
        self.assertIn('M71 61c0 9 4 14 9 14s9-5 9-14', source)
        self.assertEqual(source.count('<svg width="104" height="52" viewBox="0 0 160 82" fill="none" stroke="currentColor"'), 2)

    def test_weekly_sentiment_svg_inlines_color_to_avoid_black_flash(self):
        # 2026-08-20: 휴장 탭을 열 때 css/home-weekly-report.css가 늦게 도착하면
        # stroke="currentColor"가 브라우저 기본색(검정)으로 먼저 그려졌다가 CSS
        # 도착 후 빨강/파랑으로 바뀌는 깜박임이 있었다(사용자 리포트). 래퍼에 인라인
        # color를 넣어 외부 CSS 도착 전에도 첫 페인트부터 올바른 색이 나오게 한다.
        source = self.read("js/home-weekly-report.js")
        self.assertIn('class="hwr-sentiment hwr-sentiment--up" style="color:#d24f45"', source)
        self.assertIn('class="hwr-sentiment hwr-sentiment--down" style="color:#1261c4"', source)

    def test_weekly_hot_and_cold_stock_reasons_are_bold(self):
        source = self.read("js/home-weekly-report.js")
        style = self.read("css/home-weekly-report.css")
        self.assertIn("뜨거웠던 종목", source)
        self.assertIn("차가웠던 종목", source)
        self.assertNotIn(">뜨거운 종목<", source)
        self.assertNotIn(">차가운 종목<", source)
        self.assertIn('class="hwr-stock-reason"', source)
        self.assertIn(".hwr-stock-reason { display: block; margin-top: 2px; color: #64748b; font-size: 9px; font-style: normal; font-weight: 700;", style)

    def test_weekly_summary_includes_indices_and_major_assets_in_order(self):
        source = self.read("js/home-weekly-report.js")
        self.assertIn('aria-label="주간 지수·자산 요약"', source)
        self.assertIn('<span>주간 지수·자산 요약</span>', source)
        for token in (
            'KOSPI: 0', 'KOSDAQ: 1', 'NASDAQ_INDEX: 2', 'SP500_INDEX: 3',
            'WTI: 4', 'GOLD: 5', 'US10Y: 6', 'BTC: 7',
        ):
            self.assertIn(token, source)
        self.assertNotIn("(!item.group || item.group === 'index') && num(item.changeRate)", source)
        self.assertIn("['KOSPI', 'KOSDAQ', 'NASDAQ_INDEX', 'SP500_INDEX'].indexOf(item.symbol) !== -1", source)
        self.assertIn("+ '<div class=\"hwr-index-grid\">' + indices.filter(function (item)", source)
        self.assertIn("data.gold || {}", source)
        self.assertIn("금 선물", source)
        self.assertIn("매수 관심 ≤", source)
        self.assertIn("GOLD_FALLBACK_URL", source)

    def test_weekly_report_renders_forward_candidate_sections(self):
        source = self.read("js/home-weekly-report.js")
        style = self.read("css/home-weekly-report.css")
        backend = self.read("scripts/cloud-vm/main.py")
        for token in (
            'data.hotCandidates && data.hotCandidates.domestic',
            '2주 스윙 상승 후보', '국내 후보', '보유자 행동과 신규 진입을 분리',
        ):
            self.assertIn(token, source)
        self.assertIn('.hwr-candidate-section .hwr-card-title strong.is-up', style)
        self.assertIn('_WEEKLY_REPORT_SNAPSHOT_VERSION = 8', backend)

    def test_swing_ui_separates_regime_event_and_hides_legacy_grade_from_visible_box(self):
        source = self.read("js/foreign-flow.js")
        box_start = source.index('function buildSwingSummaryBox')
        box_end = source.index('function buildSummaryBox', box_start)
        visible_box = source[box_start:box_end]
        self.assertIn('currentRegime', visible_box)
        self.assertIn('recentEvent', visible_box)
        self.assertIn('장기 국면', visible_box)
        self.assertIn('맥락', visible_box)
        self.assertIn('ff-swing-step-name', visible_box)
        self.assertIn('ff-swing-step-context', visible_box)
        self.assertIn('중기 국면', visible_box)
        self.assertIn('방향', visible_box)
        self.assertIn('단기 국면', visible_box)
        self.assertIn('진입 시점', visible_box)
        self.assertIn('5일선 신호', visible_box)
        self.assertIn('assessment.diagnosis', visible_box)
        self.assertIn('보조 상태', visible_box)
        self.assertNotIn('starsHtml(', visible_box)
        self.assertNotIn('ff-stars', visible_box)
        style = self.read('css/foreign-flow.css')
        self.assertIn('.ff-swing-flow', style)
        self.assertIn('align-items: baseline; flex: 0 0 auto; gap: 4px;', style)
        self.assertIn('grid-template-columns: 90px minmax(0, 1fr);', style)
        self.assertNotIn('.ff-swing-grid', style)

    def test_weekly_candidate_empty_state_is_explicit(self):
        source = self.read("js/home-weekly-report.js")
        self.assertIn("'현재 조건 충족 후보 없음'", source)

    # 2026-08-22 신설(사용자 리포트: "한국증시/미국증시 누르면 휴장 대시보드가 중간에
    # 항상 끼네?") - 주말엔 #homeWeeklyReport(js/home-weekly-report.js)가 페이지 로드
    # 시점에 한 번만 만들어지고, 탭을 한국증시/미국증시로 바꿔도 계속 보이던 문제.
    # applyHomeMarketSession()이 다른 컨테이너(.home-closed-page 등)와 같은 기준
    # (isClosed)으로 이 요소도 hidden을 동기화해야 한다.
    def test_home_market_switch_hides_weekly_report_outside_closed_tab(self):
        source = self.read("js/skin-main.js")
        func_start = source.index("function applyHomeMarketSession")
        func_end = source.index("\n    }", source.index("if (isClosed) return;", func_start))
        body = source[func_start:func_end]
        self.assertIn("getElementById('homeWeeklyReport')", body)
        self.assertIn("weeklyReport.hidden = !isClosed", body)

    # 2026-08-22 신설: 휴장 페이지 "다음 주 핵심 스케줄"에 관심종목(watchlist.js localStorage)
    # 실적·공시 일정을 조건부로 얹는 기능 - 표본이 없으면(관심종목 미등록/해당 일정 없음)
    # 섹션 자체를 숨겨야 "그냥 데이터만 붙여넣은 대시보드"가 되지 않는다.
    def test_weekly_report_shows_watchlist_schedule_only_when_matched(self):
        source = self.read("js/home-weekly-report.js")
        self.assertIn("EARNINGS_CALENDAR_URL = 'https://goodbyestar.cloud/earnings-calendar'", source)
        self.assertIn("localStorage.getItem('wl_codes_v1'", source)
        self.assertIn("data-hwr-my-schedule", source)
        self.assertIn("내 종목 다음 주 일정", source)
        func_start = source.index('function loadMyWatchlistSchedule')
        func_end = source.index('function scheduleList')
        body = source[func_start:func_end]
        self.assertIn('mount.hidden = true', body)
        self.assertIn('mount.hidden = false', body)
        style = self.read("css/home-weekly-report.css")
        self.assertIn('.hwr-my-schedule', style)
        self.assertIn('.hwr-schedule-market--mine', style)

    def test_closed_weekly_report_places_schedule_under_closed_page_and_removes_source_note(self):
        source = self.read("js/home-weekly-report.js")
        schedule = '<article class="hwr-schedule"><div class="hwr-card-title"><strong>다음 주 핵심 스케줄</strong>'
        self.assertNotIn('class="hwr-source-note"', source)
        self.assertIn('금~일 날짜별 주요 뉴스 · 한국·미국 통합', source)
        self.assertIn(schedule, source)
        self.assertLess(source.index(schedule), source.index("+ indexSummary(indices)"))

    # 2026-08-30: 첫 페인트를 최대 800ms 가리던 `visibility: hidden` 가드를 제거했다.
    # 파서 CSS는 어차피 렌더 블로킹이라 무스타일 페인트가 안 나고, JS 주입 위젯 CSS는
    # 가드가 열린 뒤에 도착해 애초에 막지 못했다. 되살아나지 않도록 고정한다.
    def test_initial_paint_guard_no_longer_hides_the_page(self):
        source = self.read("skin.html")
        self.assertIn('id="initial-paint-guard"', source)
        # 배경색 지정은 첫 페인트 색 튐 방지용으로 남긴다.
        self.assertIn('html, html body { background: rgb(255, 254, 252); }', source)
        # 주석에 옛 규칙을 인용해 두었으므로 실제 선언 형태로만 검사한다.
        self.assertNotIn('visibility: hidden !important; opacity: 0;', source)
        self.assertNotIn('window.setTimeout(reveal, 800)', source)
        # 클래스 자체는 style.css의 배경 토큰 확정에 쓰이므로 계속 붙인다.
        self.assertIn("document.documentElement.classList.add('skin-ready')", source)

    def test_live_github_assets_do_not_hide_the_page_either(self):
        style = self.read("style.css")
        main = self.read("js/skin-main.js")
        self.assertNotIn('html:not(.skin-ready) body { visibility: hidden; }', style)
        self.assertNotIn('window.setTimeout(reveal, 800)', main)
        self.assertIn("document.documentElement.classList.add('skin-ready')", main)

    def test_widgets_guard_their_own_unstyled_paint_instead(self):
        """가드를 없앤 대신 무스타일 페인트는 위젯별로 막는다."""
        weekly = self.read("js/home-weekly-report.js")
        # 자기 CSS가 도착한 뒤에 본문을 그린다.
        self.assertIn('whenStyleReady', weekly)
        # 그래도 남는 경우를 대비해 SVG에 최종 색을 프레젠테이션 속성으로 같이 박는다.
        self.assertIn('fill="none" stroke="', weekly)

    def test_analysis_rank_filters_are_grouped_by_parent_domain(self):
        source = self.read("js/foreign-flow.js")
        style = self.read("css/foreign-flow.css")
        self.assertIn("FLOW_META", source)
        self.assertIn("차트 흐름별 탐색", source)
        self.assertIn("업종별 보기", source)
        self.assertIn("SIGNAL_PAGE_SIZE = 24", source)
        self.assertIn("FLOW_SORT_META", source)
        self.assertIn("renderIndustryView", source)
        self.assertIn("data-flow", source)
        self.assertIn(".ff-flow-grid", style)
        self.assertIn(".ff-flow-row", style)
        self.assertIn("@media (max-width: 420px)", style)

    def test_pattern_scan_exposes_exact_conditions_and_common_filters(self):
        source = self.read("js/pattern-scan.js")
        style = self.read("css/pattern-scan.css")
        backend = self.read("scripts/cloud-vm/pattern_detect.py")
        self.assertIn("var COMMON_SEARCH_DESC = '검색기 공통: 시가총액 3,000억원 이상", source)
        for text in (
            "최근 20봉에서 좌우 2봉",
            "224일선 ±3%",
            "10~45봉 간격",
            "어깨-머리-어깨",
            "RSI(14) 35~65",
            "고점 직전 25봉 안 저점 대비 종가가 15% 이상",
        ):
            self.assertIn(text, source)
        self.assertIn("COMMON_MARKET_CAP_MIN_EOK = 3000.0", backend)
        self.assertIn("require_common_market_cap=True", self.read("scripts/cloud-vm/daily_scan.py"))
        self.assertIn("require_common_market_cap=True", self.read("scripts/cloud-vm/rescan_patterns.py"))
        self.assertIn(".ps-tab-desc-divider", style)

    def test_pattern_scan_chart_always_shows_standard_price_moving_averages(self):
        source = self.read("js/pattern-scan.js")
        style = self.read("css/pattern-scan.css")
        self.assertIn("var MA_COLORS = { ma5: '#d24f45', ma20: '#1261c4', ma60: '#0ca678' };", source)
        for token in ("label: '5일선'", "label: '20일선'", "label: '60일선'", "label: '224일선'"):
            self.assertIn(token, source)
        self.assertIn("standardMovingAverageStudies().forEach(function (study)", source)
        self.assertIn("if (study.period === 224) ma224Series = series;", source)
        self.assertIn("lineWidth = period === 224 ? 3 : 1", source)
        self.assertIn("ps-moving-average-legend", source)
        self.assertIn("#pattern-scan .ps-moving-average-legend", style)
        self.assertIn("html.dark #pattern-scan .ps-ma224", style)

    def test_existing_urls_are_preserved(self):
        source = self.read("js/skin-menu.js")
        for url in (
            "/page/foreign-flow",
            "/page/stock-search",
            "/page/pattern-scan",
            "/page/stock-calendar",
        ):
            self.assertIn(url, source)

    def test_stock_calendar_defaults_to_today_with_date_picker(self):
        source = self.read("js/stock-calendar.js")
        home = self.read("js/skin-main.js")
        style = self.read("css/stock-calendar.css")
        self.assertIn("function dateKey(date)", source)
        self.assertIn("function renderMonthCalendar(state)", source)
        self.assertIn("function renderSchedule(state, loading)", source)
        self.assertIn("오늘의 일정", source)
        self.assertIn("달력에서 날짜를 선택할 수 있습니다.", source)
        self.assertIn("data-calendar-date", source)
        self.assertIn("data-calendar-action=\"previous\"", source)
        self.assertIn("data-calendar-action=\"next\"", source)
        self.assertIn("data-calendar-action=\"today\"", source)
        self.assertIn("function loadMonth(year, month, selected)", source)
        self.assertNotIn('id="scSearch"', source)
        self.assertNotIn("연간 일정", source)
        self.assertIn("eventText = meta.text", source)
        self.assertIn("function stockCodeFor(event, stockName)", source)
        self.assertIn("function usCompanyNameFor(ev, meta)", source)
        self.assertIn("sc-ev-symbol", source)
        self.assertIn("function upsertStoredCalendarEvents(incoming)", source)
        self.assertIn("function kstDateKey(value)", source)
        self.assertIn("function usDateLabel(ev)", source)
        self.assertIn("timeZone: 'Asia/Seoul'", source)
        self.assertIn("calendar-events:v3", source)
        self.assertIn("calendarEventKey(event)", source)
        self.assertIn("var symbol = String(event && event.symbol || '').trim();", source)
        self.assertIn("var code = meta.isStock ? stockCodeFor(ev, meta.stockName) : null;", source)
        self.assertIn("data-stock-search-code", source)
        self.assertIn("stockSearchUrl = '/page/stock-search?code='", source)
        self.assertIn("function isUsStockEvent(ev, meta)", source)
        self.assertIn("실적공시 완료", source)
        self.assertIn("function stripProviderLabel(rawTitle)", source)
        self.assertNotIn("자동(DART)", source)
        self.assertNotIn("미국(Finnhub)", source)
        self.assertIn("ev.result", source)
        self.assertIn(".sc-layout", style)
        self.assertIn(".sc-cal-today", style)
        self.assertIn("--sc-accent: #2f5d7c;", style)
        self.assertIn("border: 1px solid var(--sc-accent-border);", style)
        for old_indigo in ("#6366f1", "#4f46e5", "#4338ca", "#eef2ff", "#e0e7ff", "#c7d2fe"):
            self.assertNotIn(old_indigo, style)
        self.assertIn(".sc-ev-stock-link", style)
        self.assertIn(".sc-today-head", style)
        self.assertIn("stock-calendar.js?v=20260828-home-cache-v1", home)
        self.assertIn("function homeKstDayStart(value)", home)

    def test_lightweight_charts_uses_v5_api_across_chart_modules(self):
        files = (
            "js/domestic-market-indicators.js",
            "js/foreign-flow.js",
            "js/kospi-futures.js",
            "js/overnight-market.js",
            "js/pattern-scan.js",
            "js/quick-indices.js",
            "js/stock-search.js",
        )
        for filename in files:
            source = self.read(filename)
            self.assertIn("lightweight-charts@5.2.0", source, filename)
            self.assertNotRegex(source, r"add(?:Line|Area|Candlestick|Histogram)Series\(")
        self.assertIn("createSeriesMarkers(candleSeries, markers)", self.read("js/pattern-scan.js"))

    def test_earnings_calendar_allows_supported_tistory_origins(self):
        source = self.read("scripts/cloud-vm/main.py")
        self.assertIn("ALLOWED_BROWSER_ORIGINS = [", source)
        self.assertIn("'https://ghlee.tistory.com'", source)
        self.assertIn("'https://goodbyestarwars.tistory.com'", source)
        self.assertIn("allow_origins=ALLOWED_BROWSER_ORIGINS", source)

    def test_widget_roots_restore_keep_all_line_breaking(self):
        """티스토리 .contents_style이 word-break: break-word로 덮어써서 위젯 안의 한글
        단어와 숫자가 토큰 중간에서 갈라졌다(2026-09-01 사용자 리포트).

        자손 선택자까지 있어야 한다 - 루트에만 걸면 티스토리가 td를 직접 겨냥하는
        규칙에 져서 표 셀이 그대로 갈라진다(운영 페이지 실측으로 확인).
        """
        css = self.read("css/ui-system.css")
        self.assertIn("word-break: keep-all;", css)
        for root in ("#stock-search", "#foreign-flow", "#kospi-futures",
                     "#domestic-market-indicators", "#order-book", "#market-temp"):
            self.assertIn(root + ", " + root + " *", css,
                          "%s 루트와 자손이 모두 지정돼야 한다" % root)
        # overflow-wrap을 위젯 전체에 켜면 좁은 칸에서 숫자가 다시 갈라진다.
        self.assertNotIn("#stock-search *,\n  overflow-wrap", css)
        # 산문 블록은 긴 URL을 끊을 수 있어야 한다.
        self.assertIn(".discussion-item-body", css)
        self.assertIn("overflow-wrap: break-word;", css)

    def test_strategy_search_distinguishes_scan_time_from_live_price(self):
        """차트검색 리스트는 하루 1회 스캔 결과인데 열 이름만 `현재가`였다
        (2026-09-01 사용자 리포트: "실시간 가격을 반영해?? 신뢰할 수 있겠어?").

        js/foreign-flow.js가 같은 리포트를 받고 쓴 방식대로 가격·등락률만 실시간으로
        덮어쓰되, 도착 전·실패 시에는 스캔 시점 값임을 밝혀야 한다 - 값을 못 갱신하는
        것보다 어느 시점 값인지 모르는 게 더 나쁘다.
        """
        source = self.read("js/strategy-search.js")
        self.assertIn("function patchLivePrices(", source)
        self.assertIn("'?codes=' +", source)
        # 렌더 분기마다 부르지 않고 한 겹 감싸야 새 카테고리에서 빠지지 않는다.
        self.assertIn("renderCardsInner(container);", source)
        self.assertIn("patchLivePrices(container);", source)
        # 스캔 시점 값을 실시간인 척 보여주지 않는다.
        self.assertIn("스캔 시점", source)
        self.assertIn("is-scan", source)
        self.assertIn("실시간 시세를 불러오지 못해", source)
        # 표와 카드 두 마크업 모두 갱신 대상이어야 한다.
        self.assertIn(".ss-col-price", source)
        self.assertIn(".ss-row-quote", source)
        # 점수·순위는 스캔 기준이 맞는 값이라 건드리지 않는다.
        self.assertIn("순위·전략 지표·재무는 스캔 시점 기준", source)

        # renderCards는 탭 전환뿐 아니라 ETF 검색창 입력 한 글자마다 다시 그린다
        # (applyEtfSearch). 그대로 두면 타이핑마다 GAS를 부른다 - 캐시·디바운스로 막는다.
        self.assertIn("LIVE_QUOTE_TTL_MS", source)
        self.assertIn("LIVE_QUOTE_DEBOUNCE_MS", source)
        self.assertIn("clearTimeout(liveQuoteTimer)", source)
        # 늦게 온 응답이 최신 화면을 덮어쓰지 않아야 한다.
        self.assertIn("seq !== liveQuoteSeq", source)

        css = self.read("css/strategy-search.css")
        # 값이 같을 때 빈 줄이 남지 않아야 한다.
        self.assertIn(".ss-price-basis:empty", css)
        self.assertIn(".ss-row-basis-tag:empty", css)
        # 스캔 값일 때는 색으로도 구분한다.
        self.assertIn(".ss-col-price.is-scan .ss-price-basis", css)

    def test_home_realtime_board_stock_cell_stays_on_one_line_on_mobile(self):
        """홈 실시간 종목판에서 번호·로고·종목명이 각각 다른 줄로 쪼개졌다
        (2026-09-01 사용자 리포트, 국내·미국 탭 모두).

        전역 `.hrt-stock { display: flex }`가 모바일 홈에서는 td를 직접 겨냥하는
        규칙에 특이도로 져서 table-cell이 되고, 인라인 <a> 안에 블록 자식이 있어
        줄이 강제로 쪼개졌다. td를 flex로 되돌리면 종목 열이 170px→8px로 무너지므로
        (table-layout: fixed의 열 계산에서 셀이 빠진다) 셀은 table-cell로 두고
        줄바꿈 원인만 없앤다.
        """
        css = self.read("style.css")
        home = "body#tt-body-index .home-editorial-page .home-realtime-board"
        # 셀을 flex로 되돌리지 않는다 - 열 붕괴를 부른다.
        self.assertNotIn(home + " .hrt-stock {\n    display: flex", css)
        # 한 줄 유지 + 인라인 <a> 안의 블록 자식이 줄을 쪼개지 않게 한다.
        self.assertIn("white-space: nowrap;", css)
        self.assertIn(home + " .hrt-stock a {", css)
        self.assertIn(home + " .hrt-stock > * {", css)
        # 이름 위 / 티커 아래 배치는 유지돼야 한다.
        self.assertIn(".hrt-stock strong { display: block;", css)
        self.assertIn(".hrt-stock small { display: block;", css)
        # 데스크톱은 기존 flex 레이아웃 그대로 둔다.
        self.assertIn(".hrt-stock { display: flex;", css)

    def test_market_temp_industry_top_is_readable_at_a_glance(self):
        """증시온도 업종 TOP이 직관적이지 않다는 리포트(2026-09-01)로 손본 것들.

        고친 문제: ① 제목이 "TOP 10" 고정인데 실제로는 8개만 나왔다 ② 순위 번호가
        없었다 ③ 거래대금에 등락 방향색이 칠해져 "파란 거래대금 = 나쁨"으로 읽혔다
        ④ 조/억이 섞여 크기 비교가 안 됐다 ⑤ 순위 변화 `▲ 2`가 바로 옆 등락률의
        ▲와 같은 기호라 "2% 상승"으로 읽혔다.
        """
        source = self.read("js/market-temp.js")
        # ① 제목은 실제로 보여주는 개수를 쓴다. 과거 버그를 설명하는 주석에도 같은
        # 문구가 남아 있으므로 렌더링 문자열만 겨냥한다.
        self.assertNotIn("<strong>오늘 업종 TOP 10</strong>", source)
        self.assertIn("'오늘 업종 TOP ' + shown.length", source)
        # ② 순위 번호.
        self.assertIn("mt-if-rank", source)
        # ④ 거래대금 비중은 칸을 채우는 색으로 보여준다(2026-09-01 "칸 자체에 색이
        # 입혔으면 좋겠어").
        self.assertIn("mt-if-fill", source)
        self.assertIn("maxAmount", source)
        # 데이터원: 예전 경로(market-board 상위 30종목)는 절반 이상이 ETF라 테마가
        # 8개뿐이었다. VM이 238종목으로 집계한 값을 먼저 쓰고 실패 시에만 폴백한다.
        self.assertIn("https://goodbyestar.cloud/industry-flow", source)
        self.assertIn("INDUSTRY_FLOW_FALLBACK_URL", source)
        self.assertIn("loadIndustryFlowFromBoard_", source)
        # 대표 종목 3개는 매수 참고용으로 너무 적었다.
        self.assertIn("REPRESENTATIVE_STOCK_LIMIT_ = 8", source)
        self.assertNotIn("row.stocks.slice(0, 3)", source)
        # 각주가 바뀐 데이터원을 반영해야 한다(예전 문구가 남으면 사실과 달라진다).
        self.assertNotIn("실시간 종목판의 거래대금 상위 종목을 테마별로 합산합니다", source)
        # ⑤ 순위 변화는 등락률과 다른 기호를 쓴다.
        self.assertIn("계단", source)
        self.assertNotIn("'▲ ' + (old.rank", source)

        css = self.read("css/market-temp.css")
        # ③ 방향색은 등락률에만. 거래대금(첫 span)에 칠하던 예전 규칙이 남으면 안 된다.
        self.assertNotIn(".mt-industry-flow-row.is-up > span:first-of-type", css)
        self.assertIn(".mt-industry-flow-row.is-up .mt-if-rate", css)
        self.assertIn(".mt-if-amount", css)
        # 모바일 그리드 열 수가 데스크톱과 달라지면 항목이 넘쳐 행이 두 줄로 접힌다
        # (실제로 그렇게 깨졌다).
        flow_grids = re.findall(
            r"\.mt-industry-flow-columns[^{}]*\.mt-industry-flow-row[^{}]*\{[^{}]*?"
            r"grid-template-columns:([^;]+);",
            css,
        )
        self.assertTrue(flow_grids, "업종 흐름 그리드를 찾지 못했다")
        for grid in flow_grids:
            # minmax(0, 1.3fr) 안의 공백 때문에 열 수를 잘못 세지 않도록 괄호 안을 지운다.
            columns = re.sub(r"\([^)]*\)", "()", grid).split()
            self.assertEqual(len(columns), 5,
                             "업종 흐름 그리드는 5열이어야 한다: %s" % grid.strip())

    def test_order_book_summary_values_fit_on_narrow_mobile(self):
        """운영 모바일 본문 폭(321px)에서 시가·고가·저가·거래량이 칸보다 3~4px 넓어
        말줄임으로 끝 글자가 잘렸다("256,500원" -> "256,500…").

        값을 줄이거나 3열을 무너뜨리지 않고 여백만 좁혀 자리를 만든 변경이라,
        3열 배치와 말줄임 설정 자체는 그대로 남아 있어야 한다.
        """
        css = self.read("css/order-book.css")
        self.assertIn("grid-template-columns: repeat(3, minmax(0, 1fr));", css)
        self.assertIn("text-overflow: ellipsis;", css)
        self.assertIn("@media (max-width: 420px)", css)
        narrow = css[css.index("@media (max-width: 420px)"):]
        self.assertIn("#order-book .ob-summary {", narrow)
        self.assertIn("#order-book .ob-summary-item {", narrow)
        self.assertIn("padding-left: 6px;", narrow)

    def test_home_us_index_strip_switches_to_futures_when_cash_market_is_closed(self):
        """미국 상단 지수 스트립이 "표현만 되는" 상태로 남지 않게 한다.

        나스닥·S&P500 현물은 한국시간 22:30~05:00에만 움직인다. 그 밖의 시간에
        미국증시 탭을 열면 전날 종가가 굳어 있는 카드를 계속 보게 된다(2026-09-04
        사용자 지적). 본장이 닫혀 있고 지수선물이 열려 있으면 이미 수집 중인
        나스닥100·S&P500 선물로 바꿔 실제로 움직이는 값을 보여준다.

        심볼이 바뀌어도 나머지 미국 화면(요약 카드·환율·투자자 동향)이 국내 화면으로
        되돌아가지 않아야 하므로, 미국 세션 판별은 keys[0]가 아니라 session.market이다.
        """
        main = self.read("js/skin-main.js")
        self.assertIn("function usFuturesSessionOpen(now)", main)
        self.assertIn("function usIndexSessionState(now)", main)
        self.assertIn("keys: ['NASDAQ100', 'SP500']", main)
        # 미국 여부 판정이 상단 스트립 심볼에 묶여 있으면 선물 전환과 함께 깨진다.
        self.assertNotIn("keys[0] === 'NASDAQ_INDEX'", main)
        self.assertNotIn("nextKey !== 'NASDAQ_INDEX|SP500_INDEX'", main)
        self.assertIn("market: 'us',", main)
        self.assertIn("market: 'domestic',", main)
        self.assertIn("session.market === 'us'", main)
        # 카드 상태 문구는 현물/선물/휴장이 서로 달라야 하므로 세션이 들고 다닌다.
        self.assertIn("session.statusLabel || '장중'", main)
        # 심볼이 그대로여도 세션 상태가 바뀌면 부제를 갱신한다.
        self.assertIn("var sessionSignature = session.keys.join('|') + '·'", main)
        # QuickIndices가 없는 페이지의 폴백 요청에도 선물 심볼이 들어가야 한다.
        self.assertIn("NASDAQ100%2CSP500%2CKOSPI200_NIGHT", main)

    @unittest.skipUnless(shutil.which("node"), "node가 없으면 건너뛴다")
    def test_us_index_session_boundaries(self):
        """세션 경계를 실제로 실행해 확인한다(ET 기준, 서머타임은 Intl이 처리).

        CME 주가지수 선물은 일요일 18:00에 열려 금요일 17:00에 닫히고 매일
        17:00~18:00를 쉰다. 현물 본장은 평일 09:30~16:00다.
        """
        main = self.read("js/skin-main.js")
        start = main.index("    function nyClockParts(now) {")
        end = main.index("    // 코스피 야간선물은 국내 거래소 휴장일에는")
        script = main[start:end] + """
const cases = JSON.parse(process.argv[2]);
console.log(JSON.stringify(cases.map(function (iso) {
  const state = usIndexSessionState(new Date(iso));
  return [state.source, state.statusLabel];
})));
"""
        # 2026년 미국 서머타임(3/8~11/1) 안이라 ET = UTC-4.
        cases = [
            "2026-09-04T17:00:00Z",  # 금 13:00 ET - 본장 장중
            "2026-09-04T10:05:00Z",  # 금 06:05 ET - 본장 마감 전, 선물 거래중
            "2026-09-04T21:30:00Z",  # 금 17:30 ET - 선물 주간 마감(현물은 당일 본장 마감)
            "2026-09-06T21:00:00Z",  # 일 17:00 ET - 아직 닫힘
            "2026-09-06T23:00:00Z",  # 일 19:00 ET - 선물 개장
            "2026-09-08T21:30:00Z",  # 화 17:30 ET - 일일 휴식 1시간
        ]
        with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as handle:
            handle.write(script)
            path = handle.name
        try:
            output = subprocess.check_output(["node", path, json.dumps(cases)], text=True)
        finally:
            os.unlink(path)
        self.assertEqual(json.loads(output), [
            ["spot", "장중"],
            ["futures", "선물 거래중"],
            ["spot", "본장 마감"],
            ["spot", "미국장 휴장"],
            ["futures", "선물 거래중"],
            ["spot", "본장 마감"],
        ])



if __name__ == "__main__":
    unittest.main()
