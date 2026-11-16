/**
 * 9bolt ��Ų ���� ��ũ��Ʈ (git ����)
 * ���� skin.html �ϴ� �ζ��� <script> ���Ͽ� �ִ� �ڵ带 �״�� ������ ��.
 * ���� �� push�ϸ� GitHub Pages ĳ��(�ִ� 10��) ���� ���α׿� �ݿ��ȴ�.
 *
 * skin.html���� ������ ���� �־�� ��:
 *  - head�� ��ũ���/��Ʈ ���� ���� ��ũ��Ʈ (FOUC ���� - �ܺ�ȭ ����)
 *  - head�� full-width-page ��� ���� ��ũ��Ʈ
 *  - �ǵ��� pinnedNotice ��ũ��Ʈ (�ǵ� ��ũ���� �� ��)
 *  - �� ���ϰ� skin-menu.js�� �ҷ����� <script src> �� ��
 *
 * ���� ���: iframe ��� / ��ũ��� / ī�װ��� �Ľ̡����� �� /
 * ��ƼŬ ��� / ������������ / ǥ ��ũ�� ���� / ��� �ٹٲ� / ����� ��ξ�˻�
 *
 * 2026-07-17(9��): KRX ���� ƼĿ fetch/�Ľ�/���� ������ js/quick-indices.js�� �Ű��
 * (�������� ���� "��޼Ӻ�" �гη� ����) - �� ���Ͽ����� ���ŵ�.
 *
 * 2026-07-22: ����Ķ����(���� Ķ���� ����)�� �� ������ �߾� ���(openCalendarModal)
 * ��Ŀ��� ���� ������(js/stock-calendar.js, #stock-calendar ����Ʈ)�� �Ű�� - ����
 * �ִ� openCalendarModal/initCalendarWidget�� ������.
 */
/* 2026-08-30: skin-ready�� �� �̻� ȭ���� ������ �ʴ´�(�ٰŴ� skin.html��
   #initial-paint-guard �ּ�). style.css�� ��� ��ū�� Ȯ���ϴ� �� �� Ŭ������ ����,
   skin.html�� ���� �� ������ Ƽ���丮 ��Ų������ Ŭ������ �ٵ��� ���⼭�� ���δ�.
   ���� �� ������ ��ٸ��� �ʰ� ��� ���δ�. */
document.documentElement.classList.add('skin-ready');

/* ���� ��ũ��� ��� (���� ���� ��ũ��Ʈ�� head�� ����) ����
   ��� ���� ����̶� ȭ�� ���� ������ �����ϰ� �ٷ� �����Ѵ�. �Ʒ� start() �ȿ� ���� ����
   ��ú��� �ʱ�ȭ�� ������ ��ȸ�� Ȩ���� ��ư�� �������� �ʾҴ�(2026-11-12). */
(function () {
  var btn = document.getElementById('darkModeBtn');
  if (!btn) return;
  btn.addEventListener('click', function () {
    var on = document.documentElement.classList.toggle('dark');
    try { localStorage.setItem('bolt-dark', on ? '1' : '0'); } catch (e) {}
  });
})();

/* Ȩ ���Ϻ긮�� ĳ����(�ֽ� �긮�� ī�带 �¿�� �ѱ�). ȸ�� ��ú���(buildHomeDashboard)�� ��ȸ�� Ȩ(js/guest-home.js)��
   ���� ��ũ�������� SiteInteractions.carousel�� ����. ī��� Ƽ���丮 ���� .post-card�� �Ű� ��´�(���� ����). */
window.NineHomeBriefing = window.NineHomeBriefing || {
  build: function (cards) {
    var briefing = document.createElement('section');
    briefing.className = 'home-briefing-section';
    briefing.innerHTML = '<div class="home-section-heading briefing-intro"><div><span class="learn-eyebrow">������ �д� ���� ��Ʈ</span><strong><svg class="briefing-title-icon" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M2 6h4" /> <path d="M2 10h4" /> <path d="M2 14h4" /> <path d="M2 18h4" /> <rect width="16" height="20" x="4" y="2" rx="2" /> <path d="M9.5 8h5" /> <path d="M9.5 12H16" /> <path d="M9.5 16H14" /> </svg> ���Ϻ긮��</strong>'
      + '<p>�ְ��� ������ ��ǰ� �帧, �ٽ� �ؼ��� ���캸����.</p></div>'
      + '<a class="home-briefing-more" href="/category/���� �긮��"><svg class="briefing-archive-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg><span>�긮�� ��ī�̺�</span> <i aria-hidden="true">��</i></a></div>'
      + '<div class="home-briefing-grid briefing-carousel-track" tabindex="0" role="region" aria-label="���Ϻ긮�� ī��"></div>'
      + '<div class="briefing-carousel-controls"><input class="briefing-carousel-progress" type="range" min="0" max="1000" value="0" aria-label="�긮�� ī�� �̵� ��ġ">'
      + '<div><button type="button" data-briefing-prev aria-label="���� �긮��">��</button><button type="button" data-briefing-next aria-label="���� �긮��">��</button></div></div>';
    var track = briefing.querySelector('.briefing-carousel-track');
    cards.forEach(function (card, index) {
      card.classList.add('home-briefing-card');
      card.setAttribute('data-briefing-number', String(index + 1).padStart(2, '0'));
      track.appendChild(card);
    });
    return briefing;
  },
  initCarousel: function (section) {
    (window.SiteInteractionsReady || Promise.resolve(window.SiteInteractions)).then(function (module) {
      if (!module) return;
      module.carousel(section, {track:'.briefing-carousel-track',previous:'[data-briefing-prev]',next:'[data-briefing-next]',progress:'.briefing-carousel-progress',card:'.home-briefing-card'});
    }).catch(function () {});
  }
};

/* �����(��720px) �ϴ� �ǹ� + ���� ��� + Ȩ ���� ��������(2026-11-08). 720px ���Ͽ����� ������ �޴´� - PC�� ���� �ʴ´�.
   ������ �� �Լ��� �Ʒ� �� ȣ���� �����(���̺� ������ �ּ� ?mtabs=off). js/home-mobile-tabs.js, css/home-mobile-tabs.css, docs/UI_GUIDE.md '����� �ϴ� �ǹ�' */
function loadMobileTabs() {
  if (!window.matchMedia || !window.matchMedia('(max-width: 720px)').matches) return;
  if (document.querySelector('script[data-mobile-tabs]')) return;
  var ASSET_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/';
  var version = '20261113-linked-futures';
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = ASSET_BASE + 'css/home-mobile-tabs.css?v=' + version;
  link.setAttribute('data-mobile-tabs-css', '1');
  document.head.appendChild(link);
  var script = document.createElement('script');
  script.src = ASSET_BASE + 'js/home-mobile-tabs.js?v=' + version;
  script.defer = true;
  script.setAttribute('data-mobile-tabs', '1');
  document.body.appendChild(script);
}
/* ��ȸ�� Ȩ(/)�� NineAccess.run�� �Ʒ� start()�� ���� ��ú��带 �������� �ʴ´�. �ǹٴ� �ü��������� ������
   ���� ������̼��̹Ƿ� guest-home.js�� ����Ʈ�� �˸���(html.guest-home-mode + nine:guest-home) ���� �δ��� �����Ѵ�. */
if (document.documentElement.classList.contains('guest-home-mode')) loadMobileTabs();
else document.addEventListener('nine:guest-home', loadMobileTabs, { once: true });

/* ���� �� ���⡤������ ȸ�� ��ú��� ���Ѱ� ������ ���� �����̴�. */
(function () {
  /* ���� ��ƼŬ ��� ���� */
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
            '<a href="' + url + '" target="_blank" class="nm-ext">��â ���� ��</a>' +
            '<button class="nm-close" id="nmClose">?</button>' +
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

  /* ���� ���� ���� ���� */
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
        btn.textContent = '? �����';
        btn.style.background = '#dcfce7'; btn.style.borderColor = '#86efac'; btn.style.color = '#15803d';
        setTimeout(function() {
          btn.textContent = orig; btn.style.background = ''; btn.style.borderColor = ''; btn.style.color = '';
        }, 2000);
      });
    } else { window.open(url, '_blank'); }
  };

})();

/* �޸� ������ Ȩ ��ú��� üũ�� �����̴�. */
(function () {
  /* 2026-09-23 ����� ��û("�޸� ���") - ��ü ���������� �ߴ� �÷��� �޸� ��ư.
     dashboard-enhancements�� �޸� ��� ���� ���� �׻� �ε��Ѵ�(��� ������������
     �޸� ���� �� �־�� �ϴ� ����̶�). */
  (function loadMemoWidget() {
    if (window.NineAccess) { (window.NineAccess.whenMember || window.NineAccess.whenAdmin)(loadMemoWidgetNow, 'memo'); return; }
    window.addEventListener('nineaccess:ready', function () { if (window.NineAccess) window.NineAccess.whenMember(loadMemoWidgetNow, 'memo'); }, {once:true});
  })();
  function loadMemoWidgetNow() {
    if (document.querySelector('link[data-memo-widget-css]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://goodbyestarwars.github.io/tistory-ticker/css/memo-widget.css?v=20260923-memo-widget-v3';
    link.setAttribute('data-memo-widget-css', '1');
    document.head.appendChild(link);
    var script = document.createElement('script');
    script.src = 'https://goodbyestarwars.github.io/tistory-ticker/js/memo-widget.js?v=20260923-memo-widget-v3';
    script.defer = true;
    script.setAttribute('data-memo-widget', '1');
    document.body.appendChild(script);
  }

})();

/* 2026-11-11 ȭ�� ���� ��å: ��ȣ ȭ��(Ȩ������MY ��)�� ���� ����(NineAccess) �ڿ��� �Ʒ� �ʱ�ȭ�� �����Ѵ�.
   ���� 4�� ȭ�顤�Ϲ� ���� ��ٸ��� �ʰ� �ٷ� �����Ѵ�. ����Ʈ �ε� ���� �ÿ��� �����ʹ� ���� API�� ���´�. */
(function nineAccessBoot() {
  function start() {
/* DCF uses the existing page-body mount pattern. Create /page/dcf in Tistory;
   code, styles and per-company disclosures are maintained on GitHub Pages. */
(function loadDcfPage() {
  if (!/^\/(?:page|pages)\/dcf\/?$/.test(location.pathname)) return;
  if (document.querySelector('script[data-dcf-page]')) return;
  var base = 'https://goodbyestarwars.github.io/tistory-ticker/';
  var mount = document.getElementById('dcf');
  if (!mount) {
    mount = document.createElement('div'); mount.id = 'dcf';
    var host = document.querySelector('.contents_style') || document.querySelector('.post-single-body') || document.querySelector('.entry-content');
    if (!host) return;
    host.appendChild(mount);
  }
  var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = base + 'css/dcf.css'; document.head.appendChild(css);
  var core = document.createElement('script'); core.src = base + 'js/dcf-core.js'; core.setAttribute('data-dcf-page', '1');
  core.onload = function () {
    var script = document.createElement('script'); script.src = base + 'js/dcf.js';
    script.onerror = function () { mount.textContent = 'DCF ȭ�� ��ȸ ����. �������� ���ΰ�ħ�ϼ���.'; };
    document.body.appendChild(script);
  };
  core.onerror = function () { mount.textContent = 'DCF ��� ��� ��ȸ ����. �������� ���ΰ�ħ�ϼ���.'; };
  document.body.appendChild(core);
}());

/* �ڵ��Ÿ�(������ ����) ȭ��: Tistory�� /page/auto-trader �������� ����� �� �δ��� ȭ���� ���δ�(DCF�� ���� ���).
   �����ʹ� �� PC�� ���� ��(127.0.0.1:8765)������ �д´� - ���¡��ֹ� ������ ����Ʈ��VM�� ��ġ�� �ʴ´�. */
(function loadAutoTraderPage() {
  if (!/^\/(?:page|pages)\/auto-trader\/?$/.test(location.pathname)) return;
  if (document.querySelector('script[data-auto-trader-page]')) return;
  var base = 'https://goodbyestarwars.github.io/tistory-ticker/';
  var mount = document.getElementById('auto-trader');
  if (!mount) {
    mount = document.createElement('div'); mount.id = 'auto-trader';
    var host = document.querySelector('.contents_style') || document.querySelector('.post-single-body') || document.querySelector('.entry-content');
    if (!host) return;
    host.appendChild(mount);
  }
  var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = base + 'css/auto-trader.css?v=20261101-control'; document.head.appendChild(css);
  var script = document.createElement('script'); script.src = base + 'js/auto-trader.js?v=20261101-control'; script.setAttribute('data-auto-trader-page', '1');
  script.onerror = function () { mount.textContent = '�ڵ��Ÿ� ȭ���� �ҷ����� ���߽��ϴ�. ���ΰ�ħ�ϼ���.'; };
  document.body.appendChild(script);
}());

  /* ���� ���� /earnings-calendar ���� �δ� ����
     Ȩ�� ���� ī��(stock-calendar.js)���̱� ����(home-widgets.js)���ְ� ����Ʈ
     (home-weekly-report.js)�� ���� year-month ��ȸ�� ������ fetch �ϴ� ���� �� ������
     ��ģ��. ������ ũ��(�� ���� ��ü, ���� KB) VM�� 1�ھ��, ù ȭ�鿡�� �� ȣ����
     4���� ��ġ�� �� ���� ������ ū �����̾���. 60�� TTL ���� ��û�� �����ϸ�, ���д�
     �� �迭�� �����Ѵ�(�� �Һ��� ��� .catch(()=>[]) �Ծ�). */
  (function () {
    if (window.EarningsCalendarFeed) return;
    var BASE = 'https://goodbyestar.cloud/earnings-calendar';
    var TTL_MS = 60 * 1000;
    var cache = {};
    var calendarStatus = {};
    function month(year, monthNum) {
      var key = year + '-' + monthNum;
      var hit = cache[key];
      if (hit && (hit.inflight || Date.now() - hit.at < TTL_MS)) return hit.promise;
      var promise = window.NineHttp.json(BASE + '?year=' + year + '&month=' + monthNum, {timeoutMs:15000})
        .then(function (data) {
          calendarStatus[key] = {state:'ok', health:data && data.calendarHealth};
          var rows = Array.isArray(data) ? data : (data && data.data) || [];
          cache[key] = { promise: Promise.resolve(rows), at: Date.now(), inflight: false };
          return rows;
        })
        .catch(function () {
          calendarStatus[key] = {state:'error'};
          delete cache[key];
          return [];
        });
      cache[key] = { promise: promise, at: Date.now(), inflight: true };
      return promise;
    }
    window.EarningsCalendarFeed = { month: month, status: function (year, monthNum) { return calendarStatus[year + '-' + monthNum] || {state:'pending'}; } };
  }());

  /* ���� /market-board ���� �δ� ����
     Ȩ ���� ���(�Ʒ� loadHomeUsSummary)�� �ǽð� ������(home-realtime-table.js)�� ����
     market=us|domestic �����͸� limit=20 / limit=40���� ���� �θ��� ���� ��ģ��. �� �����
     ���� ��û Ǯ(__homeMarketBoardRequests)������ limit������ 30�� â�� �����ϰ� �� ����
     ĳ�� Ű �и��� �ݵ� �̽� �ߺ��� ���ش�. home-realtime-table.js�� ���߿� ���� �̸�����
     �ڱ� ������ �÷��� Ǯ��limit�� ������ ȣȯ�ȴ�. */
  (function () {
    if (window.HomeMarketBoard) return;
    var BASE = 'https://goodbyestar.cloud/market-board';
    var LIMIT = 40;
    var REFRESH_MS = 30 * 1000;
    var REQUEST_TIMEOUT_MS = 12000;
    var pool = window.__homeMarketBoardRequests || (window.__homeMarketBoardRequests = {});
    function fetchBoard(market, force) {
      var key = market === 'us' ? 'us' : 'domestic';
      var entry = pool[key] || (pool[key] = {});
      if (!force && entry.data && Date.now() - entry.updatedAt < REFRESH_MS) return Promise.resolve(entry.data);
      if (entry.promise) return entry.promise;
      entry.promise = window.NineHttp.json(BASE + '?market=' + key + '&limit=' + LIMIT + (force ? '&fresh=1' : ''), {timeoutMs:REQUEST_TIMEOUT_MS})
        .then(function (json) { entry.data = json; entry.updatedAt = Date.now(); return json; });
      entry.promise.then(function () { entry.promise = null; }, function () { entry.promise = null; });
      return entry.promise;
    }
    window.HomeMarketBoard = { fetch: fetchBoard };
  }());

  /* ���� iframe ��� ���� (��� �ȿ��� ���� �� ������ ����) ���� */
  if (window !== window.top) {
    document.body.classList.add('iframe-mode');
  }

  /* �ü������ÿµ� �������� ���� �ð� ������ �������� ������ �񵿱�� DOM��
     ���� �ڿ��� ����Ǿ�� �ϹǷ� ���� ���� ���� �ε��Ѵ�. */
  (function loadDashboardEnhancements() {
    // Ȩ���� ��ϡ����� ���������� ��Ʈ Ȯ�� ����� ���� �� �߰� JS/CSS��
    // �������� �ʴ´�. ��Ʈ/�м� ȭ�鿡���� �ε��� ù ȭ�� ��û ���� ���δ�.
    if (!/\/(?:page|pages)\/(?:market-temp|stock-search|foreign-flow|overnight-market|strategy-search|pattern-scan)(?:\/|$)/i.test(location.pathname)) return;
    if (document.querySelector('script[data-dashboard-enhancements]')) return;
    var script = document.createElement('script');
    script.src = 'https://goodbyestarwars.github.io/tistory-ticker/js/dashboard-enhancements.js?v=20261105-chart-expand-segment';
    script.defer = true;
    script.setAttribute('data-dashboard-enhancements', '1');
    document.body.appendChild(script);
  })();

  /* Dedicated MY screen: reuse the existing /page/watchlist Tistory page and
     append portfolio/holding analysis without changing other pages. */
  (function loadMyDashboard() {
    if (!/^\/(?:page|pages)\/watchlist\/?$/.test(location.pathname)) return;
    var cssHref = 'https://goodbyestarwars.github.io/tistory-ticker/css/my-dashboard.css?v=20261115-my-analysis';
    if (!document.querySelector('link[data-my-dashboard-css]')) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = cssHref;
      link.setAttribute('data-my-dashboard-css', '1');
      document.head.appendChild(link);
    }
    // 2026-09-15: MY �Ź��밡 ����м��� ���� �׷���(foreign-flow.css�� .ff-apt-simple, ����
    // :is(#foreign-flow, .ff-vp-host))�� ����. �� ��Ÿ�Ͻ�Ʈ�� ����м� ������ ���������� �ҷ��Ծ���.
    if (!document.querySelector('link[data-foreign-flow-css]')) {
      var ffLink = document.createElement('link');
      ffLink.rel = 'stylesheet';
      ffLink.href = 'https://goodbyestarwars.github.io/tistory-ticker/css/foreign-flow.css?v=20261115-vp-overlay';
      ffLink.setAttribute('data-foreign-flow-css', '1');
      document.head.appendChild(ffLink);
    }
    if (document.querySelector('script[data-my-dashboard]')) return;
    var script = document.createElement('script');
    script.src = 'https://goodbyestarwars.github.io/tistory-ticker/js/my-dashboard.js?v=20261115-my-analysis';
    script.defer = true;
    script.setAttribute('data-my-dashboard', '1');
    document.body.appendChild(script);
  })();

  /* �ֿ� ����(/pages/main-news): �ѱ����̱� ������ �� �ٱ�� �����ִ� ���� ����.
     Ƽ���丮 ������ ������ �ƹ��͵� ��� �ǵ��� mount���� ���⼭ ����� - ����ڴ�
     �ּҸ� ���� �� �������� �ϳ� ����� �ǰ�, ���� HTML�� ������ �ʿ䰡 ����
     (loadMyDashboard�� ���� ����).

     2026-09-05: ���̴� �ڸ��� ���ƴ�. ������ `.feed`�� ��� append �ؼ� **�� ��ü ��**,
     �׷��ϱ� ������ ���������� ��ư �Ʒ� ȭ�� �� �ؿ� �پ���(�����: "��ġ�� �̻���").
     ���̺� HTML ������ �̷���.
       section.feed > article.post-single > div.post-single-body
         > ����(adsbygoogle) > div.contents_style(����) > div.container_postbtn(����������)
     ������ `.contents_style`�̹Ƿ� �ű⿡ �־�� ���� �ڡ���ư ���̶�� ���ڸ��� �´�.
     ����ڰ� ������ ������ <div id="main-news"></div>�� ���� ������ �װ͵� �� �ȿ�
     ���Ƿ� ����� ����. */
  (function loadMainNews() {
    if (!/^\/(?:page|pages)\/main-news\/?$/.test(location.pathname)) return;
    if (!document.querySelector('link[data-main-news-css]')) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
    link.href = 'https://goodbyestarwars.github.io/tistory-ticker/css/main-news.css?v=20261116-free-official-v1';
      link.setAttribute('data-main-news-css', '1');
      document.head.appendChild(link);
    }
    if (!document.querySelector('#main-news')) {
      var mount = document.createElement('div');
      mount.id = 'main-news';
      // querySelector�� �����͸� ��ǥ�� �����ϸ� "��� ����"�� �ƴ϶� "���� ����"��
      // ù ��Ҹ� �����ش� - .post-single-body�� .contents_style�� �θ�� �װ� ����
      // ������ �ٽ� �� �� �ڿ� �پ���. �켱������ ��Ű���� �ϳ��� ã�ƾ� �Ѵ�.
      var hostSelectors = ['.contents_style', '.post-single-body', '.entry-content', '.article-view', '.feed'];
      var host = null;
      for (var i = 0; i < hostSelectors.length && !host; i++) {
        host = document.querySelector(hostSelectors[i]);
      }
      (host || document.body).appendChild(mount);
    }
    if (document.querySelector('script[data-main-news]')) return;
    var script = document.createElement('script');
    script.src = 'https://goodbyestarwars.github.io/tistory-ticker/js/main-news.js?v=20261116-free-official-v1';
    script.defer = true;
    script.setAttribute('data-main-news', '1');
    document.body.appendChild(script);
  })();

  /* ���� ������(������ǥ �ǵ顤���ÿµ�)�� ����� ���� ī�� UI(2026-10-16). 767px ���Ͽ����� �ҷ��´� - PC���º�����
     ���� ��ü�� ���� �����Ƿ� ȭ���� �޶����� �ʴ´�. ���� ��ҡ������ʹ� �״�� �ΰ� ī�塤���������� ��´�.
     js/mobile-market.js, css/mobile-market.css, docs/UI_GUIDE.md '���� ����� ī�� UI' */
  (function loadMobileMarket() {
    if (!/^\/(?:page|pages)\/(?:market-temp|kospi-futures|overnight-market)\/?$/i.test(location.pathname)) return;
    if (!window.matchMedia || !window.matchMedia('(max-width: 767px)').matches) return;
    if (document.querySelector('script[data-mobile-market]')) return;
    var ASSET_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/';
    var version = '20261016-mobile-cards';
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = ASSET_BASE + 'css/mobile-market.css?v=' + version;
    link.setAttribute('data-mobile-market-css', '1');
    document.head.appendChild(link);
    var script = document.createElement('script');
    script.src = ASSET_BASE + 'js/mobile-market.js?v=' + version;
    script.defer = true;
    script.setAttribute('data-mobile-market', '1');
    document.body.appendChild(script);
  })();

  loadMobileTabs(); // ���Ǵ� ���� ���� - ��ȸ�� Ȩ�� ����

  /* ���ÿµ�(/page/market-temp): Ƽ���丮 ������ ������ <script>/<link>�� ���� �־
     �ֽ� �ȷ�Ʈ������ �ð�ȭ���ܱ��帧 �׷����� ����ǵ��� ��Ų���� �� �� �� �����Ѵ�. */
  (function loadMarketTempPage() {
    if (!/^\/(?:page|pages)\/market-temp\/?$/.test(location.pathname)) return;
    var ASSET_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/';
    var version = '20261116-map-readable-v3';
    if (!document.querySelector('link[data-market-temp-css]')) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = ASSET_BASE + 'css/market-temp.css?v=' + version;
      link.setAttribute('data-market-temp-css', '1');
      document.head.appendChild(link);
    }
    if (!document.querySelector('#market-temp')) {
      var mount = document.createElement('div');
      mount.id = 'market-temp';
      var hostSelectors = ['.contents_style', '.post-single-body', '.entry-content', '.article-view', '.feed'];
      var host = null;
      for (var i = 0; i < hostSelectors.length && !host; i++) {
        host = document.querySelector(hostSelectors[i]);
      }
      (host || document.body).appendChild(mount);
    }
    if (document.querySelector('script[data-market-temp-dynamic]')) return;
    var script = document.createElement('script');
    script.src = ASSET_BASE + 'js/market-temp.js?v=' + version;
    script.defer = true;
    script.setAttribute('data-market-temp-dynamic', '1');
    script.addEventListener('load', function () {
      if (window.MarketTemp && typeof window.MarketTemp.init === 'function') window.MarketTemp.init();
    });
    document.body.appendChild(script);
  })();

  /* ������ǥ ���� ����(/pages/kospi-futures = ����, /pages/overnight-market = �۷ι�).

     2026-09-06 ��û: �� �������� �ڽ��ǡ��ڽ����� ���� ��� �־� �ߺ��̶�� ����. �� ���鿡��
     ��ư���� ������ �ϰ�, �۷ι� �� �ڽ��ǡ��ڽ��� ī��� ����(js/overnight-market.js CATEGORIES).

     �ּҴ� �� �� ��� �д� - ���� ��ũ���ϸ�ũ��Ƽ���丮 �������� �״�� �����ϰ�, ����
     �ּҰ� ù ���� ���Ѵ�. Ƽ���丮 ������ ������ �̹� ��� �ִ� mount�� �״�� ������
     �Ű� ���, ���� ���� ���⼭ �����.

     ���� �� ������ �� ����� init()�� �ٽ� �θ���. ������������ �����̳ʿ��� ����
     lightweight-charts�� 0x0���� ���� ������ �� ����ҿ��� ���� �� ����ߴµ�(�۾��̷�
     2026-08-14), ���̴� ���¿��� �ٽ� �׸��� �� ��θ� �ƿ� ���� �� �ִ�. �� ��� ���
     init()�� �ڱ� Ÿ�̸Ӹ� clearInterval�ϰ� WebSocket�� �ߺ� ������ �����Ƿ� ��ȣ����
     �����ϴ�. */
  (function loadMarketIndicatorTabs() {
    // �� ���� ���� ��Ʈ ���� ǥ�� ��Ģ. ��/�к����׸��� ����� �� ����� �����Ѵ�.
    window.MarketChartStyle = {
      height: 230,
      theme: function (dark) {
        return {
          layout: { background: { color: 'transparent' }, textColor: dark ? '#a6b5c5' : '#64748b',
            fontFamily: 'Pretendard Variable, Pretendard, Malgun Gothic, sans-serif', fontSize: 12, attributionLogo: false },
          grid: { vertLines: { visible: false }, horzLines: { visible: false } },
          rightPriceScale: { visible: true, borderVisible: false, scaleMargins: { top: .15, bottom: .15 } },
          timeScale: { visible: true, borderVisible: false }
        };
      }
    };
    var ASSET_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/';
    var CSS_URL = ASSET_BASE + 'css/market-indicators.css?v=20261110-panel-spacing';
    var TABS = [
      {
        key: 'domestic', label: '���� ������ǥ', slug: 'kospi-futures',
        mountIds: ['domestic-market-indicators', 'kospi-futures'],
        globalName: 'KospiFutures',
        script: ASSET_BASE + 'js/kospi-futures.js?v=20261025-tab-explainers',
        // kospi-futures.js��domestic-market-indicators.js�� �ڱ� CSS�� ������ �ִ´�. �����ڱ� ǥ(indicator-board)�� ���⼭ �̸� �ִ´�.
        styles: [ASSET_BASE + 'css/indicator-board.css?v=20261016-no-gross']
      },
      {
        key: 'investor', badge: '���� ����', label: '���� ������ ����', slug: 'domestic-market-indicators',
        mountIds: ['domestic-investor-flow'], globalName: 'DomesticMarketIndicators', method: 'initInvestor',
        script: ASSET_BASE + 'js/domestic-market-indicators.js?v=20261110-no-summaries',
        styles: [ASSET_BASE + 'css/indicator-board.css?v=20261016-no-gross']
      },
      {
        key: 'global', label: '�۷ι� ������ǥ', slug: 'overnight-market',
        mountIds: ['overnight-market'],
        globalName: 'OvernightMarket',
        script: ASSET_BASE + 'js/overnight-market.js?v=20261110-no-summaries',
        // 2026-09-06 ����Ʈ("�۷ι� ������ǥ CSS ���°� ������ �޶�"): overnight-market.js��
        // �ڱ� CSS�� �� �ִ´� - ���� Ƽ���丮 ������ ������ <link>�� ���� �־���.
        // �׷��� ���� �ּҿ��� �۷ι� ���� ���� ��Ÿ�� ���� �׷�����. ���⼭ �־��ش�.
        styles: [ASSET_BASE + 'css/overnight-market.css?v=20261110-market-badges', ASSET_BASE + 'css/indicator-board.css?v=20261012-board']
      },
      {
        key: 'us-macro', badge: '��ǥ �ڷ�', label: '�ֿ� �̱� ��ǥ', slug: 'us-macro-indicators',
        mountIds: ['us-macro-indicators'],
        globalName: 'UsMacroIndicators',
        script: ASSET_BASE + 'js/us-macro-indicators.js?v=20261025-tab-explainers',
        styles: [ASSET_BASE + 'css/us-macro-indicators.css?v=20261025-tab-explainers', ASSET_BASE + 'css/indicator-board.css?v=20261012-board']
      },
      {
        key: 'crypto', badge: '�����ڻ� �ü�', label: '�����ڻ�', slug: 'crypto-market',
        mountIds: ['crypto-market'], globalName: 'CryptoMarket',
        script: ASSET_BASE + 'js/crypto-market.js?v=20261115-crypto-live',
        styles: [ASSET_BASE + 'css/overnight-market.css?v=20261110-market-badges',
          ASSET_BASE + 'css/crypto-market.css?v=20261025-tab-explainers', ASSET_BASE + 'css/indicator-board.css?v=20261012-board']
      },
      {
        // 2026-10-11: �ѱ����������� �Ϻ� ���� ����ȯ��. ����Ʈ(#fx-rates)�� �Ʒ� build()�� ����� - skin.html ���� ����.
        // ?tab=fx �� �� ���� �ٷ� �� �� �ִ�. �ǽð� ��/�޷��� �۷ι� ������ǥ ���� �״�� ����Ѵ�.
        key: 'fx', badge: '�Ϻ� ����', label: 'ȯ��', slug: 'fx-rates',
        mountIds: ['fx-rates'], globalName: 'FxRates',
        script: ASSET_BASE + 'js/fx-rates.js?v=20261025-tab-explainers',
        styles: [ASSET_BASE + 'css/fx-rates.css?v=20261025-plain-explainer-notes']
      }
    ];
    var matched = /^\/(?:page|pages)\/(kospi-futures|overnight-market)\/?$/i.exec(location.pathname);
    if (!matched) return;
    var slug = matched[1].toLowerCase();
    var initialKey = TABS.filter(function (tab) { return tab.slug === slug; })[0].key;
    var wantedTab = /[?&]tab=([a-z-]+)/i.exec(location.search);
    if (wantedTab && TABS.some(function (tab) { return tab.key === wantedTab[1].toLowerCase(); })) initialKey = wantedTab[1].toLowerCase();

    /* �̹� ���� ������ ����Ű�� <link>�� ������(Ƽ���丮 ������ ������ ���� �ִ� ���)
       �ߺ����� ���� �ʴ´�. ���ϸ��� ���� �Ǵ��Ѵ� - ?v= ���� ���� �ٸ� �� �ִ�. */
    function ensureStyle(href, key) {
      var file = href.split('?')[0].split('/').pop();
      if (document.querySelector('link[data-mi-css="' + key + '"]')) return;
      if (document.querySelector('link[href*="/css/' + file + '"]')) return;
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.setAttribute('data-mi-css', key);
      document.head.appendChild(link);
    }

    function tabByKey(key) {
      return TABS.filter(function (tab) { return tab.key === key; })[0] || null;
    }

    /* �̹� ������ ������ �ִ� <script>�� ����� �Ѵ�. Ƽ���丮 ������ HTML�� �ڱ� �����
       �ҷ����� ���� �� �ִµ�, ���⼭ ���� ������ �� ������ ��� IIFE�� �� �� ����. */
    function ensureScript(tab) {
      if (tab.key === 'investor' && window.DomesticMarketIndicators) return false;
      if (tab.key === 'investor') {
        var pending = document.querySelector('script[data-mi-script="investor"], script[src*="/js/domestic-market-indicators.js"]');
        if (pending) {
          pending.addEventListener('load', function () { activate('investor', true); }, { once: true });
          return true;
        }
      }
      if (document.querySelector('script[data-mi-script="' + tab.key + '"]')) return;
      var expectedSrc = tab.script;
      var existing = Array.prototype.slice.call(document.querySelectorAll('script[src*="/js/' + tab.slug + '.js"]'));
      var sameVersion = existing.some(function (node) { return node.src === expectedSrc; });
      if (sameVersion) return;
      var script = document.createElement('script');
      script.src = tab.script;
      script.defer = true;
      script.setAttribute('data-mi-script', tab.key);
      if (tab.key === 'investor') script.onload = function () { activate('investor', true); };
      document.body.appendChild(script);
      return true;
    }

    var historyModuleJob = null;
    function historyReady(key) {
      if (!historyModuleJob) historyModuleJob = new Promise(function (resolve) {
        if (window.MarketChartHistory) { resolve(); return; }
        var script = document.createElement('script');
        script.src = ASSET_BASE + 'js/market-history.js?v=20261008-5y';
        script.onload = script.onerror = resolve;
        document.head.appendChild(script);
      });
      return historyModuleJob.then(function () {
        var archive = window.MarketChartHistory ? window.MarketChartHistory.load(key === 'us-macro' ? 'macro' : key) : Promise.resolve(false);
        if (key !== 'us-macro' || (window.OvernightMarket && window.OvernightMarket.cryptoTools)) return archive;
        return Promise.all([archive, new Promise(function (resolve) {
          var script = document.createElement('script');
          script.src = ASSET_BASE + 'js/overnight-market.js?v=20261110-no-summaries';
          script.onload = script.onerror = resolve; document.head.appendChild(script);
        })]);
      });
    }
    function activate(key, ready) {
      if (!ready) { historyReady(key).then(function () {
        var panel = document.querySelector('.mi-panel[data-mi-panel="' + key + '"]');
        if (panel && !panel.hidden) activate(key, true);
      }); return; }
      var tab = tabByKey(key);
      if (!tab) return;
      if (ensureScript(tab)) return; // �ֽ� ��ũ��Ʈ�� ������ ����� ������ init�Ѵ�.
      var module = window[tab.globalName];
      var method = tab.method || 'init';
      if (module && typeof module[method] === 'function') {
        module[method]();
      }
    }

    function select(key) {
      TABS.forEach(function (tab) {
        var on = tab.key === key;
        var panel = document.querySelector('.mi-panel[data-mi-panel="' + tab.key + '"]');
        if (panel) panel.hidden = !on;
        var button = document.querySelector('.mi-tab[data-mi-tab="' + tab.key + '"]');
        if (button) {
          button.classList.toggle('active', on);
          button.setAttribute('aria-selected', on ? 'true' : 'false');
        }
      });
      activate(key);
    }

    function build() {
      if (document.querySelector('[data-mi-tabs]')) return;
      // ������ ��� �ִ� mount�� ���������� ��´�. �� �� ������ �� ������ �ƴϴ�.
      var anchor = null;
      for (var i = 0; i < TABS.length && !anchor; i++) {
        for (var j = 0; j < TABS[i].mountIds.length && !anchor; j++) {
          anchor = document.getElementById(TABS[i].mountIds[j]);
        }
      }
      if (!anchor || !anchor.parentNode) return;

      ensureStyle(CSS_URL, 'tabs');
      // �� ���� CSS�� ó������ ���� �ִ´�. ���� ���� ���� ������ ��Ÿ�� ���� ȭ����
      // �� �� ���� ��������(FOUC).
      TABS.forEach(function (tab) {
        (tab.styles || []).forEach(function (href) { ensureStyle(href, tab.key); });
      });

      var wrap = document.createElement('div');
      wrap.className = 'mi-wrap';
      anchor.parentNode.insertBefore(wrap, anchor);

      var bar = document.createElement('div');
      bar.className = 'mi-tabs';
      bar.setAttribute('data-mi-tabs', '1');
      bar.setAttribute('role', 'tablist');
      wrap.appendChild(bar);

      TABS.forEach(function (tab) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'mi-tab';
        button.textContent = tab.label;
        button.setAttribute('data-mi-tab', tab.key);
        button.setAttribute('role', 'tab');
        bar.appendChild(button);

        var panel = document.createElement('div');
        panel.className = 'mi-panel';
        panel.setAttribute('data-mi-panel', tab.key);
        wrap.appendChild(panel);
        if (tab.badge) {
          var badge = document.createElement('div');
          badge.className = 'om-live-status';
          badge.textContent = tab.badge;
          panel.appendChild(badge);
        }
        tab.mountIds.forEach(function (id) {
          var mount = document.getElementById(id);
          if (!mount) {
            mount = document.createElement('div');
            mount.id = id;
          }
          panel.appendChild(mount);
        });
      });

      bar.addEventListener('click', function (event) {
        var button = event.target && event.target.closest ? event.target.closest('[data-mi-tab]') : null;
        if (button) select(button.getAttribute('data-mi-tab'));
      });

      select(initialKey);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', build);
    } else {
      build();
    }
  })();

  /* Ȩ�� ���� ����/API�� ���� ��Ȳ�� ������ ���ġ�Ѵ�. �鿣�� ���� URL�� �״�� �ΰ�,
     ���⼭�� ī�� ��ġ����� ���衤���� ��ȣ ��� ��Ģ���� ����Ѵ�. */
  (function buildHomeDashboard() {
    if (location.pathname !== '/' && location.pathname !== '') return;

    var feed = document.querySelector('.feed');
    var investorMount = document.getElementById('investor-trend-widget');
    var rankMount = document.getElementById('sidebar-rank');
    if (!feed) return;

    window.HomeMarketSelection = window.HomeMarketSelection || (function () {
      var selected = null;
      // 2026-09-05: ���� ���� js/skin-shell.js�� MarketHours �ϳ��� ����. ������ ��
      // �ȿ� ���� �ھƵ״µ� ���� ������ ���ϸ��� �ٸ� ���� ������ �־���(�̱� ��ȯ
      // 17:00/20:30, ���� â ��09:00/��07:00), ��߳��� �������� ������ ȭ���� ������.
      // skin.html�� skin-shell.js�� �� ���Ϻ��� ���� defer�� �θ��Ƿ� �׻� �����Ѵ�.
      function autoMarket() {
        var hours = window.MarketHours;
        return hours ? hours.homeMarket() : 'domestic';
      }
      return {
        get: function () { return selected || autoMarket(); },
        set: function (market) {
          market = market === 'us' || market === 'closed' ? market : 'domestic';
          if (selected === market) return;
          selected = market;
          window.dispatchEvent(new CustomEvent('home-market-change', { detail: { market: market } }));
        }
      };
    })();

    var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
    var CALENDAR_SCRIPT_URL = 'https://goodbyestarwars.github.io/tistory-ticker/js/stock-calendar.js?v=20261004-econ-sp100-v1';
    var HOME_WIDGETS_SCRIPT_URL = document.currentScript && document.currentScript.src
      ? document.currentScript.src.replace(/skin-main(?:\.min)?\.js(?:\?.*)?$/, 'home-widgets.js?v=20261113-linked-futures')
      : 'https://goodbyestarwars.github.io/tistory-ticker/js/home-widgets.js?v=20261113-linked-futures';
    var HOME_CHART_HOVER_SCRIPT_URL = 'https://goodbyestarwars.github.io/tistory-ticker/js/home-chart-hover.js?v=20261018-hover';
    var HOME_INVESTOR_FLOW_SCRIPT_URL = 'https://goodbyestarwars.github.io/tistory-ticker/js/investor-flow.js?v=20261116-gross-contracts';
    var HOME_REALTIME_TABLE_SCRIPT_URL = 'https://goodbyestarwars.github.io/tistory-ticker/js/home-realtime-table.js?v=20261020-board-metrics';
    var HOME_ECONOMIC_NEWS_SCRIPT_URL = 'https://goodbyestarwars.github.io/tistory-ticker/js/home-economic-news.js?v=20261116-free-official-v1';
  var HOME_WEEKLY_REPORT_SCRIPT_URL = 'https://goodbyestarwars.github.io/tistory-ticker/js/home-weekly-report.js?v=20261027-block-subtitles';

    function isWeekendReportWindow() {
      // 2026-08-22: HomeMarketSelection�� ���� ����(����� 07:00~������ 06:00)��
      // ������ ���� ���� - ������ 06:00/07:00���� ��¦ ��߳� �־���.
      var kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
      var day = kst.getUTCDay();
      var hour = kst.getUTCHours();
      return (day === 6 && hour >= 7) || day === 0 || (day === 1 && hour < 6);
    }

    function escapeHomeHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function fetchHomeJson(url, timeoutMs) {
      return window.NineHttp.json(url, { timeoutMs: timeoutMs || 15000 });
    }

    function readHomeDataCache(key, maxAgeMs) {
      try {
        var cached = JSON.parse(localStorage.getItem(key) || 'null');
        if (!cached || !cached.data || !cached.savedAt) return null;
        if (Date.now() - Number(cached.savedAt) > maxAgeMs) return null;
        return cached.data;
      } catch (error) {
        return null;
      }
    }

    function writeHomeDataCache(key, data) {
      try {
        localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data: data }));
      } catch (error) {
        /* ���� ������ ������ �̹� ���丸 ǥ���Ѵ�. */
      }
    }

    function loadHomeScript(src, globalName) {
      if (window[globalName]) return Promise.resolve(window[globalName]);
      return new Promise(function (resolve, reject) {
        var existing = document.querySelector('script[data-home-source="' + src + '"]');
        var settled = false;
        var timeout = setTimeout(function () {
          finish(new Error(globalName + ' ��ũ��Ʈ �ε� �ð� �ʰ�'));
        }, 10000);

        function finish(error) {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (error) reject(error);
          else resolve(window[globalName]);
        }

        function bind(script) {
          script.addEventListener('load', function () {
            script.setAttribute('data-home-state', 'loaded');
            finish(window[globalName] ? null : new Error(globalName + ' ��� ����'));
          }, { once: true });
          script.addEventListener('error', function () {
            script.setAttribute('data-home-state', 'error');
            finish(new Error(globalName + ' ��ũ��Ʈ �ε� ����'));
          }, { once: true });
        }

        if (existing) {
          if (existing.getAttribute('data-home-state') === 'loaded') {
            finish(window[globalName] ? null : new Error(globalName + ' ��� ����'));
            return;
          }
          if (existing.getAttribute('data-home-state') === 'error') existing.remove();
          else {
            bind(existing);
            return;
          }
        }
        if (window[globalName]) {
          finish();
          return;
        }
        var script = document.createElement('script');
        script.src = src;
        script.defer = true;
        script.setAttribute('data-home-source', src);
        script.setAttribute('data-home-state', 'loading');
        bind(script);
        document.head.appendChild(script);
      });
    }

    function dashboardHtml() {
        return '<section class="home-dashboard home-editorial-page" aria-label="������ ���� ��Ȳ��">'
        + '<div class="home-market-toolbar">'
        + '<div class="home-market-switch" role="tablist" aria-label="���� ���� ��ȯ">'
        + '<button type="button" data-home-market-switch="domestic" role="tab"><span class="home-market-switch-icon" aria-hidden="true">????</span><span>�ѱ�����</span></button><button type="button" data-home-market-switch="us" role="tab"><span class="home-market-switch-icon" aria-hidden="true">????</span><span>�̱�����</span></button><button type="button" data-home-market-switch="closed" role="tab"><span class="home-market-switch-icon" aria-hidden="true">??</span><span>����</span></button>'
        + '</div><div class="home-switch-countdown" hidden role="timer" aria-live="off"></div></div>'
        + '<section class="home-closed-page" data-home-closed-page aria-label="���� ����" hidden>'
        + '<div class="home-closed-lead"><div class="home-closed-kicker"><span>MARKET CLOSED NOTE</span><div class="home-closed-title-row">'
        + '<svg class="home-closed-lock" viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
        + '<path d="M28 68 V45a22 22 0 0 1 44 0v23" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>'
        + '<rect x="14" y="64" width="72" height="60" rx="15" fill="none" stroke="currentColor" stroke-width="6"/>'
        + '<path d="M45 90a6 6 0 1 1 10 4l3 13h-16l3-13a6 6 0 0 1 0-4z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>'
        + '<path d="M61 83a7 7 0 0 1-10 3" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>'
        + '</svg>'
        + '<h1>Markets Closed</h1></div><p>�ָ����ѱ� �����Ͽ��� ���� ���ð� ���ϴ�. �̱� ���ô� ���� �ŷ��Ͽ� ��˴ϴ�.</p></div><a class="home-closed-status" href="/page/stock-calendar" aria-label="Ķ����"><strong>���� �ŷ����� �غ��ϴ� �ð��Դϴ�.</strong><span>���� �ŷ��Ϻ��� ���� �����Ͱ� ������Ʈ�˴ϴ�.</span><small>�������� ������ ���� ���� ȭ���� �� �ǿ��� Ȯ���� �� �ֽ��ϴ�.</small><span class="home-closed-link">Ķ���� ��</span></a></div>'
        + '</section>'
        + '<div class="home-overview-grid home-editorial-lead">'
        + '<section class="home-market-board editorial-section hmb2 home-block-column" id="homeMarketBoard">'
        + '<section class="home-market-overview ui-content-block"><div class="home-card-heading"><div><strong class="ui-section-title" data-home-market-field="title">���� ����</strong><span id="hmbUpdated">������ ������ �� �ü� Ȯ�� ��</span></div>'
        + '<div class="home-cb-wrap"><button type="button" class="vol-history-link" data-vol-open="all" data-vol-history hidden aria-expanded="false" aria-controls="volPanel">���� ������ �̷�</button><span class="home-market-live" data-home-market-field="live">�ǽð�</span></div></div>'
        + '<div class="hmb2-status" data-hmb-status>'
        + '<dl class="hmb-list hmb2-verdict">'
        + '<div class="hmb2-temp"><dt>���ÿµ�</dt><dd data-market-field="temperature">������ Ȯ�� ��</dd></div>'
        + '<div class="hmb2-direction"><dt>���� ����</dt><dd data-market-field="direction">������ Ȯ�� ��</dd></div>'
        + '<div class="hmb2-participation" data-home-participation aria-label="��� 100 ��� �ŷ���"></div>'
        + '<div class="hmb2-market-ratios" data-domestic-ratios>'
        + '<div class="hmb2-temp" data-domestic-ratio="KOSPI"><dt>�ڽ���</dt><dd>������ Ȯ�� ��</dd></div>'
        + '<div class="hmb2-temp" data-domestic-ratio="KOSDAQ"><dt>�ڽ���</dt><dd>������ Ȯ�� ��</dd></div></div>'
        + '<div class="hmb2-market-ratios" data-us-ratios hidden><div data-us-ratio="SP500"><dt>S&amp;P 500</dt><dd>������ Ȯ�� ��</dd></div><div data-us-ratio="NASDAQ"><dt>������ ����</dt><dd>������ Ȯ�� ��</dd></div><div data-us-ratio="SOX"><dt>�ʶ��Ǿ� �ݵ�ü</dt><dd>������ Ȯ�� ��</dd></div><span class="hmb2-breadth-total" data-us-breadth-meta>���� �������� �� �����ü�</span></div>'
        + '<div class="hmp-basis hmp-note" data-participation-basis></div>'
        + '</dl>'
        // 2026-11-04 �ֵ�/���� ����: ���� ���⡤���/�϶� �ٷ� �Ʒ�(�̱� ���). /us-sector-rotation(ETF Ȯ�� �Ϻ�) ���� ����.
        + '<div class="hus-rotation" data-home-us-rotation hidden>'
        + '<div class="hus-rot-col" data-us-rot="leaders"><strong>�ֵ� ���� <small>���ԡ��ֵ� �� ����� / �ŷ���� ����</small></strong><ul class="hus-rot-list"><li class="ui-kpi-empty">Ȯ�� ��</li></ul></div>'
        + '<div class="hus-rot-col" data-us-rot="cautions"><strong>���� ���� <small>��ȭ����Ż �� ����� / �ŷ���� ����</small></strong><ul class="hus-rot-list"><li class="ui-kpi-empty">Ȯ�� ��</li></ul></div>'
        + '<p class="ui-kpi-source" data-us-rot-meta>������ ���� ETF ��� �� ������ ���� ����</p></div>'
        + '<div class="hus-rotation hkr-rotation" data-home-kr-rotation hidden aria-label="���� �ֵ������� ����">'
        + '<div class="hus-rot-col" data-kr-rot="leaders"><strong>�ֵ� ���� <small>���� ��� �����</small></strong><ul class="hus-rot-list"><li class="ui-kpi-empty">Ȯ�� ��</li></ul></div>'
        + '<div class="hus-rot-col" data-kr-rot="cautions"><strong>���� ���� <small>���� ��� �����</small></strong><ul class="hus-rot-list"><li class="ui-kpi-empty">Ȯ�� ��</li></ul></div>'
        + '<p class="ui-kpi-source">���� ���� �з� ���� ǥ�� �� ����� �ܼ���� �� ���� ����</p></div>'
        // 2026-10-15 ���� ������ �����: CB�����̵�ī��VI�� �� ���� ���� ǥ���ϰ� ������ �󼼸� ����(homeCircuitBreakerBadges�� ä���).
        + '<div class="vol-monitor" data-vol-monitor hidden></div>'
        + '</div>'
        + '</section><div class="home-index-strip" aria-label="��ǥ ���� ����">'
        + '<article class="home-index-card" data-home-index-slot="primary">'
        + '<div class="home-index-top"><strong data-index-field="label">KOSPI</strong><span data-index-field="status">�� Ȯ�� ��</span></div>'
        + '<div class="home-index-price-row"><strong data-index-field="price">-</strong><em data-index-field="change">-</em></div>'
        + '<div class="home-index-chart" data-index-field="chart" aria-hidden="true"></div>'
        + '</article>'
        + '<article class="home-index-card" data-home-index-slot="secondary">'
        + '<div class="home-index-top"><strong data-index-field="label">KOSDAQ</strong><span data-index-field="status">�� Ȯ�� ��</span></div>'
        + '<div class="home-index-price-row"><strong data-index-field="price">-</strong><em data-index-field="change">-</em></div>'
        + '<div class="home-index-chart" data-index-field="chart" aria-hidden="true"></div>'
        + '</article>'
        // �̱� �� ��° ī��� ���� ��/���� �� �ٿ�30 ����, ���� �ŷ� �� SOX�� �ڵ� ��ȯ�Ѵ�.
        + '<article class="home-index-card" data-home-index-slot="tertiary" hidden>'
        + '<div class="home-index-top"><strong data-index-field="label">�ʶ��Ǿ� �ݵ�ü</strong><span data-index-field="status">�� Ȯ�� ��</span></div>'
        + '<div class="home-index-price-row"><strong data-index-field="price">-</strong><em data-index-field="change">-</em></div>'
        + '<div class="home-index-chart" data-index-field="chart" aria-hidden="true"></div>'
        + '</article>'
        + '</div>'
        // 2026-11-07 ����� ��û: ���� ����� '���� �ٽ� ��ǥ'�� ���� ������ ������ �� �ڸ��� �ΰ�,
        // KOSPI200 �ְ������� ���� ���մ��� �Ʒ� '���� ���� ��ǥ'(#homeMarketAux)�� �ű��.
        + '<section class="home-market-summary ui-content-block"><div class="hmb-summary-head"><strong class="ui-section-title" data-home-summary-field="title">������ ����</strong><span data-home-summary-field="meta">�ֽ� ������</span></div>'
        + '<dl class="hmb-list hmb2-core">'
        + '<div class="hmb-investor-trend" data-home-investor-trend aria-label="KOSPI KOSDAQ ���� ���� ���ż� ��">'
        + '<div class="hmb-investor-trend-head"><dt>������ ����</dt>'
        + '<div class="hmb-investor-mini-legend" data-home-investor-mini-legend><span class="hmb-mini-period">���� ���� ���ż�</span>'
        + '<span class="is-foreign"><i aria-hidden="true"></i>�ܱ���</span><span class="is-inst"><i aria-hidden="true"></i>���</span>'
        + '<span class="is-indiv"><i aria-hidden="true"></i>����</span></div>'
        + '<small class="hmb-investor-mini-fallback" data-home-investor-mini-fallback>���� ����: ����ݾ� �� �� ���� ���� ����</small></div>'
        + '<div class="hmb-investor-trend-body"><span class="hmb-investor-loading">������ Ȯ�� ��</span></div>'
        + '</div>'
        + '</dl>'
        // 2026-11-04 �۷ι� ����(�̱� ���): ��ǥ 4�� + ���� ���� 3��. ���� renderHomeGlobalBlock�� /futures �������� ä���.
        + '<div class="hgl" data-home-global hidden><div class="ui-kpi-grid hgl-metrics">'
        + ['WTI|WTI ����', 'USDKRW|��/�޷�', 'US10Y|�̱� 10�⹰', 'VIX|VIX ������'].map(function (def) {
          var p = def.split('|');
          return '<article class="ui-kpi-tile" data-global-tile="' + p[0] + '"><div class="ui-kpi-top"><strong>' + p[1] + '</strong></div>'
            + '<div class="ui-kpi-value-row"><strong data-global-field="price">-</strong><em data-global-field="change">-</em></div>'
            + '<small class="ui-kpi-source" data-global-field="time">Ȯ�� ��</small></article>';
        }).join('')
        + '</div></div></section>'
        // 2026-10-05 ����� ��û("�̱����� �ؿ� S&P ETF �� �ֿ� ETF ���ͷ�, ĭ�� ���缭 �̴ϸ��ϰ�"): �̱� ��忡����.
        // ���� �Ӹ��� �Ʒ� ETF 8���� 1�ϡ�1������YTD �� ǥ�� ǥ���Ѵ�. ���� ���� /us-etf-returns.
        + '<div class="hmb-etf ui-content-block" data-home-us-etfs hidden><div class="hmb-summary-head"><strong class="ui-section-title">�ֿ� ETF ���ͷ�</strong><span data-home-us-etfs-meta>1�� �� 1���� �� 3���� �� 6���� �� ���� ����</span></div>'
        + '<div class="hmb-etf-table-wrap"><table class="hmb-etf-table" aria-label="�ֿ� �̱� ETF ���ͷ� ��">'
        + '<thead><tr><th scope="col">ETF</th><th scope="col">1��</th><th scope="col">1����</th><th scope="col">3����</th><th scope="col">6����</th><th scope="col">YTD</th></tr></thead>'
        + '<tbody data-home-us-etfs-list></tbody></table></div></div>'
        + '<section class="home-top-disclosures ui-content-block" aria-label="�������� �ְ� ����" data-home-disclosure-section hidden>'
        + '<div class="home-top-disclosures-head"><strong class="ui-section-title" data-home-disclosure-field="title">�������� �ְ� ����</strong><span data-home-disclosure-field="meta">�ֱ� 7��</span></div>'
        + '<div class="home-disclosure-list" id="homeDisclosureList"><p class="home-card-state">���ø� Ȯ���ϴ� ��...</p></div>'
        + '</section>'
        + '</section>'
        + '<section class="home-economic-news editorial-section home-block-column" id="homeEconomicNews" aria-label="�ǽð� ���� ���մ���">'
        + '<div class="home-economic-disclosures-slot" data-home-disclosure-slot></div>'
        + '<section class="home-economic-content ui-content-block"><div class="hen-head"><div><strong class="ui-section-title">���� ���մ���</strong><span data-hen-session>���� �� �ǽð� Ÿ�Ӷ���</span></div><small class="nt-stamp" data-hen-updated>�ֽ� ���� Ȯ�� ��</small></div>'
        + '<div class="hen-breaking" data-hen-breaking aria-label="�߿� ���� �Ӻ�" hidden>'
        + '<div class="hen-breaking-head"><strong>�Ӻ�</strong><span>���� �� �Žð��� �� �ݸ�</span></div>'
        + '<div class="hen-breaking-list" data-hen-breaking-list></div>'
        + '</div>'
        + '<div class="hen-list" data-hen-list><p class="home-card-state"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>���� ������ �ҷ����� ���Դϴ�.</p></div>'
        + '</section>'
        // 2026-11-04 �ڽ���200 �߰����� ���� ī��: ���� ���մ��� �ٷ� �Ʒ�(���� ��, �̱� ��忡����). ���� data-market-field����Ʈ ����� �״�� �Ű��.
        + '<section class="home-night-content ui-content-block" data-home-night-futures hidden aria-label="KOSPI200 �߰�����"><div class="hmb-summary-head"><strong class="ui-section-title">KOSPI200 �߰�����</strong><span data-night-field="status">Ȯ�� ��</span></div>'
        + '<div class="ui-kpi-value-row"><strong data-market-field="nightFutures">������ Ȯ�� ��</strong></div>'
        + '<div class="ui-kpi-value-row hnc-change"><em data-night-field="change">-</em></div>'
        + '<dl class="hnc-range"><div><dt>����</dt><dd data-night-field="high">-</dd></div><div><dt>����</dt><dd data-night-field="low">-</dd></div></dl>'
        + '<div class="home-index-chart home-night-futures-chart" data-night-futures-chart aria-hidden="true"></div>'
        + '<small class="ui-kpi-source" data-night-field="time">���� �ð� Ȯ�� ��</small></section></section></div>'
        + '<section class="home-futures-pair" data-home-futures-pair aria-label="�ְ����� ���ݰ� �ð��� ������ ����">'
        + '<section class="home-futures-flow ui-content-block" data-home-futures-flow><div class="hmb-summary-head"><strong class="ui-section-title">KOSPI200 �ְ����� �� �ð��� �Ÿ�</strong><span data-futures-flow-total>���ż� �� ���</span></div>'
        + '<div class="hff-controls" data-no-swipe><div class="hmb-mode-segment" role="group" aria-label="���� ������ ����">'
        + [['all','3��ü ��'],['foreign','�ܱ���'],['institution','���'],['individual','����']].map(function (p) { return '<button type="button" data-futures-actor="'+p[0]+'" aria-pressed="'+(p[0]==='all')+'">'+p[1]+'</button>'; }).join('')
        + '</div><div class="hmb-mode-segment" role="group" aria-label="���� ���� ǥ��"><button type="button" data-futures-display="interval" aria-pressed="false">���� ����</button><button type="button" data-futures-display="cumulative" aria-pressed="true">���� ����</button></div></div>'
        + '<div data-futures-flow-bars><div class="hmb-investor-spark-empty">�ڷ� Ȯ�� ��</div></div>'
        + '<input class="hff-time" type="range" min="0" max="14" step="1" value="14" data-futures-time data-no-swipe aria-label="���ݰ� ������ ���� 30�� ����" disabled>'
        + '<div class="hff-linked-readout" data-futures-flow-readout aria-live="polite">���� �̷� ���</div>'
        + '<div data-futures-activity-table></div>'
        + '<small class="ui-kpi-source" data-futures-flow-meta>���� ��ü �� �ڷ� Ȯ�� ��</small></section>'
        // �ְ�/�߰� ������ ���� ī�� ���̾ƿ��� 30�� ���� ��Ʈ�� �����Ѵ�.
        + '<section class="home-market-aux home-night-content ui-content-block" id="homeMarketAux" data-home-market-aux data-home-day-futures aria-label="KOSPI200 �ְ�����"><div class="hmb-summary-head"><strong class="ui-section-title">KOSPI200 �ְ�����</strong><span data-home-day-field="status">Ȯ�� ��</span></div>'
        + '<div class="ui-kpi-value-row"><strong data-home-day-field="price">Ȯ�� ��</strong></div>'
        + '<div class="ui-kpi-value-row hnc-change"><em data-home-day-field="change">-</em></div>'
        + '<dl class="hnc-range"><div><dt>����</dt><dd data-home-day-field="high">-</dd></div><div><dt>����</dt><dd data-home-day-field="low">-</dd></div></dl>'
        + '<div class="home-index-chart home-night-futures-chart" data-home-day-chart></div>'
        + '<div class="hff-linked-readout" data-futures-price-readout aria-live="polite">���� ��¥�� ���� ���� �� ����</div>'
        + '<small class="ui-kpi-source" data-home-day-field="time">���ؽð� Ȯ�� ��</small></section>'
        + '</section>'
        + '<section class="home-realtime-board editorial-section" id="homeRealtimeBoard" aria-label="�ǽð� ������"></section>'
        + '</section>';
    }

    // 2026-10-10 ���� ���� ���� ���� ��Ÿ��. ��ũ���� ����� ���� �ٿ� ù �׸����� �� ������� ���´�.
    if (!document.querySelector('link[data-home-market-board-css]')) {
      var hmbCss = document.createElement('link');
      hmbCss.rel = 'stylesheet';
      hmbCss.href = 'https://goodbyestarwars.github.io/tistory-ticker/css/home-market-board.css?v=20261116-futures-activity';
      hmbCss.setAttribute('data-home-market-board-css', '1');
      document.head.appendChild(hmbCss);
    }
    var dashboard = document.createElement('div');
    dashboard.innerHTML = dashboardHtml();
    var dashboardSection = dashboard.firstElementChild;
    // Own the dependency at the asynchronous dashboard mount as well as in the skin.
    // The shared module guards duplicate loads and rebinds its existing timer.
    loadHomeScript('https://goodbyestarwars.github.io/tistory-ticker/js/home-switch-countdown.js?v=20261026-restore', 'HomeSwitchCountdown')
      .then(function (countdown) { countdown.refresh(); })
      .catch(function (error) { console.warn('���� ī��Ʈ�ٿ� �ʱ�ȭ ����', error); });

    function field(name) {
      return dashboardSection.querySelector('[data-market-field="' + name + '"]');
    }

    function setField(name, text, tone) {
      var element = field(name);
      if (!element) return;
      var fullText = text == null ? '' : String(text);
      // ��� API�� �Ͻ������� '?'�� ��ȯ�ص� ����ڰ� �ǹ� ���� ����ǥ��
      // ��ǥ ������ �������� �ʵ��� ���� ������ �ٲ� ǥ���Ѵ�.
      var placeholderOnly = /^\?+$/.test(fullText.trim());
      if (placeholderOnly) fullText = '';
      element.textContent = fullText;
      element.hidden = placeholderOnly;
      // 2026-10-23 ����� ��û: hover ����(native tooltip, '?' Ŀ��)�� ���ְ� ���ټ� ���̺��� �����Ѵ�.
      element.setAttribute('aria-label', fullText);
      element.classList.remove('home-positive', 'home-negative', 'home-neutral');
      if (tone) element.classList.add(tone);
    }

    var homeUsEtfsAt = 0;
    var homeShowsUs = false;
    function applyHomeSummarySession(session) {
      var isUs = !!session && session.market === 'us';
      var usSession = isUs ? usRegularSessionState() : null;
      var title = dashboardSection.querySelector('[data-home-summary-field="title"]');
      var meta = dashboardSection.querySelector('[data-home-summary-field="meta"]');
      var labels = dashboardSection.querySelectorAll('.hmb-list dt');
      var investorTrend = dashboardSection.querySelector('[data-home-investor-trend]');
      // �̱� ���� ��� ī��� �׸��� 5�����̶� 3�� �׸��� ������ ĭ�� �� ä�� ���´� -
      // ���� ���� ���� ���� �ð���� ������ �ڽ��� ������ ������ �� �ִ� �ڽ��� �߰�������
      // �� �� ĭ�� ä���(���� ���� ��࿡���� �̹� ������ ������ �־� ���� �� ������).
      var nightFutures = dashboardSection.querySelector('[data-home-night-futures]');
      if (title) title.textContent = isUs ? '�۷ι� ����' : '������ ����';
      var marketAux = dashboardSection.querySelector('[data-home-market-aux]');
      if (marketAux) marketAux.hidden = isUs;
      if (meta) {
        meta.textContent = '��ǥ�� ���� �ð�';
        meta.hidden = !isUs;
      }
      var metricControls = dashboardSection.querySelector('[data-home-metric-controls]');
      if (metricControls) metricControls.hidden = isUs;
      if (labels[0]) labels[0].textContent = isUs && usSession && !usSession.open ? '���� ����' : '��� ���� ����';
      // Outside the US cash session, the large "���� ����" headline already
      // shows the same "���� ���� �� / ���� ���� / �̱��� ����" label.
      // Hide only the duplicate small row, not the headline or live futures.
      // Restore it for the US regular session (breadth) and domestic market (temperature).
      var secondaryMarketStatus = dashboardSection.querySelector('.hmb2-verdict > .hmb2-temp');
      // �������̱��� ���� ��� ���� ��� ���븦 �����Ѵ�.
      if (secondaryMarketStatus) secondaryMarketStatus.hidden = true;
      var domesticRatios = dashboardSection.querySelector('[data-domestic-ratios]');
      if (domesticRatios) domesticRatios.hidden = isUs;
      var usRatios = dashboardSection.querySelector('[data-us-ratios]');
      if (usRatios) usRatios.hidden = !isUs || !!(usSession && !usSession.open);
      if (investorTrend) investorTrend.hidden = isUs;
      if (nightFutures) nightFutures.hidden = !isUs;
      // �̱� ���: ���������� �гΰ� �۷ι� ��ǥ �г��� ���� '���� ���'(�ٽ� ��ǥ) ĭ�� ����Ѵ�. ���� ���� �״��.
      dashboardSection.classList.toggle('is-us-market', isUs);
      var soxCard = homeIndexCard('tertiary');
      if (soxCard) soxCard.hidden = !isUs;
      var rotationBox = dashboardSection.querySelector('[data-home-us-rotation]');
      if (rotationBox) rotationBox.hidden = !isUs;
      var domesticRotation = dashboardSection.querySelector('[data-home-kr-rotation]');
      if (domesticRotation) domesticRotation.hidden = isUs;
      var globalBlock = dashboardSection.querySelector('[data-home-global]');
      if (globalBlock) globalBlock.hidden = !isUs;
      var futuresFlow = dashboardSection.querySelector('[data-home-futures-flow]');
      if (futuresFlow) futuresFlow.hidden = isUs;
      var pair = dashboardSection.querySelector('[data-home-futures-pair]');
      if (pair) pair.hidden = isUs || !!session.closed;
      // �ٽ� ��ǥ ĭ�� �̱� ��忡�� '�۷ι� ����'�� �ȴ�(������ ���� ����� ���� ��� ����).
      var coreList = dashboardSection.querySelector('#homeMarketBoard .hmb2-core');
      if (coreList) coreList.hidden = isUs;
      if (!isUs) renderHomeDayFutures(homeDayFutureQuote, false);
      if (isUs) { loadHomeUsRotation(); renderHomeUsPanels(); }
      var verdict = dashboardSection.querySelector('.hmb2-verdict');
      if (verdict) verdict.classList.toggle('has-market-breadth', !isUs || !!(usSession && usSession.open));
      homeShowsUs = isUs;
      renderMarketParticipation();
      var usEtfs = dashboardSection.querySelector('[data-home-us-etfs]');
      if (usEtfs) {
        if (!isUs) usEtfs.hidden = true;
        else loadHomeUsEtfs(usEtfs);
      }
    }

    // �ֿ� ETF ���ͷ�(�̱� ���). �Ϻ� �����̶� 10�� �ȿ��� �ٽ� �θ��� �ʴ´�. �����ϸ� ĭ�� ���� ä �д�.
    function loadHomeUsEtfs(box) {
      if (Date.now() - homeUsEtfsAt < 600000 && box.getAttribute('data-loaded') === '1') { box.hidden = false; return; }
      homeUsEtfsAt = Date.now();
      window.NineHttp.json('https://goodbyestar.cloud/us-etf-returns').then(function (env) {
        var d = env && env.data ? env.data : env;
        var items = d && d.items || [];
        var list = box.querySelector('[data-home-us-etfs-list]');
        if (!items.length || !list) return;
        function pct(v) { return window.NineUI.signedPercent(v); }
        function tone(v) { return v > 0 ? 'home-positive' : v < 0 ? 'home-negative' : 'home-neutral'; }
        list.innerHTML = items.map(function (it) {
          var title = (it.symbol || '') + ' ' + (it.name || '') + ' �� 1�� ' + pct(it.return1w)
            + ' �� 1���� ' + pct(it.return1m) + ' �� 3���� ' + pct(it.return3m) + ' �� 6���� ' + pct(it.return6m) + ' �� ���� ���� ' + pct(it.returnYtd);
          return '<tr title="' + escapeHomeHtml(title) + '">'
            + '<td><span class="hmb-etf-name"><b>' + escapeHomeHtml(it.symbol || '') + '</b><span>' + escapeHomeHtml(it.name || '') + '</span></span></td>'
            + '<td class="' + tone(it.return1d) + '">' + pct(it.return1d) + '</td>'
            + '<td class="' + tone(it.return1m) + '">' + pct(it.return1m) + '</td>'
            + '<td class="' + tone(it.return3m) + '">' + pct(it.return3m) + '</td>'
            + '<td class="' + tone(it.return6m) + '">' + pct(it.return6m) + '</td>'
            + '<td class="' + tone(it.returnYtd) + '">' + pct(it.returnYtd) + '</td></tr>';
        }).join('');
        var meta = box.querySelector('[data-home-us-etfs-meta]');
        if (meta && d.date) meta.textContent = d.date.slice(5).replace('-', '.') + ' �̱� ����' + (d.final === false ? '(����)' : '') + ' �� 1�� �� 1���� �� 3���� �� 6���� �� ���� ����';
        box.setAttribute('data-loaded', '1');
        box.hidden = !homeShowsUs; // ������ ���� ���� ���� ������ �ٲ������ ���� ä �д�
      }).catch(function () { box.hidden = true; });
    }

    function sectorSummary(data) {
      var groups = {};
      var payload = data && data.data && typeof data.data === 'object' ? data.data : (data || {});
      var all = [];
      ['KOSPI', 'KOSDAQ'].forEach(function (market) {
        if (Array.isArray(payload[market])) all = all.concat(payload[market]);
      });
      // GAS bubble ������ KOSPI/KOSDAQ �迭�� ����ϰ�, market-board ������
      // rows/sections�� ����Ѵ�. Ȩ������ ��� ������ ĳ�õǾ������� �������
      // ���� ���� ������� ����ȭ�Ѵ�.
      if (!all.length && Array.isArray(payload.rows)) all = payload.rows.slice();
      if (!all.length && payload.sections && typeof payload.sections === 'object') {
        var seen = {};
        Object.keys(payload.sections).forEach(function (key) {
          (Array.isArray(payload.sections[key]) ? payload.sections[key] : []).forEach(function (item) {
            var code = String(item && (item.code || item.symbol || item.name) || '');
            if (code && seen[code]) return;
            if (code) seen[code] = true;
            all.push(item);
          });
        });
      }
      all.forEach(function (item) {
        var changeRate = Number(item && (item.changeRate != null ? item.changeRate : item.change_rate));
        if (!isFinite(changeRate)) return;
        var sectors = Array.isArray(item && item.sectors) ? item.sectors : [];
        if (!sectors.length && item && (item.sector || item.industry)) sectors = [item.sector || item.industry];
        sectors.forEach(function (sector) {
          sector = String(sector || '').trim();
          if (!sector || /^(�̺з�|unknown|n\/a|na|-|��Ÿ)$/i.test(sector)) return;
          if (!groups[sector]) groups[sector] = { total: 0, count: 0 };
          groups[sector].total += changeRate;
          groups[sector].count += 1;
        });
      });
      var rows = Object.keys(groups).map(function (sector) {
        return { sector: sector, average: groups[sector].total / groups[sector].count, count: groups[sector].count };
      }).sort(function (a, b) { return b.average - a.average; });
      return {
        leaders: rows.filter(function (item) { return item.average > 0; }).slice(0, 3),
        cautions: rows.filter(function (item) { return item.average < 0; }).slice(-3).reverse()
      };
    }

    function sectorSummaryText(items, emptyText) {
      var names = (items || []).map(function (item) { return String(item && (item.sector || item.industry) || '').trim(); })
        .filter(function (name) { return name && !/^(�̺з�|unknown|n\/a|na|-|��Ÿ)$/i.test(name); });
      return names.length ? names.join(' �� ') : (emptyText || '���� ������ ����');
    }

    function resolveMarketDirection(marketTemp, indexRates) {
      var components = marketTemp && marketTemp.components;
      var rise = components && components.riseRatio;
      var avgChange = components && components.avgChange;
      var riseRatio = rise && typeof rise.ratio === 'number' ? rise.ratio : null;
      var averageRate = avgChange && typeof avgChange.avgChangeRate === 'number'
        ? avgChange.avgChangeRate
        : null;

      // �̱� ����� �ŷ���� ���� ������ ��� ������ ����, ���� �϶��Ͽ���
      // �Ϻ� ������ ������� "���� ����"�� ���� �� �ִ�. �����ڡ�S&P500��
      // ��� ���� �����̸� ��ǥ ���� ������ �켱�ϰ�, ���� �������� ȥ���� �д�.
      var validIndexRates = Array.isArray(indexRates) ? indexRates.filter(function (rate) { return typeof rate === 'number' && isFinite(rate); }) : [];
      if (validIndexRates.length >= 2) {
        var indexUp = validIndexRates.every(function (rate) { return rate > 0; });
        var indexDown = validIndexRates.every(function (rate) { return rate < 0; });
        var indexAverage = validIndexRates.reduce(function (sum, rate) { return sum + rate; }, 0) / validIndexRates.length;
        if (indexDown) {
          if ((riseRatio != null && riseRatio <= 0.3) || (averageRate != null && averageRate <= -1) || indexAverage <= -1) {
            return { label: '���� �༼', tone: 'home-negative' };
          }
          return { label: '�༼ ����', tone: 'home-negative' };
        }
        if (!indexUp) return { label: 'ȥ��', tone: 'home-neutral' };
        if (riseRatio != null && averageRate != null && riseRatio >= 0.85 && averageRate >= 1 && indexAverage >= 1) {
          return { label: '�޵�', tone: 'home-positive' };
        }
        if ((riseRatio != null && riseRatio >= 0.7) && (averageRate == null || averageRate >= 0) && indexAverage >= 0) {
          return { label: '���� ����', tone: 'home-positive' };
        }
        if (riseRatio != null && riseRatio >= 0.55) return { label: '��� ����', tone: 'home-positive' };
        return { label: 'ȥ��', tone: 'home-neutral' };
      }

      // ���ÿµ� ��꿡 �̹� ���Ե� ��ü ���� ��� ������ ��յ������ �Բ� ����.
      // ���ڰ� ���� ��쿡�� ���� ���¸� ������ �ʴ´�.
      if (riseRatio != null && averageRate != null && riseRatio <= 0.15 && averageRate <= -1) {
        return { label: '�޶�', tone: 'home-negative' };
      }
      if ((riseRatio != null && riseRatio <= 0.3) || (averageRate != null && averageRate <= -1)) {
        return { label: '���� �༼', tone: 'home-negative' };
      }
      if (riseRatio != null && averageRate != null && riseRatio >= 0.85 && averageRate >= 1) {
        return { label: '�޵�', tone: 'home-positive' };
      }
      if ((riseRatio != null && riseRatio >= 0.7) || (averageRate != null && averageRate >= 1)) {
        return { label: '���� ����', tone: 'home-positive' };
      }
      if (riseRatio != null && riseRatio <= 0.45) return { label: '�༼ ����', tone: 'home-negative' };
      if (riseRatio != null && riseRatio >= 0.55) return { label: '��� ����', tone: 'home-positive' };
      if (riseRatio != null || averageRate != null) {
        return { label: 'ȥ��', tone: 'home-neutral' };
      }
      return { label: '������ Ȯ�� ��', tone: 'home-neutral' };
    }

    function renderMarketExchange(market) {
      var exchange = market && market.components && market.components.exchange;
      if (!exchange || typeof exchange.price !== 'number') return;
      var exchangeRate = Number(exchange.changeRate);
      var arrow = exchangeRate > 0 ? ' ��' : exchangeRate < 0 ? ' ��' : '';
      setField('exchange', exchange.price.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '��' + arrow,
        exchangeRate > 0 ? 'home-positive' : exchangeRate < 0 ? 'home-negative' : 'home-neutral');
    }

    // 2026-10-02 ����� ����("��ú���� 21.2�� �߸��ε� ���ÿµ� ���������� �µ��� ����"): ��������
    // 2026-09-07 �������� 3�� ��������(score100)�� ���� �ִµ� ��ú��常 GAS ���Ž� �µ�(��)�� �а� �־���.
    // VM /market-temp�� ����������3�ܰ� ��޸� ����. ���� �� ���� ����� �ֱ� ĳ��/������ ǥ���Ѵ�.
    var homeVmScoreText = '';

    function setHomeVmScore(data) {
      if (!data || data.score100 == null || data.score100 === '') return;
      var score = Number(data.score100);
      if (!isFinite(score) || score < 0 || score > 100) return;
      var label = data.grade3 && data.grade3.label ? ' ' + data.grade3.label : '';
      homeVmScoreText = Math.round(score) + '��' + label;
      renderDomesticBreadth(data);
    }

    // Domestic headline uses the same two indices and full-market counts shown
    // below it. The temperature's screened sample is not a market-wide breadth.
    var homeDomesticMarketTemp = null;
    function resolveDomesticMarketDirection(market, items) {
      var rates = ['KOSPI', 'KOSDAQ'].map(function (symbol) {
        var item = (items || []).find(function (row) { return row && row.symbol === symbol; });
        if (!item || item.stale || item.change_rate == null || item.change_rate === '') return null;
        var at = Date.parse(item.updated_at || '');
        if (!isFinite(at) || Date.now() - at < -60000 || (!item.market_closed && Date.now() - at > 300000)) return null;
        var rate = Number(item.change_rate);
        return isFinite(rate) ? rate : null;
      });
      if (rates.some(function (rate) { return rate === null; })) return { label: '������ Ȯ�� ��', tone: 'home-neutral' };
      var total = market && market.marketBreadth && market.marketBreadth.total;
      var ratio = total && typeof total.up === 'number' && typeof total.down === 'number'
        && typeof total.total === 'number' && total.total > 0 && total.up >= 0 && total.down >= 0
        && total.up + total.down <= total.total ? total.up / total.total : null;
      var down = rates.every(function (rate) { return rate < 0; });
      var up = rates.every(function (rate) { return rate > 0; });
      if (!down && !up) return { label: 'ȥ��', tone: 'home-neutral' };
      if (down) {
        if (ratio != null && ratio <= 0.15 && rates.every(function (rate) { return rate <= -1; })) return { label: '�޶�', tone: 'home-negative' };
        return { label: (ratio != null && ratio <= 0.3) || rates.every(function (rate) { return rate <= -1; }) ? '���� �༼' : '�༼ ����', tone: 'home-negative' };
      }
      if (ratio != null && ratio >= 0.85 && rates.every(function (rate) { return rate >= 1; })) return { label: '�޵�', tone: 'home-positive' };
      if (ratio != null && ratio <= 0.45) return { label: '���� ��¡����� �༼', tone: 'home-neutral' };
      return { label: ratio != null && ratio >= 0.7 ? '���� ����' : '��� ����', tone: 'home-positive' };
    }

    function renderDomesticDirection(market) {
      if (homeMarketSession().market !== 'domestic') return;
      var direction = resolveDomesticMarketDirection(market, latestHomeIndices);
      setField('direction', direction.label, direction.tone);
    }

    function renderMarketTemperature(market) {
      if (market && typeof market.score100 === 'number' && isFinite(market.score100)) {
        setHomeVmScore(market);
        homeDomesticMarketTemp = market;
        renderDomesticDirection(market);
        var exchange = market.components && market.components.exchange;
        if (exchange && typeof exchange.price === 'number') {
          var exchangeRate = Number(exchange.changeRate);
          var arrow = exchangeRate > 0 ? ' ��' : exchangeRate < 0 ? ' ��' : '';
          setField('exchange', exchange.price.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '��' + arrow,
            exchangeRate > 0 ? 'home-positive' : exchangeRate < 0 ? 'home-negative' : 'home-neutral');
        }
        var updated = document.getElementById('hmbUpdated');
        if (updated && market.updatedAt) updated.textContent = window.NineTime.updated(market.updatedAt) || ('��Ȳ ' + formatHomeTimestamp(market.updatedAt) + ' ����');
      }
    }

    var MARKET_TEMP_VM_URL = 'https://goodbyestar.cloud/market-temp';

    // ���� ��� ����. ���ա��̺з��� ������� ���� �϶����� ��ġ�� �ʴ´�.
    function renderHomeRiseRatio(upRatio, downRatio, targetRow) {
      var valid = typeof upRatio === 'number' && isFinite(upRatio) && upRatio >= 0 && upRatio <= 1;
      var row = targetRow || dashboardSection.querySelector('.hmb2-verdict > .hmb2-temp');
      var value = row && row.querySelector('dd');
      if (value) {
        value.textContent = valid ? (targetRow ? '��� ' : '') + (upRatio * 100).toFixed(1) + '%' : '������ Ȯ�� ��';
        value.className = valid ? upRatio >= 0.55 ? 'home-positive' : upRatio <= 0.45 ? 'home-negative' : 'home-neutral' : 'home-neutral';
      }
      var bar = row && row.querySelector('[data-hmb-upbar]');
      if (!valid) { if (bar) bar.hidden = true; return; }
      if (!row) return;
      if (!bar) {
        bar = document.createElement('span');
        bar.className = 'hmb2-upbar';
        bar.setAttribute('data-hmb-upbar', '');
        bar.innerHTML = '<i class="is-up"></i><i class="is-flat"></i><i class="is-down"></i>';
        row.appendChild(bar);
      }
      var down = typeof downRatio === 'number' && isFinite(downRatio) ? Math.max(0, Math.min(1 - upRatio, downRatio)) : 0;
      bar.querySelector('.is-up').style.width = (upRatio * 100).toFixed(2) + '%';
      bar.querySelector('.is-down').style.width = (down * 100).toFixed(2) + '%';
      var flatBar = bar.querySelector('.is-flat');
      if (flatBar) flatBar.style.width = ((1 - upRatio - down) * 100).toFixed(2) + '%';
      bar.setAttribute('role', 'img');
      bar.setAttribute('aria-label', '��� ' + (upRatio * 100).toFixed(1) + '% �� �϶� ' + (down * 100).toFixed(1) + '% �� ������ ���ա��̺з�');
      bar.title = bar.getAttribute('aria-label');
      bar.hidden = false;
    }

    // ���� ������ ����� �̱� ��ȸ ǥ���� ���� ǥ�ñ⸦ ���� ���� ������ �����Ѵ�.
    function renderHomeBreadthEntry(row, label, entry, isSample) {
      if (!row) return;
      if (entry && typeof entry.up === 'number' && typeof entry.down === 'number') {
        var count = typeof entry.total === 'number' ? entry.total : entry.up + entry.down + (entry.flat || 0);
        if (count > 0 && entry.up >= 0 && entry.down >= 0 && entry.up + entry.down <= count) {
          var flat = typeof entry.flat === 'number' ? entry.flat : null;
          row.classList.remove('hmb2-temp');
          row.innerHTML = '<dt>' + label + '</dt>'
            + '<span class="hmb2-breadth-total">' + (isSample ? '���� ' : '��ü ') + count.toLocaleString('ko-KR') + '����</span><dd></dd>'
            + '<span class="hmb2-upbar" data-hmb-upbar><i class="is-up"></i><i class="is-flat"></i><i class="is-down"></i></span>'
            + '<span class="hmb2-breadth-counts"><span>��� <b class="home-positive">' + entry.up.toLocaleString('ko-KR') + '</b></span>'
            + '<span>' + (flat === null ? '�̺з�' : '����') + ' <b>' + (flat === null ? count - entry.up - entry.down : flat).toLocaleString('ko-KR') + '</b></span>'
            + '<span>�϶� <b class="home-negative">' + entry.down.toLocaleString('ko-KR') + '</b></span></span>';
          renderHomeRiseRatio(entry.up / count, entry.down / count, row);
          return;
        }
      }
      row.classList.add('hmb2-temp');
      row.innerHTML = '<dt>' + label + '</dt><dd></dd>';
      renderHomeRiseRatio(null, null, row);
    }

    function renderDomesticBreadth(data) {
      if (homeMarketSession().market !== 'domestic') return;
      var byMarket = data && data.marketBreadth && data.marketBreadth.byMarket;
      ['KOSPI', 'KOSDAQ'].forEach(function (key) {
        var row = dashboardSection.querySelector('[data-domestic-ratio="' + key + '"]');
        renderHomeBreadthEntry(row, key === 'KOSPI' ? '�ڽ���' : '�ڽ���', byMarket && byMarket[key], false);
      });
    }

    function loadHomeIndexBreadth() {
      if (homeMarketSession().market !== 'domestic') return;
      loadDomesticParticipation();
      fetchHomeJson(MARKET_TEMP_VM_URL, 12000).then(function (body) {
        if (homeMarketSession().market !== 'domestic') return;
        var data = body && body.data ? body.data : body;
        renderMarketTemperature(data);
        renderDomesticBreadth(data);
      }).catch(function () { /* ���� ���� ǥ�ø� �����Ѵ�. */ });
    }

    function nyClockParts(now) {
      var parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        hourCycle: 'h23'
      }).formatToParts(now || new Date()).reduce(function (result, part) {
        result[part.type] = part.value;
        return result;
      }, {});
      var hour = Number(parts.hour);
      if (hour === 24) hour = 0;
      return { weekday: parts.weekday, minutes: hour * 60 + Number(parts.minute) };
    }

    function usRegularSessionState(now) {
      var clock;
      try {
        clock = nyClockParts(now);
      } catch (error) {
        return { open: false, label: '���� ���� Ȯ�� ��', subtitle: '�̱� ���� �� ���� ���� Ȯ�� ��' };
      }
      var minute = clock.minutes;
      var weekend = clock.weekday === 'Sat' || clock.weekday === 'Sun';
      if (weekend) return { open: false, label: '�̱��� ����', subtitle: '�̱� ���� �� ����' };
      // 2026-09-07 ����Ʈ("�̱��� �뵿���ε� ���� �ƴ� �ɷ� ����"): ���� ������ �ָ���
      // ���� �־���. ������ ǥ�� js/skin-shell.js�� MarketHours �� ������ �д� - ����
      // ������ ���� ���Ͽ� �����ߴٰ� ȭ���� ���ȴ� ����(2026-09-05 MarketHours ����)��
      // �ݺ����� �ʴ´�.
      // skin-main.js���� global ��Ī�� ���� - window�� �о�� ReferenceError�� �� ����
      // (2026-09-06 ������ǥ �ǿ��� ���� �Ǽ��� �ߴ�).
      if (window.MarketHours && window.MarketHours.isUsHoliday
          && window.MarketHours.isUsHoliday(now)) {
        return { open: false, label: '�̱��� ����', subtitle: '�̱� ���� �� ����' };
      }
      if (minute < 9 * 60 + 30) return { open: false, label: '���� ���� ��', subtitle: '�̱� ���� �� ���� ���� ��' };
      if (minute >= 16 * 60) return { open: false, label: '���� ����', subtitle: '�̱� ���� �� ���� ����' };
      return { open: true, label: '����', subtitle: '�̱� ���� �� ����' };
    }

    // CME �ְ����� ���� �ŷ��ð�(ET) �ٻ�. �Ͽ��� 18:00�� ���� �ݿ��� 17:00�� ������,
    // ���� 17:00~18:00 �� �ð��� ����. ������ ����ŷ��� �ݿ����� �ʴ´�.
    function usFuturesSessionOpen(now) {
      var clock;
      try {
        clock = nyClockParts(now);
      } catch (error) {
        return false;
      }
      if (clock.weekday === 'Sat') return false;
      if (clock.weekday === 'Sun') return clock.minutes >= 18 * 60;
      if (clock.weekday === 'Fri') return clock.minutes < 17 * 60;
      return clock.minutes < 17 * 60 || clock.minutes >= 18 * 60;
    }

    // 2026-09-04: �̱� ȭ���� ��� ���� ��Ʈ���� �׻� �����ڡ�S&P500 "����"�� �׸��� �־���.
    // ������ �ѱ��ð� 22:30~05:00(����Ÿ�� ����)���� ��������, ���� �̱����� ���� ����
    // ���� ������ �״�� ���� �ִ� ī�带 ��� ���� �ȴ�(����� ����: "�̱� �ǽð� ƼĿ��
    // ǥ���� �Ǵ°� �־�"). ������ ���� �ְ� ���������� ���� �ִ� �ð��뿡�� �̹� ���� ����
    // ������100��S&P500 ������ �ٲ� ������ �����̴� ���� �����ش�.
    function usIndexSessionState(now) {
      var spot = usRegularSessionState(now);
      if (spot.open) {
        return {
          source: 'spot',
          keys: ['NASDAQ_INDEX', 'SP500_INDEX'],
          labels: ['������ ���� ����', 'S&P500 ����'],
          live: '������ ���� �� S&P500 ����',
          statusLabel: spot.label,
          subtitle: spot.subtitle
        };
      }
      if (usFuturesSessionOpen(now)) {
        return {
          source: 'futures',
          keys: ['NASDAQ100', 'SP500'],
          labels: ['������100 ����(CME)', 'S&P500 ����(CME)'],
          live: '������100 �� S&P500 ����(CME)',
          statusLabel: '���� �ŷ���',
          // 2026-10-15 "�����̾� �����̾�" ����: ���� ���� ���� ������ �ٸ��ٴ� ���� ������ �� �ڴ´�.
          subtitle: '�̱� ��������(CME) �ŷ��� �� ���� ������ ���� �ٸ�(���� ' + spot.label + ')'
        };
      }
      return {
        source: 'spot',
        keys: ['NASDAQ_INDEX', 'SP500_INDEX'],
        labels: ['������ ���� ����', 'S&P500 ����'],
        live: '������ ���� �� S&P500 ����',
        statusLabel: spot.label,
        subtitle: spot.subtitle
      };
    }

    // 2026-09-05: �ڽ��� �߰����� ���� ������ js/skin-shell.js�� MarketHours�� �Ű��.
    // ������ ǥ�� �� ���ϡ�kospi-futures.js��domestic-market-indicators.js �� ����
    // ������ �־, �ذ� �ٲ�� �� ������ �� ���ľ� �ߴ�. ���� �� ���� ��ģ��.
    function isNightFuturesHoliday() {
      var hours = window.MarketHours;
      return hours ? hours.isNightSessionHoliday() : false;
    }

    function summarizeUsMarket(data, indexItems) {
      var payload = data && data.data ? data.data : data;
      var rows = payload && payload.rows ? payload.rows : [];
      var valid = rows.map(function (row) {
        return { rate: row && row.change_rate != null && row.change_rate !== '' ? Number(row.change_rate) : NaN, industry: String(row && row.industry || '').trim() };
      }).filter(function (row) { return isFinite(row.rate); });
      if (!valid.length) return null;
      var rising = valid.filter(function (row) { return row.rate > 0; }).length;
      var riseRatio = rising / valid.length;
      var averageRate = valid.reduce(function (sum, row) { return sum + row.rate; }, 0) / valid.length;
      var groups = {};
      valid.forEach(function (row) {
        if (!row.industry) return;
        if (!groups[row.industry]) groups[row.industry] = { total: 0, count: 0 };
        groups[row.industry].total += row.rate;
        groups[row.industry].count += 1;
      });
      var industries = Object.keys(groups).map(function (industry) {
        return { industry: industry, average: groups[industry].total / groups[industry].count };
      }).sort(function (a, b) { return b.average - a.average; });
      var eligibleIndustries = industries.filter(function (item) {
        return item.industry && !/^(�̺з�|unknown|n\/a|na|-|��Ÿ)$/i.test(item.industry);
      });
      // ���� �϶��Ͽ��� ��� ������ ����� ������ �� �� �ִ�. ��� ������
      // �ֵ� �������� ������ �� ��� �� ĭ�� �ǹǷ�, ��� ������ ���� ����
      // ��������� �� �϶��� ���� ������ �ֵ� �������� ǥ���Ѵ�.
      var leaders = eligibleIndustries.filter(function (item) { return item.average > 0; }).slice(0, 3);
      if (!leaders.length) leaders = eligibleIndustries.slice(0, 3);
      var cautions = eligibleIndustries.filter(function (item) { return item.average < 0; }).slice(-3).reverse();
      if (!cautions.length) cautions = eligibleIndustries.slice(-3).reverse();
      var indexRates = (indexItems || [])
        .filter(function (item) { return item && (item.symbol === 'NASDAQ_INDEX' || item.symbol === 'SP500_INDEX'); })
        .map(function (item) { return Number(item.change_rate); })
        .filter(function (rate) { return isFinite(rate); });
      var usSession = usRegularSessionState();
      return {
        riseRatio: riseRatio,
        breadth: { up: rising, down: valid.filter(function (row) { return row.rate < 0; }).length, flat: valid.filter(function (row) { return row.rate === 0; }).length, total: valid.length },
        averageRate: averageRate,
        direction: usSession.open ? resolveMarketDirection({ components: {
          riseRatio: { ratio: riseRatio },
          avgChange: { avgChangeRate: averageRate }
        } }, indexRates) : { label: usSession.label, tone: 'home-neutral' },
        sessionState: usSession,
        leaders: leaders,
        cautions: cautions,
        updatedAt: payload && payload.updatedAt
      };
    }

    function renderUsMarketSummary(data) {
      latestUsBoardData = data;
      var summary = summarizeUsMarket(data, latestHomeIndices);
      if (!summary) {
        setField('temperature', '������ Ȯ�� ��', 'home-neutral');
        setField('leaders', '������ Ȯ�� ��', 'home-neutral');
        setField('cautions', '������ Ȯ�� ��', 'home-neutral');
        return;
      }
      var sessionOpen = !summary.sessionState || summary.sessionState.open;
      if (!sessionOpen) setField('direction', summary.direction.label, summary.direction.tone);
      setField('leaders', sectorSummaryText(summary.leaders, '���� ������ ����'), 'home-positive');
      setField('cautions', sectorSummaryText(summary.cautions, '���� ������ ����'), 'home-negative');
      var updated = document.getElementById('hmbUpdated');
      if (updated && summary.updatedAt) updated.textContent = window.NineTime.updated(summary.updatedAt) || (formatHomeTimestamp(summary.updatedAt) + ' ����');
    }

    function renderUsIndexBreadth(body) {
      latestHomeParticipation.us = body;
      if (homeMarketSession().market !== 'us') return;
      renderMarketParticipation();
      var notes = [];
      var ratios = [];
      ['SP500', 'NASDAQ', 'SOX'].forEach(function (key) {
        var entry = body && body.byIndex && body.byIndex[key];
        var label = key === 'SP500' ? 'S&P 500' : key === 'SOX' ? '�ʶ��Ǿ� �ݵ�ü' : '������ ����';
        var row = dashboardSection.querySelector('[data-us-ratio="' + key + '"]');
        var valid = entry && entry.status !== 'unavailable' && typeof entry.total === 'number' && entry.total > 0;
        renderHomeBreadthEntry(row, escapeHomeHtml(label), valid ? entry : null, false);
        if (valid) {
          if (entry.missing) notes.push(label + ' ���� ' + entry.missing + '����');
          if (entry.status === 'stale') notes.push(label + ' ���� ����');
          // ���� ������ S&P 500�������� ���� �� ���� �����̴�. ���� ����(SOX)�� ǥ�ø� �Ѵ�.
          if (entry.status === 'ok' && key !== 'SOX') ratios.push(entry.up / entry.total);
          if (row) row.title = 'TradingView ���� �������� �� �����ü� �� ���� ' + (entry.retrievedAt || 'Ȯ�� ��');
        }
      });
      var meta = dashboardSection.querySelector('[data-us-breadth-meta]');
      if (meta) meta.textContent = 'TradingView �� �����ü�(�ִ� 15��) �� 2�� ĳ��' + (notes.length ? ' �� ' + notes.join(' �� ') : '');
      if (usRegularSessionState().open) {
        // Two index breadth ratios are averaged; overlapping constituents are not presented as a combined stock count.
        if (ratios.length === 2) {
          var indexRates = (latestHomeIndices || []).filter(function (item) { return item.symbol === 'NASDAQ_INDEX' || item.symbol === 'SP500_INDEX'; }).map(function (item) { return Number(item.change_rate); }).filter(isFinite);
          var direction = resolveMarketDirection({components: {riseRatio: {ratio: (ratios[0] + ratios[1]) / 2}, avgChange: {avgChangeRate: indexRates.length ? indexRates.reduce(function (a, b) { return a + b; }, 0) / indexRates.length : 0}}}, indexRates);
          setField('direction', direction.label, direction.tone);
        } else setField('direction', '������ Ȯ�� ��', 'home-neutral');
      }
      renderHomeUsPanels();
    }

    function loadHomeUsIndexBreadth() {
      var request = window.NineAPI.usMarketBreadth ? window.NineAPI.usMarketBreadth() : window.NineAPI.data(window.NineAPI.vmUrl + '/us-market-breadth', {timeoutMs: 25000});
      request.then(renderUsIndexBreadth).catch(function () { renderUsIndexBreadth(null); });
    }

    var latestHomeParticipation = {domestic: null, us: null};

    function homeParticipationModel(market, body) {
      var definitions = market === 'us' ? [['SP500','S&P 500'],['NASDAQ','������ ����'],['SOX','�ʶ��Ǿ� �ݵ�ü']]
        : [['KOSPI','�ڽ���'],['KOSDAQ','�ڽ���']];
      var number = function (v) { return typeof v === 'number' && isFinite(v) && v >= 0; };
      return definitions.map(function (definition) {
        var entry = body && body.byIndex && body.byIndex[definition[0]], volume = entry && entry.volumeIndex;
        var stamp = entry ? Date.parse(entry.retrievedAt) : NaN, age = (Date.now()-stamp)/1000;
        var clock = new Date(Date.now()+9*3600000), minutes = clock.getUTCHours()*60+clock.getUTCMinutes();
        var active = clock.getUTCDay()>0 && clock.getUTCDay()<6 && minutes>=540 && minutes<940;
        var ttl = market === 'us' ? 900 : active ? 300 : 3600;
        var fresh = isFinite(stamp) && age>=-60 && age<=ttl;
        var ready = false, participation = null;
        if (market === 'domestic') {
          var participation = entry && entry.volumeParticipation;

          var pNumber = function (value) { return typeof value === 'number' && isFinite(value); };

          var integer = function (value) { return pNumber(value) && Math.floor(value) === value; };

          var sample = participation && integer(participation.total) && participation.total > 0

            && participation.total === entry.total && integer(participation.eligible)

            && participation.eligible > 0 && participation.eligible <= participation.total

            && participation.eligible / participation.total >= .95;

          var collected = entry ? Date.parse(entry.retrievedAt) : NaN;

          var age = (Date.now() - collected) / 1000;

          // Match the server's longest cache TTL; never relabel retrieval as a quote timestamp.

          var clock = new Date(Date.now() + 9 * 3600000);

          var minutes = clock.getUTCHours() * 60 + clock.getUTCMinutes();

          var active = clock.getUTCDay() > 0 && clock.getUTCDay() < 6 && minutes >= 540 && minutes < 940;

          var fresh = isFinite(collected) && age >= -60 && age <= (active ? 300 : 3600);

          var ready = entry && entry.status === 'ok' && fresh && sample

            && participation.status === 'ok' && participation.basis === 'same-time-5m' && participation.lookbackDays === 10

            && pNumber(participation.ratio) && participation.ratio >= 0 && participation.ratio <= 1

            && pNumber(participation.median) && participation.median >= 0

            && integer(participation.increased) && participation.increased >= 0 && participation.increased <= participation.eligible

            && Math.abs(participation.ratio - participation.increased / participation.eligible) < .000001;


        }
        var valid = entry && entry.status === 'ok' && fresh && volume && volume.status === 'ok'
          && volume.basis === 'same-time-5m-volume-sum' && volume.lookbackDays === 10
          && Number.isInteger(volume.eligible) && Number.isInteger(volume.total)
          && volume.total>0 && volume.total === entry.total && volume.eligible>0 && volume.eligible<=volume.total
          && volume.eligible/volume.total>=.95 && number(volume.current) && volume.current>=0 && number(volume.baseline) && volume.baseline>0
          && number(volume.index100) && volume.index100>=0 && Math.abs(volume.index100-volume.current/volume.baseline*100)<.000001;
        return {label:definition[1],volume:valid ? volume : null,entry:entry, participation:ready ? participation : null,
          status:entry && (entry.status === 'stale' || !fresh) ? 'stale' : 'unavailable'};
      });
    }

    function homeVolumeScale(models) {
      // Equal deviations above/below 100 always have equal heights across both indexes.
      var deviation = models.reduce(function (maximum, model) {
        return model.volume ? Math.max(maximum, Math.abs(Math.round(model.volume.index100 * 10) / 10 - 100)) : maximum;
      }, 0);
      return Math.max(20, Math.ceil(deviation / 10) * 10);
    }

    function renderMarketParticipation() {

      var target = dashboardSection.querySelector('[data-home-participation]');

      if (!target) return;

      var market = homeMarketSession().market === 'us' ? 'us' : 'domestic';

      target.hidden = market === 'us' && !usRegularSessionState().open;

      var models = homeParticipationModel(market, (latestHomeParticipation || {})[market]);

      var scale = homeVolumeScale(models);

      target.innerHTML = '<div class="hmp-caption">�ŷ���</div>' + models.map(function (model) {

        var volume = model.volume;

        var normalized = volume ? Math.round(volume.index100 * 10) / 10 : null;

        var value = volume ? normalized.toFixed(1).replace(/\.0$/, '')

          : market === 'us' ? (model.status === 'stale' ? '���� ����' : 'Ȯ�� ��')

          : model.status === 'stale' ? '���� ����' : 'Ȯ�� ��';

        var delta = volume ? normalized - 100 : null;

        var tone = delta === null || Math.abs(delta) < .000001 ? 'home-neutral' : delta > 0 ? 'home-positive' : 'home-negative';

        var label = model.label + ' ���ð��� 5�к� �ŷ��� ' + value + (volume ? ' / ��� 100' : '');

        var tooltip = volume ? '�ֱ� 10�ŷ��� ���ð��� 5�к� �ŷ��� ��� 100 �� ���� ' + model.entry.retrievedAt

          : label;

        return '<div class="hmp-item"><div class="hmp-heading">' + escapeHomeHtml(model.label) + '</div>'

          + '<div class="hmp-column-chart" role="img" aria-label="' + escapeHomeHtml(label) + '" title="' + escapeHomeHtml(tooltip) + '">'

          + '<div class="hmp-column-track"><span class="hmp-baseline"></span>'

          + (delta !== null && Math.abs(delta) >= .000001 ? '<i class="hmp-column ' + (delta > 0 ? 'is-up' : 'is-down') + '" style="height:' + (Math.abs(delta) / scale * 50).toFixed(2) + '%"></i>' : '')

          + '</div></div><div class="hmp-volume-value"><b class="' + tone + '">' + value + '</b>' + '</div>' + '</div>';

      }).join('');

      // �������� 3����(�̱�: �ʶ��Ǿ� �ݵ�ü �߰�) ĭ ���� ������ ǥ�� Ŭ����.

      if (target.parentElement) target.parentElement.classList.toggle('has-three-gauges', models.length > 2);

      var basis = dashboardSection.querySelector('[data-participation-basis]');

      if (basis) {

        basis.hidden = target.hidden;

        if (market === 'domestic') basis.innerHTML = renderDomesticParticipation(models);

        else basis.innerHTML = renderUsParticipation(models);

      }

    }



    function renderParticipationBasis(models) {
      return '<details class="hmp-details"><summary>10�� ���ð��� 5�к� �ŷ��� ��� 100 �� �ڼ���</summary>'
        + models.map(function (model) {
          var e = model.entry, v = model.volume;
          var time = e && isFinite(Date.parse(e.retrievedAt)) ? new Date(e.retrievedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})+' KST' : '�ð� ��Ȯ��';
          var lag = e && typeof e.delaySeconds === 'number' && isFinite(e.delaySeconds) && e.delaySeconds>=0
            ? ' �� ������ '+Math.round(e.delaySeconds/60)+'�� ����' : ' �� ���� Ȯ�� �ʿ�';
          return '<div>'+escapeHomeHtml(model.label)+' �� '+(v ? '��ȿ '+v.eligible+'/'+v.total+'����' : model.status === 'stale' ? '���� ����' : '�ڷ� Ȯ�� ��')
            +' �� ���� '+escapeHomeHtml(time+lag)
            +(model.participation ? '<br>�ŷ��� ���� ���� '+(model.participation.ratio*100).toFixed(1)+'% �� ��� �ŷ��� �߾Ӱ� '+model.participation.median.toFixed(2)+'��' : '')+'</div>';
        }).join('')
        + '<div>�ѱ����̱� ���� ����: TradingView ���� ���������� �ŷ��� �ջ� / �ֱ� 10�ŷ��� ���ð��� 5�к� ��� ��100. ��ȿ ǥ�� 95% �̻� ǥ��. '
        + '�Ϸ� �������ŷ���ݡ��ż� ������ �ƴ�. ���� �ð��� ü�� �ð��� �ƴϸ� ���� ���� ��¥���ð� ������. ��ܿ��� �������� ������ 5�к� �ڷ�.</div></details>';
    }
    function renderUsParticipation(models) {
      return renderParticipationBasis(models);
    }
    function renderDomesticParticipation(models) {
      return renderParticipationBasis(models);
    }

    function loadDomesticParticipation() {
      var request = window.NineAPI.marketParticipation ? window.NineAPI.marketParticipation('domestic')
        : window.NineAPI.data(window.NineAPI.vmUrl + '/market-participation?market=domestic', {timeoutMs: 25000});
      request.then(function (body) { latestHomeParticipation.domestic = body; renderMarketParticipation(); })
        .catch(function () { latestHomeParticipation.domestic = null; renderMarketParticipation(); });
    }

    function renderMarketSectors(bubble) {
      var summary = sectorSummary(bubble);
      // ���� ���� ���� ���� ���踦 �̱������ ���� �� ĭ ���/0�� ����� ǥ���Ѵ�.
      // �̱� ���� ETF �����̼ǰ� �����ڡ�ǥ���� �ٸ��Ƿ� ���� ������ �����Ѵ�.
      var rotation = dashboardSection.querySelector('[data-home-kr-rotation]');
      if (!rotation) return;
      var scale = Math.max(0.5, summary.leaders.concat(summary.cautions).reduce(function (max, row) {
        return Math.max(max, Math.abs(row.average));
      }, 0));
      [['leaders', summary.leaders], ['cautions', summary.cautions]].forEach(function (group) {
        var list = rotation.querySelector('[data-kr-rot="' + group[0] + '"] .hus-rot-list');
        if (!list) return;
        list.innerHTML = group[1].length ? group[1].map(function (row) {
          var rate = row.average, width = Math.min(50, Math.abs(rate) / scale * 50);
          return '<li><span class="hus-name">' + escapeHomeHtml(row.sector) + '</span>'
            + '<span class="hus-bar" role="img" aria-label="' + escapeHomeHtml(row.sector + ' ��� ' + rate.toFixed(2) + '%') + '"><i class="' + (rate >= 0 ? 'is-up' : 'is-down') + '" style="width:' + width.toFixed(1) + '%"></i></span>'
            + '<b class="' + homeTone(rate) + '">' + (rate > 0 ? '+' : '') + rate.toFixed(2) + '%</b>'
            + '<small>' + row.count + '����</small></li>';
        }).join('') : '<li class="ui-kpi-empty">�ش� ���� ������ ����</li>';
      });
    }

    function homeIndexCard(slot) {
      return dashboardSection.querySelector('[data-home-index-slot="' + slot + '"]');
    }

    // 2026-08-29: � �����ͷ� ��ȯ. /futures ������ �Ϻ��� ���� �߰� �к��� ����. ���̾ƿ� �۾� ��
    // �ٽ� ���� ������ �ʿ��ϸ� �� ���� true�θ� �ٲٸ� �ȴ�(�Ʒ� �ⱸ�� ����).
    var HOME_USE_SAMPLE_CHARTS = false;
    var homeSessionCharts = {}, homePriceMode = 'area', homePriceModes = {}, homeSessionLoading = false;
    // ����/����� ��Ʈ(ī��)���� ���� ����Ѵ�. homePriceMode �� ���� ������ ���� ��Ʈ�� �⺻���̴�.
    function homeModeOf(key) { return homePriceModes[key] || homePriceMode; }
    // ���콺 ������ �� ���(js/home-chart-hover.js�� �д´�). [x%, y%, ����] - ������ textContent �θ� �������� �Ӽ� �̽��������� ���⼭ �Ѵ�.
    function homeHoverAttr(points) {
      return JSON.stringify(points.map(function (p) { return [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100, p[2]]; }))
        .replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function homePercentText(value, base) {
      if (!isFinite(value) || !isFinite(base) || !base) return '';
      var pct = (value / base - 1) * 100;
      return (pct > 0 ? '+' : '') + pct.toFixed(2) + '%';
    }
    // Ȩ KR/US�� ��� ���������� ��ȯ�� ���Ǵ� ������ �� ��ư ������Ʈ.
    // �̺�Ʈ ������ ��Ʈ�� ���� ���� �ڵ鷯�� �����ϰ�, ���ð��� aria-pressed�� ǥ���Ѵ�.
    function homeModeSegment(attribute, selected, ariaLabel) {
      return '<div class="hmb-mode-segment" role="group" aria-label="' + ariaLabel + '">'
        + '<button type="button" ' + attribute + '="area" aria-pressed="' + (selected === 'area') + '">����</button>'
        + '<button type="button" ' + attribute + '="bar" aria-pressed="' + (selected === 'bar') + '">����</button></div>';
    }

    function homePriceSwitchControls(key, periodLabel) {
      return '<div class="hmb-price-controls"><span>' + periodLabel + '</span>'
        + homeModeSegment('data-price-mode', homeModeOf(key), '���� ���� �׷��� ǥ�� ���') + '</div>';
    }
    function renderHomeSessionChart(element, key, reference) {
      var result = homeSessionCharts[key] || {}, meta = result.session;
      var rows = (result.rows || []).filter(function (r) {
        return r.close != null && isFinite(Number(r.close)) && Number.isInteger(r.slot);
      });
      element.classList.add('has-session-chart');
      element.setAttribute('data-session-symbol', key);
      var mode = homeModeOf(key);
      var controls = homePriceSwitchControls(key,
        '30�� �� ' + (['KOSPI', 'KOSDAQ', 'KOSPI200_DAY', 'KOSPI200_NIGHT'].indexOf(key) >= 0 ? 'KST' : '����ð�'));
      if (!meta || !rows.length) {
        element.innerHTML = controls + '<div class="hmb-investor-spark-empty">���� ��� ���� ��</div>';
        return;
      }
      function amount(v) { return Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 }); }
      function time(ts) { return new Intl.DateTimeFormat('en-GB', { timeZone: meta.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ts * 1000)); }
      // A quote may belong to a newer session than the saved chart: only a
      // reference carried by that same series can label the baseline "previous".
      reference = result.reference;
      var hasReference = reference != null && isFinite(Number(reference)) && Number(reference) > 0;
      var base = hasReference ? Number(reference) : Number(rows[0].open);
      var high = rows.reduce(function (a, r) { return r.high > a.high ? r : a; }, rows[0]);
      var low = rows.reduce(function (a, r) { return r.low < a.low ? r : a; }, rows[0]);
      var min = Math.min(base, low.low), max = Math.max(base, high.high), range = max - min || 1;
      function x(slot) { return 4 + slot * 92 / (meta.slotCount - 1); }
      function y(v) { return 78 - (v - min) / range * 66; }
      var zero = y(base), marks = '', id = 'home-price-' + key;
      var groups = [];
      rows.forEach(function (r) {
        var group = groups[groups.length - 1];
        if (!group || r.slot !== group[group.length - 1].slot + 1) { group = []; groups.push(group); }
        group.push(r);
      });
      if (mode === 'area') {
        marks = '<defs><clipPath id="' + id + '-buy"><rect width="100" height="' + zero + '"/></clipPath>'
          + '<clipPath id="' + id + '-sell"><rect y="' + zero + '" width="100" height="' + (90 - zero) + '"/></clipPath></defs>';
        groups.forEach(function (group) {
          if (group.length < 2) return;
          var points = group.map(function (r) { return x(r.slot) + ',' + y(r.close); }).join(' ');
          ['buy', 'sell'].forEach(function (side) {
            marks += '<g class="hmb-investor-' + side + '" clip-path="url(#' + id + '-' + side + ')"><polygon class="hmb-investor-area" points="'
              + x(group[0].slot) + ',' + zero + ' ' + points + ' ' + x(group[group.length - 1].slot) + ',' + zero
              + '"/><polyline class="hmb-investor-line" vector-effect="non-scaling-stroke" points="' + points + '"/></g>';
          });
        });
      }
      rows.forEach(function (r) {
        var tone = r.close > base ? 'buy' : r.close < base ? 'sell' : 'flat';
        var title = '<title>' + time(Date.parse(meta.start) / 1000 + r.slot * 1800) + ' ���� �� ' + amount(r.close) + ' �� ���� ' + time(r.ts) + '</title>';
        marks += mode === 'bar'
          ? '<rect data-price-slot="' + r.slot + '" class="hmb-investor-' + tone + '" x="' + (x(r.slot) - 28 / meta.slotCount) + '" y="' + Math.min(zero, y(r.close)) + '" width="' + 56 / meta.slotCount + '" height="' + Math.max(.6, Math.abs(zero - y(r.close))) + '">' + title + '</rect>'
          : '<circle class="hmb-investor-' + tone + '" cx="' + x(r.slot) + '" cy="' + y(r.close) + '" r=".7">' + title + '</circle>';
      });
      function dot(r, value, name) { return '<span class="hmb-investor-point is-' + name + '" style="left:' + x(r.slot) + '%;top:' + y(value) / 90 * 100 + '%"></span>'; }
      var zoneName = ['KOSPI', 'KOSDAQ', 'KOSPI200_DAY', 'KOSPI200_NIGHT'].indexOf(key) >= 0 ? 'KST' : '����ð�';
      var hoverPoints = rows.map(function (r) {
        var change = hasReference ? homePercentText(Number(r.close), base) : '';
        return [x(r.slot), y(Number(r.close)) / 90 * 100,
          time(Date.parse(meta.start) / 1000 + r.slot * 1800) + ' ' + zoneName + ' ���� �� ���� ' + amount(r.close)
            + (change ? ' (���� ��� ' + change + ')' : '') + '\n���� ' + time(r.ts)];
      });
      element.innerHTML = controls + '<div class="hmb-investor-spark-wrap" data-hover-points="' + homeHoverAttr(hoverPoints) + '"><svg class="hmb-investor-spark" viewBox="0 0 100 90" preserveAspectRatio="none" role="img" aria-label="30�� ���� ����, ���� ���� ' + amount(high.high) + ', ���� ' + amount(low.low) + '">'
        + '<line class="hmb-investor-zero" x1="1" x2="99" y1="' + zero + '" y2="' + zero + '" vector-effect="non-scaling-stroke"/>' + marks + '</svg>' + dot(high, high.high, 'high') + dot(low, low.low, 'low') + '</div>'
        + '<div class="hmb-investor-axis"><span>' + time(Date.parse(meta.start) / 1000) + '</span><span>' + time(Date.parse(meta.end) / 1000) + '</span></div>'
        + '<div class="hmb-investor-extrema"><span>���� ���� <b>' + amount(high.high) + '</b></span><span>���� <b>' + amount(low.low) + '</b></span></div>'
        + '<div class="hmb-investor-asof">' + meta.date + ' �� ���� ' + time(rows[rows.length - 1].ts) + ' �� ' + rows.length + '/' + meta.slotCount + '��</div>'
        + '<div class="hmb-investor-asof">' + result.basis + (hasReference ? ' �� ' + (result.referenceBasis === 'previous-stored-close' ? '���� �ŷ��� ���� ���� ' : '���� ���ذ� ') + amount(base) : ' �� ù ���� �ð� ���� ' + amount(base) + ' (���� ���ذ� ��Ȯ��)') + '</div>';
    }
    dashboardSection.addEventListener('click', function (event) {
      var metricModeButton = event.target.closest('[data-home-metric-mode]');
      if (metricModeButton) {
        var metricMode = metricModeButton.getAttribute('data-home-metric-mode');
        if (metricMode !== 'area' && metricMode !== 'bar') return;
        ['KOSPI200_DAY'].forEach(function (symbol) { homePriceModes[symbol] = metricMode; });
        dashboardSection.querySelectorAll('[data-home-metric-mode]').forEach(function (button) {
          button.setAttribute('aria-pressed', String(button.getAttribute('data-home-metric-mode') === metricMode));
        });
        renderHomeMetricCharts(homeMetricQuotes);
        return;
      }
      var priceButton = event.target.closest('[data-price-mode]');
      if (!priceButton) return;
      var selectedMode = priceButton.getAttribute('data-price-mode');
      if (selectedMode !== 'area' && selectedMode !== 'bar') return;
      var chart = event.target.closest('.home-index-chart');
      var key = chart && chart.getAttribute && chart.getAttribute('data-session-symbol');
      if (key) {
        homePriceModes[key] = selectedMode;
        renderHomeSessionChart(chart, key, null);
        return;
      }
      homePriceMode = selectedMode;
      if (latestHomeIndices) renderHomeIndices(latestHomeIndices);
          renderHomeDayFutures(homeDayFutureQuote, false);
    });
    var homeChartMotion = new WeakMap();
    var homeChartReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function stopHomeChartMotion(element) {
      var state = homeChartMotion.get(element);
      if (state && state.frame) cancelAnimationFrame(state.frame);
    }
    if (document.addEventListener) document.addEventListener('visibilitychange', function () {
      if (document.hidden) dashboardSection.querySelectorAll('.home-index-chart').forEach(function (element) {
        var state = homeChartMotion.get(element);
        if (state && state.finish) state.finish();
      });
    });
    var HOME_SAMPLE_CHARTS = {
      KOSPI: [2642.31, 2648.2, 2655.4, 2651.8, 2663.7, 2670.1, 2665.3, 2678.6, 2684.2, 2691.5, 2687.4, 2698.2, 2705.6, 2712.1, 2708.9, 2720.4],
      KOSDAQ: [756.88, 758.4, 761.2, 759.6, 763.8, 766.1, 764.2, 768.7, 771.5, 770.2, 774.9, 777.1, 775.4, 779.8, 782.6, 785.3],
      NASDAQ_INDEX: [18342.2, 18358.4, 18351.1, 18376.8, 18392.5, 18384.7, 18410.2, 18428.6, 18419.3, 18445.7, 18462.1, 18451.8, 18479.4, 18496.2, 18488.5, 18512.7],
      SP500_INDEX: [5440.1, 5447.8, 5444.2, 5453.9, 5461.7, 5458.4, 5468.2, 5475.6, 5471.9, 5482.3, 5490.1, 5487.6, 5498.4, 5505.2, 5501.8, 5512.6],
      NASDAQ100: [19842.5, 19860.2, 19851.4, 19878.6, 19895.1, 19886.3, 19912.8, 19931.4, 19922.0, 19949.6, 19966.2, 19955.8, 19983.7, 20001.5, 19993.2, 20018.4],
      SP500: [5452.3, 5460.1, 5456.4, 5466.2, 5474.1, 5470.8, 5480.7, 5488.2, 5484.4, 5495.0, 5502.9, 5500.3, 5511.2, 5518.1, 5514.6, 5525.5],
      kospiNight: [360.4, 361.1, 360.8, 361.7, 362.2, 361.9, 362.8, 363.4, 363.1, 364.0, 364.6, 364.2, 365.0, 365.5, 365.2, 366.1]
    };

    function homeChartRows(rows, key) {
      if (HOME_USE_SAMPLE_CHARTS && HOME_SAMPLE_CHARTS[key]) {
        return HOME_SAMPLE_CHARTS[key].map(function (close, index) {
          return { close: close, timestamp: index };
        });
      }
      if (key === 'kospiNight') return rows;
      if (window.MarketChartHistory) return window.MarketChartHistory.merge(key, rows);
      return rows;
    }

    function nightSessionKey(ts) {
      var kst = new Date(Number(ts) * 1000 + 9 * 3600000);
      if (!isFinite(kst.getTime())) return '';
      var hour = kst.getUTCHours();
      if (hour >= 6 && hour < 18) return '';
      if (hour < 6) kst.setUTCDate(kst.getUTCDate() - 1);
      return kst.toISOString().slice(0, 10);
    }

    function nightSessionRows(rows) {
      var valid = (rows || []).filter(function (row) {
        return row && Number(row.ts) > 0 && row.close != null && isFinite(Number(row.close)) && nightSessionKey(row.ts);
      }).sort(function (a, b) { return Number(a.ts) - Number(b.ts); });
      if (!valid.length) return [];
      var latestKey = nightSessionKey(valid[valid.length - 1].ts);
      return valid.filter(function (row) { return nightSessionKey(row.ts) === latestKey; });
    }

    function nightMinuteLabel(ts) {
      var date = new Date(Number(ts) * 1000 + 9 * 3600000);
      return date.toISOString().slice(0, 16).replace('T', ' ');
    }

    function renderHomeIndexChart(element, rows, key, reference) {
      if (!element) return;
      var metricMini = key === 'USDKRW' || key === 'KOSPI200_DAY';
      if (metricMini) element.setAttribute('data-metric-symbol', key);
      // �ٿ� ������ 30�� �������� ���� ��� �Ϻ� ��Ʈ�� ��Ȯ�� �Ⱓ ǥ��� �Բ� ����Ѵ�.
      if (['KOSPI', 'KOSDAQ', 'NASDAQ_INDEX', 'SP500_INDEX', 'SOX', 'NASDAQ100', 'SP500', 'kospiNight'].indexOf(key) >= 0
          || (key === 'DOW' && homeSessionCharts.DOW && homeSessionCharts.DOW.rows && homeSessionCharts.DOW.rows.length)) {
        stopHomeChartMotion(element);
        var oldCaption = element.nextElementSibling;
        if (oldCaption && oldCaption.classList.contains('home-index-history-caption')) oldCaption.remove();
        element.removeAttribute('data-history-count');
        element.removeAttribute('data-history-range');
        renderHomeSessionChart(element, key === 'kospiNight' ? 'KOSPI200_NIGHT' : key, reference);
        return;
      }
      element.classList.remove('has-session-chart');
      element.removeAttribute('data-session-symbol');
      var chartRows = homeChartRows(rows, key) || [];
      var monthlyMini = key !== 'kospiNight';
      if (monthlyMini) chartRows = chartRows.filter(function (row) {
        return row && /^\d{8}$/.test(String(row.date || '').replace(/-/g, '')) && isFinite(Number(row.close));
      }).slice(-20);
      else chartRows = nightSessionRows(chartRows);
      var values = chartRows.map(function (row) { return Number(row && row.close); })
        .filter(function (value) { return isFinite(value); });
      var caption = key === 'kospiNight' ? '�߰� ���� �к� ����' : '�ֱ� 20�ŷ��� �ڷ� ����';
      if (monthlyMini && chartRows.length) {
        var first = String(chartRows[0].date || '').replace(/-/g, '');
        var last = String(chartRows[chartRows.length - 1].date || '').replace(/-/g, '');
        if (/^\d{8}$/.test(first) && /^\d{8}$/.test(last)) {
          caption = (chartRows.length >= 20 ? '�ֱ� 20�ŷ���' : 'Ȯ���� ' + chartRows.length + '�ŷ���') + ' �� '
            + first.slice(0, 4) + '.' + first.slice(4, 6) + '.' + first.slice(6, 8)
            + ' ~ ' + last.slice(0, 4) + '.' + last.slice(4, 6) + '.' + last.slice(6, 8);
        }
      } else if (chartRows.length) {
        caption = '�߰� 1ȸ �� ' + nightMinuteLabel(chartRows[0].ts) + ' ~ '
          + nightMinuteLabel(chartRows[chartRows.length - 1].ts) + ' KST �� ' + chartRows.length + '�� �ü�';
      }
      element.setAttribute('data-history-count', String(values.length));
      element.setAttribute('data-history-range', caption);
      var note = element.nextElementSibling;
      if (metricMini) {
        // ����� ȭ�鿡 �ߺ� ��¥ ������ ���� �ʴ´�. ���� �̷� ������ tooltip/�Ӽ��� ����.
        if (note && note.classList.contains('home-index-history-caption')) note.remove();
        element.setAttribute('title', caption);
      } else {
        if (!note || !note.classList.contains('home-index-history-caption')) {
          note = document.createElement('small'); note.className = 'home-index-history-caption'; element.insertAdjacentElement('afterend', note);
        }
        note.textContent = caption;
      }
      if (values.length < 2) {
        stopHomeChartMotion(element);
        homeChartMotion.delete(element);
        element.innerHTML = '<span class="home-index-chart-empty">���� ������ ����</span>';
        return;
      }
      var width = element.clientWidth || 240;
      var height = metricMini ? 56 : element.clientHeight || 48;
      var pad = monthlyMini ? 38 : 2;
      var topPad = monthlyMini ? 5 : 2;
      var bottom = monthlyMini ? height - 16 : height - 2;
      var plotHeight = bottom - topPad;
      var lineEnd = width - 26; // ���� ���� ���� ������ �� ��ǥ�� �굵�� ���� ������ �д�.
      var min = Math.min.apply(Math, values);
      var max = Math.max.apply(Math, values);
      var range = max - min || 1;
      var coords = values.map(function (value, index) {
        var x = pad + index * (lineEnd - pad) / (values.length - 1);
        var y = bottom - ((value - min) / range) * plotHeight;
        return [x, y];
      });
      var points = coords.map(function (point) { return point[0].toFixed(2) + ',' + point[1].toFixed(2); }).join(' ');
      var hasReference = isFinite(Number(reference)) && reference != null;
      var baseline = hasReference ? Number(reference) : key === 'kospiNight'
        ? Number(chartRows[0].open) : values[values.length - 2];
      if (!isFinite(baseline)) baseline = values[0];
      var last = values[values.length - 1];
      var dotColor = key === 'kospiNight' && !hasReference ? 'var(--hmb-chart-line, #b0bbc8)'
        : last > baseline ? 'var(--hmb-chart-up, #e7aaa5)' : last < baseline ? 'var(--hmb-chart-down, #9dbbe0)' : 'var(--hmb-chart-line, #b0bbc8)';
      var lastY = bottom - ((values[values.length - 1] - min) / range) * plotHeight;
      var guideY = bottom - ((baseline - min) / range) * plotHeight;
      guideY = Math.max(topPad, Math.min(bottom, guideY));
      var signature = chartRows.map(function (row) { return (row.ts || row.date || '') + ':' + row.close; }).join('|');
      var old = homeChartMotion.get(element);
      var sameSize = old && old.width === width && old.height === height;
      if (old && sameSize && old.signature === signature && element.querySelector('.home-chart-trace')) {
        var oldDot = element.querySelector('.home-glow-dot');
        if (oldDot) { oldDot.style.borderColor = dotColor; oldDot.style.backgroundColor = dotColor; }
        return;
      }
      var axis = '';
      if (monthlyMini) {
        [max, min].forEach(function (value, index) {
          axis += '<text class="home-chart-axis" x="1" y="' + (index ? bottom : topPad + 6) + '">' + value.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) + '</text>';
        });
        [0, chartRows.length - 1].forEach(function (index) {
          var date = String(chartRows[index].date).replace(/-/g, '');
          axis += '<text class="home-chart-axis" x="' + (index ? lineEnd : pad) + '" y="' + (height - 2) + '" text-anchor="' + (index ? 'end' : 'start') + '">' + date.slice(4, 6) + '/' + date.slice(6, 8) + '</text>';
        });
      }
      // Two daily metric charts share the index axes and session-chart buy/sell fills and mode controls.
      if (metricMini) {
        stopHomeChartMotion(element);
        homeChartMotion.delete(element);
        var miniMode = homeModeOf(key), refY = guideY, metricParts = '';
        var neutral = !hasReference;
        if (miniMode === 'area') {
          var region = pad + ',' + refY.toFixed(2) + ' ' + points + ' ' + lineEnd + ',' + refY.toFixed(2);
          if (neutral) {
            metricParts = '<g class="hmb-investor-flat"><polygon class="hmb-investor-area" points="' + region
              + '"/><polyline class="hmb-investor-line" points="' + points + '" vector-effect="non-scaling-stroke"/></g>';
          } else {
            var clipId = 'hmb-metric-' + key;
            metricParts = '<defs><clipPath id="' + clipId + '-up"><rect width="' + width + '" height="' + refY
              + '"/></clipPath><clipPath id="' + clipId + '-down"><rect y="' + refY + '" width="' + width
              + '" height="' + (height - refY) + '"/></clipPath></defs>';
            [['up','buy'],['down','sell']].forEach(function (entry) {
              metricParts += '<g class="hmb-investor-' + entry[1] + '" clip-path="url(#' + clipId + '-' + entry[0]
                + ')"><polygon class="hmb-investor-area" points="' + region
                + '"/><polyline class="hmb-investor-line" points="' + points
                + '" vector-effect="non-scaling-stroke"/></g>';
            });
          }
        } else {
          var cell = (lineEnd - pad) / Math.max(1, coords.length - 1);
          var barWidth = Math.max(2, Math.min(8, cell * .55));
          coords.forEach(function (p, index) {
            var val = values[index];
            var side = neutral ? 'flat' : val > baseline ? 'buy' : val < baseline ? 'sell' : 'flat';
            metricParts += '<rect class="hmb-investor-' + side + '" x="' + (p[0] - barWidth / 2).toFixed(2)
              + '" y="' + Math.min(p[1], refY).toFixed(2) + '" width="' + barWidth.toFixed(2)
              + '" height="' + Math.max(.6, Math.abs(p[1] - refY)).toFixed(2) + '" rx="1"><title>'
              + String(chartRows[index].date || '') + ' �� ' + val.toLocaleString('ko-KR', {maximumFractionDigits: 2})
              + '</title></rect>';
          });
        }
        var svg = '<svg viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none" role="img" aria-label="'
          + (key === 'USDKRW' ? '��/�޷�' : 'KOSPI200 �ְ�����') + ' �ֱ� 20�ŷ��� '
          + (miniMode === 'bar' ? '����' : '����') + ' ��Ʈ">'
          + '<line x1="' + pad + '" x2="' + lineEnd + '" y1="' + refY.toFixed(2)
          + '" y2="' + refY.toFixed(2) + '" class="hmb-investor-zero" vector-effect="non-scaling-stroke"/>'
          + metricParts + '</svg>';
        element.innerHTML = '<div class="hmb2-metric-plot">' + svg + '</div>';
        return;
      }
      stopHomeChartMotion(element);
      var append = old && sameSize && chartRows.length > old.count && signature.indexOf(old.signature + '|') === 0;
      var reviseLast = old && sameSize && chartRows.length === old.count && old.signature.split('|').slice(0, -1).join('|') === signature.split('|').slice(0, -1).join('|');
      var animate = !homeChartReducedMotion && !document.hidden && typeof requestAnimationFrame === 'function'
        && (!old || append || reviseLast);
      var startIndex = append ? old.count - 1 : reviseLast ? Math.max(0, coords.length - 2) : 0;
      var duration = append || reviseLast ? 420 : 1800;
      var initial = animate ? startIndex : coords.length - 1;
      element.innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none" aria-hidden="true">'
        + axis
        + '<line x1="' + pad + '" x2="' + lineEnd + '" y1="' + guideY.toFixed(2) + '" y2="' + guideY.toFixed(2) + '" stroke="#cbd0d6" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"></line>'
        + '<polyline class="home-chart-trace" points="' + (animate ? coords[initial][0].toFixed(2) + ',' + coords[initial][1].toFixed(2) : points) + '" fill="none" stroke="var(--hmb-chart-line, #b0bbc8)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"></polyline>'
        + '<g class="home-chart-pen" transform="translate(' + coords[initial][0].toFixed(2) + ' ' + coords[initial][1].toFixed(2) + ')">'
        + '<path d="M0 0 L4 -1.2 L8 -1.2 L8 1.2 L4 1.2 Z" fill="#374151" stroke="#1f2937" stroke-width=".5" vector-effect="non-scaling-stroke"></path>'
        + '<path d="M8 -1.4 L19 -1.4 M8 1.4 L19 1.4 M19 -2.4 L19 2.4" fill="none" stroke="#374151" stroke-width=".9" vector-effect="non-scaling-stroke"></path>'
        + '<path d="M9 0 L17 0" stroke="#9ca3af" stroke-width=".55" vector-effect="non-scaling-stroke"></path></g></svg>'
        + '<span class="home-glow-dot" style="left:' + (lineEnd / width * 100).toFixed(2) + '%;top:' + (lastY / height * 100).toFixed(2) + '%;border-color:' + dotColor + ';background-color:' + dotColor + '" aria-hidden="true"></span>';
      var trace = element.querySelector('.home-chart-trace');
      var pen = element.querySelector('.home-chart-pen');
      var dot = element.querySelector('.home-glow-dot');
      var state = { signature: signature, count: chartRows.length, width: width, height: height, frame: 0, finish: null };
      homeChartMotion.set(element, state);
      function paint(progress) {
        var position = startIndex + progress * (coords.length - 1 - startIndex);
        var index = Math.min(coords.length - 2, Math.floor(position));
        var fraction = Math.min(1, position - index);
        var x = coords[index][0] + (coords[index + 1][0] - coords[index][0]) * fraction;
        var y = coords[index][1] + (coords[index + 1][1] - coords[index][1]) * fraction;
        var visible = coords.slice(0, index + 1).map(function (point) { return point[0].toFixed(2) + ',' + point[1].toFixed(2); });
        visible.push(x.toFixed(2) + ',' + y.toFixed(2));
        trace.setAttribute('points', visible.join(' '));
        pen.setAttribute('transform', 'translate(' + x.toFixed(2) + ' ' + y.toFixed(2) + ')');
        dot.style.left = (x / width * 100).toFixed(2) + '%';
        dot.style.top = (y / height * 100).toFixed(2) + '%';
      }
      state.finish = function () { if (state.frame) cancelAnimationFrame(state.frame); state.frame = 0; paint(1); };
      if (animate) {
        var began = null;
        function tick(now) {
          if (homeChartMotion.get(element) !== state) return;
          if (began === null) began = now;
          var progress = Math.min(1, (now - began) / duration);
          paint(progress);
          if (progress < 1) state.frame = requestAnimationFrame(tick);
          else state.frame = 0;
        }
        state.frame = requestAnimationFrame(tick);
      } else state.finish();
    }

    function formatHomeTimestamp(value) {
      var date = new Date(value);
      if (isNaN(date.getTime())) return String(value || '');
      var parts = new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
      }).formatToParts(date).reduce(function (map, part) {
        map[part.type] = part.value;
        return map;
      }, {});
      return parts.year + '-' + parts.month + '-' + parts.day + ' '
        + parts.dayPeriod + ' ' + parts.hour + ':' + parts.minute + ':' + parts.second;
    }

    function homeMarketSession() {
      var selected = window.HomeMarketSelection && window.HomeMarketSelection.get
        ? window.HomeMarketSelection.get() : null;
      if (selected === 'closed') return {
        closed: true,
        market: 'closed',
        title: '����',
        live: '�ָ� �� ������',
        subtitle: '���� ���� �ȳ�',
        keys: [],
        labels: []
      };
      // get()�� �׻� ���� �����ֹǷ�(���ð� ������ MarketHours.homeMarket()) ���⼭
      // �ð��� �ٽ� ������� �ʴ´� - ��踦 �� ������ ��� ���� ����� �Ѵ�.
      var isUsSession = selected === 'us';
      var usSession = usIndexSessionState();
      return isUsSession ? {
        market: 'us',
        title: '�̱� ����',
        live: usSession.live,
        subtitle: usSession.subtitle,
        statusLabel: usSession.statusLabel,
        keys: usSession.keys,
        labels: usSession.labels
      } : (function () {
        var hours = window.MarketHours;
        var kr = hours && typeof hours.krCash === 'function' ? hours.krCash() : null;
        var label = kr && kr.label ? kr.label : '�� ����';
        var live = label;
        var subtitle = kr && (kr.open || kr.nxtOpen)
          ? '���� ���� �� ' + label
          : '���� ���� �� ' + label;
        return {
          market: 'domestic',
          title: '���� ����',
          live: live,
          subtitle: subtitle,
          statusLabel: label,
          keys: ['KOSPI', 'KOSDAQ'],
          labels: ['KOSPI', 'KOSDAQ']
        };
      }());
    }

    function applyHomeMarketSession(session) {
      var closedPage = dashboardSection.querySelector('[data-home-closed-page]');
      var isClosed = !!(session && session.closed);
      var overviewGrid = dashboardSection.querySelector('.home-overview-grid');
      var widgetGrid = dashboardSection.querySelector('.home-widget-grid');
      var realtimeBoard = dashboardSection.querySelector('.home-realtime-board');
      dashboardSection.classList.toggle('is-market-closed', isClosed);
      if (closedPage) closedPage.hidden = !isClosed;
      // CSS �����ڰ� ��Ų�� body id�� �������� �ʵ��� DOM ��ü������ �����.
      // Tistory ��Ų��WebView�� body id ���̷� ���� ���� �Ʒ��� ���� ���� ȭ����
      // ���� ���� �����Ѵ�.
      if (overviewGrid) overviewGrid.hidden = isClosed;
      if (widgetGrid) widgetGrid.hidden = isClosed;
      if (realtimeBoard) realtimeBoard.hidden = isClosed;
      // 2026-08-22: "�� �� ���� ����Ʈ"(js/home-weekly-report.js�� ����� #homeWeeklyReport)��
      // �� �Լ��� �����ϴ� �����̳ʵ�� ������ .feed�� ���� �ٴ� ��Ҷ�, �ָ��� ����
      // �ѱ�����/�̱����÷� �ٲ㵵 ��� ȭ�� �߰��� ���� ���̴� ������ �־���(����ڰ�
      // "���� �Ǹ� �ǵ�� �Ź� �ϴ� �Ǽ�"��� ���� ����). ���� ���� ���� ���̵��� ���⼭��
      // ���� isClosed �������� ����ȭ�Ѵ�.
      var weeklyReport = document.getElementById('homeWeeklyReport');
      if (weeklyReport) weeklyReport.hidden = !isClosed;
      if (isClosed) return;
      var title = dashboardSection.querySelector('[data-home-market-field="title"]');
      var live = dashboardSection.querySelector('[data-home-market-field="live"]');
      var updated = document.getElementById('hmbUpdated');
      if (title) title.textContent = session.title;
      if (live) live.textContent = session.live;
      var sessionSignature = session.keys.join('|') + '��' + (session.subtitle || '');
      if (updated && (!updated.dataset || updated.dataset.homeSession !== sessionSignature)) {
        updated.textContent = session.subtitle;
        if (updated.dataset) updated.dataset.homeSession = sessionSignature;
      }
      ['primary', 'secondary'].forEach(function (slot, index) {
        var card = homeIndexCard(slot);
        if (!card) return;
        var key = session.keys[index];
        var previousKey = card.getAttribute('data-home-index');
        card.setAttribute('data-home-index', key);
        var label = card.querySelector('[data-index-field="label"]');
        var price = card.querySelector('[data-index-field="price"]');
        var change = card.querySelector('[data-index-field="change"]');
        var status = card.querySelector('[data-index-field="status"]');
        var chart = card.querySelector('[data-index-field="chart"]');
        if (label) label.textContent = session.labels[index];
        if (previousKey && previousKey !== key) {
          if (price) price.textContent = '-';
          if (change) change.textContent = '-';
          if (status) status.textContent = '�� Ȯ�� ��';
          if (chart) chart.innerHTML = '<span class="home-index-chart-empty">�ü� ��ȯ ��</span>';
        }
      });
    }

    function loadHomeSessionCharts() {
      // Home KOSPI/KOSDAQ cards (domestic) and the US panel share this feed; skip it only when the home is closed or the tab is hidden.
      if (homeMarketSession().closed || document.hidden) return;
      if (homeSessionLoading) return;
      homeSessionLoading = true;
      fetchHomeJson('https://goodbyestar.cloud/home-session-chart', 12000)
        .then(function (data) {
          (data && data.data || []).forEach(function (item) { homeSessionCharts[item.symbol] = item; });
          if (latestHomeIndices) renderHomeIndices(latestHomeIndices);
          renderHomeDayFutures(homeDayFutureQuote, false);
        }).catch(function () { /* Keep the last confirmed series on failure. */ })
        .finally(function () { homeSessionLoading = false; });
    }

    var latestFuturesBySymbol = {};
    var homeUsRotation = null;
    var homeUsRotationAt = 0;

    function homeNum(value) { return value == null || value === '' || !isFinite(Number(value)) ? null : Number(value); }
    function homeTone(change) { return change == null || change === 0 ? 'home-neutral' : change > 0 ? 'home-positive' : 'home-negative'; }
    function homeKstTime(value) {
      var date = new Date(value);
      if (isNaN(date.getTime())) return null;
      var p = new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false}).formatToParts(date)
        .reduce(function (m, part) { m[part.type] = part.value; return m; }, {});
      return p.month + '.' + p.day + ' ' + p.hour + ':' + p.minute + ' KST';
    }
    function homeFresh(item, maxMinutes) {
      var stamp = item && Date.parse(item.updated_at);
      return isFinite(stamp) && (Date.now() - stamp) / 60000 <= maxMinutes;
    }
    function homeFill(root, attr, name, text, tone) {
      var el = root && root.querySelector('[' + attr + '="' + name + '"]');
      if (!el) return;
      el.textContent = text;
      el.classList.remove('home-positive', 'home-negative', 'home-neutral');
      if (tone) el.classList.add(tone);
    }
    function homeFmt(value, digits) {
      return value == null ? '-' : value.toLocaleString('ko-KR', {minimumFractionDigits: digits || 0, maximumFractionDigits: digits == null ? 2 : digits});
    }

    // �ڽ���200 �߰����� ���� ī��. ���� /futures(KOSPI200_NIGHT)�� �ִ� �͸� ���� ������ '�̼���'���� �д�.
    // ���� ����� KOSPI200_DAY ���� �ü��� �ѱ� Ȩ���� ��ȸ(�� VM ������ ����).
    var homeDayFutureQuote = null;
    var homeMetricQuotes = {};
    var homeDayFutureRequestedAt = 0;
    var homeDayFutureLoading = false;
    function renderHomeDayFutures(item, failed) {
      var card = dashboardSection.querySelector('[data-home-day-futures]');
      if (!card || card.closest('[data-mtab-idle]')) return;
      var price = item ? homeNum(item.price) : null;
      if (price != null && price <= 0) price = null;
      var change = price != null ? homeNum(item.change) : null;
      var rate = price != null ? homeNum(item.change_rate) : null;
      var stamp = item && homeKstTime(item.updated_at);
      var hours = window.MarketHours;
      var state = hours && typeof hours.krFutures === 'function' ? hours.krFutures() : null;
      var holiday = !!(hours && typeof hours.isKrHoliday === 'function' && hours.isKrHoliday());
      var open = !holiday && !!(state && state.phase === 'regular');
      var fresh = !!(item && !item.stale && homeFresh(item, 5));
      var status = holiday ? '����' : price == null ? (failed ? '���� ����' : '�̼���')
        : open ? (fresh && !item.market_closed ? '�ŷ���' : '�ü� ����') : '�� ����';
      homeFill(card, 'data-home-day-field', 'price', price == null ? '-' : homeFmt(price, 2),
        price == null ? 'home-neutral' : homeTone(change));
      homeFill(card, 'data-home-day-field', 'change',
        change == null ? '-' : (change > 0 ? '��' : change < 0 ? '��' : '') + homeFmt(Math.abs(change), 2)
          + (rate == null ? '' : ' (' + (rate > 0 ? '+' : rate < 0 ? '-' : '') + Math.abs(rate).toFixed(2) + '%)'),
        homeTone(change));
      homeFill(card, 'data-home-day-field', 'status', status, 'home-neutral');
      homeFill(card, 'data-home-day-field', 'high', item && homeNum(item.high) != null ? homeFmt(homeNum(item.high), 2) : '-', 'home-positive');
      homeFill(card, 'data-home-day-field', 'low', item && homeNum(item.low) != null ? homeFmt(homeNum(item.low), 2) : '-', 'home-negative');
      homeFill(card, 'data-home-day-field', 'time',
        (stamp ? '������ ���� ' + stamp : '������ ���� �ð� ����') + ' �� ���� �ü�', 'home-neutral');
      renderHomeSessionChart(card.querySelector('[data-home-day-chart]'), 'KOSPI200_DAY', price != null && change != null ? price - change : null);
      renderHomeFuturesHistory();
    }
    function renderHomeMetricCharts(bySymbol) {
      ['KOSPI200_DAY'].forEach(function (symbol) {
        var chart = dashboardSection.querySelector('[data-home-metric-chart="' + symbol + '"]');
        if (!chart) return;
        var item = bySymbol && bySymbol[symbol];
        var p = item && homeNum(item.price), c = item && homeNum(item.change);
        if (symbol === 'USDKRW') {
          homeFill(dashboardSection, 'data-home-metric-asof', symbol,
            (item && homeKstTime(item.updated_at)) || '���ؽð� ����', 'home-neutral');
        }
        // ��ǥ���� ���� �Ϻ� �ࡤ���ݴ�� �ǹ̻��� ����, ����/����� �ٽ���ǥ ���񿡼� �� ���� ��ȯ.
        renderHomeIndexChart(chart, item && item.chart, symbol, p != null && c != null ? p - c : null);
      });
    }
    var futuresFlowRequestedAt = 0, homeFuturesPayload = null, homeFuturesActor = 'all', homeFuturesDisplay = 'cumulative', homeFuturesSelectedSlot = null, homeFuturesLinkedDate = null;
    var homeFuturesSampleEnabled = true;
    function homeFuturesDisplayData(now) {
      var data = homeFuturesPayload || {};
      var today = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now || new Date());
      if (!homeFuturesSampleEnabled || today !== '2026-11-13' || (data.observations || []).length) return data;
      // Explicit one-day visual fixture: never sent to the API or persisted.
      var foreign = [120,340,260,610,950,820,1240,1100,1580,1960,1720,2210,2050,2470,2730];
      var institution = [-90,-280,-210,-540,-790,-720,-1090,-990,-1360,-1740,-1500,-1960,-1830,-2210,-2480];
      return Object.assign({},data,{sample:true,historyDate:'2026-11-13',observations:foreign.map(function(v,i){
        return {ts:Date.parse('2026-11-13T08:45:00+09:00')/1000+i*1800,foreign:v,institution:institution[i],individual:-v-institution[i]};
      })});
    }
    function futuresObservationTime(ts) {
      return new Date(ts*1000).toLocaleTimeString('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'});
    }
    function renderHomeFuturesHistory() {
      var card=dashboardSection.querySelector('[data-home-futures-flow]'), shared=window.InvestorFlow, data=homeFuturesDisplayData();
      if(!card||card.closest('[data-mtab-idle]')||!shared||!shared.futuresChart)return;
      if(homeFuturesLinkedDate!==data.historyDate){homeFuturesSelectedSlot=null;homeFuturesLinkedDate=data.historyDate;}
      var sampleButton=card.querySelector('[data-futures-sample]');
      if(!sampleButton){sampleButton=document.createElement('button');sampleButton.type='button';sampleButton.setAttribute('data-futures-sample','');var sampleGroup=document.createElement('div');sampleGroup.className='hmb-mode-segment';sampleGroup.appendChild(sampleButton);card.querySelector('.hff-controls').appendChild(sampleGroup);}
      var today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      sampleButton.hidden=today!=='2026-11-13'||!!(homeFuturesPayload&&homeFuturesPayload.observations&&homeFuturesPayload.observations.length);
      sampleButton.textContent=data.sample?'���� ����':'���� ����';sampleButton.setAttribute('aria-pressed',String(!!data.sample));
      var rows=shared.futuresRows(data.observations,data.historyDate);
      if(homeFuturesSelectedSlot==null&&rows.length)homeFuturesSelectedSlot=rows[rows.length-1].slot;
      card.querySelector('[data-futures-flow-bars]').innerHTML=shared.futuresChart(data.observations,{date:data.historyDate,actor:homeFuturesActor,mode:homeFuturesDisplay});
      card.querySelectorAll('[data-futures-actor]').forEach(function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-futures-actor')===homeFuturesActor));});
      card.querySelectorAll('[data-futures-display]').forEach(function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-futures-display')===homeFuturesDisplay));});
      var n=data.available&&data.participants&&data.participants[homeFuturesActor]?homeNum(data.participants[homeFuturesActor].net):null;
      card.querySelector('[data-futures-flow-total]').textContent=(data.sample?'���� ǥ�� �� �� ���� ���� ���� ':'���� ���� ���ż� ')+(n==null?'������':(n>0?'+':n<0?'?':'')+homeFmt(Math.abs(n),0)+'���');
      var slider=card.querySelector('[data-futures-time]');slider.disabled=!rows.length;slider.value=homeFuturesSelectedSlot==null?14:homeFuturesSelectedSlot;
      var table=card.querySelector('[data-futures-activity-table]');
      if(table&&shared.futuresActivityTable)table.innerHTML=shared.futuresActivityTable(data.observations,{date:data.historyDate,mode:homeFuturesDisplay,selectedSlot:homeFuturesSelectedSlot,snapshot:data.sample?null:data});
      syncHomeFuturesSelection();
    }
    function syncHomeFuturesSelection() {
      var shared=window.InvestorFlow,data=homeFuturesDisplayData(),slot=homeFuturesSelectedSlot;
      if(!shared||!shared.futuresRows)return;
      var rows=shared.futuresRows(data.observations,data.historyDate),row=rows.filter(function(r){return r.slot===slot;})[0];
      var price=homeSessionCharts.KOSPI200_DAY||{},same=!!data.historyDate&&price.session&&data.historyDate===price.session.date;
      var point=same&&(price.rows||[]).filter(function(r){return r.slot===slot;})[0];
      var flowText=dashboardSection.querySelector('[data-futures-flow-readout]'),priceText=dashboardSection.querySelector('[data-futures-price-readout]');
      var value=row?row[homeFuturesActor+(homeFuturesDisplay==='interval'?'Delta':'')]:null;
      var activity=row?(homeFuturesDisplay==='interval'?row.activityDelta:row.activity):null;
      var total=activity?activity.totalContracts:null;
      var card=dashboardSection.querySelector('[data-home-futures-flow]');
      var heading=card&&card.querySelector('[data-futures-flow-total]');
      if(heading)heading.textContent=(homeFuturesDisplay==='interval'?'���� ���� �ŷ��� ':'���� ���� ���� �ŷ��� ')+(total==null?'������':homeFmt(total,0)+'���');
      if(card)card.querySelectorAll('[data-futures-row]').forEach(function(tr){tr.classList.toggle('is-selected',Number(tr.getAttribute('data-futures-row'))===slot);});
      if(flowText)flowText.textContent=!rows.length?'���� �̷� ��� �� ù ���� ���� ������ ��� ��':!row?data.historyDate+' �� �� ���� ���� ���� ����':data.historyDate+' �� '+(row.previousTs&&homeFuturesDisplay==='interval'?futuresObservationTime(row.previousTs)+'��':'')+futuresObservationTime(row.ts)+' ���� �� '+(homeFuturesDisplay==='interval'?'���� ���� ��� ���� ':'���� ���� ���ż� ')+(value==null?'���� ���� ����':(value>0?'+':value<0?'?':'')+homeFmt(Math.abs(value),0)+'���');
      if(homeFuturesActor==='all' && row && flowText)flowText.textContent=data.historyDate+' �� '+futuresObservationTime(row.ts)+' ���� ���� �� '+(homeFuturesDisplay==='interval'?'���� ���� ���':'���� ����')+' �� '+[['foreign','�ܱ���'],['institution','���'],['individual','����']].map(function(actor){var v=row[actor[0]+(homeFuturesDisplay==='interval'?'Delta':'')];return actor[1]+' '+(v==null?'������':(v>0?'+':v<0?'?':'')+homeFmt(Math.abs(v),0)+'���');}).join(' / ');
      if(data.sample&&flowText)flowText.textContent='[���� ������ �� ���� �Ÿ� �ƴ�] '+flowText.textContent.replace(' ����',' ����');
      if(priceText)priceText.textContent=!rows.length?'���� ���� �̷� ��� �� ���ݰ� �ٸ� ��¥�� �������� ����':!same?'���ݡ����� ��¥ ����ġ �� ���� ����':point?data.historyDate+' �� '+futuresObservationTime(point.ts)+' ���� ���� �� '+homeFmt(point.close,2):'���� ������ ���� ���� ����';
      if(data.sample&&priceText)priceText.textContent='���� ���� / ������ ���� �� '+priceText.textContent;
      dashboardSection.querySelectorAll('[data-home-futures-pair] [data-linked-cursor]').forEach(function(n){n.remove();});
      if(slot==null||!same||!row)return;
      dashboardSection.querySelectorAll('[data-home-futures-pair] .hmb-investor-spark').forEach(function(svg){
        var line=document.createElementNS('http://www.w3.org/2000/svg','line'),x=4+slot/14*92;
        line.setAttribute('x1',x);line.setAttribute('x2',x);line.setAttribute('y1','4');line.setAttribute('y2','85');line.setAttribute('data-linked-cursor','');line.setAttribute('class','hff-cursor');line.setAttribute('vector-effect','non-scaling-stroke');svg.appendChild(line);
      });
    }
    dashboardSection.addEventListener('click',function(e){
      var actor=e.target.closest('[data-futures-actor]'),mode=e.target.closest('[data-futures-display]');
      if(e.target.closest('[data-futures-sample]')){homeFuturesSampleEnabled=!homeFuturesSampleEnabled;homeFuturesSelectedSlot=null;renderHomeFuturesHistory();}
      if(actor){homeFuturesActor=actor.getAttribute('data-futures-actor');renderHomeFuturesHistory();}
      if(mode){homeFuturesDisplay=mode.getAttribute('data-futures-display');renderHomeFuturesHistory();}
    });
    dashboardSection.addEventListener('input',function(e){if(e.target.matches('[data-futures-time]')){homeFuturesSelectedSlot=Number(e.target.value);syncHomeFuturesSelection();}});
    dashboardSection.addEventListener('pointermove',function(e){
      if(e.pointerType==='touch')return;
      var plot=e.target.closest('[data-home-futures-pair] .hmb-investor-spark');if(!plot)return;
      var box=plot.getBoundingClientRect(),slot=Math.max(0,Math.min(14,Math.round(((e.clientX-box.left)/box.width*100-4)/92*14)));
      if(slot!==homeFuturesSelectedSlot){homeFuturesSelectedSlot=slot;var slider=dashboardSection.querySelector('[data-futures-time]');if(slider)slider.value=slot;syncHomeFuturesSelection();}
    });
    function loadHomeFuturesFlow() {
      if (Date.now() - futuresFlowRequestedAt < 300000) return;
      var card = dashboardSection.querySelector('[data-home-futures-flow]');
      if (!card || card.closest('[data-mtab-idle]')) return;
      futuresFlowRequestedAt = Date.now();
      Promise.all([fetchHomeJson('https://goodbyestar.cloud/futures/investor-flow', 15000),
        loadHomeScript(HOME_INVESTOR_FLOW_SCRIPT_URL, 'InvestorFlow')]).then(function (results) {
        var env = results[0];
        var data = env && env.data || env || {}, rows = data.participants || {};
        homeFuturesPayload = data;
        renderHomeFuturesHistory();
        card.querySelector('[data-futures-flow-meta]').textContent = 'KOSPI200 ���� ��ü���� �� 30�к� ������ ���� ���� �� �������ܰ� �ƴ�'
          + (data.retrievedAt ? ' �� ��ȸ ' + homeKstTime(data.retrievedAt) : '')
          + ' �� ���� ������/�ð� ������' + (data.stale ? ' �� ����/��ȸ ����' : '');
      }).catch(function () {
        futuresFlowRequestedAt = Date.now() - 240000;
        card.querySelector('[data-futures-flow-meta]').textContent = '��ȸ ���� �� ���� ǥ�� ���� �� ���� ���� �� ��õ�';
      });
    }
    window.addEventListener('home-mtab-activate',function(e){if(e.detail&&e.detail.group==='market'){renderHomeDayFutures(homeDayFutureQuote,false);loadHomeDayFutures();}});
    function loadHomeDayFutures() {
      if (homeMarketSession().market !== 'domestic' || document.hidden) return;
      loadHomeFuturesFlow();
      if (homeDayFutureLoading || Date.now() - homeDayFutureRequestedAt < 50000) return;
      homeDayFutureLoading = true;
      homeDayFutureRequestedAt = Date.now();
      // ���� ������ �Ϻ� ��Ʈ 2���� �Բ� ������ �߰� �ֱ�/���� ���μ����� ������ �ʴ´�.
      fetchHomeJson('https://goodbyestar.cloud/futures?symbols=KOSPI200_DAY&days=30&stored_only=true', 12000)
        .then(function (response) {
          var rows = response && Array.isArray(response.data) ? response.data : [];
          var by = {};
          rows.forEach(function (row) {
            if (row && row.symbol === 'KOSPI200_DAY') by[row.symbol] = row;
          });
          homeMetricQuotes = Object.assign({}, homeMetricQuotes, by);
          homeDayFutureQuote = by.KOSPI200_DAY || null;
          renderHomeDayFutures(homeDayFutureQuote, false);
          renderHomeMetricCharts(homeMetricQuotes);
        }).catch(function () {
          renderHomeDayFutures(homeDayFutureQuote, true);
          renderHomeMetricCharts(homeMetricQuotes);
        }).then(function () { homeDayFutureLoading = false; });
    }

    function renderHomeNightCard(item) {
      var card = dashboardSection.querySelector('[data-home-night-futures]');
      if (!card) return;
      var kst = new Date(Date.now() + 9 * 3600000).getUTCHours();
      var inSession = kst >= 18 || kst < 6;
      var holiday = isNightFuturesHoliday();
      var fresh = homeFresh(item, 30);
      var status = holiday ? '����' : !item ? '�̼���' : !inSession ? '�帶��' : fresh && !item.stale ? '�ŷ���' : '���� �� �̼���';
      var change = item ? homeNum(item.change) : null, rate = item ? homeNum(item.change_rate) : null;
      var tone = homeTone(change);
      homeFill(card, 'data-night-field', 'status', status, status === '�ŷ���' ? 'home-positive' : 'home-neutral');
      homeFill(card, 'data-night-field', 'change', change == null ? '-' : (change > 0 ? '��' : change < 0 ? '��' : '') + homeFmt(Math.abs(change), 2) + (rate == null ? '' : ' (' + (rate > 0 ? '+' : rate < 0 ? '-' : '') + Math.abs(rate).toFixed(2) + '%)'), tone);
      homeFill(card, 'data-night-field', 'high', item && homeNum(item.high) != null ? homeFmt(homeNum(item.high), 2) : '-', 'home-positive');
      homeFill(card, 'data-night-field', 'low', item && homeNum(item.low) != null ? homeFmt(homeNum(item.low), 2) : '-', 'home-negative');
      var stamp = item && homeKstTime(item.updated_at);
      homeFill(card, 'data-night-field', 'time', stamp ? '������ ���� ' + stamp + ' �� 18:00~06:00 �߰� ����' : '������ ���� �ð� ����');
    }

    var US_GLOBAL_TILES = {
      WTI: {digits: 2, prefix: '$', note: '����(CL ���ӿ���) �� '}, USDKRW: {digits: 1, suffix: '��'},
      US10Y: {digits: 2, suffix: '%', pp: true}, VIX: {digits: 2}
    };

    function renderHomeUsPanels() {
      var by = latestFuturesBySymbol || {};
      var globalBlock = dashboardSection.querySelector('[data-home-global]');
      if (!globalBlock || !homeShowsUs) return;
      // �ֵ�/���� ����: /us-sector-rotation(ETF Ȯ�� �Ϻ�). �ǽð� ���� �м��� �ƴϴ�.
      var rotation = dashboardSection.querySelector('[data-home-us-rotation]');
      var groups = [['leaders', ['emerging', 'leading'], -1], ['cautions', ['lagging', 'weakening'], 1]].map(function (def) {
        var rows = homeUsRotation ? def[1].reduce(function (all, k) { return all.concat(homeUsRotation[k] || []); }, []) : [];
        return {key: def[0], rows: rows.filter(function (r) { return r && r.sector && homeNum(r.rotationScore) != null; })
          .sort(function (a, b) { return def[2] * (a.rotationScore - b.rotationScore); }).slice(0, 3)};
      });
      // ���� ���̴� �� ǥ�� ���� ����(���� ū ����� = ���� ��)�� ����, 0�� �������� ����� �����ʡ��϶��� �����̴�.
      var rotScale = groups.reduce(function (m, g) { return g.rows.reduce(function (n, r) { return Math.max(n, Math.abs(homeNum(r.return1d) || 0)); }, m); }, 0.5);
      groups.forEach(function (g) {
        var list = rotation && rotation.querySelector('[data-us-rot="' + g.key + '"] .hus-rot-list');
        if (!list) return;
        list.innerHTML = g.rows.length ? g.rows.map(function (r) {
          var rt = homeNum(r.return1d), tv = homeNum(r.tradingValueRatio);
          var width = rt == null ? 0 : Math.min(50, Math.abs(rt) / rotScale * 50);
          return '<li><span class="hus-name">' + escapeHomeHtml(r.sector) + '</span>'
            + '<span class="hus-bar" role="img" aria-label="' + escapeHomeHtml(r.sector + ' ' + (rt == null ? '����� ����' : rt.toFixed(2) + '%')) + '"><i class="' + (rt > 0 ? 'is-up' : 'is-down') + '" style="width:' + width.toFixed(1) + '%"></i></span>'
            + '<b class="' + homeTone(rt) + '">' + (rt == null ? '-' : (rt > 0 ? '+' : '') + rt.toFixed(2) + '%') + '</b>'
            + '<small>' + (tv != null ? tv.toFixed(2) + '��' : '-') + '</small></li>';
        }).join('') : '<li class="ui-kpi-empty">' + (homeUsRotation ? '���� ������ ����' : 'Ȯ�� ��') + '</li>';
      });
      var rotMeta = rotation && rotation.querySelector('[data-us-rot-meta]');
      if (rotMeta) rotMeta.textContent = homeUsRotation && homeUsRotation.date
        ? '���� ETF ��� �� ' + homeUsRotation.date.slice(5).replace('-', '.') + ' ������ ����' + (homeUsRotation.final === false ? '(����)' : '') + ' �� �ǽð� �ƴ�'
        : '���� ETF ��� �� ������ ���� ����';
      // �۷ι� ��ǥ 4��(WTI����/�޷����� 10�⹰��VIX).
      globalBlock.querySelectorAll('[data-global-tile]').forEach(function (tile) {
        var key = tile.getAttribute('data-global-tile'), cfg = US_GLOBAL_TILES[key] || {}, item = by[key];
        var price = item ? homeNum(item.price) : null, change = item ? homeNum(item.change) : null, rate = item ? homeNum(item.change_rate) : null;
        homeFill(tile, 'data-global-field', 'price', price == null ? '-' : (cfg.prefix || '') + homeFmt(price, cfg.digits) + (cfg.suffix || ''), homeTone(change));
        var delta = cfg.pp ? (change == null ? null : (change > 0 ? '��' : change < 0 ? '��' : '') + Math.abs(change).toFixed(2) + '%p')
          : (rate == null ? null : (change > 0 ? '��' : change < 0 ? '��' : '') + Math.abs(rate).toFixed(2) + '%');
        homeFill(tile, 'data-global-field', 'change', delta || '-', homeTone(change));
        var stamp = item && homeKstTime(item.updated_at);
        homeFill(tile, 'data-global-field', 'time', !item ? '�̼���' : (cfg.note || '') + (item.stale ? '���� �� ' : '') + (stamp ? '���� ' + stamp : '���ؽð� ����'));
      });
    }

    // �̱� ���� �����̼�: �Ϻ� Ȯ�����̶� 10�п� �� ���� �д´�. �����ϸ� ������ ���� �����Ѵ�.
    function loadHomeUsRotation() {
      if (Date.now() - homeUsRotationAt < 600000 && homeUsRotation) return;
      homeUsRotationAt = Date.now();
      fetchHomeJson('https://goodbyestar.cloud/us-sector-rotation', 12000).then(function (env) {
        var d = env && env.data ? env.data : env;
        if (d && d.available !== false) { homeUsRotation = d; renderHomeUsPanels(); }
      }).catch(function () { /* ���� �� ���� */ });
    }

    // �̱� ������ ���δ� ���� MarketHours(���� ���� �ð���DST�����塤���� ����)�� ���� ��ó�� ����Ѵ�.
    function usThirdIndexState(now) {
      var hours = window.MarketHours;
      var spot = hours && typeof hours.us === 'function' ? hours.us(now) : null;
      var regular = !!(spot && spot.open && spot.phase === 'regular');
      return regular
        ? { key: 'SOX', label: '�ʶ��Ǿ� �ݵ�ü', regular: true }
        : { key: 'DOW', label: '�ٿ�����30 ����(CME)', regular: false };
    }

    function renderHomeIndices(items) {
      var session = homeMarketSession();
      applyHomeMarketSession(session);
      var bySymbol = {};
      (items || []).forEach(function (item) { if (item && item.symbol) bySymbol[item.symbol] = item; });
      latestHomeIndices = items || [];
      renderMarketParticipation();
      if (session.market === 'domestic') renderDomesticDirection(homeDomesticMarketTemp);
      if (session.market === 'us' && latestUsBoardData) renderUsMarketSummary(latestUsBoardData);
      // �̱� ���� ��� ī���� "�ڽ��� �߰�����" ĭ - hidden ���¿��� ���� �׻� ä���ּ�
      // ������ ��ȯ�Ǵ� ����(applyHomeSummarySession) �ٷ� �ֽŰ��� ���̰� �Ѵ�.
      var nightItem = bySymbol.KOSPI200_NIGHT;
      var nightChartEl = dashboardSection.querySelector('[data-night-futures-chart]');
      renderHomeNightCard(nightItem);
      latestFuturesBySymbol = bySymbol;
      renderHomeUsPanels();
      if (isNightFuturesHoliday()) {
        setField('nightFutures', '����', 'home-neutral');
        // ���� ������ �� ĭ���� ǥ���Ѵ�. ��Ʈ �� ���±��� "����"��
        // �ݺ��ϸ� �� ĭ�� �� ��ó�� ���δ�.
        if (nightChartEl) { nightChartEl.hidden = true; nightChartEl.innerHTML = ''; }
      } else if (nightItem) {
        var nPrice = Number(nightItem.price);
        var nChange = Number(nightItem.change);
        var nRate = Number(nightItem.change_rate);
        var nTone = !isFinite(nChange) || nChange === 0 ? 'home-neutral' : nChange > 0 ? 'home-positive' : 'home-negative';
        // �������������� ���� ī���� ���� ��(renderHomeNightCard)�� �����ֹǷ� �� ĭ���� ���簡�� �д�.
        var nText = isFinite(nPrice) ? nPrice.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : '-';
        setField('nightFutures', nText, nTone);
        // �߰� ��Ʈ���� ������ ���� ���� �к��� ����Ѵ�. ������ ������ �� ���� �Ŀ���
        // �����, ���� 18:00 ������ ù �к��� �����ϸ� �׶� �� �������� ��ü�Ѵ�.
        if (nightChartEl) {
          nightChartEl.hidden = false;
          renderHomeIndexChart(nightChartEl, [], 'kospiNight', isFinite(nPrice) && isFinite(nChange) ? nPrice - nChange : null);
        }
      } else {
        setField('nightFutures', '������ Ȯ�� ��', 'home-neutral');
        if (nightChartEl) { nightChartEl.hidden = true; nightChartEl.innerHTML = ''; }
      }
      var thirdCard = homeIndexCard('tertiary');
      if (thirdCard && session.market === 'us') {
        var third = usThirdIndexState(), thirdItem = bySymbol[third.key];
        var thirdPrice = thirdItem ? homeNum(thirdItem.price) : null;
        var thirdChange = thirdItem ? homeNum(thirdItem.change) : null;
        var thirdRate = thirdItem ? homeNum(thirdItem.change_rate) : null;
        var thirdTone = homeTone(thirdChange);
        // ���� ���Կ��� �ٸ� ������ ��ü�� �� ���� �ü�����Ʈ�� ���� ȥ����Ű�� �ʴ´�.
        if (thirdCard.getAttribute('data-home-index') !== third.key) {
          thirdCard.setAttribute('data-home-index', third.key);
          var oldChart = thirdCard.querySelector('[data-index-field="chart"]');
          if (oldChart) oldChart.innerHTML = '';
        }
        var thirdLabelEl = thirdCard.querySelector('[data-index-field="label"]');
        var thirdPriceEl = thirdCard.querySelector('[data-index-field="price"]');
        var thirdChangeEl = thirdCard.querySelector('[data-index-field="change"]');
        var thirdStatusEl = thirdCard.querySelector('[data-index-field="status"]');
        if (thirdLabelEl) thirdLabelEl.textContent = third.label;
        if (thirdPriceEl) { thirdPriceEl.textContent = thirdPrice == null ? '-' : thirdPrice.toLocaleString('ko-KR', {maximumFractionDigits: 2}); thirdPriceEl.className = thirdTone; }
        if (thirdChangeEl) { thirdChangeEl.textContent = thirdRate == null ? '-' : (thirdChange > 0 ? '��' : thirdChange < 0 ? '��' : '') + Math.abs(thirdRate).toFixed(2) + '%'; thirdChangeEl.className = thirdTone; }
        if (thirdStatusEl) {
          var thirdDelayed = !!(thirdItem && (thirdItem.stale || !homeFresh(thirdItem, 30)));
          thirdStatusEl.textContent = !thirdItem ? '�� �̼���'
            : thirdDelayed ? '�� �ü� ����'
            : third.regular ? '�� ���� �ŷ���'
            : usFuturesSessionOpen() ? '�� ���� �ŷ��ð�' : '�� ���� ������ ��';
        }
        renderHomeIndexChart(thirdCard.querySelector('[data-index-field="chart"]'),
          thirdItem && thirdItem.chart, third.key,
          thirdPrice != null && thirdChange != null ? thirdPrice - thirdChange : null);
      }
      session.keys.forEach(function (key, index) {
        var card = homeIndexCard(index === 0 ? 'primary' : 'secondary');
        var item = bySymbol[key];
        if (!card) return;
        var price = item && Number(item.price);
        var change = item && Number(item.change);
        var rate = item && Number(item.change_rate);
        var tone = !isFinite(change) || change === 0 ? 'home-neutral' : change > 0 ? 'home-positive' : 'home-negative';
        var priceEl = card.querySelector('[data-index-field="price"]');
        var changeEl = card.querySelector('[data-index-field="change"]');
        var statusEl = card.querySelector('[data-index-field="status"]');
        var chartEl = card.querySelector('[data-index-field="chart"]');
        if (priceEl) { priceEl.textContent = isFinite(price) ? price.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : '-'; priceEl.className = tone; }
        if (changeEl) { changeEl.textContent = isFinite(rate) ? (change > 0 ? '��' : change < 0 ? '��' : '') + Math.abs(rate).toFixed(2) + '%' : '-'; changeEl.className = tone; }
        if (statusEl) statusEl.textContent = item ? '�� ' + (item.status || session.statusLabel || '����') : '�� ������ ����';
        renderHomeIndexChart(chartEl, item && item.chart, key, item && item.price != null && item.change != null ? Number(item.price) - Number(item.change) : null);
      });
    }

    var homeChartResizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(homeChartResizeTimer);
      homeChartResizeTimer = setTimeout(function () {
        if (latestHomeIndices && latestHomeIndices.length) renderHomeIndices(latestHomeIndices);
      }, 120);
    });

    var homeHistoryJobs = {};
    function loadHomeHistory(session) {
      var group = session.market === 'us' ? 'global' : 'domestic';
      if (homeHistoryJobs[group]) return;
      homeHistoryJobs[group] = loadHomeScript('https://goodbyestarwars.github.io/tistory-ticker/js/market-history.js?v=20261008-home-5y', 'MarketChartHistory')
        .then(function (history) { return history.load(group); })
        .then(function () { if (latestHomeIndices) renderHomeIndices(latestHomeIndices);
          renderHomeDayFutures(homeDayFutureQuote, false); })
        .catch(function () { /* �̷� �ε� ���� �� ���� �ֱ� �ڷ�� �ü� ȭ���� �����Ѵ�. */ });
    }
    function loadHomeIndices() {
      var session = homeMarketSession();
      loadHomeHistory(session);
      applyHomeMarketSession(session);
      if (session.market === 'domestic') loadHomeDayFutures();
      if (session.closed) return;
      var request = window.QuickIndices && typeof window.QuickIndices.fetchFutures === 'function'
        ? window.QuickIndices.fetchFutures()
        : fetchHomeJson('https://goodbyestar.cloud/futures?symbols=KOSPI%2CKOSDAQ%2CNASDAQ_INDEX%2CSP500_INDEX%2CNASDAQ100%2CSP500%2CDOW%2CKOSPI200_NIGHT%2CVIX%2CWTI%2CGOLD%2CUSDKRW%2CUS10Y%2CBTC%2CSOX&stored_only=true', 12000)
          .then(function (data) { return data && data.data ? data.data : []; });
      request.then(renderHomeIndices).catch(function () {
        ['primary', 'secondary'].forEach(function (slot) {
          var card = homeIndexCard(slot);
          if (!card) return;
          var status = card.querySelector('[data-index-field="status"]');
          if (status) status.textContent = '�� �ü� ����';
        });
      });
    }

    loadHomeIndices();
    loadHomeSessionCharts();
    loadHomeIndexBreadth();
    setInterval(function () {
      if (document.hidden) return;
      loadHomeIndices();
      loadHomeSessionCharts();
      loadHomeIndexBreadth();
    }, 60 * 1000);


    // �������� ���� ������ ���� ���� �г��� �� ���� ǥ���Ѵ�.
    var homeMarketBoard = dashboardSection.querySelector('#homeMarketBoard');
    var homeDisclosureSection = homeMarketBoard && homeMarketBoard.querySelector('[data-home-disclosure-section]');
    var homeDisclosureSlot = dashboardSection.querySelector('[data-home-disclosure-slot]');
    if (homeDisclosureSection && homeDisclosureSlot) homeDisclosureSlot.appendChild(homeDisclosureSection);
    var latestHomeIndices = [];
    var latestUsBoardData = null;
    var weeklyReportModule = null;
    var weekendReportWindow = isWeekendReportWindow();
    function syncMarketSwitch() {
      var selected = window.HomeMarketSelection.get();
      dashboardSection.querySelectorAll('[data-home-market-switch]').forEach(function (button) {
        var active = button.getAttribute('data-home-market-switch') === selected;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }
    dashboardSection.querySelectorAll('[data-home-market-switch]').forEach(function (button) {
      button.addEventListener('click', function () {
        var market = button.getAttribute('data-home-market-switch');
        try {
          window.HomeMarketSelection.set(market);
        } catch (error) {
          // �Ϻ� ���� WebView���� CustomEvent�� �����ص� set()�� ���ð���
          // ���� �����ϹǷ�, �Ʒ����� ȭ���� ���� ����ȭ�� �� �ִ�.
        }
        syncMarketSwitch();
        applyHomeMarketSession(homeMarketSession());
      });
    });
    syncMarketSwitch();
    window.addEventListener('home-market-change', function () {
      syncMarketSwitch();
      // ���� ���� �ü� API ������ ��ٸ��� �ʰ� �غ�� ���� ������ ��� ����.
      // ���� �Ʒ��� ���� ���� ���� �ڵ鷯�� ������ �δ��� �����Ѵ�.
      applyHomeMarketSession(homeMarketSession());
      if (weeklyReportModule && weeklyReportModule.init) weeklyReportModule.init();
    });
    // ��ú���� �ǵ� �ֻ��(ù ����/�� ī�� �ٷ� ��)�� �ִ´�. ������ ���� ���ŵ�
    // #investor-trend-widget mount�� ���������� ��µ�, �� mount�� ��� ��ġ��
    // �����ǵ��� ù ī�带 ���������� �����Ѵ�.
    var dashboardAnchor = investorMount || feed.querySelector('.notice-card, .post-card');
    if (dashboardAnchor) feed.insertBefore(dashboardSection, dashboardAnchor);
    else feed.appendChild(dashboardSection);
    if (investorMount) investorMount.remove();
    if (rankMount) rankMount.remove();
    var oldSidebar = document.querySelector('.sidebar-right');
    if (oldSidebar) oldSidebar.hidden = true;

    // ȯ���� ������ ���� �µ��� ���簪�� �ٽ��̴�. ���� ĳ�ø� ���� �׸���
    // ����ó�� �ٲ�ų� ������ ������ �ڿ��� ������ ȯ���� ȭ�鿡 ���� �� �ִ�.
    // Ű�� �÷� ���� ���� ����ϰ�, �ֽ� ������ ���� �ڿ��� ������ �׸���.
    var marketTempCacheKey = 'home_market_temp_vm_v3';
    var marketSectorCacheKey = 'home_market_sectors_v1';
    var cachedMarketTemp = readHomeDataCache(marketTempCacheKey, 2 * 60 * 1000);
    var cachedMarketSectors = readHomeDataCache(marketSectorCacheKey, 5 * 60 * 1000);
    var summarySessionKey = '';
    var loadHomeUsSummary;
    var loadHomeDomesticSummary;
    var loadHomeInvestorTrend;

    function loadSummaryForSession(session) {
      if (session && session.closed) {
        applyHomeMarketSession(session);
        summarySessionKey = '';
        return;
      }
      var isUs = !!session && session.market === 'us';
      var nextKey = (session.keys || []).join('|');
      summarySessionKey = nextKey;
      applyHomeSummarySession(session);
      if (isUs) {
        loadHomeUsSummary();
      } else {
        loadHomeDomesticSummary();
      }
    }

    // Use the same VM score100/components as the market page. The GAS temperature
    // model has different inputs and must not silently replace this score.
    fetchHomeJson(MARKET_TEMP_VM_URL, 12000)
      .then(function (body) { return body && body.data ? body.data : body; })
      .then(function (market) {
        if (!market || typeof market.score100 !== 'number' || !isFinite(market.score100)) throw new Error('market score unavailable');
        writeHomeDataCache(marketTempCacheKey, market);
        if (homeMarketSession().market === 'us') renderMarketExchange(market);
        else renderMarketTemperature(market);
      })
      .catch(function () {
        // ��Ʈ��ũ�� ������ ��쿡�� 2�� �̳��� ĳ�ø� ��� ǥ�÷� ����Ѵ�.
        // ���� ��ο����� �ݵ�� �̹� ��û�� �ֽ� ������ ���� �׸���.
        if (cachedMarketTemp) {
          if (homeMarketSession().market === 'us') renderMarketExchange(cachedMarketTemp);
          else renderMarketTemperature(cachedMarketTemp);
        } else if (homeMarketSession().market !== 'us') {
          if (!homeVmScoreText) setField('temperature', '�Ͻ� ����', 'home-neutral');
          setField('direction', '������ Ȯ�� ��', 'home-neutral');
          setField('exchange', '�Ͻ� ����', 'home-neutral');
        }
      });

    // ���� ������ �� ���񡤾����� ���� ��ġ�� ���� ����� ���� �����̴�.
    // ù ����Ʈ�� ����/����/��ŷ ������ ���� �ʰ�, �������� ���� ���°� �� ��
    // ���� ��ุ ä���. ���� ���� ������ ������ ��� �����Ѵ�.
    var loadHomeSectors = function () {
      // 2026-08-05: 12000 -> 20000(�� marketTemp ȣ��� ������ ���� - ���޽ð��� �����
      // ù ����Ʈ�� ������ ������, �ʹ� ª���� "�ֵ� ����"/"���� ����"�� ���� �Ͻ� �������� ���).
      fetchHomeJson(GAS_TICKER_URL + '?bubble=1', 20000)
        .then(function (bubble) {
          writeHomeDataCache(marketSectorCacheKey, bubble);
          renderMarketSectors(bubble);
        })
        .catch(function () {
          if (!cachedMarketSectors) {
            var lists = dashboardSection.querySelectorAll('[data-home-kr-rotation] .hus-rot-list');
            lists.forEach(function (list) { list.innerHTML = '<li class="ui-kpi-empty">���� ���� ����</li>'; });
          }
      });
    };

    loadHomeUsSummary = function () {
      loadHomeUsIndexBreadth();
      (window.HomeMarketBoard
        ? window.HomeMarketBoard.fetch('us')
        : fetchHomeJson('https://goodbyestar.cloud/market-board?market=us&limit=40', 12000))
        .then(renderUsMarketSummary)
        .catch(function () {
          setField('temperature', '������ Ȯ�� ��', 'home-neutral');
          setField('leaders', '������ Ȯ�� ��', 'home-neutral');
          setField('cautions', '������ Ȯ�� ��', 'home-neutral');
        });
    };

    loadHomeDomesticSummary = function () {
      if (cachedMarketSectors) renderMarketSectors(cachedMarketSectors);
      // ���� �ݹ鿡�� �����ϸ� ����� WebView�� ��� �̷�鼭 �ֵ�/���� ������
      // ��� ���� �� �ִ�. fetch ��ü�� �񵿱��̹Ƿ� ��� ������ ù ȭ���� ���� �ʴ´�.
      // ���� ������ ���� �� ������, ���� �ݹ鿡 ������ ����� WebView����
      // ��ȸ�� �ڷ� �з� "�ֵ�/���� ����"�� ��� ��� ���δ�. ĳ�ø� ����
      // �׸� �� �ֽ� ���� ��û�� ��� �����Ѵ�.
      loadHomeSectors();
      loadHomeInvestorTrend();
    };

    function investorAmountText(value) {
      if (value == null || value === '') return '-';
      var n = Number(value);
      if (!isFinite(n)) return '-';
      if (n === 0) return '0��';
      var sign = n < 0 ? '-' : '+';
      var abs = Math.abs(n);
      if (abs >= 10000) return sign + (abs / 10000).toFixed(1).replace(/\.0$/, '') + '��';
      return sign + Math.round(abs).toLocaleString('ko-KR') + '��';
    }

    // Ȩ�� ���� ���� �������� ����Ѵ�. ���� �Ϻ� ���� ��Ʈ/���� �������� ���� ������� ����.
    var homeInvestorMiniHistory = null;
    var homeInvestorMiniLastAttempt = 0;
    var homeInvestorMiniInterval = 5 * 60 * 1000;
    var homeInvestorMode = 'area';  // 2026-10-16 ����� ��û: ����/���� ��ȯ ��ǥ�� �⺻���� ����
    var homeInvestorActor = 'compare'; // �ܱ��Ρ��������, �⺻ ��
    var homeInvestorResults = null;
    var homeInvestorLoading = false;

    function investorTimeText(value) {
      var date = new Date(value);
      return value && isFinite(date.getTime()) ? date.toLocaleTimeString('ko-KR', {
        timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false
      }) : '-';
    }

    function investorSparkline(result, mode, marketKey, actor) {
      actor = actor || 'compare';
      var rows = (result.rows || []).filter(function (r) {
        return Number.isInteger(r.slot) && r.slot >= 0 && r.slot < 14
          && (r.frgn != null && isFinite(Number(r.frgn)) || r.orgn != null && isFinite(Number(r.orgn)));
      }).slice().sort(function (a, b) { return a.slot - b.slot; });
      if (!rows.length) return '<div class="hmb-investor-spark-empty">���� ��� ���� ��</div>';
      var foreigners = actor === 'institution' ? [] : rows.filter(function (r) { return r.frgn != null && isFinite(Number(r.frgn)); });
      var institutions = actor === 'foreign' ? [] : rows.filter(function (r) { return r.orgn != null && isFinite(Number(r.orgn)); });
      if (!foreigners.length && !institutions.length) return '<div class="hmb-investor-spark-empty">������ ������ ������ ����</div>';
      var extremaField = actor === 'institution' ? 'orgn' : 'frgn';
      var extremaRows = actor === 'institution' ? institutions : foreigners;
      var extremaLabel = actor === 'institution' ? '���' : '�ܱ���';
      var nums = [0].concat(foreigners.map(function (r) { return Number(r.frgn); }))
        .concat(institutions.map(function (r) { return Number(r.orgn); }));
      var min = Math.min.apply(Math, nums), max = Math.max.apply(Math, nums);
      if (min === max) { min -= 1; max += 1; }
      function y(value) { return 78 - (value - min) / (max - min) * 66; }
      function x(slot) { return 4 + slot * 92 / 13; }
      var zero = y(0), marks = '', id = 'home-investor-' + marketKey;
      var foreignMax = extremaRows.length ? extremaRows.reduce(function(a,b){ return Number(b[extremaField]) > Number(a[extremaField]) ? b : a; }) : null;
      var foreignMin = extremaRows.length ? extremaRows.reduce(function(a,b){ return Number(b[extremaField]) < Number(a[extremaField]) ? b : a; }) : null;
      if (mode === 'area') {
        marks = '<defs><clipPath id="' + id + '-positive"><rect x="0" y="0" width="100" height="' + zero + '"/></clipPath>'
          + '<clipPath id="' + id + '-negative"><rect x="0" y="' + zero + '" width="100" height="' + (90 - zero) + '"/></clipPath></defs>';
      }
      [['frgn',foreigners,false],['orgn',institutions,true]].forEach(function (series) {
        var field = series[0], valid = series[1], institution = series[2];
        if (mode === 'bar') {
          valid.forEach(function (r) {
            var v = Number(r[field]), side = v > 0 ? 'buy' : v < 0 ? 'sell' : 'flat';
            var minute = 540 + r.slot * 30, label = Math.floor(minute / 60) + ':' + String(minute % 60).padStart(2, '0');
            marks += '<rect x="' + (x(r.slot) + (institution ? 0.3 : -2.4)).toFixed(2) + '" y="' + (v === 0 ? zero - .3 : Math.min(zero, y(v))) + '" width="2.3" height="' + Math.max(.6, Math.abs(y(v) - zero)) + '" rx=".3" class="hmb-investor-' + side + (institution ? ' hmb-investor-institution' : '') + '"><title>'
              + (institution ? '���' : '�ܱ���') + ' ' + label + ' �� ' + investorAmountText(v) + '</title></rect>';
          });
          return;
        }
        var groups = [];
        valid.forEach(function (r) {
          var last = groups[groups.length-1];
          if (!last || r.slot !== last[last.length-1].slot + 1) { last=[];groups.push(last); }
          last.push(r);
        });
        groups.forEach(function (group) {
          if (group.length < 2) return;
          var pts=group.map(function(r){return x(r.slot).toFixed(2)+','+y(Number(r[field])).toFixed(2);}).join(' ');
          if (!institution || actor === 'institution') {
            var area=x(group[0].slot)+','+zero+' '+pts+' '+x(group[group.length-1].slot)+','+zero;
            ['positive','negative'].forEach(function(side,index){
              marks+='<g clip-path="url(#'+id+'-'+side+')" class="hmb-investor-'+(index?'sell':'buy')+'">'
                +'<polygon points="'+area+'" class="hmb-investor-area"/>'
                +'<polyline points="'+pts+'" class="hmb-investor-line" vector-effect="non-scaling-stroke"/></g>';
            });
          } else {
            ['positive','negative'].forEach(function(side,index){
              marks+='<g clip-path="url(#'+id+'-'+side+')" class="hmb-investor-'+(index?'sell':'buy')+'">'
                +'<polyline points="'+pts+'" class="hmb-investor-line hmb-investor-institution" vector-effect="non-scaling-stroke"/></g>';
            });
          }
        });
      });
      var hover = [];
      rows.forEach(function(r){
        var minute=540+r.slot*30,label=Math.floor(minute/60)+':'+String(minute%60).padStart(2,'0');
        (actor === 'foreign' ? ['frgn'] : actor === 'institution' ? ['orgn'] : ['frgn','orgn']).forEach(function(field){
          if(r[field]==null||!isFinite(Number(r[field])))return;
          hover.push([x(r.slot),y(Number(r[field]))/90*100,
            label+' KST ���� �� '+(field==='frgn'?'�ܱ���':'���')+' ���� '+investorAmountText(r[field])+'\n���� '+investorTimeText(r.asOf)]);
        });
      });
      var extrema = foreignMax && foreignMin ?
        '<div class="hmb-investor-extrema"><span>'+extremaLabel+' ���� <b>'+investorAmountText(foreignMax[extremaField])+'</b></span>'
          +'<span>���� <b>'+investorAmountText(foreignMin[extremaField])+'</b></span></div>' : '';
      // ���� �ܱ��� ���������� ��ġ ��Ŀ�� ���� 70px ��Ʈ ���ο� �״�� �д�.
      function extremePoint(row, name) {
        return row ? '<span class="hmb-investor-point is-'+name+'" style="left:'+x(row.slot).toFixed(2)+'%;top:'+(y(Number(row[extremaField]))/90*100).toFixed(2)+'%" aria-hidden="true"></span>' : '';
      }
      var points = extremePoint(foreignMax,'high') + (foreignMin && foreignMax && Number(foreignMin[extremaField]) !== Number(foreignMax[extremaField]) ? extremePoint(foreignMin,'low') : '');
      return '<div class="hmb-investor-spark-wrap" data-hover-points="'+homeHoverAttr(hover)+'"><svg class="hmb-investor-spark" viewBox="0 0 100 90" preserveAspectRatio="none" role="img" aria-label="30�� ���� ���ż� �� '+(actor === 'foreign' ? '�ܱ���' : actor === 'institution' ? '���' : '�ܱ��� �Ǽ������ ����')+' �� Ȯ�� '+rows.length+'��">'
        +'<line x1="1" y1="'+zero+'" x2="99" y2="'+zero+'" class="hmb-investor-zero" vector-effect="non-scaling-stroke"/>'
        +marks+'</svg>'+points+'</div>'
        +'<div class="hmb-investor-axis"><span>09:00</span><span>12:00</span><span>15:30</span></div>'+extrema;
    }

    function showHomeInvestorMiniMode(isFallback) {
      var host = dashboardSection.querySelector('[data-home-investor-trend]');
      if (!host) return;
      var legend = host.querySelector('[data-home-investor-mini-legend]');
      var message = host.querySelector('[data-home-investor-mini-fallback]');
      if (legend) legend.hidden = !!isFallback;
      if (message) message.hidden = !isFallback;
    }

    function renderHomeInvestorMiniHistory(history, isCached) {
      var host = dashboardSection.querySelector('[data-home-investor-trend]');
      var body = host && host.querySelector('.hmb-investor-trend-body');
      var shared = window.InvestorFlow;
      if (!body || !shared || typeof shared.miniBars !== 'function') return;
      var now = new Date(), kst = new Date(now.getTime() + 9*60*60*1000);
      var today = kst.toISOString().slice(0,10), minute = kst.getUTCHours()*60 + kst.getUTCMinutes();
      var session = homeMarketSession();
      var active = session.market === 'domestic' && !session.closed && minute >= 540 && minute <= 930;
      var maxAbs = 1;
      history.forEach(function (response) {
        var d = response && (response.data || response) || {}, rs = shared.intradayRows(d.rows,d.date);
        var last = rs[rs.length-1];
        if (last) ['frgn','orgn','ind'].forEach(function (key) {
          if (last[key] != null && last[key] !== '' && isFinite(Number(last[key]))) maxAbs = Math.max(maxAbs,Math.abs(Number(last[key])));
        });
      });
      body.innerHTML = ['kospi', 'kosdaq'].map(function (market, index) {
        var response = history[index] || {}, result = response.data || response;
        var rows = shared.intradayRows(result.rows, result.date), label = market.toUpperCase();
        var last = rows.length ? rows[rows.length-1] : null;
        var caption = rows.length ? result.date + ' �� ���� ' + investorTimeText(last.asOf) + ' KST' : '���� ���� ������ ����';
        if (rows.length) {
          var delayed = active && (result.date !== today || now.getTime() - Date.parse(last.asOf) > 10*60*1000);
          caption += ' �� ' + (isCached || response._homeCached ? '��ȸ ���� �� ���尪' : delayed ? '���� ���� �� ���尪' : active && result.date === today ? '���� ����' : '������ ���� ������');
          caption += ' �� ' + rows.length + '/14����';
        }
        return '<div class="hmb-investor-row hmb-investor-mini-row"><div class="hmb-investor-row-top"><strong>' + label + '</strong></div>'
          + shared.miniBars(rows, {date:result.date, market:label, maxAbs:maxAbs})
          + '<div class="hmb-investor-asof">' + escapeHomeHtml(caption) + '</div>'
          + '<div class="hmb-investor-asof">���� ���� �� ������ ���� �� ���</div></div>';
      }).join('');
    }

    function renderHomeInvestorTrend(results) {
      homeInvestorResults = results;
      var host = dashboardSection.querySelector('[data-home-investor-trend]');
      if (!host) return;
      var body = host.querySelector('.hmb-investor-trend-body');
      if (!body) return;
      var markets = [
        { key: 'kospi', label: 'KOSPI' },
        { key: 'kosdaq', label: 'KOSDAQ' }
      ];
      var html = markets.map(function (market, index) {
        var result = results[index] && results[index].data ? results[index].data : (results[index] || {});
        var rows = Array.isArray(result.rows) ? result.rows : [];
        var lastRow = rows.length ? rows[rows.length - 1] : null;
        var foreign = lastRow && lastRow.frgn != null ? Number(lastRow.frgn) : result.latest;
        var institution = lastRow && lastRow.orgn != null ? Number(lastRow.orgn) : null;
        return '<div class="hmb-investor-row">'
          + '<div class="hmb-investor-row-top"><strong>' + market.label + '</strong>'
          + '<span class="hmb-investor-amounts">'
          + '<span class="' + (homeInvestorActor === 'institution' ? 'is-unselected' : '') + '" title="�ܱ��� ���� ���ż�"><small class="hmb-investor-actor-name is-foreign">�ܱ���</small><b class="' + homeTone(foreign) + '">' + investorAmountText(foreign) + '</b></span>'
          + '<span class="' + (homeInvestorActor === 'foreign' ? 'is-unselected' : '') + '" title="��� ���� ���ż�"><small class="hmb-investor-actor-name is-institution">���</small><b class="' + homeTone(institution) + '">' + investorAmountText(institution) + '</b></span></span></div>'
          + investorSparkline(result, homeInvestorMode, market.key, homeInvestorActor)
          + '<div class="hmb-investor-asof">' + String(result.date || '').replace(/[^0-9-]/g, '') + ' �� '
          + (rows.length ? '���� ' + investorTimeText(result.asOf) + ' �� ' + rows.length + '/14��' : '�Ϻ� �ֱٰ� �� ���� ��� ����') + '</div>'
          + '</div>';
      }).join('');
      body.innerHTML = html || '<span class="hmb-investor-loading">������ Ȯ�� ��</span>';
    }

    var investorHost = dashboardSection.querySelector('[data-home-investor-trend]');
    if (investorHost) investorHost.addEventListener('click', function (event) {
      var actorButton = event.target.closest('[data-investor-actor]');
      if (actorButton) {
        var nextActor = actorButton.getAttribute('data-investor-actor');
        if (['foreign', 'institution', 'compare'].indexOf(nextActor) < 0) return;
        homeInvestorActor = nextActor;
        investorHost.querySelectorAll('[data-investor-actor]').forEach(function (button) {
          button.setAttribute('aria-pressed', String(button.getAttribute('data-investor-actor') === nextActor));
        });
        if (homeInvestorResults) renderHomeInvestorTrend(homeInvestorResults);
        return;
      }
      var modeButton = event.target.closest('[data-investor-mode-select]');
      if (!modeButton) return;
      var selectedMode = modeButton.getAttribute('data-investor-mode-select');
      if (selectedMode !== 'area' && selectedMode !== 'bar') return;
      homeInvestorMode = selectedMode;
      investorHost.querySelectorAll('[data-investor-mode-select]').forEach(function (button) {
        button.setAttribute('aria-pressed', String(button.getAttribute('data-investor-mode-select') === selectedMode));
      });
      if (homeInvestorResults) renderHomeInvestorTrend(homeInvestorResults);
    });

    loadHomeInvestorTrend = function () {
      var host = dashboardSection.querySelector('[data-home-investor-trend]');
      if (!host || host.hidden || homeInvestorLoading || homeMarketSession().market !== 'domestic') return;
      if (Date.now() - homeInvestorMiniLastAttempt < homeInvestorMiniInterval) return;
      homeInvestorMiniLastAttempt = Date.now();
      homeInvestorLoading = true;
      var body = host.querySelector('.hmb-investor-trend-body');
      loadHomeScript(HOME_INVESTOR_FLOW_SCRIPT_URL, 'InvestorFlow').then(function () {
        if (typeof window.InvestorFlow.miniBars !== 'function') throw new Error('���� ���� ��� ���');
        if (!homeInvestorMiniHistory) {
          var cached = readHomeDataCache('home-investor-mini-intraday-v2', 7 * 24 * 60 * 60 * 1000);
          if (Array.isArray(cached) && cached.length === 2) homeInvestorMiniHistory = cached;
        }
        if (homeInvestorMiniHistory) renderHomeInvestorMiniHistory(homeInvestorMiniHistory, true);
        // Market failures are independent: retain only that market's last valid dated observations.
        return Promise.all(['kospi','kosdaq'].map(function (market,index) {
          return fetchHomeJson('https://goodbyestar.cloud/investor-trend?period=intraday&market=' + market, 12000)
            .then(function (response) {
              var d = response && response.data;
              if (!response || response.success !== true || !d || d.period !== 'intraday' || d.market !== market || !Array.isArray(d.rows)) throw new Error('���� ���� ����');
              var rows = window.InvestorFlow.intradayRows(d.rows,d.date);
              if (!rows.length) throw new Error('���� ������ ����');
              return response;
            }).catch(function () {
              var old = homeInvestorMiniHistory && homeInvestorMiniHistory[index];
              return old ? Object.assign({},old,{_homeCached:true}) : {data:{period:'intraday',market:market,rows:[]}};
            });
        }));
      }).then(function (results) {
        homeInvestorMiniHistory = results;
        writeHomeDataCache('home-investor-mini-intraday-v2', results);
        renderHomeInvestorMiniHistory(results, false);
      }).catch(function () {
        if (body) body.innerHTML = '<span class="hmb-investor-loading">���� ���� ǥ�� ��� Ȯ�� �ʿ�</span>';
      }).then(function () { homeInvestorLoading = false; });
    };

    loadSummaryForSession(homeMarketSession());
    window.addEventListener('home-market-change', function () {
      // �� ���¸� �ٲٸ� ���� ������ ���� ī�尡 ȭ�鿡 ���´�. ������
      // ��ȯ�ϴ� ���� ī���� �󺧡�������Ʈ�� �Բ� �ʱ�ȭ�ϰ� �ٽ� ��ȸ�Ѵ�.
      loadHomeIndices();
      loadHomeSessionCharts();
      loadHomeIndexBreadth();
      loadSummaryForSession(homeMarketSession());
    });
    setInterval(function () {
      if (document.hidden) return;
      var session = homeMarketSession();
      var wasClosed = dashboardSection.classList.contains('is-market-closed');
      // �ݿ��Ͽ� Ȩ�� ���� �� ä ����Ϸ� �Ѿ�� �ָ� ���� �������� ��ȯ�Ѵ�.
      // �ݴ�� �������� �Ǹ� �ڵ� ���� ������ �ٽ� �����Ѵ�.
      if (session.closed || wasClosed) {
        if (session.closed !== wasClosed) {
          syncMarketSwitch();
          loadHomeIndices();
          loadHomeIndexBreadth();
          loadSummaryForSession(session);
        }
        return;
      }
      var nextKey = (session.keys || []).join('|');
      if (nextKey !== summarySessionKey) loadSummaryForSession(session);
      else if (session.market !== 'us') loadHomeInvestorTrend();
    }, 60 * 1000);

    function calendarMeta(rawTitle) {
      var segments = String(rawTitle || '').split('|').map(function (item) { return item.trim(); });
      var head = segments[0] || '(���� ����)';
      var category = segments[1] || '';
      var stock = head.match(/^\$(\S+)\s*(.*)$/);
      var flag = !stock && head.match(/^(\p{Regional_Indicator}{2})\s*(.*)$/u);
      return {
        title: stock ? ((stock[1] ? stock[1] + ' ' : '') + stock[2]).trim() : flag ? flag[2].trim() : head,
        category: category || (stock ? '����' : flag ? flag[1] : '����')
      };
    }

    function eventDate(event) {
      var value = event.start.indexOf('T') === -1 ? event.start + 'T00:00:00+09:00' : event.start;
      return new Date(value);
    }

    function homeKstParts(value) {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false, hourCycle: 'h23'
      }).formatToParts(value || new Date()).reduce(function (result, part) {
        result[part.type] = part.value;
        return result;
      }, {});
    }

    function homeKstDayStart(value) {
      var parts = homeKstParts(value);
      return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) - 9 * 60 * 60 * 1000);
    }

    function scheduleTime(event, includeDate) {
      var allDay = event.start.indexOf('T') === -1;
      var date = eventDate(event);
      var parts = homeKstParts(date);
      var dateLabel = Number(parts.month) + '.' + Number(parts.day) + '.';
      var usDate = String(event.us_date || '').slice(0, 10);
      var timeLabel = usDate
        ? '�̱� ' + Number(usDate.slice(5, 7)) + '/' + Number(usDate.slice(8, 10))
          + (event.us_session ? ' �� ' + event.us_session : '')
        : allDay ? '����' : parts.hour + ':' + parts.minute;
      return includeDate ? dateLabel + ' ' + timeLabel : timeLabel;
    }

    function calendarMarketPriority(event) {
      var market = String(event && event.market || '').toLowerCase();
      if (market === 'domestic' || market === 'kr' || market === 'korea') return 0;
      if (market === 'us' || market === 'usa' || market === 'foreign') return 1;
      var source = String(event && (event.source || event.provider || '') || '');
      var title = String(event && event.title || '').trim();
      if (/dart|����|�ѱ�|kospi|kosdaq/i.test(source + ' ' + title)) return 0;
      if (/finnhub|�̱�|nasdaq|nyse|s&p/i.test(source + ' ' + title)) return 1;
      if (/^\$/.test(title) || /^\p{Regional_Indicator}{2}/u.test(title)) return 1;
      return 0;
    }

    function compareCalendarEvents(a, b) {
      var dayOrder = String(a && a.start || '').slice(0, 10).localeCompare(String(b && b.start || '').slice(0, 10));
      if (dayOrder) return dayOrder;
      var marketOrder = calendarMarketPriority(a) - calendarMarketPriority(b);
      if (marketOrder) return marketOrder;
      return eventDate(a) - eventDate(b);
    }

    function nearestEvents(events) {
      var todayStart = homeKstDayStart(new Date());
      var tomorrow = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
      var upcoming = (events || []).filter(function (event) { return eventDate(event) >= todayStart; })
        .sort(compareCalendarEvents);
      var todayItems = upcoming.filter(function (event) { return eventDate(event) < tomorrow; });
      if (todayItems.length) return { items: todayItems.slice(0, 4), includeDate: false, label: '���� ����' };
      if (!upcoming.length) return { items: [], includeDate: true, label: '���� �Ǵ� ���� ����� ����' };
      var nearest = eventDate(upcoming[0]).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
      return {
        items: upcoming.filter(function (event) {
          return eventDate(event).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }) === nearest;
        }).slice(0, 4),
        includeDate: true,
        label: '���� ����� ����'
      };
    }

    function renderSchedule(result) {
      var list = document.getElementById('homeScheduleList');
      var label = document.getElementById('homeScheduleLabel');
      if (!list) return;
      if (label) label.textContent = result.label;
      if (!result.items.length) {
        list.innerHTML = '<p class="home-card-state">���� ������ �ֿ� ������ �����ϴ�.</p>';
        return;
      }
      list.innerHTML = result.items.map(function (event) {
        var meta = calendarMeta(event.title);
        return '<a class="home-schedule-row" href="' + escapeHomeHtml(event.link || '/page/stock-calendar') + '" target="_blank" rel="noopener">'
          + '<time>' + scheduleTime(event, result.includeDate) + '</time>'
          + '<span class="home-schedule-content">'
          + '<span class="home-schedule-category">' + escapeHomeHtml(meta.category) + '</span>'
          + '<span class="home-schedule-title">' + escapeHomeHtml(meta.title) + '</span></span></a>';
      }).join('');
    }

    // ������ ��� �ǻ������ �ʿ��� �ü����� �켱������ ����. Ȩ�� API��WebSocket
    // ������ �ڸ� ���� �� �ҷ��� ù ȭ�鿡�� 15��¥�� Ķ���� ��û�� �������� �ʰ� �Ѵ�.
    window.setTimeout(function () {
      loadHomeScript(CALENDAR_SCRIPT_URL, 'StockCalendar')
        .then(function (calendar) {
          if (!calendar || !calendar.fetchEvents) throw new Error('Ķ���� ��� ����');
          var today = homeKstParts(new Date());
          return calendar.fetchEvents(Number(today.year), Number(today.month) - 1)
            .then(function (events) {
              var current = nearestEvents(events);
              if (current.items.length) return current;
              return calendar.fetchEvents(Number(today.year), Number(today.month)).then(nearestEvents);
            });
        })
        .then(renderSchedule)
        .catch(function () {
          var list = document.getElementById('homeScheduleList');
          if (list) list.innerHTML = '<p class="home-card-state">������ �ҷ����� ���߽��ϴ�.</p>';
        });
    }, 2000);

    /* �ֽ� �긮�� 8��: ���� ��, ū ��� ī�带 �¿�� �ѱ�� ĳ����. */
    var allCards = Array.prototype.slice.call(feed.querySelectorAll(':scope > .post-card:not(.notice-card)'));
    var marketCards = allCards.filter(function (card) { return card.getAttribute('data-cat') === '���� �긮��'; });
    var selectedCards = (marketCards.length ? marketCards : allCards).slice(0, 8);
    allCards.forEach(function (card) {
      if (selectedCards.indexOf(card) === -1) card.remove();
    });
    feed.querySelectorAll(':scope > .notice-card').forEach(function (card) { card.remove(); });

    var briefing = null;
    if (selectedCards.length) {
      briefing = window.NineHomeBriefing.build(selectedCards); // ���Ǵ� ���� ���� - ��ȸ�� Ȩ�� ����
      feed.appendChild(briefing);
      window.NineHomeBriefing.initCarousel(briefing);
    } else {
      briefing = document.createElement('section');
      briefing.className = 'home-briefing-section';
      briefing.innerHTML = '<div class="home-section-heading"><div><strong><svg class="briefing-title-icon" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M2 6h4" /> <path d="M2 10h4" /> <path d="M2 14h4" /> <path d="M2 18h4" /> <rect width="16" height="20" x="4" y="2" rx="2" /> <path d="M9.5 8h5" /> <path d="M9.5 12H16" /> <path d="M9.5 16H14" /> </svg> ���Ϻ긮��</strong>'
        + '<span>���� �Ǵܿ� �ʿ��� �ٽ� �ؼ�</span></div></div>'
        + '<div class="home-card-state">�ֽ� ���Ϻ긮���� Ȯ���ϴ� ���Դϴ�.</div>'
        + '<a class="home-briefing-more" href="/category/���� �긮��"><span>�긮�� ��ī�̺�</span><strong>���� �긮��</strong><i aria-hidden="true">��</i></a>';
      feed.appendChild(briefing);
    }

    var pagination = feed.querySelector(':scope > .pagination');
    if (pagination) pagination.remove();

    // 2026-10-18 ����� ��û("���忡�� ���Ϻ긮���� ���µ� �߰�"): ���� �긮�� ������ ���� ����� .home-widget-grid ������ �ű�µ�,
    // ���� ȭ���� �� �׸��带 ��°�� ���ܼ� �긮�ε� ���� �������. ����(dashboardSection.is-market-closed)�̸� �ְ� ����Ʈ �ٷ� �Ʒ���
    // ���� ���̰�, ���� ������ ���� �ڸ�(ǥ���� �� �ּ� ��� ��)�� �ǵ�����. �� ��ȯ���� Ŭ������ �ٲ� ������ �ٽ� �����.
    function syncBriefingPlacement() {
      var section = feed.querySelector('.home-briefing-section') || document.querySelector('.home-briefing-section');
      if (!section) return;
      var closed = dashboardSection.classList.contains('is-market-closed');
      var report = document.getElementById('homeWeeklyReport');
      var weekly = window.HomeWeeklyReport;
      if (report && weekly && weekly.syncContent) { weekly.syncContent(report, closed); return; }
      if (closed) {
        if (!report || !report.parentNode) return;
        if (!section.__homeSlot) {
          section.__homeSlot = document.createComment('home-briefing-slot');
          section.parentNode.insertBefore(section.__homeSlot, section);
        }
        if (report.nextSibling !== section) report.parentNode.insertBefore(section, report.nextSibling);
        section.hidden = false;
      } else if (section.__homeSlot && section.__homeSlot.parentNode) {
        section.__homeSlot.parentNode.insertBefore(section, section.__homeSlot);
        section.__homeSlot.remove();
        section.__homeSlot = null;
      }
    }
    if (window.MutationObserver) new MutationObserver(syncBriefingPlacement).observe(dashboardSection, { attributes: true, attributeFilter: ['class'] });

    // �� ����� ������ �ڵ忡 �������� �ʴ´�. ���� ���� �ε��� ���ķ�
    // �ٲ� ù ȭ�鿡�� ��Ʈ��ũ �պ� �� �� �̻��� ���δ�.
    Promise.all([
      loadHomeScript(HOME_WEEKLY_REPORT_SCRIPT_URL, 'HomeWeeklyReport').catch(function () { return null; }),
      loadHomeScript(HOME_WIDGETS_SCRIPT_URL, 'HomeDashboardWidgets').catch(function () { return null; }),
      loadHomeScript(HOME_REALTIME_TABLE_SCRIPT_URL, 'HomeRealtimeTable').catch(function () { return null; }),
      loadHomeScript(HOME_ECONOMIC_NEWS_SCRIPT_URL, 'HomeEconomicNews').catch(function () { return null; }),
      loadHomeScript(HOME_CHART_HOVER_SCRIPT_URL, 'HomeChartHover').catch(function () { return null; })
    ]).then(function (modules) {
        var weekly = modules[0];
        var widgets = modules[1];
        var table = modules[2];
        var news = modules[3];
        weeklyReportModule = weekly;
        if (weekly && weekly.init) weekly.init();
        if (widgets && widgets.init) widgets.init({
          dashboard: dashboardSection,
          briefing: briefing,
          gasUrl: GAS_TICKER_URL,
          fetchJson: fetchHomeJson
        });
        if (table && table.init) table.init({ mount: dashboardSection.querySelector('#homeRealtimeBoard') });
        if (news && news.init) news.init({ mount: dashboardSection.querySelector('#homeEconomicNews') });
        syncBriefingPlacement();
        setTimeout(syncBriefingPlacement, 1500);
      })
      .catch(function () {
        /* ���� ���� ����� ������ ���� ������ ��ú���� �״�� ����� �� �ְ� �д�. */
      });
    // Publish the complete synchronous layout; do not wait for API or optional widgets.
    document.documentElement.classList.remove('home-render-pending');
  })();

  /* ���� ī�װ��� �۸��: �Ź� ������ ���� ����(2026-08-26) ����
     �Ϲ� ī�װ����� ��ǥ 1�� + ������ �ִ� 4�� �ڿ� ���� ī�塤2���� �ݺ��Ѵ�. �ٸ�
     ���Ϻ긮���� ���� ũ���� ���� ī�� �������� ǥ���Ѵ�.
     ���� ������ �ֽż� �״�� �Һ��ϸ� ���������� �ʴ´�. */
  (function buildCategoryFeedBlocks() {
    if (location.pathname.indexOf('/category/') !== 0) return;
    var feed = document.querySelector('.feed');
    if (!feed) return;
    if (!feed.querySelector('.category-masthead')) {
      var masthead = document.createElement('header');
      masthead.className = 'category-masthead';
      masthead.innerHTML = '<div><p>MARKET BRIEFING</p><h1>���� �긮��</h1><span>���� ����� ������ �帧�� ���ƺ���, ���� �ŷ��� �����غ��ϴ�.</span></div>'
        + '<small>�ֽż� �� ��ü ��</small>';
      feed.insertBefore(masthead, feed.firstChild);
    }
    var cards = Array.prototype.slice.call(feed.querySelectorAll(':scope > .post-card:not(.notice-card)'));
    var isMarketBriefing = decodeURIComponent(location.pathname) === '/category/���� �긮��';
    if (!cards.length || (cards.length < 2 && !isMarketBriefing)) return;

    var BLOCK_SEQUENCE = [
      { key: 'hero', min: 2, max: 5 },   // �ֽ� ��ǥ 1 + ������ �ִ� 4
      { key: 'cards', min: 3, max: 3 },  // ���� ī���� 3�� �׸���
      { key: 'duo', min: 2, max: 2 }     // ���η� ������ 2��
    ];
    var tailAnchor = cards[cards.length - 1].nextSibling; /* ������ ī�� �� ���(���������̼� ��) �տ� ���� */

    function renderBlock(type, slice, beforeNode) {
      if (type === 'single') {
        slice[0].classList.add('feed-featured'); // �̹� ���ڸ��� �����Ƿ� �̵� ���� Ŭ������
        return;
      }
      if (type === 'hero' || type === 'briefingHero') {
        var hero = document.createElement('div');
        hero.className = 'feed-block feed-block-hero' + (type === 'briefingHero' ? ' feed-block-briefing-hero' : '');
        feed.insertBefore(hero, beforeNode);
        var featuredSlot = document.createElement('div');
        featuredSlot.className = 'feed-hero-featured-slot';
        hero.appendChild(featuredSlot);
        slice[0].classList.add('feed-featured');
        featuredSlot.appendChild(slice[0]);
        if (slice.length > 1) {
          var headlineList = document.createElement('div');
          headlineList.className = 'feed-block-headline';
          hero.appendChild(headlineList);
          slice.slice(1).forEach(function (card) {
            card.classList.add('feed-headline-item');
            headlineList.appendChild(card);
          });
        }
        return;
      }
      var wrap = document.createElement('div');
      var cardType = type === 'briefingCards' ? 'cards' : type;
      wrap.className = 'feed-block feed-block-' + cardType + (type === 'briefingCards' ? ' feed-block-briefing-cards' : '');
      feed.insertBefore(wrap, beforeNode);
      slice.forEach(function (card) {
        card.classList.add('feed-' + cardType + '-item');
        if (type === 'briefingCards') card.classList.add('feed-briefing-cards-item');
        wrap.appendChild(card);
      });
    }

    // ���Ϻ긮���� �Ϲ� ī�װ����� hero/cards/duo ������ �и��Ѵ�.
    if (isMarketBriefing) {
      // Equal-size editorial cards on an Apple-style horizontal shelf. Keep the
      // original articles, links, dates and order; reuse the shared carousel.
      var shelf = document.createElement('section');
      shelf.className = 'briefing-shelf';
      shelf.innerHTML = '<div class="briefing-shelf-track" tabindex="0" role="region" aria-label="���Ϻ긮�� ī��"></div>'
        + '<button type="button" class="briefing-shelf-arrow briefing-shelf-prev" data-briefing-shelf-prev aria-label="���� ���Ϻ긮��">?</button>'
        + '<button type="button" class="briefing-shelf-arrow briefing-shelf-next" data-briefing-shelf-next aria-label="���� ���Ϻ긮��">?</button>'
        + '<p class="briefing-shelf-empty" hidden>�˻� ����� �����ϴ�.</p>';
      feed.insertBefore(shelf, cards[0]);
      var shelfTrack = shelf.querySelector('.briefing-shelf-track');
      cards.forEach(function (card) {
        card.classList.add('feed-briefing-cards-item');
        shelfTrack.appendChild(card);
      });
      (window.SiteInteractionsReady || Promise.resolve(window.SiteInteractions)).then(function (module) {
        if (module) module.carousel(shelf, {
          track: '.briefing-shelf-track', previous: '[data-briefing-shelf-prev]',
          next: '[data-briefing-shelf-next]', card: '.feed-briefing-cards-item'
        });
      }).catch(function () {});
      var search = document.createElement('label');
      search.className = 'briefing-search';
      search.innerHTML = '<input type="search" aria-label="���Ϻ긮�� ���񡤳��� �˻�" placeholder="���Ϻ긮�� ���񡤳��� �˻�" autocomplete="off"><small data-briefing-search-result>��ü ' + cards.length + '��</small>';
      feed.insertBefore(search, shelf);
      var input = search.querySelector('input');
      var result = search.querySelector('[data-briefing-search-result]');
      input.addEventListener('input', function () {
        var query = input.value.trim().toLowerCase();
        var shown = 0;
        cards.forEach(function (card) {
          var match = !query || card.textContent.toLowerCase().indexOf(query) !== -1;
          card.hidden = !match;
          if (match) shown += 1;
        });
        shelf.querySelector('.briefing-shelf-empty').hidden = shown !== 0;
        result.textContent = query ? shown + '�� �˻���' : '��ü ' + cards.length + '��';
      });
      return;
    }

    var idx = 0;
    var sequenceIndex = 0;
    while (idx < cards.length) {
      var remaining = cards.length - idx;
      var block = BLOCK_SEQUENCE[sequenceIndex % BLOCK_SEQUENCE.length];
      // �������� 1���� ������ �ܵ� ī��� �������Ѵ�.
      if (remaining < block.min) block = { key: 'single', min: 1, max: 1 };
      var take = Math.min(block.max, remaining);
      var slice = cards.slice(idx, idx + take);
      var beforeNode = idx + take < cards.length ? cards[idx + take] : tailAnchor;
      renderBlock(block.key, slice, beforeNode);
      idx += take;
      sequenceIndex += 1;
    }
  })();
  /* ���� ����ũ�� ���̵�� ��� (���� ���� �� ����, 2026-07-21 ���̵�� �������� #3)
     ���� ���� ��ũ��Ʈ(head)�� �̹� html.sidebar-collapsed�� �ٿ����� �� �����Ƿ�
     ��ư ������(�ܹ��� ? X) ���¸� ���⼭ ����ȭ. ����� ��ξ�(#mobileMenuBtn)�ʹ�
     ������ ���� ��� - CSS�� min-width:721px �ȿ����� .sidebar-collapsed�� �ؼ��ϹǷ�
     ����Ͽ����� �� Ŭ������ �־ ���̾ƿ��� ���� ����. ���� */
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

  /* ���� ī�װ��� ���� �Ľ� ([##_category_list_##] ���) ���� */
  var catColors = ['#2563eb','#16a34a','#d97706','#7c3aed','#e11d48','#0891b2','#b45309','#0f766e'];
  /* 2026-07-12: ���� �긮���� ���� ������ �޴�(skin-menu.js)�� �°ݵż�
     ���̵�� "ī�װ���" ��Ͽ��� �ߺ� ���� �� �� */
  var sidebarCatExclude = ['���� �긮��'];
  /* ī�װ����� �� ������ ���� ����. ī�װ��� �̸��� �ٲٸ� �� Ű�� ���� ���ľ� ��(�� �׷��� �⺻ ���������� ��ü��) */
  var catIconPaths = {
    '���� �м�': '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    '�ϻ�ٹݻ�': '<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>',
    '�ϱ���': '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    'Insight Archive': '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>'
  };
  var catIconDefault = '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>';
  var subCatMap = {};
  var catDataEl = document.getElementById('categoryData');
  var catCustomList = document.getElementById('catCustomList');

  if (catDataEl) {
    var allLinks = Array.from(catDataEl.querySelectorAll('a'));

    /* depth-1 = /category/NAME (������ �� 1��) */
    var depth1Links = allLinks.filter(function(a) {
      return /\/category\/[^/]+$/.test(a.getAttribute('href') || '');
    });

    /* depth-2 = /category/NAME/SUBNAME */
    var depth2Links = allLinks.filter(function(a) {
      return /\/category\/[^/]+\/[^/]+$/.test(a.getAttribute('href') || '');
    });

    /* ���� ���� ���̵��: depth-1 �� ǥ�� ���� */
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
        var bareName = name.replace(/\s*\(�����\)\s*$/, '').trim();
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

    /* ���� ��� ���� ��: 2026-07-11 UI���� ����(�����λ� ���ʿ� �Ǵ�) ����
       skin.html�� #filterBar ��ü�� ��Ų ���� ���� �����ϰ�, ���⼭ DOM���� �����. */
    var filterBar = document.getElementById('filterBar');
    if (filterBar) { filterBar.remove(); filterBar = null; }
    var topBarExclude = ['�ϱ���', 'Insight Archive'];

    /* ���� subCatMap: depth-2�� �θ� �������� �׷��� ���� */
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

  /* ���� ī�װ��� ���� �� active ���� */
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
  /* ��� �ǿ� ���� ī�װ���(�ϱ���/Insight Archive �� topBarExclude ���)��
     ī�װ��� �������� ���� ���� ī�װ��� �ٴ� �ߵ��� URL���� ���� ���� */
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

  /* ���� ���� ī�װ��� ���� ���� ������ ����
     ��� �ǿ��� ���ܵ� ī�װ���(�ϱ���/Insight Archive)�� ���� �� ���
     ��� ���� �� ��ü�� ���� ī�װ��� ������ ��ü�Ѵ�(��ü��/���� �긮�� �ڸ��� ǥ��). */
  var subBar = document.getElementById('subFilterBar');
  if (subCatMap[activeCat]) {
    var subs = subCatMap[activeCat];
    var isExcludedCat = topBarExclude.indexOf(activeCat.replace(/\s*\(�����\)\s*$/, '').trim()) > -1;
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

  /* ���� ���� ī�װ��� active ǥ�� ���� */
  document.querySelectorAll('.cat-custom-list a').forEach(function(a) {
    var p = (a.dataset.parent || '').toLowerCase();
    if (p && path.indexOf(p.replace(/ /g, '+')) > -1) {
      a.classList.add('active');
    }
  });


  /* ���� ī�װ��� ���� ��/������(��: /page/market-temp �� ���� Page)��
     "ī�װ��� ����" ���� ���� ���� */
  document.querySelectorAll('.post-cat-badge').forEach(function(el) {
    if (el.textContent.trim() === 'ī�װ��� ����') el.style.display = 'none';
  });

  /* ���� ǥ ���� ��ũ�� ����: table�� overflow-x:auto�� �ָ� auto ���̺� ���̾ƿ���
     ĭ �ʺ� ������ �����־� ��׷����淡, div�� ���μ� �� div�� ��ũ�ѵǰ� �� ���� */
  document.querySelectorAll('.post-single-body table, .post-expand-body table').forEach(function(table) {
    if (table.parentElement && table.parentElement.classList.contains('table-scroll-wrap')) return;
    var wrap = document.createElement('div');
    wrap.className = 'table-scroll-wrap';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
  });

  /* ���� �ε��� ��� �ؽ�Ʈ �ٹٲ� ���� ���� */
  document.querySelectorAll('.post-excerpt').forEach(function(el) {
    /* innerHTML ��� ó��: Ƽ���丮�� ������ <br> ���� */
    var raw = el.innerHTML;
    /* �� <br> �� \n */
    raw = raw.replace(/<br\s*\/?>/gi, '\n');
    /* �� ������ �±� ���� */
    raw = raw.replace(/<[^>]+>/g, '');
    /* �� HTML ��ƼƼ ���ڵ� */
    var tmp = document.createElement('div');
    tmp.innerHTML = raw;
    raw = tmp.textContent.replace(/\r\n|\r/g, '\n').trim();
    /* �� �ߺ� �ؽ�Ʈ ���� */
    if (raw.length > 20) {
      var check = raw.slice(0, 30);
      var dupIdx = raw.indexOf(check, 5);
      if (dupIdx > 0 && dupIdx <= 60) { raw = raw.slice(dupIdx); }
    }
    /* �� "����.\n����" �� "����. ����" (��ȣ ȥ�� ���ִ� ���� ����) */
    raw = raw.replace(/(\d+)\.\n+/g, '$1. ');
    /* �� ���� ��� �� �ٹٲ� (���� ���� ����) */
    /* "?1. " "����).2. " ó�� ������/��ȣ �� ���ڰ� �ٷ� �ٴ� ��� ���� */
    raw = raw.replace(/([.!?)\]][\s]*(\d+)\.\s+)/g, function(m) {
      var parts = m.match(/^([.!?)\]])\s*(\d+)\.\s+$/);
      if (!parts) return m;
      return parts[1] + '\n' + parts[2] + '. ';
    });
    raw = raw.replace(/([^\n])\s+(\d+)\.\s+/g, function(m, before, num) {
      return before + '\n' + num + '. ';
    });
    /* �� ��á��Ҹ� �� �ٹٲ� */
    raw = raw.replace(/([^\n])\s*[-?��??]\s+/g, '$1\n- ');
    /* �� ��ħǥ/����ǥ/����ǥ �� �� �ѱ� ���� �ܶ� ���� */
    /* �� ���ڰ� ���ڸ� ����: "1. �ϴ�..." ���� ��ȣ��� ���� �ǵ帮�� ���� */
    raw = raw.replace(/([^\d\n][.!?])\s+([��-�RA-Z])/g, '$1\n$2');
    /* �� ���� �ٹٲ� ���� */
    raw = raw.replace(/\n{3,}/g, '\n\n');
    /* �� ���� ��� (3�� Ŭ������ style.css .post-excerpt ��Ģ�� ���) */
    el.innerHTML = raw.replace(/\n/g, '<br>');
  });

  /* ���� ����� ��ξ� & �˻� �������� ���� */
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

    /* ��ξ� ����/�ݱ� */
    function openDrawer() {
      if (!sidebar || !menuBtn || !overlay) return;
      menuBtn.classList.add('open');
      menuBtn.setAttribute('aria-label', '�޴� �ݱ�');
      sidebar.classList.add('drawer-open');
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
      if (drawerHdr) drawerHdr.style.display = 'flex';
    }
    function closeDrawer() {
      if (!sidebar || !menuBtn || !overlay) return;
      menuBtn.classList.remove('open');
      menuBtn.setAttribute('aria-label', '�޴� ����');
      sidebar.classList.remove('drawer-open');
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    }

    if (menuBtn) menuBtn.addEventListener('click', function() {
      sidebar && sidebar.classList.contains('drawer-open') ? closeDrawer() : openDrawer();
    });
    if (overlay) overlay.addEventListener('click', closeDrawer);

    /* ��ξ� ���� ��ũ Ŭ�� �� �ڵ� ���� */
    if (sidebar) sidebar.addEventListener('click', function(e) {
      if (e.target.tagName === 'A' && window.innerWidth <= 720) {
        setTimeout(closeDrawer, 120);
      }
    });

    /* �˻� �������� */
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

    /* ESC Ű ���� */
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        closeDrawer();
        searchOv && searchOv.classList.remove('open');
      }
    });

    /* ��ũ�� ž ��ư */
    if (scrollBtn) {
      window.addEventListener('scroll', function() {
        if (window.scrollY > 300) scrollBtn.classList.add('visible');
        else scrollBtn.classList.remove('visible');
      }, { passive: true });
      scrollBtn.addEventListener('click', function() {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    /* �������� �� ��ξ� ���� */
    window.addEventListener('resize', function() {
      if (window.innerWidth > 720) {
        closeDrawer();
        /* ����ũž ��ȯ �� sidebar top ���� */
        var sl2 = document.querySelector('.sidebar-left');
        if (sl2) sl2.style.top = '';
      }
    });
  })();

  /* 2026-09-15 �۾����ü�: ���������� "���� ����" ī�� ����� VI�����̵�ī ����.
     ���� �� ���� 20�ʸ��� ��ȸ�� �� ĳ��(/api/circuit-breaker)�� �д´� - �������� ���ǻ� API��
     ���� �θ��� �ʴ´�. ���̵�ī(���� ��ü)�� VI(��������)�� ���谡 �޶� ���� �� ���� ������,
     �ߵ��� ������ �� �� �����. ���̵�ī�� Ȯ�ε� ������ ��ó�� ����� ������ ������ available=false��
     ���� ������ ���� �ʴ´�. */
  (function homeCircuitBreakerBadges() {
    var CB_API = 'https://goodbyestar.cloud/api/circuit-breaker';
    var CB_POLL_MS = 20000;
    var lastData = null;
    var panel = null;                 // null | 'halt' | 'vi'
    var viView = { mode: 'active', market: 'ALL', kind: 'ALL' };

    function q(selector) {
      var board = document.getElementById('homeMarketBoard');
      return board ? board.querySelector(selector) : null;
    }
    function hhmm(iso) {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });
    }
    function hhmmss(iso) {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '-';
      return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });
    }
    function esc(s) { return window.NineUI.escapeHtml(s); }
    function isDomesticCard() {
      var selection = window.HomeMarketSelection;
      return !!selection && typeof selection.get === 'function' && selection.get() === 'domestic';
    }

    // ���� ��ü ���̵�ī(��Ȳ)����Ŷ�극��Ŀ(����). �ߵ� ���� ���� ��, �� �Ʒ� ���� �������ŷ��簳 �̷�. ���� id�� �� ���� �׸���.
    var MARKET_LABEL = { KOSPI: '�ڽ���', KOSDAQ: '�ڽ���' };
    var haltOpen = null;
    function haltTitle(e) {
      var side = e.direction === 'SELL' ? '�ŵ� ���̵�ī' : e.direction === 'BUY' ? '�ż� ���̵�ī' : '���̵�ī';
      return (MARKET_LABEL[e.market] || e.market) + ' ' + (e.kind === 'CIRCUIT_BREAKER' ? '��Ŷ�극��Ŀ' + (e.stage ? ' ' + e.stage + '�ܰ�' : '') : side);
    }
    function haltRow(e) {
      var cls = e.kind === 'CIRCUIT_BREAKER' ? 'is-cb' : 'is-sidecar';
      var state = e.status === 'active' ? '�ߵ� ��' : (e.status === 'resumed' ? '�ŷ� �簳 ' + hhmm(e.resumed_at || e.released_at)
        : '���� ' + hhmm(e.released_at || e.resumed_at) + (e.basis === 'DURATION_ELAPSED' ? ' (���ӽð� ���)' : ''));
      var pct = typeof e.change_pct === 'number' ? ' �� ' + (e.kind === 'CIRCUIT_BREAKER' ? '���� ' : '���� ') + (e.change_pct > 0 ? '+' : '') + e.change_pct.toFixed(2) + '%' : '';
      return '<li class="' + cls + (e.status === 'active' ? ' is-active' : ' is-ended') + '"><b>' + esc(haltTitle(e)) + '</b>'
        + '<span>�ߵ� ' + esc(hhmm(e.triggered_at)) + esc(pct) + '</span><em>' + esc(state) + '</em></li>';
    }
    // ��ó�� '�ǽð��� �ƴ�'�� �׻� ������. ��ũ�� �ѱ��ŷ��� KIND �ּҸ� ����Ѵ�.
    function haltSource(halt) {
      var url = /^https:\/\/kind\.krx\.co\.kr\//.test(String(halt.source_url || '')) ? halt.source_url : '';
      var label = esc(halt.source || '�ѱ��ŷ��� ����');
      return '<small class="home-halt-src">��ó ' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>' : label)
        + ' �� ' + esc(halt.delay_note || '���� ���� �� �ǽð� �����Ͱ� �ƴմϴ�')
        + (halt.received_at ? ' �� Ȯ�� ' + esc(hhmm(halt.received_at)) : '') + '</small>';
    }
    function renderHalt(el, halt) {
      if (!el) return;
      if (!halt) { el.hidden = true; return; }
      if (!halt.available) {
        // ���� ��ΰ� ���ų� ����: �������� ���̰� ���� �ʰ� 'Ȯ�� �Ұ�'�� ���� ������ ǥ���Ѵ�(����� ��ʰ� �ƴ�).
        el.className = 'home-halt is-unknown';
        el.innerHTML = '<span>���̵�ī����Ŷ�극��Ŀ �ڵ� Ȯ�� �Ұ�</span><small>'
          + esc(halt.reason === 'FETCH_FAILED' ? '���� ����(�ѱ��ŷ��� ���� ����) �� �����̶�� ���� �ƴ� �� �ѱ��ŷ��� ���� Ȯ��'
            : halt.reason === 'STALE' ? '���� ���� �� �� �����̶�� ���� �ƴ� �� �ѱ��ŷ��� ���� Ȯ��' : '���� ��� �̿��� �� ���� ���θ� �� �� ���� �� �ѱ��ŷ��� ���� Ȯ��') + '</small>';
        el.hidden = false;
        return;
      }
      var seen = {};
      var events = (halt.events || []).filter(function (e) { if (!e || seen[e.id]) return false; seen[e.id] = true; return true; });
      if (!events.length) { el.hidden = true; return; }                       // �̺�Ʈ�� ������ ��ʸ� ���� �ʴ´�
      var byNewest = function (a, b) { return String(b.triggered_at).localeCompare(String(a.triggered_at)); };
      var active = events.filter(function (e) { return e.status === 'active'; }).sort(byNewest);
      var ended = events.filter(function (e) { return e.status !== 'active'; }).sort(byNewest);
      var anyCb = active.some(function (e) { return e.kind === 'CIRCUIT_BREAKER'; });
      el.className = 'home-halt ' + (active.length ? (anyCb ? 'is-cb-active' : 'is-sidecar-active') : 'is-history');
      // ���� �� ��(������ ��ħ). �ߵ� ���̸� �⺻ ��ħ, ���� �̷¸� ������ �⺻ ���� - ����ڰ� ���� �ڿ��� �� ������ �����Ѵ�.
      var open = haltOpen === null ? active.length > 0 : haltOpen;
      var summary = active.length
        ? (anyCb ? '��Ŷ�극��Ŀ' : '���̵�ī') + ' �ߵ� �� ' + active.length + '�� �� ������ ��'
        : '���� ���� ��ġ ' + events.length + '�� �� ��� ����';
      el.innerHTML = '<button type="button" class="home-halt-sum" aria-expanded="' + (open ? 'true' : 'false') + '">' + esc(summary) + '<i aria-hidden="true">' + (open ? '?' : '?') + '</i></button>'
        + '<div class="home-halt-body"' + (open ? '' : ' hidden') + '>'
        + (active.length ? '<strong>' + (anyCb ? '��Ŷ�극��Ŀ' : '���̵�ī') + ' �ߵ� ��</strong>' : '<strong>���� ���� ��ġ �̷�</strong>')
        + '<ul>' + active.map(haltRow).join('') + '</ul>'
        + (ended.length ? (active.length ? '<h4>���� �������ŷ��簳 �̷�</h4>' : '') + '<ul class="is-history-list">' + ended.map(haltRow).join('') + '</ul>' : '')
        + haltSource(halt) + '</div>';
      el.hidden = false;
    }

    // ---- ���� ������ �����(CB �� ���̵�ī �� VI) ----
    var KIND_TEXT = { STATIC: '����', DYNAMIC: '����', BOTH: '����������' };
    function fmtNum(v) { return typeof v === 'number' && isFinite(v) && v !== 0 ? v.toLocaleString('ko-KR') : '-'; }
    function fmtPct(v) { return typeof v === 'number' && isFinite(v) && v !== 0 ? (v > 0 ? '+' : '') + v.toFixed(2) + '%' : '-'; }

    // ���� �ߵ� ���� CB�����̵�ī�� ��� ī��� �ø���(�����Ǹ� ��ܿ��� ������ �̷��� ������ ���� �󼼿��� ���´�).
    function activeHalts(halt) {
      if (!halt || !halt.available) return [];
      return (halt.events || []).filter(function (e) { return e.status === 'active' && (e.kind === 'CIRCUIT_BREAKER' || e.kind === 'SIDECAR'); })
        .sort(function (x, y) { return (x.kind === y.kind ? 0 : x.kind === 'CIRCUIT_BREAKER' ? -1 : 1) || String(y.triggered_at).localeCompare(String(x.triggered_at)); });
    }
    function haltCardHtml(e, open) {
      var isCb = e.kind === 'CIRCUIT_BREAKER';
      var detail = [MARKET_LABEL[e.market] || e.market, isCb ? (e.stage ? e.stage + '�ܰ�' : '') : (e.direction === 'SELL' ? '�ŵ�' : e.direction === 'BUY' ? '�ż�' : '')]
        .filter(function (t) { return t; }).join(' �� ');
      return '<button type="button" class="vol-alert ' + (isCb ? 'is-cb' : 'is-side') + '" data-vol-open="halt" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="volPanel">'
        + '<strong>' + (isCb ? '��Ŷ�극��Ŀ' : '���̵�ī') + '</strong>'
        + '<b class="vol-state">' + esc((detail ? detail + ' ' : '') + '�ߵ�') + '</b>'
        + '<span>' + esc(hhmm(e.triggered_at)) + ' �ߵ�</span></button>';
    }
    // VI ī��� ���: �ߵ� ���� 1�� �̻��� ���� ���� �ְ�, ��ü ��Ȳ�� �� �޴� ���̸� null(ī�带 �׸��� �ʴ´�).
    function viLine(data) {
      if (data.vi_available === false || data.vi_active_count == null) return null;
      var act = (data.vi_today || []).filter(function (r) { return r.status === 'active'; });
      if (!act.length) return null;
      var last = act[0];
      return { count: act.length, time: hhmm(last.triggered_at), market: MARKET_LABEL[last.market] || '', name: last.name };
    }
    function viCardHtml(v, open) {
      return '<button type="button" class="vol-alert is-vi" data-vol-open="vi" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="volPanel">'
        + '<strong>��������ȭ��ġ VI ' + v.count + '�� �ߵ���</strong></button>';
    }
    function haltHistoryCount(halt) {
      return halt && halt.available ? (halt.events || []).length : 0;
    }

    function viRows(data) {
      var rows = (data.vi_today || []).filter(function (r) {
        if (viView.mode === 'active' && r.status !== 'active') return false;
        if (viView.market !== 'ALL' && r.market !== viView.market) return false;
        if (viView.kind !== 'ALL' && r.kind !== viView.kind) return false;
        return true;
      });
      return rows;   // ������ �̹� �ߵ� �� �켱, �ֱ� �ߵ� ������ ������ ������
    }
    function seg(group, items) {
      return '<span class="vol-seg" role="group">' + items.map(function (it) {
        var on = viView[group] === it[0];
        return '<button type="button" class="vol-seg-btn' + (on ? ' is-on' : '') + '" data-vol-set="' + group + ':' + it[0] + '" aria-pressed="' + on + '">' + esc(it[1]) + '</button>';
      }).join('') + '</span>';
    }
    function viPanelHtml(data) {
      if (data.vi_available === false) {
        return '<p class="vol-note">VI ��ü ��Ȳ�� ���� ���ϰ� �ֽ��ϴ�. �����̶�� ���� �ƴϸ� ���� �ߵ� ���� ���� ���� �� �� �����ϴ�.</p>';
      }
      var rows = viRows(data);
      var html = '<div class="vol-ctl">' + seg('mode', [['active', '�ߵ� ��'], ['today', '���� �̷�']])
        + seg('market', [['ALL', '��ü'], ['KOSPI', '�ڽ���'], ['KOSDAQ', '�ڽ���']])
        + seg('kind', [['ALL', '��ü'], ['STATIC', '����'], ['DYNAMIC', '����']]) + '</div>';
      if (!rows.length) return html + '<p class="vol-note">' + (viView.mode === 'active' ? '���� �ߵ� ���� VI�� �����ϴ�.' : '���ǿ� �´� ���� VI �̷��� �����ϴ�.') + '</p>';
      html += '<ul class="vol-list">' + rows.map(function (r) {
        var state = r.status === 'active' ? '�ߵ� ��' : r.status === 'released' ? '����' : 'Ȯ�� �Ұ�';
        var refPrice = r.kind === 'DYNAMIC' ? r.dyn_price : r.static_price;
        var refDprt = r.kind === 'DYNAMIC' ? r.dyn_dprt : r.static_dprt;
        return '<li class="' + (r.status === 'active' ? 'is-active' : '') + '">'
          + '<a class="vol-name" href="/page/stock-search?code=' + encodeURIComponent(r.code) + '&amp;name=' + encodeURIComponent(r.name) + '">' + esc(r.name) + ' <small>' + esc(r.code) + '</small></a>'
          + '<span class="vol-kind">' + esc(KIND_TEXT[r.kind] ? KIND_TEXT[r.kind] + ' VI' : 'VI ���� Ȯ�� �Ұ�') + '</span>'
          + '<b class="vol-state">' + state + '</b>'
          + '<span class="vol-time">�ߵ� ' + esc(hhmmss(r.triggered_at)) + ' �� ���� ' + esc(r.released_at ? hhmmss(r.released_at) : '-') + '</span>'
          + '<span class="vol-price">�ߵ��� ' + fmtNum(r.price) + ' �� ���ذ� ' + fmtNum(refPrice) + ' (' + fmtPct(refDprt) + ')</span>'
          + '<span class="vol-count">���� ' + (r.count == null ? '-' : r.count) + 'ȸ</span></li>';
      }).join('') + '</ul>';
      var basis = data.vi_basis || {};
      return html + '<small class="vol-src">��������ȭ��ġ ��Ȳ(20�� ����)' + (basis.ws_events ? ' �� �ǽð� H0STVIC0 ���� ' + basis.ws_events + '��' : '') + ' �� ���� ���� ���� ���źк��� ���Դϴ�</small>';
    }

    // ���(�̺�Ʈ�� ���� ��)���� ī�� ������ �׸��� �ʴ´�. �ߵ� ���� �͸� ī���: ��Ŷ�극��Ŀ(����) �� ���̵�ī(��Ȳ) �� VI(ȸ��).
    // ������ �̺�Ʈ�� ī�忡�� ������ ���� �̷��� ��(ī�带 ���� ���ų� ����� '���� ������ �̷�' ��ũ)������ ����.
    function renderAlerts(box, data) {
      if (!box) return;
      if (!isDomesticCard()) { hideAll(); return; }
      var link = q('[data-vol-history]');
      if (!data) { box.hidden = true; if (link) link.hidden = true; return; }
      lastData = data;
      var halts = activeHalts(data.market_halt), vi = viLine(data);
      var haltHistory = haltHistoryCount(data.market_halt);
      var viHistory = data.vi_available === false ? 0 : (data.vi_today || []).length;
      var cards = halts.map(function (e) { return haltCardHtml(e, panel === 'halt'); }).join('') + (vi ? viCardHtml(vi, panel === 'vi') : '');
      if (link) {
        link.hidden = !!cards || !(haltHistory || viHistory);
        link.setAttribute('aria-expanded', panel === 'all' ? 'true' : 'false');
      }
      var html = cards;                  // ������ �� �Ǹ� ī�尡 ���� �� ���� ������ ���� �ʴ´�(�� �� ���� ��� �ִ� �� ����)
      if (!html && !panel) { box.hidden = true; box.innerHTML = ''; return; }
      box.innerHTML = html + '<div class="vol-panel" id="volPanel" role="region" aria-label="���� ������ ��"' + (panel ? '' : ' hidden') + '></div>';
      box.hidden = false;
      var p = box.querySelector('.vol-panel');
      function haltHolder() {
        haltOpen = true;
        var holder = document.createElement('div');
        holder.className = 'home-halt';
        renderHalt(holder, data.market_halt);
        if (holder.hidden) holder.innerHTML = '<small class="vol-note">���� ���̵�ī����Ŷ�극��Ŀ �ߵ� �̷��� �����ϴ�.</small>';
        holder.hidden = false;
        return holder;
      }
      if (panel === 'vi') p.innerHTML = viPanelHtml(data);
      else if (panel === 'halt') p.appendChild(haltHolder());
      else if (panel === 'all') {
        if (haltHistory) p.appendChild(haltHolder());
        var viBox = document.createElement('div');
        viBox.innerHTML = viPanelHtml(data);
        p.appendChild(viBox);
      }
    }
    function openPanel(next, focusBack) {
      panel = panel === next ? null : next;
      if (panel === 'all') viView.mode = 'today';          // �̷� ��ũ�� ���� ���� �̷º��� ���� �ش�
      renderAlerts(q('[data-vol-monitor]'), lastData);
      if (!panel && focusBack) { var b = q('[data-vol-open="' + focusBack + '"]'); if (b) b.focus(); }
    }

    function hideAll() {
      var box = q('[data-vol-monitor]');
      if (box) { box.hidden = true; box.innerHTML = ''; }
      var hl = q('[data-vol-history]');
      if (hl) hl.hidden = true;
      panel = null;
      lastData = null;
    }

    function tick() {
      if (document.hidden || !document.getElementById('homeMarketBoard')) return;
      if (!q('[data-vol-monitor]')) return;
      if (!isDomesticCard()) { hideAll(); return; }
      fetch(CB_API)
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (body) {
          var data = body && body.data ? body.data : body;
          if (!isDomesticCard()) { hideAll(); return; }
          if (!data) return;
          renderAlerts(q('[data-vol-monitor]'), data);
        })
        .catch(function () { /* ���� ǥ�ö� �����ϸ� ���� ���¸� �״�� �д� */ });
    }

    document.addEventListener('click', function (event) {
      if (!isDomesticCard()) { hideAll(); return; }
      var t = event.target;
      var open = t.closest && t.closest('[data-vol-open]');
      if (open) { openPanel(open.getAttribute('data-vol-open'), open.getAttribute('data-vol-open')); return; }
      var set = t.closest && t.closest('[data-vol-set]');
      if (set) {
        var kv = set.getAttribute('data-vol-set').split(':');
        viView[kv[0]] = kv[1];
        renderAlerts(q('[data-vol-monitor]'), lastData);
        return;
      }
      var box = q('[data-vol-monitor]');
      if (panel && box && !box.contains(t)) { panel = null; renderAlerts(box, lastData); }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && panel) { var was = panel; openPanel(was, was); }
    });
    window.addEventListener('home-market-change', function () {
      if (!isDomesticCard()) hideAll();
      else tick();
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
    setTimeout(tick, 2000);   // Ȩ ī�尡 �׷��� �� ù ��ȸ
    setInterval(tick, CB_POLL_MS);
  })();

/* 2026-10-05: ���� �����̼��� Ȩ���� ���� > ���ÿµ� ������(js/market-temp.js)�� �Ű��. */

  }
  function go() { window.NineAccess.run(start); }
  if (window.NineAccess) { go(); return; }
  var tag = document.getElementById('nine-access-gate-js');
  if (!tag) { start(); return; }
  tag.addEventListener('load', go, { once: true });
  tag.addEventListener('error', start, { once: true });
})();

