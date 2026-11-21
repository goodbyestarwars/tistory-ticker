/**
 * 9Pay 비로그인 첫 화면(로그인 랜딩) (2026-11-11).
 * 비로그인 방문자가 한 브라우저 세션에서 처음 보는 화면 위에 사용자 지정 배경 사진과 함께 덮는다.
 * 상단 메뉴는 공개 4개 화면, [로그인]을 누르면 Google·네이버·카카오(블로그 관리자) 선택.
 * 배경은 img/landing-ironman.webp(16:9)를 표시한다. 로딩 중에는 단색 배경을 유지한다.
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
    '.nl-layout{box-sizing:border-box;display:grid;grid-template-columns:minmax(340px, .82fr) minmax(0, 1.9fr);width:min(1360px,100%);margin:auto;background:#f7f0e4;border:1px solid #fff8ed;border-radius:22px;padding:10px;box-shadow:0 18px 45px rgba(93,69,37,.19)}' +
    '.nl-login-panel{display:flex;flex-direction:column;justify-content:center;padding:clamp(22px,3vw,44px)}' +
    '.nl-logo{font-size:18px;font-weight:700;margin-bottom:32px;color:#292721}' +
    '.nl-title,.nl-sub{font-family:inherit;font-size:16px;font-weight:700;line-height:1.65}.nl-title{margin:0}' +
    '.nl-sub{margin:12px 0 26px;color:#554d40;word-break:keep-all}' +
    '.nl-actions{display:grid;gap:10px}' +
    '.nl-btn{box-sizing:border-box;width:100%;min-height:48px;border:1px solid #07535b;border-radius:12px;box-shadow:0 4px 10px rgba(93,69,37,.15),inset 0 1px rgba(255,255,255,.35);font:inherit;font-weight:700;cursor:pointer;padding:10px 14px}' +
    '.nl-btn.primary{background:#07535b;color:#fff}.nl-btn.primary:hover{background:#09616a}' +
    '.nl-btn.ghost{background:#f4ebdc;border-color:#ded1bb;color:#292721}.nl-btn.ghost:hover{background:#ebe0cd}' +
    '.nl-btn:focus-visible,.nl-x:focus-visible,.nl-pv:focus-visible{outline:2px solid #07535b;outline-offset:3px}' +
    '.nl-visual{position:relative;min-width:0;margin:0;align-self:stretch;overflow:hidden;border-radius:14px;background:#2f4466;aspect-ratio:16/9}' +
    '.nl-sketch{position:absolute;inset:0;width:100%;height:100%;display:block;object-fit:cover;object-position:50% 30%;opacity:0;transition:opacity .35s ease}.nl-sketch.is-ready{opacity:1}@media (prefers-reduced-motion:reduce){.nl-sketch{transition:none}}' +
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
    '.nl-card .nl-quote{margin:0 0 16px;padding:14px 16px;border-radius:12px;background:#f0e6d3;color:#3a3226;font-size:14px;line-height:1.7}' +
    '.nl-card ul.nl-points{margin:0 0 18px;padding:0 0 0 18px;font-size:14.5px;line-height:1.7;color:#554d40}.nl-card ul.nl-points li{margin:0 0 6px}' +
    '.nl-card .nl-two{display:grid;gap:10px;margin-top:6px}' +
    '@media (max-width:720px){.nl-layout{grid-template-columns:minmax(0,1fr);max-width:480px}.nl-visual{grid-row:1;align-self:start;aspect-ratio:auto;height:0;padding-top:56.25%}.nl-logo{margin-bottom:16px}.nl-login-panel{padding:22px 16px}.nl-sub{margin-bottom:18px}}' +
    // 모바일 한 열 배치는 위 미디어쿼리에서 padding-top 비율로 높이를 확보한다. iOS Safari(WebKit)는 그리드 stretch가
    // aspect-ratio보다 우선해 SVG(absolute)만 있는 칸이 높이 0이 됐다(2026-11-20 실기기 확인). 아래는 미지원 브라우저의 PC 보완.
    '@supports not (aspect-ratio:1/1){.nl-visual{height:0;padding-top:56.25%}}';

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
    var modal = root.querySelector('.nl-modal:not([hidden])');
    if (!modal) return;
    modal.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function openModal(which) {
    var modal = root.querySelector(which === 'guest' ? '.nl-modal[data-nl-guestmodal]' : '.nl-modal:not([data-nl-guestmodal])');
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
    var modal = root.querySelector('.nl-modal:not([hidden])');
    if (!modal) return;
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
    if (e.key === 'Tab') { // 모달 안에서만 포커스 이동
      var items = focusables(modal);
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (doc.activeElement === first || doc.activeElement === modal.querySelector('.nl-card'))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  /* 2026-11-20 사용자 지정 배경: 사용자가 제공한 설계도 일러스트를 가로(반시계 90°)로 돌려 Pages에 올린 사진.
     이전 '양피지 설계도 스케치'(SVG 코드 그림)는 이 사진으로 교체했다. 로딩 중·실패 시에는 칸 배경색만 보인다. */
  var ASSET_BASE = (typeof NineAsset !== 'undefined' && NineAsset.base) || 'https://goodbyestarwars.github.io/tistory-ticker/';
  var PHOTO = ASSET_BASE + 'img/landing-ironman.webp';
  // 2026-11-22: 작은 화면은 960px(약 120KB)판을 받고, 사진이 오면 배경색에서 서서히 나타나게 한다.
  var PHOTO_SM = ASSET_BASE + 'img/landing-ironman-960.webp';

  function build(naverConfigured) {
    root.innerHTML = '<div class="nl-layout"><div class="nl-login-panel">' +
      '<p class="nl-sub">오늘의 시장 흐름을 차분히 읽고, 다양한 시선 속에서 나만의 투자 판단을 쌓아보세요.</p>' +
      '<div class="nl-actions"><button type="button" class="nl-btn primary" data-nl-login="1">로그인</button>' +
      '<button type="button" class="nl-btn ghost" data-nl-guest="1">비회원으로 둘러보기</button></div></div>' +
      '<figure class="nl-visual" aria-hidden="true"><img class="nl-sketch" src="' + PHOTO + '" srcset="' + PHOTO_SM + ' 960w, ' + PHOTO + ' 1920w" sizes="(max-width:720px) 92vw, 760px" alt="" decoding="async" fetchpriority="high"></figure></div>' +
      '<div class="nl-modal" hidden><section class="nl-card" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="nlLoginTitle">' +
      '<button type="button" class="nl-x" data-nl-back="1" aria-label="닫기">×</button>' +
      '<h2 id="nlLoginTitle">로그인</h2><p>Google 계정으로 로그인하세요. 회원·관리자 권한은 등록된 계정에 따라 적용됩니다.</p>' +
      '<a class="nl-pv nl-google" href="' + API + '/auth/google/start?return_to=' + ret() + '"><i>G</i><span>Google로 계속하기<small>관리자 계정이면 전체 서비스</small></span></a>' +
      '<p class="nl-note">티스토리 글·댓글 관리는 별도 블로그 관리에서 이용합니다.</p>' +
      '</section></div>' +
      '<div class="nl-modal" data-nl-guestmodal="1" hidden><section class="nl-card" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="nlGuestTitle">' +
      '<button type="button" class="nl-x" data-nl-back="1" aria-label="닫기">×</button>' +
      '<h2 id="nlGuestTitle">비회원 이용 안내</h2>' +
      '<p>로그인 없이 공개 콘텐츠를 둘러볼 수 있습니다.</p>' +
      '<div class="nl-quote"><b>이용약관</b><br>고객은 회사에서 제공하는 시세(국내주식, 해외주식, 국내선물/옵션 등)정보를 고객이 직접 개발한 프로그램 등 개인의 업무에 한하여 이용해야 하며, 제3자에게 제공해서는 아니 된다.</div>' +
      '<ul class="nl-points"><li>이 약관에 따라 <b>시세·호가·수급 등 시세 정보는 비회원에게 제공하지 않습니다.</b></li>' +
      '<li>비회원은 뉴스, 마켓 브리핑, 이야기, 캘린더 같은 공개 콘텐츠를 볼 수 있습니다.</li>' +
      '<li><b>회원 가입은 무료이며 별도 문의로 안내합니다.</b> 약관상 허용되는 범위를 알려 드립니다.</li></ul>' +
      '<div class="nl-two"><a class="nl-btn primary" style="display:flex;align-items:center;justify-content:center;text-decoration:none" href="mailto:goodbyestarwars@gmail.com?subject=%ED%9A%8C%EC%9B%90%20%EA%B0%80%EC%9E%85%20%EB%AC%B8%EC%9D%98">회원 가입 문의하기</a>' +
      '<button type="button" class="nl-btn ghost" data-nl-guestgo="1">확인하고 공개 콘텐츠 보기</button></div>' +
      '</section></div>';
    var photo = root.querySelector('.nl-sketch');
    if (photo) {
      var ready = function () { photo.classList.add('is-ready'); };
      if (photo.complete && photo.naturalWidth) ready(); else photo.addEventListener('load', ready);
    }
    root.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target : null;
      if (!t) return;
      if (t.closest('[data-nl-guestgo]')) { closeModal(); enterGuest(); return; }
      if (t.closest('[data-nl-guest]')) { openModal('guest'); return; }
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
