/* 마켓 브리핑 전체 기록 검색 (정적 색인만 조회; 원문/페이지네이션 보존) */
(function (global) {
  'use strict';
  var BASE = 'https://goodbyestarwars.github.io/tistory-ticker/';
  var ALIAS = {
    '현대상선':'HMM', '대우조선해양':'한화오션', '삼전':'삼성전자',
    '하닉':'SK하이닉스', '엔비디아':'NVIDIA', 'NVDA':'NVIDIA',
    '모더나':'Moderna', 'MRNA':'Moderna', '솔리다임':'Solidigm'
  };
  function norm(s) {
    return String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function compact(s) { return norm(s).replace(/\s/g, ''); }
  function safe(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (x) {
      return {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[x];
    });
  }
  function date(s) { return String(s || '').slice(0, 10); }
  function load(src) {
    return new Promise(function (resolve, reject) {
      if (global.NINE_BRIEFING_INDEX && /briefing-index\.js/.test(src)) { resolve(); return; }
      var node = document.createElement('script');
      node.src = src;
      node.async = true;
      node.onload = resolve;
      node.onerror = function () { node.remove(); reject(new Error('검색 색인 다운로드 실패')); };
      document.head.appendChild(node);
    });
  }
  function queryTokens(q) {
    return norm(q).split(/\s+/).filter(Boolean).slice(0, 8).map(function (part) {
      var real = ALIAS[part] || ALIAS[part.toUpperCase()] || part;
      return { raw: norm(part), canonical: norm(real) };
    });
  }
  function score(post, tokens) {
    if (!tokens.length) return 1;
    var title = norm(post.title);
    var excerpt = norm(post.summary);
    var topics = norm((post.topics || []).concat(post.industries || []).join(' '));
    var words = post.terms || [];
    var stocks = post.stocks || [];
    var total = 0;
    for (var i = 0; i < tokens.length; i++) {
      var q = tokens[i].raw, canonical = tokens[i].canonical;
      var pts = 0;
      if (title.indexOf(q) !== -1 || title.indexOf(canonical) !== -1) pts = 12;
      if (topics.indexOf(q) !== -1 || topics.indexOf(canonical) !== -1) pts = Math.max(pts, 7);
      if (excerpt.indexOf(q) !== -1 || excerpt.indexOf(canonical) !== -1) pts = Math.max(pts, 5);
      stocks.forEach(function (s) {
        if (norm(s.name) === canonical || norm(s.name) === q ||
            norm(s.code) === q || (s.aliases || []).some(function (v) { return norm(v) === q; })) {
          pts = Math.max(pts, s.role === 'primary' ? 14 : 8);
        }
      });
      if (!pts && q.length >= 2 && words.some(function (w) {
        return norm(w).indexOf(q) !== -1 || norm(w).indexOf(canonical) !== -1;
      })) pts = 2;
      // 제목의 띄어쓰기 차이만 보완; 무관한 본문 단어를 무작정 합치지 않는다.
      if (!pts && compact(title).indexOf(compact(q)) !== -1) pts = 9;
      if (!pts) return 0; // 모든 검색어가 각각 문서에 근거를 가져야 한다.
      total += pts;
    }
    return total;
  }
  function mount(opts) {
    var shelf = opts.shelf;
    var cards = opts.cards;
    var feed = opts.feed;
    if (!feed || !shelf || feed.querySelector('#briefing-search-app')) return;
    var panel = document.createElement('section');
    panel.id = 'briefing-search-app';
    panel.className = 'ba-app';
    panel.innerHTML = '<div class="ba-top">' +
      '<div><p class="ba-eyebrow">MARKET BRIEFING LIBRARY</p><h2>전체 브리핑 검색</h2>' +
      '<p>종목명·종목코드·산업·사건·본문을 한 번에 찾습니다.</p></div>' +
      '<div class="ba-index-state" role="status" aria-live="polite">전체 기록을 불러오는 중…</div></div>' +
      '<form class="ba-query" role="search" autocomplete="off">' +
      '<input type="search" class="ba-input" aria-label="전체 브리핑 검색" placeholder="예: 한화오션, 042660, 방산 해운, 2차전지" />' +
      '<button type="submit" class="ba-submit">검색</button></form>' +
      '<div class="ba-controls"><label>월별 <input type="month" class="ba-month" aria-label="게시일 또는 기준일의 연월" /></label>' +
      '<label>주제 <select class="ba-topic" aria-label="브리핑 주제"><option value="">전체 주제</option></select></label>' +
      '<label>정렬 <select class="ba-sort" aria-label="정렬 기준"><option value="recent">최신순</option><option value="relevance">관련도순</option><option value="oldest">오래된순</option></select></label>' +
      '<button type="button" class="ba-reset">초기화</button></div>' +
      '<div class="ba-result-header"><strong class="ba-count"></strong><small>한 글에 여러 종목·산업이 연결될 수 있습니다.</small></div>' +
      '<div class="ba-results" aria-live="polite"></div>' +
      '<button type="button" class="ba-more" hidden>더 보기</button>' +
      '<p class="ba-footnote">게시일과 본문에 명시된 기준일은 구분합니다. 사건일을 추정해 확정 날짜로 표시하지 않습니다. 종목은 실제 본문 언급 기준이며 산업 분류는 탐색용입니다.</p>';
    feed.insertBefore(panel, shelf);
    var state = panel.querySelector('.ba-index-state');
    var form = panel.querySelector('.ba-query');
    var input = panel.querySelector('.ba-input');
    var month = panel.querySelector('.ba-month');
    var topic = panel.querySelector('.ba-topic');
    var sort = panel.querySelector('.ba-sort');
    var count = panel.querySelector('.ba-count');
    var results = panel.querySelector('.ba-results');
    var more = panel.querySelector('.ba-more');
    var pagination = feed.querySelector(':scope > .pagination');
    var index = null, shown = 0, matches = [];
    function resultCard(p) {
      var chips = (p.stocks || []).filter(function (s) { return s.role === 'primary'; }).slice(0, 3);
      var industries = (p.industries || []).slice(0, 3);
      var verified = /^https:\/\/ghlee\.tistory\.com\/\d+$/.test(p.url);
      var u = verified ? p.url : '';
      var html = '<article class="ba-item"><div class="ba-meta"><time datetime="' + safe(date(p.publishedAt)) + '">' + safe(date(p.publishedAt) || '게시일 미확인') + '</time>';
      if (p.referenceDate) html += '<span>본문 기준일 ' + safe(p.referenceDate) + '</span>';
      html += '</div><a class="ba-title" href="' + safe(u || '#') + '">' + safe(p.title) + '</a>' +
        '<p class="ba-excerpt">' + safe(p.summary || '원문에서 내용을 확인하세요.') + '</p><div class="ba-tags">';
      industries.forEach(function (x) { html += '<span class="ba-tag">' + safe(x) + '</span>'; });
      chips.forEach(function (s) { html += '<button type="button" class="ba-stock" data-stock="' + safe(s.code || s.name) + '">' + safe(s.name) + (s.code ? ' · ' + safe(s.code) : '') + '</button>'; });
      return html + '</div></article>';
    }
    function update() {
      if (!index) return;
      var tokens = queryTokens(input.value);
      var m = month.value, t = topic.value;
      matches = index.posts.map(function (p) {
        var s = score(p, tokens);
        return { post:p, rank:s };
      }).filter(function (x) {
        var p = x.post;
        return x.rank > 0 && (!m || date(p.publishedAt).slice(0,7) === m || date(p.referenceDate).slice(0,7) === m) &&
          (!t || (p.topics || []).indexOf(t) !== -1);
      });
      matches.sort(function (a,b) {
        if (sort.value === 'relevance' && b.rank !== a.rank) return b.rank-a.rank;
        var x = date(a.post.publishedAt), y = date(b.post.publishedAt);
        return sort.value === 'oldest' ? x.localeCompare(y) : y.localeCompare(x);
      });
      shown = 0;
      results.innerHTML = '';
      append();
      count.textContent = '전체 ' + index.posts.length + '건 중 ' + matches.length + '건';
    }
    function append() {
      var part = matches.slice(shown, shown + 15);
      results.insertAdjacentHTML('beforeend', part.map(function (x) { return resultCard(x.post); }).join('') ||
        (shown === 0 ? '<p class="ba-empty">검색 결과가 없습니다. 다른 단어 또는 기간을 입력해 보세요.</p>' : ''));
      shown += part.length;
      more.hidden = shown >= matches.length;
    }
    function fallback(error) {
      panel.classList.add('ba-fallback');
      state.textContent = '전체 색인 미제공 · 현재 페이지에서만 검색';
      panel.querySelector('.ba-controls').hidden = true;
      panel.querySelector('.ba-result-header').hidden = true;
      panel.querySelector('.ba-footnote').hidden = true;
      results.hidden = true;
      more.hidden = true;
      shelf.hidden = false;
      if (pagination) pagination.hidden = false;
      function filter() {
        var q = norm(input.value), visible = 0;
        cards.forEach(function (card) {
          var matched = !q || norm(card.textContent).indexOf(q) >= 0;
          card.hidden = !matched;
          if (matched) visible++;
        });
        var empty = shelf.querySelector('.briefing-shelf-empty');
        if (empty) empty.hidden = !!visible;
        state.textContent = '현재 페이지 ' + visible + '건 (전체 색인 연결 필요)';
      }
      input.addEventListener('input', filter);
      form.addEventListener('submit', function (e) { e.preventDefault(); filter(); });
      if (error && global.console) console.warn('[BriefingArchive]', error.message || error);
    }
    load(BASE + 'data/briefing-index.js').then(function () {
      index = global.NINE_BRIEFING_INDEX;
      if (!index || index.schemaVersion !== 1 || !Array.isArray(index.posts) || !index.posts.length) {
        throw new Error('검색 색인 계약 오류');
      }
      shelf.hidden = true;
      if (pagination) pagination.hidden = true;
      var topics = {};
      index.posts.forEach(function (p) { (p.topics || []).forEach(function (t) { topics[t] = true; }); });
      Object.keys(topics).sort().forEach(function (t) {
        var opt = document.createElement('option'); opt.value = t; opt.textContent = t; topic.appendChild(opt);
      });
      state.textContent = '전체 ' + index.posts.length + '건 · 색인 ' + date(index.generatedAt);
      var args = new URLSearchParams(global.location.search);
      input.value = args.get('briefing') || '';
      if (input.value) sort.value = 'relevance';
      form.addEventListener('submit', function (e) { e.preventDefault(); update(); });
      input.addEventListener('input', update);
      month.addEventListener('change', update);
      topic.addEventListener('change', update);
      sort.addEventListener('change', update);
      panel.querySelector('.ba-reset').addEventListener('click', function () {
        input.value = ''; month.value = ''; topic.value = ''; sort.value = 'recent'; update(); input.focus();
      });
      results.addEventListener('click', function (e) {
        var btn = e.target.closest('.ba-stock');
        if (!btn) return;
        input.value = btn.getAttribute('data-stock');
        month.value = ''; topic.value = ''; sort.value = 'relevance'; update();
        input.focus();
      });
      more.addEventListener('click', append);
      update();
    }).catch(fallback);
  }
  global.NineBriefingArchive = { mount:mount, score:score };
})(window);
