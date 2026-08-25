/*
 * Dashboard presentation enhancements.
 *
 * This file is loaded by skin-main.js so the live Tistory skin does not need a
 * second manual script tag for every visual-only change. It is deliberately
 * dependency-free: page widgets are created asynchronously, so a small
 * MutationObserver wires them as soon as they appear.
 */
(function (global) {
  'use strict';

  var CUSTOM_CARDS_KEY = 'market_temp_custom_cards_v1';
  var ENHANCEMENT_VERSION = '20260826-dmi-layout-v1';
  var STYLE_HREF = 'https://goodbyestarwars.github.io/tistory-ticker/css/dashboard-enhancements.css?v=' + ENHANCEMENT_VERSION;
  var customCardsReady = false;
  var observer;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function readCards() {
    try {
      var value = JSON.parse(localStorage.getItem(CUSTOM_CARDS_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (err) { return []; }
  }

  function writeCards(cards) {
    try { localStorage.setItem(CUSTOM_CARDS_KEY, JSON.stringify(cards)); } catch (err) { /* no-op */ }
  }

  function loadStyle() {
    if (document.querySelector('link[data-dashboard-enhancements-style]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = STYLE_HREF;
    link.setAttribute('data-dashboard-enhancements-style', '1');
    document.head.appendChild(link);
  }

  function moveDrawingControlsBelowFullscreen(controlRow) {
    if (!controlRow || controlRow.getAttribute('data-de-draw-layout') === '1') return;
    var buttonSelectors = [
      '.ss-draw-toggle', '.ss-draw-clear',
      '.dmi-draw-toggle', '.dmi-draw-clear',
      '.kf-draw-toggle', '.kf-draw-clear'
    ];
    var buttons = [];
    buttonSelectors.forEach(function (selector) {
      var button = controlRow.querySelector(selector);
      if (button) buttons.push(button);
    });
    if (!buttons.length || !controlRow.parentNode) return;
    controlRow.setAttribute('data-de-draw-layout', '1');
    var drawRow = document.createElement('div');
    drawRow.className = 'de-draw-controls';
    drawRow.setAttribute('role', 'group');
    drawRow.setAttribute('aria-label', '차트 그리기 도구');
    controlRow.parentNode.insertBefore(drawRow, controlRow.nextSibling);
    buttons.forEach(function (button) { drawRow.appendChild(button); });
  }

  function customCardHtml(card) {
    return '<article class="de-custom-card" data-custom-card-id="' + escapeHtml(card.id) + '" style="--de-card-accent:' + escapeHtml(card.color) + '">' +
      '<div class="de-custom-card-heading"><span>' + escapeHtml(card.emoji || '📌') + '</span><strong>' + escapeHtml(card.title) + '</strong>' +
      '<button type="button" class="de-custom-edit" data-custom-action="edit" aria-label="카드 편집">편집</button>' +
      '<button type="button" class="de-custom-delete" data-custom-action="delete" aria-label="카드 삭제">삭제</button></div>' +
      '<p>' + escapeHtml(card.body).replace(/\n/g, '<br>') + '</p>' +
      '</article>';
  }

  function customIconOptions(selected) {
    var choices = [
      ['📌', '핀'], ['📈', '추세'], ['💰', '자금'], ['🛡️', '방어'],
      ['🔥', '이슈'], ['⭐', '관심'], ['📝', '메모'], ['🔎', '탐색']
    ];
    var known = choices.some(function (choice) { return choice[0] === selected; });
    if (!known && selected) choices.push([selected, '기존 아이콘']);
    return choices.map(function (choice) {
      return '<option value="' + escapeHtml(choice[0]) + '"' + (choice[0] === selected ? ' selected' : '') + '>' + escapeHtml(choice[0] + ' ' + choice[1]) + '</option>';
    }).join('');
  }

  function renderCustomCards(root) {
    var list = root.querySelector('.de-custom-list');
    if (!list) return;
    var cards = readCards();
    list.innerHTML = cards.length
      ? cards.map(customCardHtml).join('')
      : '<div class="de-custom-empty">아직 만든 카드가 없습니다. 관심 포인트를 직접 기록해 보세요.</div>';
  }

  function formHtml(card) {
    card = card || { id: '', title: '', body: '', emoji: '📌', color: '#315b43' };
    return '<div class="de-custom-editor" hidden>' +
      '<div class="de-custom-editor-title">내 카드 만들기</div>' +
      '<input class="de-custom-input" data-custom-field="title" maxlength="40" placeholder="카드 제목" value="' + escapeHtml(card.title) + '">' +
      '<textarea class="de-custom-input de-custom-textarea" data-custom-field="body" maxlength="500" placeholder="메모나 분석 기준을 적어보세요">' + escapeHtml(card.body) + '</textarea>' +
      '<div class="de-custom-editor-row"><label>아이콘 <select class="de-custom-icon" data-custom-field="emoji" aria-label="카드 아이콘">' + customIconOptions(card.emoji) + '</select></label>' +
      '<label>색상 <select class="de-custom-color" data-custom-field="color"><option value="#315b43">녹색</option><option value="#1261c4">파랑</option><option value="#d24f45">빨강</option><option value="#e08a3c">주황</option><option value="#7c5cdb">보라</option></select></label></div>' +
      '<div class="de-custom-editor-actions"><button type="button" data-custom-action="cancel">취소</button><button type="button" class="primary" data-custom-action="save">저장</button></div>' +
      '<input type="hidden" data-custom-field="id" value="' + escapeHtml(card.id) + '"></div>';
  }

  function openCustomEditor(root, card) {
    var editor = root.querySelector('.de-custom-editor');
    if (!editor) return;
    editor.outerHTML = formHtml(card);
    editor = root.querySelector('.de-custom-editor');
    editor.hidden = false;
    var color = editor.querySelector('[data-custom-field="color"]');
    if (color && card && card.color) color.value = card.color;
    var title = editor.querySelector('[data-custom-field="title"]');
    if (title) title.focus();
  }

  function wireCustomCards(root) {
    if (root.getAttribute('data-custom-cards-ready') === '1') return;
    root.setAttribute('data-custom-cards-ready', '1');
    var viewPanels = root.querySelector('.mt-view-panels');
    if (!viewPanels) return;
    var tools = document.createElement('div');
    tools.className = 'de-custom-card-tools';
    tools.innerHTML = '<div class="de-custom-card-toolbar"><div><strong>Custom Card</strong><span>내가 만드는 관심 메모</span></div><button type="button" class="de-custom-add" data-custom-action="new">＋ 내 카드 만들기</button></div>' +
      formHtml(null) + '<div class="de-custom-list"></div>';
    root.insertBefore(tools, viewPanels);
    renderCustomCards(tools);
    tools.addEventListener('click', function (event) {
      var actionButton = event.target.closest('[data-custom-action]');
      if (!actionButton) return;
      var action = actionButton.getAttribute('data-custom-action');
      var cardNode = actionButton.closest('[data-custom-card-id]');
      var cards = readCards();
      if (action === 'new') openCustomEditor(tools, null);
      if (action === 'cancel') {
        var editor = tools.querySelector('.de-custom-editor');
        if (editor) editor.hidden = true;
      }
      if (action === 'edit' && cardNode) {
        var card = cards.filter(function (item) { return item.id === cardNode.getAttribute('data-custom-card-id'); })[0];
        if (card) openCustomEditor(tools, card);
      }
      if (action === 'delete' && cardNode && global.confirm('이 카드를 삭제할까요?')) {
        writeCards(cards.filter(function (item) { return item.id !== cardNode.getAttribute('data-custom-card-id'); }));
        renderCustomCards(tools);
      }
      if (action === 'save') {
        var editor = tools.querySelector('.de-custom-editor');
        var title = editor.querySelector('[data-custom-field="title"]').value.trim();
        var body = editor.querySelector('[data-custom-field="body"]').value.trim();
        if (!title || !body) { global.alert('제목과 내용을 입력해 주세요.'); return; }
        var id = editor.querySelector('[data-custom-field="id"]').value || ('custom-' + Date.now());
        var next = { id: id, title: title, body: body,
          emoji: editor.querySelector('[data-custom-field="emoji"]').value.trim() || '📌',
          color: editor.querySelector('[data-custom-field="color"]').value };
        var found = false;
        cards = cards.map(function (item) { if (item.id !== id) return item; found = true; return next; });
        if (!found) cards.unshift(next);
        writeCards(cards);
        editor.hidden = true;
        renderCustomCards(tools);
      }
    });
  }

  function addExpandButton(target, title) {
    if (!target || target.getAttribute('data-de-expand-ready') === '1') return;
    target.setAttribute('data-de-expand-ready', '1');
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'de-expand-button';
    button.textContent = '⛶ 전체 화면';
    button.setAttribute('data-de-expand-title', title);
    button.addEventListener('click', function () { openChartModal(target, title); });
    var anchor = target.parentElement;
    var controlRow = null;
    var dmiPanel = target.closest ? target.closest('.dmi-panel') : null;
    var futuresSection = target.closest ? target.closest('.kf-section') : null;
    if (dmiPanel) {
      controlRow = dmiPanel.querySelector('.dmi-tabs');
    } else if (futuresSection) {
      controlRow = futuresSection.querySelector('.kf-interval-toggle');
    } else if (anchor && anchor.querySelector('.ss-chart-tabs')) {
      controlRow = anchor.querySelector('.ss-chart-tabs');
    } else if (anchor && anchor.querySelector('.ff-chart-toggles')) {
      controlRow = anchor.querySelector('.ff-chart-toggles');
    } else if (target.classList.contains('ff-apt-chart-wrap')) {
      controlRow = anchor && anchor.querySelector('.ff-extra-card-title');
    } else if (anchor && anchor.querySelector('.ff-extra-card-title')) {
      controlRow = anchor.querySelector('.ff-extra-card-title');
    }
    if (controlRow) {
      controlRow.classList.add('de-chart-control-row');
      button.classList.add('de-expand-inline');
      controlRow.appendChild(button);
      moveDrawingControlsBelowFullscreen(controlRow);
    } else if (anchor) {
      anchor.insertBefore(button, target);
    }
  }

  function openChartModal(target, title) {
    if (document.querySelector('.de-chart-overlay')) return;
    // Stock charts keep their toolbar (drawing/timeframe/studies) beside #ssChart.
    // Move that whole panel into the modal so returning from fullscreen cannot
    // strand the drawing controls outside the fullscreen chart.
    var modalTarget = target && target.id === 'ssChart' ? target.parentElement : target;
    if (!modalTarget) return;
    var chartTarget = modalTarget.querySelector ? modalTarget.querySelector('#ssChart') : null;
    var placeholder = document.createElement('div');
    placeholder.className = 'de-chart-placeholder';
    modalTarget.parentNode.insertBefore(placeholder, modalTarget);
    var overlay = document.createElement('div');
    overlay.className = 'de-chart-overlay';
    overlay.innerHTML = '<div class="de-chart-modal" role="dialog" aria-modal="true" aria-label="' + escapeHtml(title) + '"><div class="de-chart-modal-head"><strong>' + escapeHtml(title) + '</strong><button type="button" class="de-chart-close" aria-label="닫기">✕</button></div><div class="de-chart-modal-body"></div></div>';
    // 위젯 내부에 붙이면 부모의 폭/transform/overflow 규칙이 fixed 모달에
    // 전파되어 화면이 밀리거나 좌우가 잘릴 수 있다. 모달은 문서 최상위에 둔다.
    document.body.appendChild(overlay);
    var body = overlay.querySelector('.de-chart-modal-body');
    var oldStyle = modalTarget.getAttribute('style');
    var oldChartStyle = chartTarget ? chartTarget.getAttribute('style') : null;
    var flowRoot = modalTarget.closest ? modalTarget.closest('#foreign-flow') : null;
    var flowScope = null;
    var stockRoot = chartTarget && modalTarget.closest ? modalTarget.closest('#stock-search') : null;
    var stockScope = null;
    modalTarget.classList.add('de-modal-target');
    // 매물대 차트의 CSS는 원래 #foreign-flow 아래를 기준으로 범위를 좁혀 두었다.
    // 문서 최상위 모달로 옮길 때도 같은 스코프를 유지해야 SVG가 기본 검정색으로
    // 렌더링되지 않고 건물·배경·프로파일 색상을 그대로 사용한다.
    if (stockRoot) {
      // stock-search.css is intentionally scoped to #stock-search. Keep that
      // scope while the chart panel is temporarily moved to document.body.
      stockScope = document.createElement('div');
      stockScope.className = 'de-stock-search-scope';
      stockScope.id = 'stock-search';
      stockRoot.id = 'stock-search-original';
      body.appendChild(stockScope);
      stockScope.appendChild(modalTarget);
      // The modal body is a flex container. Give the temporary stock scope and
      // its chart panel an explicit full-width flex basis so the chart cannot
      // keep the old two-column grid's intrinsic width and leave a blank half.
      stockScope.style.width = '100%';
      stockScope.style.flex = '1 1 100%';
      stockScope.style.minWidth = '0';
      modalTarget.style.width = '100%';
      modalTarget.style.boxSizing = 'border-box';
    } else if (flowRoot && modalTarget.classList.contains('ff-apt-chart-wrap')) {
      flowScope = document.createElement('div');
      flowScope.className = 'de-foreign-flow-scope';
      flowScope.id = 'foreign-flow';
      flowRoot.id = 'foreign-flow-original';
      body.appendChild(flowScope);
      flowScope.appendChild(modalTarget);
    } else {
      body.appendChild(modalTarget);
    }
    if (chartTarget) {
      chartTarget.style.height = Math.max(720, Math.round(global.innerHeight * 0.88)) + 'px';
    } else if (modalTarget.id === 'ffLwChart' || modalTarget.classList.contains('kf-chart') || modalTarget.classList.contains('dmi-chart')) {
      modalTarget.style.height = Math.max(720, Math.round(global.innerHeight * 0.88)) + 'px';
    }
    function close() {
      if (!overlay.parentNode) return;
      placeholder.parentNode.insertBefore(modalTarget, placeholder);
      if (oldStyle == null) modalTarget.removeAttribute('style'); else modalTarget.setAttribute('style', oldStyle);
      if (chartTarget) {
        if (oldChartStyle == null) chartTarget.removeAttribute('style'); else chartTarget.setAttribute('style', oldChartStyle);
      }
      modalTarget.classList.remove('de-modal-target');
      if (flowScope) {
        flowScope.remove();
        flowRoot.id = 'foreign-flow';
      }
      if (stockScope) {
        stockScope.remove();
        stockRoot.id = 'stock-search';
      }
      placeholder.remove();
      overlay.remove();
      document.removeEventListener('keydown', onKeydown);
      requestAnimationFrame(function () {
        global.dispatchEvent(new Event('resize'));
        if (chartTarget) chartTarget.dispatchEvent(new Event('resize'));
        // Re-measure the chart after it has returned from the fullscreen modal.
        global.dispatchEvent(new Event('tistory-chart-resize'));
        requestAnimationFrame(function () {
          global.dispatchEvent(new Event('resize'));
          global.dispatchEvent(new Event('tistory-chart-resize'));
        });
      });
    }
    function onKeydown(event) { if (event.key === 'Escape') close(); }
    overlay.querySelector('.de-chart-close').addEventListener('click', close);
    overlay.addEventListener('click', function (event) { if (event.target === overlay) close(); });
    document.addEventListener('keydown', onKeydown);
    requestAnimationFrame(function () {
      global.dispatchEvent(new Event('resize'));
      // Lightweight Charts가 이동 후 새 컨테이너 폭을 다시 측정하도록 보정한다.
      if (modalTarget.clientWidth && modalTarget.clientHeight) {
        modalTarget.dispatchEvent(new Event('resize'));
      }
      global.dispatchEvent(new Event('tistory-chart-resize'));
    });
  }

  function wireCharts() {
    document.querySelectorAll('#foreign-flow .ff-flow-chart-card #ffLwChart').forEach(function (el) { addExpandButton(el, '종목분석 가격·거래량 차트'); });
    document.querySelectorAll('#foreign-flow .ff-apt-chart-wrap').forEach(function (el) { addExpandButton(el, '종목분석 매물대'); });
    document.querySelectorAll('#stock-search .ss-chart').forEach(function (el) { addExpandButton(el, '실시간 시세 차트'); });
    document.querySelectorAll('#kospi-futures .kf-chart').forEach(function (el) { addExpandButton(el, el.closest('.kf-section') ? el.closest('.kf-section').querySelector('.kf-section-title').textContent : '선물 차트'); });
    document.querySelectorAll('#domestic-market-indicators .dmi-chart').forEach(function (el) {
      var panel = el.closest('.dmi-panel');
      var title = panel && panel.querySelector('.dmi-panel-title span') ? panel.querySelector('.dmi-panel-title span').textContent : '국내시장지표 차트';
      addExpandButton(el, title);
    });
  }

  function scan() {
    loadStyle();
    var market = document.querySelector('#market-temp .mt-explore-card');
    // 종목 편집은 market-temp의 계정별 카테고리 편집기로 통합한다.
    // 예전 로컬 메모 카드(Custom Card)는 종목과 연결되지 않아 더 이상 화면에 노출하지 않는다.
    wireCharts();
  }

  // 2026-08-21 코드 감사: order-book.js(2초 폴링 후 innerHTML 재작성) 등 실시간 위젯이
  // 자주 DOM을 갈아끼우는데, 그때마다 이 콜백이 발동해 wireCharts()의 무거운 5중
  // document.querySelectorAll을 매번 다시 실행했다 - 한 번의 innerHTML 교체가 여러
  // childList mutation을 한꺼번에 만들어내는 걸 감안해, requestAnimationFrame으로
  // 짧은 시간 안의 다수 mutation을 프레임당 최대 1회 scan()으로 코얼레싱한다.
  var scanRafPending = false;
  function scheduleScan() {
    if (scanRafPending) return;
    scanRafPending = true;
    global.requestAnimationFrame(function () {
      scanRafPending = false;
      scan();
    });
  }

  function init() {
    scan();
    observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, { childList: true, subtree: true });
    global.setTimeout(scan, 1200);
    global.setTimeout(scan, 3000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
