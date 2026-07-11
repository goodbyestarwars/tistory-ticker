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

  var MENU_ITEMS = [
    {
      href: '/',
      label: '전체글',
      home: true, // nav-item-home 클래스(첫 항목 스타일)
      icon: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'
    },
    {
      href: '/page/market-temp',
      label: '오늘의 증시 온도',
      bold: true,
      icon: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
      iconClass: 'nav-icon-temp',
      iconStyle: 'color:#d24f45;' // 라이트=빨강, 다크모드 밝기는 스킨 CSS가 처리
    },
    {
      href: '/page/marketcap-bubble',
      label: '실시간 시가총액 히트맵',
      bold: true,
      icon: '<circle cx="8" cy="15" r="6"/><circle cx="16" cy="9" r="4"/><circle cx="18" cy="18" r="2.5"/>'
    },
    {
      href: '/page/stock-news',
      label: '종목 뉴스',
      bold: true,
      icon: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/>'
    },
    {
      href: '/page/foreign-flow',
      label: '종목 종합분석',
      bold: true,
      icon: '<path d="M7 17V7"/><path d="M4 10l3-3 3 3"/><path d="M17 7v10"/><path d="M14 14l3 3 3-3"/>'
    },
    {
      href: '/page/pattern-scan',
      label: '차트패턴 검색',
      bold: true,
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
      href: '/guestbook',
      label: '커뮤니티',
      bold: true,
      icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'
    }
  ];

  function render() {
    var mount = document.getElementById('nav-menu-mount');
    if (!mount) return;

    mount.innerHTML = MENU_ITEMS.map(function (it) {
      return '<a href="' + it.href + '" class="nav-item' + (it.home ? ' nav-item-home' : '') + '">'
        + '<div class="nav-item-icon">'
        + '<svg' + (it.iconClass ? ' class="' + it.iconClass + '"' : '')
        + ' width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
        + ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
        + (it.iconStyle ? ' style="' + it.iconStyle + '"' : '') + '>'
        + it.icon
        + '</svg>'
        + '</div>'
        + '<span class="nav-item-label"' + (it.bold ? ' style="font-weight:700;"' : '') + '>' + it.label + '</span>'
        + '</a>';
    }).join('');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
