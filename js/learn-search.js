/* 이야기 시리즈(learn/*.html) 전체 검색. 모든 이야기 페이지가 이 파일 하나를 공유한다.
   색인은 data/learn-search.js(scripts/build_learn_search.js가 만든다)를 처음 입력할 때 한 번만 불러온다.
   서버·DB 없이 브라우저에서만 검색하며 외부 요청이 없다. */
(function (global) {
  'use strict';
  var host = document.getElementById('learn-search');
  if (!host || host.getAttribute('data-ready')) return;
  host.setAttribute('data-ready', '1');

  var script = document.currentScript;
  var src = script && script.src ? script.src : '';
  var base = src ? src.replace(/js\/learn-search\.js.*$/, '') : '../';
  var LIMIT = 20;
  var index = null;
  var loading = false;
  var pending = null;

  host.innerHTML =
    '<form class="ls-form" role="search" autocomplete="off">' +
      '<input class="ls-input" type="search" aria-label="이야기 전체 검색" placeholder="이야기 전체 검색 (예: 헤지펀드, 공매도, PER)" />' +
    '</form>' +
    '<div class="ls-results" aria-live="polite" hidden></div>';
  var form = host.querySelector('.ls-form');
  var input = host.querySelector('.ls-input');
  var box = host.querySelector('.ls-results');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function squash(s) { return s.replace(/\s+/g, ''); }

  function load(done) {
    if (index) { done(); return; }
    pending = done;
    if (loading) return;
    loading = true;
    var tag = document.createElement('script');
    tag.async = true;
    tag.src = base + 'data/learn-search.js';
    tag.onload = function () {
      index = global.NINE_LEARN_SEARCH || { s: [], g: [] };
      index.s.forEach(function (e) {
        e.k = (e.t + ' ' + e.h + ' ' + e.x).toLowerCase();
        e.ks = squash(e.k);
      });
      index.g.forEach(function (e) {
        e.k = (e.n + ' ' + e.e + ' ' + e.x).toLowerCase();
        e.ks = squash(e.k);
      });
      loading = false;
      if (pending) pending();
    };
    tag.onerror = function () {
      loading = false;
      box.hidden = false;
      box.innerHTML = '<p class="ls-empty">검색 색인을 불러오지 못했다. 잠시 뒤 다시 시도한다.</p>';
    };
    document.head.appendChild(tag);
  }

  function occurrences(hay, needle) {
    var n = 0, at = hay.indexOf(needle);
    while (at >= 0 && n < 5) { n += 1; at = hay.indexOf(needle, at + needle.length); }
    return n;
  }
  function matchAll(entry, tokens, joined) {
    for (var i = 0; i < tokens.length; i += 1) {
      if (entry.k.indexOf(tokens[i]) < 0 && entry.ks.indexOf(tokens[i]) < 0) {
        // 띄어쓰기 차이("헤지 펀드" 대 "헤지펀드")는 공백을 뺀 형태로 한 번 더 본다.
        return entry.ks.indexOf(joined) >= 0;
      }
    }
    return true;
  }
  function snippet(text, tokens) {
    var low = text.toLowerCase(), at = -1, hit = '';
    for (var i = 0; i < tokens.length; i += 1) {
      var p = low.indexOf(tokens[i]);
      if (p >= 0 && (at < 0 || p < at)) { at = p; hit = tokens[i]; }
    }
    var from = Math.max(0, at < 0 ? 0 : at - 36);
    var part = text.slice(from, from + 120);
    var out = esc(part);
    tokens.forEach(function (t) {
      if (!t) return;
      var re = new RegExp('(' + esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      out = out.replace(re, '<mark>$1</mark>');
    });
    return (from > 0 ? '… ' : '') + out + (from + 120 < text.length ? ' …' : '');
  }

  function search(q) {
    var tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    var joined = squash(q.toLowerCase());
    var rows = [];
    index.g.forEach(function (e) {
      if (!matchAll(e, tokens, joined)) return;
      var name = (e.n + ' ' + e.e).toLowerCase();
      var score = 50 + (name.indexOf(joined) >= 0 || squash(name).indexOf(joined) >= 0 ? 30 : 0);
      rows.push({ score: score, kind: 'g', e: e });
    });
    index.s.forEach(function (e) {
      if (!matchAll(e, tokens, joined)) return;
      var score = 0;
      tokens.forEach(function (t) {
        if (e.h.toLowerCase().indexOf(t) >= 0) score += 12;
        if (e.t.toLowerCase().indexOf(t) >= 0) score += 6;
        score += occurrences(e.k, t);
      });
      rows.push({ score: score, kind: 's', e: e });
    });
    rows.sort(function (a, b) { return b.score - a.score; });
    return { rows: rows, tokens: tokens };
  }

  function render(q) {
    q = q.trim();
    if (!q) { box.hidden = true; box.innerHTML = ''; return; }
    var res = search(q);
    box.hidden = false;
    if (!res.rows.length) {
      box.innerHTML = '<p class="ls-empty">"' + esc(q) + '"가 들어간 이야기를 찾지 못했다. 다른 낱말로 다시 찾아본다.</p>';
      return;
    }
    var shown = res.rows.slice(0, LIMIT);
    box.innerHTML = '<p class="ls-count">' + res.rows.length + '건' + (res.rows.length > LIMIT ? ' 중 위 ' + LIMIT + '건' : '') + '</p><ul class="ls-list">' +
      shown.map(function (r) {
        var e = r.e, href, head, text;
        if (r.kind === 'g') {
          href = base + 'learn/glossary.html#gl-' + encodeURIComponent(e.n);
          head = '금융용어사전 · ' + e.n + (e.e ? ' (' + e.e + ')' : '');
          text = e.x;
        } else {
          href = base + 'learn/' + e.u + (e.i ? '#' + e.i : '');
          head = e.t + (e.h ? ' › ' + e.h : '');
          text = e.x;
        }
        return '<li><a class="ls-item" href="' + esc(href) + '"><span class="ls-head">' + esc(head) + '</span><span class="ls-snippet">' +
          snippet(text, res.tokens) + '</span></a></li>';
      }).join('') + '</ul>';
  }

  function run() { load(function () { render(input.value); }); }
  input.addEventListener('input', run);
  input.addEventListener('focus', function () { load(function () {}); });
  input.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { input.value = ''; render(''); }
  });
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var first = box.querySelector('.ls-item');
    if (first) global.location.href = first.href;
  });
})(window);
