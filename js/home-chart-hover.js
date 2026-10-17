/* 홈 대시보드 미니 차트 마우스 오버(2026-10-18 사용자 요청: "코스피·코스닥·투자자동향·미국증시 마우스 오버 시 지수랑 시간 정도는 표기, 휴장도 동일").
 *
 * 차트를 그리는 쪽(js/skin-main.js 장중 지수·투자자 동향, js/home-weekly-report.js 휴장 리포트)은 SVG 래퍼에
 *   data-hover-points='[[x%, y%, "문구"], ...]'   (x·y 는 래퍼 크기 대비 0~100)
 * 만 달아 둔다. 이 파일이 문서 전체에 포인터 이벤트를 한 번만 걸어 가장 가까운 점의 문구·세로선·점을 보여 준다.
 * 차트가 다시 그려져(innerHTML 교체) 래퍼가 바뀌어도 위임 방식이라 다시 걸 필요가 없다. 문구는 textContent 로만 넣는다. */
(function (global) {
  'use strict';
  if (global.HomeChartHover) return;

  // 스타일은 이 파일이 직접 넣는다(홈 대시보드·휴장 리포트가 서로 다른 CSS 파일을 쓰고, 스킨 HTML을 바꾸지 않기 위해).
  var style = document.createElement('style');
  style.setAttribute('data-home-chart-hover', '');
  style.textContent = '[data-hover-points]{position:relative;touch-action:pan-y;cursor:crosshair}'
    + '[data-hover-points] .hch-guide{position:absolute;top:0;bottom:0;width:0;border-left:1px dashed rgba(100,116,139,.7);pointer-events:none;z-index:3}'
    + '[data-hover-points] .hch-dot{position:absolute;width:9px;height:9px;margin:-4.5px 0 0 -4.5px;border-radius:50%;background:#fff;border:2px solid #475569;pointer-events:none;z-index:4}'
    + '[data-hover-points] .hch-tip{position:absolute;top:-4px;transform:translateY(-100%);z-index:5;max-width:260px;padding:5px 8px;border-radius:6px;'
    + 'background:rgba(255,255,255,.97);border:1px solid rgba(148,163,184,.6);box-shadow:0 2px 8px rgba(15,23,42,.16);color:#1f2937;'
    + 'font:500 11px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;white-space:pre;width:max-content;pointer-events:none}'
    + 'html.dark [data-hover-points] .hch-tip{background:rgba(26,26,26,.96);border-color:rgba(245,239,224,.24);color:#F5EFE0}'
    + 'html.dark [data-hover-points] .hch-dot{background:#1a1a1a;border-color:#cbd5e1}'
    + '[data-hover-points] [hidden]{display:none}';
  (document.head || document.documentElement).appendChild(style);

  var SELECTOR = '[data-hover-points]';
  var active = null; // { host, parts }
  var hideTimer = 0;

  function parse(host) {
    var raw = host.getAttribute('data-hover-points');
    if (host.__hoverRaw === raw && host.__hoverPoints) return host.__hoverPoints;
    var points = [];
    try {
      points = JSON.parse(raw || '[]').filter(function (p) {
        return Array.isArray(p) && isFinite(Number(p[0])) && isFinite(Number(p[1]));
      });
    } catch (e) { points = []; }
    host.__hoverRaw = raw;
    host.__hoverPoints = points;
    return points;
  }

  function ensureParts(host) {
    var parts = host.__hoverParts;
    if (parts && parts.tip.parentNode === host) return parts;
    parts = {
      guide: document.createElement('i'),
      dot: document.createElement('i'),
      tip: document.createElement('div')
    };
    parts.guide.className = 'hch-guide';
    parts.dot.className = 'hch-dot';
    parts.tip.className = 'hch-tip';
    parts.tip.setAttribute('role', 'status');
    [parts.guide, parts.dot, parts.tip].forEach(function (el) { el.hidden = true; el.setAttribute('aria-hidden', 'true'); host.appendChild(el); });
    host.__hoverParts = parts;
    return parts;
  }

  function hide() {
    if (!active) return;
    var parts = active.host.__hoverParts;
    if (parts) { parts.guide.hidden = true; parts.dot.hidden = true; parts.tip.hidden = true; }
    active = null;
  }

  function show(host, clientX) {
    var points = parse(host);
    if (!points.length) { hide(); return; }
    var rect = host.getBoundingClientRect();
    if (!rect.width) return;
    var pct = (clientX - rect.left) / rect.width * 100;
    var best = points[0], gap = Infinity;
    for (var i = 0; i < points.length; i++) {
      var d = Math.abs(Number(points[i][0]) - pct);
      if (d < gap) { gap = d; best = points[i]; }
    }
    if (active && active.host !== host) hide();
    var parts = ensureParts(host);
    var x = Number(best[0]), y = Number(best[1]);
    parts.guide.style.left = x + '%';
    parts.dot.style.left = x + '%';
    parts.dot.style.top = y + '%';
    parts.tip.textContent = String(best[2] == null ? '' : best[2]);
    parts.guide.hidden = false;
    parts.dot.hidden = false;
    parts.tip.hidden = false;
    // 툴팁은 오른쪽 절반에서는 점의 왼쪽에, 왼쪽 절반에서는 오른쪽에 둔다(래퍼 밖으로 잘리지 않게).
    if (x > 55) { parts.tip.style.left = 'auto'; parts.tip.style.right = (100 - x) + '%'; parts.tip.style.marginRight = '8px'; parts.tip.style.marginLeft = '0'; }
    else { parts.tip.style.right = 'auto'; parts.tip.style.left = x + '%'; parts.tip.style.marginLeft = '8px'; parts.tip.style.marginRight = '0'; }
    active = { host: host, parts: parts };
    clearTimeout(hideTimer);
  }

  function hostOf(event) {
    var target = event.target;
    return target && target.closest ? target.closest(SELECTOR) : null;
  }

  document.addEventListener('pointermove', function (event) {
    var host = hostOf(event);
    if (host) show(host, event.clientX); else if (active) hide();
  }, { passive: true });
  document.addEventListener('pointerdown', function (event) {
    var host = hostOf(event);
    if (host) show(host, event.clientX);
  }, { passive: true });
  document.addEventListener('pointerup', function (event) {
    if (event.pointerType === 'touch' && active) { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 2200); }
  }, { passive: true });
  document.addEventListener('pointercancel', hide, { passive: true });
  document.addEventListener('mouseleave', hide);

  // 점 목록을 속성 문자열로 만든다. 호출부가 같은 방식으로 쓰도록 공개한다.
  function attr(points) {
    return JSON.stringify(points.map(function (p) { return [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100, p[2]]; }))
      .replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  global.HomeChartHover = { attr: attr, hide: hide };
})(window);
