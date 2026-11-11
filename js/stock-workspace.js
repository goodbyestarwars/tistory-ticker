/**
 * 종목 작업 화면 (2026-11-12).
 *
 * /page/stock-search(js/stock-search.js)의 기존 셸을 [호가 | 차트 | 종목정보] 3열 작업 화면으로 꾸민다.
 * 새 화면을 따로 만들지 않는 이유: 호가(js/order-book.js)·차트(js/chart-core.js 계열)·관련 뉴스·실시간 소켓이
 * 이미 이 페이지 한 곳에 묶여 있고(소켓 1개), 종목 URL 계약(?code=&name=)도 여기에 있다. 이 파일은 그 위에
 *   - 종목 머리말(기존 #ssSummary에 시장·자료 기준시각 보강)
 *   - 오른쪽 종목정보 탭(요약 / 수급 / 공시·뉴스 / 기업정보) - 기존 제공 자료만 사용
 *   - 검색 옆 관심·최근 서랍(헤더 검색과 같은 저장소 stock:recent·관심종목 목록 재사용)
 *   - 첫 종목 결정(URL → 마지막 선택 → 관심종목 첫 항목), 종목 변경 시 주소 기록(뒤로가기)
 *   - 좁은 화면 전환(종목정보 서랍, 모바일 차트/호가/종목정보 탭)
 * 만 더한다. 호가·차트·뉴스 노드는 옮기기만 하고 다시 만들지 않으므로 구독·타이머·요청이 늘지 않는다.
 * 주문 기능은 없다. 미국 종목·지수 화면과 독립 차트(?tool=independent-chart)는 기존 화면 그대로 둔다.
 */
(function (global) {
  'use strict';
  if (global.StockWorkspace) return;
  var doc = global.document;
  var root = doc.querySelector('#stock-search');
  if (!root || root.classList.contains('ss-independent-chart')) return;

  var BASE = (function () {
    var src = doc.currentScript && doc.currentScript.src;
    var m = src && src.match(/^(.*\/)js\/stock-workspace\.js/);
    return m ? m[1] : 'https://goodbyestarwars.github.io/tistory-ticker/';
  }());
  var CSS_URL = BASE + 'css/stock-workspace.css?v=20261112-workspace1';
  var PROFILES_URL = BASE + 'data/company-profiles.js';
  var API = 'https://goodbyestar.cloud';
  var FLOW_TTL_MS = 5 * 60 * 1000; // 서버 캐시와 같은 5분
  var TABS = [['summary', '요약'], ['flow', '수급'], ['news', '공시·뉴스'], ['company', '기업정보']];
  var PANELS = [['chart', '차트'], ['book', '호가'], ['info', '종목정보']];

  var state = { code: '', name: '', tab: 'summary', panel: 'chart', session: null, quote: null, flowToken: 0, profiles: null };
  var el = {};

  function esc(value) { return global.NineUI.escapeHtml(value); }
  function panelApi() { return global.StockSearchPanel || null; }
  function isDomestic(code) { return /^[0-9A-Z]{6}$/.test(String(code || '')); }
  function urlCode() { try { return (new URLSearchParams(global.location.search).get('code') || '').trim(); } catch (e) { return ''; } }
  function isUsUrl() { try { var p = new URLSearchParams(global.location.search); return p.get('market') === 'us' || /^US:/i.test(p.get('code') || ''); } catch (e) { return false; } }
  function num(value) { var n = Number(value); return value == null || value === '' || !isFinite(n) ? null : n; }
  function fmt(value) { var n = num(value); return n == null ? '—' : Math.round(n).toLocaleString('ko-KR'); }
  function signed(value) { var n = num(value); return n == null ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(Math.round(n)).toLocaleString('ko-KR'); }
  function tone(value) { var n = num(value); return n == null || n === 0 ? '' : n > 0 ? ' up' : ' down'; }

  /* ───── 뼈대: 기존 노드는 옮기기만 한다 ───── */
  function build() {
    var panels = root.querySelector('.ss-panels');
    var detail = root.querySelector('#ssDetail');
    var summary = root.querySelector('#ssSummary');
    var search = root.querySelector('.ss-search');
    var news = root.querySelector('.ss-news-panel');
    if (!panels || !detail || !summary || !search) return false;

    // 머리말: 기존 요약 줄(#ssSummary - 종목명·코드·현재가·등락, 체결마다 stock-search.js가 갱신)을 3열 위로 올린다.
    detail.parentNode.insertBefore(summary, detail);

    // 검색 옆 관심·최근 서랍
    var drawerBtn = doc.createElement('button');
    drawerBtn.type = 'button';
    drawerBtn.className = 'ssw-drawer-btn';
    drawerBtn.setAttribute('aria-expanded', 'false');
    drawerBtn.setAttribute('aria-controls', 'sswDrawer');
    drawerBtn.textContent = '관심·최근';
    var drawer = doc.createElement('div');
    drawer.id = 'sswDrawer';
    drawer.className = 'ssw-drawer';
    drawer.hidden = true;
    search.appendChild(drawerBtn);
    search.appendChild(drawer);
    el.drawerBtn = drawerBtn; el.drawer = drawer;

    // 모바일 패널 전환(차트/호가/종목정보)
    var mtabs = doc.createElement('div');
    mtabs.className = 'ssw-mtabs';
    mtabs.setAttribute('role', 'tablist');
    mtabs.setAttribute('aria-label', '종목 화면 전환');
    mtabs.setAttribute('data-no-swipe', '');
    mtabs.innerHTML = PANELS.map(function (p) {
      return '<button type="button" role="tab" data-ssw-panel-btn="' + p[0] + '" aria-selected="' + (p[0] === state.panel) + '">' + p[1] + '</button>';
    }).join('');
    detail.insertBefore(mtabs, panels);
    el.mtabs = mtabs;

    // 오른쪽 종목정보
    var info = doc.createElement('aside');
    info.className = 'ssw-info';
    info.id = 'sswInfo';
    info.setAttribute('aria-label', '종목정보');
    info.innerHTML = '<div class="ssw-info-head"><div class="ssw-tabs" role="tablist" aria-label="종목정보">' + TABS.map(function (t) {
      return '<button type="button" role="tab" id="sswTab-' + t[0] + '" data-ssw-tab="' + t[0] + '" aria-controls="sswPane-' + t[0] + '" aria-selected="' + (t[0] === state.tab) + '">' + t[1] + '</button>';
    }).join('') + '</div><button type="button" class="ssw-info-close" aria-label="종목정보 닫기">×</button></div>' + TABS.map(function (t) {
      return '<section class="ssw-pane" role="tabpanel" id="sswPane-' + t[0] + '" aria-labelledby="sswTab-' + t[0] + '"' + (t[0] === state.tab ? '' : ' hidden') + '></section>';
    }).join('');
    panels.appendChild(info);
    el.info = info;
    if (news) info.querySelector('#sswPane-news').appendChild(news); // 기존 관련 뉴스·공시 패널을 그대로 옮긴다

    var backdrop = doc.createElement('div');
    backdrop.className = 'ssw-backdrop';
    backdrop.hidden = true;
    root.appendChild(backdrop);
    el.backdrop = backdrop;

    root.classList.add('ss-workspace');
    root.setAttribute('data-ssw-panel', state.panel);
    doc.documentElement.classList.add('ssw-page');
    wire();
    return true;
  }

  /* ───── 머리말 보강: 시장 구분·자료 기준시각·종목정보 열기 ───── */
  // data/sectors-v3.js: { 섹터명: [{ name, code, market }] } (stock-search.js lookupSectors와 같은 자료)
  function sectorEntries(code) {
    var map = global.SECTOR_MAP, out = [];
    if (!map || !code) return out;
    Object.keys(map).forEach(function (sector) {
      var list = map[sector];
      if (!Array.isArray(list)) return;
      list.forEach(function (row) { if (row && row.code === code) out.push({ sector: sector, market: row.market }); });
    });
    return out;
  }
  function marketLabel(code) {
    var hit = sectorEntries(code).filter(function (row) { return row.market; })[0];
    return hit ? String(hit.market).toUpperCase() : '';
  }
  function clockLabel(raw) {
    var text = String(raw == null ? '' : raw).trim();
    var m = text.match(/^(\d{2}):?(\d{2}):?(\d{2})$/);
    return m ? m[1] + ':' + m[2] + ':' + m[3] : '';
  }
  function decorateHead() {
    var summary = root.querySelector('#ssSummary');
    var head = summary && summary.querySelector('.ss-summary-head');
    if (!head || !state.code) return;
    var meta = head.querySelector('.ssw-head-meta');
    if (!meta) {
      meta = doc.createElement('span');
      meta.className = 'ssw-head-meta';
      meta.innerHTML = '<span class="ssw-head-market" hidden></span><span class="ssw-head-time"></span>';
      var code = head.querySelector('.ss-summary-code');
      if (code && code.nextSibling) head.insertBefore(meta, code.nextSibling); else head.appendChild(meta);
      var toggle = doc.createElement('button');
      toggle.type = 'button';
      toggle.className = 'ssw-info-toggle';
      toggle.setAttribute('aria-controls', 'sswInfo');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.textContent = '종목정보';
      head.appendChild(toggle);
    }
    var market = marketLabel(state.code);
    var marketEl = meta.querySelector('.ssw-head-market');
    marketEl.textContent = market;
    marketEl.hidden = !market;
    // 자료 기준시각: 체결값이 준 시각만 쓴다. 없으면 받은 시각으로 꾸미지 않고 상태(지연·대기)를 그대로 적는다.
    var quote = state.quote && state.quote.code === state.code ? state.quote : null;
    var clock = quote ? clockLabel((quote.trade && quote.trade.time) || quote.time) : '';
    var date = state.session && state.session.date ? String(state.session.date) : '';
    var text = !quote ? (date ? date + ' 일봉 기준 · 체결 수신 대기' : '시세 수신 대기')
      : quote.delayed ? '지연 시세(REST 조회)' + (clock ? ' · ' + clock + ' KST' : '')
      : clock ? '체결 ' + clock + ' KST' : '실시간 수신 · 체결시각 미제공';
    meta.querySelector('.ssw-head-time').textContent = text;
  }

  /* ───── 요약 탭 ───── */
  function sectorsOf(code) { return sectorEntries(code).map(function (row) { return row.sector; }).slice(0, 4); }
  function renderSummary() {
    var pane = el.info.querySelector('#sswPane-summary');
    if (!state.code) { pane.innerHTML = '<p class="ssw-state">종목을 선택하면 요약이 표시됩니다.</p>'; return; }
    var s = state.session || {}, q = state.quote && state.quote.code === state.code ? state.quote : {};
    var volume = num(s.liveVolume != null ? s.liveVolume : s.volume);
    var rows = [['시가', fmt(s.open), ''], ['고가', fmt(s.high), ' up'], ['저가', fmt(s.low), ' down'],
      ['전일 대비', q.change == null ? '—' : signed(q.change) + '원', tone(q.change)],
      ['거래량', volume > 0 ? fmt(volume) + '주' : '—', '']]; // 0·미수신은 거래량 0으로 꾸미지 않는다
    var sectors = sectorsOf(state.code);
    pane.innerHTML = '<dl class="ssw-facts">' + rows.map(function (r) {
      return '<div><dt>' + r[0] + '</dt><dd class="' + r[2].trim() + '">' + esc(r[1]) + '</dd></div>';
    }).join('') + '</dl>'
      + '<p class="ssw-note">' + (s.date ? esc(s.date) + ' 일봉 기준. ' : '') + '수신하지 못한 값은 —로 표시합니다.</p>'
      + (sectors.length ? '<div class="ssw-tags" aria-label="업종·테마">' + sectors.map(function (name) { return '<span>' + esc(name) + '</span>'; }).join('') + '</div>' : '')
      + '<a class="ssw-link" href="/page/foreign-flow?code=' + encodeURIComponent(state.code) + '&amp;name=' + encodeURIComponent(state.name) + '">종목분석 열기 →</a>';
  }

  /* ───── 수급 탭: 기존 /foreign-flow/{code}(외국인·기관·개인 일별 순매수, 주 단위) ───── */
  function loadFlow() {
    var pane = el.info.querySelector('#sswPane-flow');
    var code = state.code;
    if (!isDomestic(code)) { pane.innerHTML = '<p class="ssw-state">종목을 선택하면 수급이 표시됩니다.</p>'; return; }
    if (pane.getAttribute('data-code') === code) return; // 같은 종목은 다시 요청하지 않는다
    var token = ++state.flowToken;
    pane.setAttribute('data-code', code);
    pane.innerHTML = '<p class="ssw-state" role="status">수급 자료를 불러오는 중입니다.</p>';
    global.NineHttp.json(API + '/foreign-flow/' + encodeURIComponent(code), { timeoutMs: 15000, ttlMs: FLOW_TTL_MS }).then(function (body) {
      if (token !== state.flowToken || state.code !== code) return; // 빠른 종목 전환: 이전 응답은 버린다
      var data = (body && body.data) || body || {};
      if (!data.daily || !data.daily.length) throw new Error('empty');
      var rolling = data.rolling || {};
      var cols = [['today', '당일'], ['5d', '5일'], ['20d', '20일']].filter(function (c) { return rolling[c[0]]; });
      var who = [['foreign', '외국인'], ['inst', '기관'], ['ind', '개인']];
      var streak = data.streak || {};
      pane.innerHTML = '<p class="ssw-note">기준일 ' + esc(data.as_of || data.daily[0].date || '') + ' · 순매수 수량(주) · 확정 일별 자료</p>'
        + '<table class="ssw-table"><thead><tr><th scope="col">주체</th>' + cols.map(function (c) { return '<th scope="col">' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>'
        + who.map(function (w) {
          return '<tr><th scope="row">' + w[1] + '</th>' + cols.map(function (c) {
            var v = rolling[c[0]][w[0]];
            return '<td class="' + tone(v).trim() + '">' + signed(v) + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table>'
        + '<ul class="ssw-streaks">' + who.map(function (w) {
          var st = streak[w[0]];
          var days = st && num(st.days != null ? st.days : st.count);
          var dir = st && (st.direction || st.dir || (num(st.sign) > 0 ? 'buy' : num(st.sign) < 0 ? 'sell' : ''));
          if (!days || !dir) return '';
          var buy = /buy|매수|up/i.test(String(dir));
          return '<li><b>' + w[1] + '</b> ' + days + '거래일 연속 <span class="' + (buy ? 'up' : 'down') + '">' + (buy ? '순매수' : '순매도') + '</span></li>';
        }).join('') + '</ul>'
        + '<table class="ssw-table ssw-table-daily"><caption>최근 5거래일</caption><thead><tr><th scope="col">일자</th>' + who.map(function (w) { return '<th scope="col">' + w[1] + '</th>'; }).join('') + '</tr></thead><tbody>'
        + data.daily.slice(0, 5).map(function (row) {
          return '<tr><th scope="row">' + esc(String(row.date || '').slice(5)) + '</th>' + who.map(function (w) {
            var v = row[w[0] + '_net'];
            return '<td class="' + tone(v).trim() + '">' + signed(v) + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table>';
    }).catch(function () {
      if (token !== state.flowToken || state.code !== code) return;
      pane.removeAttribute('data-code'); // 다시 열면 재시도
      pane.innerHTML = '<p class="ssw-state ssw-error" role="status">수급 자료를 받지 못했습니다. 탭을 다시 열면 재시도합니다.</p>';
    });
  }

  /* ───── 기업정보 탭: data/company-profiles.js(정적, 탭을 처음 열 때 한 번 받는다) ───── */
  function loadProfiles() {
    if (global.COMPANY_PROFILES) return Promise.resolve(global.COMPANY_PROFILES);
    if (state.profiles) return state.profiles;
    state.profiles = new Promise(function (resolve, reject) {
      var tag = doc.createElement('script');
      tag.src = PROFILES_URL;
      tag.onload = function () { if (global.COMPANY_PROFILES) resolve(global.COMPANY_PROFILES); else reject(new Error('profiles')); };
      tag.onerror = function () { state.profiles = null; reject(new Error('profiles')); };
      doc.head.appendChild(tag);
    });
    return state.profiles;
  }
  function loadCompany() {
    var pane = el.info.querySelector('#sswPane-company');
    var code = state.code;
    if (!isDomestic(code)) { pane.innerHTML = '<p class="ssw-state">종목을 선택하면 기업정보가 표시됩니다.</p>'; return; }
    if (pane.getAttribute('data-code') === code) return;
    pane.setAttribute('data-code', code);
    pane.innerHTML = '<p class="ssw-state" role="status">기업정보를 불러오는 중입니다.</p>';
    loadProfiles().then(function (all) {
      if (state.code !== code) return;
      var item = all.companies && all.companies[code];
      if (!item) { pane.innerHTML = '<p class="ssw-state">이 종목의 기업 개요 자료가 없습니다.</p>'; return; }
      pane.innerHTML = '<dl class="ssw-facts ssw-facts-wide"><div><dt>종목</dt><dd>' + esc(state.name) + ' (' + esc(code) + ')</dd></div>'
        + (item.industry ? '<div><dt>업종</dt><dd>' + esc(item.industry) + '</dd></div>' : '') + '</dl>'
        + '<p class="ssw-body">' + esc(item.summary || '') + '</p>'
        + '<p class="ssw-note">출처 ' + esc(all.source || '') + (all.asOf ? ' · ' + esc(all.asOf) + ' 기준' : '') + '</p>';
    }).catch(function () {
      if (state.code !== code) return;
      pane.removeAttribute('data-code');
      pane.innerHTML = '<p class="ssw-state ssw-error" role="status">기업정보를 받지 못했습니다. 탭을 다시 열면 재시도합니다.</p>';
    });
  }

  function showTab(key) {
    state.tab = key;
    el.info.querySelectorAll('[data-ssw-tab]').forEach(function (btn) { btn.setAttribute('aria-selected', String(btn.getAttribute('data-ssw-tab') === key)); });
    el.info.querySelectorAll('.ssw-pane').forEach(function (pane) { pane.hidden = pane.id !== 'sswPane-' + key; });
    if (key === 'summary') renderSummary();
    else if (key === 'flow') loadFlow();
    else if (key === 'company') loadCompany();
  }

  /* ───── 관심·최근 서랍 ───── */
  function drawerRows(title, items, empty) {
    return '<section><h4>' + title + '</h4>' + (items.length ? '<ul>' + items.map(function (it) {
      return '<li><button type="button" data-ssw-pick="' + esc(it.code) + '" data-name="' + esc(it.name || it.code) + '"><b>' + esc(it.name || it.code) + '</b><small>' + esc(it.code) + '</small></button></li>';
    }).join('') + '</ul>' : '<p class="ssw-state">' + empty + '</p>') + '</section>';
  }
  function renderDrawer() {
    var api = panelApi();
    var favorites = api && api.getFavorites ? api.getFavorites() : [];
    var favCodes = favorites.map(function (it) { return it.code; });
    var recent = (api && api.getRecent ? api.getRecent() : []).filter(function (it) { return favCodes.indexOf(it.code) < 0; });
    el.drawer.innerHTML = drawerRows('관심종목', favorites.slice(0, 30), '관심종목이 없습니다. 검색 결과의 ★로 추가할 수 있습니다.')
      + drawerRows('최근 본 종목', recent.slice(0, 10), '최근 본 종목이 없습니다.');
  }
  function setDrawer(open) {
    if (open) renderDrawer();
    el.drawer.hidden = !open;
    el.drawerBtn.setAttribute('aria-expanded', String(open));
  }
  function setInfoOpen(open) {
    root.classList.toggle('ssw-info-open', open);
    el.backdrop.hidden = !open;
    var toggle = root.querySelector('.ssw-info-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
  }
  function showPanel(key) {
    state.panel = key;
    root.setAttribute('data-ssw-panel', key);
    el.mtabs.querySelectorAll('[data-ssw-panel-btn]').forEach(function (btn) { btn.setAttribute('aria-selected', String(btn.getAttribute('data-ssw-panel-btn') === key)); });
    if (key === 'info') showTab(state.tab);
    // 숨겼던 차트가 다시 보일 때 크기를 다시 재도록 알린다(차트 엔진은 resize에 반응한다). 구독은 건드리지 않는다.
    if (key === 'chart') global.requestAnimationFrame(function () { global.dispatchEvent(new global.Event('resize')); });
  }

  function open(code, name) {
    if (!code || !global.StockSearch || !global.StockSearch.open) return;
    global.StockSearch.open(code, name || code);
  }

  function wire() {
    el.drawerBtn.addEventListener('click', function () { setDrawer(el.drawer.hidden); });
    el.drawer.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-ssw-pick]') : null;
      if (!btn) return;
      setDrawer(false);
      open(btn.getAttribute('data-ssw-pick'), btn.getAttribute('data-name'));
    });
    doc.addEventListener('click', function (e) {
      if (!el.drawer.hidden && !e.target.closest('.ssw-drawer, .ssw-drawer-btn')) setDrawer(false);
      if (e.target.closest && e.target.closest('.ssw-info-toggle')) setInfoOpen(!root.classList.contains('ssw-info-open'));
    });
    doc.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!el.drawer.hidden) { setDrawer(false); el.drawerBtn.focus(); }
      else if (root.classList.contains('ssw-info-open')) setInfoOpen(false);
    });
    el.backdrop.addEventListener('click', function () { setInfoOpen(false); });
    el.info.querySelector('.ssw-info-close').addEventListener('click', function () { setInfoOpen(false); });
    el.info.querySelector('.ssw-tabs').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-ssw-tab]') : null;
      if (btn) showTab(btn.getAttribute('data-ssw-tab'));
    });
    el.mtabs.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-ssw-panel-btn]') : null;
      if (btn) showPanel(btn.getAttribute('data-ssw-panel-btn'));
    });

    // 종목 선택(검색·결과 행·서랍·뒤로가기 모두 stock-search.js의 selectStock을 거친다)
    doc.addEventListener('nine-stock-selection', function (e) {
      var d = e.detail || {};
      if (!isDomestic(d.code)) return;
      var changed = d.code !== state.code;
      state.code = d.code; state.name = d.name || d.code;
      if (changed) { state.session = null; state.quote = null; }
      var api = panelApi();
      if (api && api.remember) api.remember(state.code, state.name);
      syncUrl();
      ['flow', 'company'].forEach(function (key) { if (changed) el.info.querySelector('#sswPane-' + key).removeAttribute('data-code'); });
      showTab(state.tab);
      // #ssSummary는 이 이벤트 직후 stock-search.js가 다시 그린다 → 그 뒤에 머리말을 보강한다.
      global.setTimeout(decorateHead, 0);
    });
    doc.addEventListener('nine-stock-quote', function (e) {
      var q = e.detail || {};
      if (q.code !== state.code) return;
      state.quote = q;
      decorateHead();
      if (state.tab === 'summary') renderSummary();
    });
    doc.addEventListener('nine-stock-session', function (e) {
      var d = e.detail || {};
      if (d.code !== state.code) return;
      state.session = d.summary || null;
      decorateHead();
      if (state.tab === 'summary') renderSummary();
    });
    global.addEventListener('popstate', function () {
      var code = urlCode();
      if (code && code !== state.code && !isUsUrl()) open(code, (new URLSearchParams(global.location.search).get('name') || '').trim());
    });
  }

  /* 종목을 바꾸면 주소에 남긴다(새로고침·뒤로가기·직접 URL). 기존 ?code=&name= 계약 그대로. */
  function syncUrl() {
    try {
      var url = new URL(global.location.href);
      var current = (url.searchParams.get('code') || '').trim();
      if (current === state.code) return;
      url.searchParams.delete('market');
      url.searchParams.set('code', state.code);
      url.searchParams.set('name', state.name);
      var next = url.pathname + url.search + url.hash;
      if (current) global.history.pushState(null, '', next); else global.history.replaceState(null, '', next);
    } catch (e) { /* 주소 기록 없이 계속 사용 */ }
  }

  /* 첫 종목: URL 지정 → 마지막 선택 → 관심종목 첫 항목. 모두 없으면 검색 안내만 둔다. */
  function resolveInitial() {
    if (urlCode() || isUsUrl()) return;
    var api = panelApi();
    var last = api && api.getLast ? api.getLast() : '';
    var recent = api && api.getRecent ? api.getRecent() : [];
    if (isDomestic(last)) {
      var hit = recent.filter(function (it) { return it.code === last; })[0];
      open(last, hit ? hit.name : last);
      return;
    }
    function fromWatchlist() {
      if (state.code || urlCode()) return true;
      var list = api && api.getFavorites ? api.getFavorites() : [];
      var first = list.filter(function (it) { return isDomestic(it.code); })[0];
      if (first) { open(first.code, first.name); return true; }
      return false;
    }
    if (fromWatchlist()) return;
    // 관심종목은 로그인 확인 뒤에 채워진다 - 바뀌면 한 번만 다시 본다.
    if (global.Watchlist && global.Watchlist.onChange) global.Watchlist.onChange(function () { fromWatchlist(); });
    var results = root.querySelector('#ssResults');
    if (results && !results.innerHTML.trim()) results.innerHTML = '<div class="ss-hint">종목명이나 코드를 검색하거나 ‘관심·최근’에서 종목을 고르세요.</div>';
  }

  function start() {
    if (!build()) return;
    var current = global.StockSearch && global.StockSearch.currentSelection ? global.StockSearch.currentSelection() : null;
    if (current && isDomestic(current.code)) { // 이 모듈보다 먼저 선택된 종목
      state.code = current.code; state.name = current.name || current.code;
      decorateHead();
    }
    showTab(state.tab);
    resolveInitial();
  }

  global.StockWorkspace = { showTab: showTab, showPanel: showPanel, state: function () { return { code: state.code, tab: state.tab, panel: state.panel }; } };
  // 배치 CSS가 온 뒤에 꾸민다(스타일 없는 3열이 잠깐 보이지 않게). 실패하면 기존 화면 그대로 둔다.
  global.NineUI.loadStyle(CSS_URL).then(start, function () { /* 기존 2열 화면 유지 */ });
})(window);
