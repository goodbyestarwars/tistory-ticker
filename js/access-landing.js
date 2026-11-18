/**
 * 9Pay 비로그인 첫 화면(로그인 랜딩) (2026-11-11).
 * 비로그인 방문자가 한 브라우저 세션에서 처음 보는 화면 위에 스위스 라우터브루넨 슈타우바흐 폭포 사진과 함께 덮는다.
 * 상단 메뉴는 공개 4개 화면, [로그인]을 누르면 Google·네이버·카카오(블로그 관리자) 선택.
 * 배경은 슈타우바흐 폭포 실사진을 원본 비율로 표시한다. 로딩 중에는 단색 배경을 유지한다.
 * 판정은 NineAccess가 한다: 로그인한 사용자·관리자에게는 보이지 않고, 이 파일은 표시만 맡는다.
 * 카카오는 사이트 회원 로그인이 아니라 기존 티스토리 관리자 로그인(.nav-manage-btn)으로 연결한다.
 */
(function (global) {
  'use strict';
  if (global.NineLanding) return;
  var doc = global.document;
  var SEEN_KEY = 'nine_landing_seen';
  var API = 'https://goodbyestar.cloud';
  var root = null;

  var CSS =
    'html.nine-landing-open,html.nine-landing-open body{overflow:hidden}' +
    '.nl{position:fixed;inset:0;z-index:2147000000;box-sizing:border-box;display:flex;overflow:auto;padding:clamp(16px,4vw,56px);background:#eee8dc;color:#24231f;font-family:var(--font-ui,"Pretendard Variable",system-ui,sans-serif)}' +
    '.nl-layout{box-sizing:border-box;display:grid;grid-template-columns:minmax(280px, .8fr) minmax(0, 1.2fr);width:min(1140px,100%);margin:auto;background:#f7f0e4;border:1px solid #fff8ed;border-radius:22px;padding:10px;box-shadow:0 18px 45px rgba(93,69,37,.19)}' +
    '.nl-login-panel{display:flex;flex-direction:column;justify-content:center;padding:clamp(24px,4vw,56px)}' +
    '.nl-logo{font-size:18px;font-weight:700;margin-bottom:32px;color:#292721}' +
    '.nl-title,.nl-sub{font-family:inherit;font-size:16px;font-weight:700;line-height:1.65}.nl-title{margin:0}' +
    '.nl-sub{margin:12px 0 26px;color:#554d40;word-break:keep-all}' +
    '.nl-actions{display:grid;gap:10px}' +
    '.nl-btn{box-sizing:border-box;width:100%;min-height:48px;border:1px solid #07535b;border-radius:12px;box-shadow:0 4px 10px rgba(93,69,37,.15),inset 0 1px rgba(255,255,255,.35);font:inherit;font-weight:700;cursor:pointer;padding:10px 14px}' +
    '.nl-btn.primary{background:#07535b;color:#fff}.nl-btn.primary:hover{background:#09616a}' +
    '.nl-btn.ghost{background:#f4ebdc;border-color:#ded1bb;color:#292721}.nl-btn.ghost:hover{background:#ebe0cd}' +
    '.nl-btn:focus-visible,.nl-x:focus-visible,.nl-pv:focus-visible{outline:2px solid #07535b;outline-offset:3px}' +
    '.nl-visual{min-width:0;margin:0;align-self:center;overflow:hidden;border-radius:14px;background:#142c39}' +
    '.nl-photo{display:block;width:100%;height:auto;aspect-ratio:1280/853;object-fit:contain}' +
    '.nl-credit{padding:8px 12px;color:#e4edf0;font-size:11px;line-height:1.5;text-align:right}.nl-credit a{color:inherit;text-decoration:underline}' +
    '.nl-modal{position:fixed;inset:0;color:#292721;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(25,29,28,.48)}' +
    '.nl-modal[hidden]{display:none}' +
    '.nl-card{position:relative;box-sizing:border-box;width:min(600px,100%);max-height:100%;overflow:auto;padding:clamp(24px,4vw,44px);border-radius:20px;background:#f7f0e4;border:1px solid #fff8ed;box-shadow:0 22px 60px rgba(36,25,16,.32)}' +
    '.nl-x{position:absolute;top:10px;right:10px;width:40px;height:40px;border:1px solid #ded1bb;border-radius:50%;background:#f4ebdc;color:#07535b;font-size:26px;line-height:1;cursor:pointer}' +
    '.nl-card:focus{outline:none}.nl-card h2{margin:0 44px 8px 0;font-size:clamp(22px,3.4vw,28px);font-weight:800}' +
    '.nl-card p{margin:0 0 20px;font-size:14.5px;line-height:1.6;color:#554d40}' +
    '.nl-pv{display:flex;align-items:center;gap:12px;width:100%;margin-top:10px;padding:14px 16px;border:1px solid #07535b;border-radius:12px;box-shadow:0 4px 10px rgba(93,69,37,.15);font:inherit;font-size:17px;font-weight:700;cursor:pointer;text-align:left;text-decoration:none;box-sizing:border-box}' +
    '.nl-pv i{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;font-style:normal;font-weight:800;font-size:14px;flex:none}' +
    '.nl-pv small{display:block;font-size:11.5px;font-weight:500;opacity:.7}' +
    '.nl-google,.nl-google:visited{background:#07535b;color:#fff}.nl-google:hover{background:#09616a;color:#fff}.nl-google i{background:#f1f3f4;color:#4285f4}' +
    '.nl-back{margin-top:14px;background:none;border:0;color:rgba(255,255,255,.85);font:inherit;font-size:13px;cursor:pointer;padding:4px 0}' +
    '.nl-card .nl-note{margin:14px 0 0;font-size:12px;line-height:1.5;color:#554d40}' +
    '@media (max-width:720px){.nl-layout{grid-template-columns:minmax(0,1fr);max-width:480px}.nl-visual{grid-row:1}.nl-logo{margin-bottom:16px}.nl-login-panel{padding:22px 16px}.nl-sub{margin-bottom:18px}}';

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function markSeen() { try { global.sessionStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* 저장소 차단 */ } }
  function seen() { try { return global.sessionStorage.getItem(SEEN_KEY) === '1'; } catch (e) { return false; } }

  function ret() { return encodeURIComponent(global.location.href); }

  function close() {
    if (!root) return;
    doc.removeEventListener('keydown', onKey);
    root.remove(); root = null;
    doc.documentElement.classList.remove('nine-landing-open');
  }

  var lastFocus = null;
  function focusables(box) {
    return Array.prototype.slice.call(box.querySelectorAll('a[href],button:not([disabled])')).filter(function (n) { return n.offsetParent !== null || n === doc.activeElement; });
  }
  function closeModal() {
    if (!root) return;
    var modal = root.querySelector('.nl-modal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function openModal() {
    var modal = root.querySelector('.nl-modal');
    lastFocus = doc.activeElement;
    modal.hidden = false;
    modal.querySelector('.nl-card').focus();
  }
  /* 비회원 입장: 인증 없이 공개 화면(비회원 홈)으로. 인증된 사용자가 아니다. */
  function enterGuest() {
    markSeen();
    try { global.sessionStorage.setItem('nine_guest', '1'); } catch (e) { /* 저장소 차단 */ }
    // 다른 화면(예: /guestbook)에서는 이동이 끝날 때까지 랜딩을 유지한다.
    // 먼저 닫으면 네트워크가 느릴 때 이전 화면이 잠깐 드러난다.
    if (global.location.pathname !== '/' && global.location.pathname !== '') {
      global.location.assign('/');
      return;
    }
    // 홈에서는 페이지 이동 없이 기존 비회원 홈을 보여 준다.
    close();
  }

  function onKey(e) {
    if (!root) return;
    var modal = root.querySelector('.nl-modal');
    if (!modal || modal.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
    if (e.key === 'Tab') { // 모달 안에서만 포커스 이동
      var items = focusables(modal);
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (doc.activeElement === first || doc.activeElement === modal.querySelector('.nl-card'))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function build(naverConfigured) {
    root.innerHTML = '<div class="nl-layout"><div class="nl-login-panel">' +
      '<h1 class="nl-title">시장을 보는 나만의 시선</h1>' +
      '<p class="nl-sub">오늘의 시장 흐름을 차분히 읽고, 다양한 시선 속에서 나만의 투자 판단을 쌓아보세요.</p>' +
      '<div class="nl-actions"><button type="button" class="nl-btn primary" data-nl-login="1">로그인</button>' +
      '<button type="button" class="nl-btn ghost" data-nl-guest="1">비회원 로그인</button></div></div>' +
      '<figure class="nl-visual"><img class="nl-photo" src="https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5f/Lauterbrunnen_-_Staubbachfall.jpg/1280px-Lauterbrunnen_-_Staubbachfall.jpg" alt="라우터브루넨 마을과 슈타우바흐 폭포" width="1280" height="853">' +
      '<figcaption class="nl-credit">사진: Noel Reynolds · <a href="https://commons.wikimedia.org/wiki/File:Lauterbrunnen_-_Staubbachfall.jpg" target="_blank" rel="noopener">Wikimedia Commons</a> · <a href="https://creativecommons.org/licenses/by/2.0/" target="_blank" rel="noopener">CC BY 2.0</a></figcaption></figure></div>' +
      '<div class="nl-modal" hidden><section class="nl-card" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="nlLoginTitle">' +
      '<button type="button" class="nl-x" data-nl-back="1" aria-label="닫기">×</button>' +
      '<h2 id="nlLoginTitle">로그인</h2><p>Google 계정으로 로그인하세요. 회원·관리자 권한은 등록된 계정에 따라 적용됩니다.</p>' +
      '<a class="nl-pv nl-google" href="' + API + '/auth/google/start?return_to=' + ret() + '"><i>G</i><span>Google로 계속하기<small>관리자 계정이면 전체 서비스</small></span></a>' +
      '<p class="nl-note">티스토리 글·댓글 관리는 별도 블로그 관리에서 이용합니다.</p>' +
      '</section></div>';
    root.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target : null;
      if (!t) return;
      if (t.closest('[data-nl-guest]')) { enterGuest(); return; }
      if (t.closest('[data-nl-login]')) { openModal(); return; }
      if (t.closest('[data-nl-back]') || t.classList.contains('nl-modal')) closeModal();
    });
    doc.addEventListener('keydown', onKey);
  }

  function show(naverConfigured) {
    if (root) return;
    if (!doc.getElementById('nine-landing-css')) {
      var st = doc.createElement('style'); st.id = 'nine-landing-css'; st.textContent = CSS; (doc.head || doc.documentElement).appendChild(st);
    }
    root = doc.createElement('div');
    root.className = 'nl';
    root.id = 'nineLanding';
    doc.documentElement.classList.add('nine-landing-open');
    (doc.body || doc.documentElement).appendChild(root);
    build(!!naverConfigured);
  }

  function showLogin(naverConfigured) {
    if (!root) show(naverConfigured);
    openModal();
  }

  global.NineLanding = {
    seen: seen,
    show: show,
    showLogin: showLogin,
    close: close,
    isOpen: function () { return !!root; },
    /* 정책 판정 결과 반영: 로그인했으면 닫고, 비로그인이면 네이버 버튼 여부를 맞춘다. */
    settle: function (data) {
      if (data && data.authenticated) { close(); return; }
      if (!root) return;

    }
  };
})(window);
