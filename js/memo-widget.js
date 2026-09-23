/**
 * 메모 위젯 - 사이트 전역 플로팅 버튼.
 *
 * 2026-09-23 사용자 요청: "메모 기능 있으면 좋겠는데, DB는 직접 쓰지말고, 티스토리꺼
 * 쓰고, 메모는 브라우저에 최소화 시킬 수 있고, 필요할 때 펼쳐 보이게 가능한가?" -
 * 확인 결과 "티스토리꺼"는 새 저장소를 새로 만들지 말고 이미 있는 구글 로그인
 * (js/watchlist.js와 같은 `/auth/google/*`, VM DB)을 그대로 재사용하라는 뜻이었다.
 * 종목별 메모(상세 페이지 URL의 ?code=&name=을 읽어 연결)와 자유 메모 둘 다 지원한다.
 * 기본은 최소화(플로팅 버튼만), 클릭하면 패널이 펼쳐진다.
 */
(function (global) {
  'use strict';

  var API_BASE_URL = 'https://goodbyestar.cloud';
  var GOOGLE_AUTH_ME_URL = API_BASE_URL + '/auth/google/me';
  var GOOGLE_AUTH_START_URL = API_BASE_URL + '/auth/google/start';
  var MEMO_URL = API_BASE_URL + '/memo';
  var MAX_BODY_LENGTH = 2000;

  var state = {
    loaded: false,
    loading: false,
    authenticated: null,
    items: [],
    revision: 0,
  };
  var panel = null;
  var fab = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function currentStockContext() {
    var params = new URLSearchParams(global.location.search || '');
    var code = (params.get('code') || '').trim();
    var name = (params.get('name') || '').trim();
    if (!code) return null;
    return { code: code.toUpperCase(), name: name || code };
  }

  function makeId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
    return 'memo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  }

  function relativeTime(iso) {
    var then = new Date(iso).getTime();
    if (!isFinite(then)) return '';
    var diffMin = Math.round((Date.now() - then) / 60000);
    if (diffMin < 1) return '방금';
    if (diffMin < 60) return diffMin + '분 전';
    var diffHour = Math.round(diffMin / 60);
    if (diffHour < 24) return diffHour + '시간 전';
    var diffDay = Math.round(diffHour / 24);
    if (diffDay < 7) return diffDay + '일 전';
    var date = new Date(then);
    return (date.getMonth() + 1) + '.' + date.getDate();
  }

  function buildFab() {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'memo-fab';
    button.id = 'memoFab';
    button.setAttribute('aria-label', '메모');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 20h9" stroke-width="2" stroke-linecap="round"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>'
      + '<span class="memo-fab-badge" id="memoFabBadge" hidden></span>';
    return button;
  }

  function buildPanel() {
    var wrap = document.createElement('div');
    wrap.className = 'memo-panel';
    wrap.id = 'memoPanel';
    wrap.hidden = true;
    wrap.innerHTML = '<div class="memo-panel-head" id="memoPanelHead"><strong>메모</strong><span class="memo-drag-hint" aria-hidden="true">이동</span>'
      + '<button type="button" class="memo-panel-close" id="memoPanelClose" aria-label="닫기">×</button></div>'
      + '<div class="memo-panel-body" id="memoPanelBody"><div class="memo-loading">불러오는 중...</div></div>';
    return wrap;
  }

  function renderLoginGate() {
    var body = panel.querySelector('#memoPanelBody');
    body.innerHTML = '<div class="memo-login-gate"><p>메모는 Google 계정에 저장됩니다.</p>'
      + '<button type="button" class="memo-login-btn">Google로 로그인</button></div>';
    body.querySelector('.memo-login-btn').addEventListener('click', function () {
      var returnTo = encodeURIComponent(global.location.href);
      global.location.href = GOOGLE_AUTH_START_URL + '?return_to=' + returnTo;
    });
  }

  function composerHtml() {
    var ctx = currentStockContext();
    var chip = ctx
      ? '<label class="memo-context-chip"><input type="checkbox" id="memoAttachStock" checked />'
        + '<span>이 종목(' + escapeHtml(ctx.name) + ')에 연결</span></label>'
      : '';
    return '<div class="memo-composer">'
      + chip
      + '<textarea id="memoInput" class="memo-input" maxlength="' + MAX_BODY_LENGTH + '" placeholder="메모를 입력하세요"></textarea>'
      + '<button type="button" class="memo-add-btn" id="memoAddBtn">추가</button>'
      + '</div>';
  }

  function itemRowHtml(item) {
    var tag = item.code ? '<span class="memo-item-tag">' + escapeHtml(item.name || item.code) + '</span>' : '';
    return '<li class="memo-item" data-memo-id="' + escapeHtml(item.id) + '">'
      + '<div class="memo-item-head">' + tag + '<time>' + escapeHtml(relativeTime(item.updatedAt || item.createdAt)) + '</time>'
      + '<button type="button" class="memo-item-delete" data-memo-delete="' + escapeHtml(item.id) + '" aria-label="메모 삭제">×</button></div>'
      + '<p class="memo-item-body">' + escapeHtml(item.body) + '</p>'
      + '</li>';
  }

  function renderPanel() {
    var body = panel.querySelector('#memoPanelBody');
    var sorted = state.items.slice().sort(function (a, b) {
      return (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '');
    });
    var list = sorted.length
      ? '<ul class="memo-list">' + sorted.map(itemRowHtml).join('') + '</ul>'
      : '<p class="memo-empty">아직 메모가 없습니다.</p>';
    body.innerHTML = composerHtml() + list;
    wirePanelEvents(body);
    updateBadge();
  }

  function updateBadge() {
    var badge = document.getElementById('memoFabBadge');
    if (!badge) return;
    if (state.items.length) {
      badge.textContent = state.items.length > 99 ? '99+' : String(state.items.length);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  function showError(message) {
    var body = panel.querySelector('#memoPanelBody');
    var note = document.createElement('p');
    note.className = 'memo-error';
    note.textContent = message;
    body.insertBefore(note, body.firstChild);
  }

  function saveItems(nextItems) {
    var payload = { items: nextItems, revision: state.revision };
    return fetch(MEMO_URL, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (response) {
      if (response.status === 409) throw new Error('CONFLICT');
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    }).then(function (body) {
      var data = body && body.data ? body.data : body;
      state.items = data.items || nextItems;
      state.revision = data.revision || state.revision;
      renderPanel();
    });
  }

  function wirePanelEvents(body) {
    var addBtn = body.querySelector('#memoAddBtn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        var input = body.querySelector('#memoInput');
        var text = (input.value || '').trim();
        if (!text) return;
        var attachEl = body.querySelector('#memoAttachStock');
        var ctx = currentStockContext();
        var attach = attachEl ? attachEl.checked : false;
        var now = new Date().toISOString();
        var item = {
          id: makeId(),
          code: attach && ctx ? ctx.code : null,
          name: attach && ctx ? ctx.name : null,
          body: text,
          createdAt: now,
          updatedAt: now,
        };
        addBtn.disabled = true;
        saveItems(state.items.concat([item]))
          .catch(function (err) { handleSaveError(err); })
          .then(function () { addBtn.disabled = false; });
      });
    }
    var deleteButtons = body.querySelectorAll('[data-memo-delete]');
    for (var i = 0; i < deleteButtons.length; i++) {
      deleteButtons[i].addEventListener('click', function (event) {
        var id = event.currentTarget.getAttribute('data-memo-delete');
        var next = state.items.filter(function (it) { return it.id !== id; });
        saveItems(next).catch(function (err) { handleSaveError(err); });
      });
    }
  }

  function handleSaveError(err) {
    if (err && err.message === 'CONFLICT') {
      loadMemos(true);
      showError('다른 곳에서 방금 메모를 바꿨어요. 새로고침했습니다.');
    } else {
      showError('저장에 실패했어요. 잠시 후 다시 시도해주세요.');
    }
  }

  function loadMemos(force) {
    if (state.loading) return;
    if (state.loaded && !force) { renderPanel(); return; }
    state.loading = true;
    fetch(GOOGLE_AUTH_ME_URL, { credentials: 'include', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (body) {
        var auth = body && body.data ? body.data : { authenticated: false };
        state.authenticated = !!(auth.configured && auth.authenticated);
        if (!state.authenticated) { renderLoginGate(); return null; }
        return fetch(MEMO_URL, { credentials: 'include', cache: 'no-store' })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (body2) {
            var data = body2 && body2.data ? body2.data : body2;
            state.items = data.items || [];
            state.revision = data.revision || 0;
            state.loaded = true;
            renderPanel();
          });
      })
      .catch(function () { showError('메모를 불러오지 못했어요.'); })
      .then(function () { state.loading = false; });
  }

  function togglePanel(open) {
    var willOpen = open != null ? open : panel.hidden;
    panel.hidden = !willOpen;
    fab.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    if (willOpen) loadMemos(false);
  }

  // 2026-09-23 사용자 리포트("X 누르면 최소화가 안되고 반응이 없어") - 실제 결함은
  // 로직이 아니라 닫기 버튼의 실제 터치 영역이 너무 작아(19x22px, iOS 권장 44px에 한참
  // 못 미침) 손가락으로 정확히 못 눌렀을 가능성이 컸다(elementFromPoint로 직접 확인해보니
  // .click() 자체는 정상 동작). 버튼 히트 영역을 키우는 것과 별개로, 패널 바깥을
  // 눌러도 닫히게 하고 Esc로도 닫히게 해서 좁은 버튼 하나에만 의존하지 않게 한다.
  function wireOutsideClose() {
    document.addEventListener('pointerdown', function (event) {
      if (panel.hidden) return;
      if (panel.contains(event.target) || fab.contains(event.target)) return;
      togglePanel(false);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !panel.hidden) togglePanel(false);
    });
  }

  // 2026-09-23 사용자 요청("화면에서 자유롭게 움직이고") - 패널 헤드뿐 아니라
  // 최소화 상태의 연필 버튼(FAB)도 드래그로 옮길 수 있어야 한다는 재지적("연필모양이
  // 안움직이는데??") - 최소화됐을 때 보이는 건 FAB 하나뿐이니 그것부터 움직여야
  // "자유롭게 움직인다"는 요청이 성립한다. 옮긴 위치는 각각 localStorage에 남겨
  // 이 브라우저에서는 다음에 열 때도 같은 자리에서 시작한다(개인 편의용).
  var PANEL_POS_KEY = 'memo_widget_pos_v1';
  var FAB_POS_KEY = 'memo_fab_pos_v1';
  var DRAG_THRESHOLD_PX = 6;

  function readSavedPos(key) {
    try {
      var raw = JSON.parse(localStorage.getItem(key) || 'null');
      if (raw && isFinite(raw.left) && isFinite(raw.top)) return raw;
    } catch (err) { /* no-op */ }
    return null;
  }

  function applyPos(el, left, top) {
    // 뷰포트 크기가 아직 0으로 보고되는 아주 드문 타이밍(예: 초기 렌더 전)에는 클램프를
    // 건너뛴다 - 그대로 진행하면 위치가 (4,4)로 뭉개지고 그 값이 localStorage에 그대로
    // 저장돼 다음 방문에도 계속 구석에 박히는 문제가 생긴다.
    var vw = window.innerWidth || document.documentElement.clientWidth || 0;
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    left = Math.max(4, left);
    top = Math.max(4, top);
    if (vw > 0) left = Math.min(left, Math.max(4, vw - el.offsetWidth - 4));
    if (vh > 0) top = Math.min(top, Math.max(4, vh - el.offsetHeight - 4));
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    return { left: left, top: top };
  }

  // handle: 드래그를 시작하는 요소(패널의 헤드, FAB 자신). target: 실제로 움직일 요소
  // (패널 헤드는 패널 전체를, FAB는 자기 자신을 움직인다). 실제로 옮겨진 드래그였으면
  // handle에 잠깐 justDragged 표시를 남긴다 - FAB처럼 같은 요소가 "탭하면 열기"도 같이
  // 해야 하는 경우, 뒤이어 브라우저가 자동으로 발생시키는 click을 그 표시로 걸러낸다
  // (그래야 드래그 직후에 패널이 같이 열려버리지 않는다). 키보드 Enter/Space 활성화는
  // pointerdown 없이 곧장 click만 오므로 justDragged가 없어 정상적으로 열린다.
  function wireDrag(handle, target, storageKey) {
    var dragging = false;
    var moved = false;
    var startX = 0;
    var startY = 0;
    var startLeft = 0;
    var startTop = 0;
    handle.addEventListener('pointerdown', function (event) {
      if (event.target.closest('.memo-panel-close')) return;
      dragging = true;
      moved = false;
      var rect = target.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      startX = event.clientX;
      startY = event.clientY;
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('is-dragging');
    });
    handle.addEventListener('pointermove', function (event) {
      if (!dragging) return;
      var dx = event.clientX - startX;
      var dy = event.clientY - startY;
      if (!moved && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      moved = true;
      applyPos(target, startLeft + dx, startTop + dy);
    });
    function stopDrag(event) {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('is-dragging');
      try { handle.releasePointerCapture(event.pointerId); } catch (err) { /* no-op */ }
      if (moved) {
        var pos = { left: parseFloat(target.style.left) || 0, top: parseFloat(target.style.top) || 0 };
        try { localStorage.setItem(storageKey, JSON.stringify(pos)); } catch (err) { /* no-op */ }
        handle.dataset.justDragged = '1';
        setTimeout(function () { delete handle.dataset.justDragged; }, 0);
      }
    }
    handle.addEventListener('pointerup', stopDrag);
    handle.addEventListener('pointercancel', stopDrag);
  }

  function init() {
    if (document.getElementById('memoFab')) return;
    fab = buildFab();
    panel = buildPanel();
    document.body.appendChild(panel);
    document.body.appendChild(fab);

    var panelPositioned = false;
    function openPanel() {
      togglePanel();
      // 패널이 hidden인 동안은 offsetWidth/Height가 0이라 클램프 계산이 틀린다 -
      // 처음 펼쳐질 때(hidden이 풀린 뒤) 저장된 위치가 있으면 한 번만 적용한다.
      if (!panelPositioned && !panel.hidden) {
        panelPositioned = true;
        var savedPanel = readSavedPos(PANEL_POS_KEY);
        if (savedPanel) applyPos(panel, savedPanel.left, savedPanel.top);
      }
    }

    panel.querySelector('#memoPanelClose').addEventListener('click', function () { togglePanel(false); });
    wireDrag(panel.querySelector('#memoPanelHead'), panel, PANEL_POS_KEY);
    wireDrag(fab, fab, FAB_POS_KEY);
    fab.addEventListener('click', function () {
      if (fab.dataset.justDragged) return;
      openPanel();
    });
    wireOutsideClose();

    var savedFab = readSavedPos(FAB_POS_KEY);
    if (savedFab) applyPos(fab, savedFab.left, savedFab.top);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
