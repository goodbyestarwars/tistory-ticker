/**
 * 9Pay 비로그인 첫 화면(로그인 랜딩) (2026-11-11).
 * 비로그인 방문자가 한 브라우저 세션에서 처음 보는 화면 위에 뮈렌 사진과 함께 덮는다.
 * 상단 메뉴는 공개 4개 화면, [로그인]을 누르면 Google·네이버·카카오(블로그 관리자) 선택.
 * 풍경은 Pages의 뮈렌 사진을 사용한다. 로딩 중에는 단색 배경을 유지한다.
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
    '.nl{position:fixed;inset:0;z-index:2147000000;color:#fff;font-family:var(--font-ui,"Pretendard Variable",system-ui,sans-serif);background:#0f2a4a;overflow:hidden}' +
    '.nl-photo{position:absolute;inset:0;background:url(https://goodbyestarwars.github.io/tistory-ticker/img/landing-murren.jpg) center/cover no-repeat}' +
    '.nl-shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(7,20,38,.62) 0%,rgba(7,20,38,.18) 52%,rgba(7,20,38,0) 78%),linear-gradient(0deg,rgba(7,20,38,.5) 0%,rgba(7,20,38,0) 40%)}' +
    '.nl-top{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:26px clamp(20px,6vw,96px)}' +
    '.nl-logo{font-family:"Noto Serif KR Site",var(--font-serif,serif);font-weight:700}' +
    '.nl-logo{color:#fff;text-decoration:none;font-size:26px;letter-spacing:-.01em;text-shadow:0 2px 14px rgba(0,0,0,.35)}' +
    '.nl-nav{display:flex;align-items:center;gap:clamp(14px,2.4vw,34px);flex-wrap:wrap;justify-content:flex-end}' +
    '.nl-nav a,.nl-nav button{color:#fff;font:inherit;font-size:15px;font-weight:600;text-decoration:none;background:none;border:0;padding:6px 2px;cursor:pointer;text-shadow:0 1px 10px rgba(0,0,0,.4);opacity:.92}' +
    '.nl-nav a:hover,.nl-nav button:hover{opacity:1;text-decoration:underline;text-underline-offset:6px}' +
    '.nl-nav .nl-login{padding:8px 18px;border-radius:999px;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.45);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}' +
    '.nl-hero{position:absolute;left:clamp(20px,6vw,96px);bottom:clamp(80px,16vh,160px);max-width:min(760px,calc(100% - 240px))}' +
    '.nl-badge{display:inline-block;font-size:13px;font-weight:600;padding:7px 14px;border-radius:999px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.3);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);margin-bottom:18px}' +
    '.nl-title{margin:0;font-size:clamp(30px,5vw,64px);line-height:1.2;letter-spacing:-.01em;text-shadow:0 4px 30px rgba(0,0,0,.35)}' +
    '.nl-sub{margin:18px 0 28px;font-size:clamp(15px,1.6vw,18px);line-height:1.6;font-weight:500;color:rgba(255,255,255,.92);text-shadow:0 2px 14px rgba(0,0,0,.4);max-width:520px}' +
    '.nl-cta{display:inline-flex;align-items:center;gap:10px;font:inherit;font-size:16px;font-weight:700;color:#16324f;background:rgba(255,255,255,.94);border:0;border-radius:999px;padding:14px 26px;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.28)}' +
    '.nl-cta:hover{background:#fff}' +
    '.nl-actions{position:absolute;left:clamp(20px,5vw,80px);bottom:clamp(28px,6vh,72px);display:flex;gap:14px;flex-wrap:wrap}' +
    '.nl-btn{box-sizing:border-box;min-width:200px;max-width:240px;height:60px;padding:0 28px;border-radius:0;font:inherit;font-size:17px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex:1 1 200px}' +
    '.nl-btn.primary{background:#fff;color:#16324f;border:2px solid #fff;box-shadow:0 10px 30px rgba(0,0,0,.28)}' +
    '.nl-btn.primary:hover{background:#eaf1fb}' +
    '.nl-btn.ghost{background:rgba(255,255,255,.14);color:#fff;border:2px solid rgba(255,255,255,.85);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}' +
    '.nl-btn.ghost:hover{background:rgba(255,255,255,.26)}' +
    '.nl-btn:focus-visible,.nl-x:focus-visible,.nl-pv:focus-visible{outline:3px solid #ffd27a;outline-offset:2px}' +
    '.nl-qr{position:absolute;right:clamp(16px,3vw,40px);bottom:44px;width:144px;display:flex;flex-direction:column;align-items:center;gap:6px;color:#fff;text-decoration:none;font-size:12px;text-shadow:0 1px 5px #000}.nl-qr img{display:block;width:144px;height:144px;background:transparent;border-radius:8px}.nl-qr:focus-visible{outline:3px solid #ffd27a;outline-offset:4px}' +
    '.nl-credit{font-family:system-ui,"Malgun Gothic",sans-serif;position:absolute;right:clamp(12px,3vw,40px);bottom:10px;font-size:11px;color:rgba(255,255,255,.7);text-decoration:none;text-shadow:0 1px 6px rgba(0,0,0,.6)}' +
    '.nl-credit:hover{color:#fff;text-decoration:underline}' +
    '.nl-modal{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(7,20,38,.62)}' +
    '.nl-modal[hidden]{display:none}' +
    '.nl-card{position:relative;box-sizing:border-box;width:min(600px,100%);max-height:100%;overflow:auto;padding:clamp(24px,4vw,44px);border-radius:0;background:transparent;border:1px solid rgba(255,255,255,.4);box-shadow:0 30px 80px rgba(0,0,0,.5)}' +
    '.nl-x{position:absolute;top:10px;right:10px;width:40px;height:40px;border:0;background:none;color:#fff;font-size:26px;line-height:1;cursor:pointer}' +
    '.nl-card h2{margin:0 0 8px;font-size:clamp(24px,3.4vw,32px);font-weight:800}' +
    '.nl-card p{margin:0 0 20px;font-size:14.5px;line-height:1.6;color:rgba(255,255,255,.88)}' +
    '.nl-pv{display:flex;align-items:center;gap:12px;width:100%;margin-top:10px;padding:18px 20px;border:0;border-radius:0;font:inherit;font-size:17px;font-weight:700;cursor:pointer;text-align:left;text-decoration:none;box-sizing:border-box}' +
    '.nl-pv i{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;font-style:normal;font-weight:800;font-size:14px;flex:none}' +
    '.nl-pv small{display:block;font-size:11.5px;font-weight:500;opacity:.7}' +
    '.nl-google{background:#fff;color:#1f2937}.nl-google i{background:#f1f3f4;color:#4285f4}' +
    '.nl-naver{background:#03c75a;color:#fff}.nl-naver i{background:rgba(255,255,255,.22)}' +
    '.nl-kakao{background:#fee500;color:#191600}.nl-kakao i{background:rgba(0,0,0,.1)}' +
    '.nl-back{margin-top:14px;background:none;border:0;color:rgba(255,255,255,.85);font:inherit;font-size:13px;cursor:pointer;padding:4px 0}' +
    '.nl-note{margin-top:12px;font-size:11.5px;line-height:1.5;color:rgba(255,255,255,.72)}' +
    '@media (min-width:721px) and (max-height:500px){.nl-hero{bottom:130px}}' +
    '@media (max-width:720px){.nl-top{padding:16px 16px;align-items:flex-start}.nl-logo{font-size:22px}.nl-nav{gap:10px 14px}' +
    '.nl-nav a,.nl-nav button{font-size:13.5px}.nl-hero{bottom:max(190px,24vh);max-width:calc(100% - 40px)}.nl-actions{left:20px;right:148px;bottom:40px;flex-direction:column;gap:12px}.nl-btn{min-width:0;max-width:none;flex:none;width:100%;height:56px;padding:0 8px;font-size:15px}.nl-qr{right:16px;bottom:40px;width:112px;font-size:11px}.nl-qr img{width:112px;height:112px}}';

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function markSeen() { try { global.sessionStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* 저장소 차단 */ } }
  function seen() { try { return global.sessionStorage.getItem(SEEN_KEY) === '1'; } catch (e) { return false; } }

  function kakaoUrl() {
    var a = doc.querySelector('.nav-manage-btn');
    return (a && a.href) || 'https://www.tistory.com/auth/login';
  }
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
    var first = modal.querySelector('.nl-pv'); if (first) first.focus();
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
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function build(naverConfigured) {
    root.innerHTML = '<div class="nl-photo"></div><div class="nl-shade"></div>' +
      '<div class="nl-top"><span class="nl-logo" style="font-family:Noto Serif KR Site,var(--font-serif,serif)!important;font-weight:700!important">ㄱㅖ조 ㅏ심폐소생술</span></div>' +
      '<div class="nl-hero"><span class="nl-badge">시장을 보는 나만의 시선</span>' +
      '<p class="nl-sub">오늘의 시장 흐름을 차분히 읽고, 다양한 시선 속에서 나만의 투자 판단을 쌓아보세요.</p></div>' +
      '<div class="nl-actions"><button type="button" class="nl-btn primary" data-nl-login="1">로그인</button>' +
      '<button type="button" class="nl-btn ghost" data-nl-guest="1">비회원 로그인</button></div>' +
      '<a class="nl-qr" href="https://goodbyestarwars.github.io/tistory-ticker/img/site-qr.svg" target="_blank" rel="noopener" aria-label="사이트 QR코드 크게 보기"><img src="https://goodbyestarwars.github.io/tistory-ticker/img/site-qr.svg" width="144" height="144" alt="https://ghlee.tistory.com/ 접속 QR코드"><span>사이트 접속 QR</span></a>' +
      '<a class="nl-credit" href="https://commons.wikimedia.org/wiki/File:View_to_Lauterbrunnen_valley_at_M%C3%BCrren,_Bern,_Switzerland,_2012_August.jpg" target="_blank" rel="noopener">사진: Ximonic (Simo Räsänen) · CC BY-SA 4.0 · Wikimedia Commons</a>' +
      '<div class="nl-modal" hidden><section class="nl-card" role="dialog" aria-modal="true" aria-labelledby="nlLoginTitle">' +
      '<button type="button" class="nl-x" data-nl-back="1" aria-label="닫기">×</button>' +
      '<h2 id="nlLoginTitle">로그인</h2><p>사용할 계정을 선택하세요. 승인된 계정으로 로그인하면 기존 대시보드가 열리고, 그 외 계정은 공개 화면을 이용합니다.</p>' +
      '<a class="nl-pv nl-google" href="' + API + '/auth/google/start?return_to=' + ret() + '"><i>G</i><span>Google로 계속하기<small>관리자 계정이면 전체 서비스</small></span></a>' +
      (naverConfigured ? '<a class="nl-pv nl-naver" href="' + API + '/auth/naver/start?return_to=' + ret() + '"><i>N</i><span>네이버로 계속하기<small>네이버 계정으로 로그인</small></span></a>' : '') +
      '<a class="nl-pv nl-kakao" href="' + esc(kakaoUrl()) + '"><i>K</i><span>카카오로 계속하기<small>블로그 관리자(Tistory) 로그인</small></span></a>' +
      '<p class="nl-note">카카오는 블로그 관리자 로그인입니다. 서비스 기능은 관리자 승인 계정에 한해 제공됩니다.</p>' +
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
      var has = !!root.querySelector('.nl-naver');
      if (!!(data && data.naverConfigured) !== has) { close(); show(data && data.naverConfigured); }
    }
  };
})(window);
