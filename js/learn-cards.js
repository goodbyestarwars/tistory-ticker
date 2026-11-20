/* 이야기 시리즈 카드(책) 읽기 모드 (2026-11-21 사용자 지시)
   learn/ 각 장의 본문(.learn-sec, .learn-deep)을 한 장에 한 생각씩 넘겨 보는 카드로 나눈다.
   - 원본 노드를 복제하지 않고 카드 안으로 옮기므로 id·details·SVG·링크는 그대로 동작한다.
   - '스크롤로 보기'를 고르면 localStorage(lc_mode=scroll)에 저장하고 새로 고쳐 기존 모습으로 돌아간다.
   - 새 요청·타이머·폴링 없음. JS가 실패하면 css/learn-cards.css의 안전장치가 원문을 2.5초 뒤 다시 보여 준다. */
(function () {
  'use strict';
  var root = document.documentElement;
  var wrap = document.querySelector('body.learn-page .legal-wrap');
  var MODE_KEY = 'lc_mode';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function getMode() {
    try { return localStorage.getItem(MODE_KEY) === 'scroll' ? 'scroll' : 'card'; } catch (e) { return 'card'; }
  }
  function setMode(m) {
    try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* 저장 불가여도 새로 고침은 진행 */ }
    location.reload();
  }

  if (!wrap) { root.classList.remove('lc-pre'); return; }

  function switchButton(label, to) {
    var b = el('button', 'lc-switch', label);
    b.type = 'button';
    b.addEventListener('click', function () { setMode(to); });
    return b;
  }

  if (getMode() === 'scroll') {
    root.classList.remove('lc-pre');
    var anchor = wrap.querySelector(':scope > .learn-search');
    var bar0 = el('div', 'lc-scrollbar');
    bar0.appendChild(switchButton('카드로 읽기', 'card'));
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(bar0, anchor.nextSibling);
    return;
  }

  var h1 = wrap.querySelector(':scope > h1');
  var date = wrap.querySelector(':scope > .legal-effective-date');
  var secs = Array.prototype.filter.call(wrap.children, function (n) {
    return n.matches && n.matches('section.learn-sec, section.learn-deep');
  });
  if (!secs.length) { root.classList.remove('lc-pre'); return; }

  function colCount() { return window.innerWidth >= 900 ? 2 : 1; }

  var cards = []; /* {num, title, kind, nodes, lead, cont} */
  var tocItems = [];

  /* 표지 */
  var coverNodes = [];
  if (h1) coverNodes.push(h1);
  if (date) coverNodes.push(date);
  var first = secs[0];
  var rest = secs;
  if (first.classList.contains('learn-sec--intro')) {
    coverNodes = coverNodes.concat(Array.prototype.slice.call(first.children));
    rest = secs.slice(1);
  }
  cards.push({ kind: 'cover', num: 0, title: '', nodes: coverNodes, cont: false });
  tocItems.push({ label: '표지', index: 0 });

  /* 본문 */
  rest.forEach(function (sec, si) {
    var n = si + 1;
    var kids = Array.prototype.slice.call(sec.children);
    var h2 = null;
    if (kids.length && kids[0].tagName === 'H2') h2 = kids.shift();
    var title = h2 ? h2.textContent.trim() : '';
    var kind = sec.classList.contains('learn-deep') ? 'deep' : (sec.querySelector('.in-quiz') ? 'quiz' : 'body');
    tocItems.push({ label: pad(n) + '  ' + title, index: cards.length });
    cards.push({ kind: kind, num: n, title: title, h2: h2, nodes: kids, cont: false });
  });

  var total = cards.length;
  var seriesName = h1 ? h1.textContent.trim() : document.title;
  var kindLabel = { cover: '표지', body: '본문', deep: '심화', quiz: '퀴즈' };

  var book = el('section', 'lc-book');
  book.setAttribute('aria-label', '카드로 읽기');
  var top = el('div', 'lc-top');
  var toc = el('select', 'lc-toc');
  toc.setAttribute('aria-label', '목차');
  tocItems.forEach(function (t) {
    var o = el('option', null, t.label);
    o.value = String(t.index);
    toc.appendChild(o);
  });
  top.appendChild(toc);
  top.appendChild(switchButton('스크롤로 보기', 'scroll'));
  book.appendChild(top);

  var stage = el('div', 'lc-stage');
  var cardEls = cards.map(function (c, i) {
    var a = el('article', 'lc-card lc-card--' + c.kind);
    var head = el('header', 'lc-head');
    head.appendChild(el('span', null, seriesName));
    head.appendChild(el('b', null, kindLabel[c.kind]));
    a.appendChild(head);
    var body = el('div', 'lc-body');
    if (c.kind !== 'cover') {
      var num = el('div', 'lc-num');
      num.appendChild(el('span', null, pad(c.num)));
      num.appendChild(el('i'));
      body.appendChild(num);
      if (c.h2) { c.h2.classList.add('lc-title'); body.appendChild(c.h2); }
      else if (c.title) body.appendChild(el('p', 'lc-subtitle', c.title + ' (이어서)'));
    }
    c.nodes.forEach(function (n) { body.appendChild(n); });
    a.appendChild(body);
    var foot = el('footer', 'lc-foot');
    foot.appendChild(el('span', null, '9Pay 이야기 시리즈'));
    foot.appendChild(el('span', 'lc-count'));
    a.appendChild(foot);
    stage.appendChild(a);
    return a;
  });
  book.appendChild(stage);

  var ctrl = el('div', 'lc-ctrl');
  var prev = el('button', 'lc-btn', '‹ 이전');
  var next = el('button', 'lc-btn', '다음 ›');
  prev.type = next.type = 'button';
  var prog = el('div', 'lc-progress');
  var bar = el('i');
  prog.appendChild(bar);
  ctrl.appendChild(prev);
  ctrl.appendChild(prog);
  ctrl.appendChild(next);
  book.appendChild(ctrl);

  secs[0].parentNode.insertBefore(book, secs[0]);
  secs.forEach(function (s) { if (s.parentNode) s.parentNode.removeChild(s); });

  var cur = -1, sub = 0, pages = cards.map(function () { return 1; });
  function bodyOf(i) { return cardEls[i].querySelector('.lc-body'); }
  function stepOf(b) {
    var gap = parseFloat(getComputedStyle(b).columnGap) || 0;
    return b.clientWidth + gap;
  }
  /* 쪽 경계에서 잘리지 않게 다듬는다: 같은 폭 칸으로 나뉜 상자 묶음(사례 카드 등)은 세로로 쌓고,
     한 쪽에 들어가는 상자·그림·표는 쪽 중간에서 끊지 않는다. 쪽 폭이 바뀔 때마다 다시 계산한다. */
  function fit(b) {
    Array.prototype.forEach.call(b.querySelectorAll('.lc-stack, .lc-keep'), function (n) { n.classList.remove('lc-stack', 'lc-keep'); });
    var cs = getComputedStyle(b), gap = parseFloat(cs.columnGap) || 0, cols = parseInt(cs.columnCount, 10) || 1;
    var colW = (b.clientWidth - gap * (cols - 1)) / cols, colH = b.clientHeight;
    b.classList.add('lc-flat');
    b.style.width = colW + 'px';
    var blocks = b.querySelectorAll('div, section, figure, table, details, blockquote, dl, ul, ol');
    Array.prototype.forEach.call(blocks, function (n) {
      if (getComputedStyle(n).display !== 'grid') return;
      var tr = getComputedStyle(n).gridTemplateColumns.split(' ').map(parseFloat).filter(function (x) { return x > 0; });
      if (tr.length > 1 && Math.max.apply(null, tr) - Math.min.apply(null, tr) < 3 && n.children.length > 1) n.classList.add('lc-stack');
    });
    Array.prototype.forEach.call(blocks, function (n) {
      if (n.tagName === 'UL' || n.tagName === 'OL') return;
      if (n.offsetHeight > 0 && n.offsetHeight < colH * 0.9) n.classList.add('lc-keep');
    });
    b.style.width = '';
    b.classList.remove('lc-flat');
  }
  function measure() {
    /* 카드마다 잠깐 펼쳐 쪽 수를 센다(세로 스크롤 없이 쪽으로 넘기므로 내용 길이 = 쪽 수). */
    var keep = cur;
    cardEls.forEach(function (c, i) {
      var was = c.classList.contains('on');
      c.classList.add('on', 'lc-measure');
      var b = bodyOf(i);
      fit(b);
      var gap = parseFloat(getComputedStyle(b).columnGap) || 0, st = b.clientWidth + gap;
      pages[i] = Math.max(1, Math.round((b.scrollWidth + gap) / st));
      c.classList.remove('lc-measure');
      if (!was) c.classList.remove('on');
    });
    if (keep >= 0) cardEls[keep].classList.add('on');
  }
  function paint() {
    var b = bodyOf(cur);
    sub = Math.max(0, Math.min(pages[cur] - 1, sub));
    b.scrollLeft = sub * stepOf(b);
    var before = 0, all = 0;
    pages.forEach(function (p, i) { if (i < cur) before += p; all += p; });
    cardEls.forEach(function (c, i) {
      var cnt = c.querySelector('.lc-count');
      if (cnt) cnt.textContent = i === cur ? pad(before + sub + 1) + ' / ' + pad(all) : '';
    });
    bar.style.width = ((before + sub + 1) / all * 100) + '%';
    prev.disabled = cur === 0 && sub === 0;
    next.disabled = cur === total - 1 && sub === pages[cur] - 1;
  }
  function show(i, s, keepScroll) {
    i = Math.max(0, Math.min(total - 1, i));
    if (cur >= 0 && i !== cur) cardEls[cur].classList.remove('on');
    var changed = i !== cur;
    cur = i;
    cardEls[cur].classList.add('on');
    if (changed) pages[cur] = Math.max(1, Math.round((bodyOf(cur).scrollWidth + (parseFloat(getComputedStyle(bodyOf(cur)).columnGap) || 0)) / stepOf(bodyOf(cur))));
    sub = s === 'last' ? pages[cur] - 1 : (s || 0);
    paint();
    var ti = 0;
    tocItems.forEach(function (t, k) { if (t.index <= cur) ti = k; });
    toc.value = String(tocItems[ti].index);
    if (!keepScroll) {
      var r = book.getBoundingClientRect();
      if (r.top < 0 || r.top > window.innerHeight * 0.5) book.scrollIntoView({ block: 'start' });
    }
  }
  function turn(d) {
    var s = sub + d;
    if (s >= 0 && s < pages[cur]) { sub = s; paint(); return; }
    if (d > 0 && cur < total - 1) show(cur + 1, 0);
    else if (d < 0 && cur > 0) show(cur - 1, 'last');
  }
  prev.addEventListener('click', function () { turn(-1); });
  next.addEventListener('click', function () { turn(1); });
  toc.addEventListener('change', function () { show(parseInt(toc.value, 10) || 0, 0); });

  var rz = 0, lastCols = colCount();
  window.addEventListener('resize', function () {
    clearTimeout(rz);
    rz = setTimeout(function () { measure(); paint(); lastCols = colCount(); }, 150);
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { measure(); paint(); });

  document.addEventListener('keydown', function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === 'ArrowRight') turn(1);
    else if (e.key === 'ArrowLeft') turn(-1);
  });

  var sx = 0, sy = 0, tracking = false, blocked = false;
  stage.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) { tracking = false; return; }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true;
    blocked = false;
    for (var n = e.target; n && n !== stage; n = n.parentNode) {
      if (n.scrollWidth > n.clientWidth + 2 && n.nodeType === 1 &&
          /(auto|scroll)/.test(getComputedStyle(n).overflowX)) { blocked = true; break; }
    }
  }, { passive: true });
  stage.addEventListener('touchend', function (e) {
    if (!tracking || blocked) return;
    tracking = false;
    var t = e.changedTouches[0];
    var dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.8) return;
    turn(dx < 0 ? 1 : -1);
  }, { passive: true });

  function goHash() {
    var id = '';
    try { id = decodeURIComponent(location.hash.replace(/^#/, '')); } catch (e) { id = ''; }
    if (!id) return false;
    var t = document.getElementById(id);
    var card = t && t.closest ? t.closest('.lc-card') : null;
    if (!card) return false;
    var ci = cardEls.indexOf(card);
    show(ci, 0);
    var b = bodyOf(ci);
    var off = 0;
    for (var n = t; n && n !== b; n = n.offsetParent) off += n.offsetLeft;
    show(ci, Math.floor(off / stepOf(b)), true);
    return true;
  }
  window.addEventListener('hashchange', goHash);

  root.classList.remove('lc-pre');
  root.classList.add('lc-on');
  measure();
  if (!goHash()) show(0, 0, true);
})();
