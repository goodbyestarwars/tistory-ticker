/**
 * 9Pay 비로그인 첫 화면(로그인 랜딩) (2026-11-11).
 * 비로그인 방문자가 한 브라우저 세션에서 처음 보는 화면 위에 마테호른·인터라켄 풍경과 함께 덮는다.
 * 상단 메뉴는 공개 4개 화면, [로그인]을 누르면 Google·네이버·카카오(블로그 관리자) 선택.
 * 풍경은 외부 이미지 없이 인라인 SVG로 그린다(라이선스·네트워크 요청 없음).
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

  var MENU = [
    ['대화방', '/guestbook'],
    ['캘린더', '/page/stock-calendar'],
    ['마켓브리핑', '/category/마켓 브리핑'],
    ['이야기 시리즈', '/guestbook#story-series']
  ];

  var CSS =
    'html.nine-landing-open,html.nine-landing-open body{overflow:hidden}' +
    '.nl{position:fixed;inset:0;z-index:2147000000;color:#fff;font-family:var(--font-ui,Pretendard,system-ui,sans-serif);background:#0f2a4a;overflow:hidden}' +
    '.nl svg.nl-scene{position:absolute;inset:0;width:100%;height:100%}' +
    '.nl-photo{position:absolute;inset:0;background:url(https://goodbyestarwars.github.io/tistory-ticker/img/landing-interlaken.jpg) center/cover no-repeat}' +
    '.nl-shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(7,20,38,.62) 0%,rgba(7,20,38,.18) 52%,rgba(7,20,38,0) 78%),linear-gradient(0deg,rgba(7,20,38,.5) 0%,rgba(7,20,38,0) 40%)}' +
    '.nl-top{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:26px clamp(20px,6vw,96px)}' +
    '.nl-logo{font-family:"Noto Serif KR Site",var(--font-serif,serif);font-weight:700}' +
    '.nl-logo{color:#fff;text-decoration:none;font-size:26px;letter-spacing:-.01em;text-shadow:0 2px 14px rgba(0,0,0,.35)}' +
    '.nl-nav{display:flex;align-items:center;gap:clamp(14px,2.4vw,34px);flex-wrap:wrap;justify-content:flex-end}' +
    '.nl-nav a,.nl-nav button{color:#fff;font:inherit;font-size:15px;font-weight:600;text-decoration:none;background:none;border:0;padding:6px 2px;cursor:pointer;text-shadow:0 1px 10px rgba(0,0,0,.4);opacity:.92}' +
    '.nl-nav a:hover,.nl-nav button:hover{opacity:1;text-decoration:underline;text-underline-offset:6px}' +
    '.nl-nav .nl-login{padding:8px 18px;border-radius:999px;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.45);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}' +
    '.nl-hero{position:absolute;left:clamp(20px,6vw,96px);bottom:clamp(80px,16vh,160px);max-width:min(760px,calc(100% - 40px))}' +
    '.nl-badge{display:inline-block;font-size:13px;font-weight:600;padding:7px 14px;border-radius:999px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.3);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);margin-bottom:18px}' +
    '.nl-title{margin:0;font-size:clamp(30px,5vw,64px);line-height:1.2;letter-spacing:-.01em;text-shadow:0 4px 30px rgba(0,0,0,.35)}' +
    '.nl-sub{margin:18px 0 28px;font-size:clamp(15px,1.6vw,18px);line-height:1.6;font-weight:500;color:rgba(255,255,255,.92);text-shadow:0 2px 14px rgba(0,0,0,.4);max-width:520px}' +
    '.nl-cta{display:inline-flex;align-items:center;gap:10px;font:inherit;font-size:16px;font-weight:700;color:#16324f;background:rgba(255,255,255,.94);border:0;border-radius:999px;padding:14px 26px;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.28)}' +
    '.nl-cta:hover{background:#fff}' +
    '.nl-loginfab{position:absolute;left:clamp(20px,6vw,96px);bottom:clamp(20px,4vh,40px);font:inherit;font-size:15px;font-weight:700;color:#16324f;background:rgba(255,255,255,.94);border:0;border-radius:0;padding:12px 26px;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.28)}' +
    '.nl-credit{position:absolute;right:clamp(12px,3vw,40px);bottom:10px;font-size:11px;color:rgba(255,255,255,.7);text-decoration:none;text-shadow:0 1px 6px rgba(0,0,0,.6)}' +
    '.nl-credit:hover{color:#fff;text-decoration:underline}' +
    '.nl-modal{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(7,20,38,.55)}' +
    '.nl-modal[hidden]{display:none}' +
    '.nl-card{width:min(380px,100%);max-height:100%;overflow:auto;padding:24px;border-radius:22px;background:rgba(18,38,66,.78);border:1px solid rgba(255,255,255,.38);backdrop-filter:blur(22px) saturate(1.2);-webkit-backdrop-filter:blur(22px) saturate(1.2);box-shadow:0 24px 60px rgba(0,0,0,.4)}' +
    '.nl-card h2{margin:0 0 4px;font-size:20px;font-weight:800}' +
    '.nl-card p{margin:0 0 16px;font-size:13px;line-height:1.5;color:rgba(255,255,255,.85)}' +
    '.nl-pv{display:flex;align-items:center;gap:12px;width:100%;margin-top:10px;padding:13px 16px;border:0;border-radius:14px;font:inherit;font-size:15px;font-weight:700;cursor:pointer;text-align:left;text-decoration:none;box-sizing:border-box}' +
    '.nl-pv i{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;font-style:normal;font-weight:800;font-size:14px;flex:none}' +
    '.nl-pv small{display:block;font-size:11.5px;font-weight:500;opacity:.7}' +
    '.nl-google{background:#fff;color:#1f2937}.nl-google i{background:#f1f3f4;color:#4285f4}' +
    '.nl-naver{background:#03c75a;color:#fff}.nl-naver i{background:rgba(255,255,255,.22)}' +
    '.nl-kakao{background:#fee500;color:#191600}.nl-kakao i{background:rgba(0,0,0,.1)}' +
    '.nl-back{margin-top:14px;background:none;border:0;color:rgba(255,255,255,.85);font:inherit;font-size:13px;cursor:pointer;padding:4px 0}' +
    '.nl-note{margin-top:12px;font-size:11.5px;line-height:1.5;color:rgba(255,255,255,.72)}' +
    '.nl-cloud{animation:nl-drift 60s linear infinite alternate}.nl-cloud2{animation-duration:90s;animation-direction:alternate-reverse}' +
    '@keyframes nl-drift{from{transform:translateX(-40px)}to{transform:translateX(60px)}}' +
    '@media (prefers-reduced-motion:reduce){.nl-cloud{animation:none}}' +
    '@media (max-width:720px){.nl svg.nl-scene{left:-30%;width:150%}.nl-top{padding:16px 16px;align-items:flex-start}.nl-logo{font-size:22px}.nl-nav{gap:10px 14px}' +
    '.nl-nav a,.nl-nav button{font-size:13.5px}.nl-hero{bottom:max(76px,13vh)}.nl-loginfab{left:20px}}';

  // 마테호른(좌측 밝은 면·우측 그늘 면)과 인터라켄 호수·소나무를 단순화해 그린 장면.
  var SCENE =
    '<svg class="nl-scene" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">' +
    '<defs>' +
    '<linearGradient id="nlSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d2547"/><stop offset=".42" stop-color="#2f6797"/><stop offset=".72" stop-color="#8db6cf"/><stop offset="1" stop-color="#f4cfa1"/></linearGradient>' +
    '<radialGradient id="nlSun" cx=".72" cy=".62" r=".5"><stop offset="0" stop-color="#fff1c9" stop-opacity=".95"/><stop offset=".35" stop-color="#ffd9a0" stop-opacity=".45"/><stop offset="1" stop-color="#ffd9a0" stop-opacity="0"/></radialGradient>' +
    '<linearGradient id="nlLit" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fdf3e4"/><stop offset=".5" stop-color="#d9c8c2"/><stop offset="1" stop-color="#8a8fa6"/></linearGradient>' +
    '<linearGradient id="nlShadow" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6d7894"/><stop offset="1" stop-color="#27344f"/></linearGradient>' +
    '<linearGradient id="nlLake" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1c79a"/><stop offset=".35" stop-color="#7fb0c6"/><stop offset="1" stop-color="#1f5373"/></linearGradient>' +
    '<linearGradient id="nlMist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".6" stop-color="#eaf3f8" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
    '<filter id="nlBlur"><feGaussianBlur stdDeviation="14"/></filter><filter id="nlSoft"><feGaussianBlur stdDeviation="3"/></filter>' +
    '<g id="nlPine"><polygon points="0,-46 12,-20 6,-20 16,2 8,2 20,26 -20,26 -8,2 -16,2 -6,-20 -12,-20" fill="#0f2f2a"/></g>' +
    '</defs>' +
    '<rect width="1600" height="900" fill="url(#nlSky)"/><rect width="1600" height="900" fill="url(#nlSun)"/>' +
    '<g class="nl-cloud" opacity=".55" filter="url(#nlBlur)"><ellipse cx="300" cy="190" rx="220" ry="26" fill="#fff"/><ellipse cx="520" cy="230" rx="160" ry="18" fill="#fff"/></g>' +
    '<g class="nl-cloud nl-cloud2" opacity=".4" filter="url(#nlBlur)"><ellipse cx="1280" cy="150" rx="240" ry="24" fill="#fff"/></g>' +
    // 먼 산줄기
    '<polygon points="0,610 120,560 230,590 340,520 470,580 590,520 700,590 820,540 930,600 1040,560 1160,610 1290,540 1420,600 1600,540 1600,720 0,720" fill="#6f8fb3" opacity=".75"/>' +
    '<polygon points="0,650 160,600 300,640 440,585 580,650 700,610 760,650 760,720 0,720" fill="#557aa3" opacity=".85"/>' +
    // 마테호른 - 그늘 면
    '<polygon points="1030,205 1048,236 1066,262 1092,318 1124,372 1160,420 1206,470 1262,534 1330,600 1420,660 1420,720 900,720 960,600 1000,420 1034,300" fill="url(#nlShadow)"/>' +
    // 밝은 면
    '<polygon points="1030,205 1000,240 972,282 938,320 902,352 862,392 816,428 760,470 700,516 640,572 560,640 520,720 900,720 960,600 1004,420 1034,300" fill="url(#nlLit)"/>' +
    // 능선과 눈 줄무늬
    '<g fill="none" stroke="#fff" stroke-linecap="round"><path d="M1030 205 L1012 262 L990 330 L955 410 L915 500" stroke-width="3" opacity=".7"/>' +
    '<path d="M1030 205 L1052 270 L1078 340 L1108 410" stroke-width="2" opacity=".4"/>' +
    '<path d="M960 330 L902 352 M920 392 L862 392 M880 450 L804 468 M1005 360 L946 410" stroke-width="2.4" opacity=".55"/></g>' +
    '<g fill="#1c2a45" opacity=".22"><polygon points="1034,300 1060,330 1040,410 1012,430"/><polygon points="1090,380 1130,430 1100,520 1070,470"/></g>' +
    // 안개
    '<g class="nl-cloud nl-cloud2" filter="url(#nlBlur)"><ellipse cx="1040" cy="520" rx="520" ry="46" fill="url(#nlMist)"/><ellipse cx="640" cy="590" rx="420" ry="34" fill="url(#nlMist)" opacity=".8"/></g>' +
    // 숲 능선과 호수(인터라켄)
    '<polygon points="0,640 140,610 280,640 420,620 560,660 700,640 860,670 1000,650 1160,676 1320,650 1460,672 1600,650 1600,740 0,740" fill="#1d4a3f"/>' +
    '<rect y="700" width="1600" height="110" fill="url(#nlLake)"/>' +
    '<g opacity=".55" filter="url(#nlSoft)"><polygon points="1030,712 1000,740 960,800 1100,800 1060,750" fill="#fdf3e4"/><rect x="760" y="722" width="560" height="3" fill="#fff"/><rect x="860" y="742" width="380" height="2" fill="#fff"/><rect x="940" y="764" width="220" height="2" fill="#fff"/></g>' +
    // 마을 불빛
    '<g fill="#ffd27a" opacity=".85"><rect x="520" y="692" width="6" height="5"/><rect x="552" y="694" width="5" height="4"/><rect x="580" y="690" width="6" height="5"/><rect x="1250" y="694" width="6" height="5"/><rect x="1290" y="692" width="5" height="4"/><rect x="1330" y="696" width="6" height="5"/></g>' +
    // 앞쪽 언덕과 소나무
    '<polygon points="0,900 0,760 140,740 300,770 460,800 640,830 820,880 900,900" fill="#10332d"/>' +
    '<polygon points="1600,900 1600,740 1470,730 1320,770 1180,800 1040,840 940,900" fill="#0d2b27"/>' +
    '<g><use href="#nlPine" transform="translate(70 762) scale(1.5)"/><use href="#nlPine" transform="translate(150 772) scale(1.1)"/><use href="#nlPine" transform="translate(40 820) scale(1.9)"/><use href="#nlPine" transform="translate(230 800) scale(1.3)"/>' +
    '<use href="#nlPine" transform="translate(1540 750) scale(1.6)"/><use href="#nlPine" transform="translate(1460 768) scale(1.2)"/><use href="#nlPine" transform="translate(1560 826) scale(2)"/><use href="#nlPine" transform="translate(1380 790) scale(1.3)"/></g>' +
    '</svg>';

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
    root.remove(); root = null;
    doc.documentElement.classList.remove('nine-landing-open');
  }

  function openModal() {
    var modal = root.querySelector('.nl-modal');
    modal.hidden = false;
    var first = modal.querySelector('a'); if (first) first.focus();
  }

  function build(naverConfigured) {
    var menu = MENU.map(function (m) { return '<a href="' + esc(m[1]) + '" data-nl-go="1">' + esc(m[0]) + '</a>'; }).join('');
    root.innerHTML = SCENE + '<div class="nl-photo"></div><div class="nl-shade"></div>' +
      '<div class="nl-top"><a class="nl-logo" href="/category/마켓 브리핑" data-nl-go="1">ㄱ ㅖ조 ㅏ 심폐소생술</a><nav class="nl-nav" aria-label="공개 메뉴">' + menu + '</nav></div>' +
      '<div class="nl-hero"><span class="nl-badge">시장을 차분하게 읽는 곳</span>' +
      '<p class="nl-sub">대화방, 캘린더, 마켓브리핑, 이야기 시리즈는 로그인 없이 볼 수 있어요. 시장지표는 로그인 후에 열립니다.</p></div>' +
      '<button type="button" class="nl-loginfab" data-nl-login="1">로그인</button>' +
      '<a class="nl-credit" href="https://commons.wikimedia.org/wiki/File:View_of_Interlaken_and_Lake_Brienz_from_Harder_Kulm_(Ank_Kumar)_06.jpg" target="_blank" rel="noopener">사진: Ank Kumar · CC BY-SA 4.0 · Wikimedia Commons</a>' +
      '<div class="nl-modal" hidden><section class="nl-card" role="dialog" aria-modal="true" aria-label="로그인">' +
      '<h2>로그인</h2><p>사용할 계정을 선택하세요. 승인된 계정으로 로그인하면 기존 대시보드가 열리고, 그 외 계정은 공개 화면을 이용합니다.</p>' +
      '<a class="nl-pv nl-google" href="' + API + '/auth/google/start?return_to=' + ret() + '"><i>G</i><span>Google로 계속하기<small>관리자 계정이면 전체 서비스</small></span></a>' +
      (naverConfigured ? '<a class="nl-pv nl-naver" href="' + API + '/auth/naver/start?return_to=' + ret() + '"><i>N</i><span>네이버로 계속하기<small>네이버 계정으로 로그인</small></span></a>' : '') +
      '<a class="nl-pv nl-kakao" href="' + esc(kakaoUrl()) + '"><i>K</i><span>카카오로 계속하기<small>블로그 관리자(Tistory) 로그인</small></span></a>' +
      '<p class="nl-note">카카오는 블로그 관리자 로그인입니다. 서비스 기능은 관리자 승인 계정에 한해 제공됩니다.</p>' +
      '<button type="button" class="nl-back" data-nl-back="1">닫기</button></section></div>';
    root.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target : null;
      if (!t) return;
      var go = t.closest('[data-nl-go]');
      if (go) {
        markSeen();
        var u = new URL(go.getAttribute('href'), global.location.origin);
        var here = global.location.pathname + global.location.search;
        if (decodeURIComponent(u.pathname + u.search) === decodeURIComponent(here)) {
          e.preventDefault(); close();
          if (u.hash === '#story-series') { // 이야기 시리즈: 푸터 카드 영역으로
            var target = doc.querySelector('.site-footer-learn');
            if (target && target.scrollIntoView) setTimeout(function () { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
          }
        }
        return; // 다른 화면이면 링크 이동
      }
      if (t.closest('[data-nl-login]')) {
        openModal();
      } else if (t.closest('[data-nl-back]') || t.classList.contains('nl-modal')) {
        root.querySelector('.nl-modal').hidden = true;
      }
    });
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
