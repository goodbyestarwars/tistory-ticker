import pathlib
import re
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

    def test_domestic_market_indicators_labels_and_provider_contract(self):
        frontend = self.read("js/domestic-market-indicators.js")
        backend = self.read("scripts/cloud-vm/domestic_market_indicators.py")
        style = self.read("css/domestic-market-indicators.css")
        self.assertIn("코스피 · 코스닥 주간현물 (09:00~15:45)", frontend)
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
        self.assertIn(".dmi-shell .dmi-fund-card *", style)
        self.assertIn("domestic-market-indicators.css?v=20260815-mobile-layout", frontend)
        self.assertIn("function fundSeriesValues(funds, field)", frontend)
        self.assertIn("function miniAverageChart(values, average)", frontend)
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
        self.assertIn(".dmi-chart-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));", style)
        self.assertIn(".dmi-panel { border: none;", style)
        # 2026-08-14 요청: 증시자금 6개 카드를 2열 대신 3열로.
        self.assertIn(".dmi-fund-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));", style)
        self.assertIn(".dmi-chart { position: relative; height: 330px;", style)
        self.assertIn(".dmi-chart-grid { grid-template-columns: 1fr; gap: 14px; }", style)
        self.assertIn(".dmi-chart { height: 330px; min-height: 330px;", style)
        self.assertIn(".dmi-subheading h3,", style)
        self.assertNotIn("dmi-funds-provider", frontend)
        self.assertNotIn("dmi-funds-provider", style)
        self.assertNotIn('class="dmi-provider"', frontend)
        self.assertNotIn("분봉 · 일봉 · 주봉", frontend)
        backend = self.read("scripts/cloud-vm/domestic_market_indicators.py")
        self.assertIn("CHART_LOOKBACK_DAYS = 250", backend)
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
        self.assertIn("#kospi-futures .kf-chart { height: 330px !important; }", futures_style)
        self.assertIn("var CHART_HEIGHT = 330;", futures_script)
        self.assertIn('data-section-key="ai"]', futures_css)
        self.assertIn(".kf-chart-grid", futures_css)
        self.assertIn("grid-template-columns: repeat(2, minmax(0, 1fr));", futures_css)
        self.assertIn(".de-chart-control-row .de-expand-button.de-expand-inline", futures_style)
        self.assertIn("de-stock-search-scope", futures_style)
        self.assertIn("stockScope.style.flex = '1 1 100%'", enhancements)
        self.assertIn("dmi-draw-toggle", frontend)
        overnight = self.read("js/overnight-market.js")
        self.assertIn('class="om-ai-icon"', overnight)
        self.assertIn('class="kf-ai-icon"', futures_script)
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

    def test_us_home_cards_use_spot_index_products_explicitly(self):
        main = self.read("js/skin-main.js")
        indices = self.read("js/quick-indices.js")
        self.assertIn("keys: ['NASDAQ_INDEX', 'SP500_INDEX']", main)
        self.assertIn("labels: ['나스닥', 'S&P500']", main)
        self.assertIn("미국 현물 지수 확인 중", main)
        self.assertNotIn("live: '나스닥100 선물 · S&P500 선물'", main)
        self.assertIn("label: '나스닥100 선물'", indices)

        self.assertIn(".concat(['NASDAQ_INDEX', 'SP500_INDEX'])", indices)
        self.assertIn("quick_indices_futures_v2", indices)

    def test_home_realtime_table_fills_missing_stock_icons(self):
        source = self.read("js/home-realtime-table.js")
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
        self.assertIn("object-fit: contain", self.read("style.css"))

    def test_home_realtime_table_uses_correct_won_trillion_unit(self):
        source = self.read("js/home-realtime-table.js")
        self.assertIn("1조 = 1,000,000,000,000원(10^12)", source)
        self.assertIn("parsed >= 1000000000000", source)
        self.assertIn("parsed / 1000000000000", source)
        self.assertNotIn("parsed / 100000000000).toFixed", source)

    def test_home_realtime_table_reconnects_after_websocket_disconnect(self):
        source = self.read("js/home-realtime-table.js")
        main = self.read("scripts/cloud-vm/main.py")
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
            "market-board?market=us&limit=20",
            "function summarizeUsMarket(data)",
            "renderUsMarketSummary",
            "element.title = fullText",
            "element.setAttribute('aria-label', fullText)",
        ):
            self.assertIn(token, main)
        for token in (
            "todayItems.slice(0, 12)",
            "function enableScheduleDrag(list)",
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
        self.assertGreaterEqual(widgets.count("enableScheduleDrag(mount);"), 2)
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
        self.assertIn("slice(0, 50)", news)
        self.assertIn("is-latest", news)
        self.assertNotIn("hen-zigzag", news)
        self.assertIn(".app-news-event", style)
        self.assertIn(".app-news-date", style)
        self.assertIn("v=20260816-market-switch-v3", main)
        self.assertIn(".hen-breaking { flex: 0 0 auto", style)
        self.assertIn(".home-economic-news .hen-breaking-list { height: 62px", style)
        self.assertNotIn("data-hen-breaking-form", main)
        self.assertNotIn("ECONOMIC_FLASH_API_URL", news)
        self.assertIn("syncEconomicHeight", self.read("js/home-widgets.js"))
        self.assertIn("Math.abs(marketRect.top - economicRect.top) > 2", self.read("js/home-widgets.js"))
        self.assertIn(".home-widget--summary.home-economic-news { align-self: start; }", style)
        self.assertIn(".home-economic-news .hen-periods { min-height: 0; height: auto;", style)
        self.assertIn('data-hen-breaking-list', main)
        self.assertIn('function renderFlash(items)', news)
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
        self.assertIn("var ECONOMIC_NEWS_WS_URL = 'wss://goodbyestar.cloud/ws/economic-news';", news)
        self.assertIn("function connectNewsSocket()", news)
        self.assertIn("function applyNewsPayload(payload)", news)
        self.assertIn("@app.websocket('/ws/economic-news')", vm)
        self.assertIn("async def _economic_news_broadcast_loop():", vm)
        self.assertIn("asyncio.to_thread(_fetch_economic_news_snapshot, market)", vm)
        self.assertIn("domestic_news.get_disclosures(limit=100)", vm)
        self.assertIn("_FLASH_MACRO_RULES", vm)
        self.assertIn("transform: translateX(-50%)", style)
        self.assertIn("display: block !important", style)
        self.assertIn("visibility: visible !important", style)
        self.assertIn('.hmb-list dd[title] { cursor: help; }', style)

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
        license_page = self.read("legal/opensource-license.html")
        self.assertIn("나눔고딕 (Nanum Gothic)", license_page)
        self.assertIn("hangeul.naver.com/download", license_page)
        self.assertNotIn("Pretendard Variable", license_page)

    def test_mobile_app_bottom_navigation_is_available_without_skin_redeployment(self):
        menu = self.read("js/skin-menu.js")
        style = self.read("style.css")
        for token in (
            "mobileAppBottomNav",
            "mobileAppSheet",
            "mobileBottomActiveKey",
            "data-bottom-action=\"more\"",
            "/page/stock-calendar",
            "/pages/overnight-market",
            "/pages/kospi-futures",
        ):
            self.assertIn(token, menu)
        for token in (
            ".mobile-app-bottom-nav",
            "grid-template-columns: repeat(5, minmax(0, 1fr));",
            "safe-area-inset-bottom",
            "body.iframe-mode .mobile-app-bottom-nav",
            ".page-wrap { padding-bottom:",
        ):
            self.assertIn(token, style)
        self.assertIn(":root { --topbar-height: 40px; }", style)
        self.assertIn(".sidebar-left { display: flex !important; }", style)
        self.assertIn(".sidebar-left .nav-primary-item .nav-item-label { font-size: 12px; }", style)
        self.assertIn("body { word-break: keep-all; overflow-wrap: normal; }", style)

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
        for token in ("/page/watchlist", "label: 'MY'", "data-bottom-key=\"my\""):
            self.assertIn(token, menu)
        for token in ("loadMyDashboard", "my-dashboard.js", "my-dashboard.css"):
            self.assertIn(token, main)
        for token in ("updateHolding", "setGroupCollapsed", "holding", "quantity", "averagePrice"):
            self.assertIn(token, watchlist)
        self.assertIn("/page/watchlist", bootstrap)
        for token in ("flowAiSummary", "pbar-tratio", "myStockInput", "myStockOptions", "data-my-calc=\"budget\"", "data-my-group-toggle", "groupedWatchlist", "my-volume-chart", "차트 모양 분석", "물타기 계산기", "my-position-advice", "data-my-calc-recovery", "chartNote", "arrangeAnalysisSections"):
            self.assertIn(token, my)
        self.assertNotIn("Google 계정에 저장", my)
        self.assertNotIn("Groq ·", my)
        for token in ("#my-dashboard", ".my-analysis-grid", ".my-watchlist-group-toggle", "#my-dashboard .is-up { color: #d24f45; }"):
            self.assertIn(token, my_style)

    def test_watchlist_refreshes_us_quotes_without_reopening_drawer(self):
        source = self.read("js/watchlist.js")
        bootstrap = self.read("js/stock-search-panel.js")
        self.assertIn("watchlist.js?v=20260816-my-groups-v2", bootstrap)
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
        ):
            self.assertIn(token, source)

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
            "market_temp_v6",
            "upsertDailyMarketTemp_(temp)",
            "readDailyMarketTempHistory_",
            "computeMarketTempHistory_(temp, dailyHistory)",
            "computeMarketTempSparkline_(temp, dailyHistory)",
        ):
            self.assertIn(token, gas)
        self.assertIn("if (days.length === 1)", source)
        self.assertIn("오늘부터 일별 기록을 시작했습니다.", source)
        self.assertNotIn("추이 데이터 수집 중 (며칠 후부터 표시됩니다)", source)
        self.assertNotIn("며칠 후부터 표시됩니다", source)
        self.assertIn(".mt-spark-single", style)

    def test_market_temperature_includes_kofia_credit_risk_component(self):
        gas = self.read("gas/ticker-proxy.gs")
        source = self.read("js/market-temp.js")
        self.assertIn("creditRisk: 10", gas)
        self.assertIn("function scoreKofiaCredit_(kofia)", gas)
        self.assertIn("예탁금 대비 35% 미만", gas)
        self.assertIn("key: 'creditRisk'", source)
        self.assertIn("unit: 'creditRisk'", source)
        self.assertIn("신용/예탁", source)
        self.assertIn("loan_total / 1000000", source)
        self.assertIn("investor_deposits / 1000000000000", source)

    def test_stock_search_minute_chart_shows_time_of_day(self):
        # 2026-08-05(3차) 사용자 리포트: 분봉 X축이 날짜만 반복 표시됨 - 분봉일 때만
        # timeVisible을 켜서 시:분(HH:mm)이 보이게 했다(일/주/월봉은 날짜 문자열이라 그대로).
        source = self.read("js/stock-search.js")
        self.assertIn("function lwcThemeOptions(LWC, timeframe)", source)
        self.assertIn("timeVisible: timeframe === 'minute'", source)
        self.assertIn("lwcThemeOptions(LWC, timeframe)", source)

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

    def test_order_book_renders_quote_summary_and_volume_comparison(self):
        source = self.read("js/order-book.js")
        style = self.read("css/order-book.css")
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
        self.assertIn("ICHIMOKU_CLOUD_FILL = 'rgba(135,206,235,0.24)'", source)
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
        self.assertIn("us-stocks.css?v=20260813-chart-fit-draw", source)
        self.assertIn("us-stocks.js?v=20260813-news-24h", search)
        self.assertIn("font-family: inherit", style)
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
        self.assertIn(".us-native-chart-mount .ss-chart-tabs", style)

    def test_stock_analysis_chart_matches_price_studies_and_replaces_volume_profile_with_volume(self):
        source = self.read("js/foreign-flow.js")
        style = self.read("css/foreign-flow.css")
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
        self.assertIn("movingAverageOverlaySeries.push(lineSeries)", source)
        self.assertIn("function createIchimokuCloudPrimitive(bandPts, cloudColor)", source)
        self.assertIn("ctx.fillStyle = cloudColor", source)
        self.assertIn("ICHIMOKU_CLOUD_FILL = 'rgba(135,206,235,0.24)'", source)
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
        self.assertIn('class="ff-apt-chart-wrap ff-apt-simple"', source)
        self.assertIn('data-apt-simple-current', source)
        self.assertIn('<div class="ff-extra-card-title">매물대</div>', source)
        self.assertNotIn('<div class="ff-extra-card-title">🏢 매물대</div>', source)
        self.assertIn("#foreign-flow .ff-apt-simple-row", style)
        self.assertIn("grid-template-columns: 112px minmax(100px, 1fr) 64px 94px;", style)
        self.assertIn("@media (max-width: 640px)", style)

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
        self.assertIn("label: '이평 상승 초입형'", source)
        self.assertIn("최근 5봉 안에 5일선이 20일선을 상향돌파", source)
        self.assertIn("addMaLine(chart, daily, 224, MA224_EARLY_COLOR)", source)
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

    def test_chart_search_includes_opening_gap_tab(self):
        source = self.read("js/pattern-scan.js")
        style = self.read("css/pattern-scan.css")
        self.assertIn("key: 'openingGap'", source)
        self.assertIn("label: '시초 갭상승'", source)
        self.assertIn("grid-template-columns: repeat(2, minmax(0, 1fr));", style)
        self.assertIn("#pattern-scan .ps-name", style)
        self.assertIn("text-overflow: ellipsis;", style)

    def test_strategy_search_renders_weekly_envelope_metric(self):
        source = self.read("js/strategy-search.js")
        style = self.read("css/strategy-search.css")
        self.assertIn("it.envelope", source)
        self.assertIn("엔벨로프 하단", source)
        self.assertIn("columns: 2 150px;", style)
        self.assertIn("#strategy-search .ss-row-name", style)

    def test_strategy_search_renders_opening_gap_metric(self):
        source = self.read("js/strategy-search.js")
        self.assertIn("it.gapRatePct", source)
        self.assertIn("시초갭", source)
        self.assertIn("fmtMillion(it.turnoverMillion)", source)

    def test_strategy_search_combines_etf_return_periods(self):
        source = self.read("js/strategy-search.js")
        style = self.read("css/strategy-search.css")
        self.assertIn("normalizeScanData", source)
        self.assertIn("data.categories.etfReturn", source)
        self.assertIn("returnRate1mPct", source)
        self.assertIn("returnRate3mPct", source)
        self.assertIn("returnRate6mPct", source)
        self.assertIn("returnRate12mPct", source)
        self.assertIn("ss-etf-return-metric", source)
        self.assertIn("ss-etf-return-metric", style)
        self.assertIn("ss-return-period-tab", source)
        self.assertIn("data-return-period", source)
        self.assertIn("activeEtfPeriod", source)
        self.assertIn("sortMatches", source)
        self.assertIn("ETF_ISSUER_GROUPS", source)
        self.assertIn("groupEtfMatches", source)
        self.assertIn("{ key: 'TIGER', label: 'TIGER' }", source)
        self.assertIn("{ key: 'HANARO', label: 'HANARO' }", source)
        self.assertIn("name: '기타 ETF'", source)
        self.assertIn("ss-return-period-tabs", style)
        self.assertIn("ss-dividend-sort-btn", source)
        self.assertIn("data-dividend-sort", source)

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

    def test_home_shows_all_weekly_watchlist_disclosures(self):
        widgets = self.read("js/home-widgets.js")
        home = self.read("js/skin-main.js")
        backend = self.read("scripts/cloud-vm/main.py")
        self.assertIn("https://goodbyestar.cloud/watchlist/disclosures", widgets)
        self.assertIn("credentials: 'include'", widgets)
        self.assertIn("최근 7일 · ' + items.length + '건", widgets)
        self.assertIn("관심종목 주간 공시", widgets)
        self.assertNotIn("DISC_GAS_URL", widgets)
        self.assertNotIn("result.length < 5", widgets)
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
            "기본 카드 · 편집하면 내 카드로 분리됩니다",
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
        self.assertIn("var bullish = values.length ? values.reduce(function (sum, value) { return sum + value; }, 0) >= 0 : true;", source)
        self.assertIn('aria-label="황소장 상승"', source)
        self.assertIn('<strong>황소장 · 상승</strong>', source)
        self.assertIn('aria-label="곰장 하락"', source)
        self.assertIn('<strong>곰장 · 하락</strong>', source)
        self.assertIn('M71 61c0 9 4 14 9 14s9-5 9-14', source)
        self.assertEqual(source.count('<svg width="104" height="52" viewBox="0 0 160 82" fill="none" stroke="currentColor"'), 2)

    def test_weekly_hot_and_cold_stock_reasons_are_bold(self):
        source = self.read("js/home-weekly-report.js")
        style = self.read("css/home-weekly-report.css")
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

    def test_weekly_report_renders_forward_candidate_sections(self):
        source = self.read("js/home-weekly-report.js")
        style = self.read("css/home-weekly-report.css")
        backend = self.read("scripts/cloud-vm/main.py")
        for token in (
            'data.hotCandidates && data.hotCandidates.domestic',
            'data.coldCandidates && data.coldCandidates.domestic',
            '뜨거워질 후보', '차가워질 후보', '예측이 아니라 겹친 선행 신호 기준',
        ):
            self.assertIn(token, source)
        self.assertIn('.hwr-candidate-section .hwr-card-title strong.is-up', style)
        self.assertIn('.hwr-candidate-section .hwr-card-title strong.is-down', style)
        self.assertIn('_WEEKLY_REPORT_SNAPSHOT_VERSION = 4', backend)

    def test_existing_urls_are_preserved(self):
        source = self.read("js/skin-menu.js")
        for url in (
            "/page/foreign-flow",
            "/page/stock-search",
            "/page/pattern-scan",
            "/page/stock-calendar",
        ):
            self.assertIn(url, source)

    def test_stock_calendar_supports_searching_loaded_events(self):
        source = self.read("js/stock-calendar.js")
        home = self.read("js/skin-main.js")
        style = self.read("css/stock-calendar.css")
        self.assertIn("function eventMatchesSearch(event, query)", source)
        self.assertIn("function fetchYearEvents(year)", source)
        self.assertIn("function groupByYearMonth(events)", source)
        self.assertIn("annualSearchLoading", source)
        self.assertIn('id="scSearch"', source)
        self.assertIn("compositionstart", source)
        self.assertIn("compositionend", source)
        self.assertIn("var queryAtRequest = searchQuery", source)
        self.assertIn("event.isComposing", source)
        self.assertIn("eventText = meta.text", source)
        self.assertIn("function stockCodeFor(event, stockName)", source)
        self.assertIn("function usCompanyNameFor(ev, meta)", source)
        self.assertIn("sc-ev-symbol", source)
        self.assertIn("function upsertStoredCalendarEvents(incoming)", source)
        self.assertIn("CALENDAR_STORAGE_KEY", source)
        self.assertIn("calendarEventKey(event)", source)
        self.assertIn("var symbol = String(event && event.symbol || '').trim();", source)
        self.assertIn("var code = stockCodeFor(ev, meta.stockName);", source)
        self.assertIn("실적발표 완료", source)
        self.assertIn("ev.result", source)
        self.assertNotIn("renderPage(year, month, monthEvents, undefined, [], true);", source)
        self.assertIn("1.1~12.31", source)
        self.assertIn("검색 결과 ' + visibleEvents.length + '건", source)
        self.assertIn(".sc-search input", style)
        self.assertIn("stock-calendar.js?v=20260816-us-alias-search-v1", home)

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


if __name__ == "__main__":
    unittest.main()
