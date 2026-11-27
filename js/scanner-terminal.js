/*
 * 검색기 터미널 (2026-11-27 사용자 지시: 검색기 메뉴·UI 전면 개편).
 * 기존 js/pattern-scan.js(검색 알고리즘·API·이력)를 그대로 쓰고, 그 위에 다음만 얹는다.
 *   - 일반검색기: 사전 스캔 / 장중 스캔 탭 + 좌 30%(목록) · 중 25%(호가·최근 체결) · 우 45%(차트·포착 근거) 3열.
 *     호가·최근 체결은 js/order-book.js(OrderBook.init/select), 차트·근거는 pattern-scan의 openDetail 결과(chart-core 경로)를 옮겨 둔 것이다.
 *   - 자동매매 검색기: 채택 전략 / 승격 대기 전략 / 전략별 검증 성과(data/scanner-validation.js + /pattern-scan 모니터 + /autotrader/status).
 * 이 파일은 읽기 전용 화면이다. 주문·승격·설정 변경 기능은 없고, 데이터 권한은 서버(/pattern-scan·/order-book·/autotrader 관리자 경계)가 판정한다.
 * pattern-scan.js 훅: #pattern-scan[data-terminal] 일 때만 상세를 오른쪽 칸에 두고 nine-scanner-select/list/quotes 이벤트를 낸다.
 */
(function (global) {
  'use strict';
  var BASE = (typeof global.NineAsset !== 'undefined' && global.NineAsset.base) || 'https://goodbyestarwars.github.io/tistory-ticker/';
  var ASSET_V = '?v=20261127-scanner-terminal';
  var HOST_SELECTOR = '#pattern-scan';
  var REFRESH_MS = 30000;
  var QUOTE_FRESH_MS = 120000;
  var LIVE_TABS = { liveFlow: true };       // 장중(실시간) 판정을 지원하는 검색기: 9Pay A/B + 장중 거래량 급증 감시를 가진 '거래량·가격 회복'뿐이다.
  var state = { host: null, view: 'general', mode: 'pre', autoTab: 'adopted', pane: 'list', selected: null, timer: null, bookReady: null, status: null, statusError: '', statusBusy: false };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; });
  }
  function num(value) { var n = Number(value); return value != null && value !== '' && isFinite(n) ? n : null; }
  function fmtInt(value) { var n = num(value); return n == null ? '미집계' : n.toLocaleString('ko-KR'); }
  function fmtPct(value, digits, plus) {
    var n = num(value);
    if (n == null) return '미집계';
    return (plus && n > 0 ? '+' : '') + n.toFixed(digits == null ? 2 : digits) + '%';
  }
  function tone(value) { var n = num(value); return n == null ? '' : n > 0 ? 'is-up' : n < 0 ? 'is-down' : ''; }
  function cell(label, value, cls) { return '<div class="st-metric"><dt>' + esc(label) + '</dt><dd class="' + (cls || '') + '">' + value + '</dd></div>'; }
  function kst(value) {
    if (value == null || value === '') return '';
    var ms = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
    if (!isFinite(ms)) return /^\d{4}-?\d{2}-?\d{2}$/.test(String(value)) ? String(value) : '';
    return new Date(ms + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ') + ' KST';
  }
  function T() { return global.PatternScan && global.PatternScan.terminal; }
  function selection() { var s = T() && T().state().scanData; return s && s.shapeSelection || null; }

  /* ───────── 시작: pattern-scan 이 셸을 만들 때까지 기다린 뒤 한 번만 구성한다 ───────── */
  function start() {
    var host = document.querySelector(HOST_SELECTOR);
    if (!host || host.getAttribute('data-terminal')) return;
    var tries = 0, timer = setInterval(function () {
      tries += 1;
      if (T() && host.querySelector('#psList') && host.querySelector('.ps-control-card')) { clearInterval(timer); build(host); }
      else if (tries > 100) clearInterval(timer);           // 20초 안에 못 만들면 기존 화면을 그대로 둔다.
    }, 200);
  }

  function build(host) {
    state.host = host;
    host.setAttribute('data-terminal', '1');
    host.classList.add('st-terminal');
    var control = host.querySelector('.ps-control-card'), list = host.querySelector('#psList'), detail = host.querySelector('#psDetail');
    var head = document.createElement('div');
    head.className = 'st-head';
    head.innerHTML = '<div class="st-kind" role="tablist" aria-label="검색기 종류">'
      + '<button type="button" role="tab" data-st-view="general">일반검색기</button><button type="button" role="tab" data-st-view="auto">자동매매 검색기</button></div>'
      + '<span class="st-mode-badge" id="stModeBadge"></span>'
      + '<p class="st-mode-note" id="stModeNote" role="status"></p>';
    host.insertBefore(head, host.firstChild);

    var grid = document.createElement('div');
    grid.className = 'st-grid';
    grid.setAttribute('data-st-pane', 'list');
    grid.innerHTML = '<nav class="st-pane-tabs" aria-label="화면 전환"><button type="button" data-st-pane-btn="list">목록</button><button type="button" data-st-pane-btn="book">호가</button><button type="button" data-st-pane-btn="chart">차트</button></nav>'
      + '<section class="st-col st-left" aria-label="검색 결과"><div class="st-intraday-notice" id="stNotice" hidden></div><div class="st-summary" id="stSummary"></div></section>'
      + '<section class="st-col st-mid" aria-label="실시간 호가와 최근 체결"><div class="st-col-title">호가 · 최근 체결</div><div class="st-book-empty" id="stBookEmpty">목록에서 종목을 선택하면 호가창과 최근 체결이 표시됩니다.</div><div id="order-book" class="st-book" hidden></div></section>'
      + '<section class="st-col st-right" aria-label="차트와 포착 근거"><div class="st-col-title">차트 · 포착 근거</div><div class="st-evidence" id="stEvidence"></div><div class="st-detail-empty" id="stDetailEmpty">종목을 선택하면 일봉 차트와 검색기 포착 근거가 표시됩니다.</div></section>';
    control.insertAdjacentElement('afterend', grid);
    grid.querySelector('.st-left').appendChild(list);
    grid.querySelector('.st-right').appendChild(detail);
    list.classList.add('st-list');

    var auto = document.createElement('div');
    auto.className = 'st-auto';
    auto.id = 'stAuto';
    auto.hidden = true;
    grid.insertAdjacentElement('afterend', auto);

    wire(host);
    var view = new URLSearchParams(location.search).get('view') === 'auto' ? 'auto' : 'general';
    setView(view, true);
    new MutationObserver(syncDetailEmpty).observe(detail, { attributes: true, attributeFilter: ['hidden'] });
    syncDetailEmpty();
    annotate();
    // pattern-scan.init()이 다시 불리면 셸이 통째로 새로 그려진다. 그때는 터미널 구성을 처음부터 다시 얹는다.
    new MutationObserver(function (_, observer) {
      if (host.querySelector('.st-grid')) return;
      observer.disconnect();
      host.removeAttribute('data-terminal');
      host.classList.remove('st-terminal');
      clearInterval(state.timer);
      start();
    }).observe(host, { childList: true });
  }

  function wire(host) {
    if (host.__stWired) return;                             // 셸을 다시 그려도 같은 노드에는 리스너를 한 번만 단다.
    host.__stWired = true;
    host.addEventListener('click', function (event) {
      var viewBtn = event.target.closest('[data-st-view]'), paneBtn = event.target.closest('[data-st-pane-btn]');
      if (viewBtn) setView(viewBtn.getAttribute('data-st-view'));
      else if (paneBtn) setPane(paneBtn.getAttribute('data-st-pane-btn'));
      else rowClick(event);
    });
    host.addEventListener('keydown', function (event) {
      var row = event.target.closest && event.target.closest('.st-list .ps-pick, .st-list .ps-item');
      if (!row) return;
      if (event.key === 'Enter' || event.key === ' ') { if (event.target === row) { event.preventDefault(); choose(row); } }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        var rows = Array.prototype.slice.call(host.querySelectorAll('.st-list .ps-pick[data-code], .st-list .ps-item[data-code]'));
        var next = rows[rows.indexOf(row) + (event.key === 'ArrowDown' ? 1 : -1)];
        if (next) { event.preventDefault(); next.focus(); choose(next); }
      }
    });
    if (state.docWired) return;
    state.docWired = true;
    document.addEventListener('nine-scanner-select', function (event) { onSelect(event.detail || {}); });
    document.addEventListener('nine-scanner-list', function () { annotate(); if (state.view === 'auto') renderAuto(); });
    document.addEventListener('nine-scanner-quotes', function () { annotate(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) syncTimer(); });
  }

  function rowClick(event) {
    var row = event.target.closest('.st-list .ps-pick, .st-list .ps-item');
    if (!row || event.target.closest('a, .ps-state-detail')) return;       // 버튼은 기존 핸들러가 열고, 행의 다른 곳은 같은 동작으로 잇는다.
    choose(row);
  }
  function choose(row) {
    var button = row.querySelector('.ps-state-detail');
    if (button) button.click(); else row.click();
  }

  /* ───────── 보기 전환 ───────── */
  function setView(view, silent) {
    state.view = view === 'auto' ? 'auto' : 'general';
    var host = state.host;
    host.querySelector('.ps-control-card').hidden = state.view === 'auto';
    host.querySelector('.st-grid').hidden = state.view === 'auto';
    host.querySelector('#stAuto').hidden = state.view !== 'auto';
    host.querySelector('#stModeBadge').hidden = state.view === 'auto';
    host.querySelector('#stModeNote').hidden = state.view === 'auto';
    host.querySelectorAll('[data-st-view]').forEach(function (b) { var on = b.getAttribute('data-st-view') === state.view; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
    if (!silent && global.history && global.history.replaceState) {
      var url = new URL(location.href);
      if (state.view === 'auto') url.searchParams.set('view', 'auto'); else url.searchParams.delete('view');
      global.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    if (state.view === 'auto') { loadStatus(); renderAuto(); }
    setMode(state.mode, true);
  }
  function setMode(mode, silent) {
    state.mode = mode === 'intraday' ? 'intraday' : 'pre';
    var badge = state.host.querySelector('#stModeBadge');
    badge.textContent = state.mode === 'intraday' ? '장중 스캔' : '사전 스캔';
    badge.className = 'st-mode-badge st-mode-badge--' + state.mode;
    syncTimer();
    if (!silent || state.view === 'general') annotate();
  }
  function setPane(pane) {
    state.pane = pane;
    var grid = state.host.querySelector('.st-grid');
    grid.setAttribute('data-st-pane', pane);
    grid.querySelectorAll('[data-st-pane-btn]').forEach(function (b) { var on = b.getAttribute('data-st-pane-btn') === pane; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
  }
  function syncTimer() {
    clearInterval(state.timer);
    state.timer = null;
    if (state.view !== 'general' || state.mode !== 'intraday') return;
    state.timer = setInterval(function () { if (!document.hidden && T()) T().refreshQuotes(); }, REFRESH_MS);
    if (T()) T().refreshQuotes();
  }
  function syncDetailEmpty() {
    var detail = document.getElementById('psDetail'), empty = document.getElementById('stDetailEmpty');
    if (empty && detail) empty.hidden = !detail.hidden;
  }

  /* ───────── 장중 상태 구분 ─────────
   * 사전 스캔: 일봉 확정 후보(기준일 종가 판정). 장중 스캔: 실시간 판정을 가진 검색기(거래량·가격 회복)만 실시간으로 표시한다.
   * 그 밖의 검색기는 장중 재판정 엔진이 없어 실시간 검색으로 표시하지 않으며, 사전 스캔 후보의 현재가가 무효화 가격 아래인지만 가격 점검으로 알려 준다.
   */
  function classify(row, tab) {
    var quote = T().quote(row.code), price = null, fresh = false;
    if (quote && quote.data && num(quote.data.price) > 0) { price = num(quote.data.price); fresh = Date.now() - quote.at < QUOTE_FRESH_MS && quote.at > 0; }
    var level = row.invalidation > 0 ? row.invalidation : row.support > 0 ? row.support : null;
    var liveMember = row.members.some(function (m) { return (m.key === 'ninepayLive' || m.key === 'volumeBreakout') && !m.stale; });
    var preMember = row.members.some(function (m) { return m.key !== 'ninepayLive' && m.key !== 'volumeBreakout'; });
    var broken = fresh && level != null && price < level;
    if (LIVE_TABS[tab]) {
      if (broken) return { key: 'broken', label: '조건 이탈', detail: '현재가 ' + price.toLocaleString('ko-KR') + ' < 무효화 가격 ' + level.toLocaleString('ko-KR') };
      if (liveMember && preMember) return { key: 'met', label: '장중 조건 충족', detail: '사전 후보 + 장중 신호 동시 확인' };
      if (liveMember) return { key: 'new', label: '장중 신규 포착', detail: '사전 후보에는 없던 장중 신호' };
      return { key: 'wait', label: '장중 신호 대기', detail: '사전 후보 · 아직 장중 신호 없음' };
    }
    if (broken) return { key: 'broken', label: '가격 이탈', detail: '현재가 ' + price.toLocaleString('ko-KR') + ' < 무효화 가격 ' + level.toLocaleString('ko-KR') + ' (가격 점검, 엔진 재판정 아님)' };
    if (level != null && fresh) return { key: 'hold', label: '가격 유지', detail: '현재가가 무효화 가격 위 (가격 점검, 엔진 재판정 아님)' };
    return { key: 'wait', label: level != null ? '시세 미수신' : '기준 가격 미확인', detail: '장중 판정을 지원하지 않는 검색기 · 일봉 확정 후보' };
  }

  function annotate() {
    if (!state.host || state.view !== 'general' || !T()) return;
    var st = T().state(), tab = st.tab, rows = T().rows(), live = T().live(), sel = selection();
    var wantMode = LIVE_TABS[tab] ? 'intraday' : 'pre';                    // 사전/장중은 검색기가 정한다: 장중 재판정이 있는 검색기만 장중 스캔, 나머지는 사전(일봉 확정) 스캔.
    if (wantMode !== state.mode) { setMode(wantMode, true); }
    var supported = !!LIVE_TABS[tab], intradayUnsupported = state.mode === 'intraday' && !supported;
    var list = state.host.querySelector('#psList'), notice = state.host.querySelector('#stNotice'), summary = state.host.querySelector('#stSummary');
    list.classList.toggle('st-hidden-list', intradayUnsupported);
    var note = state.host.querySelector('#stModeNote');
    if (state.mode === 'pre') note.textContent = '일봉 확정 스캔(평일 20:10 KST 이후 저장) 후보입니다.' + (sel ? ' 데이터 기준일 ' + sel.dataDate + ' · ' : ' ') + '장중 변화는 가격 점검으로만 표시합니다.';
    else if (supported) note.textContent = '실시간 검색: 9Pay A/B 신호와 장중 거래량 급증 감시(30초 갱신). 신호가 없는 사전 후보는 대기로 표시합니다.' + providerNote(live);
    else note.textContent = '이 검색기는 일봉 확정 판정만 지원해 장중 실시간 검색으로 표시하지 않습니다.';
    notice.hidden = !intradayUnsupported;
    if (intradayUnsupported) notice.innerHTML = '<strong>장중 스캔 미지원 검색기</strong><p>기존 엔진에는 이 검색기의 장중 재판정이 없습니다. 후보는 <button type="button" class="st-link" data-st-mode="pre">사전 스캔</button>에서 확인하세요. 일부 종목의 가격 점검만 사전 스캔 목록에 표시됩니다.</p>';
    var order = { new: 0, met: 1, broken: 2, hold: 3, wait: 4 }, counts = { new: 0, met: 0, broken: 0, hold: 0, wait: 0 }, parent = null, anchor = null;
    var byCode = {};
    rows.forEach(function (r) { byCode[r.code] = r; });
    if (state.selected && !byCode[state.selected]) {       // 검색기·구간을 바꿔 선택 종목이 목록에서 빠지면 오른쪽·가운데 칸도 비운다(남은 종목 정보가 새 목록의 것으로 보이지 않게).
      state.selected = null;
      state.host.querySelector('#stEvidence').innerHTML = '';
      state.host.querySelector('#order-book').hidden = true;
      var be = state.host.querySelector('#stBookEmpty');
      be.hidden = false;
      be.textContent = '목록에서 종목을 선택하면 호가창과 최근 체결이 표시됩니다.';
    }
    var cards = Array.prototype.slice.call(list.querySelectorAll('.ps-pick[data-code]'));
    cards.forEach(function (card) {
      var r = byCode[card.getAttribute('data-code')];
      var old = card.querySelector('.st-state');
      if (old) old.remove();
      if (!r) return;
      var cls = classify(r, tab);
      counts[cls.key] += 1;
      card.setAttribute('data-st-state', cls.key);
      var when = kst(r.scannedAt || r.date);
      var baseDay = (sel && sel.dataDate) || String(r.date || '').slice(0, 10) || '미확인';
      var box = document.createElement('div');
      box.className = 'st-state';
      // 2026-11-27 가독성: 목록 카드는 한 줄 요약(월/일 시:분)으로 줄이고 전체 시각은 title에 둔다.
      var shortDate = function (s) { return String(s).replace(/\b20\d{2}-(\d{2})-(\d{2})/g, function (m, a, b) { return Number(a) + '/' + Number(b); }).replace(/\s*KST/, ''); };
      var fullStamp = '포착 ' + (when || '시각 미확인') + ' · 기준일 ' + baseDay;
      box.innerHTML = '<span class="st-chip st-chip--' + cls.key + '" title="' + esc(cls.detail) + '">' + esc(cls.label) + '</span>'
        + '<span class="st-stamp" title="' + esc(fullStamp) + '">포착 ' + esc(shortDate(when || '시각 미확인')) + ' · 기준 ' + esc(shortDate(baseDay)) + '</span>';
      var head = card.querySelector('.ps-pick-head');
      var oldBadge = head && head.querySelector('.ps-state-badge');                       // '수동 점검 필요' 등은 상태 줄로 복제해 이름 줄을 짧게 둔다(원본은 CSS로만 숨김).
      if (oldBadge) { var copy = oldBadge.cloneNode(true); copy.classList.add('st-badge-copy'); box.insertBefore(copy, box.children[1] || null); }
      if (head) head.insertAdjacentElement('afterend', box);
      parent = card.parentNode;
    });
    if (state.mode === 'intraday' && supported && parent) {                            // 장중 신규·충족·이탈 순으로 앞에 둔다(안정 정렬).
      cards.map(function (c, i) { return { c: c, i: i, k: order[c.getAttribute('data-st-state')] == null ? 9 : order[c.getAttribute('data-st-state')] }; })
        .sort(function (a, b) { return a.k - b.k || a.i - b.i; })
        .forEach(function (x) { parent.appendChild(x.c); });
    }
    summary.innerHTML = cards.length ? (supported
      ? '장중 신규 <b>' + counts.new + '</b> · 장중 충족 <b>' + counts.met + '</b> · 조건 이탈 <b>' + counts.broken + '</b> · 신호 대기 <b>' + counts.wait + '</b>'
      : '후보 <b>' + cards.length + '</b> · 가격 이탈 <b>' + counts.broken + '</b> · 가격 유지 <b>' + counts.hold + '</b>' + (counts.wait ? ' · 시세·기준 미확인 <b>' + counts.wait + '</b>' : '')) : '';
    summary.hidden = intradayUnsupported || !cards.length;
    if (state.selected) { var sc = list.querySelector('.ps-pick[data-code="' + state.selected + '"]'); list.querySelectorAll('.is-selected').forEach(function (c) { c.classList.remove('is-selected'); c.removeAttribute('aria-current'); }); if (sc) { sc.classList.add('is-selected'); sc.setAttribute('aria-current', 'true'); } }
    list.querySelectorAll('.ps-pick[data-code]').forEach(function (c) { c.tabIndex = 0; });
  }
  function providerNote(live) {
    var out = [];
    if (live.ninepay.error) out.push('9Pay 상태 오류');
    else if (!live.ninepay.running) out.push('9Pay 감시 중단');
    else if (!live.ninepay.active) out.push('9Pay 장외 대기');
    if (live.surge.error) out.push('거래량 급증 조회 실패');
    else if (!live.surge.active) out.push('거래량 급증 장외');
    return out.length ? ' · ' + out.join(' · ') : '';
  }

  /* ───────── 종목 선택: 호가·차트·근거를 한 번에 바꾼다(페이지 이동 없음) ───────── */
  function onSelect(detail) {
    if (!state.host || state.view !== 'general' || !detail.code) return;
    state.selected = String(detail.code);
    var row = T().rows().filter(function (r) { return r.code === state.selected; })[0] || { code: state.selected, name: detail.name || '', members: [], lines: [], reasons: [] };
    renderEvidence(row, detail);
    showBook(row);
    annotate();
    if (global.matchMedia && global.matchMedia('(max-width: 860px)').matches) setPane('chart');
  }
  function renderEvidence(row, detail) {
    var cls = classify(row, detail.tab || T().state().tab), sel = selection();
    var level = row.invalidation > 0 ? row.invalidation : row.support;
    var src = (row.keys || []).map(sourceName).filter(function (v, i, a) { return v && a.indexOf(v) === i; }).join(' · ');
    var lines = (row.lines || []).concat(row.reasons || []).filter(function (v, i, a) { return v && a.indexOf(v) === i; }).slice(0, 5);
    state.host.querySelector('#stEvidence').innerHTML = '<div class="st-ev-head"><b>' + esc(row.name || row.code) + '</b><small>' + esc(row.code) + '</small>'
      + '<span class="st-chip st-chip--' + cls.key + '">' + esc(cls.label) + '</span>'
      + '<a class="st-link" href="/page/foreign-flow?code=' + encodeURIComponent(row.code) + '&name=' + encodeURIComponent(row.name || '') + '">종목분석 →</a></div>'
      + '<dl class="st-ev-grid">'
      + cell('포착 시각', esc(kst(row.scannedAt || row.date) || '시각 미확인'))
      + cell('데이터 기준일', esc((sel && sel.dataDate) || String(row.date || '').slice(0, 10) || '미확인'))
      + cell('검색기', esc(src || '미확인'))
      + cell('틀렸다고 볼 가격', level > 0 ? esc(level.toLocaleString('ko-KR')) + '원' : '미확인')
      + '</dl><ul class="st-ev-lines">' + (lines.length ? lines.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') : '<li>저장된 선정 이유가 없습니다.</li>') + '</ul>'
      + '<p class="st-ev-note">' + esc(cls.detail) + '. 검색 결과는 후보이며 주문 신호가 아닙니다.</p>';
  }
  function sourceName(key) {
    if (key === 'ninepayLive') return '9Pay 장중 A/B';
    if (key === 'volumeBreakout') return '장중 거래량 급증';
    if (String(key).indexOf('shape:') === 0) return '일봉 모양 선정';
    if (String(key).indexOf('edge:') === 0) return '연구 태그 ' + String(key).slice(5);
    return String(key);
  }
  function ensureOrderBook() {
    if (state.bookReady) return state.bookReady;
    state.bookReady = new Promise(function (resolve, reject) {
      if (!document.querySelector('link[data-st-order-book]')) {
        var link = document.createElement('link');
        link.rel = 'stylesheet'; link.href = BASE + 'css/order-book.css'; link.setAttribute('data-st-order-book', '1');
        document.head.appendChild(link);
      }
      function mount() { try { global.OrderBook.init('#order-book', { hideSearch: true }); resolve(global.OrderBook); } catch (e) { reject(e); } }
      if (global.OrderBook) return mount();
      var script = document.createElement('script');
      script.src = BASE + 'js/order-book.js'; script.async = true;
      script.onload = function () { global.OrderBook ? mount() : reject(new Error('order-book')); };
      script.onerror = function () { reject(new Error('order-book load')); };
      document.head.appendChild(script);
    });
    state.bookReady.catch(function () { state.bookReady = null; });
    return state.bookReady;
  }
  function showBook(row) {
    var box = state.host.querySelector('#order-book'), empty = state.host.querySelector('#stBookEmpty');
    ensureOrderBook().then(function (book) {
      box.hidden = false; empty.hidden = true;
      book.select(box, row.code, row.name || row.code);
    }).catch(function () { empty.hidden = false; empty.textContent = '호가창을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'; });
  }

  /* ───────── 자동매매 검색기 ───────── */
  function strategies() { return (global.SCANNER_VALIDATION && global.SCANNER_VALIDATION.strategies) || []; }
  function monitorOf(strategy) {
    var m = selection() && selection().monitor, entry = m && m.scanners && m.scanners[strategy.monitorKey];
    var all = entry && entry.all, rule = all && all.rules && all.rules['exit-v2'];
    if (!entry || entry.status === 'error' || !all || !rule) return null;
    var up = entry.kospiAbove60 && entry.kospiAbove60.rules && entry.kospiAbove60.rules['exit-v2'];
    return { signals: all.signals, since: all.since, all: rule, kospi: up || null, kospiSignals: entry.kospiAbove60 && entry.kospiAbove60.signals };
  }
  function meets(rule, req) { return !!rule && num(rule.closed) >= req.minClosed && num(rule.pf) >= req.minPf && num(rule.avgPct) >= req.minAvgPct; }
  function promotion(strategy) {
    var req = global.SCANNER_VALIDATION.promotionRule, mon = monitorOf(strategy);
    if (strategy.adopted) return { key: 'adopted', text: '채택됨 · 5년 검증(검증·시험 PF 3.49 / 3.27)과 60일선 매도 규칙을 통과해 사용자 승인으로 채택', basis: '실계좌 주문은 자동매매 화면의 주문 스위치가 따로 결정합니다.' };
    if (!mon) return { key: 'hold', text: '판단 보류 · 일봉 모의 추적 기록을 수신하지 못함(미집계)', basis: '승격 요건: 끝난 매매 ' + req.minClosed + '건 이상 · PF ' + req.minPf + ' 이상 · 1건 평균 +' + req.minAvgPct + '% 이상(' + req.rule + ', 전체 또는 KOSPI 60일선 위).' };
    var ok = meets(mon.all, req) || meets(mon.kospi, req);
    var best = mon.all;
    return ok ? { key: 'review', text: '승격 검토 요건 충족 · 사용자 승인 전에는 켜지 않음', basis: '끝난 ' + fmtInt(best.closed) + '건 · PF ' + (best.pf == null ? '미집계' : best.pf) + ' · 평균 ' + fmtPct(best.avgPct, 2, true) + '. 요건을 넘어도 자동 승격하지 않습니다.' }
      : { key: 'pending', text: '요건 미충족 · 승격 대기', basis: '끝난 매매 ' + fmtInt(best.closed) + '/' + req.minClosed + '건 · PF ' + (best.pf == null ? '미집계' : best.pf) + '/' + req.minPf + ' · 1건 평균 ' + fmtPct(best.avgPct, 2, true) + '/+' + req.minAvgPct + '%'
        + (strategy.backtest && strategy.backtest.note ? ' · 5년 백테스트: ' + strategy.backtest.note : '') };
  }
  function serviceState(strategy) {
    var sel = selection(), st = T() && T().state(), live = T() && T().live();
    var daily = !st || !st.scanSettled ? { cls: 'wait', text: '일봉 스캔 확인 중' }
      : !sel ? { cls: 'bad', text: '일봉 스캔 미수신' }
      : { cls: 'ok', text: '일봉 스캔 수신 · 기준일 ' + esc(sel.dataDate) + ' · 후보 ' + (((sel.groups || {})[strategy.key] || []).length) + '건' };
    if (strategy.key !== 'liveFlow') return daily;
    var nine = !live ? '9Pay 상태 미확인' : live.ninepay.error ? '9Pay 상태 오류' : !live.ninepay.running ? '9Pay 감시 중단' : live.ninepay.active ? '9Pay 장중 감시 중' : '9Pay 장외 대기';
    return { cls: daily.cls, text: daily.text + ' · ' + nine };
  }
  function orderState(strategy) {
    var s = state.status;
    if (state.statusBusy && !s) return { cls: 'wait', text: '확인 중' };
    if (!s || !s.received) return { cls: 'bad', text: '미수신' + (state.statusError ? ' · ' + esc(state.statusError) : ' (에이전트 상태 없음)') };
    var f = (s.vm || {}).flags || {}, lp = f.leaderPullback;
    if (strategy.key === 'leaderPullback') {
      if (!lp) return { cls: 'wait', text: '미확인 · 에이전트가 주도주 칸 설정을 보고하지 않음' };
      var on = lp.on === true && f.liveTrading === true && f.manualStop !== true;
      return { cls: on ? 'ok' : 'off', text: (lp.on ? '주도주 칸 켜짐' : '주도주 칸 꺼짐') + ' · 실주문 스위치 ' + (f.liveTrading ? '켜짐' : '꺼짐') + (f.manualStop ? ' · 수동 중지' : '') + (on ? ' → 조건 충족 시 주문 허용' : ' → 주문 허용 안 됨') };
    }
    if (strategy.key === 'liveFlow') return { cls: f.ninepayLive === true ? 'ok' : 'off', text: '9Pay 주문 스위치 ' + (f.ninepayLive === true ? '켜짐' : f.ninepayLive === false ? '꺼짐' : '미확인') };
    return { cls: 'wait', text: '미확인 · 스윙 신규 매수 스위치는 상태 API에 없음(문서상 중지, 서버 설정 확인 필요)' };
  }
  function loadStatus() {
    if (state.statusBusy || !global.NineAPI || !global.NineAPI.data) return;
    state.statusBusy = true;
    global.NineAPI.data(global.NineAPI.vmUrl + '/autotrader/status', { private: true, timeoutMs: 8000, fetchOptions: { credentials: 'include', cache: 'no-store' } })
      .then(function (data) { state.status = data; state.statusError = ''; })
      .catch(function (e) { state.statusError = (e && e.message) || '조회 실패'; })
      .then(function () { state.statusBusy = false; if (state.view === 'auto') renderAuto(); });
  }
  function badge(kind, label, text) { return '<div class="st-tri st-tri--' + kind + '"><small>' + esc(label) + '</small><b>' + text + '</b></div>'; }
  function strategyCard(s) {
    var p = promotion(s), svc = serviceState(s), ord = orderState(s);
    return '<article class="st-strategy" data-strategy="' + esc(s.key) + '"><header><h3>' + esc(s.label) + '</h3><span class="st-chip st-chip--' + (s.adopted ? 'met' : 'wait') + '">' + (s.adopted ? '채택' : '검증 중') + '</span><small>' + ({ short: '단타', swing: '스윙', long: '중장기' }[s.horizon] || '') + '</small></header>'
      + '<div class="st-tri-row">' + badge(s.adopted ? 'ok' : 'wait', '채택 상태', s.adopted ? '채택 전략' : '승격 대기(검증 중)') + badge(svc.cls, '서비스 실행 상태', svc.text) + badge(ord.cls, '실계좌 주문 허용 상태', ord.text) + '</div>'
      + '<dl class="st-conds"><div><dt>매수 조건</dt><dd>' + esc(s.buy) + '</dd></div><div><dt>매도 조건</dt><dd>' + esc(s.sell) + '</dd></div></dl>'
      + '</article>';
  }
  function metricRow(label, r) {
    return '<tr><th scope="row">' + esc(label) + '</th><td>' + fmtInt(r.n) + '</td><td class="' + tone(r.avg) + '">' + fmtPct(r.avg, 2, true) + '</td><td>' + (r.win == null ? '미집계' : fmtPct(r.win, 1)) + '</td><td>' + (r.pf == null ? '미집계' : esc(r.pf)) + '</td><td>' + (r.mdd == null ? '미집계' : esc(r.mdd) + '%p') + '</td>'
      + (r.excess === undefined ? '' : '<td class="' + tone(r.excess) + '">' + fmtPct(r.excess, 2, true).replace('%', '%p') + '</td>') + '</tr>';
  }
  function resultTable(rows, withExcess) {
    return '<div class="st-table-wrap"><table class="st-table"><thead><tr><th>구간</th><th>표본 수</th><th>평균 수익률(1건)</th><th>승률</th><th>PF</th><th>MDD</th>' + (withExcess ? '<th>초과(아무 종목 대비)</th>' : '') + '</tr></thead><tbody>'
      + rows.map(function (r) { return metricRow(r.period, r); }).join('') + '</tbody></table></div>';
  }
  function block(title, meta, body) { return '<section class="st-result"><h4>' + esc(title) + '</h4>' + (meta ? '<p class="st-meta">' + meta + '</p>' : '') + body + '</section>'; }
  function missing(note) { return '<p class="st-missing"><b>미집계</b>' + (note ? ' · ' + esc(note) : '') + '</p>'; }
  function performanceCard(s) {
    var b = s.backtest, mon = monitorOf(s), paper;
    if (mon) {
      var row = function (label, r, signals) { return r ? metricRow(label + ' (포착 ' + fmtInt(signals) + '건)', { n: r.closed, avg: r.avgPct, win: r.winPct, pf: r.pf, mdd: null }) : ''; };
      paper = block('일봉 모의매매 (서버 포착 추적)', '다음 거래일 시가 매수 가정 · exit-v2 · 비용 0.7% · ' + esc(mon.since || '시작일 미확인') + '부터 · 보유 중 ' + fmtInt(mon.all.open) + '건 별도(평균 ' + fmtPct(mon.all.openAvgPct, 2, true) + ')',
        '<div class="st-table-wrap"><table class="st-table"><thead><tr><th>구간</th><th>끝난 매매</th><th>평균 수익률(1건)</th><th>승률</th><th>PF</th><th>MDD</th></tr></thead><tbody>' + row('전체', mon.all, mon.signals) + row('KOSPI 60일선 위', mon.kospi, mon.kospiSignals) + '</tbody></table></div>');
    } else paper = block('일봉 모의매매 (서버 포착 추적)', '', missing('추적 기록을 수신하지 못했거나 아직 쌓이지 않음'));
    var intraday = s.intraday ? block('장중 모의매매 (실시간 신호 분봉 전진 검증)', esc(s.intraday.exitRule) + ' · 비용 ' + esc(s.intraday.cost) + ' · ' + esc(s.intraday.source), resultTable(s.intraday.rows, false) + '<p class="st-note">' + esc(s.intraday.note) + '</p>')
      : block('장중 모의매매', '', missing('이 전략은 장중 신호가 없거나 아직 검증 전'));
    return '<article class="st-strategy st-perf" data-strategy="' + esc(s.key) + '"><header><h3>검증 성과</h3></header>'
      + block('백테스트 (과거 5년 일봉 재현)', esc(b.exitRule) + ' · 비용 ' + esc(b.cost) + ' · ' + esc(b.source), resultTable(b.rows, b.rows[0].excess !== undefined) + '<p class="st-note">' + esc(b.note) + '</p>')
      + paper + intraday + block('실계좌 매매 결과', '', missing(s.real.note)) + '</article>';
  }
  function renderAuto() {
    var box = state.host && state.host.querySelector('#stAuto');
    if (!box || state.view !== 'auto') return;
    var adopted = strategies().filter(function (s) { return s.adopted; });
    if (!adopted.length) { box.innerHTML = '<p class="st-missing"><b>채택 전략 없음</b> · 검증 자료를 불러오지 못했거나 채택된 전략이 없습니다.</p>'; return; }
    box.innerHTML = '<div class="st-auto-head"><p class="st-note">자동매매에 쓰는 전략만 보여 줍니다. 나머지 검색기는 일반검색기에서 확인하세요. 채택 상태 · 서비스 실행 상태 · 실계좌 주문 허용 상태는 서로 다른 값이며, 백테스트·일봉 모의·장중 모의·실계좌 결과는 섞지 않고 없는 값은 미집계로 표시합니다. 이 화면에는 승격·주문 기능이 없습니다. 기준일 ' + esc(global.SCANNER_VALIDATION.asOf) + '.</p></div>'
      + '<div class="st-strategies">' + adopted.map(function (s) { return strategyCard(s) + performanceCard(s); }).join('') + '</div>';
  }

  global.ScannerTerminal = { start: start, classify: classify, promotion: promotion, _state: state };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window);
