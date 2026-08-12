import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class UiInformationArchitectureTest(unittest.TestCase):
    def read(self, relative):
        return (ROOT / relative).read_text(encoding="utf-8")

    def test_primary_navigation_has_six_items(self):
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
        self.assertIn("{ href: '/page/stock-search', label: '실시간 시세' }", source)
        self.assertEqual(source.count("      label: '종목검색',"), 1)
        self.assertNotIn("label: '종목뉴스'", source)
        self.assertNotIn("{ href: '/page/watchlist', label: 'MY' }", source)
        self.assertNotIn("label: '미국주식'", source)
        self.assertEqual(len(primary_labels), 6)

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
        self.assertIn("{ href: '/page/stock-search', label: '실시간 시세' }", body)
        search_group = re.search(
            r"\{\n\s+label: '종목검색',\n\s+children: \[(?P<body>.*?)\n\s+\]\n\s+\},",
            source,
            re.DOTALL,
        )
        self.assertIsNotNone(search_group)
        search_body = search_group.group("body")
        self.assertIn("{ href: '/page/pattern-scan', label: '차트검색' }", search_body)
        self.assertIn("{ href: '/page/strategy-search', label: '전략검색' }", search_body)

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
        self.assertIn("한국·미국 종목명 또는 코드", realtime)
        for source in (panel, realtime, self.read("js/us-stocks.js")):
            self.assertIn("symbol: 'TSLA'", source)
            self.assertIn("aliases: '테슬라 tesla'", source)
            self.assertIn("symbol: 'SPCX'", source)
            self.assertIn("aliases: '스페이스X spacex'", source)
        self.assertIn("return localRows.concat(rows)", panel)
        self.assertIn("return localRows.concat(rows)", realtime)
        self.assertIn("return localRows.concat(rows)", self.read("js/us-stocks.js"))

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
        style = self.read("style.css")
        self.assertIn('class="hen-time"', news)
        self.assertIn("function periodKey(value)", news)
        self.assertIn("limit=50", news)
        self.assertIn("slice(0, 50)", news)
        self.assertIn('class="hen-periods"', news)
        self.assertIn("renderPeriod('pm', '오후')", news)
        self.assertIn("renderPeriod('am', '오전')", news)
        self.assertIn("is-latest", news)
        self.assertNotIn("hen-zigzag", news)
        self.assertIn("v=20260811-am-pm-scroll", main)
        self.assertIn(".hen-periods", style)
        self.assertIn("max-height: 340px", style)
        self.assertNotIn(".hen-periods { display: grid", style)
        self.assertIn(".hen-period-list", style)
        self.assertIn("overflow-y: auto", style)
        self.assertIn("scrollbar-width: none", style)
        self.assertIn(".hen-periods::-webkit-scrollbar", style)
        self.assertIn(".home-economic-news .hen-row .hen-time", style)
        self.assertIn(".hen-rail::before", style)
        self.assertIn("transform: translateX(-50%)", style)
        self.assertIn("display: block !important", style)
        self.assertIn("visibility: visible !important", style)
        self.assertIn('.hmb-list dd[title] { cursor: help; }', style)

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

    def test_watchlist_refreshes_us_quotes_without_reopening_drawer(self):
        source = self.read("js/watchlist.js")
        bootstrap = self.read("js/stock-search-panel.js")
        self.assertIn("watchlist.js?v=fast-first-paint-20260812", bootstrap)
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
            r"var volumeSeries = chart\.addHistogramSeries\(\{(?P<body>.*?)\}\);",
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
        self.assertIn("querySelectorAll('.ss-volume-study-label, .ss-price-study-label, .ss-ichimoku-cloud')", source)
        self.assertIn("ss-volume-study-label", source)
        self.assertIn("전일 대비", source)
        self.assertIn("formatSignedPercent", source)
        self.assertIn("drawTicks: false", source)
        self.assertIn(".ss-volume-study-label", style)
        self.assertIn("top: 70%", style)

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
        self.assertIn(".ss-ichimoku-cloud", style)
        self.assertIn(".ss-price-study-label", style)
        self.assertIn(".ss-chart { position: relative; height: 420px; }", style)

    def test_us_stock_detail_uses_site_font_and_consistent_type_scale(self):
        source = self.read("js/us-stocks.js")
        search = self.read("js/stock-search.js")
        style = self.read("css/us-stocks.css")
        self.assertIn("us-stocks.css?v=20260811-font-scale", source)
        self.assertIn("us-stocks.js?v=20260811-auto-icon-fallback", search)
        self.assertIn("font-family: inherit", style)
        for token in (
            ".us-stocks-metric span { color: #8b95a1; font-size: 12px;",
            ".us-stocks-metric b { margin-top: 4px; font-size: 15px;",
            ".us-stocks-panel-head h4 { margin: 0; font-size: 16px;",
            ".us-stocks-news-time { display: block; margin-bottom: 3px; color: #f97316; font-size: 12px;",
        ):
            self.assertIn(token, style)

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
        self.assertIn("color: 'rgba(18,97,196,0)'", source)
        self.assertIn("createIchimokuCloudPrimitive(bandPts, 'rgba(18,97,196,0.16)')", source)
        self.assertIn("var volumeSeries = chart.addHistogramSeries", source)
        self.assertIn("priceFormat: { type: 'volume' }", source)
        self.assertIn("movingAverageChartPoints(daily, 'volume', 20)", source)
        self.assertIn(".ff-volume-study-label", style)
        self.assertIn(".ff-chart-candle::after", style)

    def test_pattern_scan_includes_ma_cloud_breakout_search(self):
        source = self.read("js/pattern-scan.js")
        self.assertIn("key: 'maCloudBreakout'", source)
        self.assertIn("label: '이평 상승 초입형'", source)
        self.assertIn("최근 5봉 안에 5일선이 20일선을 상향돌파", source)
        self.assertIn("addMaLine(chart, daily, 224, MA224_EARLY_COLOR)", source)
        self.assertIn("psIchimokuEnabled = activeTab === 'maCloudBreakout'", source)

    def test_box_range_detail_prefers_vm_snapshot_with_market_cap_filter(self):
        source = self.read("js/pattern-scan.js")
        self.assertIn("최근 20봉 종가 변동폭 10% 이하", source)
        self.assertIn("시가총액 3,000억원 이상", source)
        self.assertIn("activeTab === 'boxRangeLow' || activeTab === 'openingGap'", source)
        self.assertNotIn("slice(0, 12)", source)
        self.assertIn("data.detail = item.patternDetail", source)

    def test_chart_search_includes_opening_gap_tab(self):
        source = self.read("js/pattern-scan.js")
        self.assertIn("key: 'openingGap'", source)
        self.assertIn("label: '시초 갭상승'", source)

    def test_strategy_search_renders_weekly_envelope_metric(self):
        source = self.read("js/strategy-search.js")
        self.assertIn("it.envelope", source)
        self.assertIn("엔벨로프 하단", source)

    def test_strategy_search_renders_opening_gap_metric(self):
        source = self.read("js/strategy-search.js")
        self.assertIn("it.gapRatePct", source)
        self.assertIn("시초갭", source)
        self.assertIn("fmtMillion(it.turnoverMillion)", source)

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
        self.assertIn("home_disclosures_v1", widgets)
        self.assertIn("readTimedCache", widgets)

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
        self.assertIn("var symbol = String(event && event.symbol || '').trim();", source)
        self.assertIn("var code = stockCodeFor(ev, meta.stockName);", source)
        self.assertIn("실적발표 완료", source)
        self.assertIn("ev.result", source)
        self.assertNotIn("renderPage(year, month, monthEvents, undefined, [], true);", source)
        self.assertIn("1.1~12.31", source)
        self.assertIn("검색 결과 ' + visibleEvents.length + '건", source)
        self.assertIn(".sc-search input", style)
        self.assertIn("stock-calendar.js?v=20260812-dart-result", home)

    def test_earnings_calendar_allows_supported_tistory_origins(self):
        source = self.read("scripts/cloud-vm/main.py")
        self.assertIn("ALLOWED_BROWSER_ORIGINS = [", source)
        self.assertIn("'https://ghlee.tistory.com'", source)
        self.assertIn("'https://goodbyestarwars.tistory.com'", source)
        self.assertIn("allow_origins=ALLOWED_BROWSER_ORIGINS", source)


if __name__ == "__main__":
    unittest.main()
