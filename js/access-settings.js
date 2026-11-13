/**
 * 관리자 역할별(비회원·일반회원·관리자) 화면 설정 (2026-11-12).
 * 서버(Oracle /access-policy)에만 저장하고, 서버가 확인한 Google 관리자 세션만 변경할 수 있다.
 * 서버가 정한 최대 공개 등급은 넓히지 않으며 시세 재제공/주문 권한과 별개다.
 * 홈 개인 위젯 숨김(js/home-widgets.js, localStorage)과는 독립이다.
 */
(function (global) {
  'use strict';
  if (global.NineAccessSettings) return;
  var doc = global.document;
  var URL_ = 'https://goodbyestar.cloud/access-policy';
  var modal = null;
  var memberBusy = false;

  function memberRequest(body) {
    return global.NineHttp.json(URL_ + '/members', { private: true, retries: 0, fetchOptions: {
      method: body ? 'PUT' : 'GET', credentials: 'include', cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined } })
      .then(function (b) { if (!b.data || !Array.isArray(b.data.emails)) throw new Error('members'); return b.data; });
  }
  function renderMembers(data) {
    if (!modal) return;
    modal.querySelector('.acs-members-list').innerHTML = data.emails.length ? data.emails.map(function (email) {
      return '<p style="display:flex;gap:8px;align-items:center;justify-content:space-between;overflow-wrap:anywhere"><span>' + esc(email) +
        '</span><button type="button" class="acs-btn" data-member-remove="' + esc(email) + '">해제</button></p>';
    }).join('') : '<p>등록된 일반회원이 없습니다.</p>';
    modal.querySelector('.acs-member-status').textContent = data.emails.length + '명 등록 · 최근 변경 ' + data.revision + '회';
  }
  function loadMembers() {
    return memberRequest().then(renderMembers).catch(function () {
      if (modal) modal.querySelector('.acs-member-status').textContent = '회원 목록을 불러오지 못했습니다. 다시 열어 확인해 주세요.';
    });
  }
  function changeMember(action, email) {
    if (memberBusy || !modal) return;
    var form = modal.querySelector('.acs-member-form');
    if (action === 'add' && !form.reportValidity()) return;
    email = String(email || '').trim().toLowerCase();
    memberBusy = true;
    modal.querySelectorAll('[data-member-remove],.acs-member-form button').forEach(function (b) { b.disabled = true; });
    modal.querySelector('.acs-member-status').textContent = '저장 중…';
    return memberRequest({ action: action, email: email }).then(function (data) {
      renderMembers(data);
      if (modal && action === 'add') form.reset();
    }).catch(function () {
      if (modal) modal.querySelector('.acs-member-status').textContent = '저장 실패: 이메일·관리자 로그인을 확인한 뒤 다시 열어 목록을 확인해 주세요.';
    }).finally(function () {
      memberBusy = false;
      if (modal) modal.querySelectorAll('[data-member-remove],.acs-member-form button').forEach(function (b) { b.disabled = false; });
    });
  }

  var CSS =
    '.acs-backdrop{position:fixed;inset:0;z-index:2000;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:16px}' +
    '.acs-dialog{width:min(640px,100%);max-height:calc(100vh - 32px);overflow:auto;background:var(--ui-inner-surface,#fff);color:var(--ui-ink,#1f2937);' +
    'border:1px solid var(--ui-border,#e5e7eb);border-radius:14px;padding:20px}' +
    'html.dark .acs-dialog{background:var(--dk-surface,#242424);color:var(--dk-text,#eee);border-color:var(--dk-border,#3a3a3a)}' +
    '.acs-dialog h2{margin:0 0 4px;font-size:18px;font-weight:700}' +
    '.acs-note,.acs-member-status,.acs-members-list p{font-size:12.5px;line-height:1.5}' +
    '.acs-note{margin:0 0 14px;color:var(--ui-muted,#6b7280)}' +
    '.acs-head,.acs-row{display:grid;grid-template-columns:minmax(0,1fr) repeat(3,62px);gap:4px;align-items:center}' +
    '.acs-head{font-size:12px;font-weight:700;color:var(--ui-muted,#6b7280);padding:8px 0}' +
    '.acs-head span:not(:first-child){text-align:center}' +
    '.acs-row{padding:9px 0;border-top:1px solid var(--ui-border,#e5e7eb)}' +
    '.acs-label{font-size:13px;min-width:0;overflow-wrap:anywhere}.acs-tag{display:block;font-size:11px;color:var(--ui-muted,#6b7280)}' +
    '.acs-cell{display:flex;justify-content:center;align-items:center}.acs-na{color:var(--ui-muted,#6b7280);font-size:13px}' +
    '.acs-row input{width:19px;height:19px;flex:none;cursor:pointer;accent-color:var(--ui-primary,#1677ff)}' +
    '.acs-row input:disabled{cursor:default}' +
    '@media(max-width:480px){.acs-dialog{padding:14px}.acs-head,.acs-row{grid-template-columns:minmax(0,1fr) repeat(3,48px)}}' +
    '.acs-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:14px}' +
    '.acs-msg{font-size:12.5px;color:var(--ui-muted,#6b7280)}' +
    '.acs-btn{border:1px solid var(--ui-border,#d1d5db);background:transparent;color:inherit;border-radius:8px;padding:8px 14px;font:inherit;font-size:13px;cursor:pointer}' +
    '.acs-btn.primary{font-weight:700}.acs-btn:disabled{opacity:.5;cursor:default}';

  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function msg(text) { var m = modal && modal.querySelector('.acs-msg'); if (m) m.textContent = text; }

  var roleReady = false;
  var ROLES = [{key: 'guest', label: '비회원'}, {key: 'member', label: '일반회원'}, {key: 'admin', label: '관리자'}];

  function render(data) {
    var keys = Object.keys(data.screens || {});
    roleReady = !!keys.length && keys.every(function (key) { return !!data.screens[key].roles; });
    var head = '<div class="acs-head"><span>화면</span>' +
      ROLES.map(function (role) { return '<span>' + role.label + '</span>'; }).join('') + '</div>';
    var rows = keys.map(function (key) {
      var s = data.screens[key], level = s.level || (s.public ? 'public' : 'admin');
      var cells = ROLES.map(function (role) {
        var permitted = role.key === 'admin' || (role.key === 'member' && level !== 'admin') ||
          (role.key === 'guest' && level === 'public');
        if (!permitted) return '<span class="acs-cell acs-na" title="서버 정책상 공개 불가">—</span>';
        var checked = s.roles ? !!s.roles[role.key] : !!s.enabled;
        var disabled = !!s.locked || !roleReady;
        return '<span class="acs-cell"><input type="checkbox" data-key="' + esc(key) + '" data-role="' + role.key +
          '" aria-label="' + esc(s.label + ' ' + role.label) + '"' + (checked ? ' checked' : '') +
          (disabled ? ' disabled' : '') + '></span>';
      }).join('');
      var desc = level === 'public' ? '공개 가능' : level === 'member' ? '로그인 회원 이상' : '관리자 전용';
      return '<div class="acs-row"><span class="acs-label">' + esc(s.label) +
        '<span class="acs-tag">' + desc + (s.locked ? ' · 필수 화면' : '') + '</span></span>' + cells + '</div>';
    }).join('');
    modal.querySelector('.acs-body').innerHTML = head + rows;
    var saveButton = modal.querySelector('[data-acs="save"]');
    if (saveButton) saveButton.disabled = !roleReady;
    return roleReady;
  }

  function load() {
    msg('불러오는 중…');
    return global.fetch(URL_, { credentials: 'include', cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (b) {
        if (!b.data || !b.data.isAdmin) throw new Error('admin');
        msg(render(b.data) ? '' : '서버 역할별 설정 업데이트 후 사용할 수 있습니다.');
        loadMembers();
      })
      .catch(function () { msg('관리자 로그인 상태를 확인할 수 없습니다.'); });
  }

  function save() {
    if (!roleReady) { msg('서버 역할별 설정 업데이트 후 사용할 수 있습니다.'); return; }
    var roles = {};
    Array.prototype.forEach.call(modal.querySelectorAll('input[data-role]:not(:disabled)'), function (i) {
      var key = i.getAttribute('data-key');
      if (!roles[key]) roles[key] = {};
      roles[key][i.getAttribute('data-role')] = i.checked;
    });
    msg('저장 중…');
    return global.fetch(URL_, { method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roles: roles }) })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (b) {
        if (!b.data || !b.data.isAdmin) throw new Error('admin');
        render(b.data); msg('역할별 설정을 저장했습니다.');
        if (global.NineAccess) global.NineAccess.refresh().then(function () {
          global.dispatchEvent(new CustomEvent('nineaccess:change', { detail: { admin: true } }));
        });
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
      '<h2>화면 설정</h2><p class="acs-note">일반회원 확대 권한은 아래에 등록한 Google 인증 계정에만 적용됩니다. 검색기·전략검색, 자동매매·KIS·관리 설정은 관리자 전용입니다. 제한 시세 REST·실시간 연결은 계속 관리자 전용이므로 일부 시세·차트는 표시되지 않습니다. — 표시는 공개 불가, 회색 체크는 필수 화면입니다.</p>' +
      '<div class="acs-body"></div><section style="margin-top:24px;border-top:1px solid var(--ui-border);padding-top:16px"><h2>일반회원 이메일 관리</h2><p class="acs-note">Google 로그인으로 소유를 검증한 이메일만 권한을 받습니다. 기존 로그인은 재로그인이 필요할 수 있습니다. 대소문자·앞뒤 공백은 통합하며, 해제는 다음 서버 권한 조회부터 적용됩니다. 화면 설정 저장과 별도로 즉시 저장됩니다.</p>' +
      '<form class="acs-member-form" style="display:flex;flex-wrap:wrap;gap:8px"><input type="email" required maxlength="254" aria-label="일반회원 이메일" placeholder="name@example.com" style="flex:1;min-width:160px;padding:8px;font:inherit;background:var(--ui-inner-surface);color:inherit;border:1px solid var(--ui-border)"><button class="acs-btn" type="submit">등록</button></form><p class="acs-member-status" aria-live="polite"></p><div class="acs-members-list"></div></section>' +
      '<div class="acs-foot"><span class="acs-msg" aria-live="polite"></span>' +
      '<span><button type="button" class="acs-btn" data-acs="close">닫기</button> <button type="button" class="acs-btn primary" data-acs="save">저장</button></span></div></section>';
    doc.body.appendChild(modal);
    modal.addEventListener('click', function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-acs');
      if (a === 'close' || e.target === modal) close();
      else if (a === 'save') save();
      var email = e.target.getAttribute && e.target.getAttribute('data-member-remove');
      if (email) changeMember('remove', email);
    });
    modal.querySelector('.acs-member-form').addEventListener('submit', function (e) {
      e.preventDefault(); changeMember('add', e.target.querySelector('input').value);
    });
    doc.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { close(); doc.removeEventListener('keydown', onKey); } });
    load();
  }

  global.NineAccessSettings = { open: open, close: close };
})(window);
