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

  var narrow = window.innerWidth < 720;
  var LIMIT = narrow ? 700 : 1000;

  function textLen(n) { return (n.textContent || '').replace(/\s+/g, ' ').trim().length; }
  function weight(n) {
    var tag = n.tagName;
    var cls = n.className && n.className.baseVal === undefined ? String(n.className) : '';
    if (tag === 'H3') return 70;
    if (tag === 'P') return textLen(n) + 40;
    if (tag === 'UL' || tag === 'OL') {
      var w = 0;
      Array.prototype.forEach.call(n.children, function (li) { w += textLen(li) + 30; });
      return w;
    }
    if (tag === 'TABLE') return n.rows.length * 70 + 60;
    if (tag === 'FIGURE') return narrow ? 280 : 330;
    if (tag === 'DETAILS') return 110;
    if (/in-facts/.test(cls)) return 160;
    if (n.querySelector && n.querySelector('table')) return n.querySelectorAll('tr').length * 70 + 80;
    if (n.querySelector && n.querySelector('svg')) return (narrow ? 280 : 330) + textLen(n);
    return textLen(n) + 90;
  }

  /* 한 절의 노드를 무게 순서대로 카드 묶음으로 나눈다. 소제목은 바로 뒤 노드와 붙인다. */
  function chunk(nodes, firstBudget) {
    var units = [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].tagName === 'H3' && nodes[i + 1]) { units.push([nodes[i], nodes[i + 1]]); i++; }
      else units.push([nodes[i]]);
    }
    var out = [], sums = [], cur = [], sum = 0, budget = firstBudget;
    units.forEach(function (u) {
      var w = 0;
      u.forEach(function (n) { w += weight(n); });
      if (cur.length && sum + w > budget) { out.push(cur); sums.push(sum); cur = []; sum = 0; budget = LIMIT; }
      u.forEach(function (n) { cur.push(n); });
      sum += w;
    });
    if (cur.length) { out.push(cur); sums.push(sum); }
    /* 끝에 남은 얇은 카드는 앞 카드에 합친다(카드 안에서 스크롤되므로 내용은 잃지 않는다). */
    var k = out.length - 1;
    if (k > 0 && sums[k] < LIMIT * 0.4 && sums[k - 1] + sums[k] <= LIMIT * 1.45) {
      out[k - 1] = out[k - 1].concat(out[k]);
      out.pop();
    }
    return out;
  }

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
  var coverChunks = chunk(coverNodes, LIMIT);
  coverChunks.forEach(function (c, i) {
    cards.push({ kind: 'cover', num: 0, title: '', nodes: c, cont: i > 0 });
  });
  tocItems.push({ label: '표지', index: 0 });

  /* 본문 */
  rest.forEach(function (sec, si) {
    var n = si + 1;
    var kids = Array.prototype.slice.call(sec.children);
    var h2 = null;
    if (kids.length && kids[0].tagName === 'H2') h2 = kids.shift();
    var title = h2 ? h2.textContent.trim() : '';
    var kind = sec.classList.contains('learn-deep') ? 'deep' : (sec.querySelector('.in-quiz') ? 'quiz' : 'body');
    var chunks = chunk(kids, LIMIT - 90);
    if (!chunks.length) chunks = [[]];
    tocItems.push({ label: pad(n) + '  ' + title, index: cards.length });
    chunks.forEach(function (c, i) {
      cards.push({ kind: kind, num: n, title: title, h2: i === 0 ? h2 : null, nodes: c, cont: i > 0 });
    });
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
    foot.appendChild(el('span', 'lc-count', pad(i + 1) + ' / ' + pad(total)));
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

  var cur = -1;
  function show(i, keepScroll) {
    i = Math.max(0, Math.min(total - 1, i));
    if (i === cur) return;
    if (cur >= 0) cardEls[cur].classList.remove('on');
    cur = i;
    cardEls[cur].classList.add('on');
    var body = cardEls[cur].querySelector('.lc-body');
    if (body && !keepScroll) body.scrollTop = 0;
    bar.style.width = ((cur + 1) / total * 100) + '%';
    prev.disabled = cur === 0;
    next.disabled = cur === total - 1;
    var ti = 0;
    tocItems.forEach(function (t, k) { if (t.index <= cur) ti = k; });
    toc.value = String(tocItems[ti].index);
    if (!keepScroll) {
      var r = book.getBoundingClientRect();
      if (r.top < 0 || r.top > window.innerHeight * 0.5) book.scrollIntoView({ block: 'start' });
    }
  }
  prev.addEventListener('click', function () { show(cur - 1); });
  next.addEventListener('click', function () { show(cur + 1); });
  toc.addEventListener('change', function () { show(parseInt(toc.value, 10) || 0); });

  document.addEventListener('keydown', function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === 'ArrowRight') show(cur + 1);
    else if (e.key === 'ArrowLeft') show(cur - 1);
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
    show(dx < 0 ? cur + 1 : cur - 1);
  }, { passive: true });

  function goHash() {
    var id = '';
    try { id = decodeURIComponent(location.hash.replace(/^#/, '')); } catch (e) { id = ''; }
    if (!id) return false;
    var t = document.getElementById(id);
    var card = t && t.closest ? t.closest('.lc-card') : null;
    if (!card) return false;
    show(cardEls.indexOf(card));
    if (t.scrollIntoView) t.scrollIntoView({ block: 'nearest' });
    return true;
  }
  window.addEventListener('hashchange', goHash);

  root.classList.remove('lc-pre');
  root.classList.add('lc-on');
  if (!goHash()) show(0, true);
})();
