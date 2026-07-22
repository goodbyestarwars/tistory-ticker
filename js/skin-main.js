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
 * 아티클 모달 / 공유·더보기 / 표 스크롤 래핑 / 요약 줄바꿈 / 모바일 드로어·검색
 *
 * 2026-07-17(9차): KRX 공시 티커 fetch/파싱/렌더 로직을 js/quick-indices.js로 옮겼다
 * (관심지수 바의 "긴급속보" 패널로 흡수) - 이 파일에서는 제거됨.
 *
 * 2026-07-22: 증시캘린더(구글 캘린더 위젯)를 이 파일의 중앙 모달(openCalendarModal)
 * 방식에서 독립 페이지(js/stock-calendar.js, #stock-calendar 마운트)로 옮겼다 - 여기
 * 있던 openCalendarModal/initCalendarWidget은 삭제됨.
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

  /* ── 데스크톱 사이드바 토글 (완전 숨김 ↔ 복원, 2026-07-21 사이드바 리디자인 #3)
     조기 적용 스크립트(head)가 이미 html.sidebar-collapsed를 붙여놨을 수 있으므로
     버튼 아이콘(햄버거 ⇄ X) 상태만 여기서 동기화. 모바일 드로어(#mobileMenuBtn)와는
     완전히 별개 기능 - CSS가 min-width:721px 안에서만 .sidebar-collapsed를 해석하므로
     모바일에서는 이 클래스가 있어도 레이아웃에 영향 없음. ── */
  (function() {
    var btn = document.getElementById('sidebarToggleBtn');
    if (!btn) return;
    if (document.documentElement.classList.contains('sidebar-collapsed')) btn.classList.add('open');
    btn.addEventListener('click', function() {
      var collapsed = document.documentElement.classList.toggle('sidebar-collapsed');
      btn.classList.toggle('open', collapsed);
      try { localStorage.setItem('bolt-sidebar-collapsed', collapsed ? '1' : '0'); } catch (e) {}
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

