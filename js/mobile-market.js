/* 시장 페이지 모바일 전용 카드 UI (2026-10-16)
 *
 * 767px 이하에서만 켜진다(skin-main.js가 그때만 이 파일과 css/mobile-market.css를 불러온다). PC·태블릿(768px~)에서는
 * 로드되지 않고, 불러온 뒤 창이 넓어져도 css/mobile-market.css의 모든 규칙이 @media (max-width: 767px) 안에 있고
 * 이 파일이 만든 요소(.mm-only)는 PC에서 display:none 이라 화면이 달라지지 않는다.
 *
 * 하는 일(기존 요소·데이터·API 호출은 그대로, 새 API 호출 없음):
 *  - deck()  : 같은 종류의 카드들(차트 패널·순위 표 등)을 가로 스와이프(CSS scroll-snap) + 탭 + 이전/다음 버튼으로 전환
 *  - 국내 시장지표 : KOSPI·KOSDAQ 요약 카드(표 값을 읽어 만듦), 차트 한 번에 하나(스와이프), 이어지는 투자자 매매 표도 스와이프
 *  - 글로벌 시장지표 : 나스닥·S&P500·다우 요약 카드(누르면 해당 행을 선택해 기존 차트가 바뀜)
 *  - 국내 투자자 수급 : 외국인·기관·개인 선택, 순위(외국인/기관 × 순매수/순매도) 스와이프 + 5개씩 더 보기
 *  - 증시온도 : KPI 스트립 스와이프, 상승·하락 요인 목록은 기본 접고 '요인 보기'로 펼침
 * 원본 표·수치·정렬은 지우지 않는다(요약 카드는 읽기 전용 복사본, 접는 것은 CSS 숨김).
 * 자동 슬라이드 없음, 3D 효과 없음, prefers-reduced-motion이면 부드러운 이동도 끈다. */
(function (global) {
  'use strict';

  var MQ = '(max-width: 767px)';
  var PAGE_SIZE = 5;

  function isMobile() { return !!(global.matchMedia && global.matchMedia(MQ).matches); }
  function reduceMotion() { return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function el(tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }
  function text(node) { return node ? String(node.textContent || '').replace(/\s+/g, ' ').trim() : ''; }

  /* ---------- 순수 계산(테스트 대상) ---------- */

  /* 스크롤 위치에서 가장 가까운 카드 번호. offsets: 각 카드의 왼쪽 시작 위치(스크롤 좌표) */
  function nearestIndex(scrollLeft, offsets) {
    var best = 0, bestGap = Infinity;
    for (var i = 0; i < offsets.length; i++) {
      var gap = Math.abs(offsets[i] - scrollLeft);
      if (gap < bestGap) { bestGap = gap; best = i; }
    }
    return best;
  }

  /* 5개씩 더 보기: 보이는 개수와 남은 개수 */
  function pageState(total, shown) {
    var visible = Math.min(total, shown);
    return { visible: visible, remaining: Math.max(0, total - visible), canMore: total > visible };
  }

  /* 글자에서 부호로 상승/하락 색 클래스. '▲ 1.2'·'+0.5%'·'-0.3%'·'▼ 3' */
  function toneOf(str) {
    var s = String(str == null ? '' : str).trim();
    if (!s || s === '-') return '';
    if (/^[▲+]/.test(s)) return 'mm-up';
    if (/^[▼\-−]/.test(s)) return 'mm-down';
    return '';
  }

  /* ---------- 가로 스와이프 덱 ---------- */

  /* host의 직접 자식 중 slideSel에 맞는 요소들을 스와이프 카드로 만든다. 카드가 바뀌면(다시 그려짐) 다시 만든다.
     labels: 탭 글자 배열 또는 (slide, index)=>글자 함수. 반환: { go(i), index() } */
  function ensureDeck(host, slideSel, labels, opts) {
    opts = opts || {};
    var slides = Array.prototype.filter.call(host.children, function (c) { return c.matches(slideSel); });
    var prev = host._mmDeck;
    if (slides.length < 2) { if (prev) teardown(host); return null; }
    if (prev && prev.slides.length === slides.length && prev.slides.every(function (s, i) { return s === slides[i]; })) return prev;
    if (prev) teardown(host);

    var names = slides.map(function (s, i) { return typeof labels === 'function' ? labels(s, i) : labels[i]; });
    var nav = el('div', 'mm-nav mm-only');
    var tabs = el('div', 'mm-tabs'); tabs.setAttribute('role', 'tablist');
    var tabBtns = names.map(function (name, i) {
      var b = el('button', 'mm-tab', esc(name));
      b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('data-mm-i', String(i));
      return b;
    });
    tabBtns.forEach(function (b) { tabs.appendChild(b); });
    var count = el('span', 'mm-count', '');
    var prevBtn = el('button', 'mm-arrow', '‹'); prevBtn.type = 'button'; prevBtn.setAttribute('aria-label', '이전 카드');
    var nextBtn = el('button', 'mm-arrow', '›'); nextBtn.type = 'button'; nextBtn.setAttribute('aria-label', '다음 카드');
    nav.appendChild(prevBtn); nav.appendChild(tabs); nav.appendChild(count); nav.appendChild(nextBtn);
    host.parentNode.insertBefore(nav, host);

    host.classList.add('mm-deck');
    host.setAttribute('tabindex', '0');
    host.setAttribute('role', 'group');
    host.setAttribute('aria-roledescription', '카드 목록');
    if (opts.ariaLabel) host.setAttribute('aria-label', opts.ariaLabel);
    slides.forEach(function (s) { s.classList.add('mm-slide'); });

    var state = { slides: slides, nav: nav, current: 0 };
    function offsets() {
      var hostLeft = host.getBoundingClientRect().left;
      return slides.map(function (s) { return s.getBoundingClientRect().left - hostLeft + host.scrollLeft; });
    }
    function mark(i) {
      state.current = i;
      tabBtns.forEach(function (b, k) {
        var on = k === i;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      });
      count.textContent = (i + 1) + ' / ' + slides.length;
      prevBtn.disabled = i <= 0; nextBtn.disabled = i >= slides.length - 1;
      var active = tabBtns[i];
      if (active && tabs.scrollWidth > tabs.clientWidth) {
        var left = active.offsetLeft - (tabs.clientWidth - active.offsetWidth) / 2;
        if (tabs.scrollTo) tabs.scrollTo({ left: left, behavior: reduceMotion() ? 'auto' : 'smooth' });
      }
    }
    function go(i, fromUser) {
      i = Math.max(0, Math.min(slides.length - 1, i));
      var left = offsets()[i];
      if (host.scrollTo) host.scrollTo({ left: left, behavior: reduceMotion() ? 'auto' : 'smooth' });
      else host.scrollLeft = left;
      mark(i);
      if (fromUser && opts.onChange) opts.onChange(i, slides[i]);
    }
    var raf = 0;
    function onScroll() {
      if (raf) return;
      raf = global.requestAnimationFrame(function () {
        raf = 0;
        var i = nearestIndex(host.scrollLeft, offsets());
        if (i !== state.current) { mark(i); if (opts.onChange) opts.onChange(i, slides[i]); }
      });
    }
    host.addEventListener('scroll', onScroll, { passive: true });
    tabs.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('.mm-tab'); if (b) go(Number(b.getAttribute('data-mm-i')), true); });
    tabs.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      var i = state.current + (e.key === 'ArrowRight' ? 1 : -1);
      go(i, true);
      var b = tabBtns[Math.max(0, Math.min(slides.length - 1, i))]; if (b) b.focus();
    });
    prevBtn.addEventListener('click', function () { go(state.current - 1, true); });
    nextBtn.addEventListener('click', function () { go(state.current + 1, true); });
    host.addEventListener('keydown', function (e) {
      if (e.target !== host) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(state.current + 1, true); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(state.current - 1, true); }
    });
    state.go = go; state.mark = mark; state.onScroll = onScroll;
    host._mmDeck = state;
    mark(0);
    // 그리드→가로 배치로 바뀌면서 차트 폭이 달라지므로 한 번 알린다(기존 차트는 resize 이벤트로 다시 맞춘다)
    global.setTimeout(function () { global.dispatchEvent(new Event('resize')); }, 60);
    return state;
  }

  function teardown(host) {
    var d = host._mmDeck;
    if (!d) return;
    if (d.nav && d.nav.parentNode) d.nav.parentNode.removeChild(d.nav);
    host.removeEventListener('scroll', d.onScroll);
    host.classList.remove('mm-deck');
    host.removeAttribute('tabindex'); host.removeAttribute('role'); host.removeAttribute('aria-roledescription'); host.removeAttribute('aria-label');
    Array.prototype.forEach.call(host.children, function (c) { c.classList.remove('mm-slide'); });
    host._mmDeck = null;
  }

  /* ---------- 요약 카드(읽기 전용 복사본) ---------- */

  function cardHtml(c, i) {
    return '<button type="button" class="mm-card" data-mm-card="' + i + '"' + (c.id ? ' data-mm-id="' + esc(c.id) + '"' : '') + '>'
      + '<span class="mm-card-name">' + esc(c.name) + '</span>'
      + '<span class="mm-card-price ' + c.tone + '">' + esc(c.price) + '</span>'
      + '<span class="mm-card-chg ' + c.tone + '">' + esc(c.change) + (c.rate ? ' · ' + esc(c.rate) : '') + '</span></button>';
  }

  function renderCards(host, cards, onPick) {
    var html = cards.map(cardHtml).join('');
    if (host._mmHtml === html) return;
    host._mmHtml = html;
    host.innerHTML = html;
    if (!host._mmBound) {
      host._mmBound = true;
      host.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('.mm-card'); if (!b) return;
        if (host._mmPick) host._mmPick(Number(b.getAttribute('data-mm-card')), b);
      });
    }
    host._mmPick = onPick;
  }

  function ensureCardsHost(before, key) {
    var next = before.previousElementSibling;
    if (next && next.getAttribute && next.getAttribute('data-mm-cards') === key) return next;
    var host = el('div', 'mm-cards mm-only'); host.setAttribute('data-mm-cards', key);
    before.parentNode.insertBefore(host, before);
    return host;
  }

  /* ---------- 국내 시장지표(01 국내 주요 지수) ---------- */

  function enhanceDomestic(root) {
    var quotes = root.querySelector('.dmi-spot-quotes');
    var grid = root.querySelector('.dmi-chart-grid');
    var chartDeck = null;
    if (grid) chartDeck = ensureDeck(grid, '.dmi-panel', function (s) { return text(s.querySelector('.dmi-panel-title > span')) || '차트'; }, { ariaLabel: '지수 차트' });
    if (quotes) {
      var rows = quotes.querySelectorAll('tbody tr');
      if (rows.length) {
        var cards = Array.prototype.map.call(rows, function (tr) {
          var tds = tr.querySelectorAll('td');
          return { name: text(tr.querySelector('th')), price: text(tds[0]), change: text(tds[1]), rate: text(tds[2]), tone: toneOf(text(tds[1]) || text(tds[2])) };
        });
        var host = ensureCardsHost(quotes, 'dmi');
        renderCards(host, cards, function (i) { if (chartDeck) chartDeck.go(i, true); });
        quotes.classList.add('mm-has-cards');
      }
    }
  }

  /* 투자자별 매매동향: 최근 10거래일 표 두 장(KOSPI·KOSDAQ)을 스와이프로 */
  function enhanceFlowTables(root) {
    var grid = root.querySelector('.dmi-flow-grid');
    if (grid) ensureDeck(grid, '.dmi-flow-card', function (s) { return text(s.querySelector('.dmi-flow-title')) || '시장'; }, { ariaLabel: '시장별 투자자 순매수 표' });
  }

  /* 투자자 선택: 전체·외국인·기관·개인 - 기존 그래프 범례 버튼(ibd-leg-btn)을 대신 눌러 계열을 켜고 끈다 */
  var INV_KEYS = ['foreign', 'institution', 'individual'];
  function enhanceInvestorPick(root) {
    var legend = root.querySelector('.ifl [data-ic-legend]');
    if (!legend) return;
    var chartBox = legend.closest('.ibc') || legend.parentNode;
    var seg = root.querySelector('.mm-invpick');
    if (!seg) {
      seg = el('div', 'mm-invpick mm-only');
      seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', '투자자 선택');
      seg.innerHTML = [['all', '전체'], ['foreign', '외국인'], ['institution', '기관'], ['individual', '개인']].map(function (p) {
        return '<button type="button" class="mm-invbtn' + (p[0] === 'all' ? ' is-active' : '') + '" data-mm-inv="' + p[0] + '" aria-pressed="' + (p[0] === 'all') + '">' + p[1] + '</button>';
      }).join('');
      chartBox.parentNode.insertBefore(seg, chartBox);
      seg.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('.mm-invbtn'); if (!b) return;
        var want = b.getAttribute('data-mm-inv');
        seg._want = want;
        applyInvestorPick(root, want);
      });
    }
    if (seg._want && seg._want !== 'all') applyInvestorPick(root, seg._want); // 기간·시장을 바꿔 범례가 다시 그려지면 선택을 유지
  }
  function applyInvestorPick(root, want) {
    var seg = root.querySelector('.mm-invpick');
    INV_KEYS.forEach(function (key) {
      var legend = root.querySelector('.ifl [data-ic-legend]'); if (!legend) return;
      var btn = legend.querySelector('[data-ic-key="' + key + '"]'); if (!btn) return;
      var off = btn.classList.contains('is-off');
      var shouldShow = want === 'all' || want === key;
      if (off === shouldShow) btn.click(); // 클릭하면 범례가 다시 그려지므로 매번 새로 찾는다
    });
    if (seg) Array.prototype.forEach.call(seg.querySelectorAll('.mm-invbtn'), function (b) {
      var on = b.getAttribute('data-mm-inv') === want;
      b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /* 누적 표 3행을 카드로 보이게 하는 건 CSS(data-label)가 한다. */

  /* 종목별 순매수·순매도 상위: 4장을 스와이프, 표는 5개씩 */
  function enhanceRank(root) {
    var grid = root.querySelector('.dmi-rank-grid');
    if (!grid) return;
    var deck = ensureDeck(grid, '.dmi-rank-card', function (s) {
      var t = text(s.querySelector('h4')); return t.replace('순매수', '순매수 상위').replace('순매도', '순매도 상위');
    }, { ariaLabel: '종목별 순매수·순매도 상위' });
    Array.prototype.forEach.call(grid.querySelectorAll('.dmi-rank-card'), function (card) { paginate(card); });
    return deck;
  }

  function paginate(card) {
    var rows = card.querySelectorAll('tbody tr');
    if (rows.length <= PAGE_SIZE) return;
    var shown = card._mmShown || PAGE_SIZE;
    var st = pageState(rows.length, shown);
    Array.prototype.forEach.call(rows, function (tr, i) { tr.classList.toggle('mm-row-hidden', i >= st.visible); });
    var more = card.querySelector('.mm-more');
    if (!more) {
      more = el('button', 'mm-more mm-only', ''); more.type = 'button';
      card.appendChild(more);
      more.addEventListener('click', function () { card._mmShown = (card._mmShown || PAGE_SIZE) + PAGE_SIZE; paginate(card); });
    }
    more.hidden = !st.canMore;
    more.textContent = '더 보기 (' + st.remaining + '개)';
  }

  /* ---------- 글로벌 시장지표: 핵심 지수 카드 ---------- */

  var GLOBAL_PICK = [/나스닥\s*종합/, /S&P\s*500\s*지수/i, /다우존스/];
  function enhanceGlobal(root) {
    var board = root.querySelector('.ibd-table') || root.querySelector('table.ibd-table, .ibd table');
    if (!board) return;
    var rows = board.querySelectorAll('tr.ibd-row');
    if (!rows.length) return;
    var picked = [];
    GLOBAL_PICK.forEach(function (re) {
      Array.prototype.some.call(rows, function (tr) {
        if (!re.test(text(tr.querySelector('.ibd-nm')))) return false;
        var tds = tr.querySelectorAll('td');
        picked.push({ id: tr.getAttribute('data-id'), name: text(tr.querySelector('.ibd-nm')), price: text(tds[0]), change: text(tds[1]), rate: text(tds[2]), tone: toneOf(text(tds[1]) || text(tds[2])) });
        return true;
      });
    });
    if (!picked.length) return;
    var anchor = board.closest('.ibd') || board;
    var host = ensureCardsHost(anchor, 'global');
    renderCards(host, picked, function (i) {
      var tr = board.querySelector('tr.ibd-row[data-id="' + picked[i].id.replace(/"/g, '') + '"]');
      if (tr) tr.click();
    });
  }

  /* ---------- 증시온도 ---------- */

  var openKeys = {};
  function collapsible(list, key, label) {
    if (!list) return;
    var wrap = list.previousElementSibling;
    var btn = wrap && wrap.classList && wrap.classList.contains('mm-toggle') && wrap.getAttribute('data-mm-key') === key ? wrap : null;
    if (!btn) {
      btn = el('button', 'mm-toggle mm-only', ''); btn.type = 'button'; btn.setAttribute('data-mm-key', key);
      list.parentNode.insertBefore(btn, list);
      btn.addEventListener('click', function () {
        openKeys[key] = !openKeys[key];
        paintToggle(btn, btn.nextElementSibling, key, label);
      });
    }
    paintToggle(btn, list, key, label);
  }
  function paintToggle(btn, list, key, label) {
    var open = !!openKeys[key];
    list.classList.toggle('mm-collapsed', !open);
    btn.textContent = (open ? '접기 · ' : '펼치기 · ') + label;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function enhanceTemp(root) {
    var strip = root.querySelector('.mt-kpi-strip');
    if (strip) ensureDeck(strip, '.mt-kpi', function (s, i) {
      if (s.classList.contains('mt-kpi--temp')) return '증시온도';
      return text(s.querySelector('.mt-kpi-label')) || ('지표 ' + (i + 1));
    }, { ariaLabel: '시장 지표 요약' });
    collapsible(root.querySelector('.mt-tomorrow-card ul.mt-tm-why'), 'tm-why', '판단 근거');
    collapsible(root.querySelector('.mt-summary-card ul.mt-reason-list'), 'reason', '상승·하락 요인');
  }

  /* ---------- 연결 ---------- */

  var WATCH = [
    ['#domestic-market-indicators', [enhanceDomestic]],
    ['#domestic-investor-flow', [enhanceFlowTables, enhanceInvestorPick, enhanceRank]],
    ['#overnight-market', [enhanceGlobal]],
    ['#market-temp', [enhanceTemp]]
  ];

  var timer = 0;
  function run() {
    timer = 0;
    if (!isMobile()) return;
    WATCH.forEach(function (w) {
      var root = document.querySelector(w[0]);
      if (!root) return;
      w[1].forEach(function (fn) { try { fn(root); } catch (e) { /* 한 구역이 실패해도 나머지 화면은 기존 그대로 */ } });
    });
  }
  function schedule() { if (!timer) timer = global.setTimeout(run, 120); }

  function start() {
    run();
    if (global.MutationObserver) new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  }

  global.MobileMarket = { start: start, run: run, _calc: { nearestIndex: nearestIndex, pageState: pageState, toneOf: toneOf, PAGE_SIZE: PAGE_SIZE } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : this);
