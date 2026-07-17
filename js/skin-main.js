/**
 * 9bolt 스킨 공통 스크립트 (git 관리)
 * 원래 skin.html 하단 인라인 <script> 블록에 있던 코드를 그대로 이전한 것.
 * 수정 후 push하면 GitHub Pages 캐시(최대 10분) 지나 블로그에 반영된다.
 *
 * skin.html에는 다음만 남아 있어야 함:
 *  - head의 다크모드/폰트 조기 적용 스크립트 (FOUC 방지 - 외부화 금지)
 *  - head의 full-width-page 경로 감지 스크립트
 *  - 피드의 pinnedNotice 스크립트 (피드 마크업과 한 몸)
 *  - 이 파일과 skin-menu.js를 불러오는 <script src> 두 줄
 *
 * 포함 기능: iframe 모드 / 다크모드·폰트 토글 / 카테고리 파싱·필터 탭 /
 * 아티클 모달 / 공유·더보기 / 표 스크롤 래핑 / 요약 줄바꿈 / 모바일 드로어·검색 /
 * 구글 캘린더 위젯
 *
 * 2026-07-17(9차): KRX 공시 티커 fetch/파싱/렌더 로직을 js/quick-indices.js로 옮겼다
 * (관심지수 바의 "긴급속보" 패널로 흡수) - 이 파일에서는 제거됨.
 */
  /* ── iframe 모드 감지 (모달 안에서 열릴 때 껍데기 숨김) ── */
  if (window !== window.top) {
    document.body.classList.add('iframe-mode');
  }

  /* ── 다크모드 토글 (조기 적용 스크립트는 head에 있음) ── */
  (function() {
    var btn = document.getElementById('darkModeBtn');
    if (!btn) return;
    btn.addEventListener('click', function() {
      var on = document.documentElement.classList.toggle('dark');
      try { localStorage.setItem('bolt-dark', on ? '1' : '0'); } catch (e) {}
    });
  })();

  /* ── 폰트 전환 토글 (명조 ⇄ 고딕, 조기 적용 스크립트는 head에 있음) ── */
  (function() {
    var btn = document.getElementById('fontModeBtn');
    if (!btn) return;
    btn.addEventListener('click', function() {
      var on = document.documentElement.classList.toggle('font-gothic');
      try { localStorage.setItem('bolt-font', on ? 'gothic' : ''); } catch (e) {}
    });
  })();

  /* ── 카테고리 동적 파싱 ([##_category_list_##] 기반) ── */
  var catColors = ['#2563eb','#16a34a','#d97706','#7c3aed','#e11d48','#0891b2','#b45309','#0f766e'];
  /* 2026-07-12: 마켓 브리핑은 왼쪽 페이지 메뉴(skin-menu.js)로 승격돼서
     사이드바 "카테고리" 목록에는 중복 노출 안 함 */
  var sidebarCatExclude = ['마켓 브리핑'];
  /* 카테고리명 → 아이콘 수동 매핑. 카테고리 이름을 바꾸면 이 키도 같이 고쳐야 함(안 그러면 기본 아이콘으로 대체됨) */
  var catIconPaths = {
    '종목 분석': '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    '일상다반사': '<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>',
    '일기장': '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    'Insight Archive': '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>'
  };
  var catIconDefault = '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>';
  var subCatMap = {};
  var catDataEl = document.getElementById('categoryData');
  var catCustomList = document.getElementById('catCustomList');

  if (catDataEl) {
    var allLinks = Array.from(catDataEl.querySelectorAll('a'));

    /* depth-1 = /category/NAME (슬래시 딱 1개) */
    var depth1Links = allLinks.filter(function(a) {
      return /\/category\/[^/]+$/.test(a.getAttribute('href') || '');
    });

    /* depth-2 = /category/NAME/SUBNAME */
    var depth2Links = allLinks.filter(function(a) {
      return /\/category\/[^/]+\/[^/]+$/.test(a.getAttribute('href') || '');
    });

    /* ── 좌측 사이드바: depth-1 만 표시 ── */
    if (catCustomList) {
      depth1Links.forEach(function(a, idx) {
        var href = a.getAttribute('href');
        var countEl = a.querySelector('span');
        var name = '', count = '';
        if (countEl) {
          count = countEl.textContent.replace(/[()]/g, '').trim();
          name  = a.childNodes[0] ? a.childNodes[0].textContent.trim() : '';
        } else {
          var m = a.textContent.trim().match(/^(.*?)\s*\((\d+)\)\s*$/);
          name  = m ? m[1].trim() : a.textContent.trim();
          count = m ? m[2] : '';
        }
        if (!name) return;
        var bareName = name.replace(/\s*\(비공개\)\s*$/, '').trim();
        if (sidebarCatExclude.indexOf(bareName) > -1) return;
        var color = catColors[idx % catColors.length];
        var iconPath = catIconPaths[bareName] || catIconDefault;
        var li = document.createElement('li');
        li.innerHTML = '<a href="' + href + '" data-parent="' + name + '">'
          + '<svg class="cat-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + iconPath + '</svg>'
          + name
          + (count ? '<span class="cat-cnt">' + count + '</span>' : '')
          + '</a>';
        catCustomList.appendChild(li);
      });
    }

    /* ── 상단 필터 탭: 2026-07-11 UI에서 제거(디자인상 불필요 판단) ──
       skin.html의 #filterBar 자체는 스킨 편집 없이 유지하고, 여기서 DOM에서 떼어낸다. */
    var filterBar = document.getElementById('filterBar');
    if (filterBar) { filterBar.remove(); filterBar = null; }
    var topBarExclude = ['일기장', 'Insight Archive'];

    /* ── subCatMap: depth-2를 부모 기준으로 그루핑 ── */
    depth2Links.forEach(function(a) {
      var href = a.getAttribute('href') || '';
      var parentSlug = (href.match(/\/category\/([^/]+)\//) || [])[1] || '';
      var parentA = depth1Links.filter(function(p) {
        return (p.getAttribute('href') || '').indexOf('/category/' + parentSlug) > -1;
      })[0];
      var parentName = '';
      if (parentA) {
        var pCountEl = parentA.querySelector('span');
        parentName = pCountEl
          ? (parentA.childNodes[0] ? parentA.childNodes[0].textContent.trim() : '')
          : parentA.textContent.trim().replace(/\s*\(\d+\)\s*$/, '').trim();
      } else {
        parentName = decodeURIComponent(parentSlug.replace(/\+/g, ' '));
      }
      var cntEl = a.querySelector('span');
      var subName = cntEl
        ? (a.childNodes[0] ? a.childNodes[0].textContent.trim() : '')
        : a.textContent.trim().replace(/\s*\(\d+\)\s*$/, '').trim();
      if (!parentName || !subName) return;
      if (!subCatMap[parentName]) subCatMap[parentName] = [];
      subCatMap[parentName].push({ name: subName, url: href });
    });
  }

  /* ── 카테고리 필터 탭 active ── */
  var path = decodeURIComponent(location.pathname).toLowerCase();
  var activeCat = '';
  document.querySelectorAll('.filter-tab').forEach(function(tab) {
    var tabCat = (tab.dataset.cat || '').toLowerCase();
    if (tabCat === 'all') {
      if (path === '/' || path === '') { tab.classList.add('active'); activeCat = 'all'; }
    } else {
      var slug = tabCat.replace(/ /g, '+');
      if (path.indexOf(slug) > -1 || path.indexOf(tabCat.replace(/ /g, '%20')) > -1 || path.indexOf(tabCat) > -1) {
        tab.classList.add('active');
        activeCat = tab.dataset.cat;
      }
    }
  });
  /* 상단 탭에 없는 카테고리(일기장/Insight Archive 등 topBarExclude 대상)도
     카테고리 페이지에 들어가면 서브 카테고리 바는 뜨도록 URL에서 직접 감지 */
  if (!activeCat) {
    Object.keys(subCatMap).forEach(function(parentName) {
      var p = parentName.toLowerCase();
      if (path.indexOf('/category/' + p.replace(/ /g, '+')) === 0 ||
          path.indexOf('/category/' + p.replace(/ /g, '%20')) === 0 ||
          path.indexOf('/category/' + p) === 0) {
        activeCat = parentName;
      }
    });
  }

  if (!activeCat) {
    var allTab = document.querySelector('.filter-tab[data-cat="all"]');
    if (allTab) { allTab.classList.add('active'); activeCat = 'all'; }
  }

  /* ── 세부 카테고리 서브 필터 렌더링 ──
     상단 탭에서 제외된 카테고리(일기장/Insight Archive)는 서브 바 대신
     상단 필터 바 자체를 하위 카테고리 탭으로 교체한다(전체글/마켓 브리핑 자리에 표시). */
  var subBar = document.getElementById('subFilterBar');
  if (subCatMap[activeCat]) {
    var subs = subCatMap[activeCat];
    var isExcludedCat = topBarExclude.indexOf(activeCat.replace(/\s*\(비공개\)\s*$/, '').trim()) > -1;
    var tabClass = isExcludedCat ? 'filter-tab' : 'sub-filter-tab';
    var html = '';
    subs.forEach(function(s) {
      var isActive = path.indexOf(decodeURIComponent(s.url).toLowerCase().split('/').pop()) > -1;
      html += '<a href="' + s.url + '" class="' + tabClass + (isActive ? ' active' : '') + '">' + s.name + '</a>';
    });
    if (isExcludedCat && filterBar) {
      filterBar.innerHTML = html;
    } else if (subBar) {
      subBar.innerHTML = html;
      subBar.style.display = 'flex';
    }
  }

  /* ── 좌측 카테고리 active 표시 ── */
  document.querySelectorAll('.cat-custom-list a').forEach(function(a) {
    var p = (a.dataset.parent || '').toLowerCase();
    if (p && path.indexOf(p.replace(/ /g, '+')) > -1) {
      a.classList.add('active');
    }
  });


  /* ── 아티클 모달 ── */
  function openArticleModal(url, title, wide, zoom) {
    var old = document.getElementById('bolt-modal');
    if (old) old.remove();
    var m = document.createElement('div');
    m.id = 'bolt-modal';
    var iframeHTML = wide
      ? '<div class="nm-scale-wrap"><div class="nm-scale-inner"><iframe src="' + url + '" class="nm-iframe nm-iframe-fixed"></iframe></div></div>'
      : '<iframe src="' + url + '" class="nm-iframe"></iframe>';
    m.innerHTML =
      '<div class="nm-overlay"></div>' +
      '<div class="nm-card' + (wide ? ' nm-wide' : '') + '">' +
        '<div class="nm-header">' +
          '<span class="nm-title">' + (title || '') + '</span>' +
          '<div class="nm-actions">' +
            '<a href="' + url + '" target="_blank" class="nm-ext">새창 열기 ↗</a>' +
            '<button class="nm-close" id="nmClose">✕</button>' +
          '</div>' +
        '</div>' +
        iframeHTML +
      '</div>';
    document.body.appendChild(m);
    document.body.style.overflow = 'hidden';
    document.getElementById('nmClose').onclick = closeArticleModal;
    m.querySelector('.nm-overlay').onclick = closeArticleModal;

    if (wide) {
      var wrap = m.querySelector('.nm-scale-wrap');
      var inner = m.querySelector('.nm-scale-inner');
      var ifr = m.querySelector('.nm-iframe-fixed');
      if (wrap && inner && ifr) {
        var rescale = function() {
          var w = wrap.clientWidth;
          if (!w) return;
          var virtualWidth = zoom ? (w / zoom) : 1200;
          var scale = w / virtualWidth;
          ifr.style.width = virtualWidth + 'px';
          ifr.style.transform = 'scale(' + scale + ')';
          inner.style.width = w + 'px';
          inner.style.height = (1300 * scale) + 'px';
        };
        rescale();
        window.addEventListener('resize', rescale);
        m._rescale = rescale;
      }
    }
  }
  function closeArticleModal() {
    var m = document.getElementById('bolt-modal');
    if (m) {
      if (m._rescale) window.removeEventListener('resize', m._rescale);
      m.classList.add('nm-closing'); setTimeout(function(){ m.remove(); }, 200);
    }
    document.body.style.overflow = '';
  }
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeArticleModal();
  });

  /* ── 전역 노출 ── */
  window.readPost = function(btn) {
    var card = btn.closest('.post-card');
    if (!card) return;
    var postUrl = card.dataset.url;
    var titleEl = card.querySelector('.post-title');
    var title = titleEl ? titleEl.textContent.trim() : '';
    openArticleModal(postUrl, title, true, 1.0);
  };

  window.sharePost = function(btn) {
    var card = btn.closest('.post-card');
    if (!card) return;
    var url = card.dataset.url || location.href;
    var titleEl = card.querySelector('.post-title');
    var title = titleEl ? titleEl.textContent.trim() : '';
    if (navigator.share) {
      navigator.share({ title: title, url: url }).catch(function(){});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function() {
        var orig = btn.textContent;
        btn.textContent = '✓ 복사됨';
        btn.style.background = '#dcfce7'; btn.style.borderColor = '#86efac'; btn.style.color = '#15803d';
        setTimeout(function() {
          btn.textContent = orig; btn.style.background = ''; btn.style.borderColor = ''; btn.style.color = '';
        }, 2000);
      });
    } else { window.open(url, '_blank'); }
  };

  /* 증시캘린더 - 커스텀 메뉴에서 클릭하면 중앙 모달로 큰 달력을 띄움
     (예전엔 왼쪽 사이드바에 상시 노출되는 미니 캘린더였음) */
  window.openCalendarModal = function() {
    var old = document.getElementById('bolt-modal');
    if (old) old.remove();
    var m = document.createElement('div');
    m.id = 'bolt-modal';
    m.innerHTML =
      '<div class="nm-overlay"></div>' +
      '<div class="nm-card nm-calendar-card">' +
        '<div class="nm-header">' +
          '<span class="nm-title">증시캘린더</span>' +
          '<div class="nm-actions"><button class="nm-close" id="nmCalClose">✕</button></div>' +
        '</div>' +
        '<div class="cal-modal-body">' +
          '<div class="cal-widget-header">' +
            '<button class="cal-nav" id="calModalPrev">‹</button>' +
            '<span class="cal-widget-title" id="calModalTitle">로딩 중...</span>' +
            '<button class="cal-nav" id="calModalNext">›</button>' +
          '</div>' +
          '<div class="cal-dow">' +
            '<span style="color:#e11d48;">일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span style="color:#2563eb;">토</span>' +
          '</div>' +
          '<div class="cal-grid" id="calModalGrid"></div>' +
          '<div class="cal-event-list" id="calModalEventList" style="display:none;"></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(m);
    document.body.style.overflow = 'hidden';
    document.getElementById('nmCalClose').onclick = closeArticleModal;
    m.querySelector('.nm-overlay').onclick = closeArticleModal;
    initCalendarWidget({
      grid: 'calModalGrid', title: 'calModalTitle', eventList: 'calModalEventList',
      prev: 'calModalPrev', next: 'calModalNext'
    });
  };



  /* ── 카테고리 없는 글/페이지(예: /page/market-temp 등 개별 Page)의
     "카테고리 없음" 뱃지 숨김 ── */
  document.querySelectorAll('.post-cat-badge').forEach(function(el) {
    if (el.textContent.trim() === '카테고리 없음') el.style.display = 'none';
  });

  /* ── 표 가로 스크롤 래핑: table에 overflow-x:auto만 주면 auto 테이블 레이아웃이
     칸 너비를 억지로 욱여넣어 찌그러지길래, div로 감싸서 그 div가 스크롤되게 함 ── */
  document.querySelectorAll('.post-single-body table, .post-expand-body table').forEach(function(table) {
    if (table.parentElement && table.parentElement.classList.contains('table-scroll-wrap')) return;
    var wrap = document.createElement('div');
    wrap.className = 'table-scroll-wrap';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
  });

  /* ── 인덱스 요약 텍스트 줄바꿈 개선 ── */
  document.querySelectorAll('.post-excerpt').forEach(function(el) {
    /* innerHTML 기반 처리: 티스토리가 삽입한 <br> 보존 */
    var raw = el.innerHTML;
    /* ① <br> → \n */
    raw = raw.replace(/<br\s*\/?>/gi, '\n');
    /* ② 나머지 태그 제거 */
    raw = raw.replace(/<[^>]+>/g, '');
    /* ③ HTML 엔티티 디코딩 */
    var tmp = document.createElement('div');
    tmp.innerHTML = raw;
    raw = tmp.textContent.replace(/\r\n|\r/g, '\n').trim();
    /* ④ 중복 텍스트 제거 */
    if (raw.length > 20) {
      var check = raw.slice(0, 30);
      var dupIdx = raw.indexOf(check, 5);
      if (dupIdx > 0 && dupIdx <= 60) { raw = raw.slice(dupIdx); }
    }
    /* ⑤ "숫자.\n내용" → "숫자. 내용" (번호 혼자 떠있는 현상 방지) */
    raw = raw.replace(/(\d+)\.\n+/g, '$1. ');
    /* ⑥ 숫자 목록 앞 줄바꿈 (공백 유무 무관) */
    /* "?1. " "할인).2. " 처럼 구두점/괄호 뒤 숫자가 바로 붙는 경우 포함 */
    raw = raw.replace(/([.!?)\]][\s]*(\d+)\.\s+)/g, function(m) {
      var parts = m.match(/^([.!?)\]])\s*(\d+)\.\s+$/);
      if (!parts) return m;
      return parts[1] + '\n' + parts[2] + '. ';
    });
    raw = raw.replace(/([^\n])\s+(\d+)\.\s+/g, function(m, before, num) {
      return before + '\n' + num + '. ';
    });
    /* ⑦ 대시·불릿 앞 줄바꿈 */
    raw = raw.replace(/([^\n])\s*[-•·✦▸]\s+/g, '$1\n- ');
    /* ⑧ 마침표/느낌표/물음표 뒤 새 한글 문장 단락 구분 */
    /* 앞 글자가 숫자면 제외: "1. 일단..." 같은 번호목록 점을 건드리지 않음 */
    raw = raw.replace(/([^\d\n][.!?])\s+([가-힣A-Z])/g, '$1\n$2');
    /* ⑨ 연속 줄바꿈 정리 */
    raw = raw.replace(/\n{3,}/g, '\n\n');
    /* ⑩ 최종 출력 (3줄 클램프는 style.css .post-excerpt 규칙이 담당) */
    el.innerHTML = raw.replace(/\n/g, '<br>');
  });

  /* 뉴스 티커 초기 패딩 보정 (RSS 로드 전부터 공간 확보) */
  (function() {
    var pw = document.querySelector('.page-wrap');
    var sl = document.querySelector('.sidebar-left');
    var sr = document.querySelector('.sidebar-right');
    if (pw) pw.style.paddingTop = '122px'; /* navbar+disc-ticker 여백(90px) + market-ribbon(32px) */
    /* 모바일에서는 사이드바가 드로어이므로 top 고정하지 않음 */
    if (sl && window.innerWidth > 720) sl.style.top = '142px';
    if (sr && window.innerWidth > 1100) sr.style.top = '142px';
  })();

  /* ── 모바일 드로어 & 검색 오버레이 ── */
  (function() {
    var menuBtn    = document.getElementById('mobileMenuBtn');
    var overlay    = document.getElementById('mobileOverlay');
    var sidebar    = document.querySelector('.sidebar-left');
    var searchBtn  = document.getElementById('mobileSearchBtn');
    var searchOv   = document.getElementById('mobileSearchOverlay');
    var msoClose   = document.getElementById('msoCloseBtn');
    var msoInput   = document.getElementById('msoInput');
    var scrollBtn  = document.getElementById('scrollTopBtn');
    var drawerHdr  = document.querySelector('.drawer-header');

    /* 드로어 열기/닫기 */
    function openDrawer() {
      if (!sidebar || !menuBtn || !overlay) return;
      menuBtn.classList.add('open');
      menuBtn.setAttribute('aria-label', '메뉴 닫기');
      sidebar.classList.add('drawer-open');
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
      if (drawerHdr) drawerHdr.style.display = 'flex';
    }
    function closeDrawer() {
      if (!sidebar || !menuBtn || !overlay) return;
      menuBtn.classList.remove('open');
      menuBtn.setAttribute('aria-label', '메뉴 열기');
      sidebar.classList.remove('drawer-open');
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    }

    if (menuBtn) menuBtn.addEventListener('click', function() {
      sidebar && sidebar.classList.contains('drawer-open') ? closeDrawer() : openDrawer();
    });
    if (overlay) overlay.addEventListener('click', closeDrawer);

    /* 드로어 내부 링크 클릭 시 자동 닫힘 */
    if (sidebar) sidebar.addEventListener('click', function(e) {
      if (e.target.tagName === 'A' && window.innerWidth <= 720) {
        setTimeout(closeDrawer, 120);
      }
    });

    /* 검색 오버레이 */
    if (searchBtn) searchBtn.addEventListener('click', function() {
      if (!searchOv) return;
      searchOv.classList.add('open');
      setTimeout(function() { msoInput && msoInput.focus(); }, 150);
    });
    if (msoClose) msoClose.addEventListener('click', function() {
      searchOv && searchOv.classList.remove('open');
    });
    if (searchOv) searchOv.addEventListener('click', function(e) {
      if (e.target === searchOv) searchOv.classList.remove('open');
    });

    /* ESC 키 닫힘 */
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        closeDrawer();
        searchOv && searchOv.classList.remove('open');
      }
    });

    /* 스크롤 탑 버튼 */
    if (scrollBtn) {
      window.addEventListener('scroll', function() {
        if (window.scrollY > 300) scrollBtn.classList.add('visible');
        else scrollBtn.classList.remove('visible');
      }, { passive: true });
      scrollBtn.addEventListener('click', function() {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    /* 리사이즈 시 드로어 정리 */
    window.addEventListener('resize', function() {
      if (window.innerWidth > 720) {
        closeDrawer();
        /* 데스크탑 전환 시 sidebar top 복원 */
        var sl2 = document.querySelector('.sidebar-left');
        if (sl2) sl2.style.top = '';
      }
    });
  })();

  /* ── 구글 캘린더 (증시캘린더 모달 안에서 초기화) ──
     예전엔 사이드바에 상시 노출되는 IIFE였음. 이제 openCalendarModal()이 모달을 만들고
     나서 그 안의 엘리먼트 id를 넘겨 호출하는 함수로 변경 - id는 ids.grid/title/eventList/prev/next. */
  function initCalendarWidget(ids) {
    var API_KEY = 'AIzaSyB9zgyudgEblbLoP-fW231dwf6VjOFK00o';
    var CAL_ID  = encodeURIComponent('405dbd75cc8e798f6dfb0003494d0fa64eecbc00ae2edeb1cdbf6deee0b07f76@group.calendar.google.com');
    var today    = new Date();
    var curYear  = today.getFullYear();
    var curMonth = today.getMonth();
    var cache    = {};

    function fetchEvents(year, month, cb) {
      var key = year + '-' + month;
      if (cache[key]) { cb(cache[key]); return; }
      var tMin = new Date(year, month, 1).toISOString();
      var tMax = new Date(year, month + 1, 0, 23, 59, 59).toISOString();
      var url  = 'https://www.googleapis.com/calendar/v3/calendars/'
        + CAL_ID + '/events?key=' + API_KEY
        + '&timeMin=' + encodeURIComponent(tMin)
        + '&timeMax=' + encodeURIComponent(tMax)
        + '&singleEvents=true&orderBy=startTime&maxResults=50';
      fetch(url)
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var evs = (data.items || []).map(function(it) {
            var title = it.summary
              ? it.summary
              : (it.visibility === 'private' ? '🔒 비공개 일정' : '(제목 없음)');
            return { title: title, start: it.start.dateTime || it.start.date, link: it.htmlLink };
          });
          cache[key] = evs;
          cb(evs);
        })
        .catch(function() { cb([]); });
    }

    function renderCal(year, month, evs) {
      var grid    = document.getElementById(ids.grid);
      var titleEl = document.getElementById(ids.title);
      var evList  = document.getElementById(ids.eventList);
      if (!grid) return;
      titleEl.textContent = year + '년 ' + (month + 1) + '월';
      grid.innerHTML = '';
      evList.style.display = 'none';
      evList.innerHTML = '';
      var byDay = {};
      evs.forEach(function(ev) {
        var d = parseInt((ev.start.includes('T') ? ev.start : ev.start + 'T00:00').slice(8,10), 10);
        if (!byDay[d]) byDay[d] = [];
        byDay[d].push(ev);
      });
      var firstDay    = new Date(year, month, 1).getDay();
      var daysInMonth = new Date(year, month + 1, 0).getDate();
      var isThisMonth = (year === today.getFullYear() && month === today.getMonth());
      for (var i = 0; i < firstDay; i++) grid.appendChild(document.createElement('div'));
      for (var d = 1; d <= daysInMonth; d++) {
        var cell = document.createElement('div');
        var isToday = isThisMonth && d === today.getDate();
        var hasEv = !!byDay[d];
        var dow = (firstDay + d - 1) % 7;
        cell.className = 'cal-day' + (isToday ? ' cal-today' : '') + (hasEv ? ' cal-has-event' : '');
        if (!isToday) { if (dow === 0) cell.style.color = '#e11d48'; if (dow === 6) cell.style.color = '#2563eb'; }
        var num = document.createElement('span');
        num.textContent = d;
        cell.appendChild(num);
        if (hasEv) {
          var dot = document.createElement('div');
          dot.className = 'cal-dot';
          cell.appendChild(dot);
          (function(day, events) {
            cell.addEventListener('click', function() { showEvents(day, events); });
          })(d, byDay[d]);
        }
        grid.appendChild(cell);
      }
    }

    function showEvents(day, evs) {
      var list = document.getElementById(ids.eventList);
      if (!list) return;
      list.innerHTML = '<div class="cal-ev-date">' + (curMonth + 1) + '월 ' + day + '일</div>';
      evs.forEach(function(ev) {
        var a = document.createElement('a');
        a.href = ev.link || '#';
        a.target = '_blank';
        a.className = 'cal-ev-item';
        var time = '';
        if (ev.start.includes('T')) {
          var dt = new Date(ev.start);
          time = dt.getHours() + ':' + String(dt.getMinutes()).padStart(2,'0');
        }
        a.innerHTML = '<span class="cal-ev-time">' + (time || '종일') + '</span><span class="cal-ev-title">' + ev.title + '</span>';
        list.appendChild(a);
      });
      list.style.display = 'block';
    }

    function load() {
      var grid = document.getElementById(ids.grid);
      if (grid) grid.innerHTML = '<div class="cal-loading">로딩 중...</div>';
      fetchEvents(curYear, curMonth, function(evs) { renderCal(curYear, curMonth, evs); });
    }

    var calPrevBtn = document.getElementById(ids.prev);
    var calNextBtn = document.getElementById(ids.next);
    if (!calPrevBtn || !calNextBtn || !document.getElementById(ids.grid)) return;

    calPrevBtn.addEventListener('click', function() {
      curMonth--; if (curMonth < 0) { curMonth = 11; curYear--; } load();
    });
    calNextBtn.addEventListener('click', function() {
      curMonth++; if (curMonth > 11) { curMonth = 0; curYear++; } load();
    });

    load();
  }

