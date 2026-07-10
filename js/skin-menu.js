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
      label: '시가총액 버블',
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
      label: '외국인·기관 수급',
      bold: true,
      icon: '<path d="M7 17V7"/><path d="M4 10l3-3 3 3"/><path d="M17 7v10"/><path d="M14 14l3 3 3-3"/>'
    },
    {
      href: '/page/pattern-scan',
      label: '차트 패턴 스캔',
      bold: true,
      icon: '<rect x="4" y="10" width="3" height="8"/><rect x="10.5" y="4" width="3" height="14"/><rect x="17" y="7" width="3" height="11"/>'
    },
    {
      href: '/notice',
      label: '공지사항',
      icon: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'
    },
    {
      href: '/guestbook',
      label: '커뮤니티',
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
