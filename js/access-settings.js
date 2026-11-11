/**
 * 관리자 화면별 ON/OFF 설정 (2026-11-11).
 * 서버(Oracle /access-policy)에만 저장하고, 서버가 확인한 Google 관리자 세션만 변경할 수 있다.
 * 이 설정은 '화면 표시' 정책이다. 공개 범위(비로그인 4개 화면)를 넓히지 못하며 증권사 시세 이용허가와 별개다.
 * 홈 개인 위젯 숨김(js/home-widgets.js, localStorage)과는 독립이다.
 */
(function (global) {
  'use strict';
  if (global.NineAccessSettings) return;
  var doc = global.document;
  var URL_ = 'https://goodbyestar.cloud/access-policy';
  var modal = null;

  var CSS =
    '.acs-backdrop{position:fixed;inset:0;z-index:2000;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:16px}' +
    '.acs-dialog{width:min(440px,100%);max-height:calc(100vh - 32px);overflow:auto;background:var(--ui-inner-surface,#fff);color:var(--ui-ink,#1f2937);' +
    'border:1px solid var(--ui-border,#e5e7eb);border-radius:14px;padding:20px}' +
    'html.dark .acs-dialog{background:var(--dk-surface,#242424);color:var(--dk-text,#eee);border-color:var(--dk-border,#3a3a3a)}' +
    '.acs-dialog h2{margin:0 0 4px;font-size:18px;font-weight:700}' +
    '.acs-note{margin:0 0 14px;font-size:12.5px;line-height:1.5;color:var(--ui-muted,#6b7280)}' +
    '.acs-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid var(--ui-border,#e5e7eb)}' +
    '.acs-label{font-size:14px;min-width:0}.acs-tag{display:block;font-size:11.5px;color:var(--ui-muted,#6b7280)}' +
    '.acs-row input{width:20px;height:20px;flex:none}' +
    '.acs-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:14px}' +
    '.acs-msg{font-size:12.5px;color:var(--ui-muted,#6b7280)}' +
    '.acs-btn{border:1px solid var(--ui-border,#d1d5db);background:transparent;color:inherit;border-radius:8px;padding:8px 14px;font:inherit;font-size:13px;cursor:pointer}' +
    '.acs-btn.primary{font-weight:700}';

  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function msg(text) { var m = modal && modal.querySelector('.acs-msg'); if (m) m.textContent = text; }

  function render(data) {
    var rows = Object.keys(data.screens).map(function (key) {
      var s = data.screens[key];
      return '<label class="acs-row"><span class="acs-label">' + esc(s.label) +
        '<span class="acs-tag">' + (s.public ? '비로그인 공개 화면' : '관리자 전용') + (s.locked ? ' · 항상 켜짐' : '') + '</span></span>' +
        '<input type="checkbox" data-key="' + esc(key) + '"' + (s.enabled ? ' checked' : '') + (s.locked ? ' disabled' : '') + '></label>';
    }).join('');
    modal.querySelector('.acs-body').innerHTML = rows;
  }

  function load() {
    msg('불러오는 중…');
    return global.fetch(URL_, { credentials: 'include', cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (b) {
        if (!b.data || !b.data.isAdmin) throw new Error('admin');
        render(b.data); msg('');
      })
      .catch(function () { msg('관리자 로그인 상태를 확인할 수 없습니다.'); });
  }

  function save() {
    var changes = {};
    Array.prototype.forEach.call(modal.querySelectorAll('input[data-key]:not(:disabled)'), function (i) {
      changes[i.getAttribute('data-key')] = i.checked;
    });
    msg('저장 중…');
    return global.fetch(URL_, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ screens: changes }) })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (b) {
        render(b.data); msg('저장했습니다. 모든 접속자에게 적용됩니다.');
        if (global.NineAccess) global.NineAccess.refresh().then(function () { global.dispatchEvent(new CustomEvent('nineaccess:change', { detail: { admin: true } })); });
      })
      .catch(function () { msg('저장에 실패해 이전 설정이 유지됩니다.'); load(); });
  }

  function close() { if (modal) { modal.remove(); modal = null; } }

  function open() {
    if (modal) return;
    if (!doc.getElementById('nine-access-settings-css')) {
      var st = doc.createElement('style'); st.id = 'nine-access-settings-css'; st.textContent = CSS; doc.head.appendChild(st);
    }
    modal = doc.createElement('div');
    modal.className = 'acs-backdrop';
    modal.innerHTML = '<section class="acs-dialog" role="dialog" aria-modal="true" aria-label="화면 설정">' +
      '<h2>화면 설정</h2><p class="acs-note">끄면 해당 화면의 메뉴와 직접 주소 접근이 모두 막힙니다. 비로그인 공개 범위는 이 설정으로 넓힐 수 없습니다.</p>' +
      '<div class="acs-body"></div><div class="acs-foot"><span class="acs-msg" aria-live="polite"></span>' +
      '<span><button type="button" class="acs-btn" data-acs="close">닫기</button> <button type="button" class="acs-btn primary" data-acs="save">저장</button></span></div></section>';
    doc.body.appendChild(modal);
    modal.addEventListener('click', function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-acs');
      if (a === 'close' || e.target === modal) close();
      else if (a === 'save') save();
    });
    doc.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { close(); doc.removeEventListener('keydown', onKey); } });
    load();
  }

  global.NineAccessSettings = { open: open, close: close };
})(window);
