/* 9Pay 섹터·종목 시장맵 — 시장/종목 통합 보기, 원천시세 관리자 전용. */
(function (global) {
  'use strict';
  var PER_SECTOR = 24;
  var FIRST_VISIBLE = 6;
  function number(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function escape(v) { return global.NineUI.escapeHtml(String(v == null ? '' : v)); }
  function fmt(v) { return v == null ? '—' : Number(v).toLocaleString('ko-KR', {maximumFractionDigits: 0}); }
  function pct(v) { return v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(2) + '%'; }
  function tone(v) { return v == null ? 'na' : v > 0 ? 'up' : v < 0 ? 'down' : 'flat'; }
  function cap(v) { return v == null ? '미확인' : v >= 1e12 ? (v / 1e12).toFixed(1) + '조' : (v / 1e8).toFixed(0) + '억'; }

  /* WICS는 업종 분류의 단일 기준; 사용자 정의 테마는 선별 우선순위와 시장 힌트에만 사용한다.
     24개/업종의 명시적 표본이며 시총 순위·시장 전체 커버리지라고 주장하지 않는다. */
  function chooseCandidates(wics, curated) {
    var featured = Object.create(null), groups = Object.create(null);
    Object.keys(curated || {}).forEach(function (sector) {
      (curated[sector] || []).forEach(function (r) {
        if (r && /^[0-9]{6}$/.test(String(r.code || '')) && !featured[r.code]) {
          featured[r.code] = {market: r.market, favorite: true};
        }
      });
    });
    Object.keys(wics || {}).forEach(function (code) {
      var rec = wics[code];
      if (!/^[0-9]{6}$/.test(code) || !rec || !rec.sector || !rec.name) return;
      var g = groups[rec.sector] || (groups[rec.sector] = []);
      g.push({code: code, name: rec.name, sector: rec.sector, industry: rec.industry || '',
        hint: featured[code] && featured[code].market || '', featured: !!featured[code]});
    });
    var picked = [];
    Object.keys(groups).forEach(function (sector) {
      var rows = groups[sector], out = [], used = Object.create(null);
      function take(list, limit) {
        var found = 0;
        list.forEach(function (r) {
          if (found >= limit || out.length >= PER_SECTOR || used[r.code]) return;
          out.push(r); used[r.code] = true; found++;
        });
      }
      take(rows.filter(function (r) { return r.featured && r.hint === 'KOSPI'; }), 9);
      take(rows.filter(function (r) { return r.featured && r.hint === 'KOSDAQ'; }), 9);
      take(rows.filter(function (r) { return r.featured; }), PER_SECTOR);
      take(rows, PER_SECTOR);
      picked = picked.concat(out);
    });
    return picked;
  }

  function createState(container, wics, curated) {
    return {root: container, candidates: chooseCandidates(wics, curated), quotes: [],
      loading: false, ready: false, error: '', market: 'ALL', search: '', size: 'cap',
      sort: 'cap', focus: '', expanded: Object.create(null), checkedAt: ''};
  }
  function toStock(r, quote) {
    if (!quote || number(quote.price) == null || number(quote.price) <= 0) return null;
    return {code: r.code, name: r.name, sector: r.sector, industry: r.industry,
      market: quote.market === 'KOSPI' || quote.market === 'KOSDAQ' ? quote.market : '미분류',
      price: number(quote.price), rate: number(quote.changeRate),
      cap: number(quote.marketCap), volume: number(quote.volume),
      time: quote.time || '', dataDate: quote.dataDate || '', state: quote.market_state || '',
      degraded: !!quote.degraded};
  }
  function grouped(state) {
    var q = Object.create(null);
    state.quotes.forEach(function (r) { q[r.code] = r; });
    var buckets = Object.create(null), term = state.search.trim().toLocaleLowerCase('ko-KR');
    state.candidates.forEach(function (r) {
      var s = toStock(r, q[r.code]);
      if (!s || (state.market !== 'ALL' && s.market !== state.market) ||
          (term && (s.name + ' ' + s.code + ' ' + s.sector + ' ' + s.industry).toLocaleLowerCase('ko-KR').indexOf(term) < 0) ||
          (state.focus && state.focus !== s.sector)) return;
      (buckets[s.sector] || (buckets[s.sector] = [])).push(s);
    });
    var entries = Object.keys(buckets).map(function (sector) {
      var rows = buckets[sector], valid = rows.filter(function (r) { return r.rate != null; });
      var avg = valid.length ? valid.reduce(function (sum, r) { return sum + r.rate; }, 0) / valid.length : null;
      rows.sort(function (a, b) {
        if (state.sort === 'rate') return (b.rate == null ? -Infinity : b.rate) - (a.rate == null ? -Infinity : a.rate);
        if (state.sort === 'name') return a.name.localeCompare(b.name, 'ko');
        return (b.cap || 0) - (a.cap || 0);
      });
      return {sector: sector, rows: rows, avg: avg};
    });
    entries.sort(function (a,b) {
      if (state.sort === 'rate') return (b.avg == null ? -Infinity : b.avg) - (a.avg == null ? -Infinity : a.avg);
      return a.sector.localeCompare(b.sector, 'ko');
    });
    return entries;
  }
  function stockHtml(s, maxCap, size) {
    var large = size === 'cap' && s.cap != null && maxCap > 0 && s.cap / maxCap >= 0.4;
    var label = s.name + ' 현재가 ' + fmt(s.price) + '원 등락 ' + pct(s.rate);
    return '<a class="mtm-stock mtm-' + tone(s.rate) + (large ? ' mtm-large' : '') + '"'
      + ' href="/page/stock-search?code=' + encodeURIComponent(s.code) + '" title="' + escape(label) + '">'
      + '<strong>' + escape(s.name) + '</strong><span class="mtm-price">' + fmt(s.price) + '<small>원</small></span>'
      + '<span class="mtm-delta">' + pct(s.rate) + '</span>'
      + (s.cap != null ? '<span class="mtm-cap">시총 ' + cap(s.cap) + '</span>' : '')
      + '</a>';
  }
  function sectorHtml(g, state) {
    var expanded = state.expanded[g.sector] || !!state.focus || !!state.search;
    var visible = expanded ? g.rows : g.rows.slice(0, FIRST_VISIBLE);
    var maxCap = Math.max.apply(null, g.rows.map(function (r) { return r.cap || 0; }).concat([0]));
    var up = g.rows.filter(function (r) { return r.rate > 0; }).length;
    var down = g.rows.filter(function (r) { return r.rate < 0; }).length;
    return '<section class="mtm-sector" aria-label="' + escape(g.sector) + '">'
      + '<header class="mtm-sector-head"><button type="button" data-mtm-sector="' + escape(g.sector) + '" title="이 업종만 보기">'
      + '<span>' + escape(g.sector) + '</span></button>'
      + '<strong class="mtm-' + tone(g.avg) + '">' + pct(g.avg) + '</strong></header>'
      + '<p class="mtm-sector-meta">' + g.rows.length + '종목 표본 · 상승 ' + up + ' · 하락 ' + down + ' · 단순 평균</p>'
      + '<div class="mtm-stocks">' + visible.map(function (r) { return stockHtml(r,maxCap,state.size); }).join('') + '</div>'
      + (!expanded && g.rows.length > FIRST_VISIBLE ? '<button class="mtm-more" type="button" data-mtm-more="' + escape(g.sector) + '">+' + (g.rows.length - FIRST_VISIBLE) + '종목 펼치기</button>' : '')
      + '</section>';
  }
  function draw(state) {
    var root = state.root;
    var groups = grouped(state), shown = groups.reduce(function (n,g) {return n+g.rows.length;},0);
    var up = groups.reduce(function (n,g) {return n+g.rows.filter(function (r) {return r.rate>0;}).length;},0);
    var down = groups.reduce(function (n,g) {return n+g.rows.filter(function (r) {return r.rate<0;}).length;},0);
    root.querySelector('[data-mtm-count]').textContent = shown.toLocaleString('ko-KR') + '개 종목';
    root.querySelector('[data-mtm-up]').textContent = up.toLocaleString('ko-KR') + ' 상승';
    root.querySelector('[data-mtm-down]').textContent = down.toLocaleString('ko-KR') + ' 하락';
    root.querySelector('[data-mtm-scope]').textContent = 'WICS ' + groups.length + '업종 · 조회 표본 ' + state.candidates.length + '종목 중 수신 ' + state.quotes.length + '종목';
    root.querySelector('[data-mtm-status]').textContent = state.loading ? '시세 확인 중…'
      : state.error || (state.checkedAt ? '서버 조회 ' + state.checkedAt + ' KST · 실제 체결시각 아님' : '서버 자료 확인 전');
    var focusButton = root.querySelector('[data-mtm-back]');
    focusButton.hidden = !state.focus;
    focusButton.textContent = state.focus ? '← 전체 업종' : '';
    root.querySelector('[data-mtm-grid]').innerHTML = groups.length
      ? groups.map(function (g) { return sectorHtml(g,state); }).join('')
      : '<div class="mtm-empty">' + (state.loading ? '시장 데이터를 불러오는 중입니다.' : state.error || '선택 조건에 맞는 실제 시세가 없습니다.') + '</div>';
    root.querySelectorAll('[data-mtm-market]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-mtm-market')===state.market)); });
    root.querySelectorAll('[data-mtm-size]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-mtm-size')===state.size)); });
  }
  function load(state) {
    if (state.loading) return;
    var api = global.NineAPI;
    if (!api || !api.domesticQuotes || !global.NineAccess || !global.NineAccess.isAdmin()) {
      state.error = '관리자 인증이 필요합니다. 관리자만 원천시세를 조회할 수 있습니다.';
      draw(state); return;
    }
    state.loading = true; state.error = ''; draw(state);
    api.domesticQuotes(state.candidates.map(function (r) {return r.code;}), {fallback:false})
      .then(function (rows) {
        if (!Array.isArray(rows)) throw new Error('시세 응답 오류');
        state.quotes = rows; state.ready = true;
        state.checkedAt = new Date().toLocaleTimeString('ko-KR', {timeZone:'Asia/Seoul',hour12:false});
        if (!rows.length) state.error = '수신된 유효 시세가 없습니다.';
      }).catch(function () {
        if (!state.ready) state.quotes = [];
        state.error = '시세 갱신 실패 · 권한 또는 네트워크를 확인하세요. 이전 수신값은 유지합니다.';
      }).then(function () { state.loading = false; draw(state); });
  }
  function init(container, wics, curated) {
    if (!container || container.__mtm) return;
    var state = createState(container,wics,curated);
    container.__mtm = state;
    container.innerHTML = '<main class="mtm" aria-label="섹터·종목 시장맵">'
      + '<header class="mtm-header"><div><span class="mtm-eyebrow">9PAY MARKET ATLAS</span><h1>섹터·종목 시장맵</h1><p>업종 안에서 개별 종목의 주가와 등락을 한눈에 비교합니다.</p></div>'
      + '<div class="mtm-stat"><b data-mtm-count>—</b><span data-mtm-up>—</span><span data-mtm-down>—</span></div></header>'
      + '<div class="mtm-toolbar"><div class="mtm-segments" role="group" aria-label="시장 구분">'
      + '<button type="button" data-mtm-market="ALL" aria-pressed="true">전체</button>'
      + '<button type="button" data-mtm-market="KOSPI" aria-pressed="false">KOSPI</button>'
      + '<button type="button" data-mtm-market="KOSDAQ" aria-pressed="false">KOSDAQ</button></div>'
      + '<label class="mtm-search-label">종목·업종 검색<input data-mtm-search type="search" autocomplete="off" placeholder="종목명 · 코드 · 업종" aria-label="종목 또는 업종 검색"></label>'
      + '<label class="mtm-select-label">정렬<select data-mtm-sort><option value="cap">시총순(확인된 값)</option><option value="rate">등락률순</option><option value="name">이름순</option></select></label>'
      + '<div class="mtm-segments" role="group" aria-label="타일 크기">'
      + '<button type="button" data-mtm-size="cap" aria-pressed="true">시총 크기</button>'
      + '<button type="button" data-mtm-size="equal" aria-pressed="false">동일 크기</button></div>'
      + '<button type="button" class="mtm-refresh" data-mtm-refresh>시세 다시 조회</button></div>'
      + '<div class="mtm-info"><span data-mtm-scope>데이터 준비 중</span><span data-mtm-status>접속 확인 중</span></div>'
      + '<div class="mtm-legend"><span class="mtm-legend-up">■ 상승</span><span class="mtm-legend-down">■ 하락</span>'
      + '<span>업종 등락률은 조회된 표본의 단순 평균이며 공식 업종지수가 아닙니다.</span></div>'
      + '<button class="mtm-back" type="button" data-mtm-back hidden>← 전체 업종</button>'
      + '<div class="mtm-grid" data-mtm-grid role="region" aria-label="업종별 종목 시세">자료를 확인하고 있습니다.</div>'
      + '<footer class="mtm-footer">관리자 전용 시세 화면 · WICS 업종분류 + 기존 9Pay 국내시세 · 업종별 최대 24개 선별 표본 (전 상장종목 아님)'
      + ' · 시총: 확보된 상장주식수×표시 가격 · 장중/장외·공급자 수신 지연 가능 · 자동 주문과 무관</footer></main>';
    container.addEventListener('click', function (event) {
      var target = event.target.closest && event.target.closest('button');
      if (!target) return;
      if (target.hasAttribute('data-mtm-market')) {state.market = target.getAttribute('data-mtm-market');draw(state);}
      if (target.hasAttribute('data-mtm-size')) {state.size = target.getAttribute('data-mtm-size');draw(state);}
      if (target.hasAttribute('data-mtm-more')) {state.expanded[target.getAttribute('data-mtm-more')] = true;draw(state);}
      if (target.hasAttribute('data-mtm-sector')) {state.focus = target.getAttribute('data-mtm-sector');draw(state);}
      if (target.hasAttribute('data-mtm-back')) {state.focus = '';draw(state);}
      if (target.hasAttribute('data-mtm-refresh')) load(state);
    });
    container.querySelector('[data-mtm-search]').addEventListener('input',function(e){state.search=e.target.value;draw(state);});
    container.querySelector('[data-mtm-sort]').addEventListener('change',function(e){state.sort=e.target.value;draw(state);});
    draw(state); load(state);
  }
  global.MarketMap = {init:init,chooseCandidates:chooseCandidates,grouped:grouped};
})(window);
