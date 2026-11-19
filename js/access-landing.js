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
    '.nl-layout{box-sizing:border-box;display:grid;grid-template-columns:minmax(280px, .62fr) minmax(0, 1.9fr);width:min(1360px,100%);margin:auto;background:#f7f0e4;border:1px solid #fff8ed;border-radius:22px;padding:10px;box-shadow:0 18px 45px rgba(93,69,37,.19)}' +
    '.nl-login-panel{display:flex;flex-direction:column;justify-content:center;padding:clamp(24px,4vw,56px)}' +
    '.nl-logo{font-size:18px;font-weight:700;margin-bottom:32px;color:#292721}' +
    '.nl-title,.nl-sub{font-family:inherit;font-size:16px;font-weight:700;line-height:1.65}.nl-title{margin:0}' +
    '.nl-sub{margin:12px 0 26px;color:#554d40;word-break:keep-all}' +
    '.nl-actions{display:grid;gap:10px}' +
    '.nl-btn{box-sizing:border-box;width:100%;min-height:48px;border:1px solid #07535b;border-radius:12px;box-shadow:0 4px 10px rgba(93,69,37,.15),inset 0 1px rgba(255,255,255,.35);font:inherit;font-weight:700;cursor:pointer;padding:10px 14px}' +
    '.nl-btn.primary{background:#07535b;color:#fff}.nl-btn.primary:hover{background:#09616a}' +
    '.nl-btn.ghost{background:#f4ebdc;border-color:#ded1bb;color:#292721}.nl-btn.ghost:hover{background:#ebe0cd}' +
    '.nl-btn:focus-visible,.nl-x:focus-visible,.nl-pv:focus-visible{outline:2px solid #07535b;outline-offset:3px}' +
    '.nl-visual{position:relative;min-width:0;margin:0;align-self:stretch;overflow:hidden;border-radius:14px;background:#efe4cd;aspect-ratio:1000/640}' +
    '.nl-sketch{position:absolute;inset:0;width:100%;height:100%;display:block}' +
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
    '@media (max-width:720px){.nl-layout{grid-template-columns:minmax(0,1fr);max-width:480px}.nl-visual{grid-row:1;align-self:start;aspect-ratio:auto;height:0;padding-top:62%}.nl-logo{margin-bottom:16px}.nl-login-panel{padding:22px 16px}.nl-sub{margin-bottom:18px}}' +
    // 모바일 한 열 배치는 위 미디어쿼리에서 padding-top 비율로 높이를 확보한다. iOS Safari(WebKit)는 그리드 stretch가
    // aspect-ratio보다 우선해 SVG(absolute)만 있는 칸이 높이 0이 됐다(2026-11-20 실기기 확인). 아래는 미지원 브라우저의 PC 보완.
    '@supports not (aspect-ratio:1/1){.nl-visual{height:0;padding-top:64%}}';

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

  /* 2026-11-19 사용자 선택 시안: 양피지 위 설계도 스케치(코드로 그린 원본 — 외부 이미지·저작물 없음).
     동심원·십자선·캔들·이동평균·정규분포와 손글씨 수식. 상승 #E8A39E·하락 #86AEE1·강조 #075759.
     손글씨 글꼴은 사용 글자만 Google Fonts(Nanum Pen Script)에서 받고, 실패하면 명조(--font-serif)로 대체된다. */
  /* 수식은 손글씨(Nanum Pen Script, 사용 글자만 Google Fonts), 한글 메모는 사이트 명조(--font-serif)로 반듯하게 쓴다. */
  var NOTES = [
    [60, 56, 'σ = √( Σ (rᵢ − μ)² / n )', 24, 0, 'm'], [60, 108, 'E[R] = Rf + β ( Rm − Rf )', 22, 0, 'm'],
    [640, 70, 'Sharpe = (Rp − Rf) / σp', 24, 0, 'm'], [668, 118, 'CAGR = (V₁/V₀)^(1/n) − 1', 22, 0, 'm'],
    [560, 604, 'd₁ = [ ln(S/K) + (r+σ²/2)T ] / σ√T', 20, 0, 'm'], [60, 604, '∫ f(x) dx = 1', 24, 0, 'm'],
    [60, 632, 'P(x) = 1/(σ√2π) · e^(−(x−μ)²/2σ²)', 19, 0, 'm'], [760, 330, 'R² = 0.87', 20, 0, 'm'],
    [330, 168, '수급 → 추세 → 위치', 15, 0, 'k'], [540, 150, '가격 = 가치 ± 심리', 15, 0, 'k'],
    [770, 520, '변동성 ↓ · 거래량 ↑', 15, 0, 'k'], [175, 515, '지지 · 저항', 15, 0, 'k']
  ];
  function drawSketch(svg) {
    if (!svg || svg.getAttribute('data-drawn')) return;
    svg.setAttribute('data-drawn', '1');
    try {
      if (!doc.getElementById('nl-hand-font')) {
        var lk = doc.createElement('link');
        lk.id = 'nl-hand-font'; lk.rel = 'stylesheet';
        lk.href = 'https://fonts.googleapis.com/css2?family=Nanum+Pen+Script&display=swap&text=' + encodeURIComponent(NOTES.filter(function (n) { return n[5] === 'm'; }).map(function (n) { return n[2]; }).join(''));
        doc.head.appendChild(lk);
      }
    } catch (e) { /* 글꼴 실패 시 대체 글꼴 */ }
    var NS = 'http://www.w3.org/2000/svg', W = 1000, H = 640, seed = 7;
    function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
    function el(n, a, p) { var e = doc.createElementNS(NS, n); for (var k in a) e.setAttribute(k, a[k]); (p || svg).appendChild(e); return e; }
    var defs = el('defs', {});
    defs.innerHTML =
      '<filter id="nlWob" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="3" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="3"/></filter>' +
      '<filter id="nlWash" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.05" numOctaves="3" seed="9" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="26"/><feGaussianBlur stdDeviation="2.2"/></filter>' +
      '<filter id="nlPaper"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="5"/><feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.36  0 0 0 0 0.22  0 0 0 .22 0"/></filter>' +
      '<radialGradient id="nlVig" cx="50%" cy="50%" r="78%"><stop offset="62%" stop-color="#EFE4CD" stop-opacity="0"/><stop offset="100%" stop-color="#C9B48A" stop-opacity=".5"/></radialGradient>';
    el('rect', { width: W, height: H, fill: '#EFE4CD' });
    el('rect', { width: W, height: H, filter: 'url(#nlPaper)' });
    el('path', { d: 'M90 60 C130 150 60 240 110 330 C150 420 80 500 120 590 L160 590 C120 500 190 420 150 330 C110 240 180 150 135 60Z', fill: '#86AEE1', opacity: '.5', filter: 'url(#nlWash)' });
    el('path', { d: 'M850 400 C885 450 835 510 880 580 L910 580 C865 510 915 450 880 400Z', fill: '#E8A39E', opacity: '.5', filter: 'url(#nlWash)' });
    var g = el('g', { filter: 'url(#nlWob)', fill: 'none', stroke: '#2c2a25', 'stroke-linecap': 'round' });
    [[30, 78, 970, 78], [30, 580, 970, 580], [48, 20, 48, 620], [952, 20, 952, 620], [500, 16, 500, 624], [30, 330, 970, 330]].forEach(function (l, i) {
      el('line', { x1: l[0], y1: l[1], x2: l[2], y2: l[3], 'stroke-width': i < 4 ? .8 : .6, opacity: .55 }, g);
    });
    var cx = 500, cy = 330;
    [50, 95, 142, 192, 245].forEach(function (r, i) { el('circle', { cx: cx, cy: cy, r: r + rnd() * 3, 'stroke-width': i === 4 ? 1.5 : .8, opacity: .75 }, g); });
    for (var a = 0; a < 360; a += 15) {
      var rad = a * Math.PI / 180, r2 = 245 + (a % 45 === 0 ? 70 : 24);
      el('line', { x1: cx + Math.cos(rad) * 50, y1: cy + Math.sin(rad) * 50, x2: cx + Math.cos(rad) * r2, y2: cy + Math.sin(rad) * r2, 'stroke-width': .5, opacity: .4 }, g);
    }
    var x = 140, p = 360;
    for (var i = 0; i < 24; i++) {
      var up = rnd() > .42, body = 16 + rnd() * 38, wick = 10 + rnd() * 20, open = p, close = up ? p - body : p + body;
      p = Math.max(220, Math.min(430, close + (rnd() - .5) * 10));
      var top = Math.min(open, close), bot = Math.max(open, close);
      el('line', { x1: x, y1: top - wick, x2: x, y2: bot + wick * .8, 'stroke-width': 1.3 }, g);
      el('rect', { x: x - 7, y: top, width: 14, height: Math.max(bot - top, 4), 'stroke-width': 1.1, fill: up ? '#E8A39E' : '#86AEE1', 'fill-opacity': .8 }, g);
      x += 30 + rnd() * 3;
    }
    var d = 'M130 372'; for (var t = 0; t <= 14; t++) d += ' L' + (130 + t * 55) + ' ' + (360 - Math.sin(t * .55) * 48 - t * 4);
    el('path', { d: d, 'stroke-width': 1.6, stroke: '#075759', opacity: .9 }, g);
    var nd = 'M300 566'; for (var k = 0; k <= 70; k++) { var z = (k - 35) / 11; nd += ' L' + (300 + k * 6.5) + ' ' + (566 - Math.exp(-z * z / 2) * 66); }
    el('path', { d: nd, 'stroke-width': 1.2, opacity: .8 }, g);
    el('line', { x1: 527, y1: 566, x2: 527, y2: 500, 'stroke-width': .7, 'stroke-dasharray': '3 4' }, g);
    var tg = el('g', { fill: '#2c2a25', opacity: .86 });
    NOTES.forEach(function (n) {
      var hand = n[5] === 'm';
      var tx = el('text', { x: n[0], y: n[1], 'font-family': hand ? "'Nanum Pen Script',var(--font-serif,'Noto Serif KR'),serif" : "var(--font-serif,'Noto Serif KR'),serif", 'font-size': n[3], 'font-weight': hand ? 400 : 700, 'letter-spacing': hand ? 0 : '.02em' }, tg);
      tx.textContent = n[2];
    });
    for (var j = 0; j < 22; j++) { var yy = 140 + j * 18 + rnd() * 6, xx = 960 - rnd() * 6; el('line', { x1: xx - 40 - rnd() * 40, y1: yy, x2: xx, y2: yy + rnd() * 2, 'stroke-width': .5, opacity: .3, stroke: '#2c2a25' }, g); }
    el('rect', { width: W, height: H, fill: 'url(#nlVig)' });
  }

  function build(naverConfigured) {
    root.innerHTML = '<div class="nl-layout"><div class="nl-login-panel">' +
      '<p class="nl-sub">오늘의 시장 흐름을 차분히 읽고, 다양한 시선 속에서 나만의 투자 판단을 쌓아보세요.</p>' +
      '<div class="nl-actions"><button type="button" class="nl-btn primary" data-nl-login="1">로그인</button>' +
      '<button type="button" class="nl-btn ghost" data-nl-guest="1">비회원 로그인</button></div></div>' +
      '<figure class="nl-visual" aria-hidden="true"><svg class="nl-sketch" viewBox="0 0 1000 640" preserveAspectRatio="xMidYMid slice"></svg></figure></div>' +
      '<div class="nl-modal" hidden><section class="nl-card" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="nlLoginTitle">' +
      '<button type="button" class="nl-x" data-nl-back="1" aria-label="닫기">×</button>' +
      '<h2 id="nlLoginTitle">로그인</h2><p>Google 계정으로 로그인하세요. 회원·관리자 권한은 등록된 계정에 따라 적용됩니다.</p>' +
      '<a class="nl-pv nl-google" href="' + API + '/auth/google/start?return_to=' + ret() + '"><i>G</i><span>Google로 계속하기<small>관리자 계정이면 전체 서비스</small></span></a>' +
      '<p class="nl-note">티스토리 글·댓글 관리는 별도 블로그 관리에서 이용합니다.</p>' +
      '</section></div>';
    drawSketch(root.querySelector('.nl-sketch'));
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
