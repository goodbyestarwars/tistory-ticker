/**
 * 9bolt 스킨 사이드바 메뉴 (git 관리)
 * skin.html의 <div class="card nav-menu" id="nav-menu-mount"></div>에 메뉴를 렌더링한다.
 *
 * 메뉴 추가/수정/삭제 = 아래 MENU_ITEMS만 고쳐서 push하면 끝 (스킨 편집기 불필요).
 * 반영은 GitHub Pages 캐시 때문에 push 후 최대 10분.
 *
 * icon: 24x24 viewBox 기준 SVG 내부 마크업(패스만). stroke는 currentColor 상속.
 * iconStyle: 아이콘에 개별 색을 줄 때만 사용 (예: 온도계 빨강).
 */
(function () {
  'use strict';

  // 2026-07-27: "9Pay 증권" 개편 작업지시서 #3 - "전체 글"을 "홈"으로 개명(역할은 동일,
  // 메인 대시보드 성격 강화는 별도 후속 작업). 작업지시서의 대메뉴(홈/마켓브리핑/증시온도/
  // 증시검색/종목분석/종목뉴스/MY/커뮤니티) 중 "증시검색"(호가창+종목검색+차트 통합)과
  // "MY"(관심종목)는 아직 실제 페이지가 없어 메뉴에 추가하지 않음 - 없는 페이지로 링크를
  // 걸면 클릭 시 빈 화면만 나온다. 그 전까지 기존 "호가창" 메뉴를 그대로 유지하고, 두
  // 신규 메뉴는 해당 페이지 실제 구현 후 이 자리에 추가할 것.
  var MENU_ITEMS = [
    {
      href: '/',
      label: '홈',
      icon: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'
    },
    {
      href: '/category/마켓 브리핑',
      label: '마켓 브리핑',
      icon: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>'
    },
    {
      href: '/page/market-temp',
      label: '증시온도',
      icon: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
      iconClass: 'nav-icon-temp',
      iconStyle: 'color:#d24f45;' // 라이트=빨강, 다크모드 밝기는 스킨 CSS가 처리
    },
    // 핵심종목 히트맵(/page/marketcap-bubble) 단독 메뉴는 2026-07-16 삭제 - 증시온도
    // 페이지의 "시총비례 히트맵" 탭으로 흡수됐고 사용자가 실제 페이지도 지움(중복 제거).
    // 오늘의 투자시그널(/pages/invest-signal) 단독 메뉴는 2026-07-20 삭제 - 종목분석
    // 페이지 최상단으로 통합됐음(js/invest-signal.js는 이제 /page/foreign-flow로
    // 리다이렉트만 함) - 아래 "종목분석" 메뉴 하나로 합쳐짐.
    {
      // 2026-07-27: 작업지시서 대메뉴 순서(종목분석 -> 종목뉴스)에 맞춰 순서 교체(기능 변경 없음).
      href: '/page/foreign-flow',
      label: '종목분석',
      icon: '<path d="M7 17V7"/><path d="M4 10l3-3 3 3"/><path d="M17 7v10"/><path d="M14 14l3 3 3-3"/>'
    },
    {
      href: '/page/stock-news',
      label: '종목뉴스',
      icon: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/>'
    },
    {
      // 2026-07-27: "9Pay 증권" 개편 작업지시서 #6 - "호가창" 메뉴 자리를 "증시검색"으로
      // 대체(호가창 기능은 js/stock-search.js 안으로 병합됨, js/order-book.js는 그 안에서
      // 재사용). TODO: /page/stock-search는 실제 페이지 생성 전 placeholder URL -
      // 실제로 티스토리에 새 페이지(js/stock-search.js + css/stock-search.css +
      // <div id="stock-search"> 임베드, krx_map.js/sectors-v3.js/order-book.js를 그
      // 전에 로드)를 만든 뒤 실제 URL로 교체할 것(js/kospi-futures.js 메뉴 항목이 처음
      // 추가될 때와 동일한 패턴). 기존 "호가창" 단독 페이지(/page/order-book)는 코드는
      // 그대로 남아있으나 이 메뉴에서는 빠짐.
      href: '/page/stock-search',
      label: '증시검색',
      icon: '<circle cx="10" cy="10" r="6"/><line x1="20" y1="20" x2="14.5" y2="14.5"/>'
    },
    {
      href: '/page/pattern-scan',
      label: '차트패턴 스캐너',
      icon: '<rect x="4" y="10" width="3" height="8"/><rect x="10.5" y="4" width="3" height="14"/><rect x="17" y="7" width="3" height="11"/>'
    },
    // 공매도 압박(/page/short-pressure)은 2026-07-11 보류 - KRX 공매도 데이터를
    // 무료로 가져올 방법이 없어(직접 크롤링 차단, 네이버도 KRX iframe 임베드뿐이라 우회 불가)
    // 메뉴에서 내림. js/short-pressure.js, gas의 getShortPressure는 코드로는 남겨둠
    // (나중에 데이터 소스가 생기면 재활용).
    // 연기금 분석(/page/pension-fund)도 2026-07-11 메뉴에서 내림 - foreign-flow.js에
    // 병합됐으므로 별도 메뉴 불필요(js/pension-fund.js는 코드로는 남겨둠).
    // 공지사항(/notice)도 2026-07-11 커스텀 메뉴에서 내림 - 카테고리 섹션(catCustomList)에
    // 티스토리 '공지사항' 카테고리가 있으면 거기서 자동 표시됨.
    {
      href: '/pages/overnight-market', // 실제 페이지 URL 확인됨(2026-07-14)
      label: '글로벌 시장지표', // 2026-07-18: "전체 종합지수"에서 재개칭(js/overnight-market.js 참고)
      // 초승달 아이콘(예전 "보조지수"용) -> 지구본 아이콘으로 교체(라벨이 "글로벌"로 바뀐 것과 맞춤)
      icon: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>'
    },
    {
      // TODO(2026-07-16): 실제 페이지 URL 미확정 - 사용자가 티스토리에서 새 페이지를
      // 만든 뒤(js/kospi-futures.js + css/kospi-futures.css + <div id="kospi-futures">
      // 임베드) 실제 URL로 교체 필요. js/overnight-market.js가 처음 페이지 생성될 때와
      // 동일한 패턴(당시 href='/pages/overnight-market' placeholder -> 실제 생성 후 그대로 일치).
      href: '/pages/kospi-futures',
      label: '코스피 선물',
      icon: '<line x1="7" y1="3" x2="7" y2="21"/><rect x="4" y="8" width="6" height="7"/><line x1="17" y1="3" x2="17" y2="21"/><rect x="14" y="5" width="6" height="9"/>'
    },
    {
      // 실제 페이지 URL 확인됨(2026-07-22) - js/stock-calendar.js + css/stock-calendar.css +
      // <div id="stock-calendar"> 임베드. 예전엔 중앙 모달(openCalendarModal,
      // js/skin-main.js)이었으나 독립 페이지로 전환.
      href: '/page/stock-calendar',
      label: '증시캘린더',
      icon: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'
    },
    {
      // 2026-07-27: "9Pay 증권" 개편 작업지시서 #11 - MY(관심종목) 메뉴 신설.
      // TODO: /page/watchlist는 실제 페이지 생성 전 placeholder - 티스토리에 새 페이지
      // (js/watchlist.js + css/watchlist.css + <div id="watchlist"> 임베드, krx_map.js를
      // 그 전에 로드)를 만든 뒤 실제 URL로 교체할 것. 하위 메뉴(관심종목)는 페이지가
      // 이거 하나뿐이라 별도 드롭다운 없이 이 메뉴 자체가 그 역할을 한다.
      href: '/page/watchlist',
      label: 'MY',
      // 다른 메뉴 아이콘과 동일하게 stroke 렌더링(fill:none) 기준 별 모양(Feather/Lucide
      // "star" 아이콘과 동일한 폴리곤) - 위에서 썼던 채움형(fill) 별 path는 stroke로
      // 그리면 모서리가 어색해서 폴리곤으로 교체.
      icon: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'
    },
    {
      href: '/guestbook',
      label: '커뮤니티',
      icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'
    }
  ];

  // 사이드바 최상단 종목검색 입력창(음각 스타일, 2026-07-21 사이드바 리디자인으로
  // 커뮤니티 메뉴 아래 -> 메뉴 리스트 최상단으로 이동). 자동완성/이동 로직은
  // js/stock-search-panel.js가 이 마운트(#navSearchInput/#navSearchSuggest)를 찾아 붙인다
  // (검색 로직을 이 파일에 다시 넣지 않고 한 곳에 모아두기 위함).
  var SEARCH_HTML = ''
    + '<div class="nav-search-wrap">'
    + '<div class="nav-search-input-wrap">'
    + '<span class="nav-search-icon">🔍</span>'
    + '<input type="text" id="navSearchInput" class="nav-search-input" placeholder="종목검색" autocomplete="off" />'
    + '</div>'
    + '<div id="navSearchSuggest" class="nav-search-suggest"></div>'
    + '</div>';

  // 현재 페이지와 정확히 일치하는 메뉴 항목만 active로 표시한다(부분 문자열 포함 매칭 금지 -
  // skin-main.js의 카테고리 탭에 있는 indexOf 오남용 버그를 여기서는 반복하지 않는다).
  function isActiveItem(it) {
    if (!it.href || it.href.indexOf('javascript:') === 0) return false;
    var path;
    try { path = decodeURIComponent(location.pathname); } catch (err) { path = location.pathname; }
    if (path.length > 1 && path.charAt(path.length - 1) === '/') path = path.slice(0, -1);
    var href = it.href;
    if (href.length > 1 && href.charAt(href.length - 1) === '/') href = href.slice(0, -1);
    if (href === '') href = '/';
    if (path === '') path = '/';
    return path === href;
  }

  function render() {
    // 2026-07-28: 종목검색 입력창을 사이드바(현재는 상단 메뉴바) 최상단이 아니라 navbar
    // 안(#navSearchMount, skin.html) 자체에 심는다 - 사용자 요청으로 navbar의 기존
    // 티스토리 블로그글 검색을 아예 없애고 이 자리를 대신 채움. 메뉴 목록(#nav-menu-mount)
    // 렌더링과 서로 독립적으로 처리 - 어느 한쪽 mount가 없어도(페이지 종류에 따라 있을 수
    // 있음) 다른 쪽은 정상 동작해야 한다. #navSearchMount가 없는 옛 skin.html(캐시 등)
    // 에서는 폴백으로 예전 자리(#nav-menu-mount 안)에 넣는다.
    var searchMount = document.getElementById('navSearchMount');
    var mount = document.getElementById('nav-menu-mount');
    if (searchMount) searchMount.innerHTML = SEARCH_HTML;

    if (mount) {
      mount.innerHTML = (searchMount ? '' : SEARCH_HTML) + MENU_ITEMS.map(function (it) {
        return '<a href="' + it.href + '"' + (it.onclick ? ' onclick="' + it.onclick + '"' : '')
          + ' class="nav-item' + (isActiveItem(it) ? ' nav-item-home' : '') + '">'
          + '<div class="nav-item-icon">'
          + '<svg' + (it.iconClass ? ' class="' + it.iconClass + '"' : '')
          + ' width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
          + ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
          + (it.iconStyle ? ' style="' + it.iconStyle + '"' : '') + '>'
          + it.icon
          + '</svg>'
          + '</div>'
          + '<span class="nav-item-label">' + it.label + '</span>'
          + '</a>';
      }).join('');
    }

    if (window.StockSearchPanel) window.StockSearchPanel.wireSidebarSearch();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
